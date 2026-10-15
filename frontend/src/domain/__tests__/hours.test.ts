import { describe, expect, it } from 'vitest';

import { SEED_CODES } from '@/data/seed';
import { generateMonth, setCell, setExtraHours } from '@/domain/generator';
import { employeeHours, shiftHours } from '@/domain/hours';
import type { Employee, LeaveBlock, ShiftCode } from '@/domain/types';

// September 2026 starts on a Tuesday, so with a Fri/Sat rest pair the rest
// days are the 4th, 5th, 11th, 12th, 18th, 19th, 25th and 26th: 22 working days.
const EMP: Employee = {
  id: 'e1', lineId: 'line5', name: 'Test Person', contact: '', order: 1,
  defaultShift: 'M', restDays: [5, 6],
};
const code = (id: string) => SEED_CODES.find((c) => c.id === id) as ShiftCode;

function month(leave: LeaveBlock[] = []) {
  return generateMonth({ year: 2026, month: 9, lineId: 'line5', employees: [EMP], leaveBlocks: leave });
}
const hoursOf = (roster: ReturnType<typeof month>, standardHours = 9) =>
  employeeHours({ roster, employees: [EMP], codes: SEED_CODES, standardHours })[EMP.id];

describe('shiftHours', () => {
  it('reads hours from the timing, wrapping past midnight', () => {
    expect(shiftHours(code('M'))).toBe(9);
    expect(shiftHours(code('N'))).toBe(9); // 22:00 – 07:00
    expect(shiftHours(code('NL'))).toBe(12); // 19:00 – 07:00
    expect(shiftHours(code('ML'))).toBe(11);
  });

  it('gives leave nothing and an unreadable timing a standard day', () => {
    expect(shiftHours(code('LV'))).toBe(0);
    expect(shiftHours({ ...code('M'), timing: 'flexible' }, 8)).toBe(8);
  });
});

describe('employeeHours', () => {
  it('a normal 9-hour month has no overtime', () => {
    const h = hoursOf(month());
    expect(h.daysWorked).toBe(22);
    expect(h.worked).toBe(198);
    expect(h.regular).toBe(198);
    expect(h.overtime).toBe(0);
  });

  it('extra hours on a working day are overtime', () => {
    const h = hoursOf(setExtraHours(month(), EMP.id, 0, 2));
    expect(h.worked).toBe(200);
    expect(h.extra).toBe(2);
    expect(h.overtime).toBe(2);
    expect(h.days[0]).toMatchObject({ worked: 11, regular: 9, overtime: 2, extraDuty: false });
  });

  it('a shift assigned on a rest day is an extra duty, all overtime', () => {
    const h = hoursOf(setCell(month(), EMP.id, 3, 'M')); // Friday the 4th
    expect(h.extraDutyDays).toBe(1);
    expect(h.overtime).toBe(9);
    expect(h.days[3]).toMatchObject({ worked: 9, regular: 0, overtime: 9, extraDuty: true });
  });

  it('ignores extra hours on a day off', () => {
    const h = hoursOf(setExtraHours(month(), EMP.id, 3, 4)); // Friday the 4th, a rest day
    expect(h.days[3]).toMatchObject({ worked: 0, overtime: 0 });
    expect(h.overtime).toBe(0);
    expect(h.extra).toBe(0);
  });

  it('extra hours on an extra-duty shift are overtime too', () => {
    const h = hoursOf(setExtraHours(setCell(month(), EMP.id, 3, 'M'), EMP.id, 3, 2));
    expect(h.days[3]).toMatchObject({ worked: 11, regular: 0, overtime: 11, extraDuty: true });
  });

  it('a shift longer than the standard day earns the difference', () => {
    const h = hoursOf(setCell(month(), EMP.id, 0, 'NL'));
    expect(h.days[0].overtime).toBe(3);
  });

  it('follows the standard-hours setting', () => {
    expect(hoursOf(month(), 8).overtime).toBe(22);
  });

  it('ignores extra hours on a leave day', () => {
    const leave = [{ id: 'l1', employeeId: EMP.id, from: '2026-09-01', to: '2026-09-01', code: 'LV' }];
    const h = hoursOf(setExtraHours(month(leave), EMP.id, 0, 3));
    expect(h.days[0]).toMatchObject({ worked: 0, overtime: 0 });
  });
});

describe('extra hours in the roster', () => {
  it('survive a regenerate, and a fresh rebuild clears them', () => {
    const edited = setExtraHours(month(), EMP.id, 5, 2);
    const base = { year: 2026, month: 9, lineId: 'line5', employees: [EMP], extraHours: edited.extraHours };
    expect(generateMonth(base).extraHours?.[EMP.id]?.[5]).toBe(2);
    expect(generateMonth({ ...base, respectOverrides: false }).extraHours).toEqual({});
  });

  it('setting 0 removes the entry', () => {
    const cleared = setExtraHours(setExtraHours(month(), EMP.id, 5, 2), EMP.id, 5, 0);
    expect(cleared.extraHours?.[EMP.id]).toEqual({});
  });
});
