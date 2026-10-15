import XLSX from 'xlsx-js-style';

import { exportColors } from '@/app/tones';
import { MONTH_ABBR, buildColumns, daysInMonth } from '@/domain/calendar';
import { DEFAULT_STANDARD_HOURS, employeeHours } from '@/domain/hours';
import { OFF, type Employee, type Line, type RosterMonth, type SheetLayout, type ShiftCode } from '@/domain/types';

type Cell = XLSX.CellObject & { s?: Record<string, unknown> };

const THIN = { style: 'thin', color: { rgb: 'FFBFC5D0' } };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** Spreadsheet column letters: 0 → A, 26 → AA. */
function colLetter(index: number): string {
  let s = '';
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export interface ExportInput {
  roster: RosterMonth;
  employees: Employee[];
  codes: ShiftCode[];
  line: Line;
  /** A standard working day, for the Hours / OT columns. Defaults to 9. */
  standardHours?: number;
}

/**
 * Writes a workbook in the client's own layout.
 *
 * He still has to email and print this for management, so the export mirrors
 * his sheet rather than inventing a new one: merged title, legend block, day
 * and weekday header rows, colour-filled codes, and the headcount rows as live
 * COUNTIF formulas so the file keeps recalculating in Excel.
 *
 * One deliberate difference: his current file carries tens of thousands of
 * duplicated conditional-formatting rules, which is why it opens slowly. This
 * writes static fills instead, so the output is a fraction of the size.
 */
export function buildWorkbook({
  roster, employees, codes, line, standardHours = DEFAULT_STANDARD_HOURS,
}: ExportInput): XLSX.WorkBook {
  const { year, month } = roster;
  const nDays = daysInMonth(year, month);
  const columns = buildColumns(year, month);
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const hours = employeeHours({ roster, employees, codes, standardHours });

  const FIRST_DATA_COL = 2; // column C
  const HEADER_ROWS = 3;
  const firstEmpRow = HEADER_ROWS; // 0-based row index of the first employee
  const lastEmpRow = firstEmpRow + employees.length - 1;
  // Month totals sit straight after the last day; the legend moves right of them.
  const HOURS_COL = FIRST_DATA_COL + nDays;
  const OT_COL = HOURS_COL + 1;
  const LEGEND_COL = OT_COL + 2;

  const cells: Record<string, Cell> = {};
  const put = (r: number, c: number, cell: Cell) => {
    cells[XLSX.utils.encode_cell({ r, c })] = cell;
  };

  // ---- row 1: title + legend -------------------------------------------
  put(0, 0, {
    t: 's',
    v: `${line.name}_${MONTH_ABBR[month - 1]}-${year} Roster`,
    s: {
      font: { bold: true, sz: 16, color: { rgb: 'FF1B2333' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFE8ECF4' } },
    },
  });

  const legend = codes
    .filter((c) => !c.isStatus)
    .map((c) => `${c.id} — ${c.label}: ${c.timing}`)
    .join('\n');
  put(0, LEGEND_COL, {
    t: 's',
    v: `SHIFT TIMINGS\n\n${legend}\n\nOT = hours past ${standardHours} a day, plus any shift worked on a rest day`,
    s: {
      font: { sz: 10, color: { rgb: 'FF44506B' } },
      alignment: { vertical: 'top', wrapText: true },
      border: BORDER,
    },
  });

  // ---- row 2: weekday labels -------------------------------------------
  put(1, 0, {
    t: 's',
    v: 'Days=>',
    s: {
      font: { bold: true, sz: 10 },
      alignment: { horizontal: 'center' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFE8ECF4' } },
      border: BORDER,
    },
  });
  for (const col of columns) {
    put(1, FIRST_DATA_COL + col.index, {
      t: 's',
      v: col.label,
      s: {
        font: { bold: true, sz: 9, color: { rgb: 'FF44506B' } },
        alignment: { horizontal: 'center' },
        fill: {
          patternType: 'solid',
          fgColor: { rgb: col.isWeekend ? 'FFDDE2EC' : 'FFF0F2F7' },
        },
        border: BORDER,
      },
    });
  }

  // ---- row 3: Name | Contact | day numbers ------------------------------
  const headStyle = {
    font: { bold: true, sz: 10, color: { rgb: 'FF1B2333' } },
    alignment: { horizontal: 'center' },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFE8ECF4' } },
    border: BORDER,
  };
  put(2, 0, { t: 's', v: 'Name', s: { ...headStyle, alignment: { horizontal: 'left' } } });
  put(2, 1, { t: 's', v: 'Contact #', s: headStyle });
  for (const col of columns) {
    put(2, FIRST_DATA_COL + col.index, { t: 'n', v: col.day, s: headStyle });
  }
  put(2, HOURS_COL, { t: 's', v: 'Hours', s: headStyle });
  put(2, OT_COL, { t: 's', v: 'OT', s: headStyle });

  // ---- employee rows ----------------------------------------------------
  employees.forEach((employee, i) => {
    const r = firstEmpRow + i;
    put(r, 0, {
      t: 's',
      v: employee.name,
      s: { font: { sz: 10, bold: true }, alignment: { horizontal: 'left' }, border: BORDER },
    });
    put(r, 1, {
      t: 's',
      v: employee.contact,
      s: { font: { sz: 9, color: { rgb: 'FF5A6376' } }, alignment: { horizontal: 'center' }, border: BORDER },
    });

    const row = roster.cells[employee.id] ?? [];
    for (const col of columns) {
      const code = row[col.index]?.code ?? OFF;
      const def = codeById.get(code);
      const palette = exportColors(def);

      put(r, FIRST_DATA_COL + col.index, {
        t: 's',
        v: code === OFF ? '-' : code,
        s: {
          font: { bold: true, sz: 10, color: { rgb: palette.font } },
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: { patternType: 'solid', fgColor: { rgb: palette.fill } },
          border: BORDER,
        },
      });
    }

    const h = hours[employee.id];
    const totalStyle = (bold: boolean) => ({
      font: { bold, sz: 10, color: { rgb: bold ? 'FFB45F06' : 'FF1B2333' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFF5F7FA' } },
      border: BORDER,
    });
    put(r, HOURS_COL, { t: 'n', v: h?.worked ?? 0, s: totalStyle(false) });
    put(r, OT_COL, { t: 'n', v: h?.overtime ?? 0, s: totalStyle((h?.overtime ?? 0) > 0) });
  });

  // ---- weekday repeat row ----------------------------------------------
  const repeatRow = lastEmpRow + 1;
  for (const col of columns) {
    put(repeatRow, FIRST_DATA_COL + col.index, {
      t: 's',
      v: col.label,
      s: {
        font: { bold: true, sz: 9, color: { rgb: 'FF44506B' } },
        alignment: { horizontal: 'center' },
        fill: { patternType: 'solid', fgColor: { rgb: col.isWeekend ? 'FFDDE2EC' : 'FFF0F2F7' } },
        border: BORDER,
      },
    });
  }

  // ---- headcount rows, as live formulas --------------------------------
  const engineerCodes = codes.filter((c) => c.countsAsEngineer && !c.isStatus);
  const summaryRows: { label: string; formula: (col: string) => string }[] = [];

  for (const code of engineerCodes.filter((c) => c.rotates)) {
    summaryRows.push({
      label: `Engineers Count ${code.label}`,
      formula: (col) => `COUNTIF(${col}$${firstEmpRow + 1}:${col}$${lastEmpRow + 1},"${code.id}")`,
    });
  }
  for (const code of engineerCodes.filter((c) => c.rotates)) {
    // Total headcount adds the support categories sharing this shift's tone,
    // mirroring the client's own =COUNTIF(M)+COUNTIF(MT)+COUNTIF(ML).
    const family = codes.filter((c) => c.tone === code.tone && !c.isStatus);
    summaryRows.push({
      label: `Total Head Counts ${code.label}`,
      formula: (col) =>
        family
          .map((c) => `COUNTIF(${col}$${firstEmpRow + 1}:${col}$${lastEmpRow + 1},"${c.id}")`)
          .join('+'),
    });
  }

  const labelStyle = {
    font: { bold: true, italic: true, sz: 10, color: { rgb: 'FF1B2333' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFE8ECF4' } },
    border: BORDER,
  };

  summaryRows.forEach((spec, i) => {
    const r = repeatRow + 1 + i;
    put(r, 0, { t: 's', v: spec.label, s: labelStyle });
    put(r, 1, { t: 's', v: '', s: labelStyle });
    for (const col of columns) {
      const letter = colLetter(FIRST_DATA_COL + col.index);
      put(r, FIRST_DATA_COL + col.index, {
        t: 'n',
        f: spec.formula(letter),
        s: {
          font: { bold: true, sz: 10 },
          alignment: { horizontal: 'center' },
          fill: { patternType: 'solid', fgColor: { rgb: 'FFF5F7FA' } },
          border: BORDER,
        },
      });
    }
  });

  // A quiet credit line under the tables.
  put(repeatRow + summaryRows.length + 2, 0, {
    t: 's',
    v: `Generated by ShiftLine · ${new Date().toISOString().slice(0, 10)}`,
    s: { font: { sz: 8, italic: true, color: { rgb: 'FF8A93A6' } } },
  });

  const lastRow = repeatRow + summaryRows.length + 2;
  const lastCol = LEGEND_COL;

  const sheet: XLSX.WorkSheet = {
    ...cells,
    '!ref': XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } }),
    '!merges': [
      { s: { r: 0, c: 0 }, e: { r: 0, c: FIRST_DATA_COL + nDays - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: lastCol }, e: { r: Math.min(lastRow, 12), c: lastCol } },
      ...summaryRows.map((_, i) => ({
        s: { r: repeatRow + 1 + i, c: 0 },
        e: { r: repeatRow + 1 + i, c: 1 },
      })),
    ],
    '!cols': [
      { wch: 24 },
      { wch: 12 },
      ...columns.map(() => ({ wch: 4.2 })),
      { wch: 7 },
      { wch: 6 },
      { wch: 3 },
      { wch: 30 },
    ],
    '!rows': [{ hpt: 28 }, { hpt: 16 }, { hpt: 18 }],
    // Landscape, squeezed to one page wide — it goes on a wall.
    '!margins': { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    '!pageSetup': { orientation: 'landscape', fitToWidth: 1, fitToHeight: 1, paperSize: 8 },
  };
  (sheet as Record<string, unknown>)['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };

  (sheet as Record<string, unknown>)['!freeze'] = 'C4';

  const wb = XLSX.utils.book_new();
  const sheetName = `${line.prefix}_${line.name}_${MONTH_ABBR[month - 1]}_${year}`.slice(0, 31);
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  return wb;
}

export function downloadXlsx(input: ExportInput): string {
  const wb = buildWorkbook(input);
  const filename = `${input.line.name.replace(/\s+/g, '_')}_Roster_${
    MONTH_ABBR[input.roster.month - 1]
  }_${input.roster.year}.xlsx`;

  // Build the bytes and hand them to the browser directly. `XLSX.writeFile`
  // reaches for Node's fs/stream first, which Vite shims with a warning.
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

// ---------------------------------------------------------------------------
// Operational format export — mirrors the client's sectioned roster exactly
// ---------------------------------------------------------------------------

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Sat 19-Sep-2026" */
function opDateHeader(year: number, month: number, day: number): string {
  const dow = DOW_SHORT[new Date(year, month - 1, day).getDay()];
  const mon = MON_SHORT[month - 1];
  return `${dow} ${String(day).padStart(2, '0')}-${mon}-${year}`;
}

/**
 * Convert a short shift code back to the verbose operational description
 * e.g. "Morning Early | 06:00-16:30 | 11H".
 */
function opShiftText(code: string, codeById: Map<string, ShiftCode>): string {
  if (!code || code === '-' || code === OFF) return 'OFF';
  if (code === 'LV') return 'Annual Leave';
  if (code === 'FLRT') return 'FLRT';

  const def = codeById.get(code);
  if (!def) return code;

  const label = def.label ?? code;
  const timing = def.timing ?? '';
  if (!timing) return label;

  // Compute duration from "HH:MM – HH:MM" or "HH:MM-HH:MM"
  const m = timing.match(/(\d{1,2}):(\d{2})\s*[–\-]\s*(\d{1,2}):(\d{2})/);
  let durStr = '';
  if (m) {
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (end < start) end += 24 * 60; // overnight
    const dur = (end - start) / 60;
    durStr = ` | ${Number.isInteger(dur) ? dur : dur.toFixed(1)}H`;
  }
  return `${label} | ${timing.replace('–', '-')}${durStr}`;
}

/** Section palette colours (header / row background / count row). */
const SECTION_COLORS: Record<string, { header: string; row: string; count: string }> = {
  'PIC-M':   { header: '00B0F0', row: 'DAEEF3', count: 'FFFF00' },
  'PIC-E':   { header: '00B0F0', row: 'DAEEF3', count: 'FFFF00' },
  'PIC-N':   { header: '7030A0', row: 'E4DFEC', count: 'FFFF00' },
  'MP-M':    { header: 'FF8C00', row: 'FCE4D6', count: 'FFFF00' },
  'MP-E':    { header: 'FF8C00', row: 'FCE4D6', count: 'FFFF00' },
  'MP-N':    { header: '7030A0', row: 'E4DFEC', count: 'FFFF00' },
  'DEFAULT': { header: '4472C4', row: 'DCE6F1', count: 'FFFF00' },
};

function sectionKey(role: string | undefined, shift: string): string {
  const r = (role ?? '').toUpperCase();
  const s = /^M/.test(shift) ? 'M' : /^E/.test(shift) ? 'E' : /^N/.test(shift) ? 'N' : shift;
  const k = `${r}-${s}`;
  return k in SECTION_COLORS ? k : 'DEFAULT';
}

function shiftLabel(shift: string): string {
  const m: Record<string, string> = { M: 'Morning', E: 'Evening', N: 'Night', GS: 'General', P: 'Project' };
  return m[shift.charAt(0)] ?? shift;
}

type OCell = XLSX.CellObject & { s?: Record<string, unknown> };

function oc(v: unknown, t: XLSX.ExcelDataType, style?: Record<string, unknown>): OCell {
  return { v, t, s: style } as OCell;
}

function mkHeaderStyle(rgb: string): Record<string, unknown> {
  return {
    fill: { fgColor: { rgb }, patternType: 'solid' },
    font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER,
  };
}

function mkCellStyle(rgb: string, bold = false, align = 'center'): Record<string, unknown> {
  return {
    fill: { fgColor: { rgb }, patternType: 'solid' },
    font: { bold, sz: 9 },
    alignment: { horizontal: align, vertical: 'center', wrapText: true },
    border: BORDER,
  };
}

/**
 * Builds an Excel workbook that reproduces the client's operational format:
 *
 *   Row 1 : title
 *   Row 2 : column headers (Employee | Role | Shift | Total OT | Sat 01-Sep … )
 *   Then employee rows grouped into sections (PIC Morning, MP Morning, …)
 *   with a headcount row after each section.
 */
export function buildOperationalWorkbook({
  roster, employees, codes, line, standardHours = DEFAULT_STANDARD_HOURS,
}: ExportInput): XLSX.WorkBook {
  const { year, month } = roster;
  const nDays = daysInMonth(year, month);
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const hours = employeeHours({ roster, employees, codes, standardHours });

  // ---- group employees into ordered sections -----------------------------
  const sectionOrder: string[] = [];
  const sections = new Map<string, Employee[]>();
  for (const emp of employees) {
    const key = sectionKey(emp.role, emp.defaultShift);
    if (!sections.has(key)) { sections.set(key, []); sectionOrder.push(key); }
    sections.get(key)!.push(emp);
  }

  // ---- build the sheet cell by cell -------------------------------------
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  let rowIdx = 0;

  // Employee | Role | Shift | Total Hours | Total OT | one column per day
  const FIRST_DAY_COL = 5;
  const nCols = FIRST_DAY_COL + nDays;

  const set = (r: number, c: number, cell: OCell) => { ws[XLSX.utils.encode_cell({ r, c })] = cell; };

  // Row 0: title
  const MONTH_NAMES_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const titleText = `${MONTH_NAMES_LONG[month - 1].toUpperCase()} ${year} RST ${line.prefix ?? ''} ${line.name} | BORDERED OPERATIONAL ROSTER`;
  set(rowIdx, 0, oc(titleText, 's', { font: { bold: true, sz: 12 }, alignment: { horizontal: 'left' } }));
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: nCols - 1 } });
  rowIdx++;

  // Row 1: column headers
  const hdrStyle = mkHeaderStyle('1F3864');
  set(rowIdx, 0, oc('Employee', 's', hdrStyle));
  set(rowIdx, 1, oc('Role', 's', hdrStyle));
  set(rowIdx, 2, oc('Shift', 's', hdrStyle));
  set(rowIdx, 3, oc('Total Hours', 's', hdrStyle));
  set(rowIdx, 4, oc(`Total OT (>${standardHours}h/day)`, 's', hdrStyle));
  for (let d = 1; d <= nDays; d++) {
    set(rowIdx, FIRST_DAY_COL + d - 1, oc(opDateHeader(year, month, d), 's', mkHeaderStyle('2E4057')));
  }
  rowIdx++;

  // Section rows
  for (const key of sectionOrder) {
    const emps = sections.get(key)!;
    const colors = SECTION_COLORS[key] ?? SECTION_COLORS['DEFAULT'];
    const firstEmp = emps[0];
    const sRole  = (firstEmp.role ?? '').toUpperCase() || 'STAFF';
    const sShift = shiftLabel(firstEmp.defaultShift);

    // Section header
    const shStyle = mkHeaderStyle(colors.header);
    set(rowIdx, 0, oc(`${sRole} ${sShift} shift`, 's', shStyle));
    for (let c = 1; c < nCols; c++) set(rowIdx, c, oc('', 's', shStyle));
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: nCols - 1 } });
    rowIdx++;

    // Employee rows
    for (const emp of emps) {
      const cells = roster.cells[emp.id] ?? [];
      const overrides = (roster.overrides?.[emp.id] ?? {}) as Record<number, string>;
      const rowBg = colors.row;

      set(rowIdx, 0, oc(emp.name, 's', mkCellStyle(rowBg, true, 'left')));
      set(rowIdx, 1, oc(emp.role ?? '', 's', mkCellStyle(rowBg, false, 'center')));
      set(rowIdx, 2, oc(shiftLabel(emp.defaultShift), 's', mkCellStyle(rowBg, false, 'center')));

      const extras = roster.extraHours?.[emp.id] ?? {};
      for (let d = 0; d < nDays; d++) {
        const code = overrides[d] ?? cells[d]?.code ?? OFF;
        const isOff = code === OFF || code === '-';
        const isLeave = code === 'LV' || code === 'FLRT';
        const extra = extras[d] ?? 0;
        const cellText = opShiftText(code, codeById) + (extra > 0 && !isLeave ? ` | +${extra}H extra` : '');
        const bg = isOff ? 'FFFFFF' : isLeave ? 'FFE6E6' : rowBg;
        set(rowIdx, FIRST_DAY_COL + d, oc(cellText, 's', mkCellStyle(bg, false, 'center')));
      }
      const h = hours[emp.id];
      set(rowIdx, 3, oc(h?.worked ?? 0, 'n', mkCellStyle(rowBg, false, 'center')));
      set(rowIdx, 4, oc(h?.overtime ?? 0, 'n', mkCellStyle(rowBg, (h?.overtime ?? 0) > 0, 'center')));
      rowIdx++;
    }

    // Count row
    const countBg = colors.count;
    set(rowIdx, 0, oc(`${sRole} ${sShift} working count`, 's', mkCellStyle(countBg, true, 'left')));
    for (let c = 1; c < FIRST_DAY_COL; c++) set(rowIdx, c, oc('', 's', mkCellStyle(countBg)));
    for (let d = 0; d < nDays; d++) {
      const count = emps.filter((emp) => {
        const cells = roster.cells[emp.id] ?? [];
        const overrides = (roster.overrides?.[emp.id] ?? {}) as Record<number, string>;
        const code = overrides[d] ?? cells[d]?.code ?? OFF;
        return code !== OFF && code !== '-' && code !== 'LV' && code !== 'FLRT';
      }).length;
      set(rowIdx, FIRST_DAY_COL + d, oc(count > 0 ? count : '', count > 0 ? 'n' : 's', mkCellStyle(countBg, true, 'center')));
    }
    rowIdx++;
    rowIdx++; // blank separator
  }

  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 26 },
    { wch: 6  },
    { wch: 9  },
    { wch: 8  },
    { wch: 10 },
    ...Array.from({ length: nDays }, () => ({ wch: 22 })),
  ];
  ws['!rows'] = [{ hpt: 20 }, { hpt: 40 }];
  ws['!ref'] = `A1:${colLetter(nCols - 1)}${rowIdx}`;

  const wb = XLSX.utils.book_new();
  const sheetName = `${line.prefix ?? line.name}_${MONTH_ABBR[month - 1]}-${year}`.slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

/** Download the operational-format Excel for the active roster. */
export function downloadOperationalXlsx(input: ExportInput): string {
  const wb = buildOperationalWorkbook(input);
  const { line, roster } = input;
  const filename = `${MONTH_ABBR[roster.month - 1]}_${roster.year}_RST_${(line.prefix ?? line.name).replace(/\s+/g, '_')}_ROSTER.xlsx`;
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export interface BackupData {
  lines: Line[];
  employees: Employee[];
  codes: ShiftCode[];
  leave?: import('@/domain/types').LeaveBlock[];
  rosters?: RosterMonth[];
  settings?: unknown;
}

/**
 * Hidden sheet carrying the whole backup as JSON, so restoring an .xlsx is
 * exact. The visible sheets are for reading in Excel; they don't hold enough
 * (rosters, leave, colours, rotations) to rebuild the database from.
 */
export const BACKUP_SHEET = '_ShiftLine';
const BACKUP_MARK = 'ShiftLine backup v1 — do not edit';
/** Excel caps a cell at 32,767 characters. */
const CHUNK = 30000;

export function buildBackupWorkbook(data: BackupData, active?: ActiveRosterHint): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // 1. If rosters exist, append formatted roster sheets
  if (data.rosters && data.rosters.length > 0 && data.lines.length > 0) {
    // Sort: active line+month first, then newest year/month, skip empty lines
    const sortedRosters = [...data.rosters].sort((a, b) => {
      const aIsActive =
        active &&
        a.lineId === active.activeLineId &&
        a.year === active.activeYear &&
        a.month === active.activeMonth;
      const bIsActive =
        active &&
        b.lineId === active.activeLineId &&
        b.year === active.activeYear &&
        b.month === active.activeMonth;
      if (aIsActive && !bIsActive) return -1;
      if (!aIsActive && bIsActive) return 1;
      // Otherwise: same line together, then newest first
      if (a.lineId === b.lineId) {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      }
      // Active line's other months before other lines
      if (active) {
        if (a.lineId === active.activeLineId) return -1;
        if (b.lineId === active.activeLineId) return 1;
      }
      return a.lineId.localeCompare(b.lineId);
    });

    for (const r of sortedRosters) {
      const line = data.lines.find((l) => l.id === r.lineId) ?? data.lines[0];
      const emps = data.employees.filter((e) => e.lineId === r.lineId);
      // Skip rosters where no real employees exist for this line
      if (emps.length === 0) continue;
      // Each line's own codes: an unscoped template code may share a token with it.
      const lineCodes = data.codes.filter((c) => c.scope === r.lineId);
      const rosterWb = buildWorkbook({
        roster: r, employees: emps, codes: lineCodes.length ? lineCodes : data.codes, line,
        standardHours: (data.settings as { standardHours?: number } | undefined)?.standardHours,
      });
      const firstSheetName = rosterWb.SheetNames[0];
      if (firstSheetName && rosterWb.Sheets[firstSheetName]) {
        XLSX.utils.book_append_sheet(wb, rosterWb.Sheets[firstSheetName], firstSheetName);
      }
    }
  }

  // 2. Employees sheet
  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const empRows = data.employees.map((e) => ({
    'ID': e.id,
    'Name': e.name,
    'Contact #': e.contact,
    'Line': data.lines.find((l) => l.id === e.lineId)?.name ?? e.lineId,
    'Default Shift': e.defaultShift,
    'Rest Days': e.restDays.map((d) => WEEKDAY_NAMES[d] ?? d).join(', '),
    'Active': e.active !== false ? 'Yes' : 'No',
    'Pinned': e.pinned ? 'Yes' : 'No',
  }));
  if (empRows.length > 0) {
    const empSheet = XLSX.utils.json_to_sheet(empRows);
    XLSX.utils.book_append_sheet(wb, empSheet, 'Employees');
  }

  // 3. Shift Codes sheet
  const codeRows = data.codes.map((c) => ({
    'Code': c.id,
    'Shift Label': c.label,
    'Timing': c.timing,
    'Colour': c.color ?? c.tone,
    'Min Headcount': c.minHeadcount,
    'Counts As Engineer': c.countsAsEngineer ? 'Yes' : 'No',
    'Rotates': c.rotates ? 'Yes' : 'No',
    'Is Status / Leave': c.isStatus ? 'Yes' : 'No',
  }));
  if (codeRows.length > 0) {
    const codeSheet = XLSX.utils.json_to_sheet(codeRows);
    XLSX.utils.book_append_sheet(wb, codeSheet, 'Shift Codes');
  }

  // 4. Lines sheet
  const lineRows = data.lines.map((l) => ({
    'Line ID': l.id,
    'Line Name': l.name,
    'Prefix': l.prefix,
  }));
  if (lineRows.length > 0) {
    const lineSheet = XLSX.utils.json_to_sheet(lineRows);
    XLSX.utils.book_append_sheet(wb, lineSheet, 'Lines');
  }

  // 5. Leave blocks
  if (data.leave && data.leave.length > 0) {
    const leaveRows = data.leave.map((l) => ({
      'Employee': data.employees.find((e) => e.id === l.employeeId)?.name ?? l.employeeId,
      'From Date': l.from,
      'To Date': l.to,
      'Status Code': l.code,
      'Note': l.note ?? '',
    }));
    const leaveSheet = XLSX.utils.json_to_sheet(leaveRows);
    XLSX.utils.book_append_sheet(wb, leaveSheet, 'Leave');
  }

  // 6. Exact copy of everything, hidden, for restore
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...data });
  const chunks: string[][] = [[BACKUP_MARK]];
  for (let i = 0; i < json.length; i += CHUNK) chunks.push([json.slice(i, i + CHUNK)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chunks), BACKUP_SHEET);
  wb.Workbook ??= {};
  wb.Workbook.Sheets ??= [];
  wb.Workbook.Sheets[wb.SheetNames.indexOf(BACKUP_SHEET)] = { Hidden: 1 };

  return wb;
}

export interface ActiveRosterHint {
  activeLineId: string;
  activeYear: number;
  activeMonth: number;
}

export function downloadBackupXlsx(data: BackupData, active?: ActiveRosterHint): string {
  const wb = buildBackupWorkbook(data, active);
  const filename = `ShiftLine_Backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}


/* ------------------------------------------------ original-template export */

/**
 * Writes the month back into the layout of the workbook it was imported from.
 *
 * The supervisor's template is what management already reads, so a round-trip
 * should hand it back unchanged in shape: the same title banner, the header
 * row in the same place, their own extra columns (role, OT, remarks) carried
 * through verbatim, and the day headers spelled exactly as they spelled them.
 * Only the shift letters inside the grid are ours, coloured by code.
 */
export function buildFromLayout(
  { roster, employees, codes, standardHours = DEFAULT_STANDARD_HOURS }: Omit<ExportInput, 'line'>,
  layout: SheetLayout,
): XLSX.WorkBook {
  const nDays = daysInMonth(roster.year, roster.month);
  const byId = new Map(codes.map((c) => [c.id, c]));
  const hours = employeeHours({ roster, employees, codes, standardHours });
  // Their own "OT" / "Total Hours" columns are refilled from the roster
  // rather than copied, so they always match the shifts written beside them.
  const otCol = layout.otherCols.find((c) => /\bO\.?T\b|over\s*time/i.test(c.header))?.col;
  const hoursCol = layout.otherCols.find(
    (c) => c.col !== otCol && /\b(total\s*)?(hours|hrs)\b/i.test(c.header),
  )?.col;
  const sheet: Record<string, Cell | unknown> = {};
  let maxRow = layout.headerRow;
  let maxCol = layout.nameCol;

  const put = (r: number, c: number, cell: Cell) => {
    sheet[XLSX.utils.encode_cell({ r, c })] = cell;
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  };

  // Title banner and anything else above the header row, exactly as it was.
  for (const { r, c, value } of layout.preamble) {
    put(r, c, typeof value === 'number'
      ? { t: 'n', v: value, s: { font: { bold: r === 0, sz: r === 0 ? 13 : 11 } } }
      : { t: 's', v: String(value), s: { font: { bold: r === 0, sz: r === 0 ? 13 : 11 } } });
  }

  const headStyle = {
    font: { bold: true, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: BORDER,
  };

  // Header row: their column titles, their day-header spelling.
  for (const { col, header } of layout.otherCols) {
    put(layout.headerRow, col, { t: 's', v: header, s: { ...headStyle, alignment: { horizontal: 'left' } } });
  }
  for (const { col, header } of layout.dayCols) {
    put(layout.headerRow, col, { t: 's', v: header, s: headStyle });
  }

  // One row per employee, in the app's current order.
  employees.forEach((emp, i) => {
    const r = layout.headerRow + 1 + i;
    const extras = layout.extraByName[emp.name] ?? {};

    put(r, layout.nameCol, {
      t: 's', v: emp.name,
      s: { font: { sz: 10 }, alignment: { horizontal: 'left' }, border: BORDER },
    });
    // Their own columns (role, contact, OT …) travel with the person.
    const h = hours[emp.id];
    for (const { col } of layout.otherCols) {
      if (col === layout.nameCol) continue;
      const v = col === otCol ? h?.overtime ?? 0 : col === hoursCol ? h?.worked ?? 0 : extras[col];
      if (v === undefined) continue;
      put(r, col, typeof v === 'number'
        ? { t: 'n', v, s: { font: { sz: 10 }, alignment: { horizontal: 'center' }, border: BORDER } }
        : { t: 's', v: String(v), s: { font: { sz: 10 }, alignment: { horizontal: 'center' }, border: BORDER } });
    }

    const row = roster.cells[emp.id] ?? [];
    for (const { day, col } of layout.dayCols) {
      if (day > nDays) continue;
      const code = row[day - 1]?.code ?? OFF;
      const colour = exportColors(byId.get(code));
      put(r, col, {
        t: 's',
        v: code === OFF ? '' : code,
        s: {
          font: { sz: 10, bold: true, color: { rgb: colour.font } },
          fill: { patternType: 'solid', fgColor: { rgb: colour.fill } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: BORDER,
        },
      });
    }
  });

  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  sheet['!cols'] = Array.from({ length: maxCol + 1 }, (_, c) =>
    layout.dayCols.some((d) => d.col === c) ? { wch: 4.5 } : { wch: c === layout.nameCol ? 24 : 10 },
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet as XLSX.WorkSheet, layout.sheetName.slice(0, 31));
  return wb;
}

/** Downloads the month in its original imported layout. Returns the filename. */
export function downloadFromLayout(input: Omit<ExportInput, 'line'>, layout: SheetLayout): string {
  const wb = buildFromLayout(input, layout);
  const filename = `${layout.sheetName.replace(/[^\w.-]+/g, '_')}_${MONTH_ABBR[input.roster.month - 1]}-${input.roster.year}.xlsx`;
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
