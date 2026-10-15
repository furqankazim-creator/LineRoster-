/**
 * End-to-end over the real pieces the app uses: seeded people & shift codes,
 * the Planner's month generator and its paint-cell function, and the live
 * Work Orders engine. Proves that a Planner edit moves the Work Orders numbers.
 */
import { describe, expect, it } from 'vitest';

import { SEED_CODES, SEED_EMPLOYEES, SEED_LEAVE } from '../../data/seed';
import { generateMonth, setCell } from '../generator';
import type { RosterMonth, ShiftCode, WorkOrder } from '../types';
import { computeWorkload, staffOnShift } from '../workloadLive';

const LINE = 'line5';
const people = SEED_EMPLOYEES.filter((e) => e.lineId === LINE && e.active !== false);
const codes = SEED_CODES.map((c) => ({ ...c, scope: LINE })) as ShiftCode[];
const nov = generateMonth({ year: 2026, month: 11, lineId: LINE, employees: people, leaveBlocks: SEED_LEAVE });

const run = (roster: RosterMonth, orders: WorkOrder[]) =>
  computeWorkload({
    workOrders: orders,
    getRoster: (l, y, m) => (l === LINE && y === 2026 && m === 11 ? roster : null),
    employeesByLine: { [LINE]: people },
    codesByLine: { [LINE]: codes },
    requirements: [],
  });

describe('Planner edit → Work Orders (seeded Line 5, November 2026)', () => {
  const day = 16;
  const morning = staffOnShift(nov, people, codes, day, 'M');
  const need = morning.length + 1; // one more than the roster has → guaranteed deficit
  const order = {
    id: 'wo1', workOrderId: '13445509', description: 'PM', workType: 'PM', line: 'L5',
    scheduledStart: '2026-11-16', scheduledFinish: '2026-11-16', status: 'APPR', resourceRequired: need, plannedShift: 'M',
  } as WorkOrder;

  it('before: Morning card = people on Morning that day vs the order crew, deficit −1', () => {
    const res = run(nov, [order]);
    const card = res.balances.find((b) => b.date === '2026-11-16' && b.shift === 'M')!;
    expect(card).toMatchObject({ onDuty: morning.length, demand: need, buffer: -1 });
    expect(res.conflicts.map((c) => c.woId)).toEqual(['wo1']);
  });

  it('after painting one more person onto M that day: card buffer 0, deficit gone', () => {
    const someoneElse = people.find((e) => !morning.some((m) => m.id === e.id))!;
    const edited = setCell(nov, someoneElse.id, day - 1, 'M');
    const res = run(edited, [order]);
    const card = res.balances.find((b) => b.date === '2026-11-16' && b.shift === 'M')!;
    expect(card).toMatchObject({ onDuty: morning.length + 1, demand: need, buffer: 0 });
    expect(res.byWo.wo1.status).toBe('OK');
    expect(res.conflicts).toEqual([]);
  });

  it('painting a Morning person to rest makes the deficit bigger', () => {
    const edited = setCell(nov, morning[0].id, day - 1, '-');
    const card = run(edited, [order]).balances.find((b) => b.date === '2026-11-16' && b.shift === 'M')!;
    expect(card).toMatchObject({ onDuty: morning.length - 1, buffer: -2 });
  });
});
