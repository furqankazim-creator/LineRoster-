import { isoDate, isWithin, weekdayOf } from './calendar';
import { summarise } from './summary';
import {
  OFF,
  type Employee,
  type Issue,
  type LeaveBlock,
  type RosterMonth,
  type ShiftCode,
} from './types';

export interface ValidateInput {
  roster: RosterMonth;
  employees: Employee[];
  codes: ShiftCode[];
  leaveBlocks?: LeaveBlock[];
  nDays: number;
  /** Consecutive worked days before a warning fires. */
  maxConsecutive?: number;
}

/**
 * Every rule the planner enforces, run on each edit.
 *
 * Errors are things that make the roster wrong (a shift nobody is covering, an
 * illegal night-to-morning turnaround). Warnings are things worth a second
 * look but legitimately overridable.
 */
export function validate(input: ValidateInput): Issue[] {
  const { roster, employees, codes, leaveBlocks = [], nDays, maxConsecutive = 6 } = input;

  const issues: Issue[] = [];
  const byId = new Map(employees.map((e) => [e.id, e]));
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const workedCodes = codes.filter((c) => !c.isStatus);
  const nightCodes = new Set(codes.filter((c) => c.tone === 'night').map((c) => c.id));
  const morningCodes = new Set(codes.filter((c) => c.tone === 'morning').map((c) => c.id));

  // ---- Coverage: per day, per shift ------------------------------------
  const days = summarise(roster, codes, nDays);
  for (let i = 0; i < nDays; i++) {
    for (const code of workedCodes) {
      const staffed = days[i].total[code.id] ?? 0;
      if (code.minHeadcount <= 0) continue;

      if (staffed === 0) {
        issues.push({
          id: `empty:${code.id}:${i}`,
          severity: 'error',
          rule: 'empty-shift',
          message: `Day ${i + 1}: nobody is on ${code.label}.`,
          dayIndex: i,
          shiftCode: code.id,
        });
      } else if (staffed < code.minHeadcount) {
        issues.push({
          id: `min:${code.id}:${i}`,
          severity: 'error',
          rule: 'below-minimum',
          message: `Day ${i + 1}: ${code.label} has ${staffed}, needs ${code.minHeadcount}.`,
          dayIndex: i,
          shiftCode: code.id,
        });
      }
    }
  }

  // ---- Per-person rules -------------------------------------------------
  for (const [empId, row] of Object.entries(roster.cells)) {
    const employee = byId.get(empId);
    if (!employee) continue;

    let consecutive = 0;

    for (let i = 0; i < nDays; i++) {
      const cell = row[i];
      if (!cell) continue;
      const code = codeById.get(cell.code);
      const isWorking = cell.code !== OFF && !code?.isStatus;

      // Night → Morning the next day is an illegal turnaround: a 22:00–07:00
      // shift ending at 07:00 cannot be followed by one starting at 06:00.
      if (isWorking && i > 0) {
        const prev = row[i - 1]?.code;
        if (prev && nightCodes.has(prev) && morningCodes.has(cell.code)) {
          issues.push({
            id: `turnaround:${empId}:${i}`,
            severity: 'error',
            rule: 'night-to-morning',
            message: `${employee.name}: night on day ${i} then morning on day ${i + 1} — no rest gap.`,
            employeeId: empId,
            dayIndex: i,
          });
        }
      }

      // Assigned a shift during a declared leave block.
      if (isWorking) {
        const date = isoDate(roster.year, roster.month, i + 1);
        const clash = leaveBlocks.find(
          (b) => b.employeeId === empId && isWithin(date, b.from, b.to),
        );
        if (clash) {
          issues.push({
            id: `leave:${empId}:${i}`,
            severity: 'error',
            rule: 'working-while-on-leave',
            message: `${employee.name} is on leave on day ${i + 1} but rostered ${cell.code}.`,
            employeeId: empId,
            dayIndex: i,
          });
        }
      }

      // Rest-day pair not honoured.
      if (isWorking && employee.restDays.includes(weekdayOf(roster.year, roster.month, i + 1))) {
        issues.push({
          id: `rest:${empId}:${i}`,
          severity: 'warning',
          rule: 'rest-days-violated',
          message: `${employee.name} is working day ${i + 1}, one of their rest days.`,
          employeeId: empId,
          dayIndex: i,
        });
      }

      // Consecutive-days run.
      if (isWorking) {
        consecutive++;
        if (consecutive === maxConsecutive + 1) {
          issues.push({
            id: `streak:${empId}:${i}`,
            severity: 'warning',
            rule: 'too-many-consecutive',
            message: `${employee.name} works ${maxConsecutive + 1}+ days straight ending day ${i + 1}.`,
            employeeId: empId,
            dayIndex: i,
          });
        }
      } else {
        consecutive = 0;
      }
    }
  }

  return issues;
}

export function countBySeverity(issues: Issue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) (i.severity === 'error' ? errors++ : warnings++);
  return { errors, warnings };
}

/**
 * Who could cover a gap on a given day.
 *
 * Suggests people who are off that day, aren't on leave, and wouldn't break
 * the night-to-morning rule by being pulled in — ranked by who has the
 * lightest month so far, so cover lands on the least-loaded person.
 */
export function suggestCover(
  roster: RosterMonth,
  employees: Employee[],
  codes: ShiftCode[],
  dayIndex: number,
  shiftCode: string,
  leaveBlocks: LeaveBlock[] = [],
): Employee[] {
  const nightCodes = new Set(codes.filter((c) => c.tone === 'night').map((c) => c.id));
  const target = codes.find((c) => c.id === shiftCode);
  const date = isoDate(roster.year, roster.month, dayIndex + 1);

  const workload = new Map<string, number>();
  for (const [empId, row] of Object.entries(roster.cells)) {
    workload.set(empId, row.filter((c) => c && c.code !== OFF).length);
  }

  return employees
    .filter((e) => {
      const row = roster.cells[e.id];
      if (!row) return false;
      if (row[dayIndex]?.code !== OFF) return false;
      if (leaveBlocks.some((b) => b.employeeId === e.id && isWithin(date, b.from, b.to))) return false;
      // Don't create the very turnaround the validator would flag.
      const prev = row[dayIndex - 1]?.code;
      if (target?.tone === 'morning' && prev && nightCodes.has(prev)) return false;
      return true;
    })
    .sort((a, b) => (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0))
    .slice(0, 5);
}
