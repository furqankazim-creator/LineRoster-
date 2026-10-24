import { useLiveQuery } from 'dexie-react-hooks';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_SETTINGS, codeKey, db, ensureSeeded, getActiveDbName, getFullBackupData, getSettings, getStoredActiveView, getStoredTheme, newId, patchSettings, saveStoredActiveView, saveStoredTheme, seedCodesForLine,
  type Settings, type WorkOrderImportReport,
} from '@/data/db';

const CLIENT_ID =
  typeof window !== 'undefined'
    ? (window as any).__shiftline_client_id ||
      ((window as any).__shiftline_client_id = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
    : 'server';

let syncTimer: any = null;
function scheduleServerDbSync() {
  if (typeof window === 'undefined') return;
  // If the active database is an isolated scratch workspace, do not push to supervisor server!
  if (getActiveDbName() !== 'shiftline') return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const backup = await getFullBackupData();
      await fetch('/api/collab/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...backup, clientId: CLIENT_ID }),
      });
    } catch {
      // offline or dev server without endpoint
    }
  }, 400);
}
import { buildColumns, daysInMonth, monthKey, shiftMonth } from '@/domain/calendar';
import {
  generateMonth, rosterId, setCell as setCellPure, setExtraHours as setExtraHoursPure,
  setRange as setRangePure,
} from '@/domain/generator';
import { employeeHours, type EmployeeHours } from '@/domain/hours';
import { autoRotate, buildHistory, fairness, type AutoRotateResult } from '@/domain/rotation';
import { summarise } from '@/domain/summary';
import { OFF } from '@/domain/types';
import type {
  Employee,
  Issue,
  LeaveBlock,
  Line,
  ResourceRequirement,
  RosterMonth,
  ShiftCode,
  WorkOrder,
} from '@/domain/types';
import { validate } from '@/domain/validate';
import { parseWorkOrdersWorkbook, setKnownLines } from '@/domain/workload';
import { allWorkOrderColumns } from '@/domain/workOrderColumns';
import {
  POOL_LINES, SHIFT_LABEL, codeFamily, computeWorkload, poolOfLineId, staffOnShift, type ShiftFamily, type WorkloadResult,
} from '@/domain/workloadLive';
import { useOptionalAuth } from '@/features/auth/authStore';

interface RosterStore {
  ready: boolean;
  settings: Settings;
  activeLineId: string;
  lines: Line[];
  codes: ShiftCode[];
  /** Every code in the database, across all lines. */
  allCodes: ShiftCode[];
  /** Every code the active line owns, used or not. */
  lineCodes: ShiftCode[];
  /** Adds a code to this month's brush without touching any other month. */
  enableCode(codeId: string): Promise<void>;
  employees: Employee[];
  allEmployees: Employee[];
  leave: LeaveBlock[];
  roster: RosterMonth | null;
  columns: ReturnType<typeof buildColumns>;
  days: ReturnType<typeof summarise>;
  issues: Issue[];
  fairnessRows: ReturnType<typeof fairness>;
  /** Worked hours and overtime per employee id, for the active month. */
  hours: Record<string, EmployeeHours>;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: 'saved' | 'saving';
  /** Persists the month and database backup; optionally downloads an Excel backup if download: true. */
  saveRoster: (options?: { download?: boolean }) => Promise<string>;

  setMonth(year: number, month: number): void;
  /** Opens a specific line at a specific month — used after an import. */
  openSheet(lineId: string, year: number, month: number): Promise<void>;
  stepMonth(delta: number): void;
  setLine(lineId: string): void;
  setTheme(theme: 'dark' | 'light'): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  paintCell(employeeId: string, dayIndex: number, code: string): void;
  paintRange(employeeId: string, from: number, to: number, code: string): void;
  /** Hours worked on top of that day's shift; 0 clears them. */
  setExtraHours(employeeId: string, dayIndex: number, hours: number): void;
  regenerate(options?: { respectOverrides?: boolean }): Promise<void>;
  applyRotation(result: AutoRotateResult, targetYear: number, targetMonth: number): Promise<void>;
  previewRotation(
    options?:
      | number
      | {
          aggressiveness?: number;
          targetScope?: 'leaders_only' | 'all';
          patternMode?: 'two_week_cycle' | 'monthly';
          selectedLeaderIds?: string[];
        },
  ): AutoRotateResult;
  undo(): void;
  redo(): void;

  saveEmployee(employee: Employee): Promise<void>;
  removeEmployee(id: string): Promise<void>;
  addEmployee(partial?: Partial<Employee>): Promise<Employee>;
  reorderEmployees(ids: string[]): Promise<void>;

  saveCode(code: ShiftCode): Promise<void>;
  removeCode(id: string, scope?: string, key?: string): Promise<void>;
  saveLine(line: Line): Promise<void>;
  removeLine(id: string): Promise<void>;
  clearLineRoster(lineId: string): Promise<void>;

  saveLeave(block: LeaveBlock): Promise<void>;
  removeLeave(id: string): Promise<void>;

  // Work Orders & Resource Requirements Integration
  workOrders: WorkOrder[];
  /** False until the saved work orders have been read — so an empty list isn't mistaken for "none imported". */
  workOrdersReady: boolean;
  resourceRequirements: ResourceRequirement[];
  /**
   * Live staffing of every work order against the Planner roster of its own
   * line, date and shift. Recomputed on every roster / people / code / work
   * order change — see domain/workloadLive.ts.
   */
  workload: WorkloadResult;
  /** People of a line's staff pool (Line 4 & 6 together) on a shift family on an ISO date, as the Planner shows it. */
  staffForShift(lineId: string, isoDate: string, shift: ShiftFamily): Employee[];
  /** Shift codes per line id (for timings / shift families). */
  codesByLine: Record<string, ShiftCode[]>;
  /** Replaces all work orders from an Excel file and records an import report in settings. */
  uploadWorkOrders(buffer: ArrayBuffer, fileName?: string, sheetName?: string): Promise<WorkOrderImportReport>;
  saveWorkOrder(wo: WorkOrder): Promise<void>;
  saveResourceRequirement(rr: ResourceRequirement): Promise<void>;
  removeWorkOrder(id: string): Promise<void>;
  clearWorkOrders(): Promise<void>;
}

const Ctx = createContext<RosterStore | null>(null);

export function useStore(): RosterStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}

const UNDO_LIMIT = 50;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const auth = useOptionalAuth();
  const session = auth?.session;

  useEffect(() => {
    ensureSeeded({
      isolated: session?.workspaceMode === 'isolated',
      mirror: session?.role !== 'supervisor' && session?.workspaceMode !== 'isolated',
      allowedLineId: session?.allowedLineId,
    }).then(() => setReady(true));
  }, [session?.role, session?.workspaceMode, session?.allowedLineId]);

  const storedView = useMemo(() => getStoredActiveView(), []);
  const rawSettings = useLiveQuery(() => db.settings.get('app'), [], undefined);
  const [navMonthOverride, setNavMonthOverride] = useState<{
    year: number;
    month: number;
  } | null>(null);

  const effectiveLineId = useMemo(() => {
    if (session?.allowedLineId && session.allowedLineId !== 'all') {
      return session.allowedLineId;
    }
    return rawSettings?.activeLineId || storedView?.activeLineId || DEFAULT_SETTINGS.activeLineId;
  }, [session?.allowedLineId, rawSettings?.activeLineId, storedView?.activeLineId]);

  const activeYear = useMemo(() => {
    if (navMonthOverride?.year) return navMonthOverride.year;
    const remembered = rawSettings?.lineMonths?.[effectiveLineId] || storedView?.lineMonths?.[effectiveLineId];
    if (remembered?.year) return remembered.year;
    return rawSettings?.activeYear ?? storedView?.activeYear ?? DEFAULT_SETTINGS.activeYear;
  }, [navMonthOverride, rawSettings?.lineMonths, rawSettings?.activeYear, storedView, effectiveLineId]);

  const activeMonth = useMemo(() => {
    if (navMonthOverride?.month) return navMonthOverride.month;
    const remembered = rawSettings?.lineMonths?.[effectiveLineId] || storedView?.lineMonths?.[effectiveLineId];
    if (remembered?.month) return remembered.month;
    return rawSettings?.activeMonth ?? storedView?.activeMonth ?? DEFAULT_SETTINGS.activeMonth;
  }, [navMonthOverride, rawSettings?.lineMonths, rawSettings?.activeMonth, storedView, effectiveLineId]);

  useEffect(() => {
    if (rawSettings && navMonthOverride) {
      if (rawSettings.activeYear === navMonthOverride.year && rawSettings.activeMonth === navMonthOverride.month) {
        setNavMonthOverride(null);
      }
    }
  }, [rawSettings?.activeYear, rawSettings?.activeMonth, navMonthOverride]);

  const settings: Settings = useMemo(() => {
    const activeTheme = getStoredTheme();
    const base = { ...DEFAULT_SETTINGS, theme: activeTheme };
    const merged = rawSettings ? { ...base, ...rawSettings, theme: rawSettings.theme || activeTheme } : base;
    return {
      ...merged,
      activeLineId: effectiveLineId,
      activeYear,
      activeMonth,
    };
  }, [rawSettings, effectiveLineId, activeYear, activeMonth]);

  const allLines = useLiveQuery(() => db.lines.orderBy('order').toArray(), [], []) ?? [];
  const lines = useMemo(() => {
    if (session?.allowedLineId && session.allowedLineId !== 'all') {
      return allLines.filter((l) => l.id === session.allowedLineId);
    }
    return allLines;
  }, [allLines, session?.allowedLineId]);
  const allCodes = useLiveQuery(() => db.shiftCodes.orderBy('order').toArray(), [], []) ?? [];
  const leave = useLiveQuery(() => db.leave.toArray(), [], []) ?? [];
  const workOrdersLoaded = useLiveQuery(() => db.workOrders.toArray(), []);
  const workOrders = workOrdersLoaded ?? [];
  const resourceRequirements = useLiveQuery(() => db.resourceRequirements.toArray(), [], []) ?? [];
  const allEmployees = useLiveQuery(() => db.employees.toArray(), [], []) ?? [];
  const allRosters = useLiveQuery(() => db.rosters.toArray(), [], []) ?? [];

  const activeLineId = effectiveLineId;

  const rawEmployees = useLiveQuery(
    async () =>
      (await db.employees.where('lineId').equals(activeLineId).toArray()).sort(
        (a, b) => a.order - b.order,
      ),
    [activeLineId],
    [],
  ) ?? [];

  // Strictly filter to ensure NO employee from another line can ever enter this array
  const employees = useMemo(
    () => rawEmployees.filter((e) => e.lineId === activeLineId),
    [rawEmployees, activeLineId],
  );

  const lineLeave = useMemo(() => {
    const ids = new Set(employees.map((e) => e.id));
    return leave.filter((l) => ids.has(l.employeeId));
  }, [leave, employees]);

  const [roster, setRoster] = useState<RosterMonth | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const undoStack = useRef<RosterMonth[]>([]);
  const redoStack = useRef<RosterMonth[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const lastIdRef = useRef<string>('');
  const lastPersistedTimeRef = useRef<number>(0);

  const id = rosterId(activeLineId, activeYear, activeMonth);

  /**
   * The codes this month actually works with — what the brush offers, what the
   * headcount legend lists, and what the validator enforces minimums for.
   *
   * A sheet uses the codes that appear in its own grid, plus any an import
   * invented for it, plus any deliberately added here. Nothing else: a
   * Morning/Night operation should not be told every day that "nobody is on
   * Evening" because some other line runs an Evening shift.
   */
  const extraCodes = useLiveQuery(() => db.monthCodes.get(id), [id])?.codeIds ?? [];

  const codes = useMemo(() => {
    const used = new Set(extraCodes);
    if (roster && roster.lineId === activeLineId) {
      for (const row of Object.values(roster.cells)) {
        for (const cell of row) if (cell.code && cell.code !== OFF) used.add(cell.code);
      }
    }
    return allCodes
      .filter((c) => c.scope === activeLineId && used.has(c.id))
      .sort((a, b) => a.order - b.order);
  }, [allCodes, roster, activeLineId, extraCodes.join(',')]);

  /** Every code this line owns — what Setup edits and the "+" picker offers. */
  const lineCodes = useMemo(
    () => allCodes.filter((c) => c.scope === activeLineId).sort((a, b) => a.order - b.order),
    [allCodes, activeLineId],
  );

  /**
   * Switches an existing code on for this month's brush. It is recorded
   * against the month, not copied, so Setup still lists the code once.
   */
  const enableCode = useCallback(
    async (codeId: string) => {
      const current = (await db.monthCodes.get(id))?.codeIds ?? [];
      if (current.includes(codeId)) return;
      await db.monthCodes.put({ rosterId: id, codeIds: [...current, codeId] });
      scheduleServerDbSync();
    },
    [id],
  );

  const storedRoster = useLiveQuery(() => db.rosters.get(id), [id]);

  /**
   * Loads the stored grid for the active month, or generates one on the fly.
   *
   * A month the client has never opened still shows a complete roster — that
   * is the whole point of the tool, so there is no "empty month" state.
   */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    // Only reset undo/redo history when navigating to a different month or line
    if (lastIdRef.current !== id) {
      lastIdRef.current = id;
      undoStack.current = [];
      redoStack.current = [];
      setUndoCount(0);
      setRedoCount(0);
      if (roster && roster.lineId !== activeLineId) {
        setRoster(null);
      }
    }

    // Fast in-memory path: employees and rosters are already available in state
    const inMemoryEmployees = employees.length > 0 && employees[0].lineId === activeLineId ? employees : null;
    const inMemoryStored = allRosters.find((r) => r.id === id);

    if (inMemoryEmployees && (inMemoryStored || allRosters.length > 0)) {
      const validEmpIds = new Set(inMemoryEmployees.map((e) => e.id));
      const cleanOverrides: Record<string, Record<number, string>> = {};
      for (const [empId, val] of Object.entries(inMemoryStored?.overrides ?? {})) {
        if (validEmpIds.has(empId)) cleanOverrides[empId] = val;
      }
      const cleanExtraHours: Record<string, Record<number, number>> = {};
      for (const [empId, val] of Object.entries(inMemoryStored?.extraHours ?? {})) {
        if (validEmpIds.has(empId)) cleanExtraHours[empId] = val;
      }

      const lineLeaveBlocks = lineLeave.filter((l) => validEmpIds.has(l.employeeId));

      const next = generateMonth({
        year: activeYear,
        month: activeMonth,
        lineId: activeLineId,
        employees: inMemoryEmployees,
        leaveBlocks: lineLeaveBlocks,
        overrides: cleanOverrides,
        extraHours: cleanExtraHours,
      });

      setRoster(next);
      return;
    }

    (async () => {
      // Direct query for the active line to prevent any race condition with useLiveQuery
      const currentEmployees = (
        await db.employees.where('lineId').equals(activeLineId).toArray()
      ).sort((a, b) => a.order - b.order);

      if (cancelled) return;

      if (currentEmployees.length === 0) {
        const emptyRoster: RosterMonth = {
          id,
          year: activeYear,
          month: activeMonth,
          lineId: activeLineId,
          cells: {},
          overrides: {},
          extraHours: {},
          updatedAt: Date.now(),
        };
        if (!cancelled) {
          setRoster(emptyRoster);
        }
        return;
      }

      const stored = await db.rosters.get(id);
      if (cancelled) return;

      // Filter stored overrides and extraHours to strictly isolate to this line's current employees
      const validEmpIds = new Set(currentEmployees.map((e) => e.id));
      const cleanOverrides: Record<string, Record<number, string>> = {};
      for (const [empId, val] of Object.entries(stored?.overrides ?? {})) {
        if (validEmpIds.has(empId)) cleanOverrides[empId] = val;
      }
      const cleanExtraHours: Record<string, Record<number, number>> = {};
      for (const [empId, val] of Object.entries(stored?.extraHours ?? {})) {
        if (validEmpIds.has(empId)) cleanExtraHours[empId] = val;
      }

      const lineLeaveBlocks = lineLeave.filter((l) => validEmpIds.has(l.employeeId));

      const next = generateMonth({
        year: activeYear,
        month: activeMonth,
        lineId: activeLineId,
        employees: currentEmployees,
        leaveBlocks: lineLeaveBlocks,
        overrides: cleanOverrides,
        extraHours: cleanExtraHours,
      });

      if (cancelled) return;
      setRoster(next);
      // NOTE: Do NOT do db.rosters.put(next) here.
      // Browsing an unedited month must not write to disk, which would invalidate live queries and cause lag.
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, id, activeLineId, activeYear, activeMonth, employees, lineLeave, allRosters]);

  // Synchronize when an external action (like full Excel import or JSON backup restore) alters the active roster in DB
  useEffect(() => {
    if (!storedRoster) return;
    if (storedRoster.id !== id) return;
    if (storedRoster.updatedAt === lastPersistedTimeRef.current) return;

    // Check if storedRoster contains current line employees
    const lineEmpIds = new Set(employees.map((e) => e.id));
    const hasCurrentEmps = Object.keys(storedRoster.cells || {}).some((k) => lineEmpIds.has(k));
    if (!hasCurrentEmps && employees.length > 0) {
      // Stored roster has orphaned employee IDs that do not match current employees of this line.
      // Re-generate for current employees rather than displaying empty dashes!
      const validEmpIds = new Set(employees.map((e) => e.id));
      const cleanOverrides: Record<string, Record<number, string>> = {};
      for (const [empId, val] of Object.entries(storedRoster.overrides ?? {})) {
        if (validEmpIds.has(empId)) cleanOverrides[empId] = val;
      }
      const cleanExtraHours: Record<string, Record<number, number>> = {};
      for (const [empId, val] of Object.entries(storedRoster.extraHours ?? {})) {
        if (validEmpIds.has(empId)) cleanExtraHours[empId] = val;
      }
      const lineLeaveBlocks = lineLeave.filter((l) => validEmpIds.has(l.employeeId));
      const next = generateMonth({
        year: activeYear,
        month: activeMonth,
        lineId: activeLineId,
        employees,
        leaveBlocks: lineLeaveBlocks,
        overrides: cleanOverrides,
        extraHours: cleanExtraHours,
      });
      setRoster(next);
      return;
    }

    setRoster(storedRoster);
    undoStack.current = [];
    redoStack.current = [];
    setUndoCount(0);
    setRedoCount(0);
  }, [storedRoster?.updatedAt, storedRoster?.id, id, employees, lineLeave, activeYear, activeMonth, activeLineId]);

  const persist = useCallback(async (next: RosterMonth) => {
    setSaveStatus('saving');
    lastPersistedTimeRef.current = next.updatedAt;
    try {
      await db.rosters.put(next);
      setSaveStatus('saved');
      scheduleServerDbSync();
    } catch {
      setSaveStatus('saved');
    }
  }, []);

  /**
   * Explicit Save: persist the month and database backup (also synced to server).
   * Does NOT download a file unless options.download is explicitly true.
   * Returns the downloaded filename if download was requested.
   */
  const saveRoster = useCallback(
    async (options?: { download?: boolean }): Promise<string> => {
      if (!roster) return '';
      setSaveStatus('saving');
      const updatedRoster: RosterMonth = {
        ...roster,
        updatedAt: Date.now(),
      };
      lastPersistedTimeRef.current = updatedRoster.updatedAt;
      setRoster(updatedRoster);
      await db.rosters.put(updatedRoster);
      try {
        scheduleServerDbSync();
      } catch {}
      setSaveStatus('saved');

      if (options?.download) {
        const [{ getFullBackupData }, { downloadBackupXlsx }] = await Promise.all([
          import('@/data/db'),
          import('@/io/exportXlsx'),
        ]);
        return downloadBackupXlsx(await getFullBackupData(), {
          activeLineId: roster.lineId,
          activeYear: roster.year,
          activeMonth: roster.month,
        });
      }
      return '';
    },
    [roster],
  );

  const commit = useCallback(
    (next: RosterMonth) => {
      setRoster((prev) => {
        if (prev) {
          undoStack.current = [...undoStack.current, prev].slice(-UNDO_LIMIT);
          redoStack.current = [];
          setUndoCount(undoStack.current.length);
          setRedoCount(0);
        }
        return next;
      });
      void persist(next);
    },
    [persist],
  );

  const columns = useMemo(
    () => buildColumns(activeYear, activeMonth, settings.weekendDays as never),
    [activeYear, activeMonth, settings.weekendDays],
  );

  const nDays = daysInMonth(activeYear, activeMonth);

  const days = useMemo(
    () => (roster ? summarise(roster, codes, nDays) : []),
    [roster, codes, nDays],
  );

  const ruleIssues = useMemo(
    () =>
      roster
        ? validate({
            roster, employees, codes, leaveBlocks: lineLeave,
            nDays, maxConsecutive: settings.maxConsecutive,
          })
        : [],
    [roster, employees, codes, lineLeave, nDays, settings.maxConsecutive],
  );

  const hours = useMemo(
    () =>
      roster
        ? employeeHours({ roster, employees, codes: lineCodes, standardHours: settings.standardHours })
        : {},
    [roster, employees, lineCodes, settings.standardHours],
  );

  // ---- history for fairness + rotation ----------------------------------
  const pastRosters = useLiveQuery(
    () => db.rosters.where('lineId').equals(activeLineId).toArray(),
    [activeLineId],
    [],
  ) ?? [];

  const history = useMemo(
    () =>
      buildHistory(
        pastRosters.filter(
          (r) => r.year * 12 + r.month <= activeYear * 12 + activeMonth,
        ),
      ),
    [pastRosters, activeYear, activeMonth],
  );

  const fairnessRows = useMemo(
    () => fairness(history, employees, codes),
    [history, employees, codes],
  );

  // ---- actions ----------------------------------------------------------
  /** Moving month also records where this line is, for when we come back. */
  const goToMonth = useCallback(
    (year: number, month: number) => {
      setNavMonthOverride({ year, month });
      saveStoredActiveView({
        activeYear: year,
        activeMonth: month,
        lineMonths: { [activeLineId]: { year, month } },
      });
      void (async () => {
        const current = await getSettings();
        await patchSettings({
          activeYear: year,
          activeMonth: month,
          lineMonths: { ...(current.lineMonths ?? {}), [activeLineId]: { year, month } },
        });
        scheduleServerDbSync();
      })();
    },
    [activeLineId],
  );

  const setMonth = useCallback(
    (year: number, month: number) => void goToMonth(year, month),
    [goToMonth],
  );

  /** Shows the sheet that was just imported, and remembers it for that line. */
  const openSheet = useCallback(
    async (lineId: string, year: number, month: number) => {
      setNavMonthOverride({ year, month });
      saveStoredActiveView({
        activeLineId: lineId,
        activeYear: year,
        activeMonth: month,
        lineMonths: { [lineId]: { year, month } },
      });
      const current = await getSettings();
      await patchSettings({
        activeLineId: lineId,
        activeYear: year,
        activeMonth: month,
        lineMonths: { ...(current.lineMonths ?? {}), [lineId]: { year, month } },
      });
      scheduleServerDbSync();
    },
    [],
  );

  const stepMonth = useCallback(
    (delta: number) => {
      const next = shiftMonth(activeYear, activeMonth, delta);
      void goToMonth(next.year, next.month);
    },
    [activeYear, activeMonth, goToMonth],
  );

  const paintCell = useCallback(
    (employeeId: string, dayIndex: number, code: string) => {
      if (!roster) return;
      commit(setCellPure(roster, employeeId, dayIndex, code));
    },
    [roster, commit],
  );

  const paintRange = useCallback(
    (employeeId: string, from: number, to: number, code: string) => {
      if (!roster) return;
      commit(setRangePure(roster, employeeId, from, to, code));
    },
    [roster, commit],
  );

  const setExtraHours = useCallback(
    (employeeId: string, dayIndex: number, value: number) => {
      if (!roster) return;
      commit(setExtraHoursPure(roster, employeeId, dayIndex, value));
    },
    [roster, commit],
  );

  const regenerate = useCallback(
    async (options?: { respectOverrides?: boolean }) => {
      const next = generateMonth({
        year: activeYear, month: activeMonth, lineId: activeLineId,
        employees, leaveBlocks: lineLeave,
        overrides: options?.respectOverrides === false ? {} : roster?.overrides ?? {},
        extraHours: roster?.extraHours ?? {},
        respectOverrides: options?.respectOverrides ?? true,
      });
      commit(next);
    },
    [activeYear, activeMonth, activeLineId, employees, lineLeave, roster, commit],
  );

  const previewRotation = useCallback(
    (
      options?:
        | number
        | {
            aggressiveness?: number;
            targetScope?: 'leaders_only' | 'all';
            patternMode?: 'two_week_cycle' | 'monthly';
            selectedLeaderIds?: string[];
          },
    ) => {
      const opts = typeof options === 'number' ? { aggressiveness: options } : options ?? {};
      const target = shiftMonth(activeYear, activeMonth, 1);
      return autoRotate({
        year: target.year,
        month: target.month,
        employees,
        codes,
        history,
        aggressiveness: opts.aggressiveness ?? 1,
        targetScope: opts.targetScope,
        patternMode: opts.patternMode,
        selectedLeaderIds: opts.selectedLeaderIds,
      });
    },
    [activeYear, activeMonth, employees, codes, history],
  );

  /**
   * Writes a rotation result into the target month.
   *
   * The new shift is stored as that month's rotation rule rather than by
   * rewriting `defaultShift`, so past months keep rendering as they were and
   * the client can still see why a person sat where they did.
   */
  const applyRotation = useCallback(
    async (result: AutoRotateResult, targetYear: number, targetMonth: number) => {
      const key = monthKey(targetYear, targetMonth);
      const span = daysInMonth(targetYear, targetMonth);

      await db.transaction('rw', db.employees, db.rosters, async () => {
        for (const employee of employees) {
          // If result specifies exact mid-month rotation rules (e.g. 2-week cycle):
          if (result.rotationRules && result.rotationRules[employee.id]) {
            await db.employees.update(employee.id, {
              rotations: {
                ...(employee.rotations ?? {}),
                [key]: result.rotationRules[employee.id],
              },
            });
            continue;
          }

          // If this employee was deliberately kept fixed as an engineer, leave their rules intact
          if (result.engineersKeptFixed?.includes(employee.id)) {
            continue;
          }

          const code = result.assignments[employee.id];
          if (!code) continue;
          await db.employees.update(employee.id, {
            rotations: {
              ...(employee.rotations ?? {}),
              [key]: [{ fromDay: 1, toDay: span, code }],
            },
          });
        }
        await db.rosters.delete(rosterId(activeLineId, targetYear, targetMonth));
      });

      setNavMonthOverride({ year: targetYear, month: targetMonth });
      saveStoredActiveView({
        activeYear: targetYear,
        activeMonth: targetMonth,
        lineMonths: { [activeLineId]: { year: targetYear, month: targetMonth } },
      });
      const current = await getSettings();
      await patchSettings({
        activeYear: targetYear,
        activeMonth: targetMonth,
        lineMonths: { ...(current.lineMonths ?? {}), [activeLineId]: { year: targetYear, month: targetMonth } },
      });
      scheduleServerDbSync();
    },
    [employees, activeLineId],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setRoster((current) => {
      if (current) {
        redoStack.current = [...redoStack.current, current].slice(-UNDO_LIMIT);
        setRedoCount(redoStack.current.length);
      }
      return prev;
    });
    setUndoCount(undoStack.current.length);
    void persist(prev);
  }, [persist]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setRoster((current) => {
      if (current) {
        undoStack.current = [...undoStack.current, current].slice(-UNDO_LIMIT);
        setUndoCount(undoStack.current.length);
      }
      return next;
    });
    setRedoCount(redoStack.current.length);
    void persist(next);
  }, [persist]);

  // ---- CRUD -------------------------------------------------------------
  const saveEmployee = useCallback(async (employee: Employee) => {
    await db.employees.put(employee);
    scheduleServerDbSync();
  }, []);

  const removeEmployee = useCallback(async (empId: string) => {
    await db.transaction('rw', [db.employees, db.leave, db.rosters, db.workOrders, db.allocations], async () => {
      await db.employees.delete(empId);
      await db.leave.where('employeeId').equals(empId).delete();
      await db.allocations.where('personId').equals(empId).delete();
      const allRosters = await db.rosters.toArray();
      for (const r of allRosters) {
        if (r.cells[empId] || r.overrides[empId] || r.extraHours?.[empId]) {
          const nextCells = { ...r.cells };
          const nextOverrides = { ...r.overrides };
          const nextExtraHours = { ...(r.extraHours ?? {}) };
          delete nextCells[empId];
          delete nextOverrides[empId];
          delete nextExtraHours[empId];
          await db.rosters.put({
            ...r,
            cells: nextCells,
            overrides: nextOverrides,
            extraHours: nextExtraHours,
          });
        }
      }
      const allWos = await db.workOrders.toArray();
      for (const wo of allWos) {
        if (wo.assignedEmployeeIds?.includes(empId)) {
          await db.workOrders.put({
            ...wo,
            assignedEmployeeIds: wo.assignedEmployeeIds.filter((id) => id !== empId),
          });
        }
      }
    });
    if (getActiveDbName() === 'shiftline') {
      fetch('/api/collab/db/delete-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId }),
      }).catch(() => {});
    }
    scheduleServerDbSync();
  }, []);

  const addEmployee = useCallback(
    async (partial?: Partial<Employee>) => {
      const employee: Employee = {
        id: newId('e'),
        lineId: activeLineId,
        name: 'New employee',
        contact: '',
        order: (employees.at(-1)?.order ?? 0) + 1,
        defaultShift: codes.find((c) => c.rotates)?.id ?? 'M',
        restDays: [5, 6],
        pinned: false,
        active: true,
        ...partial,
      };
      await db.employees.put(employee);
      scheduleServerDbSync();
      return employee;
    },
    [activeLineId, employees, codes],
  );

  const reorderEmployees = useCallback(async (ids: string[]) => {
    await db.transaction('rw', db.employees, async () => {
      await Promise.all(ids.map((empId, i) => db.employees.update(empId, { order: i + 1 })));
    });
    scheduleServerDbSync();
  }, []);

  const saveCode = useCallback(async (code: ShiftCode) => {
    await db.shiftCodes.put({ ...code, key: codeKey(code.id, code.scope) });
    scheduleServerDbSync();
  }, []);

  const removeCode = useCallback(async (codeId: string, scope?: string, key?: string) => {
    await db.transaction('rw', [db.shiftCodes, db.monthCodes, db.employees], async () => {
      if (key) {
        await db.shiftCodes.delete(key);
      }
      await db.shiftCodes.delete(codeKey(codeId, scope));
      if (scope) {
        await db.shiftCodes.delete(codeKey(codeId, undefined));
      }
      const allMonthCodes = await db.monthCodes.toArray();
      for (const mc of allMonthCodes) {
        if (mc.codeIds.includes(codeId)) {
          await db.monthCodes.put({
            ...mc,
            codeIds: mc.codeIds.filter((id) => id !== codeId),
          });
        }
      }
      if (scope) {
        const emps = await db.employees.where('lineId').equals(scope).toArray();
        for (const emp of emps) {
          if (emp.defaultShift === codeId) {
            await db.employees.update(emp.id, { defaultShift: 'M' });
          }
        }
      }
    });
    if (getActiveDbName() === 'shiftline') {
      fetch('/api/collab/db/delete-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeId, scope }),
      }).catch(() => {});
    }
    scheduleServerDbSync();
  }, []);

  /**
   * Switching line also moves to the month that line was last on.
   *
   * Each line's sheet covers its own period — one is imported for August,
   * another for October — so carrying the current month across would land on
   * an empty month of a line that has real data elsewhere.
   */
  const switchLine = useCallback(
    async (lineId: string) => {
      if (session?.allowedLineId && session.allowedLineId !== 'all' && lineId !== session.allowedLineId) {
        return;
      }
      const current = await getSettings();
      const stored = getStoredActiveView();
      const remembered = current.lineMonths?.[lineId] || stored?.lineMonths?.[lineId];
      if (remembered) {
        setNavMonthOverride({ year: remembered.year, month: remembered.month });
        saveStoredActiveView({
          activeLineId: lineId,
          activeYear: remembered.year,
          activeMonth: remembered.month,
          lineMonths: { [lineId]: { year: remembered.year, month: remembered.month } },
        });
        await patchSettings({
          activeLineId: lineId,
          activeYear: remembered.year,
          activeMonth: remembered.month,
          lineMonths: { ...(current.lineMonths ?? {}), [lineId]: { year: remembered.year, month: remembered.month } },
        });
        scheduleServerDbSync();
        return;
      }
      // Never visited: check if there is an imported sheet record for this line
      const matchingImported = Object.values(current.importedSheets || {})
        .filter((s) => s.lineId === lineId)
        .sort((a, b) => b.importedAt - a.importedAt)[0];
      if (matchingImported) {
        setNavMonthOverride({ year: matchingImported.year, month: matchingImported.month });
        saveStoredActiveView({
          activeLineId: lineId,
          activeYear: matchingImported.year,
          activeMonth: matchingImported.month,
          lineMonths: { [lineId]: { year: matchingImported.year, month: matchingImported.month } },
        });
        await patchSettings({
          activeLineId: lineId,
          activeYear: matchingImported.year,
          activeMonth: matchingImported.month,
          lineMonths: { ...(current.lineMonths ?? {}), [lineId]: { year: matchingImported.year, month: matchingImported.month } },
        });
        scheduleServerDbSync();
        return;
      }
      // Open the month that line actually holds data for in rosters.
      const rosters = await db.rosters.where('lineId').equals(lineId).toArray();
      const withEdits = rosters.filter((r) => Object.keys(r.overrides ?? {}).length > 0);
      const best = (withEdits.length ? withEdits : rosters)
        .reduce<typeof rosters[number] | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);
      if (best) {
        setNavMonthOverride({ year: best.year, month: best.month });
        saveStoredActiveView({
          activeLineId: lineId,
          activeYear: best.year,
          activeMonth: best.month,
          lineMonths: { [lineId]: { year: best.year, month: best.month } },
        });
        await patchSettings({
          activeLineId: lineId,
          activeYear: best.year,
          activeMonth: best.month,
          lineMonths: { ...(current.lineMonths ?? {}), [lineId]: { year: best.year, month: best.month } },
        });
      } else {
        setNavMonthOverride(null);
        saveStoredActiveView({ activeLineId: lineId });
        await patchSettings({ activeLineId: lineId });
      }
      scheduleServerDbSync();
    },
    [session?.allowedLineId],
  );

  const saveLine = useCallback(async (line: Line) => {
    const isNew = !(await db.lines.get(line.id));
    await db.lines.put(line);
    // A new line starts with its own copy of the standard codes, so editing
    // them never reaches another line.
    if (isNew) await seedCodesForLine(line.id);
    scheduleServerDbSync();
  }, []);

  const removeLine = useCallback(async (lineId: string) => {
    await db.transaction(
      'rw',
      [db.lines, db.employees, db.rosters, db.shiftCodes, db.leave, db.settings, db.workOrders, db.allocations],
      async () => {
        await db.lines.delete(lineId);
        await db.shiftCodes.where('scope').equals(lineId).delete();
        const lineEmployees = await db.employees.where('lineId').equals(lineId).toArray();
        const lineEmpIds = new Set(lineEmployees.map((e) => e.id));
        for (const emp of lineEmployees) {
          await db.leave.where('employeeId').equals(emp.id).delete();
          await db.allocations.where('personId').equals(emp.id).delete();
        }
        await db.employees.where('lineId').equals(lineId).delete();
        await db.rosters.where('lineId').equals(lineId).delete();

        // Strip deleted employees from work order allocations
        const allWos = await db.workOrders.toArray();
        for (const wo of allWos) {
          if (wo.assignedEmployeeIds?.some((id) => lineEmpIds.has(id))) {
            await db.workOrders.put({
              ...wo,
              assignedEmployeeIds: wo.assignedEmployeeIds.filter((id) => !lineEmpIds.has(id)),
            });
          }
        }

        const current = await db.settings.get('app');
        if (current) {
          const nextLineMonths = { ...(current.lineMonths ?? {}) };
          delete nextLineMonths[lineId];
          let nextActiveLineId = current.activeLineId;
          if (current.activeLineId === lineId) {
            const remaining = await db.lines.toArray();
            const next = remaining.find((l) => l.id !== lineId);
            if (next) {
              nextActiveLineId = next.id;
            }
          }
          await db.settings.put({
            ...current,
            activeLineId: nextActiveLineId,
            lineMonths: nextLineMonths,
          });
        }
      },
    );
    if (getActiveDbName() === 'shiftline') {
      fetch('/api/collab/db/delete-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId }),
      }).catch(() => {});
    }
    scheduleServerDbSync();
  }, []);

  const clearLineRoster = useCallback(async (lineId: string) => {
    await db.transaction(
      'rw',
      [db.employees, db.leave, db.rosters, db.layouts, db.allocations, db.workOrders, db.settings],
      async () => {
        const lineEmployees = await db.employees.where('lineId').equals(lineId).toArray();
        const lineEmpIds = new Set(lineEmployees.map((e) => e.id));

        for (const emp of lineEmployees) {
          await db.leave.where('employeeId').equals(emp.id).delete();
          await db.allocations.where('personId').equals(emp.id).delete();
        }
        await db.employees.where('lineId').equals(lineId).delete();
        await db.rosters.where('lineId').equals(lineId).delete();

        const layouts = await db.layouts.toArray();
        for (const l of layouts) {
          if (l.rosterId.startsWith(`${lineId}:`)) {
            await db.layouts.delete(l.rosterId);
          }
        }

        const allWos = await db.workOrders.toArray();
        for (const wo of allWos) {
          if (wo.assignedEmployeeIds?.some((id) => lineEmpIds.has(id))) {
            await db.workOrders.put({
              ...wo,
              assignedEmployeeIds: wo.assignedEmployeeIds.filter((id) => !lineEmpIds.has(id)),
              assignedEmployeeNames: wo.assignedEmployeeNames?.filter((name) =>
                !lineEmployees.some((e) => e.name === name)
              ) ?? [],
            });
          }
        }

        const current = await db.settings.get('app');
        if (current?.importedSheets) {
          const nextImported = { ...current.importedSheets };
          for (const [k, v] of Object.entries(nextImported)) {
            if (v.lineId === lineId) {
              delete nextImported[k];
            }
          }
          await db.settings.put({ ...current, importedSheets: nextImported });
        }
      },
    );
    setRoster(null);
    scheduleServerDbSync();
  }, []);

  const saveLeave = useCallback(async (block: LeaveBlock) => {
    await db.leave.put(block);
    scheduleServerDbSync();
  }, []);

  const removeLeave = useCallback(async (leaveId: string) => {
    await db.leave.delete(leaveId);
    scheduleServerDbSync();
  }, []);

  const codesByLine = useMemo(() => {
    const map: Record<string, ShiftCode[]> = {};
    for (const c of allCodes) if (c.scope) (map[c.scope] ??= []).push(c);
    return map;
  }, [allCodes]);

  // Work orders find their people through the line NAMES, so tell the domain which lines exist
  setKnownLines(allLines);

  const { workload, staffForShift } = useMemo(() => {
    const employeesByLine: Record<string, Employee[]> = {};
    for (const e of [...allEmployees].sort((x, y) => x.order - y.order)) (employeesByLine[e.lineId] ??= []).push(e);
    const storedById = new Map(allRosters.map((r) => [r.id, r]));
    const cache = new Map<string, RosterMonth>();

    // Exactly what the Planner shows for that line & month: the open month is
    // the live grid; any other month is rebuilt the same way the Planner loads
    // it (people's rules + leave + saved hand edits).
    const getRoster = (lineId: string, year: number, month: number): RosterMonth | null => {
      const people = employeesByLine[lineId] ?? [];
      const peopleIds = new Set(people.map((e) => e.id));
      if (roster && roster.lineId === lineId && roster.year === year && roster.month === month) {
        const hasMatching = Object.keys(roster.cells || {}).some((k) => peopleIds.has(k));
        if (hasMatching || people.length === 0) return roster;
      }
      if (!people.length || !year || !month) return null;
      const key = rosterId(lineId, year, month);
      let r = cache.get(key);
      if (!r) {
        const stored = storedById.get(key);
        const storedHasMatching = stored && Object.keys(stored.cells || {}).some((k) => peopleIds.has(k));
        const effectiveStored = storedHasMatching ? stored : undefined;
        r = generateMonth({
          year, month, lineId, employees: people,
          leaveBlocks: leave.filter((l) => peopleIds.has(l.employeeId)),
          overrides: effectiveStored?.overrides ?? {}, extraHours: effectiveStored?.extraHours ?? {},
        });
        cache.set(key, r);
      }
      return r;
    };

    const result = computeWorkload({
      workOrders, getRoster, employeesByLine, codesByLine, requirements: resourceRequirements,
    });
    const forShift = (lineId: string, isoDate: string, shift: ShiftFamily) => {
      const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
      // Everyone in the line's staff pool (Line 4 & 6 together)
      return POOL_LINES[poolOfLineId(lineId)].ids.flatMap((id) =>
        staffOnShift(getRoster(id, y, m), employeesByLine[id] ?? [], codesByLine[id], d, shift),
      );
    };
    return { workload: result, staffForShift: forShift };
  }, [workOrders, resourceRequirements, allEmployees, allRosters, leave, codesByLine, allLines, roster?.id, roster?.updatedAt]);

  /**
   * Planner issues = roster rules + Work Orders shortfalls for the open line &
   * month, one per day + shift where the work orders need more people than the
   * roster has on that shift. Fixing the roster removes them on the next render.
   */
  const issues = useMemo(() => {
    // When the active line has no employees or roster has not been loaded/imported ("Import Roster to Get Started"),
    // clear and remove all issues — no roster exists yet to evaluate against work orders or shift rules.
    if (!employees || employees.length === 0 || !roster || Object.keys(roster.cells || {}).length === 0) {
      return [];
    }

    // Line 4 & 6 share one team, so their shortfalls are checked together
    const pool = poolOfLineId(activeLineId);
    const poolCodes: string[] = POOL_LINES[pool].codes;
    const teamNote = pool === 'L4_L6' ? ' (Line 4&6 team)' : '';
    const monthPrefix = `${activeYear}-${String(activeMonth).padStart(2, '0')}-`;
    const lineCodesList = codesByLine[activeLineId] ?? [];
    const pickCode = (shift: ShiftFamily) =>
      (codes.find((c) => c.id === shift) ??
        codes.find((c) => codeFamily(c.id, lineCodesList) === shift) ??
        lineCodesList.find((c) => c.id === shift))?.id ?? shift;

    const woIssues: Issue[] = workload.balances
      .filter((b) => b.pool === pool && b.date.startsWith(monthPrefix) && b.buffer < 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => {
        const day = parseInt(b.date.slice(8, 10), 10);
        const label = SHIFT_LABEL[b.shift];
        const ids = Object.values(workload.byWo)
          .filter((a) => poolCodes.includes(a.lineCode) && a.date === b.date && a.shift === b.shift && a.status !== 'OK')
          .map((a) => a.woId);
        return {
          id: `wo-${b.date}-${b.shift}`,
          severity: 'error' as const,
          rule: 'work-order-short' as const,
          message: `Day ${day} · ${label}${teamNote}: work orders need ${b.demand}, only ${b.onDuty} on ${label} — short ${-b.buffer}.`,
          dayIndex: day - 1,
          shiftCode: pickCode(b.shift),
          workOrderIds: ids,
        };
      });
    // Rows whose imported data had to be guessed, grouped by kind of problem
    const inSheet = workOrders.filter((wo) => {
      const live = workload.byWo[wo.id];
      return live && poolCodes.includes(live.lineCode) && live.date.startsWith(monthPrefix) && wo.importWarnings?.length;
    });
    const groups = new Map<string, { text: string; ids: string[]; days: Set<number> }>();
    for (const wo of inSheet) {
      for (const w of wo.importWarnings ?? []) {
        // "Row 45: Scheduled Start missing" → "Scheduled Start missing"
        const key = w.replace(/^Row \d+:\s*/, '').replace(/"[^"]*"/g, '…').replace(/Work Order \S+ appears/, 'Work order number appears');
        const g = groups.get(key) ?? { text: key, ids: [], days: new Set<number>() };
        g.ids.push(wo.id);
        g.days.add(workload.byWo[wo.id].day);
        groups.set(key, g);
      }
    }
    const dataIssues: Issue[] = [...groups.values()].map((g, i) => ({
      id: `wo-data-${i}-${g.text}`,
      severity: 'warning' as const,
      rule: 'work-order-data' as const,
      message: `${g.ids.length} work order${g.ids.length === 1 ? '' : 's'} from the import: ${g.text}. Check the Excel file.`,
      dayIndex: g.days.size === 1 ? [...g.days][0] - 1 : undefined,
      workOrderIds: g.ids,
    }));

    // Shortfalls this sheet can't show (other lines / months)
    const elsewhere = workload.conflicts.filter(
      (c) => c.status !== 'NO_ROSTER' && !(poolCodes.includes(c.lineCode) && c.date.startsWith(monthPrefix)),
    ).length;
    const elsewhereIssue: Issue[] = elsewhere
      ? [{
          id: 'wo-elsewhere',
          severity: 'warning' as const,
          rule: 'work-order-short' as const,
          message: `${elsewhere} more work order${elsewhere === 1 ? ' is' : 's are'} short on other lines or months — see Maintenance Workorders.`,
        }]
      : [];

    // Rows the import couldn't put on any day (no Scheduled Start / Line)
    const unplaced = Object.values(workload.byWo).filter((x) => x.status === 'UNPLACED').length;
    const unplacedIssue: Issue[] = unplaced
      ? [{
          id: 'wo-unplaced',
          severity: 'warning' as const,
          rule: 'work-order-data' as const,
          message: `${unplaced} imported work order${unplaced === 1 ? '' : 's'} could not be placed on a day (no valid Scheduled Start or Line) — see Maintenance Workorders → Import report.`,
        }]
      : [];

    return [...woIssues, ...ruleIssues, ...dataIssues, ...unplacedIssue, ...elsewhereIssue];
  }, [ruleIssues, workload, workOrders, allLines, activeLineId, activeYear, activeMonth, codes, codesByLine, employees, roster]);

  const uploadWorkOrders = useCallback(async (buffer: ArrayBuffer, fileName = 'work orders.xlsx', sheetName?: string) => {
    // Built-in yellow columns + any added in Setup → Excel import columns
    const cfg = await getSettings();
    const result = parseWorkOrdersWorkbook(buffer, allWorkOrderColumns(cfg.customWorkOrderColumns, cfg.removedBuiltinColumns), sheetName);
    await db.transaction('rw', db.workOrders, async () => {
      await db.workOrders.clear();
      await db.workOrders.bulkPut(result.workOrders);
    });
    const sanitizedFileName = fileName.replace(/Line\s*4\s*,\s*5\s*(&|and)\s*6/gi, 'Line 4, 5 & 6');
    const report: WorkOrderImportReport = {
      fileName: sanitizedFileName,
      at: Date.now(),
      rows: result.totalRows,
      headerRow: result.headerRow,
      sheetName: result.sheetName,
      fileErrors: result.fileErrors,
      problemRows: result.workOrders.filter((w) => w.importWarnings?.length).length,
    };
    await patchSettings({ lastWorkOrderImport: report });
    scheduleServerDbSync();
    return report;
  }, []);

  const saveWorkOrder = useCallback(async (wo: WorkOrder) => {
    await db.workOrders.put(wo);
    scheduleServerDbSync();
  }, []);

  const saveResourceRequirement = useCallback(async (rr: ResourceRequirement) => {
    await db.resourceRequirements.put(rr);
    scheduleServerDbSync();
  }, []);

  const removeWorkOrder = useCallback(async (woId: string) => {
    await db.workOrders.delete(woId);
    scheduleServerDbSync();
  }, []);

  const clearWorkOrders = useCallback(async () => {
    await db.transaction('rw', [db.workOrders, db.allocations, db.settings], async () => {
      await db.workOrders.clear();
      await db.allocations.clear();
      const current = await db.settings.get('app');
      if (current) {
        const next = { ...current };
        delete next.lastWorkOrderImport;
        await db.settings.put(next);
      }
    });
    if (getActiveDbName() === 'shiftline') {
      fetch('/api/collab/db/clear-workorders', {
        method: 'POST',
      }).catch(() => {});
    }
    scheduleServerDbSync();
  }, []);

  const value: RosterStore = {
    ready,
    settings,
    activeLineId,
    lines,
    codes,
    allCodes,
    lineCodes,
    enableCode,
    employees,
    allEmployees,
    leave: lineLeave,
    roster,
    columns,
    days,
    issues,
    fairnessRows,
    hours,
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
    saveStatus,
    saveRoster,

    setMonth,
    openSheet,
    stepMonth,
    setLine: (lineId) => void switchLine(lineId),
    setTheme: (theme) => {
      saveStoredTheme(theme);
      void patchSettings({ theme });
    },
    updateSettings: async (patch) => {
      await patchSettings(patch);
      scheduleServerDbSync();
    },

    paintCell,
    paintRange,
    setExtraHours,
    regenerate,
    applyRotation,
    previewRotation,
    undo,
    redo,

    saveEmployee,
    removeEmployee,
    addEmployee,
    reorderEmployees,
    saveCode,
    removeCode,
    saveLine,
    removeLine,
    clearLineRoster,
    saveLeave,
    removeLeave,

    workOrders,
    workOrdersReady: workOrdersLoaded !== undefined,
    resourceRequirements,
    workload,
    staffForShift,
    codesByLine,
    uploadWorkOrders,
    saveWorkOrder,
    saveResourceRequirement,
    removeWorkOrder,
    clearWorkOrders,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
