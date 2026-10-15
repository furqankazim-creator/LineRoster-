import { describe, expect, it } from 'vitest';

import type { Settings } from '@/data/db';

/**
 * Each line remembers its own month.
 *
 * One line's sheet is imported for August, another's for October. Switching
 * line must land on that line's own period, not carry the current month
 * across onto a month that line has no data for.
 */

type Month = { year: number; month: number };

/** Mirrors switchLine / goToMonth in the store. */
function makeNav(settings: Settings, rosters: { lineId: string; year: number; month: number; updatedAt: number; overrides: Record<string, unknown> }[]) {
  let s = { ...settings, lineMonths: { ...(settings.lineMonths ?? {}) } };

  return {
    get state() { return s; },
    goToMonth(year: number, month: number) {
      s = {
        ...s, activeYear: year, activeMonth: month,
        lineMonths: { ...s.lineMonths, [s.activeLineId]: { year, month } },
      };
    },
    switchLine(lineId: string) {
      const remembered: Month | undefined = s.lineMonths?.[lineId];
      if (remembered) {
        s = { ...s, activeLineId: lineId, activeYear: remembered.year, activeMonth: remembered.month };
        return;
      }
      const mine = rosters.filter((r) => r.lineId === lineId);
      const withEdits = mine.filter((r) => Object.keys(r.overrides).length > 0);
      const best = (withEdits.length ? withEdits : mine)
        .reduce<typeof mine[number] | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);
      s = best
        ? { ...s, activeLineId: lineId, activeYear: best.year, activeMonth: best.month }
        : { ...s, activeLineId: lineId };
    },
  };
}

const base = {
  key: 'app', theme: 'dark', activeLineId: 'line7', activeYear: 2026, activeMonth: 8,
  weekendDays: [5, 6], maxConsecutive: 6, seeded: true, zoomLevel: 100,
  fontSize: 'normal', fontFamily: 'default', lineMonths: {},
} as unknown as Settings;

describe('switching line follows that line to its own month', () => {
  it('returns each line to where it was left', () => {
    const nav = makeNav(base, []);
    nav.goToMonth(2026, 8);          // line 7 is on August
    nav.switchLine('line5');
    nav.goToMonth(2026, 10);         // line 5 is on October

    nav.switchLine('line7');
    expect([nav.state.activeYear, nav.state.activeMonth]).toEqual([2026, 8]);

    nav.switchLine('line5');
    expect([nav.state.activeYear, nav.state.activeMonth]).toEqual([2026, 10]);
  });

  it('opens a line never visited on the month it holds data for', () => {
    const nav = makeNav(base, [
      { lineId: 'line5', year: 2026, month: 8, updatedAt: 200, overrides: {} },
      { lineId: 'line5', year: 2026, month: 10, updatedAt: 100, overrides: { e01: { 3: 'N' } } },
    ]);
    nav.switchLine('line5');
    // October has real edits; the empty August was only ever generated.
    expect([nav.state.activeYear, nav.state.activeMonth]).toEqual([2026, 10]);
  });

  it('leaves the month alone for a line with no rosters at all', () => {
    const nav = makeNav(base, []);
    nav.switchLine('line9');
    expect([nav.state.activeYear, nav.state.activeMonth]).toEqual([2026, 8]);
    expect(nav.state.activeLineId).toBe('line9');
  });

  it('does not let one line\'s month change another\'s', () => {
    const nav = makeNav(base, []);
    nav.goToMonth(2026, 8);
    nav.switchLine('line5');
    nav.goToMonth(2026, 10);
    nav.goToMonth(2026, 11);

    nav.switchLine('line7');
    expect([nav.state.activeYear, nav.state.activeMonth]).toEqual([2026, 8]);
  });
});
