import type { WorkOrderColumn } from '@/domain/workOrderColumns';
import { DUMMY_NAMES } from './dummyNames';
import Dexie, { type EntityTable } from 'dexie';

import type {
  AllocationRecord,
  Employee,
  LeaveBlock,
  Line,
  ResourceRequirement,
  RosterMonth,
  SheetLayout,
  ShiftCode,
  WorkOrder,
} from '@/domain/types';
import {
  SEED_CODES,
  SEED_LINES,
  SEED_RESOURCE_REQUIREMENTS,
} from './seed';
import defaultDatabase from './defaultDatabase.json';

export type FontSize = 'xs' | 'compact' | 'normal' | 'large' | 'xl';
export type FontFamily =
  | 'default'
  | 'roboto'
  | 'segoe'
  | 'apple'
  | 'open-sans'
  | 'plex'
  | 'mono'
  | 'calibri'
  | 'serif'
  | 'system'
  | 'sans';

export interface ImportedSheetRecord {
  sheetName: string;
  lineId: string;
  year: number;
  month: number;
  importedAt: number;
  fileName?: string;
  employeeCount?: number;
}

export interface Settings {
  key: 'app';
  theme: 'dark' | 'light';
  activeLineId: string;
  activeYear: number;
  activeMonth: number;
  /** Weekday columns tinted as the weekend. The client runs Fri/Sat. */
  weekendDays: number[];
  maxConsecutive: number;
  /** A standard working day. Hours past this, or on a rest day, are overtime. */
  standardHours: number;
  seeded: boolean;
  zoomLevel: number;
  fontSize: FontSize;
  fontFamily: FontFamily;
  /**
   * The month each line was last on, keyed by line id.
   *
   * Lines cover different periods — one sheet is imported for August, another
   * for October — so switching line returns to where that line was rather
   * than carrying the current month across.
   */
  lineMonths?: Record<string, { year: number; month: number }>;
  /**
   * Extra Excel columns added in Setup → Excel import columns. Read on top of
   * the built-in yellow columns (see domain/workOrderColumns.ts).
   */
  customWorkOrderColumns?: WorkOrderColumn[];
  /** excelHeader of built-in yellow columns removed in Setup — no longer read on import. */
  removedBuiltinColumns?: string[];
  /** Report of the last work-order Excel import, shown on the Work Orders page. */
  lastWorkOrderImport?: WorkOrderImportReport;
  /** History of sheets imported via Excel import modal */
  importedSheets?: Record<string, ImportedSheetRecord>;
  /** Timestamp of last db mutation for cloud synchronization. */
  updatedAt?: number;
}

export interface WorkOrderImportReport {
  fileName: string;
  at: number;
  rows: number;
  headerRow: number;
  /** Which sheet of the workbook was read. */
  sheetName?: string;
  /** Whole-file problems, e.g. a configured column not found. */
  fileErrors: string[];
  /** Rows with at least one problem. */
  problemRows: number;
}

export const THEME_STORAGE_KEY = 'shiftline-theme';
export const ACTIVE_VIEW_STORAGE_KEY = 'shiftline-active-view';

export interface StoredActiveView {
  activeLineId?: string;
  activeYear?: number;
  activeMonth?: number;
  lineMonths?: Record<string, { year: number; month: number }>;
}

export function getStoredActiveView(): StoredActiveView | null {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function saveStoredActiveView(view: Partial<StoredActiveView>): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const current = getStoredActiveView() || {};
      const merged: StoredActiveView = {
        ...current,
        ...view,
        lineMonths: {
          ...(current.lineMonths || {}),
          ...(view.lineMonths || {}),
        },
      };
      localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      /* ignore */
    }
  }
}

export function getStoredTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.theme) {
    const d = document.documentElement.dataset.theme;
    if (d === 'light' || d === 'dark') return d;
  }
  return 'dark';
}

export function saveStoredTheme(theme: 'light' | 'dark'): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = theme;
  }
}

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  theme: getStoredTheme(),
  activeLineId: 'line5',
  activeYear: 2026,
  activeMonth: 9,
  weekendDays: [5, 6],
  maxConsecutive: 6,
  standardHours: 9,
  seeded: false,
  zoomLevel: 100,
  fontSize: 'normal',
  fontFamily: 'default',
  lineMonths: {},
  importedSheets: {},
};

/**
 * Primary key for a shift code.
 *
 * Codes are identified in the grid by their token ("M", "H"), but a token is
 * only unique within its scope: two imported sheets may each define their own
 * "H". The stored row therefore carries a surrogate key combining the two.
 */
export function codeKey(id: string, scope?: string): string {
  return `${scope ?? '*'}::${id}`;
}

/** The starter set a newly created line is given, as its own private copy. */
export async function seedCodesForLine(lineId: string): Promise<void> {
  const template = await db.shiftCodes.filter((c) => !c.scope).toArray();
  const source = template.length ? template : SEED_CODES;
  await db.shiftCodes.bulkPut(
    source.map(({ key: _k, ...c }: ShiftCode & { key?: string }) => ({
      ...c, scope: lineId, key: codeKey(c.id, lineId),
    })),
  );
}

/** Extra codes switched on for one month via the brush's "+" picker. */
export interface StoredMonthCodes {
  rosterId: string;
  codeIds: string[];
}

/** An imported sheet's layout, keyed by the roster it belongs to. */
export interface StoredLayout {
  rosterId: string;
  layout: SheetLayout;
}

/** A ShiftCode as stored: the surrogate primary key is added on write. */
export type StoredShiftCode = ShiftCode & { key: string };

class RosterDB extends Dexie {
  lines!: EntityTable<Line, 'id'>;
  employees!: EntityTable<Employee, 'id'>;
  /**
   * Named `shiftCodes` rather than `codes` because the primary key changed
   * from the bare token to (scope, token), and IndexedDB cannot re-key a
   * store in place — the rows are copied into this table and the old one is
   * dropped. See v3/v4 below.
   */
  shiftCodes!: EntityTable<StoredShiftCode, 'key'>;
  leave!: EntityTable<LeaveBlock, 'id'>;
  rosters!: EntityTable<RosterMonth, 'id'>;
  settings!: EntityTable<Settings, 'key'>;
  /** Source-file shape per roster, so Export can mirror an imported template. */
  layouts!: EntityTable<StoredLayout, 'rosterId'>;
  /** Codes added to a single month's brush that its grid does not use yet. */
  monthCodes!: EntityTable<StoredMonthCodes, 'rosterId'>;
  /** Ingested Work Orders (Nov-Workorders.xlsx) */
  workOrders!: EntityTable<WorkOrder, 'id'>;
  /** Shift-level resource requirement rules (PM / CM / ACS per line) */
  resourceRequirements!: EntityTable<ResourceRequirement, 'id'>;
  /** Named allocations audit log */
  allocations!: EntityTable<AllocationRecord, 'id'>;

  constructor(name: string = 'shiftline') {
    super(name);
    this.version(1).stores({
      lines: 'id, order',
      employees: 'id, lineId, order',
      codes: 'id, order',
      leave: 'id, employeeId, from, to',
      rosters: 'id, lineId, [year+month]',
      settings: 'key',
    });

    // v2: add ML / EL / NL to existing databases so they appear globally on all
    // lines — not just on lines where an import happened to create them.
    this.version(2).stores({}).upgrade(async (tx) => {
      const EXTRA: ShiftCode[] = [
        { id: 'ML', label: 'Morning Late', timing: '07:00 – 18:00', tone: 'morning', minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 11 },
        { id: 'EL', label: 'Evening Late', timing: '15:00 – 00:00', tone: 'evening', minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 12 },
        { id: 'NL', label: 'Night Late',   timing: '19:00 – 07:00', tone: 'night',   minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 13 },
      ];
      const codesTable = tx.table<ShiftCode, string>('codes');
      for (const code of EXTRA) {
        const existing = await codesTable.get(code.id);
        if (!existing) await codesTable.put(code);
      }
    });

    // v3: codes become keyed by (scope, id), so an imported sheet can own a
    // code token without it appearing on every other month's brush.
    //
    // IndexedDB cannot change a store's primary key, so the rows are copied
    // into a new `shiftCodes` store here and the old `codes` store is dropped
    // in v4. Existing codes have no scope, so they stay global — nothing
    // disappears on upgrade.
    this.version(3).stores({
      shiftCodes: 'key, id, scope, order',
    }).upgrade(async (tx) => {
      const old = await tx.table('codes').toArray();
      if (old.length) {
        await tx.table('shiftCodes').bulkPut(
          old.map((c) => ({ ...c, key: codeKey(c.id, c.scope) })),
        );
      }
    });

    // v4: drop the re-keyed store, and remember the layout of an imported
    // workbook so Export can write the month back in that same shape.
    this.version(4).stores({ codes: null, layouts: 'rosterId' });

    // v5: a month can switch on an existing code without a private copy of it.
    // Earlier builds cloned the code instead, which listed it twice in Setup;
    // those duplicates are dropped here.
    this.version(5).stores({ monthCodes: 'rosterId' }).upgrade(async (tx) => {
      const table = tx.table('shiftCodes');
      const all = await table.toArray();
      const globalIds = new Set(all.filter((c) => !c.scope).map((c) => c.id));
      const perMonth = new Map<string, string[]>();
      for (const c of all) {
        if (!c.scope || !globalIds.has(c.id)) continue;
        perMonth.set(c.scope, [...(perMonth.get(c.scope) ?? []), c.id]);
        await table.delete(c.key);
      }
      for (const [rosterId, codeIds] of perMonth) {
        await tx.table('monthCodes').put({ rosterId, codeIds });
      }
    });

    // v6: each line keeps its own shift codes, so editing one line's Night
    // minimum no longer changes every other line's. The unscoped rows stay as
    // the template new lines are copied from.
    this.version(6).stores({}).upgrade(async (tx) => {
      const table = tx.table('shiftCodes');
      const lines = await tx.table('lines').toArray();
      const all = await table.toArray();
      const template = all.filter((c) => !c.scope);

      for (const line of lines) {
        // Anything previously scoped to one of this line's months becomes a
        // code of the line itself.
        const fromMonths = all.filter((c) => c.scope?.startsWith(`${line.id}:`));
        const own = new Map<string, Record<string, unknown>>();
        for (const c of template) own.set(c.id, { ...c });
        for (const c of fromMonths) own.set(c.id, { ...c });
        for (const c of own.values()) {
          await table.put({ ...c, scope: line.id, key: codeKey(c.id as string, line.id) });
        }
      }
      // Drop the month-scoped rows now that the line owns them.
      for (const c of all) {
        if (c.scope && c.scope.includes(':')) await table.delete(c.key);
      }
    });

    // v7: Work Orders & Resource Requirements integration (November work orders + October patterns)
    this.version(7).stores({
      workOrders: 'id, workOrderId, line, workType, status, plannedDay, plannedShift',
      resourceRequirements: 'id, line, workType, shift',
      allocations: 'id, workOrderId, personId, allocatedDate, shift',
    }).upgrade(async (tx) => {
      // Work orders are never seeded: each team starts empty and imports its own file
      const rrTable = tx.table('resourceRequirements');
      await rrTable.bulkPut(SEED_RESOURCE_REQUIREMENTS);
    });

    // v8: swap real staff names for demo names
    this.version(8).stores({}).upgrade(async (tx) => {
      await tx.table('employees').toCollection().modify((e) => {
        const name = DUMMY_NAMES[e.id];
        if (name) e.name = name;
      });
    });
  }
}

let activeDbName = 'shiftline';
let currentDb = new RosterDB('shiftline');

export function getActiveDbName(): string {
  return activeDbName;
}

export function setActiveDatabase(name: string = 'shiftline'): RosterDB {
  if (name !== activeDbName) {
    activeDbName = name;
    currentDb = new RosterDB(name);
  }
  return currentDb;
}

export const db: RosterDB = new Proxy({} as RosterDB, {
  get(_target, prop, receiver) {
    const val = Reflect.get(currentDb, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(currentDb);
    }
    return val;
  },
});

export interface SeedOptions {
  isolated?: boolean;
  mirror?: boolean;
  allowedLineId?: string;
}

/**
 * Loads the initial database on first run.
 * For isolated collaborators, it initializes a clean workspace with 0 employees and 0 work orders.
 * For live mirror collaborators, it takes a private snapshot of the supervisor's screen so they see the exact roster and work orders, but edits remain 100% private.
 */
export async function ensureSeeded(options?: SeedOptions): Promise<void> {
  const existing = await db.settings.get('app');

  // If this session is an isolated scratch workspace:
  if (options?.isolated) {
    const targetLine = options.allowedLineId && options.allowedLineId !== 'all' ? options.allowedLineId : 'line5';

    // In a scratch workspace, if the user hasn't explicitly imported an Excel roster sheet yet,
    // employees, rosters, and leave MUST be completely empty (0 people).
    const hasImportedSheets = existing?.importedSheets && Object.keys(existing.importedSheets).length > 0;
    if (!hasImportedSheets) {
      await db.transaction('rw', [db.employees, db.rosters, db.leave], async () => {
        await db.employees.clear();
        await db.rosters.clear();
        await db.leave.clear();
      });
    }

    // In a scratch workspace, if the user hasn't explicitly imported work orders yet,
    // work orders and allocations MUST be completely empty (0 work orders, 0 shortfalls).
    if (!existing?.lastWorkOrderImport) {
      await db.transaction('rw', [db.workOrders, db.allocations], async () => {
        await db.workOrders.clear();
        await db.allocations.clear();
      });
    }

    if (!existing?.seeded) {
      await db.transaction(
        'rw',
        [db.lines, db.shiftCodes, db.settings, db.resourceRequirements],
        async () => {
          await db.lines.bulkPut(SEED_LINES);
          await db.shiftCodes.bulkPut(SEED_CODES.map((c) => ({ ...c, key: codeKey(c.id) })));
          for (const line of SEED_LINES) {
            await db.shiftCodes.bulkPut(
              SEED_CODES.map((c) => ({ ...c, scope: line.id, key: codeKey(c.id, line.id) })),
            );
          }
          await db.resourceRequirements.bulkPut(SEED_RESOURCE_REQUIREMENTS);
          await db.settings.put({
            ...DEFAULT_SETTINGS,
            activeLineId: targetLine,
            seeded: true,
          });
        },
      );
    }
    return;
  }

  // If this session is a Live Mirror collaborator workspace:
  if (options?.mirror) {
    if (existing?.seeded) {
      if (options.allowedLineId && options.allowedLineId !== 'all' && existing.activeLineId !== options.allowedLineId) {
        await db.settings.put({ ...existing, activeLineId: options.allowedLineId });
      }
      return;
    }

    // On first open, snapshot supervisor's current screen:
    let cloned = false;
    try {
      const masterDb = new RosterDB('shiftline');
      const mLines = await masterDb.lines.toArray();
      const mEmployees = await masterDb.employees.toArray();
      if (mLines.length > 0 || mEmployees.length > 0) {
        const [mCodes, mLeave, mRosters, mSettings, mWos, mReqs, mAllocs, mLayouts, mMonthCodes] = await Promise.all([
          masterDb.shiftCodes.toArray(),
          masterDb.leave.toArray(),
          masterDb.rosters.toArray(),
          masterDb.settings.get('app'),
          masterDb.workOrders.toArray(),
          masterDb.resourceRequirements.toArray(),
          masterDb.allocations.toArray(),
          masterDb.layouts.toArray(),
          masterDb.monthCodes.toArray(),
        ]);

        await db.transaction(
          'rw',
          [db.lines, db.employees, db.shiftCodes, db.leave, db.rosters, db.settings, db.workOrders, db.resourceRequirements, db.allocations, db.layouts, db.monthCodes],
          async () => {
            if (mLines.length) await db.lines.bulkPut(mLines);
            if (mEmployees.length) await db.employees.bulkPut(mEmployees);
            if (mCodes.length) await db.shiftCodes.bulkPut(mCodes);
            if (mLeave.length) await db.leave.bulkPut(mLeave);
            if (mRosters.length) await db.rosters.bulkPut(mRosters);
            if (mWos.length) await db.workOrders.bulkPut(mWos);
            if (mReqs.length) await db.resourceRequirements.bulkPut(mReqs);
            if (mAllocs.length) await db.allocations.bulkPut(mAllocs);
            if (mLayouts.length) await db.layouts.bulkPut(mLayouts);
            if (mMonthCodes.length) await db.monthCodes.bulkPut(mMonthCodes);

            const targetLine = options.allowedLineId && options.allowedLineId !== 'all'
              ? options.allowedLineId
              : (mSettings?.activeLineId || 'line5');

            await db.settings.put({
              ...DEFAULT_SETTINGS,
              ...mSettings,
              activeLineId: targetLine,
              seeded: true,
            });
          },
        );
        cloned = true;
      }
    } catch {
      /* ignore and fallback */
    }

    // If local browser masterDb had no data, try server backup:
    if (!cloned && typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/api/collab/db');
        if (res.ok) {
          const json = await res.json();
          if (json.ok && json.data && Array.isArray(json.data.lines) && json.data.lines.length > 0) {
            await importBackupData(json.data);
            if (options.allowedLineId && options.allowedLineId !== 'all') {
              const s = await db.settings.get('app');
              await db.settings.put({ ...DEFAULT_SETTINGS, ...s, activeLineId: options.allowedLineId, seeded: true });
            }
            cloned = true;
          }
        }
      } catch {}
    }

    // Fallback to default seed if neither was available:
    if (!cloned) {
      await importBackupData(defaultDatabase);
      if (options.allowedLineId && options.allowedLineId !== 'all') {
        const s = await db.settings.get('app');
        await db.settings.put({ ...DEFAULT_SETTINGS, ...s, activeLineId: options.allowedLineId, seeded: true });
      }
      return;
    }
    return;
  }

  // Check if initial seeding has occurred
  const isStaleOrEmpty = !existing || !existing.seeded;

  // Fast path: if local database already has valid data, return immediately for instant 0ms reload!
  if (existing?.seeded && !isStaleOrEmpty) {
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      setTimeout(async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const res = await fetch('/api/collab/db', { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) {
            const json = await res.json();
            if (json.ok && json.data && Array.isArray(json.data.lines) && json.data.lines.length > 0) {
              const current = await db.settings.get('app');
              const localTime = current?.updatedAt || 0;
              const serverTime = json.data.updatedAt || 0;
              if (serverTime > localTime) {
                await importBackupData(json.data);
              } else if (localTime > serverTime && getActiveDbName() === 'shiftline') {
                const backup = await getFullBackupData();
                await fetch('/api/collab/db', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(backup),
                });
              }
            }
          }
        } catch {}
      }, 50);
    }
    return;
  }

  // 1. Try to fetch the master database from the server (so all browsers / sessions sync together)
  let serverData: any = null;
  if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('/api/collab/db', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.data && Array.isArray(json.data.lines) && json.data.lines.length > 0) {
          serverData = json.data;
        }
      }
    } catch {
      /* offline / vercel static fallback */
    }
  }

  // 2. On Vercel or offline without backend server: use defaultDatabase as authoritative initial seed
  if (!serverData && isStaleOrEmpty) {
    serverData = defaultDatabase;
  }

  // 3. If server or default database is available:
  if (serverData) {
    const localUpdatedAt = existing?.updatedAt || 0;
    const serverUpdatedAt = serverData.updatedAt || 0;
    if (isStaleOrEmpty || serverUpdatedAt > localUpdatedAt) {
      await importBackupData(serverData);
      return;
    } else if (localUpdatedAt > serverUpdatedAt && getActiveDbName() === 'shiftline') {
      try {
        const backup = await getFullBackupData();
        await fetch('/api/collab/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backup),
        });
      } catch {}
      return;
    }
  }

  if (isStaleOrEmpty) {
    await importBackupData(defaultDatabase);
    return;
  }

  // Push newly seeded data to server so it is ready for other sessions (supervisor only):
  if (getActiveDbName() === 'shiftline' && typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      const backup = await getFullBackupData();
      await fetch('/api/collab/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
      });
    } catch {}
  }
}

export async function getSettings(): Promise<Settings> {
  const current = await db.settings.get('app');
  const activeTheme = getStoredTheme();
  if (!current) {
    return { ...DEFAULT_SETTINGS, theme: activeTheme };
  }
  return { ...DEFAULT_SETTINGS, ...current, theme: current.theme || activeTheme };
}

export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  if (patch.theme) {
    saveStoredTheme(patch.theme);
  }
  if (patch.activeLineId || patch.activeYear || patch.activeMonth || patch.lineMonths) {
    saveStoredActiveView({
      activeLineId: patch.activeLineId,
      activeYear: patch.activeYear,
      activeMonth: patch.activeMonth,
      lineMonths: patch.lineMonths,
    });
  }
  const current = await getSettings();
  const merged: any = {
    ...current,
    ...patch,
    lineMonths: patch.lineMonths ? { ...(current.lineMonths || {}), ...patch.lineMonths } : current.lineMonths,
    updatedAt: Date.now(),
    key: 'app',
  };
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) {
      delete merged[k];
    }
  }
  await db.settings.put(merged);
}

export async function getFullBackupData() {
  const [lines, employees, codes, leave, rosters, settings, workOrders, resourceRequirements, allocations, monthCodes, layouts] = await Promise.all([
    db.lines.toArray(),
    db.employees.toArray(),
    db.shiftCodes.toArray(),
    db.leave.toArray(),
    db.rosters.toArray(),
    getSettings(),
    db.workOrders.toArray(),
    db.resourceRequirements.toArray(),
    db.allocations.toArray(),
    db.monthCodes.toArray(),
    db.layouts.toArray(),
  ]);
  const updatedAt = Date.now();
  await db.settings.update('app', { updatedAt }).catch(() => {});
  return {
    lines,
    employees,
    codes,
    leave,
    rosters,
    settings: { ...settings, updatedAt },
    workOrders,
    resourceRequirements,
    allocations,
    monthCodes,
    layouts,
    updatedAt,
  };
}

/** Full backup — everything the app knows, as one JSON file. */
export async function exportBackup(): Promise<string> {
  const data = await getFullBackupData();
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), ...data },
    null,
    2,
  );
}

export async function importBackupData(data: any): Promise<void> {
  if (!data || typeof data !== 'object') {
    throw new Error('That file is not a valid LineRoster backup.');
  }
  await db.transaction(
    'rw',
    [db.lines, db.employees, db.shiftCodes, db.leave, db.rosters, db.settings, db.workOrders, db.resourceRequirements, db.allocations, db.monthCodes, db.layouts],
    async () => {
      await Promise.all([
        db.lines.clear(), db.employees.clear(), db.shiftCodes.clear(),
        db.leave.clear(), db.rosters.clear(), db.workOrders.clear(),
        db.resourceRequirements.clear(), db.allocations.clear(),
      ]);
      if (Array.isArray(data.lines)) await db.lines.bulkPut(data.lines);
      if (Array.isArray(data.codes)) {
        await db.shiftCodes.bulkPut(data.codes.map((c: any) => ({ ...c, key: c.key ?? codeKey(c.id, c.scope) })));
      }
      if (Array.isArray(data.employees)) await db.employees.bulkPut(data.employees);
      if (Array.isArray(data.leave)) await db.leave.bulkPut(data.leave);
      if (Array.isArray(data.rosters)) await db.rosters.bulkPut(data.rosters);
      if (Array.isArray(data.workOrders)) await db.workOrders.bulkPut(data.workOrders);
      if (Array.isArray(data.resourceRequirements)) await db.resourceRequirements.bulkPut(data.resourceRequirements);
      if (Array.isArray(data.allocations)) await db.allocations.bulkPut(data.allocations);
      if (Array.isArray(data.monthCodes)) {
        await db.monthCodes.clear();
        await db.monthCodes.bulkPut(data.monthCodes);
      }
      if (Array.isArray(data.layouts)) {
        await db.layouts.clear();
        await db.layouts.bulkPut(data.layouts);
      }
      if (data.settings) {
        const localTheme = getStoredTheme();
        const currentLocal = await db.settings.get('app');
        const storedView = getStoredActiveView();
        const activeLineId = currentLocal?.activeLineId || storedView?.activeLineId || data.settings.activeLineId || DEFAULT_SETTINGS.activeLineId;
        const lineMonths = {
          ...(data.settings.lineMonths || {}),
          ...(storedView?.lineMonths || {}),
          ...(currentLocal?.lineMonths || {}),
        };
        const activeYear = currentLocal?.activeYear || storedView?.activeYear || lineMonths[activeLineId]?.year || data.settings.activeYear || DEFAULT_SETTINGS.activeYear;
        const activeMonth = currentLocal?.activeMonth || storedView?.activeMonth || lineMonths[activeLineId]?.month || data.settings.activeMonth || DEFAULT_SETTINGS.activeMonth;

        await db.settings.put({
          ...DEFAULT_SETTINGS,
          ...data.settings,
          activeLineId,
          activeYear,
          activeMonth,
          lineMonths,
          updatedAt: data.updatedAt || data.settings.updatedAt || Date.now(),
          theme: localTheme,
          key: 'app',
          seeded: true,
        });
      }
    },
  );
}

export async function importBackup(json: string): Promise<void> {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Selected file is not valid JSON. Please upload a valid LineRoster .json backup.');
  }
  await importBackupData(data);
  if (getActiveDbName() === 'shiftline' && typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      const backup = await getFullBackupData();
      await fetch('/api/collab/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
      });
    } catch {}
  }
}

/** Wipes everything and reloads the shipped default database (both lines, 313 work orders). */
export async function resetToSeed(): Promise<void> {
  await importBackupData(defaultDatabase);
  if (getActiveDbName() === 'shiftline' && typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    try {
      const backup = await getFullBackupData();
      await fetch('/api/collab/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
      });
    } catch {}
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
