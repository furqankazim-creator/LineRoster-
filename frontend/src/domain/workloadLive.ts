/**
 * Live link between the Planner roster and Work Orders.
 *
 * Every work order is checked against the roster of ITS OWN line, for ITS OWN
 * date and shift:
 *
 *   on duty   = active people of that line whose cell that day is a code of the
 *               shift's family (by the code's tone: morning / evening / night,
 *               so M, ML, MT … all count as Morning)
 *   demand    = sum of required crew of that day's work orders on that shift
 *   buffer    = on duty − demand
 *
 * Engineers are handed out per work order without double-booking anyone in the
 * same day + shift. A crew picked by hand ("manual") is kept as long as those
 * people are still on that shift; any gap is filled automatically.
 *
 * The result is recomputed from scratch whenever the roster, the people, the
 * codes or the work orders change — nothing is stored, so it can't go stale.
 */
import type { Employee, ResourceRequirement, RosterMonth, ShiftCode, WorkOrder } from './types';
import { getRequiredCrewCount, lineCodeToId, normalizeLineCode, normalizeWorkType, parseLineCode, tryParseDate } from './workload';

export type ShiftFamily = 'M' | 'E' | 'N';
export const SHIFT_FAMILIES: ShiftFamily[] = ['M', 'E', 'N'];
export const SHIFT_LABEL: Record<ShiftFamily, string> = { M: 'Morning', E: 'Evening', N: 'Night' };

/**
 * Staff pools: Line 4 and Line 6 are run by ONE shared team, so their work
 * orders draw from the people of both lines together. Line 5 is its own team.
 */
export type StaffPool = 'L4_L6' | 'L5';
export const POOL_LINES: Record<StaffPool, { codes: ('L4' | 'L5' | 'L6')[]; ids: string[]; label: string }> = {
  L4_L6: { codes: ['L4', 'L6'], ids: ['line4', 'line6'], label: 'Line 4&6' },
  L5: { codes: ['L5'], ids: ['line5'], label: 'Line 5' },
};
export function poolOf(lineCode: string): StaffPool {
  return lineCode === 'L4' || lineCode === 'L6' ? 'L4_L6' : 'L5';
}
export function poolOfLineId(lineId: string): StaffPool {
  return lineId === 'line4' || lineId === 'line6' ? 'L4_L6' : 'L5';
}

/**
 * OK / SHORT / UNASSIGNED — staffing result.
 * NO_ROSTER — the line's team has no people yet.
 * UNPLACED  — no usable Scheduled Start or Line, so it can't be put on a day
 *             (a data problem, not a staff deficit; kept out of shift demand).
 */
export type LiveStatus = 'OK' | 'SHORT' | 'UNASSIGNED' | 'NO_ROSTER' | 'UNPLACED';

export interface LiveAllocation {
  woId: string;
  lineCode: 'L4' | 'L5' | 'L6';
  lineId: string;
  /** ISO date the work order is checked against (its scheduled start). */
  date: string;
  year: number;
  month: number;
  day: number;
  shift: ShiftFamily;
  needed: number;
  /** True when `needed` comes from Setup → Work Order Resource Standards. */
  crewFromStandard: boolean;
  /** People of this line on this shift that day (before other orders took any). */
  onShift: number;
  assignedIds: string[];
  assignedNames: string[];
  status: LiveStatus;
  /** Plain-language explanation for anything that is not OK. */
  reason?: string;
  manual: boolean;
  /** Hand-picked people who are no longer on this shift that day. */
  droppedManual: string[];
}

export interface ShiftDayBalance {
  /** The staff pool (Line 4 & 6 together, or Line 5). */
  pool: StaffPool;
  date: string;
  shift: ShiftFamily;
  onDuty: number;
  demand: number;
  pm: number;
  cm: number;
  acs: number;
  buffer: number;
  orders: number;
}

export interface WorkloadResult {
  byWo: Record<string, LiveAllocation>;
  /** One row per staff pool + date-with-work-orders + shift (all three shifts). */
  balances: ShiftDayBalance[];
  /** Work orders that are not fully staffed. */
  conflicts: LiveAllocation[];
}

export interface WorkloadInput {
  workOrders: WorkOrder[];
  /** The roster the Planner shows for that line & month (null if the line has no people). */
  getRoster: (lineId: string, year: number, month: number) => RosterMonth | null;
  employeesByLine: Record<string, Employee[]>;
  codesByLine: Record<string, ShiftCode[]>;
  requirements: ResourceRequirement[];
}

const TONE_FAMILY: Partial<Record<string, ShiftFamily>> = { morning: 'M', evening: 'E', night: 'N' };
const FALLBACK_FAMILY: Record<string, ShiftFamily> = {
  M: 'M', ML: 'M', MT: 'M', E: 'E', EL: 'E', ET: 'E', N: 'N', NL: 'N', NT: 'N',
};

/** Which shift family a roster code belongs to, using the line's own code settings. */
export function codeFamily(codeId: string | undefined, codes: ShiftCode[] | undefined): ShiftFamily | null {
  if (!codeId) return null;
  const code = codes?.find((c) => c.id === codeId);
  if (code) return TONE_FAMILY[code.tone] ?? null;
  return FALLBACK_FAMILY[codeId] ?? null;
}

/** Built-in crew default the importer used to write before standards were wired in. */
const OLD_DEFAULT: Record<string, number> = { PM: 2, CM: 2, ACS: 1 };

/** Whether a work order's crew size should come from the Setup resource standards. */
export function usesStandardCrew(wo: WorkOrder): boolean {
  if (wo.crewSource === 'standard') return true;
  if (wo.crewSource === 'file' || wo.crewSource === 'manual') return false;
  if (!wo.resourceRequired) return true;
  // Legacy record: the old importer wrote these defaults when the sheet had no crew
  return wo.resourceRequired === OLD_DEFAULT[normalizeWorkType(wo.workType)];
}

/** The shift a work order is planned on: its own choice, else derived from operational railway patterns. */
export function workOrderShift(wo: WorkOrder): ShiftFamily {
  if (wo.plannedShift && (wo.plannedShift === 'M' || wo.plannedShift === 'E' || wo.plannedShift === 'N')) {
    return wo.plannedShift;
  }
  const extraShift = wo.extra?.shift || wo.extra?.plannedShift || wo.extra?.Shift;
  if (extraShift) {
    const s = String(extraShift).trim().toUpperCase();
    if (s === 'M' || s.startsWith('MORN')) return 'M';
    if (s === 'E' || s.startsWith('EVEN') || s.startsWith('AFT')) return 'E';
    if (s === 'N' || s.startsWith('NIGH')) return 'N';
  }

  const desc = (wo.description || '').toUpperCase();
  const loc = (wo.location || '').toUpperCase();
  const ag = (wo.assetGroup || '').toUpperCase();
  const type = normalizeWorkType(wo.workType);

  // Explicit text keywords in description
  if (/\b(NIGHT|NITE|POSSESSION|NON-REVENUE|ENGINEERING HOURS)\b/.test(desc)) return 'N';
  if (/\b(EVENING|AFTERNOON|LATE)\b/.test(desc)) return 'E';
  if (/\b(MORNING|DAY|EARLY)\b/.test(desc)) return 'M';

  // 1. Heavy possessions and trackside assets (signalling, switches, permanent way, catenary, tunnel, 3rd rail)
  // These require line clearance / track possession during engineering hours -> Night shift (N)
  if (
    loc.includes('TRK') ||
    loc.includes('PW') ||
    desc.includes('TRK') ||
    desc.includes('TRACK') ||
    desc.includes('RAIL') ||
    desc.includes('SWITCH') ||
    desc.includes('INTERLOCK') ||
    desc.includes('POINT MACHINE') ||
    desc.includes('CATENARY') ||
    desc.includes('OVERHAUL') ||
    ag === 'SIG' ||
    ag === 'SCD' ||
    ag === 'PW' ||
    ag === 'TRK' ||
    (type === 'PM' && (wo.resourceRequired || 0) >= 4)
  ) {
    return 'N';
  }

  // 2. Station systems, CCTV, Access control, security, corrective repairs -> Evening shift (E)
  if (
    ag === 'CCT' ||
    ag === 'ACI' ||
    ag === 'ISM' ||
    type === 'CM' ||
    desc.includes('CCTV') ||
    desc.includes('ACCESS') ||
    desc.includes('SECURITY') ||
    desc.includes('REPAIR') ||
    desc.includes('FAULT')
  ) {
    return 'E';
  }

  // 3. Station communications, surveys, daylight passenger systems -> Morning shift (M)
  if (ag === 'DCS' || ag === 'PAS' || ag === 'PIS' || desc.includes('SURVEY') || desc.includes('INSPECTION')) {
    return 'M';
  }

  // Fallback: deterministic distribution based on workOrderId hash if unspecified
  const codeNum = (wo.workOrderId || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const mod = codeNum % 3;
  return mod === 0 ? 'M' : mod === 1 ? 'E' : 'N';
}

/** People of a line on a shift family for one day of a roster. */
export function staffOnShift(
  roster: RosterMonth | null,
  employees: Employee[],
  codes: ShiftCode[] | undefined,
  day: number,
  shift: ShiftFamily,
): Employee[] {
  if (!roster) return [];
  return employees.filter(
    (e) => e.active !== false && codeFamily(roster.cells[e.id]?.[day - 1]?.code, codes) === shift,
  );
}

export function computeWorkload(input: WorkloadInput): WorkloadResult {
  const { workOrders, getRoster, employeesByLine, codesByLine, requirements } = input;

  /** Everyone in a pool, and who of them is on a shift family that day. */
  const poolPeople = (pool: StaffPool) => POOL_LINES[pool].ids.flatMap((id) => employeesByLine[id] ?? []);
  const poolOnShift = (pool: StaffPool, y: number, m: number, d: number, shift: ShiftFamily) =>
    POOL_LINES[pool].ids.flatMap((id) => {
      const people = employeesByLine[id] ?? [];
      return people.length ? staffOnShift(getRoster(id, y, m), people, codesByLine[id], d, shift) : [];
    });
  const byWo: Record<string, LiveAllocation> = {};
  const busy = new Set<string>(); // `${empId}|${date}|${shift}`

  type Prepared = { wo: WorkOrder; lineId: string; lineCode: 'L4' | 'L5' | 'L6'; date: string; y: number; m: number; d: number; shift: ShiftFamily; needed: number; fromStandard: boolean };

  // Work orders that can't be put on a day: no Scheduled Start or no valid Line
  const placeable: WorkOrder[] = [];
  for (const wo of workOrders) {
    const date = tryParseDate(wo.scheduledStart);
    const line = parseLineCode(wo.line);
    if (date && line) { placeable.push(wo); continue; }
    const missing = [!date && 'Scheduled Start', !line && 'Line'].filter(Boolean).join(' and ');
    byWo[wo.id] = {
      woId: wo.id, lineCode: line ?? normalizeLineCode(wo.line), lineId: lineCodeToId(line ?? normalizeLineCode(wo.line)),
      date: date ?? '', year: 0, month: 0, day: 0, shift: workOrderShift(wo), needed: 0, crewFromStandard: false,
      onShift: 0, assignedIds: [], assignedNames: [], status: 'UNPLACED', manual: false, droppedManual: [],
      reason: `Not placed: no valid ${missing} — fix it in the Excel file and import again.`,
    };
  }

  const prepared: Prepared[] = placeable.map((wo) => {
    const lineCode = parseLineCode(wo.line)!;
    const date = tryParseDate(wo.scheduledStart)!;
    const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
    const shift = workOrderShift(wo);
    const shiftName = shift === 'M' ? 'morning' : shift === 'E' ? 'evening' : 'night';
    const fromStandard = usesStandardCrew(wo);
    const needed = Math.max(
      1,
      fromStandard ? getRequiredCrewCount(requirements, wo.line, wo.workType, shiftName) : wo.resourceRequired,
    );
    return { wo, lineId: lineCodeToId(lineCode), lineCode, date, y, m, d, shift, needed, fromStandard };
  });

  // Hand-picked crews claim their people first, then everything else by date.
  const order = [...prepared].sort(
    (a, b) =>
      Number(b.wo.crewMode === 'manual') - Number(a.wo.crewMode === 'manual') ||
      a.date.localeCompare(b.date),
  );

  for (const p of order) {
    const pool = poolOf(p.lineCode);
    const employees = poolPeople(pool);
    const base: Omit<LiveAllocation, 'onShift' | 'assignedIds' | 'assignedNames' | 'status' | 'droppedManual'> = {
      woId: p.wo.id, lineCode: p.lineCode, lineId: p.lineId, date: p.date, year: p.y, month: p.m, day: p.d,
      shift: p.shift, needed: p.needed, crewFromStandard: p.fromStandard, manual: p.wo.crewMode === 'manual',
    };

    if (!employees.length || !p.y || !p.m) {
      byWo[p.wo.id] = {
        ...base, onShift: 0, assignedIds: [], assignedNames: [], droppedManual: [], status: 'NO_ROSTER',
        reason: `No people set up for ${POOL_LINES[pool].label} — add them in People.`,
      };
      continue;
    }

    const onShift = poolOnShift(pool, p.y, p.m, p.d, p.shift);
    const free = onShift.filter((e) => !busy.has(`${e.id}|${p.date}|${p.shift}`));
    const freeIds = new Set(free.map((e) => e.id));

    const picked: Employee[] = [];
    const droppedManual: string[] = [];
    if (base.manual) {
      for (const id of p.wo.assignedEmployeeIds ?? []) {
        const emp = employees.find((e) => e.id === id);
        if (emp && freeIds.has(id)) picked.push(emp);
        else if (emp) droppedManual.push(emp.name);
      }
    }
    for (const e of free) {
      if (picked.length >= p.needed) break;
      if (!picked.includes(e)) picked.push(e);
    }
    const crew = picked.slice(0, p.needed);
    crew.forEach((e) => busy.add(`${e.id}|${p.date}|${p.shift}`));

    const label = SHIFT_LABEL[p.shift];
    let status: LiveStatus = 'OK';
    let reason: string | undefined;
    if (crew.length < p.needed) {
      status = crew.length > 0 ? 'SHORT' : 'UNASSIGNED';
      const others = onShift.length - free.length;
      reason =
        onShift.length === 0
          ? `Nobody on ${label} on this day (needs ${p.needed}).`
          : `Needs ${p.needed}, ${onShift.length} on ${label}${others ? ` (${others} already on other work orders)` : ''} — short ${p.needed - crew.length}.`;
    }
    if (droppedManual.length) {
      reason = `${droppedManual.join(', ')} no longer on ${label} this day.${reason ? ' ' + reason : ''}`;
    }

    byWo[p.wo.id] = {
      ...base, onShift: onShift.length, assignedIds: crew.map((e) => e.id), assignedNames: crew.map((e) => e.name),
      status, reason, droppedManual,
    };
  }

  // Per line + date + shift balances, for every date that has work orders.
  const keys = new Map<string, { pool: StaffPool; date: string; y: number; m: number; d: number }>();
  for (const p of prepared) {
    const pool = poolOf(p.lineCode);
    keys.set(`${pool}|${p.date}`, { pool, date: p.date, y: p.y, m: p.m, d: p.d });
  }

  const balances: ShiftDayBalance[] = [];
  for (const k of keys.values()) {

    for (const shift of SHIFT_FAMILIES) {
      const onDuty = k.y && k.m ? poolOnShift(k.pool, k.y, k.m, k.d, shift).length : 0;
      const day = prepared.filter((p) => poolOf(p.lineCode) === k.pool && p.date === k.date && p.shift === shift);
      const sum = (t: string) => day.filter((p) => normalizeWorkType(p.wo.workType) === t).reduce((s, p) => s + p.needed, 0);
      const demand = day.reduce((s, p) => s + p.needed, 0);
      balances.push({
        pool: k.pool, date: k.date, shift, onDuty, demand,
        pm: sum('PM'), cm: sum('CM'), acs: sum('ACS'), buffer: onDuty - demand, orders: day.length,
      });
    }
  }

  // Staffing conflicts only — unplaced rows are data problems, reported separately
  const conflicts = prepared.map((p) => byWo[p.wo.id]).filter((a) => a.status !== 'OK');
  return { byWo, balances, conflicts };
}

/** Allowed-window and reference-date checks for one work order (all ISO dates). */
export function windowCheck(wo: WorkOrder, todayIso: string) {
  const sched = tryParseDate(wo.scheduledStart);
  const snet = tryParseDate(wo.startNoEarlier);
  const fnlt = tryParseDate(wo.finishNoLater);
  const reported = tryParseDate(wo.reportedDate);
  const target = tryParseDate(wo.targetStart);
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  return {
    /** Scheduled Start falls before Start No Earlier Than or after Finish No Later Than. */
    outsideWindow: !!sched && ((!!snet && sched < snet) || (!!fnlt && sched > fnlt)),
    /** Finish No Later Than has already passed. */
    pastFinish: !!fnlt && fnlt < todayIso,
    /** Days since the work order was raised. */
    ageDays: reported ? days(reported, todayIso) : null,
    /** Scheduled Start minus Target Start (+ = later than target). */
    slipDays: sched && target ? days(target, sched) : null,
  };
}
