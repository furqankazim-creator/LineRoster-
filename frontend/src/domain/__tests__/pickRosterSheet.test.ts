import { describe, expect, it } from 'vitest';

import { lineFromFileName, pickRosterSheet } from '@/domain/calendar';

/** The sheet names of the supervisor's real TSM workbooks (trimmed to what matters). */
const SHEETS_46 = [
  'SLV _Line4&6 _Roster_MAY 2026', 'SLV_Line 5_Roster_May_2026', 'SLV_Line 4&6 _Roster_SEP_2026',
  'SLV_Line 4&6 _Roster_OCT_2026', 'SLV_Line 5 _Roster_AUG_2026', 'National Day Duties',
  'SLV_Line 5_SEP-2026 Roster', 'Training Dept Sch Sep 26(SLV) ', 'SLV _Line 5_Roster_June_ 2026',
];
const SHEETS_5 = [...SHEETS_46.filter((n) => !/4&6 _Roster_OCT/.test(n)), 'SLV_Line 5 _Roster_OCT_2026'];

describe('which line a roster file is about', () => {
  it('reads it from the file name', () => {
    expect(lineFromFileName('TSM_SLV_Line 4-6-Roster.xlsx')).toBe('line 4 & 6');
    expect(lineFromFileName('TSM_SLV_Line 5-Roster.xlsx')).toBe('line 5');
    expect(lineFromFileName('Line_5_Roster_SEP_2026 (1).xlsx')).toBe('line 5');
  });
  it('says nothing for a name that covers every line or none', () => {
    expect(lineFromFileName('Monthly Planning Line 4,5 & 6.xlsx')).toBeNull();
    expect(lineFromFileName('roster.xlsx')).toBeNull();
  });
});

describe('the file you choose decides the sheet, not the line open in the app', () => {
  it.each(['Line 5', 'Line 4 & 6'])('the Line 4-6 file opens its newest Line 4&6 sheet with "%s" open', (open) => {
    expect(pickRosterSheet(SHEETS_46, 'TSM_SLV_Line 4-6-Roster.xlsx', open)).toBe('SLV_Line 4&6 _Roster_OCT_2026');
  });
  it.each(['Line 5', 'Line 4 & 6'])('the Line 5 file opens its newest Line 5 sheet with "%s" open', (open) => {
    expect(pickRosterSheet(SHEETS_5, 'TSM_SLV_Line 5-Roster.xlsx', open)).toBe('SLV_Line 5 _Roster_OCT_2026');
  });
  it('uses the open line only when the file name does not say', () => {
    expect(pickRosterSheet(SHEETS_5, 'roster.xlsx', 'Line 4 & 6')).toBe('SLV_Line 4&6 _Roster_SEP_2026');
    expect(pickRosterSheet(SHEETS_5, 'roster.xlsx', 'Line 5')).toBe('SLV_Line 5 _Roster_OCT_2026');
  });
  it('opens a sheet named like the file when there is one', () => {
    expect(pickRosterSheet(['A', 'SLV_Line 5_SEP_2026'], 'SLV_Line 5_SEP_2026.xlsx', 'Line 4 & 6')).toBe('SLV_Line 5_SEP_2026');
  });
});
