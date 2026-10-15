import { buildColumns, daysInMonth } from './calendar';
import { shiftLoad } from './summary';
import type { Employee, RosterMonth, RotationRule, ShiftCode } from './types';

export const DEFAULT_LEADER_NAMES: string[] = [
  'Arif Ali khan',
  'Abdulrahman',
  'Waqas Tahir',
  'Abdul Saeed',
  'Ebora Alexis',
  'Raneem Almalki',
];

export function isLeaderEmployee(employee: Employee): boolean {
  if (employee.isLeader === true) return true;
  if (employee.isLeader === false) return false;
  const norm = employee.name.trim().toLowerCase();
  return DEFAULT_LEADER_NAMES.some((l) => l.toLowerCase() === norm);
}

export interface RotationHistory {
  /** empId -> shift code -> days worked, accumulated over past months. */
  load: Record<string, Record<string, number>>;
  monthsCounted: number;
}

export interface AutoRotateInput {
  year: number;
  month: number;
  employees: Employee[];
  codes: ShiftCode[];
  history: RotationHistory;
  /**
   * 0 = keep people where they are unless coverage forces a move,
   * 1 = rotate everyone every month.
   */
  aggressiveness?: number;
  /**
   * 'leaders_only': Only designated team leaders rotate; engineers keep their shift sequence.
   * 'all': Standard mode where all rotating employees rotate.
   * Defaults to 'all' for backward compatibility.
   */
  targetScope?: 'leaders_only' | 'all';
  /**
   * 'two_week_cycle': 2-week Night -> weekend off -> 2-week Evening -> Morning / repeat cycle.
   * 'monthly': standard monthly shift rotation.
   * Defaults to 'two_week_cycle'.
   */
  patternMode?: 'two_week_cycle' | 'monthly';
  /** Specific leader employee IDs to rotate (if undefined, all leaders on this line). */
  selectedLeaderIds?: string[];
}

export interface AutoRotateResult {
  /** empId -> the shift to use as their default next month. */
  assignments: Record<string, string>;
  /** empId -> specific mid-month rotation blocks (e.g. 2-week cycle). */
  rotationRules?: Record<string, RotationRule[]>;
  /** Human-readable account of what moved and why, shown in the modal. */
  notes: string[];
  /** Per-shift, the worst per-day staffing the plan produces. */
  worstCoverage: Record<string, number>;
  /** IDs of leaders rotated */
  leadersRotated?: string[];
  /** IDs of engineers kept fixed */
  engineersKeptFixed?: string[];
}

/**
 * Builds next month's shift allocation, balancing night-shift load.
 *
 * Deterministic by construction: the same inputs always produce the same
 * roster. That matters for a document supervisors sign off on — an approach
 * that produced a different answer each run would be unusable.
 *
 * Two phases:
 *   1. Rotate the pool one step around the shift cycle, heaviest night-debt
 *      first, so nobody sits on nights month after month.
 *   2. Repair coverage — while any shift falls below its minimum on any day,
 *      move the best-fitting person across from a shift with surplus.
 */
export function autoRotate(input: AutoRotateInput): AutoRotateResult {
  const {
    year,
    month,
    employees,
    codes,
    history,
    aggressiveness = 1,
    targetScope = 'all',
    patternMode = 'two_week_cycle',
    selectedLeaderIds,
  } = input;

  if (targetScope === 'leaders_only') {
    const assignments: Record<string, string> = {};
    const rotationRules: Record<string, RotationRule[]> = {};
    const notes: string[] = [];
    const nDays = daysInMonth(year, month);
    const columns = buildColumns(year, month);

    const leaders = employees.filter((e) => {
      if (e.active === false) return false;
      if (selectedLeaderIds && selectedLeaderIds.length > 0) {
        return selectedLeaderIds.includes(e.id);
      }
      return isLeaderEmployee(e);
    });

    const engineers = employees.filter((e) => !leaders.includes(e) && e.active !== false);

    // Keep engineers on their default shift
    for (const eng of engineers) {
      assignments[eng.id] = eng.defaultShift;
    }

    // Standard rotating shift codes
    const nightCode = codes.find((c) => c.tone === 'night' && c.rotates && !c.isStatus)?.id ?? 'N';
    const eveningCode = codes.find((c) => c.tone === 'evening' && c.rotates && !c.isStatus)?.id ?? 'E';
    const morningCode = codes.find((c) => c.tone === 'morning' && c.rotates && !c.isStatus)?.id ?? 'M';

    // The client's sequence: Night (2w) -> weekend off -> Evening (2w) -> Morning / repeat
    const phases = [
      { first: nightCode, second: eveningCode },
      { first: eveningCode, second: morningCode },
      { first: morningCode, second: nightCode },
    ];

    const leadersRotated: string[] = [];
    leaders.forEach((leader, idx) => {
      leadersRotated.push(leader.id);
      if (patternMode === 'monthly') {
        const cycle = [nightCode, eveningCode, morningCode];
        const at = cycle.indexOf(leader.defaultShift);
        const nextCode = at >= 0 ? cycle[(at + 1) % cycle.length] : cycle[idx % cycle.length];
        assignments[leader.id] = nextCode;
        rotationRules[leader.id] = [{ fromDay: 1, toDay: nDays, code: nextCode }];
      } else {
        // 2-week cycle sequence
        const phase = phases[idx % phases.length];
        assignments[leader.id] = phase.first;
        rotationRules[leader.id] = [
          { fromDay: 1, toDay: 14, code: phase.first },
          { fromDay: 15, toDay: nDays, code: phase.second },
        ];
      }
    });

    // Calculate daily worstCoverage
    const worstCoverage: Record<string, number> = {};
    const rotatingCodes = codes.filter((c) => c.rotates && !c.isStatus).map((c) => c.id);

    for (const code of rotatingCodes) {
      let worst = Infinity;
      for (let d = 0; d < nDays; d++) {
        const weekday = columns[d].weekday;
        let count = 0;
        for (const e of employees) {
          if (e.active === false) continue;
          if (e.restDays.includes(weekday)) continue; // Rest day

          let shiftOnDay = assignments[e.id] ?? e.defaultShift;
          const rules = rotationRules[e.id];
          if (rules) {
            const dayNum = d + 1;
            const r = rules.find((rule) => dayNum >= rule.fromDay && dayNum <= rule.toDay);
            if (r) shiftOnDay = r.code;
          }
          if (shiftOnDay === code) count++;
        }
        worst = Math.min(worst, count);
      }
      worstCoverage[code] = worst === Infinity ? 0 : worst;
    }

    if (patternMode === 'two_week_cycle') {
      notes.push(
        `Applied 2-week cycle for ${leaders.length} Team Leaders: 2 weeks Night → Weekend off → 2 weeks Evening / Morning.`,
      );
    } else {
      notes.push(`Applied monthly rotation for ${leaders.length} Team Leaders.`);
    }
    notes.push(
      `${engineers.length} Engineers kept on their regular shift sequence throughout the month.`,
    );

    return {
      assignments,
      rotationRules,
      notes,
      worstCoverage,
      leadersRotated,
      engineersKeptFixed: engineers.map((e) => e.id),
    };
  }

  const cycle = codes
    .filter((c) => c.rotates && !c.isStatus)
    .sort((a, b) => a.order - b.order)
    .map((c) => c.id);

  const assignments: Record<string, string> = {};
  const notes: string[] = [];

  if (cycle.length < 2) {
    for (const e of employees) assignments[e.id] = e.defaultShift;
    notes.push('Fewer than two rotating shifts are configured — nothing to rotate.');
    return { assignments, notes, worstCoverage: {} };
  }

  const nightCodes = new Set(codes.filter((c) => c.tone === 'night').map((c) => c.id));

  // Fixed staff and anyone on a non-rotating code keep their shift.
  const pool: Employee[] = [];
  for (const e of employees) {
    if (e.active === false) continue;
    if (e.pinned || !cycle.includes(e.defaultShift)) {
      assignments[e.id] = e.defaultShift;
      continue;
    }
    pool.push(e);
  }

  // ---- Phase 1: rotate, heaviest night debt first -----------------------
  const debt = (id: string) => {
    const load = history.load[id] ?? {};
    let nights = 0;
    for (const [code, n] of Object.entries(load)) if (nightCodes.has(code)) nights += n;
    return nights;
  };

  const ordered = pool
    .slice()
    .sort((a, b) => debt(b.id) - debt(a.id) || a.order - b.order || a.id.localeCompare(b.id));

  // Move roughly `aggressiveness` of the pool; the heaviest-loaded move first.
  const movers = Math.round(ordered.length * clamp01(aggressiveness));

  ordered.forEach((e, rank) => {
    if (rank < movers) {
      const at = cycle.indexOf(e.defaultShift);
      assignments[e.id] = cycle[(at + 1) % cycle.length];
    } else {
      assignments[e.id] = e.defaultShift;
    }
  });

  const rotatedOffNights = ordered
    .slice(0, movers)
    .filter((e) => nightCodes.has(e.defaultShift) && !nightCodes.has(assignments[e.id]));
  if (rotatedOffNights.length) {
    notes.push(
      `Moved ${rotatedOffNights.length} off nights: ${rotatedOffNights.map((e) => e.name).join(', ')}.`,
    );
  }

  // ---- Phase 2: repair coverage ----------------------------------------
  const columns = buildColumns(year, month);
  const nDays = daysInMonth(year, month);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const minFor = new Map(codes.map((c) => [c.id, c.minHeadcount]));

  /** People on `code` who are not resting on day `d`. */
  const staffedOn = (code: string, dayIdx: number) =>
    pool.filter(
      (e) =>
        assignments[e.id] === code &&
        !e.restDays.includes(columns[dayIdx].weekday),
    ).length +
    employees.filter(
      (e) =>
        !pool.includes(e) &&
        assignments[e.id] === code &&
        e.active !== false &&
        !e.restDays.includes(columns[dayIdx].weekday),
    ).length;

  let repairs = 0;
  const MAX_REPAIRS = pool.length * cycle.length + 10;

  for (let guard = 0; guard < MAX_REPAIRS; guard++) {
    const gap = findWorstGap(cycle, nDays, staffedOn, minFor);
    if (!gap) break;

    const donor = pickDonor(pool, assignments, cycle, gap, columns, staffedOn, minFor, byId);
    if (!donor) break;

    const from = assignments[donor.id];
    assignments[donor.id] = gap.code;
    repairs++;
    notes.push(`Coverage: moved ${donor.name} from ${from} to ${gap.code} (day ${gap.dayIndex + 1} was short).`);
  }

  if (repairs === 0 && notes.length === 0) {
    notes.push('Rotation applied; every shift already meets its minimum on every day.');
  }

  const worstCoverage: Record<string, number> = {};
  for (const code of cycle) {
    let worst = Infinity;
    for (let d = 0; d < nDays; d++) worst = Math.min(worst, staffedOn(code, d));
    worstCoverage[code] = worst === Infinity ? 0 : worst;
  }

  return { assignments, notes, worstCoverage };
}

interface Gap {
  code: string;
  dayIndex: number;
  short: number;
}

function findWorstGap(
  cycle: string[],
  nDays: number,
  staffedOn: (code: string, d: number) => number,
  minFor: Map<string, number>,
): Gap | null {
  let worst: Gap | null = null;
  for (const code of cycle) {
    const min = minFor.get(code) ?? 0;
    if (min <= 0) continue;
    for (let d = 0; d < nDays; d++) {
      const short = min - staffedOn(code, d);
      if (short > 0 && (!worst || short > worst.short)) worst = { code, dayIndex: d, short };
    }
  }
  return worst;
}

/**
 * Picks who to move into a short shift.
 *
 * Only considers people whose current shift can spare them on that day, and
 * who actually work that day (moving someone who rests then fixes nothing).
 * Prefers the donor shift with the most slack, then the least-senior order —
 * ties break deterministically on id.
 */
function pickDonor(
  pool: Employee[],
  assignments: Record<string, string>,
  cycle: string[],
  gap: Gap,
  columns: ReturnType<typeof buildColumns>,
  staffedOn: (code: string, d: number) => number,
  minFor: Map<string, number>,
  _byId: Map<string, Employee>,
): Employee | null {
  const candidates = pool
    .filter((e) => {
      const from = assignments[e.id];
      if (from === gap.code) return false;
      if (!cycle.includes(from)) return false;
      // They must actually be on duty that day for the move to help.
      if (e.restDays.includes(columns[gap.dayIndex].weekday)) return false;
      // Don't rob a shift that is itself at its floor.
      const slack = staffedOn(from, gap.dayIndex) - (minFor.get(from) ?? 0);
      return slack > 0;
    })
    .sort((a, b) => {
      const slackA = staffedOn(assignments[a.id], gap.dayIndex) - (minFor.get(assignments[a.id]) ?? 0);
      const slackB = staffedOn(assignments[b.id], gap.dayIndex) - (minFor.get(assignments[b.id]) ?? 0);
      return slackB - slackA || a.order - b.order || a.id.localeCompare(b.id);
    });

  return candidates[0] ?? null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Rolls past months' rosters into the night-debt history the rotator reads. */
export function buildHistory(rosters: RosterMonth[]): RotationHistory {
  const load: Record<string, Record<string, number>> = {};
  for (const roster of rosters) {
    for (const [empId, tally] of Object.entries(shiftLoad(roster))) {
      const acc = (load[empId] ??= {});
      for (const [code, n] of Object.entries(tally)) acc[code] = (acc[code] ?? 0) + n;
    }
  }
  return { load, monthsCounted: rosters.length };
}

/**
 * Fairness readout for the Insights panel: nights worked per person, and how
 * far the group is from an even split.
 */
export function fairness(
  history: RotationHistory,
  employees: Employee[],
  codes: ShiftCode[],
): { rows: { employee: Employee; nights: number; total: number }[]; spread: number } {
  const nightCodes = new Set(codes.filter((c) => c.tone === 'night').map((c) => c.id));

  const rows = employees
    .filter((e) => e.active !== false && !e.pinned)
    .map((employee) => {
      const tally = history.load[employee.id] ?? {};
      let nights = 0;
      let total = 0;
      for (const [code, n] of Object.entries(tally)) {
        total += n;
        if (nightCodes.has(code)) nights += n;
      }
      return { employee, nights, total };
    })
    .sort((a, b) => b.nights - a.nights);

  const counts = rows.map((r) => r.nights);
  const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
  return { rows, spread };
}
