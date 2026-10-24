import { afterAll, describe, expect, it } from 'vitest';

import type { Employee, RosterMonth, ShiftCode, WorkOrder } from '@/domain/types';
import { setKnownLines } from '@/domain/workload';
import { POOL_LINES, computeWorkload, poolOfLineId } from '@/domain/workloadLive';

/** A database set up by hand gets generated line ids, not line4/line5/line6. */
const L46 = 'line-mvkz6oia-ra4ec';
const L5 = 'line-mvkz6hrv-voke0';

describe('work orders find the planner people when the line ids are generated', () => {
  setKnownLines([{ id: L5, name: 'Line 5 ' }, { id: L46, name: 'Line 4 & 6' }]);
  afterAll(() => setKnownLines([]));

  const code = (id: string, tone: ShiftCode['tone']) => ({ id, tone, label: id }) as ShiftCode;
  const codes = [code('M', 'morning'), code('E', 'evening'), code('N', 'night')];
  const emp = (id: string, lineId: string) => ({ id, name: id, lineId, active: true }) as Employee;
  const cells = (c: string) => ({ code: c, source: 'default' as const });
  const roster = (lineId: string, who: Record<string, string>): RosterMonth =>
    ({ id: `${lineId}:2026-11`, lineId, year: 2026, month: 11, overrides: {}, cells: Object.fromEntries(Object.entries(who).map(([k, v]) => [k, Array(30).fill(cells(v))])) }) as RosterMonth;
  const wo = (id: string, line: string, desc = 'FAULT repair'): WorkOrder =>
    ({ id, workOrderId: id, description: desc, workType: 'CM', line, scheduledStart: '2026-11-01', scheduledFinish: '2026-11-01', status: '', resourceRequired: 2, crewSource: 'file' }) as WorkOrder;

  const run = (workOrders: WorkOrder[]) =>
    computeWorkload({
      workOrders,
      getRoster: (id) => (id === L46 ? roster(L46, { a: 'E', b: 'E', c: 'N' }) : id === L5 ? roster(L5, { x: 'E' }) : null),
      employeesByLine: { [L46]: [emp('a', L46), emp('b', L46), emp('c', L46)], [L5]: [emp('x', L5)] },
      codesByLine: { [L46]: codes, [L5]: codes },
      requirements: [],
    });

  it('puts a Line 4&6 line in the Line 4&6 pool and a Line 5 line in the Line 5 pool', () => {
    expect(poolOfLineId(L46)).toBe('L4_L6');
    expect(poolOfLineId(L5)).toBe('L5');
    expect(POOL_LINES.L4_L6.ids[0]).toBe(L46);
    expect(POOL_LINES.L5.ids[0]).toBe(L5);
  });

  it('staffs a Line 4 and a Line 6 work order from the shared Line 4&6 team', () => {
    const r = run([wo('w4', 'L4'), wo('w6', 'L6')]);
    expect(r.byWo.w4.status).not.toBe('NO_ROSTER');
    expect(r.byWo.w4.onShift).toBe(2); // the two people on Evening
    expect(r.byWo.w4.status).toBe('OK');
    expect(r.byWo.w6.status).toBe('UNASSIGNED'); // both already taken by w4 the same day
  });

  it('keeps Line 5 work orders on the Line 5 team', () => {
    const r = run([wo('w5', 'L5')]);
    expect(r.byWo.w5.onShift).toBe(1);
    expect(r.byWo.w5.status).toBe('SHORT');
    expect(r.byWo.w5.lineId).toBe(L5);
  });
});
