import { describe, expect, it } from 'vitest';

import { SEED_CODES, SEED_EMPLOYEES, SEED_LEAVE } from '@/data/seed';
import { generateMonth, setCell, setRange } from '@/domain/generator';
import { countBySeverity, suggestCover, validate } from '@/domain/validate';
import { OFF } from '@/domain/types';

const N_DAYS = 30;

function base() {
  return generateMonth({
    year: 2026, month: 9, lineId: 'line5',
    employees: SEED_EMPLOYEES, leaveBlocks: SEED_LEAVE,
  });
}

function check(roster: ReturnType<typeof base>) {
  return validate({
    roster, employees: SEED_EMPLOYEES, codes: SEED_CODES,
    leaveBlocks: SEED_LEAVE, nDays: N_DAYS,
  });
}

describe('validate', () => {
  /**
   * A real gap in the client's own September sheet, caught on day one.
   *
   * His Night headcount row reads `… 9, 9, 7, 7, 9, 2, 2, 8 …` — days 25 and
   * 26 fall to two people while every other Fri/Sat pair that month carries
   * three. Mohammad Monis rotating off Night on day 22 is what drops it, and
   * the four-strong Fri/Sat rest group can't backfill because they are off.
   *
   * This is exactly the class of mistake the tool exists to surface, so the
   * test pins it rather than pretending his roster is clean.
   */
  it('catches the genuine Night shortfall on 25–26 Sept and nothing else', () => {
    const issues = check(base())
      .filter((i) => i.rule === 'below-minimum' || i.rule === 'empty-shift')
      .map((i) => ({ rule: i.rule, day: (i.dayIndex ?? 0) + 1, shift: i.shiftCode }));

    expect(issues).toEqual([
      { rule: 'below-minimum', day: 25, shift: 'N' },
      { rule: 'below-minimum', day: 26, shift: 'N' },
    ]);
  });

  it('flags a day that falls below the minimum headcount', () => {
    // Empty out every Morning person on day 1.
    let roster = base();
    for (const e of SEED_EMPLOYEES) {
      if (roster.cells[e.id][0].code === 'M') roster = setCell(roster, e.id, 0, OFF);
    }
    const issues = check(roster);
    const gap = issues.find((i) => i.rule === 'empty-shift' && i.dayIndex === 0);
    expect(gap?.severity).toBe('error');
    expect(gap?.shiftCode).toBe('M');
  });

  it('flags an illegal night-to-morning turnaround', () => {
    // Muhammad Adeel works N; put him on M the next day.
    let roster = base();
    const day = roster.cells.e07.findIndex((c, i) => c.code === 'N' && roster.cells.e07[i + 1]);
    roster = setCell(roster, 'e07', day + 1, 'M');

    const issue = check(roster).find((i) => i.rule === 'night-to-morning' && i.employeeId === 'e07');
    expect(issue?.severity).toBe('error');
  });

  it('warns when someone works more than six days straight', () => {
    let roster = base();
    roster = setRange(roster, 'e02', 0, 9, 'M'); // ten days with no rest
    const issue = check(roster).find((i) => i.rule === 'too-many-consecutive' && i.employeeId === 'e02');
    expect(issue?.severity).toBe('warning');
  });

  it('warns when a rest day is worked', () => {
    // Masudur Ghazi rests Fri + Sat; 4 Sept 2026 is a Friday.
    const roster = setCell(base(), 'e02', 3, 'M');
    const issue = check(roster).find((i) => i.rule === 'rest-days-violated' && i.employeeId === 'e02');
    expect(issue?.severity).toBe('warning');
  });

  it('errors when someone is rostered during their own leave block', () => {
    // Ummer Abbas is on leave 20–30 Sept.
    const roster = setCell(base(), 'e01', 25, 'M');
    const issue = check(roster).find((i) => i.rule === 'working-while-on-leave');
    expect(issue?.employeeId).toBe('e01');
    expect(issue?.severity).toBe('error');
  });

  it('counts issues by severity', () => {
    const counts = countBySeverity(check(base()));
    expect(counts.errors + counts.warnings).toBe(check(base()).length);
  });
});

describe('suggestCover', () => {
  it('only suggests people who are off that day and not on leave', () => {
    const roster = base();
    const dayIndex = 3; // a Friday — the big Fri/Sat rest group is off
    const suggestions = suggestCover(roster, SEED_EMPLOYEES, SEED_CODES, dayIndex, 'M', SEED_LEAVE);

    expect(suggestions.length).toBeGreaterThan(0);
    for (const e of suggestions) {
      expect(roster.cells[e.id][dayIndex].code).toBe(OFF);
      // Nobody on a leave block should ever be offered as cover.
      const onLeave = SEED_LEAVE.some(
        (l) => l.employeeId === e.id && l.from <= '2026-09-04' && l.to >= '2026-09-04',
      );
      expect(onLeave).toBe(false);
    }
  });

  it('never suggests someone who worked nights the day before for a morning gap', () => {
    const roster = base();
    const suggestions = suggestCover(roster, SEED_EMPLOYEES, SEED_CODES, 5, 'M', SEED_LEAVE);
    for (const e of suggestions) {
      expect(roster.cells[e.id][4].code).not.toBe('N');
    }
  });
});
