import { describe, expect, it } from 'vitest';

import type { Employee, RosterMonth, ShiftCode, WorkOrder } from '../types';
import { computeWorkload } from '../workloadLive';

const emp = (id: string): Employee => ({ id, name: id.toUpperCase(), lineId: 'line5', active: true }) as Employee;
const code = (id: string, tone: ShiftCode['tone']): ShiftCode => ({ id, tone, scope: 'line5' }) as ShiftCode;
const CODES = [code('M', 'morning'), code('ML', 'morning'), code('E', 'evening'), code('N', 'night'), code('GS', 'general'), code('LV', 'leave')];

/** 30-day November roster; `rows` maps person → code every day, `edits` sets single days. */
function roster(rows: Record<string, string>, edits: Record<string, Record<number, string>> = {}): RosterMonth {
  const cells: RosterMonth['cells'] = {};
  for (const [id, c] of Object.entries(rows)) {
    cells[id] = Array.from({ length: 30 }, (_, i) => ({ code: edits[id]?.[i + 1] ?? c })) as RosterMonth['cells'][string];
  }
  return { id: 'line5:2026-11', lineId: 'line5', year: 2026, month: 11, cells, overrides: {} } as RosterMonth;
}

const wo = (id: string, date: string, shift: 'M' | 'E' | 'N', n: number, extra: Partial<WorkOrder> = {}): WorkOrder =>
  ({ id, workOrderId: id, description: id, workType: 'PM', line: 'L5', scheduledStart: date, scheduledFinish: date, status: 'APPR', resourceRequired: n, plannedShift: shift, ...extra }) as WorkOrder;

const people = ['a', 'b', 'c', 'd', 'e', 'f'].map(emp);
const base = { a: 'M', b: 'M', c: 'E', d: 'E', e: 'N', f: 'N' };

function run(r: RosterMonth, orders: WorkOrder[], employees = people) {
  return computeWorkload({
    workOrders: orders,
    getRoster: (lineId, y, m) => (lineId === 'line5' && y === 2026 && m === 11 ? r : null),
    employeesByLine: { line5: employees },
    codesByLine: { line5: CODES },
    requirements: [],
  });
}
const morningOn = (res: ReturnType<typeof run>, date: string) =>
  res.balances.find((b) => b.date === date && b.shift === 'M')!;

describe('live Planner → Work Orders link', () => {
  it('Morning card is the real day: 2 on duty vs 3 needed = −1, and the order is short', () => {
    const res = run(roster(base), [wo('w1', '2026-11-05', 'M', 3)]);
    expect(morningOn(res, '2026-11-05')).toMatchObject({ onDuty: 2, demand: 3, buffer: -1 });
    expect(res.byWo.w1).toMatchObject({ status: 'SHORT', assignedNames: ['A', 'B'] });
    expect(res.conflicts).toHaveLength(1);
  });

  it('putting a 3rd person on Morning that day in the Planner clears the deficit', () => {
    const res = run(roster(base, { c: { 5: 'M' } }), [wo('w1', '2026-11-05', 'M', 3)]);
    expect(morningOn(res, '2026-11-05')).toMatchObject({ onDuty: 3, demand: 3, buffer: 0 });
    expect(res.byWo.w1.status).toBe('OK');
    expect(res.conflicts).toHaveLength(0);
  });

  it('Morning-family codes (ML) count as Morning; General Shift does not', () => {
    expect(run(roster(base, { c: { 5: 'ML' } }), [wo('w1', '2026-11-05', 'M', 3)]).byWo.w1.status).toBe('OK');
    expect(run(roster(base, { c: { 5: 'GS' } }), [wo('w1', '2026-11-05', 'M', 3)]).byWo.w1.status).toBe('SHORT');
  });

  it('putting someone on leave that day takes them off the shift', () => {
    const res = run(roster(base, { a: { 5: 'LV' } }), [wo('w1', '2026-11-05', 'M', 2)]);
    expect(res.byWo.w1).toMatchObject({ status: 'SHORT', assignedNames: ['B'] });
  });

  it('demand adds up across orders on the same shift, with no double-booking', () => {
    const res = run(roster(base), [wo('w1', '2026-11-05', 'M', 1), wo('w2', '2026-11-05', 'M', 2, { workType: 'CM' })]);
    expect(morningOn(res, '2026-11-05')).toMatchObject({ onDuty: 2, demand: 3, pm: 1, cm: 2, buffer: -1 });
    expect(res.byWo.w1.assignedNames).toEqual(['A']);
    expect(res.byWo.w2).toMatchObject({ status: 'SHORT', assignedNames: ['B'] });
  });

  it('no work orders → no demand, no invented numbers', () => {
    const res = run(roster(base), []);
    expect(res.balances).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });

  it('a work order is checked against its own month, never another month', () => {
    const nov = roster(base);
    const sep = { ...roster({ a: '-', b: '-', c: 'E', d: 'E', e: 'N', f: 'N' }), id: 'line5:2026-09', month: 9 };
    const res = computeWorkload({
      workOrders: [wo('sep', '2026-09-05', 'M', 1)],
      getRoster: (_l, _y, m) => (m === 9 ? sep : m === 11 ? nov : null),
      employeesByLine: { line5: people },
      codesByLine: { line5: CODES },
      requirements: [],
    });
    // Nobody is on Morning on 5 September — 5 November's Morning staff must not be borrowed.
    expect(res.byWo.sep).toMatchObject({ status: 'UNASSIGNED', month: 9, onShift: 0 });
  });

  it('a line with no people is reported as NO_ROSTER, not as a staff deficit', () => {
    const res = run(roster(base), [wo('w1', '2026-11-05', 'M', 1)], []);
    expect(res.byWo.w1.status).toBe('NO_ROSTER');
  });

  it('a hand-picked crew is kept, and replaced automatically if moved off the shift', () => {
    const manual = wo('w1', '2026-11-05', 'M', 1, { crewMode: 'manual', assignedEmployeeIds: ['b'] });
    expect(run(roster(base), [manual]).byWo.w1.assignedNames).toEqual(['B']);

    const moved = run(roster(base, { b: { 5: 'E' } }), [manual]).byWo.w1;
    expect(moved).toMatchObject({ status: 'OK', assignedNames: ['A'], droppedManual: ['B'] });
  });

  describe('Setup → Work Order Resource Standards', () => {
    const std = (n: number) => [{ id: 'r', line: 'L5', workType: 'PM', shift: 'morning' as const, defaultPeopleCount: n }];
    const runStd = (orders: WorkOrder[], n: number) =>
      computeWorkload({
        workOrders: orders,
        getRoster: () => roster(base),
        employeesByLine: { line5: people },
        codesByLine: { line5: CODES },
        requirements: std(n),
      });

    it('a row with no crew in the file uses the standard, and editing the standard changes demand', () => {
      const order = wo('w1', '2026-11-05', 'M', 0, { crewSource: 'standard' });
      expect(runStd([order], 1).byWo.w1).toMatchObject({ needed: 1, status: 'OK', crewFromStandard: true });
      const three = runStd([order], 3);
      expect(three.byWo.w1).toMatchObject({ needed: 3, status: 'SHORT' });
      expect(three.balances.find((b) => b.shift === 'M')).toMatchObject({ demand: 3, buffer: -1 });
    });

    it('a crew size from the file or set by hand ignores the standard', () => {
      expect(runStd([wo('f', '2026-11-05', 'M', 1, { crewSource: 'file' })], 5).byWo.f.needed).toBe(1);
      expect(runStd([wo('m', '2026-11-05', 'M', 2, { crewSource: 'manual' })], 5).byWo.m.needed).toBe(2);
    });

    it('older records: the old built-in default (PM 2) follows the standard, other numbers are kept', () => {
      expect(runStd([wo('old', '2026-11-05', 'M', 2)], 4).byWo.old.needed).toBe(4);
      expect(runStd([wo('old3', '2026-11-05', 'M', 3)], 4).byWo.old3.needed).toBe(3);
    });
  });

  describe('Line 4 & 6 are one shared team', () => {
    const l4 = (id: string) => ({ id, name: id.toUpperCase(), lineId: 'line4', active: true }) as Employee;
    const team = ['p', 'q', 'r'].map(l4); // the whole team is entered under Line 4
    const r46 = { ...roster({ p: 'M', q: 'M', r: 'N' }), lineId: 'line4' } as RosterMonth;
    const run46 = (orders: WorkOrder[]) =>
      computeWorkload({
        workOrders: orders,
        getRoster: (lineId) => (lineId === 'line4' ? r46 : null),
        employeesByLine: { line4: team, line6: [] },
        codesByLine: { line4: CODES, line6: CODES },
        requirements: [],
      });

    it('a Line 6 work order is staffed by the Line 4 people', () => {
      const res = run46([wo('six', '2026-11-05', 'M', 1, { line: 'L6' })]);
      expect(res.byWo.six).toMatchObject({ status: 'OK', assignedNames: ['P'] });
    });

    it('Line 4 and Line 6 orders on the same shift share the people — nobody is booked twice', () => {
      const res = run46([wo('four', '2026-11-05', 'M', 1, { line: 'L4' }), wo('six', '2026-11-05', 'M', 3, { line: 'L6' })]);
      expect(res.byWo.four.assignedNames).toEqual(['P']);
      expect(res.byWo.six).toMatchObject({ status: 'SHORT', assignedNames: ['Q'] });
    });

    it('one pooled card per day: 2 on Morning vs 1 + 3 needed = −2 (not counted twice)', () => {
      const res = run46([wo('four', '2026-11-05', 'M', 1, { line: 'L4' }), wo('six', '2026-11-05', 'M', 3, { line: 'L6' })]);
      const cards = res.balances.filter((b) => b.shift === 'M');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ pool: 'L4_L6', onDuty: 2, demand: 4, buffer: -2 });
    });

    it('Line 6 uses the shared Line 4 & 6 standard', () => {
      const res = computeWorkload({
        workOrders: [wo('six', '2026-11-05', 'M', 0, { line: 'L6', crewSource: 'standard' })],
        getRoster: (lineId) => (lineId === 'line4' ? r46 : null),
        employeesByLine: { line4: team },
        codesByLine: { line4: CODES },
        requirements: [{ id: 'r', line: 'L4', workType: 'PM', shift: 'morning', defaultPeopleCount: 2 }],
      });
      expect(res.byWo.six.needed).toBe(2);
    });
  });
});
