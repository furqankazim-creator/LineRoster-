import { describe, expect, it } from 'vitest';

import { SEED_CODES, SEED_EMPLOYEES, SEED_LEAVE } from '@/data/seed';
import { daysInMonth, shiftMonth } from '@/domain/calendar';
import { generateMonth } from '@/domain/generator';
import { autoRotate, buildHistory, fairness } from '@/domain/rotation';
import { summarise } from '@/domain/summary';
import type { Employee, RosterMonth } from '@/domain/types';

function build(year: number, month: number, employees: Employee[]): RosterMonth {
  return generateMonth({ year, month, lineId: 'line5', employees, leaveBlocks: SEED_LEAVE });
}

describe('autoRotate', () => {
  const september = build(2026, 9, SEED_EMPLOYEES);
  const history = buildHistory([september]);

  it('is deterministic — the same input always gives the same roster', () => {
    const a = autoRotate({ year: 2026, month: 10, employees: SEED_EMPLOYEES, codes: SEED_CODES, history });
    const b = autoRotate({ year: 2026, month: 10, employees: SEED_EMPLOYEES, codes: SEED_CODES, history });
    expect(a.assignments).toEqual(b.assignments);
  });

  it('never moves pinned or non-rotating staff', () => {
    const { assignments } = autoRotate({
      year: 2026, month: 10, employees: SEED_EMPLOYEES, codes: SEED_CODES, history,
    });
    for (const e of SEED_EMPLOYEES) {
      if (e.pinned || !['M', 'E', 'N'].includes(e.defaultShift)) {
        expect(assignments[e.id]).toBe(e.defaultShift);
      }
    }
  });

  it('moves the long-term night staff off nights', () => {
    const { assignments } = autoRotate({
      year: 2026, month: 10, employees: SEED_EMPLOYEES, codes: SEED_CODES, history,
    });
    // The four who sat on N all of September.
    for (const id of ['e10', 'e11', 'e12', 'e13']) {
      expect(assignments[id]).not.toBe('N');
    }
  });

  it('keeps every rotating shift at or above its minimum on every day', () => {
    const { assignments } = autoRotate({
      year: 2026, month: 10, employees: SEED_EMPLOYEES, codes: SEED_CODES, history,
    });
    const rotated = SEED_EMPLOYEES.map((e) => ({
      ...e,
      defaultShift: assignments[e.id],
      rotations: {}, // a fresh month starts from the new default
    }));

    const roster = build(2026, 10, rotated);
    const days = summarise(roster, SEED_CODES, daysInMonth(2026, 10));

    for (const code of SEED_CODES.filter((c) => c.minHeadcount > 0)) {
      days.forEach((d, i) => {
        expect(
          d.total[code.id] ?? 0,
          `${code.label} on day ${i + 1}`,
        ).toBeGreaterThanOrEqual(code.minHeadcount);
      });
    }
  });

  it('aggressiveness 0 leaves everyone put unless coverage forces a move', () => {
    const { assignments } = autoRotate({
      year: 2026, month: 10, employees: SEED_EMPLOYEES, codes: SEED_CODES,
      history, aggressiveness: 0,
    });
    const moved = SEED_EMPLOYEES.filter((e) => assignments[e.id] !== e.defaultShift);
    expect(moved.length).toBeLessThan(SEED_EMPLOYEES.length / 2);
  });

  /**
   * The fairness guarantee: run the rotator forward six months and nobody
   * should be carrying a materially heavier night load than anyone else.
   */
  it('evens out night load across six simulated months', () => {
    let employees = SEED_EMPLOYEES.map((e) => ({ ...e, rotations: {} }));
    let cursor = { year: 2026, month: 9 };
    const rosters: RosterMonth[] = [];

    for (let i = 0; i < 6; i++) {
      const roster = build(cursor.year, cursor.month, employees);
      rosters.push(roster);

      const { assignments } = autoRotate({
        ...shiftMonth(cursor.year, cursor.month, 1),
        employees,
        codes: SEED_CODES,
        history: buildHistory(rosters),
      });
      employees = employees.map((e) => ({ ...e, defaultShift: assignments[e.id], rotations: {} }));
      cursor = shiftMonth(cursor.year, cursor.month, 1);
    }

    const { rows, spread } = fairness(buildHistory(rosters), SEED_EMPLOYEES, SEED_CODES);
    const rotatingPool = rows.filter((r) => ['M', 'E', 'N'].includes(r.employee.defaultShift));

    // Before rotation, four people had ~130 nights and others had zero.
    // After six rotated months the gap should be a fraction of that.
    const nights = rotatingPool.map((r) => r.nights);
    const worstGap = Math.max(...nights) - Math.min(...nights);
    expect(worstGap).toBeLessThan(spread + 1);
    expect(worstGap).toBeLessThanOrEqual(60);
  });

  describe('leaders_only 2-week cycle rotation', () => {
    it('rotates only designated team leaders while keeping engineers steady', () => {
      const result = autoRotate({
        year: 2026,
        month: 10,
        employees: SEED_EMPLOYEES,
        codes: SEED_CODES,
        history,
        targetScope: 'leaders_only',
        patternMode: 'two_week_cycle',
      });

      expect(result.leadersRotated?.length).toBe(6);
      expect(result.engineersKeptFixed?.length).toBe(SEED_EMPLOYEES.length - 6);

      // Verify each leader has 2-week rotation blocks
      for (const leaderId of result.leadersRotated ?? []) {
        const rules = result.rotationRules?.[leaderId];
        expect(rules).toBeDefined();
        expect(rules).toHaveLength(2);
        expect(rules![0].fromDay).toBe(1);
        expect(rules![0].toDay).toBe(14);
        expect(rules![1].fromDay).toBe(15);
        expect(rules![1].toDay).toBe(31); // October has 31 days
      }

      // Verify engineers keep their regular default shift
      for (const engId of result.engineersKeptFixed ?? []) {
        const emp = SEED_EMPLOYEES.find((e) => e.id === engId)!;
        expect(result.assignments[engId]).toBe(emp.defaultShift);
        expect(result.rotationRules?.[engId]).toBeUndefined();
      }
    });

    it('generates roster respecting weekend off and 2-week shift transitions', () => {
      const result = autoRotate({
        year: 2026,
        month: 10,
        employees: SEED_EMPLOYEES,
        codes: SEED_CODES,
        history,
        targetScope: 'leaders_only',
        patternMode: 'two_week_cycle',
      });

      const updatedEmployees = SEED_EMPLOYEES.map((e) => ({
        ...e,
        rotations: {
          '2026-10': result.rotationRules?.[e.id] ?? [],
        },
      }));

      const roster = generateMonth({
        year: 2026,
        month: 10,
        lineId: 'line5',
        employees: updatedEmployees,
      });

      const e06Cells = roster.cells['e06'];
      expect(e06Cells).toBeDefined();
      const rules = result.rotationRules?.['e06']!;
      expect(rules).toHaveLength(2);

      // Days on rest days are '-' (OFF), working days follow 2-week block rules
      for (let day = 1; day <= 31; day++) {
        const cell = e06Cells[day - 1];
        if (cell.source === 'rest') {
          expect(cell.code).toBe('-');
        } else if (day <= 14) {
          expect(cell.code).toBe(rules[0].code);
        } else {
          expect(cell.code).toBe(rules[1].code);
        }
      }
    });
  });
});

describe('fairness', () => {
  it('ranks the people carrying the most nights first', () => {
    const history = buildHistory([build(2026, 9, SEED_EMPLOYEES)]);
    const { rows } = fairness(history, SEED_EMPLOYEES, SEED_CODES);
    expect(rows[0].nights).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].nights).toBeGreaterThanOrEqual(rows[i].nights);
    }
  });

  it('excludes pinned staff from the fairness pool', () => {
    const history = buildHistory([build(2026, 9, SEED_EMPLOYEES)]);
    const { rows } = fairness(history, SEED_EMPLOYEES, SEED_CODES);
    expect(rows.some((r) => r.employee.id === 'e22')).toBe(false); // project staff
  });
});
