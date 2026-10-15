/**
 * Domain types for the roster planner.
 *
 * Nothing in `src/domain` imports React or touches the DOM — the scheduling
 * engine is plain data-in / data-out so it can be tested exhaustively against
 * the client's real September sheet.
 */

/** 0 = Sunday … 6 = Saturday (matches JS `Date.getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The literal written into a roster cell when somebody is not working. */
export const OFF = '-';

/**
 * A shift code is user-defined data, not a hard-coded union.
 *
 * The client's sheet uses more codes than its own legend shows: the
 * `Total Head Counts` formulas reference MT/ML/ET/EL/NT/NL alongside M/E/N,
 * and `FLRT` appears as a whole-month status. So the code set has to be
 * editable at runtime.
 */
export interface ShiftCode {
  /** The token written into the grid, e.g. "M", "E", "N", "GS", "P". */
  id: string;
  /** Human name, e.g. "Morning". */
  label: string;
  /** Free-text timing shown in the legend, e.g. "06:00 – 15:00". */
  timing: string;
  /**
   * Palette key: the cell colour, and the shift family a code belongs to
   * (Morning, Night …) for headcount totals and rotation.
   */
  tone: ShiftTone;
  /**
   * Optional own colour, "#RRGGBB", drawn instead of the tone's palette so
   * codes sharing a family can still be told apart. The tone keeps its role.
   */
  color?: string;
  /** Minimum people required on this shift every working day. */
  minHeadcount: number;
  /**
   * Counted in the "Engineers Count" rows. The client's sheet excludes
   * MT/ML-style codes from engineers but includes them in total headcount.
   */
  countsAsEngineer: boolean;
  /** Included in the fair auto-rotation pool (M/E/N yes; GS/P no). */
  rotates: boolean;
  /** A non-working status (leave, training) rather than a worked shift. */
  isStatus?: boolean;
  /**
   * The `Line.id` that owns this code.
   *
   * Every line keeps its own set, so changing Night's minimum on one line
   * leaves the others alone and a code an import invents for one line never
   * appears on another. Undefined marks the starter set that new lines are
   * copied from; those rows are a template and are never shown on a grid.
   */
  scope?: string;
  order: number;
}

export type ShiftTone = 'morning' | 'evening' | 'night' | 'general' | 'project' | 'leave' | 'off';

/** A production line / team. Each owns its own people and rosters. */
export interface Line {
  id: string;
  name: string;
  /** Shown in exported sheet titles, e.g. "SLV" → "SLV_Line 5_Roster_SEP_2026". */
  prefix: string;
  order: number;
}

/**
 * A mid-month shift change, expressed as an inclusive day-of-month range.
 *
 * The client already rotates within a month — Abdul Saeed runs N for days
 * 1–12, E for 13–26, then M for 27–30 — so a person's shift is a schedule,
 * not a single value.
 */
export interface RotationRule {
  fromDay: number; // inclusive, 1-based
  toDay: number; // inclusive, 1-based
  code: string; // ShiftCode.id
}

/** A leave / vacation / training block, as an inclusive ISO date range. */
export interface LeaveBlock {
  id: string;
  employeeId: string;
  from: string; // "2026-09-20"
  to: string; // "2026-09-30"
  code: string; // ShiftCode.id of a status code, e.g. "LV" or "FLRT"
  note?: string;
}

export interface Employee {
  id: string;
  lineId: string;
  name: string;
  contact: string;
  /** Operational role, e.g. "PIC", "MP", "CM" — populated when importing an operational roster. */
  role?: string;
  /** Row order in the grid. The client groups his sheet by shift. */
  order: number;
  /** Shift used on any working day not covered by a rotation rule. */
  defaultShift: string;
  /**
   * The person's fixed weekly rest-day pair.
   *
   * This is the key that makes the whole month generatable: every employee in
   * the client's sheet works a strict 5-on / 2-off weekly cycle with a fixed
   * pair of rest weekdays.
   */
  restDays: Weekday[];
  /** Per-month mid-month shift changes, keyed "YYYY-MM". */
  rotations?: Record<string, RotationRule[]>;
  /** Excluded from auto-rotation (fixed GS/project staff). */
  pinned?: boolean;
  active?: boolean;
  /** Whether this person is a Team Leader (rotates on 2-week cycle while engineers remain steady). */
  isLeader?: boolean;
}

/** One resolved grid cell. */
export interface Cell {
  code: string; // ShiftCode.id, or OFF
  /** How this value was decided — drives the "locked" affordance in the UI. */
  source: 'manual' | 'leave' | 'rest' | 'rotation' | 'default';
}

/**
 * A generated month for one line.
 *
 * `cells[employeeId]` is an array with one entry per day of the month,
 * index 0 = the 1st.
 */
export interface RosterMonth {
  id: string; // `${lineId}:${year}-${month}`
  lineId: string;
  year: number;
  month: number; // 1-12
  cells: Record<string, Cell[]>;
  /** Hand edits, kept separate so regenerating never destroys them. */
  overrides: Record<string, Record<number, string>>; // empId -> dayIndex -> code
  /**
   * Hours worked on top of a day's shift, entered by hand. They count towards
   * overtime (see `domain/hours.ts`) and, like overrides, survive a regenerate.
   */
  extraHours?: Record<string, Record<number, number>>; // empId -> dayIndex -> hours
  updatedAt: number;
}

/**
 * Where everything sat in an imported workbook, so Export can write the month
 * back in the supervisor's own template rather than ShiftLine's layout.
 */
export interface SheetLayout {
  sheetName: string;
  /** Row holding "Name", "Employee", … (0-based). */
  headerRow: number;
  /** Column holding employee names (0-based). */
  nameCol: number;
  /** Everything above the header row, verbatim, e.g. a title banner. */
  preamble: { r: number; c: number; value: string | number }[];
  /** Header text for every non-day column, so they can be rewritten as-is. */
  otherCols: { col: number; header: string }[];
  /** Non-day cell values per employee row, keyed by column index. */
  extraByName: Record<string, Record<number, string | number>>;
  /** Day number -> column index, and the exact header text used. */
  dayCols: { day: number; col: number; header: string }[];
}

export type Severity = 'error' | 'warning';

export interface Issue {
  id: string;
  severity: Severity;
  rule: IssueRule;
  message: string;
  employeeId?: string;
  /** 0-based day index within the month. */
  dayIndex?: number;
  shiftCode?: string;
  /** For 'work-order-short': the work orders (ids) that are not fully staffed. */
  workOrderIds?: string[];
}

export type IssueRule =
  | 'below-minimum'
  | 'empty-shift'
  | 'night-to-morning'
  | 'too-many-consecutive'
  | 'rest-days-violated'
  | 'working-while-on-leave'
  /** Work orders that day + shift need more people than the roster has on it. */
  | 'work-order-short'
  /** Work order rows whose imported data had to be guessed (no date, unknown line …). */
  | 'work-order-data';

/** Per-day headcount totals — the client's sheet rows 27–32. */
export interface DaySummary {
  /** Working engineers per shift code. */
  engineers: Record<string, number>;
  /** All heads per shift code, engineers + support categories. */
  total: Record<string, number>;
  off: number;
  onLeave: number;
}

/** Work order activity types. */
export type WorkType = 'PM' | 'CM' | 'ACS' | string;

export interface WorkOrder {
  id: string;
  workOrderId: string; // e.g. "13445509"
  description: string;
  workType: WorkType; // "PM" | "CM" | "ACS"
  line: string; // "L4" | "L5" | "L6"
  department?: string; // "Div / Depart": SLV, TSM …
  /** Day the work is placed on the Planner and counted in shift demand (ISO). */
  scheduledStart: string;
  /** Kept for older records; imports set it to Finish No Later Than. */
  scheduledFinish: string;
  /** Asset / location code. */
  location?: string;
  /** Date the work order was raised (reference: ageing). */
  reportedDate?: string;
  /** Allowed window start (ISO). */
  startNoEarlier?: string;
  /** Planned target start (reference: target vs scheduled). */
  targetStart?: string;
  /** Allowed window end (ISO) — "past Finish No Later Than" / "outside window". */
  finishNoLater?: string;
  /** DCS, SIG, ISM, CCT, PAS … */
  assetGroup?: string;
  /** Values of extra columns added to WORK_ORDER_COLUMNS that the app has no field for. */
  extra?: Record<string, string>;
  targetFinish?: string;
  status: 'APPR' | 'INPRG' | 'COMPLETED' | string;
  resourceRequired: number; // e.g. 2 for PM, 1 for CM

  // Active assignment state
  plannedDay?: number; // 1..31
  plannedShift?: 'M' | 'E' | 'N';
  /**
   * 'manual' = the crew in assignedEmployeeIds was picked by hand and is kept
   * while those people are still on that shift. Otherwise the crew is worked
   * out live from the roster (see domain/workloadLive.ts) and the stored
   * assignment fields below are ignored.
   */
  crewMode?: 'auto' | 'manual';
  /**
   * Where the crew size (resourceRequired) comes from:
   * 'file'     — the Excel row gave a number
   * 'standard' — the row gave none: use Setup → Work Order Resource Standards
   *              for this line + work type + shift (resourceRequired is ignored)
   * 'manual'   — changed by hand in Work Orders
   * Older records without this field are treated as 'standard' when they hold
   * the old built-in default (PM 2, CM 2, ACS 1), otherwise as 'file'.
   */
  crewSource?: 'file' | 'standard' | 'manual';
  /** Problems found in this row when the Excel file was imported (missing/unreadable values). */
  importWarnings?: string[];
  assignedEmployeeIds?: string[];
  assignedEmployeeNames?: string[];
  allocationStatus?: 'OK' | 'SHORT' | 'CONFLICT' | 'UNASSIGNED';
  conflictReason?: string;
}

export interface ResourceRequirement {
  id: string;
  line: string; // "L4", "L5", "L6"
  workType: string; // "PM", "CM", "ACS"
  shift: 'morning' | 'evening' | 'night' | 'all';
  defaultPeopleCount: number;
  department?: string;
}

export interface AllocationRecord {
  id: string;
  workOrderId: string;
  personId: string;
  personName: string;
  allocatedDate: string; // "YYYY-MM-DD"
  shift: string; // "M" | "E" | "N"
  allocatedBy?: string;
  notes?: string;
  allocationStatus: 'confirmed' | 'tentative' | 'conflict';
}

export interface ShiftWorkloadBalance {
  line: string;
  shift: 'M' | 'E' | 'N';
  shiftLabel: string;
  availableStaff: number; // working engineers from roster
  pmRequired: number;
  cmReserve: number;
  acsRequired: number;
  totalAllocated: number;
  buffer: number; // availableStaff - totalAllocated
  status: 'ok' | 'short' | 'tight';
}

