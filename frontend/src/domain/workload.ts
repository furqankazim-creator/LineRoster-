import * as XLSX from 'xlsx-js-style';

import type { ResourceRequirement, WorkOrder } from './types';
import { WORK_ORDER_COLUMNS, WORK_TYPE_RULES, headerKey, type WorkOrderColumn } from './workOrderColumns';

/** Normalizes line name/token into standard 'L4' | 'L5' | 'L6' */
export function normalizeLineCode(raw: string | undefined): 'L4' | 'L5' | 'L6' {
  if (!raw) return 'L5';
  const clean = String(raw).trim().toUpperCase();
  if (clean.includes('4') || clean === 'L4') return 'L4';
  if (clean.includes('6') || clean === 'L6') return 'L6';
  return 'L5';
}

/** Converts 'line4' | 'line5' | 'line6' into 'L4' | 'L5' | 'L6' */
export function lineIdToCode(lineId: string): 'L4' | 'L5' | 'L6' {
  if (lineId === 'line4') return 'L4';
  if (lineId === 'line6') return 'L6';
  return 'L5';
}

/** Converts 'L4' | 'L5' | 'L6' into 'line4' | 'line5' | 'line6' */
export function lineCodeToId(code: string): string {
  if (code === 'L4') return 'line4';
  if (code === 'L6') return 'line6';
  return 'line5';
}

/** Normalizes Work Type into PM, CM, ACS */
export function normalizeWorkType(raw: string | undefined): 'PM' | 'CM' | 'ACS' {
  if (!raw) return 'PM';
  const clean = String(raw).trim().toUpperCase();
  if (clean.startsWith('P') || clean.includes('PREV')) return 'PM';
  if (clean.startsWith('C') || clean.includes('CORR')) return 'CM';
  if (clean.includes('ACS') || clean.includes('CHECK') || clean.includes('INSP')) return 'ACS';
  return 'PM';
}

/**
 * Parses an uploaded November Work Orders Excel file (Nov-Workorders.xlsx).
 * Handles flexible header names matching the yellow highlighted mandatory columns:
 * 1. Work Order ID (Col A: 'Work Order')
 * 2. Scheduled Start Date (Col J: 'Start No Earlier' / Col N: 'Scheduled Start')
 * 3. Scheduled Finish Date (Col O: 'Finish No Later' / Col Q: 'Scheduled Finish')
 * 4. Line / Location (Col D: 'Location' / Col W: 'Line')
 * 5. Resource Required ('Resource Required' / default PM:2, CM:2, ACS:1)
 *
 * All other columns (Description, Department, Work Type, Asset, Status) are optional display columns.
 */
/** Reads a date from a cell, or null when it can't be read (so callers can flag it). */
export function tryParseDate(raw: any): string | null {
  if (!raw) return null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // ISO: YYYY-MM-DD
  const isoMatch = str.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
    const d = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // US format: M/D/YY or MM/DD/YYYY (or DD/MM/YYYY if day > 12)
  const usMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (usMatch) {
    let y = parseInt(usMatch[3], 10);
    if (y < 100) y += 2000; // 26 -> 2026
    let partA = parseInt(usMatch[1], 10);
    let partB = parseInt(usMatch[2], 10);
    let month = partA;
    let day = partB;
    if (partA > 12 && partB <= 12) {
      day = partA;
      month = partB;
    }
    const m = String(Math.min(12, Math.max(1, month))).padStart(2, '0');
    const d = String(Math.min(31, Math.max(1, day))).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Date parsing fallback
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

export function parseDateToIso(raw: any, fallbackYear = 2026, fallbackMonth = 11): string {
  return tryParseDate(raw) ?? `${fallbackYear}-${String(fallbackMonth).padStart(2, '0')}-01`;
}

/** Strict line reading for imports: "L4", "Line 5", "6", "Line 4&6", "L4-6" → L4/L5/L6, anything else → null. */
export function parseLineCode(raw: unknown): 'L4' | 'L5' | 'L6' | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(?:l|line)?\s*0?([456])$/i);
  if (m) return `L${m[1]}` as 'L4' | 'L5' | 'L6';
  if (/^(?:line\s*5|l5|5)\b/i.test(s) && !/(?:4|6)/.test(s)) return 'L5';
  if (/(?:4\s*(?:&|-|\/|,|and|_|\+)\s*(?:line\s*)?6|l4[-_&]l?6|4\s*&\s*6)/i.test(s)) return 'L4';
  if (/\b(?:line\s*5|l5)\b/i.test(s) && !/(?:line\s*4|l4|line\s*6|l6)/i.test(s)) return 'L5';
  if (/\b(?:line\s*4|l4)\b/i.test(s) && !/(?:line\s*6|l6)/i.test(s)) return 'L4';
  if (/\b(?:line\s*6|l6)\b/i.test(s) && !/(?:line\s*4|l4)/i.test(s)) return 'L6';
  return null;
}

/** Work type from a "Work Type" column if one is configured, else from the description. */
export function deriveWorkType(description: string, explicit?: string): 'PM' | 'CM' | 'ACS' {
  if (explicit && explicit.trim()) return normalizeWorkType(explicit);
  return WORK_TYPE_RULES.find((r) => r.pattern.test(description))?.type ?? 'PM';
}

export interface WorkOrderImportResult {
  workOrders: WorkOrder[];
  /** Data rows read (blank rows skipped). */
  totalRows: number;
  /** One line per problem, e.g. "Row 45: Scheduled Start missing". */
  warnings: string[];
  /** Whole-file problems, e.g. a configured column not found. */
  fileErrors: string[];
  /** Excel row number of the header row (1-based). */
  headerRow: number;
}

/** Fields a configured column may fill directly on a WorkOrder; anything else goes to `extra`. */
const KNOWN_FIELDS = new Set([
  'workOrderId', 'description', 'location', 'reportedDate', 'startNoEarlier', 'targetStart',
  'scheduledStart', 'finishNoLater', 'department', 'line', 'assetGroup', 'workType', 'status',
]);

/**
 * Reads the work-order sheet using WORK_ORDER_COLUMNS (see workOrderColumns.ts):
 * only those columns, matched by header name; every problem is reported, never
 * silently replaced with a made-up value.
 */
export function parseWorkOrdersWorkbook(
  buffer: ArrayBuffer,
  columns: WorkOrderColumn[] = WORK_ORDER_COLUMNS,
): WorkOrderImportResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('The Excel file contains no sheets.');
  const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, raw: true, defval: '', blankrows: true,
  });

  // Header row = the row (within the first 20) that matches the most configured headers
  const keysFor = (c: WorkOrderColumn) => [c.excelHeader, ...(c.aliases ?? [])].map(headerKey);
  let headerIdx = -1;
  let bestHits = 0;
  grid.slice(0, 20).forEach((row, i) => {
    const cells = new Set(row.map(headerKey));
    const hits = columns.filter((c) => keysFor(c).some((k) => cells.has(k))).length;
    if (hits > bestHits) { bestHits = hits; headerIdx = i; }
  });
  if (headerIdx < 0 || bestHits < 2) {
    throw new Error(
      `No work-order header row found. Expected columns such as ${columns.slice(0, 4).map((c) => `"${c.excelHeader}"`).join(', ')}.`,
    );
  }

  const header = grid[headerIdx].map(headerKey);
  const colIndex = new Map<WorkOrderColumn, number>();
  const fileErrors: string[] = [];
  for (const c of columns) {
    const idx = header.findIndex((h) => h && keysFor(c).includes(h));
    if (idx >= 0) colIndex.set(c, idx);
    else if (c.required) fileErrors.push(`Column "${c.excelHeader}" not found in the file`);
  }

  const workOrders: WorkOrder[] = [];
  const warnings: string[] = [];
  const rowOf = new Map<WorkOrder, number>();

  grid.slice(headerIdx + 1).forEach((row, i) => {
    const excelRow = headerIdx + i + 2;
    const raw = (c: WorkOrderColumn) => {
      const idx = colIndex.get(c);
      return idx === undefined ? '' : row[idx];
    };
    if ([...colIndex.values()].every((idx) => String(row[idx] ?? '').trim() === '')) return; // blank row

    const problems: string[] = [];
    const values: Record<string, string> = {};
    for (const c of columns) {
      if (!colIndex.has(c)) continue; // already reported for the whole file
      const v = raw(c);
      const text = v instanceof Date ? '' : String(v ?? '').trim();
      if (!(v instanceof Date) && text === '') {
        if (c.required) problems.push(`Row ${excelRow}: ${c.excelHeader} missing`);
        values[c.appField] = '';
        continue;
      }
      if (c.type === 'date') {
        const iso = tryParseDate(v);
        if (!iso) problems.push(`Row ${excelRow}: ${c.excelHeader} "${text}" is not a date`);
        values[c.appField] = iso ?? '';
      } else if (c.type === 'line') {
        const line = parseLineCode(text);
        if (!line) problems.push(`Row ${excelRow}: ${c.excelHeader} "${text}" is not L4, L5 or L6`);
        values[c.appField] = line ?? '';
      } else if (c.type === 'number') {
        if (isNaN(Number(text))) problems.push(`Row ${excelRow}: ${c.excelHeader} "${text}" is not a number`);
        values[c.appField] = text;
      } else {
        values[c.appField] = text;
      }
    }

    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (!KNOWN_FIELDS.has(k)) extra[k] = v;

    const workOrderId = values.workOrderId || `ROW-${excelRow}`;
    const description = values.description || '';
    const wo: WorkOrder = {
      id: `wo-${workOrderId.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${excelRow}`,
      workOrderId,
      description,
      workType: deriveWorkType(description, values.workType),
      line: values.line ?? '',
      department: values.department || undefined,
      location: values.location || undefined,
      assetGroup: values.assetGroup || undefined,
      reportedDate: values.reportedDate || undefined,
      startNoEarlier: values.startNoEarlier || undefined,
      targetStart: values.targetStart || undefined,
      scheduledStart: values.scheduledStart ?? '',
      finishNoLater: values.finishNoLater || undefined,
      scheduledFinish: values.finishNoLater || values.scheduledStart || '',
      targetFinish: values.finishNoLater || undefined,
      status: values.status || '',
      // Crew size is not a yellow column: it comes from Setup → Resource Standards
      resourceRequired: 0,
      crewSource: 'standard',
      extra: Object.keys(extra).length ? extra : undefined,
      importWarnings: problems.length ? problems : undefined,
    };
    workOrders.push(wo);
    rowOf.set(wo, excelRow);
  });

  // The same work order number twice is usually a copy-paste slip in the sheet
  const count = new Map<string, number>();
  for (const wo of workOrders) count.set(wo.workOrderId, (count.get(wo.workOrderId) ?? 0) + 1);
  for (const wo of workOrders) {
    const n = count.get(wo.workOrderId) ?? 1;
    if (n > 1 && !wo.workOrderId.startsWith('ROW-')) {
      wo.importWarnings = [
        ...(wo.importWarnings ?? []),
        `Row ${rowOf.get(wo)}: Work Order ${wo.workOrderId} appears ${n} times in the file`,
      ];
    }
  }
  for (const wo of workOrders) warnings.push(...(wo.importWarnings ?? []));

  return { workOrders, totalRows: workOrders.length, warnings, fileErrors, headerRow: headerIdx + 1 };
}

/**
 * Returns default resource requirements for a line, type, and shift.
 */
export function getRequiredCrewCount(
  requirements: ResourceRequirement[],
  line: string,
  workType: string,
  shift: 'morning' | 'evening' | 'night',
): number {
  // Line 4 & 6 are one team with one set of standards, kept under L4
  const normLine = normalizeLineCode(line) === 'L6' ? 'L4' : normalizeLineCode(line);
  const normType = normalizeWorkType(workType);

  const matched = requirements.find(
    (r) =>
      r.line === normLine &&
      r.workType === normType &&
      (r.shift === shift || r.shift === 'all'),
  );

  if (matched) return matched.defaultPeopleCount;
  // Fallbacks from client requirements
  if (normType === 'PM') return 2;
  if (normType === 'CM') return 2;
  return 1;
}
