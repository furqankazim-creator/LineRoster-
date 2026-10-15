import XLSX from 'xlsx-js-style';

import { MONTH_ABBR, daysInMonth } from '@/domain/calendar';
import { inferDefaultShift, inferRestDays, inferRotations } from '@/domain/generator';
import { OFF, type Employee, type LeaveBlock, type Line, type RosterMonth, type RotationRule, type SheetLayout, type ShiftCode, type Weekday } from '@/domain/types';

export interface ImportedEmployee {
  name: string;
  contact: string;
  /** Operational role (e.g. "PIC", "MP") detected when the adjacent column holds a role code. */
  role?: string;
  codes: string[];
  restDays: Weekday[];
  defaultShift: string;
  rotations: RotationRule[];
  leaveRanges: { from: number; to: number }[];
}

export interface ImportResult {
  sheetName: string;
  year: number;
  month: number;
  lineName: string | null;
  employees: ImportedEmployee[];
  /** Codes seen in the sheet that the app doesn't know about yet. */
  unknownCodes: string[];
  warnings: string[];
  /** The source file's shape, for round-tripping on export. */
  layout: SheetLayout;
}

const KNOWN_WORKED = ['M', 'E', 'N', 'GS', 'P', 'MT', 'ET', 'NT', 'ML', 'EL', 'NL'];

/** Parses a title like "Line 5_SEP-2026 Roster" or "SEPTEMBER 2026 RST L5" into its parts. */
function parseTitle(title: string): { lineName: string | null; year: number | null; month: number | null } {
  // Matches full month names or 3-letter abbreviations, followed by an optional separator, and a 4-digit year.
  // Example: "SEP-2026", "SEPTEMBER 2026"
  const monthMatch = title.match(/(?:^|[^A-Za-z])([A-Za-z]{3})[A-Za-z]*[-_ ]*(\d{4})/i);
  // Matches "Line 5", "Line5", "L5", "L 5"
  const lineMatch = title.match(/(?:Line|L)\s*(\d+)/i);
  const monthIndex = monthMatch ? MONTH_ABBR.indexOf(monthMatch[1].toUpperCase()) : -1;
  return {
    lineName: lineMatch ? `Line ${lineMatch[1]}` : null,
    year: monthMatch ? Number(monthMatch[2]) : null,
    month: monthIndex >= 0 ? monthIndex + 1 : null,
  };
}

export function listSheets(buffer: ArrayBuffer): string[] {
  return XLSX.read(buffer, { type: 'array', cellStyles: true }).SheetNames;
}

export function normalizeShiftCode(raw: string, isRed?: boolean): string {
  const text = raw.trim();
  if (isRed && (!text || text === OFF || /^off$/i.test(text))) return 'LV';
  if (!text || text === '-' || /^off$/i.test(text) || /^tbd$/i.test(text)) return OFF;

  if (/^flrt/i.test(text)) return 'FLRT';
  if (/leave|annual|vacation|sick|\blv\b/i.test(text)) return 'LV';

  const upper = text.toUpperCase();
  if (KNOWN_WORKED.includes(upper)) return upper;

  // Verbose operational shift formats (e.g., "Morning Early | 06:00-16:30 | 10.5H")
  if (/^morning/i.test(text)) {
    if (/morning\s*t/i.test(text)) return 'MT';
    if (/morning\s*l/i.test(text)) return 'ML';
    return 'M';
  }
  if (/^evening/i.test(text)) {
    if (/evening\s*t/i.test(text)) return 'ET';
    if (/evening\s*l/i.test(text)) return 'EL';
    return 'E';
  }
  if (/^night/i.test(text)) {
    if (/night\s*t/i.test(text)) return 'NT';
    if (/night\s*l/i.test(text)) return 'NL';
    return 'N';
  }
  if (/^general/i.test(text) || /^gs\b/i.test(text)) return 'GS';
  if (/^project/i.test(text) || /^p\b/i.test(text)) return 'P';

  return upper;
}

/**
 * Reads one of the client's roster sheets back into planner rules.
 *
 * His sheets carry no rest-day or rotation columns — that information only
 * exists as a visual pattern. So this works backwards from the grid: where
 * `-` (or a blank) falls reveals each person's rest-day pair, where the worked
 * code changes reveals their mid-month rotation, and a red fill over an empty
 * cell reveals a leave block.
 */
export function importSheet(buffer: ArrayBuffer, sheetName?: string): ImportResult {
  const wb = XLSX.read(buffer, { type: 'array', cellStyles: true });
  const name = sheetName ?? wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Sheet "${name}" not found in that workbook.`);

  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const warnings: string[] = [];

  const at = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  const text = (r: number, c: number) => String(at(r, c)?.v ?? '').trim();

  // ---- locate the header row and which column holds employee names -------
  // The client's various Excel versions place "Name" (or an alias) anywhere
  // in the first 5 columns and first 20 rows, so we scan broadly.
  const NAME_ALIASES = new Set([
    'name', 'names', 'employee', 'employee name', 'staff', 'staff name',
    'engineer', 'personnel', 'worker',
  ]);
  let headerRow = -1;
  let nameCol = 0; // column index that holds the employee name
  outer: for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 5); c++) {
      if (NAME_ALIASES.has(text(r, c).toLowerCase())) {
        headerRow = r;
        nameCol = c;
        break outer;
      }
    }
  }
  if (headerRow === -1) {
    throw new Error(
      'Could not find a "Name" or "Employee" header row — is this a roster sheet?',
    );
  }

  // ---- month and year --------------------------------------------------
  const title = text(range.s.r, 0) || name;
  let { lineName, year, month } = parseTitle(title);
  if (!year || !month) {
    const fromName = parseTitle(name);
    year ??= fromName.year;
    month ??= fromName.month;
    lineName ??= fromName.lineName;
  }
  // If still not found, inspect header cells for date formats like "Sat 19-Sep-2026"
  if (!year || !month) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = at(headerRow, c);
      const textVal = String(cell?.w || cell?.v || '');
      const parsed = parseTitle(textVal);
      if (parsed.year && parsed.month) {
        year ??= parsed.year;
        month ??= parsed.month;
        lineName ??= parsed.lineName;
        break;
      }
    }
  }
  if (!year || !month) {
    throw new Error(
      `Could not work out the month from "${title}". Expected something with month and year like "Line 5_SEP-2026" or "SEPTEMBER 2026".`,
    );
  }

  // ---- day columns: numeric headers on the header row ------------------
  // Start scanning after nameCol+1 (Name + Contact columns) so those cols
  // are never misread as day numbers even if they contain small integers.
  const dayCols: { day: number; col: number; header: string }[] = [];
  for (let c = nameCol + 2; c <= range.e.c; c++) {
    const cell = at(headerRow, c);
    const v = cell?.v;
    // Prefer formatted text (cell.w) — critical for date-serial cells where
    // cell.v is a large integer like 46701 and cell.w is "01-Sep-2026".
    const w = String(cell?.w || '').trim() || String(v ?? '').trim();

    let n: number = NaN;

    // Only use v directly when it's already a valid day number (1–31).
    // Date serials (>31) must go through text parsing instead.
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31) {
      n = v;
    } else {
      // Parse text like "Tue 01-Sep-2026", "01-Sep-2026", "19 Sep", "19"
      // Support zero-padded days (01–09) and two-digit days (10–31).
      const m = w.match(/(?:^|[^\d])(0?[1-9]|[12]\d|3[01])(?:[-/\s]|$)/);
      if (m) {
        n = Number(m[1]);
      } else {
        const m2 = w.match(/(0?[1-9]|[12]\d|3[01])/);
        if (m2) n = Number(m2[1]);
      }
    }

    if (Number.isInteger(n) && n >= 1 && n <= 31) {
      if (!dayCols.some((d) => d.day === n)) dayCols.push({ day: n, col: c, header: w });
    }
  }
  dayCols.sort((a, b) => a.day - b.day);

  const expected = daysInMonth(year, month);
  if (dayCols.length !== expected) {
    warnings.push(
      `Found ${dayCols.length} day columns but ${MONTH_ABBR[month - 1]} ${year} has ${expected} days.`,
    );
  }

  // ---- remember the source layout for export ---------------------------
  const dayColSet = new Set(dayCols.map((d) => d.col));
  const preamble: SheetLayout['preamble'] = [];
  for (let r = range.s.r; r < headerRow; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = at(r, c)?.v;
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        preamble.push({ r, c, value: v as string | number });
      }
    }
  }
  const otherCols: SheetLayout['otherCols'] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (!dayColSet.has(c)) otherCols.push({ col: c, header: text(headerRow, c) });
  }
  const extraByName: SheetLayout['extraByName'] = {};

  // ---- employee rows ---------------------------------------------------
  const employees: ImportedEmployee[] = [];
  const unknown = new Set<string>();

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const rowName = text(r, nameCol);
    if (!rowName) continue;

    // Skip section headers (e.g. "PIC Morning shift", "MP Night shift") and count rows
    const isCountRow = /count|total|days=>|generated by/i.test(rowName);
    const isSectionHeader =
      /^(?:pic|mp|engineer|technician|staff|operator)?\s*(?:morning|evening|night|general|project)\s+shift$/i.test(rowName) ||
      (NAME_ALIASES.has(rowName.toLowerCase()) && r !== headerRow);

    if (isCountRow || isSectionHeader) {
      continue;
    }

    const codes: string[] = [];
    const leaveDays: number[] = [];

    for (let i = 0; i < expected; i++) {
      const entry = dayCols[i];
      const cell = entry ? at(r, entry.col) : undefined;
      const rawCode = String(cell?.w || cell?.v || '').trim();
      const isRed = isRedFill(cell);

      let code = normalizeShiftCode(rawCode, isRed);
      if (code === 'LV') {
        leaveDays.push(i + 1);
      }

      codes.push(code);
      if (code !== OFF && code !== 'LV' && code !== 'FLRT' && !KNOWN_WORKED.includes(code)) {
        unknown.add(code);
      }
    }

    // A whole-month merged status cell only stores a value in its first column.
    if (codes[0] === 'FLRT' && codes.slice(1).every((c) => c === OFF)) {
      codes.fill('FLRT');
    }

    const workedSet = new Set(KNOWN_WORKED);
    const restDays = inferRestDays(codes, year, month);
    const defaultShift = inferDefaultShift(codes, workedSet, 'GS');
    const rotations = inferRotations(codes, workedSet);

    // Detect whether column nameCol+1 is a role identifier (PIC, MP, CM, …)
    // or a phone contact number. If it's a role, also peek at nameCol+2 for a
    // possible contact number (operational roster has: Name | Role | Shift | OT | …).
    const col1Val = text(r, nameCol + 1);
    const ROLE_CODES = /^(PIC|MP|CM|UFWL|GS|SV|TL|OP|TEC|ENG|SUP|ADM)$/i;
    let role: string | undefined;
    let contact = '';
    if (ROLE_CODES.test(col1Val)) {
      role = col1Val.toUpperCase();
      // contact might be in a later column — skip for now (OT cols are numbers)
    } else {
      contact = col1Val;
    }

    // Keep this row's non-day cells (role, OT hours, remarks …) verbatim.
    const extras: Record<number, string | number> = {};
    for (const { col } of otherCols) {
      const v = at(r, col)?.v;
      if (v !== undefined && v !== null && String(v).trim() !== '') extras[col] = v as string | number;
    }
    extraByName[rowName] = extras;

    employees.push({
      name: rowName,
      contact,
      role,
      codes,
      restDays,
      defaultShift,
      rotations,
      leaveRanges: toRanges(codes),
    });
  }

  if (employees.length === 0) warnings.push('No employee rows were found under the header.');

  return {
    sheetName: name,
    year,
    month,
    lineName,
    employees,
    unknownCodes: [...unknown],
    warnings,
    layout: { sheetName: name, headerRow, nameCol, preamble, otherCols, extraByName, dayCols },
  };
}

/**
 * True when a cell carries a solid red background.
 *
 * SheetJS puts the fill straight on `cell.s` (`s.fgColor`), not under an
 * `s.fill` object, and reports the colour as 6-digit RGB without the ARGB
 * alpha the raw XML uses — so both shapes are accepted here.
 */
function isRedFill(cell: XLSX.CellObject | undefined): boolean {
  const s = (cell as { s?: Record<string, unknown> } | undefined)?.s;
  if (!s) return false;
  const fg =
    (s.fgColor as { rgb?: string } | undefined)?.rgb ??
    ((s.fill as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb);
  if (typeof fg !== 'string') return false;
  const rgb = fg.length === 8 ? fg.slice(2) : fg;
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return r >= 0xc0 && g <= 0x60 && b <= 0x60;
}

/** Collapses consecutive status days into inclusive day ranges. */
function toRanges(codes: string[]): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let start = -1;

  codes.forEach((code, i) => {
    const isLeave = code === 'LV' || code === 'FLRT';
    if (isLeave && start === -1) start = i + 1;
    if (!isLeave && start !== -1) {
      ranges.push({ from: start, to: i });
      start = -1;
    }
  });
  if (start !== -1) ranges.push({ from: start, to: codes.length });

  return ranges;
}

/** Turns a parsed sheet into rows ready for the database. */
export function toRecords(
  result: ImportResult,
  lineId: string,
  idFor: (name: string, index: number) => string,
): { employees: Employee[]; leave: LeaveBlock[] } {
  const key = `${result.year}-${String(result.month).padStart(2, '0')}`;
  const employees: Employee[] = [];
  const leave: LeaveBlock[] = [];

  result.employees.forEach((row, i) => {
    const id = idFor(row.name, i);
    employees.push({
      id,
      lineId,
      name: row.name,
      contact: row.contact,
      role: row.role,
      order: i + 1,
      defaultShift: row.defaultShift,
      restDays: row.restDays,
      rotations: row.rotations.length ? { [key]: row.rotations } : undefined,
      pinned: !['M', 'E', 'N'].includes(row.defaultShift),
      active: true,
    });

    row.leaveRanges.forEach((range, j) => {
      const code = row.codes[range.from - 1] === 'FLRT' ? 'FLRT' : 'LV';
      leave.push({
        id: `lv-${id}-${j}`,
        employeeId: id,
        from: `${key}-${String(range.from).padStart(2, '0')}`,
        to: `${key}-${String(range.to).padStart(2, '0')}`,
        code,
        note: 'Imported from Excel',
      });
    });
  });

  return { employees, leave };
}

/**
 * Restores data from an Excel workbook (.xlsx).
 * Handles both full backup workbooks (with Employees/Codes tabs) and single/multi-month roster workbooks.
 */
/** Hidden sheet written by buildBackupWorkbook; mirrors BACKUP_SHEET in exportXlsx. */
const BACKUP_SHEET = '_ShiftLine';

export function importBackupWorkbook(buffer: ArrayBuffer): {
  employees: Employee[];
  lines?: Line[];
  codes?: ShiftCode[];
  leave?: LeaveBlock[];
  rosters?: RosterMonth[];
  settings?: unknown;
} {
  const wb = XLSX.read(buffer, { type: 'array', cellStyles: true });
  const sheetNames = wb.SheetNames;

  // Case 0: a backup this app wrote — the hidden sheet holds everything exactly.
  if (sheetNames.includes(BACKUP_SHEET)) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[BACKUP_SHEET], { header: 1 });
    const json = rows.slice(1).map((r) => String(r[0] ?? '')).join('');
    try {
      return JSON.parse(json);
    } catch {
      throw new Error('The backup data inside this workbook is damaged. Restore from an unedited copy.');
    }
  }

  // Case 1: Workbook contains an 'Employees' sheet (backup edited by hand in Excel)
  if (sheetNames.includes('Employees')) {
    const empSheet = wb.Sheets['Employees'];
    const empRows: any[] = XLSX.utils.sheet_to_json(empSheet);
    const DAY_MAP: Record<string, Weekday> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

    const lines: Line[] = sheetNames.includes('Lines')
      ? (XLSX.utils.sheet_to_json(wb.Sheets['Lines']) as any[]).map((r, i) => ({
          id: String(r['Line ID'] ?? `line${i + 1}`),
          name: String(r['Line Name'] ?? `Line ${i + 1}`),
          prefix: String(r['Prefix'] ?? 'SLV'),
          order: i + 1,
        }))
      : [];
    // The Employees sheet shows the line's display name; map it back to the id.
    const lineIdByName = new Map(lines.map((l) => [l.name.toLowerCase(), l.id]));

    const employees: Employee[] = empRows.map((r, i) => {
      const restText = String(r['Rest Days'] ?? '').toLowerCase();
      const restDays: Weekday[] = restText
        .split(',')
        .map((s) => s.trim().slice(0, 3))
        .filter((s) => s in DAY_MAP)
        .map((s) => DAY_MAP[s]);

      return {
        id: String(r['ID'] ?? `e${i + 1}`),
        name: String(r['Name'] ?? 'Employee'),
        contact: String(r['Contact #'] ?? r['Contact'] ?? ''),
        lineId: lineIdByName.get(String(r['Line'] ?? '').toLowerCase()) ?? String(r['Line'] ?? 'line5').toLowerCase().replace(/\s+/g, ''),
        defaultShift: String(r['Default Shift'] ?? 'M'),
        restDays: restDays.length ? restDays : [5, 6],
        order: i + 1,
        active: String(r['Active'] ?? 'yes').toLowerCase() !== 'no',
        pinned: String(r['Pinned'] ?? 'no').toLowerCase() === 'yes',
      };
    });

    const codes: ShiftCode[] = sheetNames.includes('Shift Codes')
      ? (XLSX.utils.sheet_to_json(wb.Sheets['Shift Codes']) as any[]).map((r, i) => ({
          id: String(r['Code'] ?? `C${i}`),
          label: String(r['Shift Label'] ?? r['Label'] ?? r['Code']),
          timing: String(r['Timing'] ?? '08:00 – 17:00'),
          minHeadcount: Number(r['Min Headcount'] ?? 0),
          countsAsEngineer: String(r['Counts As Engineer'] ?? 'yes').toLowerCase() === 'yes',
          rotates: String(r['Rotates'] ?? 'no').toLowerCase() === 'yes',
          isStatus: String(r['Is Status / Leave'] ?? 'no').toLowerCase() === 'yes',
          tone: 'general' as const,
          order: i + 1,
        }))
      : [];

    return {
      employees,
      lines: lines.length ? lines : undefined,
      codes: codes.length ? codes : undefined,
    };
  }

  // Case 2: Standard roster workbook — parse first valid roster sheet
  const firstSheet = importSheet(buffer);
  return toRecords(firstSheet, 'line5', (_n, i) => `e${String(i + 1).padStart(2, '0')}`);
}
