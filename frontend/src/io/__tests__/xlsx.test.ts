import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx-js-style';

import { SEED_CODES, SEED_EMPLOYEES, SEED_LEAVE, SEED_LINES } from '@/data/seed';
import { generateMonth } from '@/domain/generator';
import { BACKUP_SHEET, buildBackupWorkbook, buildFromLayout, buildWorkbook } from '@/io/exportXlsx';
import { importBackupWorkbook, importSheet, listSheets, toRecords } from '@/io/importXlsx';

/** The client's real workbook, kept as a fixture so the parser can't drift. */
const SOURCE = fileURLToPath(new URL('./Roster_September.xlsx', import.meta.url));

function sourceBuffer(): ArrayBuffer {
  const buf = readFileSync(SOURCE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("importing the client's own Roster_September.xlsx", () => {
  const buffer = sourceBuffer();
  const sheets = listSheets(buffer);

  it('finds both month tabs', () => {
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toMatch(/AUG/);
    expect(sheets[1]).toMatch(/SEP/);
  });

  it('reads the September sheet as September 2026, Line 5', () => {
    const result = importSheet(buffer, sheets[1]);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(9);
    expect(result.lineName).toBe('Line 5');
    expect(result.employees).toHaveLength(22);
    expect(result.warnings).toEqual([]);
  });

  it('recovers every name and contact number', () => {
    const result = importSheet(buffer, sheets[1]);
    result.employees.forEach((row, i) => {
      expect(row.name.trim()).toBe(SEED_EMPLOYEES[i].name);
      expect(row.contact).toBe(SEED_EMPLOYEES[i].contact);
    });
  });

  /**
   * The importer's real job: his sheet has no rest-day or rotation columns, so
   * those rules have to be reconstructed from the visual pattern alone.
   */
  it('reconstructs rest days and default shifts from the grid alone', () => {
    const result = importSheet(buffer, sheets[1]);

    result.employees.forEach((row, i) => {
      const seeded = SEED_EMPLOYEES[i];
      // Someone masked by a long leave block has no pattern left to read.
      const daysOnLeave = row.leaveRanges.reduce((n, r) => n + (r.to - r.from + 1), 0);
      if (daysOnLeave > 8 || seeded.restDays.length === 0) return;

      expect(row.restDays, `${seeded.name} rest days`).toEqual(seeded.restDays);
      expect(row.defaultShift, `${seeded.name} shift`).toBe(seeded.defaultShift);
    });
  });

  it('detects the mid-month rotations', () => {
    const result = importSheet(buffer, sheets[1]);

    const arif = result.employees.find((e) => e.name.trim() === 'Arif Ali khan');
    expect(arif?.rotations.map((r) => r.code)).toEqual(['E', 'N', 'E']);

    const saeed = result.employees.find((e) => e.name.trim() === 'Abdul Saeed');
    expect(saeed?.rotations.map((r) => r.code)).toEqual(['N', 'E', 'M']);
  });

  it('detects the red leave blocks', () => {
    const result = importSheet(buffer, sheets[1]);

    const ummer = result.employees.find((e) => e.name.trim() === 'Ummer Abbas');
    expect(ummer?.leaveRanges).toEqual([{ from: 20, to: 30 }]);

    const raneem = result.employees.find((e) => e.name.trim() === 'Raneem Almalki');
    expect(raneem?.leaveRanges).toEqual([
      { from: 6, to: 10 },
      { from: 13, to: 17 },
    ]);
  });

  it('expands the merged whole-month FLRT cell across the row', () => {
    const result = importSheet(buffer, sheets[1]);
    const imran = result.employees.find((e) => e.name.trim() === 'Imran Ghani');
    expect(imran?.codes.every((c) => c === 'FLRT')).toBe(true);
  });

  it('also reads the August sheet, which has 31 days', () => {
    const result = importSheet(buffer, sheets[0]);
    expect(result.month).toBe(8);
    expect(result.year).toBe(2026);
    expect(result.employees[0].codes).toHaveLength(31);
  });

  it('turns a parsed sheet into database records', () => {
    const result = importSheet(buffer, sheets[1]);
    const { employees, leave } = toRecords(result, 'line5', (_n, i) => `imp${i}`);

    expect(employees).toHaveLength(22);
    expect(employees.every((e) => e.lineId === 'line5')).toBe(true);
    expect(leave.some((l) => l.code === 'FLRT')).toBe(true);
  });
});

describe('export', () => {
  const roster = generateMonth({
    year: 2026, month: 9, lineId: 'line5',
    employees: SEED_EMPLOYEES, leaveBlocks: SEED_LEAVE,
  });

  const wb = buildWorkbook({
    roster, employees: SEED_EMPLOYEES, codes: SEED_CODES, line: SEED_LINES[0],
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  it('writes the title and header rows in his layout', () => {
    expect(sheet.A1.v).toBe('Line 5_SEP-2026 Roster');
    expect(sheet.A3.v).toBe('Name');
    expect(sheet.B3.v).toBe('Contact #');
    expect(sheet['!merges']?.length).toBeGreaterThan(0);
  });

  it('writes the headcount rows as live COUNTIF formulas, not flat numbers', () => {
    const formulas = Object.values(sheet).filter(
      (c): c is XLSX.CellObject => !!c && typeof c === 'object' && 'f' in c,
    );
    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas.every((c) => String(c.f).includes('COUNTIF'))).toBe(true);

    // Total headcount folds in the support codes exactly as his sheet does.
    const total = formulas.find((c) => String(c.f).includes('MT'));
    expect(String(total?.f)).toMatch(/COUNTIF\(\w+\$4:\w+\$25,"M"\)\+/);
  });

  it("writes each person's Hours and OT after the last day", () => {
    // 30 days from column C end at AF, so the totals are AG and AH.
    expect(sheet.AG3.v).toBe('Hours');
    expect(sheet.AH3.v).toBe('OT');
    expect(sheet.AG4.v).toBeGreaterThan(0);

    // Two extra hours on a normal working day become two hours of OT.
    const first = SEED_EMPLOYEES[0];
    const day = roster.cells[first.id].findIndex((c) => c.source === 'default');
    const withExtra = buildWorkbook({
      roster: { ...roster, extraHours: { [first.id]: { [day]: 2 } } },
      employees: SEED_EMPLOYEES, codes: SEED_CODES, line: SEED_LINES[0],
    });
    expect(withExtra.Sheets[withExtra.SheetNames[0]].AH4.v).toBe((sheet.AH4.v as number) + 2);
  });

  it('is far smaller than his original, which carries ~54k conditional formats', () => {
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
    expect(out.byteLength).toBeLessThan(readFileSync(SOURCE).byteLength / 4);
  });

  it('round-trips: what we write, we can read back identically', () => {
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
    const back = importSheet(out as ArrayBuffer);

    expect(back.year).toBe(2026);
    expect(back.month).toBe(9);
    expect(back.employees).toHaveLength(SEED_EMPLOYEES.length);

    SEED_EMPLOYEES.forEach((e, i) => {
      expect(back.employees[i].name).toBe(e.name);
      expect(back.employees[i].codes).toEqual(roster.cells[e.id].map((c) => c.code));
    });
  });
});

describe('Excel backup round-trip', () => {
  const roster = generateMonth({
    year: 2026, month: 9, lineId: 'line5',
    employees: SEED_EMPLOYEES, leaveBlocks: SEED_LEAVE, overrides: { [SEED_EMPLOYEES[0].id]: { 3: 'N' } },
  });
  const data = { lines: SEED_LINES, employees: SEED_EMPLOYEES, codes: SEED_CODES, leave: SEED_LEAVE, rosters: [roster], settings: { key: 'app', activeLineId: 'line5' } };
  const bytes = XLSX.write(buildBackupWorkbook(data), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const wb = XLSX.read(bytes, { type: 'array' });

  it('keeps the readable sheets and hides the data sheet', () => {
    expect(wb.SheetNames).toEqual(expect.arrayContaining(['Employees', 'Shift Codes', 'Lines', 'Leave', BACKUP_SHEET]));
    expect(wb.Workbook?.Sheets?.[wb.SheetNames.indexOf(BACKUP_SHEET)]?.Hidden).toBe(1);
  });

  it('restores rosters, leave, colours and rotations exactly', () => {
    const back = importBackupWorkbook(bytes);
    expect(back.employees).toEqual(SEED_EMPLOYEES);
    expect(back.codes).toEqual(SEED_CODES);
    expect(back.lines).toEqual(SEED_LINES);
    expect(back.leave).toEqual(SEED_LEAVE);
    expect(back.rosters).toHaveLength(1);
    expect(back.rosters?.[0].cells[SEED_EMPLOYEES[0].id][3].code).toBe('N');
    expect(back.rosters?.[0].overrides).toEqual(roster.overrides);
    expect(back.settings).toEqual(data.settings);
  });

  it('still reads a backup whose hidden sheet was removed, mapping line names back to ids', () => {
    const stripped = XLSX.utils.book_new();
    for (const name of wb.SheetNames.filter((n) => n !== BACKUP_SHEET)) {
      XLSX.utils.book_append_sheet(stripped, wb.Sheets[name], name);
    }
    const bytes2 = XLSX.write(stripped, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const back = importBackupWorkbook(bytes2);
    expect(back.employees).toHaveLength(SEED_EMPLOYEES.length);
    expect(new Set(back.employees.map((e) => e.lineId))).toEqual(new Set(SEED_EMPLOYEES.map((e) => e.lineId)));
  });
});

describe("exporting back into the client's own layout", () => {
  const buffer = sourceBuffer();
  const sheets = listSheets(buffer);
  const source = importSheet(buffer, sheets[1]);
  const { employees, leave } = toRecords(source, 'line5', (_n, i) => `e${String(i + 1).padStart(2, '0')}`);
  const roster = generateMonth({
    year: source.year, month: source.month, lineId: 'line5', employees, leaveBlocks: leave, overrides: {},
  });

  /** Export through the captured layout, then read the result back in. */
  const reimported = () => {
    const wb = buildFromLayout({ roster, employees, codes: SEED_CODES }, source.layout);
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer;
    return importSheet(bytes);
  };

  it('captures where the source put its header and days', () => {
    expect(source.layout.nameCol).toBeGreaterThanOrEqual(0);
    expect(source.layout.dayCols).toHaveLength(30);
    expect(source.layout.dayCols[0].day).toBe(1);
    expect(source.layout.sheetName).toBe(sheets[1]);
  });

  it('keeps the sheet name, month and every employee', () => {
    const back = reimported();
    expect(back.sheetName).toBe(source.sheetName);
    expect(back.year).toBe(source.year);
    expect(back.month).toBe(source.month);
    expect(back.employees.map((e) => e.name)).toEqual(source.employees.map((e) => e.name));
  });

  it('round-trips every shift letter in the grid', () => {
    const back = reimported();
    back.employees.forEach((row, i) => {
      expect(row.codes).toEqual(roster.cells[employees[i].id].map((c) => c.code));
    });
  });

  it('writes the day headers exactly as the source spelled them', () => {
    const wb = buildFromLayout({ roster, employees, codes: SEED_CODES }, source.layout);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    for (const { col, header } of source.layout.dayCols) {
      const cell = sheet[XLSX.utils.encode_cell({ r: source.layout.headerRow, c: col })];
      expect(String(cell?.v)).toBe(header);
    }
  });
});
