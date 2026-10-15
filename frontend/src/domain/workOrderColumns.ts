/**
 * Work-order Excel import: WHICH columns are read, and how.
 *
 * Only the columns listed here are read (the yellow, mandatory headers of the
 * client's work-order sheet). Every other column in the file is ignored.
 * Columns are matched by HEADER NAME, never by position, so reordering or
 * inserting columns in Excel does not break the import.
 *
 * ── Adding a column later ────────────────────────────────────────────────
 * Add one entry to WORK_ORDER_COLUMNS. No importer code changes:
 *
 *   { excelHeader: 'Priority', appField: 'priority', required: true, type: 'text',
 *     usedFor: 'Job priority (1–4)' },
 *
 * - `required: true`  → a missing column or blank cell is reported
 *                       ("Row 45: Priority missing").
 * - `appField` that the app already knows (see WorkOrder) is filled directly;
 *   any other name is kept in `workOrder.extra[appField]` and shown in reports.
 * - `type` controls parsing/validation: text | date | line | number.
 */

export type ColumnType = 'text' | 'date' | 'line' | 'number';

export interface WorkOrderColumn {
  /** Header text exactly as in the Excel file (case, spaces and punctuation are ignored when matching). */
  excelHeader: string;
  /** Other spellings of the same header seen in client files. */
  aliases?: string[];
  /** Field on the work order this column fills. */
  appField: string;
  required: boolean;
  type: ColumnType;
  /** Plain-language purpose, shown in the "Yellow Headings Guide". */
  usedFor: string;
}

export const WORK_ORDER_COLUMNS: WorkOrderColumn[] = [
  { excelHeader: 'Work Order', aliases: ['WO', 'WO Number', 'Work Order No'], appField: 'workOrderId', required: true, type: 'text',
    usedFor: 'Work order ID — the key every row, alert and report links to.' },
  { excelHeader: 'Description', appField: 'description', required: true, type: 'text',
    usedFor: 'Task description. Also used to tell PM / CM / ACS apart (see work-type rules).' },
  { excelHeader: 'Location', appField: 'location', required: true, type: 'text',
    usedFor: 'Asset / location code of the worksite.' },
  { excelHeader: 'Reported Date', appField: 'reportedDate', required: true, type: 'date',
    usedFor: 'Date the work order was raised — reference only (ageing).' },
  { excelHeader: 'Start No Earlier Than', aliases: ['Start No Earlier'], appField: 'startNoEarlier', required: true, type: 'date',
    usedFor: 'Start of the allowed window.' },
  { excelHeader: 'Target Start', appField: 'targetStart', required: true, type: 'date',
    usedFor: 'Planned target start — reference only (target vs. scheduled).' },
  { excelHeader: 'Scheduled Start', appField: 'scheduledStart', required: true, type: 'date',
    usedFor: 'The day the activity is placed on the Planner and counted in shift demand.' },
  { excelHeader: 'Finish No Later Than', aliases: ['Finish No Later', 'Finish Note Later Date'], appField: 'finishNoLater', required: true, type: 'date',
    usedFor: 'End of the allowed window — drives "past Finish No Later Than" and "outside window".' },
  { excelHeader: 'Div / Depart', aliases: ['Div/Dept', 'Division', 'Department', 'Div Depart'], appField: 'department', required: true, type: 'text',
    usedFor: 'Department / division, e.g. SLV, TSM.' },
  { excelHeader: 'Line', appField: 'line', required: true, type: 'line',
    usedFor: 'Line 5 / 4&6 — which team staffs the work (Line 4&6 are one team).' },
  { excelHeader: 'Asset Group', appField: 'assetGroup', required: true, type: 'text',
    usedFor: 'DCS, SIG, ISM, CCT, PAS, …' },
];

/**
 * Work type is not one of the yellow columns, so it is worked out from the
 * Description. First matching rule wins; anything else is PM (planned work).
 * If the client later adds a "Work Type" column, add it to WORK_ORDER_COLUMNS
 * with appField 'workType' and it takes precedence over these rules.
 */
export const WORK_TYPE_RULES: { type: 'PM' | 'CM' | 'ACS'; pattern: RegExp }[] = [
  { type: 'CM', pattern: /\b(fault|failure|failed|breakdown|corrective|repair|defect|cm)\b/i },
  { type: 'ACS', pattern: /\b(acs|audit|access control)\b/i },
];

/** Built-in yellow columns + the ones added in Setup (built-in wins on a clash). */
export function allWorkOrderColumns(custom: WorkOrderColumn[] = []): WorkOrderColumn[] {
  const taken = new Set(WORK_ORDER_COLUMNS.flatMap((c) => [c.excelHeader, ...(c.aliases ?? [])].map(headerKey)));
  return [...WORK_ORDER_COLUMNS, ...custom.filter((c) => !taken.has(headerKey(c.excelHeader)))];
}

/** Field name for a column added in Setup: "Job Priority" → "jobPriority". */
export function fieldFromHeader(header: string): string {
  const words = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('') || 'column';
}

/** Header text → comparable key ("Div / Depart" → "divdepart"). */
export function headerKey(text: unknown): string {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
