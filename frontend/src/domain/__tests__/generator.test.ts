import { describe, expect, it } from 'vitest';

import { SEED_CODES, SEED_EMPLOYEES, SEED_LEAVE } from '@/data/seed';
import { buildColumns, daysInMonth } from '@/domain/calendar';
import { generateMonth, inferRestDays, inferRotations, setCell, setRange } from '@/domain/generator';
import { summarise } from '@/domain/summary';
import { OFF } from '@/domain/types';

import fixture from './september-2026.fixture.json';

const YEAR = 2026;
const MONTH = 9;
const N_DAYS = 30;

/** The client's actual sheet, keyed by employee id. */
const actual = fixture.grid as Record<string, string[]>;

function generate(overrides = {}) {
  return generateMonth({
    year: YEAR,
    month: MONTH,
    lineId: 'line5',
    employees: SEED_EMPLOYEES,
    leaveBlocks: SEED_LEAVE,
    overrides,
  });
}

describe('generateMonth — acceptance against the real September 2026 sheet', () => {
  const roster = generate();

  it('produces a row per employee, one cell per day', () => {
    expect(Object.keys(roster.cells)).toHaveLength(SEED_EMPLOYEES.length);
    for (const row of Object.values(roster.cells)) {
      expect(row).toHaveLength(N_DAYS);
    }
  });

  /**
   * The core claim of the whole product: given only a shift, a rest-day pair,
   * rotation ranges and leave blocks, the engine reproduces — cell for cell —
   * a month the client built by hand in Excel.
   */
  it.each(SEED_EMPLOYEES.map((e) => [e.name, e.id] as const))(
    'reproduces the roster for %s',
    (_name, id) => {
      expect(roster.cells[id].map((c) => c.code)).toEqual(actual[id]);
    },
  );
});

describe('summarise — matches the client\'s own COUNTIF rows', () => {
  const roster = generate();
  const days = summarise(roster, SEED_CODES, N_DAYS);

  it.each(['M', 'E', 'N'] as const)('headcount row for %s matches the sheet', (code) => {
    const generated = days.map((d) => d.total[code] ?? 0);
    expect(generated).toEqual((fixture.summary as Record<string, number[]>)[code]);
  });
});

describe('generateMonth — resolution order', () => {
  it('honours rest days over the default shift', () => {
    const roster = generate();
    // Masudur Ghazi rests Fri + Sat.
    const cols = buildColumns(YEAR, MONTH);
    const row = roster.cells.e02;
    for (const col of cols) {
      if (col.weekday === 5 || col.weekday === 6) {
        expect(row[col.index].code).toBe(OFF);
        expect(row[col.index].source).toBe('rest');
      }
    }
  });

  it('honours leave over rest days and rotations', () => {
    const roster = generate();
    // Ummer Abbas is on leave 20–30 Sept.
    for (let i = 19; i < 30; i++) {
      expect(roster.cells.e01[i].code).toBe('LV');
      expect(roster.cells.e01[i].source).toBe('leave');
    }
  });

  it('applies mid-month rotation ranges', () => {
    const roster = generate();
    // Abdul Saeed: N for 1–12, E for 13–26, M for 27–30.
    expect(roster.cells.e17[0].code).toBe('N');
    expect(roster.cells.e17[13].code).toBe('E');
    expect(roster.cells.e17[28].code).toBe('M');
  });

  it('lets a manual override beat every rule', () => {
    const roster = generate({ e02: { 4: 'N' } });
    expect(roster.cells.e02[4].code).toBe('N');
    expect(roster.cells.e02[4].source).toBe('manual');
  });

  it('drops overrides when told not to respect them', () => {
    const roster = generateMonth({
      year: YEAR, month: MONTH, lineId: 'line5',
      employees: SEED_EMPLOYEES, leaveBlocks: SEED_LEAVE,
      overrides: { e02: { 4: 'N' } },
      respectOverrides: false,
    });
    expect(roster.cells.e02[4].source).not.toBe('manual');
  });
});

describe('editing', () => {
  it('setCell records an override alongside the value', () => {
    const next = setCell(generate(), 'e03', 10, 'E');
    expect(next.cells.e03[10]).toEqual({ code: 'E', source: 'manual' });
    expect(next.overrides.e03[10]).toBe('E');
  });

  it('setRange paints a contiguous block in either drag direction', () => {
    const next = setRange(generate(), 'e03', 12, 8, 'GS');
    for (let i = 8; i <= 12; i++) expect(next.cells.e03[i].code).toBe('GS');
    expect(next.cells.e03[7].code).not.toBe('GS');
    expect(next.cells.e03[13].code).not.toBe('GS');
  });
});

describe('inference — reading rules back out of an existing grid', () => {
  it('recovers each rest-day pair from the real sheet', () => {
    for (const employee of SEED_EMPLOYEES) {
      if (employee.restDays.length === 0) continue;
      // Skip people whose pattern is masked by a long leave block.
      if (SEED_LEAVE.some((l) => l.employeeId === employee.id && l.to >= '2026-09-20')) continue;
      expect(inferRestDays(actual[employee.id], YEAR, MONTH)).toEqual(employee.restDays);
    }
  });

  it('recovers mid-month rotation blocks', () => {
    const worked = new Set(['M', 'E', 'N', 'GS', 'P']);
    // Arif Ali khan: E → N → E
    expect(inferRotations(actual.e15, worked).map((r) => r.code)).toEqual(['E', 'N', 'E']);
    // Someone on one shift all month has no rotation at all.
    expect(inferRotations(actual.e02, worked)).toEqual([]);
  });
});

describe('calendar', () => {
  it('knows September 2026 has 30 days starting on a Tuesday', () => {
    expect(daysInMonth(YEAR, MONTH)).toBe(30);
    expect(buildColumns(YEAR, MONTH)[0].label).toBe('Tue');
  });

  it('handles a leap February', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});
