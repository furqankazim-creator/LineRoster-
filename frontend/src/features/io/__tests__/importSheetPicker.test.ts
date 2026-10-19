import { describe, expect, it } from 'vitest';
import { parseSheetMeta } from '@/domain/calendar';

describe('Roster Sheet Name Metadata Parser', () => {
  const testCases = [
    {
      name: 'SLV_Line 4&6_Roster_SEP_2026',
      expectedLine: 'Line 4 & 6',
      expectedMonth: 9,
      expectedYear: 2026,
    },
    {
      name: 'SLV _Line4&6 _Roster_MAY 2026',
      expectedLine: 'Line 4 & 6',
      expectedMonth: 5,
      expectedYear: 2026,
    },
    {
      name: 'SLV _Line4&6 _Roster_June_ 2026',
      expectedLine: 'Line 4 & 6',
      expectedMonth: 6,
      expectedYear: 2026,
    },
    {
      name: 'SLV_Line 5_Roster_May_2026',
      expectedLine: 'Line 5',
      expectedMonth: 5,
      expectedYear: 2026,
    },
    {
      name: 'SLV _Line4&6 _Roster_July_ 2026',
      expectedLine: 'Line 4 & 6',
      expectedMonth: 7,
      expectedYear: 2026,
    },
    {
      name: 'SLV_Line4&6 _Roster_AUG_2026',
      expectedLine: 'Line 4 & 6',
      expectedMonth: 8,
      expectedYear: 2026,
    },
    {
      name: 'SLV_Line 5 _Roster_AUG_2026',
      expectedLine: 'Line 5',
      expectedMonth: 8,
      expectedYear: 2026,
    },
    {
      name: 'Line 5_SEP-2026 Roster',
      expectedLine: 'Line 5',
      expectedMonth: 9,
      expectedYear: 2026,
    },
    {
      name: 'SEPTEMBER 2026 RST L5',
      expectedLine: 'Line 5',
      expectedMonth: 9,
      expectedYear: 2026,
    },
  ];

  testCases.forEach(({ name, expectedLine, expectedMonth, expectedYear }) => {
    it(`parses "${name}" correctly`, () => {
      const meta = parseSheetMeta(name);
      expect(meta.lineName).toBe(expectedLine);
      expect(meta.month).toBe(expectedMonth);
      expect(meta.year).toBe(expectedYear);
    });
  });
});

describe('Sheet Sorting (Newest Month First)', () => {
  const workbookSheets = [
    'SLV _Line4&6 _Roster_MAY 2026',
    'SLV _Line4&6 _Roster_June_ 2026',
    'SLV_Line 5_Roster_May_2026',
    'SLV _Line4&6 _Roster_July_ 2026',
    'SLV_Line4&6 _Roster_AUG_2026',
    'SLV_Line 4&6_Roster_SEP_2026',
    'SLV_Line 5 _Roster_AUG_2026',
  ];

  it('sorts sheets so that September 2026 is at the top', () => {
    const scored = workbookSheets.map((name) => {
      const meta = parseSheetMeta(name);
      const score = (meta.year ?? 0) * 100 + (meta.month ?? 0);
      return { name, meta, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // First item must be September 2026
    expect(scored[0].name).toBe('SLV_Line 4&6_Roster_SEP_2026');
    expect(scored[0].meta.month).toBe(9);

    // Next two must be August 2026
    expect(scored[1].meta.month).toBe(8);
    expect(scored[2].meta.month).toBe(8);

    // Then July
    expect(scored[3].meta.month).toBe(7);

    // Then June
    expect(scored[4].meta.month).toBe(6);

    // Oldest are May
    expect(scored[5].meta.month).toBe(5);
    expect(scored[6].meta.month).toBe(5);
  });

  it('filters out previously imported sheets when toggle is off', () => {
    const previouslyImported = new Set([
      'SLV _Line4&6 _Roster_MAY 2026',
      'SLV _Line4&6 _Roster_June_ 2026',
      'SLV_Line 5_Roster_May_2026',
      'SLV _Line4&6 _Roster_July_ 2026',
      'SLV_Line4&6 _Roster_AUG_2026',
    ]);

    const showImported = false;
    const visible = workbookSheets.filter((name) => showImported || !previouslyImported.has(name));

    expect(visible).toEqual([
      'SLV_Line 4&6_Roster_SEP_2026',
      'SLV_Line 5 _Roster_AUG_2026',
    ]);
    expect(visible).not.toContain('SLV _Line4&6 _Roster_MAY 2026');
    expect(visible).not.toContain('SLV _Line4&6 _Roster_June_ 2026');
    expect(visible).not.toContain('SLV _Line4&6 _Roster_July_ 2026');
  });
});

