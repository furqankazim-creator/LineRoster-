import { describe, expect, it } from 'vitest';

import { generateMonth } from '@/domain/generator';
import { OFF, type Employee, type RosterMonth, type ShiftCode } from '@/domain/types';
import { validate } from '@/domain/validate';

/**
 * Which codes a sheet offers on its brush.
 *
 * Mirrors the rule in the store: a month works with the codes that appear in
 * its own grid, plus any scoped to it. Two imported sheets with different
 * shift patterns must not show each other's codes.
 */
function brushFor(roster: RosterMonth, all: ShiftCode[]): string[] {
  const used = new Set<string>();
  for (const row of Object.values(roster.cells)) {
    for (const cell of row) if (cell.code && cell.code !== OFF) used.add(cell.code);
  }
  return all
    .filter((c) => c.scope === roster.id || (!c.scope && used.has(c.id)))
    .map((c) => c.id)
    .sort();
}

const code = (id: string, over: Partial<ShiftCode> = {}): ShiftCode => ({
  id, label: id, timing: '', tone: 'general', minHeadcount: 0,
  countsAsEngineer: true, rotates: false, order: 1, ...over,
});

const ALL: ShiftCode[] = [
  code('M', { label: 'Morning', tone: 'morning', minHeadcount: 2, rotates: true }),
  code('E', { label: 'Evening', tone: 'evening', minHeadcount: 2, rotates: true }),
  code('N', { label: 'Night', tone: 'night', minHeadcount: 2, rotates: true }),
  code('ML', { label: 'Morning Late', tone: 'morning' }),
  code('NL', { label: 'Night Late', tone: 'night' }),
  code('GS', { label: 'General Shift' }),
];

const person = (id: string, shift: string): Employee => ({
  id, lineId: 'l', name: id, contact: '', order: 1, defaultShift: shift, restDays: [5, 6],
});

/** A Morning/Night-only sheet, like the client's TGT line. */
const morningNight = generateMonth({
  year: 2026, month: 9, lineId: 'tgt', leaveBlocks: [], overrides: {},
  employees: [person('a', 'M'), person('b', 'ML'), person('c', 'N'), person('d', 'NL')],
});

/** A sheet that runs all three shifts, like Line 4. */
const threeShift = generateMonth({
  year: 2026, month: 9, lineId: 'line4', leaveBlocks: [], overrides: {},
  employees: [person('w', 'M'), person('x', 'E'), person('y', 'N'), person('z', 'GS')],
});

describe('the brush lists only the codes a sheet uses', () => {
  it('shows a Morning/Night sheet no Evening or General', () => {
    expect(brushFor(morningNight, ALL)).toEqual(['M', 'ML', 'N', 'NL']);
  });

  it('shows a three-shift sheet its own set', () => {
    expect(brushFor(threeShift, ALL)).toEqual(['E', 'GS', 'M', 'N']);
  });

  it('keeps a code invented by one import off the other sheet', () => {
    const withJaafar = [...ALL, code('JAAFAR', { scope: morningNight.id })];
    expect(brushFor(morningNight, withJaafar)).toContain('JAAFAR');
    expect(brushFor(threeShift, withJaafar)).not.toContain('JAAFAR');
  });
});

describe('minimums only apply to codes the sheet works with', () => {
  const employees = [person('a', 'M'), person('b', 'ML'), person('c', 'N'), person('d', 'NL')];

  it('does not report "nobody is on Evening" on a Morning/Night sheet', () => {
    const visible = ALL.filter((c) => brushFor(morningNight, ALL).includes(c.id));
    const issues = validate({ roster: morningNight, employees, codes: visible, nDays: 30 });
    expect(issues.filter((i) => /evening/i.test(i.message))).toEqual([]);
  });

  it('still reports a genuine shortfall on a shift the sheet does use', () => {
    const visible = ALL.filter((c) => brushFor(morningNight, ALL).includes(c.id));
    const issues = validate({ roster: morningNight, employees, codes: visible, nDays: 30 });
    // Only one person is on plain Morning, but it needs 2 — that must still fire.
    expect(issues.some((i) => /^Day \d+: Morning has 1, needs 2\.$/.test(i.message))).toBe(true);
  });
});
