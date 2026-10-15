import { weekdayOf } from './calendar';
import { OFF, type Employee, type RosterMonth, type ShiftCode } from './types';

/**
 * Working hours and overtime.
 *
 * The client's rule: a standard day is 9 hours. Anything past that on a
 * working day is overtime, and a shift worked on a person's rest day (an
 * "extra duty") is overtime from the first hour, because it was never part of
 * their standard week.
 *
 *   working day   regular = min(shift + extra, standard)
 *                 OT      = max(0, shift + extra − standard)
 *   shift on a    regular = 0
 *   rest day      OT      = shift + extra
 *   off / leave   nothing counts — extra hours only apply to a worked shift;
 *                 to bring someone in on a day off, give them a shift
 */
export const DEFAULT_STANDARD_HOURS = 9;

const TIMING = /(\d{1,2})[:.](\d{2})\s*(?:hrs?)?\s*[–—\-to]+\s*(\d{1,2})[:.](\d{2})/i;

/**
 * Hours in one shift, read from its timing ("06:00 – 15:00" → 9). A shift
 * that crosses midnight wraps ("22:00 – 07:00" → 9). Status codes are 0; a
 * timing that cannot be read counts as a standard day.
 */
export function shiftHours(code: ShiftCode | undefined, standardHours = DEFAULT_STANDARD_HOURS): number {
  if (!code || code.isStatus) return 0;
  const m = code.timing?.match(TIMING);
  if (!m) return standardHours;
  const start = Number(m[1]) * 60 + Number(m[2]);
  let end = Number(m[3]) * 60 + Number(m[4]);
  if (end <= start) end += 24 * 60;
  return (end - start) / 60;
}

export interface DayHours {
  /** Shift hours plus any extra hours entered for the day. */
  worked: number;
  regular: number;
  overtime: number;
  /** A worked shift on the person's rest weekday. */
  extraDuty: boolean;
}

export interface EmployeeHours {
  worked: number;
  regular: number;
  overtime: number;
  /** Hours typed in by hand on top of shifts. */
  extra: number;
  /** Days worked (any non-off, non-status code). */
  daysWorked: number;
  /** Shifts worked on a rest day. */
  extraDutyDays: number;
  /** Per day, index 0 = the 1st. */
  days: DayHours[];
}

export interface HoursInput {
  roster: RosterMonth;
  employees: Employee[];
  codes: ShiftCode[];
  standardHours?: number;
}

/** Hours, extra hours and overtime for every person on the month. */
export function employeeHours({
  roster, employees, codes, standardHours = DEFAULT_STANDARD_HOURS,
}: HoursInput): Record<string, EmployeeHours> {
  const byId = new Map(codes.map((c) => [c.id, c]));
  const out: Record<string, EmployeeHours> = {};

  for (const employee of employees) {
    const row = roster.cells[employee.id];
    if (!row) continue;
    const extras = roster.extraHours?.[employee.id] ?? {};
    const total: EmployeeHours = {
      worked: 0, regular: 0, overtime: 0, extra: 0, daysWorked: 0, extraDutyDays: 0, days: [],
    };

    for (let i = 0; i < row.length; i++) {
      const code = row[i]?.code ?? OFF;
      const def = byId.get(code);
      const onLeave = !!def?.isStatus;
      const isWorked = code !== OFF && !onLeave;
      const extra = isWorked ? Math.max(0, extras[i] ?? 0) : 0;
      const base = isWorked ? shiftHours(def, standardHours) : 0;
      const worked = base + extra;

      const restDay = employee.restDays.includes(weekdayOf(roster.year, roster.month, i + 1));
      const extraDuty = isWorked && restDay;

      let regular: number;
      let overtime: number;
      if (extraDuty) {
        regular = 0;
        overtime = worked;
      } else {
        regular = Math.min(worked, standardHours);
        overtime = Math.max(0, worked - standardHours);
      }

      total.days.push({ worked, regular, overtime, extraDuty });
      total.worked += worked;
      total.regular += regular;
      total.overtime += overtime;
      total.extra += extra;
      if (isWorked) total.daysWorked++;
      if (extraDuty) total.extraDutyDays++;
    }

    out[employee.id] = total;
  }
  return out;
}

/** "9", "10.5" — hours without trailing zeros. */
export function formatHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, '');
}
