import { daysInMonth, isoDate, isWithin, monthKey, weekdayOf } from './calendar';
import { OFF, type Cell, type Employee, type LeaveBlock, type RosterMonth } from './types';

export interface GenerateInput {
  year: number;
  month: number;
  lineId: string;
  employees: Employee[];
  leaveBlocks?: LeaveBlock[];
  /** Hand edits to preserve: empId -> dayIndex -> code. */
  overrides?: Record<string, Record<number, string>>;
  /** Extra hours to carry over unchanged: empId -> dayIndex -> hours. */
  extraHours?: Record<string, Record<number, number>>;
  /** When false, a regenerate wipes hand edits and rebuilds purely from rules. */
  respectOverrides?: boolean;
  /** When false, leave blocks are ignored (used by "what-if" previews). */
  respectLeave?: boolean;
}

/**
 * Builds a complete month grid from each person's rules.
 *
 * This is the automation the client asked for: he supplies a shift, a rest-day
 * pair and any leave, and the 30-column grid falls out. Resolution is strictly
 * ordered and first-match-wins, so a value he set by hand is never silently
 * overwritten by a later regenerate.
 *
 *   1. manual override   — he dragged it, it stands
 *   2. leave block       — vacation / training status
 *   3. rest day          — this weekday is in his rest pair
 *   4. rotation rule     — a mid-month range covers this day
 *   5. default shift     — otherwise
 */
export function generateMonth(input: GenerateInput): RosterMonth {
  const {
    year,
    month,
    lineId,
    employees,
    leaveBlocks = [],
    overrides = {},
    extraHours = {},
    respectOverrides = true,
    respectLeave = true,
  } = input;

  const nDays = daysInMonth(year, month);
  const mKey = monthKey(year, month);
  const cells: Record<string, Cell[]> = {};

  // Index leave by employee once rather than scanning the list per cell.
  const leaveByEmployee = new Map<string, LeaveBlock[]>();
  if (respectLeave) {
    for (const block of leaveBlocks) {
      const list = leaveByEmployee.get(block.employeeId);
      if (list) list.push(block);
      else leaveByEmployee.set(block.employeeId, [block]);
    }
  }

  for (const employee of employees) {
    if (employee.active === false) continue;

    const row: Cell[] = new Array(nDays);
    const empOverrides = respectOverrides ? overrides[employee.id] : undefined;
    const rotations = employee.rotations?.[mKey] ?? [];
    const leaves = leaveByEmployee.get(employee.id) ?? [];

    for (let i = 0; i < nDays; i++) {
      const day = i + 1;

      const manual = empOverrides?.[i];
      if (manual !== undefined) {
        row[i] = { code: manual, source: 'manual' };
        continue;
      }

      const leave = leaves.find((b) => isWithin(isoDate(year, month, day), b.from, b.to));
      if (leave) {
        row[i] = { code: leave.code, source: 'leave' };
        continue;
      }

      if (employee.restDays.includes(weekdayOf(year, month, day))) {
        row[i] = { code: OFF, source: 'rest' };
        continue;
      }

      // Last rule wins so a later-added range can correct an earlier one.
      const rule = rotations.filter((r) => day >= r.fromDay && day <= r.toDay).at(-1);
      row[i] = rule
        ? { code: rule.code, source: 'rotation' }
        : { code: employee.defaultShift, source: 'default' };
    }

    cells[employee.id] = row;
  }

  return {
    id: rosterId(lineId, year, month),
    lineId,
    year,
    month,
    cells,
    overrides: respectOverrides ? overrides : {},
    extraHours: respectOverrides ? extraHours : {},
    updatedAt: Date.now(),
  };
}

export function rosterId(lineId: string, year: number, month: number): string {
  return `${lineId}:${monthKey(year, month)}`;
}

/** Applies a single hand edit, keeping `cells` and `overrides` in step. */
export function setCell(
  roster: RosterMonth,
  employeeId: string,
  dayIndex: number,
  code: string,
): RosterMonth {
  const row = roster.cells[employeeId];
  if (!row) return roster;

  const nextRow = row.slice();
  nextRow[dayIndex] = { code, source: 'manual' };

  return {
    ...roster,
    cells: { ...roster.cells, [employeeId]: nextRow },
    overrides: {
      ...roster.overrides,
      [employeeId]: { ...(roster.overrides[employeeId] ?? {}), [dayIndex]: code },
    },
    updatedAt: Date.now(),
  };
}

/** Records hours worked on top of a day's shift; 0 clears them. */
export function setExtraHours(
  roster: RosterMonth,
  employeeId: string,
  dayIndex: number,
  hours: number,
): RosterMonth {
  const row = { ...(roster.extraHours?.[employeeId] ?? {}) };
  if (hours > 0) row[dayIndex] = hours;
  else delete row[dayIndex];

  return {
    ...roster,
    extraHours: { ...(roster.extraHours ?? {}), [employeeId]: row },
    updatedAt: Date.now(),
  };
}

/** Paints a contiguous range in one pass — the drag gesture on the grid. */
export function setRange(
  roster: RosterMonth,
  employeeId: string,
  fromIndex: number,
  toIndex: number,
  code: string,
): RosterMonth {
  const row = roster.cells[employeeId];
  if (!row) return roster;

  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);

  const nextRow = row.slice();
  const nextOverrides = { ...(roster.overrides[employeeId] ?? {}) };
  for (let i = lo; i <= hi; i++) {
    nextRow[i] = { code, source: 'manual' };
    nextOverrides[i] = code;
  }

  return {
    ...roster,
    cells: { ...roster.cells, [employeeId]: nextRow },
    overrides: { ...roster.overrides, [employeeId]: nextOverrides },
    updatedAt: Date.now(),
  };
}

/** Drops a hand edit so the cell falls back to its generated value. */
export function clearOverride(
  roster: RosterMonth,
  employeeId: string,
  dayIndex: number,
  employees: Employee[],
  leaveBlocks: LeaveBlock[] = [],
): RosterMonth {
  const nextEmpOverrides = { ...(roster.overrides[employeeId] ?? {}) };
  delete nextEmpOverrides[dayIndex];

  const nextOverrides = { ...roster.overrides, [employeeId]: nextEmpOverrides };

  return generateMonth({
    year: roster.year,
    month: roster.month,
    lineId: roster.lineId,
    employees,
    leaveBlocks,
    overrides: nextOverrides,
  });
}

/**
 * Reads a person's rest-day pair back out of an existing grid.
 *
 * Used by the Excel importer: his sheets carry no rest-day column, but the
 * pattern of `-` cells reveals it. A weekday counts as a rest day when the
 * person is off on the clear majority of that weekday's occurrences, which
 * tolerates a leave block or a one-off swap landing on top of the pattern.
 */
export function inferRestDays(
  row: string[],
  year: number,
  month: number,
): import('./types').Weekday[] {
  const offCount = [0, 0, 0, 0, 0, 0, 0];
  const seen = [0, 0, 0, 0, 0, 0, 0];

  row.forEach((code, i) => {
    const w = weekdayOf(year, month, i + 1);
    seen[w]++;
    // A blank cell means the same thing as "-" in the client's sheets — some
    // rows mark rest days explicitly, others just leave them empty.
    if (code === OFF || code === '') offCount[w]++;
  });

  const rest: import('./types').Weekday[] = [];
  for (let w = 0; w < 7; w++) {
    if (seen[w] > 0 && offCount[w] / seen[w] > 0.5) rest.push(w as import('./types').Weekday);
  }
  return rest;
}

/**
 * Reads mid-month shift changes back out of an existing grid.
 *
 * Off days and status codes are skipped, so a rest-day gap in the middle of a
 * stretch doesn't split one rotation block into two.
 */
export function inferRotations(row: string[], workedCodes: Set<string>): import('./types').RotationRule[] {
  const rules: import('./types').RotationRule[] = [];
  let current: import('./types').RotationRule | null = null;

  row.forEach((code, i) => {
    if (!workedCodes.has(code)) return;
    const day = i + 1;
    if (current && current.code === code) {
      current.toDay = day;
    } else {
      current = { fromDay: day, toDay: day, code };
      rules.push(current);
    }
  });

  // A single block spanning the month is just the default shift, not a rotation.
  if (rules.length <= 1) return [];

  // Extend each block to butt against the next so rest days between blocks
  // inherit the right shift when the grid is regenerated.
  for (let i = 0; i < rules.length - 1; i++) {
    rules[i].toDay = rules[i + 1].fromDay - 1;
  }
  rules[0].fromDay = 1;
  rules[rules.length - 1].toDay = row.length;

  return rules;
}

/** The single most-used worked code in a row — the person's default shift. */
export function inferDefaultShift(row: string[], workedCodes: Set<string>, fallback: string): string {
  const tally = new Map<string, number>();
  for (const code of row) {
    if (!workedCodes.has(code)) continue;
    tally.set(code, (tally.get(code) ?? 0) + 1);
  }
  let best = fallback;
  let bestN = 0;
  for (const [code, n] of tally) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  return best;
}
