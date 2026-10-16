import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useStore } from '@/app/store';
import { Button, Modal, Select, useToast } from '@/components/ui';
import { db } from '@/data/db';
import type { Employee, ShiftCode, WorkOrder } from '@/domain/types';
import { lineCodeToId, normalizeLineCode, normalizeWorkType, parseDateToIso, parseLineCode, tryParseDate } from '@/domain/workload';
import { WORK_TYPE_RULES, allWorkOrderColumns, type WorkOrderColumn } from '@/domain/workOrderColumns';
import {
  POOL_LINES, SHIFT_FAMILIES, SHIFT_LABEL, codeFamily, poolOfLineId, usesStandardCrew, windowCheck, workOrderShift,
  type LiveAllocation, type ShiftDayBalance, type ShiftFamily,
} from '@/domain/workloadLive';

type LineGroup = 'L4_L6' | 'L5' | 'ALL';
const GROUP_LINES: Record<LineGroup, string[]> = { L4_L6: ['L4', 'L6'], L5: ['L5'], ALL: ['L4', 'L5', 'L6'] };
const GROUP_LABEL: Record<LineGroup, string> = { L5: 'Line 5', L4_L6: 'Line 4&6', ALL: 'All Lines' };

function cleanLineNames(str: string): string {
  return str.replace(/Line\s*4\s*,\s*5\s*(&|and)\s*6/gi, 'Line 5 / 4&6');
}

/** Timing text for a shift family from the line's own codes (Setup), e.g. "06:00 – 15:00". */
function shiftTiming(codes: ShiftCode[] | undefined, shift: ShiftFamily): string {
  const exact = codes?.find((c) => c.id === shift);
  const fam = exact ?? codes?.find((c) => codeFamily(c.id, codes) === shift);
  return fam?.timing ?? '';
}

/**
 * useState that survives leaving the page: the Work Orders view is rebuilt each
 * time you open it, so line, day and filters are kept in this browser.
 */
const VIEW_KEY = 'shiftline.workorders.view.v1';
function readView(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
  } catch {
    return {};
  }
}
function useViewState<T>(field: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = readView()[field];
    return saved === undefined ? initial : (saved as T);
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ ...readView(), [field]: v }));
    } catch {
      /* storage unavailable — the choice just isn't remembered */
    }
  };
  return [value, set];
}

function weekdayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? iso : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDisplayDate(raw: string | undefined): string {
  if (!raw) return '—';
  const iso = parseDateToIso(raw);
  const parts = iso.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const mNum = parseInt(parts[1], 10);
    const dNum = parseInt(parts[2], 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[mNum - 1];
    if (monthName && !isNaN(dNum)) {
      return `${monthName} ${dNum}, ${year}`;
    }
  }
  return raw;
}

// Clean Enterprise Vector SVG Icons
const Icons = {
  Clipboard: () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  Upload: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
  Bolt: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  Download: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  ),
  AlertTriangle: () => (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  CheckCircle: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Users: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  Calendar: () => (
    <svg className="w-4 h-4 shrink-0 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Search: () => (
    <svg className="w-4 h-4 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  XCircle: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Sun: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  Sunset: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
    </svg>
  ),
  Moon: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  ),
  Trash: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
};

export function WorkOrdersPage({ onOpenPlanner }: { onOpenPlanner?: () => void } = {}) {
  const {
    settings,
    lines,
    setLine,
    workOrders,
    workload,
    openSheet,
    staffForShift,
    codesByLine,
    uploadWorkOrders,
    saveWorkOrder,
    removeWorkOrder,
    clearWorkOrders,
    updateSettings,
  } = useStore();

  const allEmployees = useLiveQuery(() => db.employees.toArray(), [], []) ?? [];
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters state (Line 4 & 6 combined, Line 5 separate)
  // Opens to the line group currently active in the Planner
  const [selectedLine, setSelectedLine] = useViewState<LineGroup>(
    'line',
    settings.activeLineId === 'line5' ? 'L5' : 'L4_L6',
  );

  // Automatically update Work Orders view whenever the user opens Line 5 vs Line 4&6
  useEffect(() => {
    if (settings.activeLineId === 'line5') {
      setSelectedLine('L5');
    } else if (settings.activeLineId === 'line4' || settings.activeLineId === 'line6') {
      setSelectedLine('L4_L6');
    }
  }, [settings.activeLineId, setSelectedLine]);
  // Day shown in the shift cards; null = automatically the worst day of the selected lines
  const [pickedDate, setPickedDate] = useViewState<string | null>('date', null);
  const [selectedType, setSelectedType] = useViewState<string>('type', 'ALL');
  const [selectedShift, setSelectedShift] = useViewState<string>('shift', 'ALL');
  const [savedStatus, setSelectedStatus] = useViewState<string>('status', 'ALL');
  const selectedStatus = ['ALL', 'OK', 'SHORT', 'UNASSIGNED'].includes(savedStatus) ? savedStatus : 'ALL';
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Editing modal & states
  const [editingWo, setEditingWo] = useState<WorkOrder | null>(null);
  const [showConflictsExpanded, setShowConflictsExpanded] = useState(false);
  const [showYellowGuide, setShowYellowGuide] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);

  // Auto-heal legacy unparsed date strings in local database
  useEffect(() => {
    if (!workOrders || workOrders.length === 0) return;
    const malformed = workOrders.filter(
      (wo) =>
        (wo.scheduledStart && !/^\d{4}-\d{2}-\d{2}$/.test(String(wo.scheduledStart)) && tryParseDate(wo.scheduledStart)) ||
        (wo.scheduledFinish && !/^\d{4}-\d{2}-\d{2}$/.test(String(wo.scheduledFinish)) && tryParseDate(wo.scheduledFinish)),
    );
    if (malformed.length > 0) {
      Promise.all(
        malformed.map((wo) =>
          // Only rewrite dates that can actually be read — never invent one
          saveWorkOrder({
            ...wo,
            scheduledStart: tryParseDate(wo.scheduledStart) ?? wo.scheduledStart,
            scheduledFinish: tryParseDate(wo.scheduledFinish) ?? wo.scheduledFinish,
          }),
        ),
      ).catch(() => {});
    }
  }, [workOrders, saveWorkOrder]);

  // Columns added in Setup → Excel import columns (shown on rows and exported)
  const extraColumns = settings.customWorkOrderColumns ?? [];
  // Built-in columns removed in Setup are no longer imported, so hide their old data too
  const off = (header: string) => (settings.removedBuiltinColumns ?? []).includes(header);
  const extraChips = (wo: WorkOrder) =>
    extraColumns
      .filter((c) => wo.extra?.[c.appField])
      .map((c) => (
        <span key={c.appField} className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[var(--surface-3)] text-ink-2 border border-[var(--line)]">
          {c.excelHeader}: {wo.extra?.[c.appField]}
        </span>
      ));

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  /** Rows without a valid line only show under "All Lines". */
  const inGroup = (wo: WorkOrder, g: LineGroup) => {
    const l = parseLineCode(wo.line);
    return l ? GROUP_LINES[g].includes(l) : g === 'ALL';
  };

  // Filtered work orders (supports Line 4 & 6 combined)
  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((wo) => {
      if (!inGroup(wo, selectedLine)) return false;
      const live = workload.byWo[wo.id];

      if (selectedType !== 'ALL' && normalizeWorkType(wo.workType) !== selectedType) return false;
      if (selectedShift !== 'ALL' && workOrderShift(wo) !== selectedShift) return false;
      if (selectedStatus !== 'ALL') {
        if (selectedStatus === 'SHORT' && live?.status !== 'SHORT') return false;
        if (selectedStatus === 'OK' && live?.status !== 'OK') return false;
        if (selectedStatus === 'UNASSIGNED' && live?.status !== 'UNASSIGNED' && live?.status !== 'NO_ROSTER') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = wo.workOrderId.toLowerCase().includes(q);
        const matchesDesc = wo.description.toLowerCase().includes(q);
        const matchesDept = (wo.department ?? '').toLowerCase().includes(q);
        if (!matchesId && !matchesDesc && !matchesDept) return false;
      }
      return true;
    });
  }, [workOrders, workload, selectedLine, selectedType, selectedShift, selectedStatus, searchQuery, todayIso]);

  // ---- Live figures for the selected line group (all recomputed from the Planner roster)
  const groupLines = GROUP_LINES[selectedLine];
  const groupConflicts = useMemo(
    () => workload.conflicts.filter((c) => groupLines.includes(c.lineCode)).sort((a, b) => a.date.localeCompare(b.date)),
    [workload, groupLines],
  );

  /** Sum of the staff pools in a group for each date + shift (Line 4 & 6 is already one pool). */
  const combineBalances = (lines: string[]) => {
    const map = new Map<string, ShiftDayBalance>();
    for (const b of workload.balances) {
      if (!POOL_LINES[b.pool].codes.some((c) => lines.includes(c))) continue;
      const k = `${b.date}|${b.shift}`;
      const cur = map.get(k);
      map.set(k, cur ? { ...cur, onDuty: cur.onDuty + b.onDuty, demand: cur.demand + b.demand, pm: cur.pm + b.pm, cm: cur.cm + b.cm, acs: cur.acs + b.acs, buffer: cur.buffer + b.buffer, orders: cur.orders + b.orders } : { ...b });
    }
    return [...map.values()];
  };
  const groupBalances = useMemo(() => combineBalances(groupLines), [workload, groupLines]);
  const groupDates = useMemo(() => [...new Set(groupBalances.map((b) => b.date))].sort(), [groupBalances]);
  const shortDates = useMemo(() => new Set(groupBalances.filter((b) => b.buffer < 0).map((b) => b.date)), [groupBalances]);

  const worstDate = useMemo(() => {
    let best: string | null = null;
    let min = Infinity;
    for (const b of groupBalances) if (b.buffer < min) { min = b.buffer; best = b.date; }
    return best;
  }, [groupBalances]);
  const cardDate = pickedDate && groupDates.includes(pickedDate) ? pickedDate : worstDate ?? groupDates[0] ?? null;
  const cardBalances = SHIFT_FAMILIES.map(
    (sh) => groupBalances.find((b) => b.date === cardDate && b.shift === sh) ?? { shift: sh, onDuty: 0, demand: 0, pm: 0, cm: 0, acs: 0, buffer: 0, orders: 0, date: cardDate ?? '', pool: 'L5' as const },
  );

  const groupStats = useMemo(() => {
    const rows = workOrders.filter((wo) => inGroup(wo, selectedLine));
    const count = (st: LiveAllocation['status']) => rows.filter((wo) => workload.byWo[wo.id]?.status === st).length;
    const months = [...new Set(rows.map((wo) => workload.byWo[wo.id]?.date.slice(0, 7)).filter(Boolean))].sort() as string[];
    const checks = rows.map((wo) => windowCheck(wo, todayIso));
    return {
      total: rows.length, ok: count('OK'), short: count('SHORT'), unassigned: count('UNASSIGNED'),
      noRoster: count('NO_ROSTER'), unplaced: count('UNPLACED'), months,
      outside: checks.filter((c) => c.outsideWindow).length,
      pastFinish: checks.filter((c) => c.pastFinish).length,
      dataProblems: rows.filter((wo) => wo.importWarnings?.length).length,
      // Window checks need Start No Earlier Than / Finish No Later Than in the data
      hasWindow: rows.some((wo) => wo.startNoEarlier || wo.finishNoLater),
    };
  }, [workOrders, workload, selectedLine, todayIso]);

  const shortDaysFor = (g: LineGroup) =>
    new Set(combineBalances(GROUP_LINES[g]).filter((b) => b.buffer < 0).map((b) => b.date)).size;

  // Counts by line for tabs
  const lineCounts = useMemo(() => {
    const c = { L4: 0, L5: 0, L6: 0 };
    workOrders.forEach((wo) => {
      const l = parseLineCode(wo.line);
      if (l) c[l]++;
    });
    return c;
  }, [workOrders]);

  const [importing, setImporting] = useState(false);
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importFile(file);
  };

  /** Shared by the Import button and the drag-and-drop area. */
  const importFile = async (file: File) => {
    if (!/\.xlsx?$/i.test(file.name)) {
      toast('Please choose an Excel file (.xlsx or .xls).', 'error');
      return;
    }
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await uploadWorkOrders(buffer, file.name);
      const issues = res.fileErrors.length + res.problemRows;
      toast(
        issues
          ? `Imported ${res.rows} work orders from ${file.name}. ${res.fileErrors.length ? `${res.fileErrors.length} missing column${res.fileErrors.length === 1 ? '' : 's'}, ` : ''}${res.problemRows} row${res.problemRows === 1 ? '' : 's'} with problems — see the Import report.`
          : `Imported ${res.rows} work orders from ${file.name}. All configured columns found, no row problems.`,
        issues ? 'info' : 'ok',
      );
    } catch (err: any) {
      toast(`Could not read ${file.name}: ${err.message}`, 'error');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportCSV = () => {
    const allHeaders = [
      'Line',
      'Work Order ID',
      'Description',
      'Work Type',
      'Div / Depart',
      'Location',
      'Asset Group',
      'Reported Date',
      'Start No Earlier Than',
      'Target Start',
      'Scheduled Start',
      'Finish No Later Than',
      'Outside Window',
      'Past FNLT',
      'Shift',
      'Resource Required',
      'Allocated Engineers',
      'Status',
      'Reason',
      ...extraColumns.map((c) => c.excelHeader),
    ];

    const allRows = filteredWorkOrders.map((wo) => {
      const live = workload.byWo[wo.id];
      return [
      wo.line,
      wo.workOrderId,
      `"${(wo.description ?? '').replace(/"/g, '""')}"`,
      wo.workType,
      wo.department ?? '',
      `"${(wo.location ?? '').replace(/"/g, '""')}"`,
      wo.assetGroup ?? '',
      wo.reportedDate ?? '',
      wo.startNoEarlier ?? '',
      wo.targetStart ?? '',
      wo.scheduledStart,
      wo.finishNoLater ?? '',
      windowCheck(wo, todayIso).outsideWindow ? 'YES' : '',
      windowCheck(wo, todayIso).pastFinish ? 'YES' : '',
      live ? SHIFT_LABEL[live.shift] : '',
      live?.needed ?? wo.resourceRequired,
      `"${(live?.assignedNames ?? []).join(', ')}"`,
      live?.status ?? 'UNASSIGNED',
      `"${(live?.reason ?? '').replace(/"/g, '""')}"`,
      ...extraColumns.map((c) => `"${(wo.extra?.[c.appField] ?? '').replace(/"/g, '""')}"`),
    ];
    });

    const keep = allHeaders.map((h) => !off(h));
    const headers = allHeaders.filter((_, i) => keep[i]);
    const rows = allRows.map((r) => r.filter((_, i) => keep[i]));
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Work_Orders_Allocation_${GROUP_LABEL[selectedLine].replace(/\W+/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Exported allocation audit report as CSV.', 'ok');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${text} to clipboard.`, 'ok');
  };

  const handleSelectLineGroup = (group: LineGroup) => {
    setSelectedLine(group);
    setPickedDate(null);
    if (group === 'L5') {
      if (settings.activeLineId !== 'line5') {
        setLine('line5');
      }
    } else if (group === 'L4_L6') {
      const target = lines.find((l) => l.id === 'line4' || l.id === 'line6')?.id ?? 'line6';
      if (settings.activeLineId !== 'line4' && settings.activeLineId !== 'line6') {
        setLine(target);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--canvas)] overflow-y-auto selection:bg-[var(--accent)] selection:text-[var(--accent-ink)] w-full">
      {/* =========================================================================
          TOP COMMAND HEADER (FULL WIDTH)
         ========================================================================= */}
      <div className="border-b border-[var(--line)] bg-[var(--surface)] px-4 sm:px-6 lg:px-10 py-4 sm:py-5 xl:sticky xl:top-0 z-20 shadow-sm">
        <div className="w-full flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4">
          {/* Title Area */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-blue-500/10 to-transparent border border-indigo-500/30 items-center justify-center text-indigo-400 shadow-sm shrink-0">
              <Icons.Clipboard />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl lg:text-[25px] font-black tracking-tight text-ink">
                  Work Orders &amp; Manpower Allocation
                </h1>
                {workOrders.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-bold tracking-wide uppercase bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                    {workOrders.length} Activities Loaded
                  </span>
                )}
                {groupConflicts.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                    <Icons.AlertTriangle /> {groupConflicts.length} Deficits · {GROUP_LABEL[selectedLine]}
                  </span>
                ) : workOrders.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <Icons.CheckCircle /> 100% Balanced
                  </span>
                ) : null}
              </div>
              <p className="text-[13.5px] text-ink-2 mt-1">
                Live from the Planner: each work order is checked against its own line&apos;s roster for its date and shift. Edit the roster and these numbers update by themselves.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap 2xl:flex-nowrap 2xl:shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx,.xls"
              className="hidden"
            />
            {workOrders.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearModal(true)}
                className="h-10 px-3.5 whitespace-nowrap shrink-0 rounded-xl text-[13px] font-bold border border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/50 transition-all shadow-sm active:scale-95 inline-flex items-center gap-2"
                title="Return to initial work order import screen"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Back to Import Screen</span>
              </button>
            )}

            {workOrders.length > 0 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-10 px-3.5 whitespace-nowrap shrink-0 rounded-xl text-[13px] font-bold border border-[var(--line-strong)] bg-[var(--surface-2)] text-ink hover:bg-[var(--surface-3)] hover:border-[var(--line)] transition-all shadow-sm active:scale-95 inline-flex items-center gap-2"
            >
              {importing ? (
                <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              ) : (
                <Icons.Upload />
              )}
              <span>{importing ? 'Importing…' : 'Import Excel (.xlsx)'}</span>
            </button>
            )}

            <button
              type="button"
              onClick={() => setShowYellowGuide(true)}
              className="h-10 px-3.5 whitespace-nowrap shrink-0 rounded-xl text-[13px] font-bold border border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 transition-all shadow-sm active:scale-95 inline-flex items-center gap-2"
              title="View mandatory yellow columns mapping & data dictionary"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Yellow Headings Guide</span>
            </button>

            {workOrders.length > 0 && (
            <span
              className="h-10 px-3.5 whitespace-nowrap shrink-0 rounded-xl text-[13px] font-bold border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-2"
              title="Allocation is recalculated automatically whenever the Planner roster, people, shift codes or work orders change."
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live sync with Planner
            </span>
            )}

            {workOrders.length > 0 && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="h-10 px-3.5 whitespace-nowrap shrink-0 rounded-xl text-[13px] font-semibold border border-[var(--line)] bg-[var(--surface-2)]/60 text-ink-2 hover:text-ink hover:bg-[var(--surface-3)] transition-all shadow-sm active:scale-95 inline-flex items-center gap-2"
              title="Download full CSV report of assigned engineers"
            >
              <Icons.Download />
              <span>Export CSV</span>
            </button>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
          MAIN FULL-WIDTH BODY
         ========================================================================= */}
      {workOrders.length === 0 ? (
        <EmptyImport
          importing={importing}
          columns={allWorkOrderColumns(extraColumns, settings.removedBuiltinColumns)}
          onPick={() => fileInputRef.current?.click()}
          onDrop={importFile}
          onGuide={() => setShowYellowGuide(true)}
        />
      ) : (
      <div className="w-full px-3 sm:px-6 lg:px-10 py-4 sm:py-6 flex flex-col gap-5 sm:gap-6">
        {/* =========================================================================
            KPI CARDS: 3 SHIFTS MANPOWER & BUFFER DASHBOARD (EXPANDED & LEGIBLE)
           ========================================================================= */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3 px-1">
            <h2 className="text-[14px] font-black text-ink-2 uppercase tracking-wider">
              Shift Manpower Capacity &amp; Net Resource Buffer
            </h2>
            <span className="text-[13px] text-ink-3">
              Buffer = people on that shift in the Planner − crew needed by that day&apos;s work orders
            </span>
          </div>

          {/* Day picker: every date of the selected lines that has work orders */}
          <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-[11.5px] font-black text-ink-3 uppercase tracking-wider shrink-0 mr-1">
              {GROUP_LABEL[selectedLine]} · Day
            </span>
            {groupDates.length === 0 && (
              <span className="text-[12.5px] text-ink-3">No work orders for these lines yet — import a work-order sheet.</span>
            )}
            {groupDates.map((d) => {
              const active = d === cardDate;
              const short = shortDates.has(d);
              const [, mm, dd] = d.split('-');
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPickedDate(d)}
                  title={`${weekdayDate(d)}${short ? ' — staff deficit' : ''}`}
                  className={`relative shrink-0 px-2.5 py-1.5 rounded-lg text-[12px] font-mono font-bold border transition-all ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-transparent'
                      : short
                      ? 'border-red-500/40 text-red-400 bg-red-500/10 hover:bg-red-500/20'
                      : 'border-[var(--line)] text-ink-2 bg-[var(--surface-2)] hover:text-ink'
                  }`}
                >
                  {dd}/{mm}
                  {short && !active && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />}
                </button>
              );
            })}
          </div>
          {cardDate && (
            <p className="mb-3 px-1 text-[13px] text-ink-2">
              Showing <strong className="text-ink">{weekdayDate(cardDate)}</strong>
              {pickedDate ? '' : ' (the day with the biggest deficit)'} · {GROUP_LABEL[selectedLine]}
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
            {cardBalances.map((bal) => {
              const isShort = bal.buffer < 0;
              const isTight = bal.buffer === 0 && bal.demand > 0;
              const loadPercent = bal.onDuty > 0
                ? Math.round((bal.demand / bal.onDuty) * 100)
                : bal.demand > 0 ? 100 : 0;
              const shiftLabel = SHIFT_LABEL[bal.shift];
              const timing = shiftTiming(codesByLine[lineCodeToId(groupLines[0])], bal.shift);

              const isMorning = bal.shift === 'M';
              const isEvening = bal.shift === 'E';

              const accentColor = isMorning
                ? 'var(--sh-m)'
                : isEvening
                ? 'var(--sh-e)'
                : 'var(--sh-n)';

              const accentBg = isMorning
                ? 'var(--sh-m-bg)'
                : isEvening
                ? 'var(--sh-e-bg)'
                : 'var(--sh-n-bg)';

              return (
                <div
                  key={bal.shift}
                  className="rounded-2xl border bg-[var(--surface)] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  style={{
                    borderColor: isShort ? 'rgba(239, 68, 68, 0.45)' : 'var(--line-strong)',
                  }}
                >
                  <div>
                    {/* Shift Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <div
                          className="w-11 h-11 rounded-2xl flex items-center justify-center font-bold shadow-inner"
                          style={{ background: accentBg, color: accentColor }}
                        >
                          {isMorning ? <Icons.Sun /> : isEvening ? <Icons.Sunset /> : <Icons.Moon />}
                        </div>
                        <div>
                          <h3 className="text-[17px] font-black text-ink tracking-tight">
                            {shiftLabel} Shift
                          </h3>
                          <span className="text-[12.5px] font-mono text-ink-3">{timing}</span>
                        </div>
                      </div>

                      {/* Net Buffer Chip */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-black font-mono shadow-sm ${
                          isShort
                            ? 'bg-red-500/20 text-red-400 border border-red-500/35'
                            : isTight
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/35'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/35'
                        }`}
                      >
                        {isShort ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                            {bal.buffer} Staff Deficit
                          </>
                        ) : isTight ? (
                          <>
                            <span>0 At Capacity</span>
                          </>
                        ) : (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            +{bal.buffer} Buffer Available
                          </>
                        )}
                      </span>
                    </div>

                    {/* Prominent Large Metrics Grid */}
                    <div className="grid grid-cols-2 gap-4 my-4 p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)]">
                      <div>
                        <span className="text-[12px] font-bold text-ink-3 uppercase tracking-wider block mb-1">
                          Available Staff
                        </span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-black font-mono text-ink tracking-tight">
                            {bal.onDuty}
                          </span>
                          <span className="text-[13px] font-medium text-ink-3">on {shiftLabel.toLowerCase()}</span>
                        </div>
                      </div>

                      <div>
                        <span className="text-[12px] font-bold text-ink-3 uppercase tracking-wider block mb-1">
                          Activity Demand
                        </span>
                        <div className="flex items-baseline gap-2">
                          <span
                            className="text-4xl font-black font-mono tracking-tight"
                            style={{ color: accentColor }}
                          >
                            {bal.demand}
                          </span>
                          <span className="text-[13px] font-medium text-ink-3">
                            needed · {bal.orders} order{bal.orders === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Progress Utilization Bar */}
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-[12.5px] text-ink-2 font-medium">
                        <span>Load (needed ÷ on shift)</span>
                        <span className="font-mono font-bold text-ink">{loadPercent}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[var(--surface-3)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, loadPercent)}%`,
                            backgroundColor: isShort ? '#ef4444' : isTight ? '#f59e0b' : accentColor,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Footer Breakdown */}
                  <div className="mt-4 pt-3.5 border-t border-[var(--line)] flex items-center justify-between text-[13px] text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                      PM: <strong className="font-mono text-ink font-bold">{bal.pm}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      CM: <strong className="font-mono text-ink font-bold">{bal.cm}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
                      ACS: <strong className="font-mono text-ink font-bold">{bal.acs}</strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* =========================================================================
            INCIDENT / CONFLICT ALERT PANEL
           ========================================================================= */}
        {groupConflicts.length > 0 && (
          <div className="rounded-2xl border border-red-500/35 bg-gradient-to-r from-red-500/10 via-red-950/15 to-transparent p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center shrink-0">
                  <Icons.AlertTriangle />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-red-400">
                    {groupConflicts.length} work order{groupConflicts.length === 1 ? '' : 's'} not fully staffed · {GROUP_LABEL[selectedLine]}
                  </h3>
                  <p className="text-[13.5px] text-ink-2 mt-0.5">
                    Fix it in the Planner: put more people on that shift on that day (or move the work order&apos;s shift). This list clears itself as you edit.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowConflictsExpanded(!showConflictsExpanded)}
                  className="h-10 px-4 rounded-xl text-[13px] font-bold bg-[var(--surface)] border border-red-500/35 text-ink hover:bg-[var(--surface-2)] transition-all"
                >
                  {showConflictsExpanded ? 'Collapse Details' : 'View All Conflicts'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatus('SHORT')}
                  className="h-10 px-4 rounded-xl text-[13px] font-bold bg-red-500 hover:bg-red-600 text-white transition-all shadow-sm active:scale-95"
                >
                  Show shortfalls in table
                </button>
              </div>
            </div>

            {showConflictsExpanded && (
              <div className="mt-4 pt-4 border-t border-red-500/20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                {groupConflicts.map((c) => {
                  const wo = workOrders.find((w) => w.id === c.woId);
                  return (
                    <div
                      key={c.woId}
                      className="p-3.5 rounded-xl bg-[var(--surface)] border border-red-500/25 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-[13px] text-red-400">WO #{wo?.workOrderId ?? c.woId}</span>
                        <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded bg-red-500/15 text-red-400">
                          {c.status === 'NO_ROSTER' ? 'No roster' : c.status === 'UNASSIGNED' ? 'Nobody free' : `Short ${c.needed - c.assignedIds.length}`}
                        </span>
                      </div>
                      <p className="text-[12px] text-ink-3 mt-1.5">
                        {c.lineCode} · {weekdayDate(c.date)} · {SHIFT_LABEL[c.shift]}
                      </p>
                      <p className="text-[12.5px] text-ink-2 my-2 leading-relaxed">{c.reason}</p>
                      <div className="flex items-center justify-between text-[12px] font-mono text-ink-3 pt-2 border-t border-[var(--line)]">
                        <span>Needed: <strong className="text-ink font-bold">{c.needed}</strong></span>
                        <span>Assigned: <strong className="text-red-400 font-bold">{c.assignedIds.length}</strong></span>
                        <button
                          type="button"
                          onClick={() => setPickedDate(c.date)}
                          className="font-sans font-bold text-[var(--accent)] hover:underline"
                        >
                          Show day
                        </button>
                        {onOpenPlanner && c.status !== 'NO_ROSTER' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await openSheet(c.lineId, c.year, c.month);
                              onOpenPlanner();
                            }}
                            title="Open this line & month in the Planner — the shortfall is listed under Insights → Issues with who can cover"
                            className="font-sans font-bold text-red-400 hover:underline"
                          >
                            Fix in Planner →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Import report: what the last Excel import found */}
        {settings.lastWorkOrderImport && (
          <ImportReport
            report={settings.lastWorkOrderImport}
            rowProblems={workOrders.flatMap((w) => w.importWarnings ?? [])}
            onDismiss={() => void updateSettings({ lastWorkOrderImport: undefined })}
          />
        )}

        {/* =========================================================================
            EXECUTIVE SUMMARY RIBBON & LINE GROUP TOOLBAR (MATCHING CLIENT SCREENSHOT)
           ========================================================================= */}
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden shadow-sm">
          {/* Top Metric Strip from Client Screen */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 sm:px-5 py-3 text-[13px] font-medium border-b border-[var(--line)] bg-[var(--surface-2)]/60 text-ink-2">
            <span className="whitespace-nowrap">
              <strong className="text-ink font-bold font-mono text-[14px]">{groupStats.total}</strong> activities ·{' '}
              {GROUP_LABEL[selectedLine]}
            </span>
            <span className="whitespace-nowrap text-emerald-400">
              <strong className="font-bold font-mono text-[14px]">{groupStats.ok}</strong> staffed
            </span>
            <span className="whitespace-nowrap text-rose-400 font-semibold">
              <strong className="font-bold font-mono text-[14px]">{groupStats.short}</strong> short
            </span>
            <span className="whitespace-nowrap text-ink-2">
              <strong className="text-ink font-bold font-mono text-[14px]">{groupStats.unassigned}</strong> nobody free
            </span>
            {groupStats.hasWindow ? (
              <>
                <span className="whitespace-nowrap text-rose-400" title="Scheduled Start outside Start No Earlier Than → Finish No Later Than">
                  <strong className="font-bold font-mono text-[14px]">{groupStats.outside}</strong> planned outside their window
                </span>
                <span className="whitespace-nowrap text-orange-400" title="Finish No Later Than is before today">
                  <strong className="font-bold font-mono text-[14px]">{groupStats.pastFinish}</strong> past Finish No Later Than
                </span>
              </>
            ) : groupStats.total > 0 ? (
              <span className="whitespace-nowrap text-ink-3" title="These work orders have no Start No Earlier Than / Finish No Later Than dates — they were imported before those columns were read. Import the Excel file again.">
                Window checks: re-import the Excel file
              </span>
            ) : null}
            {groupStats.unplaced > 0 && (
              <span className="whitespace-nowrap text-amber-400" title="Listed in the Import report above">
                <strong className="font-bold font-mono text-[14px]">{groupStats.unplaced}</strong> not placed (no Scheduled Start / Line)
              </span>
            )}
            {groupStats.noRoster > 0 && (
              <span className="whitespace-nowrap text-amber-400">
                <strong className="font-bold font-mono text-[14px]">{groupStats.noRoster}</strong> on a line with no people (add them in People)
              </span>
            )}
            <span className="sm:ml-auto text-ink-3 text-[12px] font-mono whitespace-nowrap">
              {groupStats.months.length
                ? `Months: ${groupStats.months.map((m) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); }).join(', ')}`
                : 'No work orders loaded'}
            </span>
          </div>

          {/* Line Group Selector Buttons: Line 4 & 6 in one, Line 5 in one */}
          <div className="p-3 sm:p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2.5 overflow-x-auto">
              {[
                { id: 'L5' as const, count: lineCounts.L5 },
                { id: 'L4_L6' as const, count: lineCounts.L4 + lineCounts.L6 },
                { id: 'ALL' as const, count: workOrders.length },
              ].map((l) => ({ ...l, label: GROUP_LABEL[l.id], shortDays: shortDaysFor(l.id) })).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => handleSelectLineGroup(l.id)}
                  className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-xl text-[13.5px] font-bold transition-all whitespace-nowrap border ${
                    selectedLine === l.id
                      ? 'bg-[var(--surface-3)] text-ink border-indigo-500 shadow-sm ring-1 ring-indigo-500/40'
                      : 'bg-[var(--surface-2)] text-ink-2 hover:text-ink border-[var(--line)]'
                  }`}
                >
                  <span>{l.label}</span>
                  <span className={`font-semibold text-[12px] ${l.shortDays ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {l.shortDays ? `${l.shortDays} short day${l.shortDays === 1 ? '' : 's'}` : 'no short days'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-bold bg-[var(--surface-3)] text-ink-3 border border-[var(--line)]">
                    {l.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Live Search Input */}
            <div className="relative w-full xl:w-96">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Icons.Search />
              </div>
              <input
                type="text"
                placeholder="Search WO ID, description, dept..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-11 pl-10 pr-9 bg-[var(--surface-2)] border border-[var(--line)] rounded-xl text-[13.5px] text-ink placeholder-ink-3 focus:outline-none focus:border-[var(--accent)] transition-all font-sans"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-ink-3 hover:text-ink"
                >
                  <Icons.XCircle />
                </button>
              )}
            </div>
          </div>

          {/* Bottom Row: Type, Shift, and Status Filters */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[var(--line)]">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 min-w-0 max-w-full">
              {/* Work Type Filter */}
              <div className="flex max-w-full items-center gap-1.5 overflow-x-auto bg-[var(--surface-2)] p-1.5 rounded-xl border border-[var(--line)]">
                <span className="text-[11px] font-black text-ink-3 uppercase px-2">Type</span>
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'PM', label: 'PM Prev' },
                  { id: 'CM', label: 'CM Corr' },
                  { id: 'ACS', label: 'ACS Check' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedType(t.id)}
                    className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-lg text-[12.5px] font-bold transition-all ${
                      selectedType === t.id
                        ? 'bg-[var(--surface)] text-ink shadow-sm'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Shift Filter */}
              <div className="flex max-w-full items-center gap-1.5 overflow-x-auto bg-[var(--surface-2)] p-1.5 rounded-xl border border-[var(--line)]">
                <span className="text-[11px] font-black text-ink-3 uppercase px-2">Shift</span>
                {[
                  { id: 'ALL', label: 'All Shifts' },
                  { id: 'M', label: 'Morning' },
                  { id: 'E', label: 'Evening' },
                  { id: 'N', label: 'Night' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedShift(s.id)}
                    className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-lg text-[12.5px] font-bold transition-all ${
                      selectedShift === s.id
                        ? 'bg-[var(--surface)] text-ink shadow-sm'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Status Filter */}
              <div className="flex max-w-full items-center gap-1.5 overflow-x-auto bg-[var(--surface-2)] p-1.5 rounded-xl border border-[var(--line)]">
                <span className="shrink-0 text-[11px] font-black text-ink-3 uppercase px-2">Status</span>
                {[
                  { id: 'ALL', label: 'All', dot: '', hint: 'Every work order' },
                  { id: 'OK', label: 'Staffed', dot: 'bg-emerald-400', hint: 'Enough people on that shift that day' },
                  { id: 'SHORT', label: 'Shortfall', dot: 'bg-red-400', hint: 'Some people assigned, but fewer than needed' },
                  { id: 'UNASSIGNED', label: 'Unassigned', dot: 'bg-gray-400', hint: 'Nobody free on that shift, or no people set up for the line' },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    title={st.hint}
                    onClick={() => setSelectedStatus(st.id)}
                    className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-lg text-[12.5px] font-bold transition-all ${
                      selectedStatus === st.id
                        ? 'bg-[var(--surface)] text-ink shadow-sm'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {st.dot && <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />}
                      {st.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Counts & Clear */}
            <div className="flex items-center gap-4 text-[13px] text-ink-2 ml-auto">
              <span>
                Showing <strong className="text-ink font-bold">{filteredWorkOrders.length}</strong> of {workOrders.length} activities
              </span>
              {workOrders.length > 0 && (
                <button
                  type="button"
                  onClick={clearWorkOrders}
                  className="text-red-400 hover:text-red-300 font-bold hover:underline transition-all"
                >
                  Clear all activities
                </button>
              )}
            </div>
          </div>
        </div>

        {/* =========================================================================
            ENTERPRISE FULL-WIDTH DATA TABLE
           ========================================================================= */}
        {/* Phones: one card per work order (the table needs too much width) */}
        <div className="md:hidden flex flex-col gap-3">
          {filteredWorkOrders.length === 0 && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center text-[13px] text-ink-3">
              No activities match your filters.
            </div>
          )}
          {filteredWorkOrders.map((wo) => {
            const live = workload.byWo[wo.id];
            const w = windowCheck(wo, todayIso);
            const needed = live?.needed ?? (wo.resourceRequired || 1);
            const status = live?.status;
            const pill =
              status === 'OK'
                ? ['Staffed', 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30']
                : status === 'SHORT'
                ? ['Shortfall', 'bg-red-500/15 text-red-400 border-red-500/30']
                : status === 'UNPLACED'
                ? ['Not placed', 'bg-amber-500/15 text-amber-400 border-amber-500/30']
                : status === 'NO_ROSTER'
                ? ['No roster', 'bg-[var(--surface-3)] text-ink-3 border-[var(--line)]']
                : ['Nobody free', 'bg-[var(--surface-3)] text-ink-3 border-[var(--line)]'];
            return (
              <div key={wo.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono font-bold">
                      <span className="text-ink text-[13px]">{wo.workOrderId}</span>
                      {wo.line && !off('Line') && <span className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-ink-2 border border-[var(--line)]">{wo.line}</span>}
                      <span className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-ink-2 border border-[var(--line)]">{wo.workType}</span>
                      {wo.assetGroup && !off('Asset Group') && <span className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-ink-3 border border-[var(--line)]">{wo.assetGroup}</span>}
                    </div>
                    {!off('Description') && <p className="mt-1 text-[13px] font-semibold text-ink leading-snug">{wo.description || 'No description'}</p>}
                    {extraChips(wo).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{extraChips(wo)}</div>}
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold border ${pill[1]}`}>
                    {pill[0]}
                    {status === 'OK' || status === 'SHORT' ? ` ${live?.assignedIds.length}/${needed}` : ''}
                  </span>
                </div>

                <div className="mt-2 text-[12px] text-ink-2">
                  {wo.scheduledStart ? formatDisplayDate(wo.scheduledStart) : 'No Scheduled Start'}
                  {live && live.status !== 'UNPLACED' && <> · {SHIFT_LABEL[live.shift]} · {live.onShift} on shift</>}
                </div>
                {(w.outsideWindow || w.pastFinish) && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[10.5px] font-bold">
                    {w.outsideWindow && <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400">Outside window</span>}
                    {w.pastFinish && <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">Past FNLT</span>}
                  </div>
                )}
                {live?.reason && <p className="mt-1.5 text-[12px] text-red-400">{live.reason}</p>}
                {wo.importWarnings?.length ? <p className="mt-1 text-[12px] text-amber-400">⚠ {wo.importWarnings.join(' · ')}</p> : null}
                {live && live.assignedNames.length > 0 && (
                  <p className="mt-1.5 text-[12px] text-ink-2">
                    <span className="text-ink-3">Crew:</span> {live.assignedNames.join(', ')}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-ink-3">Crew</span>
                    <button
                      type="button"
                      disabled={needed <= 1}
                      onClick={() => saveWorkOrder({ ...wo, resourceRequired: needed - 1, crewSource: 'manual' })}
                      className="w-7 h-7 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-3)] font-bold disabled:opacity-30"
                      aria-label="Decrease required crew"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-mono font-black text-[13px]">{needed}</span>
                    <button
                      type="button"
                      onClick={() => saveWorkOrder({ ...wo, resourceRequired: needed + 1, crewSource: 'manual' })}
                      className="w-7 h-7 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-3)] font-bold"
                      aria-label="Increase required crew"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingWo(wo)}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-bold text-[var(--accent)] border border-[var(--accent)]/30"
                  >
                    Manage Crew
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block rounded-2xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-[var(--surface-2)] border-b border-[var(--line)] text-[11.5px] uppercase font-bold text-ink-3 tracking-wider select-none">
                  <th className="py-4 px-5">Work Order ID</th>
                  <th className="py-4 px-5">{off('Description') ? 'Details' : 'Description'}</th>
                  {extraColumns.map((c) => (
                    <th key={c.appField} className="py-4 px-5">{c.excelHeader}</th>
                  ))}
                  <th className="py-4 px-5 text-center">Line</th>
                  <th className="py-4 px-5 text-center">Work Type</th>
                  <th className="py-4 px-5">Scheduled Date</th>
                  <th className="py-4 px-5 text-center">Required People</th>
                  <th className="py-4 px-5 text-center">Status</th>
                  <th className="py-4 px-5">Allocated Engineers</th>
                  <th className="py-4 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {filteredWorkOrders.map((wo) => {
                  const live = workload.byWo[wo.id];
                  const isShort = live?.status === 'SHORT';
                  const isOk = live?.status === 'OK';
                  const assignedNames = live?.assignedNames ?? [];
                  const assignedCount = assignedNames.length;
                  const neededCount = live?.needed ?? (wo.resourceRequired || 1);

                  return (
                    <tr
                      key={wo.id}
                      className="hover:bg-[var(--surface-2)]/75 transition-colors group"
                    >
                      {/* 1. Work Order ID */}
                      <td className="py-4 px-5 font-mono font-bold text-ink whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(wo.workOrderId)}
                          className="hover:text-[var(--accent)] hover:underline flex items-center gap-1 group-hover:text-[var(--accent)] text-[14px]"
                          title="Click to copy Work Order ID"
                        >
                          <span>{wo.workOrderId}</span>
                        </button>
                      </td>

                      {/* 2. Description (with Department tag) */}
                      <td className="py-4 px-5 max-w-md">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {[off('Div / Depart') ? '' : wo.department, off('Asset Group') ? '' : wo.assetGroup].filter(Boolean).map((t) => (
                            <span key={t} className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[var(--surface-3)] text-ink-3 border border-[var(--line)]">
                              {t}
                            </span>
                          ))}
                          {!off('Description') && (
                            <span
                              className="text-ink font-semibold text-[13.5px] leading-snug line-clamp-2"
                              title={wo.description}
                            >
                              {wo.description || <em className="text-ink-3">No description</em>}
                            </span>
                          )}
                        </div>
                        {wo.location && !off('Location') && (
                          <div className="text-[11.5px] font-mono text-ink-3" title="Location">📍 {wo.location}</div>
                        )}
                        
                        {live?.reason && (
                          <div className="text-[12px] text-red-400 mt-1 flex items-center gap-1 font-medium">
                            <Icons.AlertTriangle />
                            <span>{live.reason}</span>
                          </div>
                        )}
                        {wo.importWarnings && wo.importWarnings.length > 0 && (
                          <div className="text-[12px] text-amber-400 mt-1 font-medium" title={wo.importWarnings.join('\n')}>
                            ⚠ {wo.importWarnings.join(' · ')}
                          </div>
                        )}
                      </td>

                      {/* Columns added in Setup → Excel import columns */}
                      {extraColumns.map((c) => (
                        <td key={c.appField} className="py-4 px-5 text-[13px] text-ink-2 max-w-[200px]">
                          {wo.extra?.[c.appField] || <span className="text-ink-3">—</span>}
                        </td>
                      ))}

                      {/* 3. Line */}
                      <td className="py-4 px-5 text-center font-mono whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[12px] font-black ${
                            wo.line === 'L4'
                              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                              : wo.line === 'L6'
                              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {wo.line}
                        </span>
                      </td>

                      {/* 4. Work Type */}
                      <td className="py-4 px-5 text-center font-mono font-black text-[12px] whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg uppercase tracking-wider ${
                            wo.workType === 'PM'
                              ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                              : wo.workType === 'CM'
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                          }`}
                        >
                          {wo.workType}
                        </span>
                      </td>

                      {/* 5. Scheduled Date (Clean formatted dates) */}
                      <td className="py-4 px-5 font-mono text-[12px] text-ink-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5" title="Scheduled Start — the day this is placed on the Planner">
                          <Icons.Calendar />
                          <span className="font-semibold text-ink">
                            {wo.scheduledStart ? formatDisplayDate(wo.scheduledStart) : 'No Scheduled Start'}
                          </span>
                        </div>
                        {(wo.startNoEarlier || wo.finishNoLater) && !off('Start No Earlier Than') && !off('Finish No Later Than') && (
                          <div className="mt-1 text-[11px] text-ink-3" title="Allowed window: Start No Earlier Than → Finish No Later Than">
                            Window {wo.startNoEarlier ? formatDisplayDate(wo.startNoEarlier) : '…'} → {wo.finishNoLater ? formatDisplayDate(wo.finishNoLater) : '…'}
                          </div>
                        )}
                        {(() => {
                          const w = windowCheck(wo, todayIso);
                          return (
                            <div className="mt-1 flex flex-wrap gap-1 font-sans text-[10.5px] font-bold">
                              {w.outsideWindow && <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">Outside window</span>}
                              {w.pastFinish && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">Past FNLT</span>}
                              {!off('Target Start') && w.slipDays !== null && w.slipDays !== 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-ink-3 border border-[var(--line)]" title="Scheduled Start vs Target Start">
                                  Target {w.slipDays > 0 ? `+${w.slipDays}` : w.slipDays}d
                                </span>
                              )}
                              {!off('Reported Date') && w.ageDays !== null && (
                                <span className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-ink-3 border border-[var(--line)]" title="Days since Reported Date">
                                  Age {w.ageDays}d
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {live && live.status !== 'UNPLACED' && (
                          <div className="mt-1 text-[11.5px] font-sans font-semibold text-ink-3">
                            {SHIFT_LABEL[live.shift]} · {live.onShift} on shift in Planner
                          </div>
                        )}
                      </td>

                      {/* 6. Required People (Editable with steppers) */}
                      <td className="py-4 px-5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center justify-center gap-1.5 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shadow-sm">
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const current = neededCount;
                              if (current <= 1) return;
                              await saveWorkOrder({ ...wo, resourceRequired: current - 1, crewSource: 'manual' });
                              toast(`Updated ${wo.workOrderId} required crew: ${current - 1}`, 'ok');
                            }}
                            disabled={neededCount <= 1}
                            className="w-6 h-6 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-3)] text-ink hover:border-[var(--accent)] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center font-bold text-xs transition-colors"
                            title="Decrease required crew"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-mono font-black text-[13px] text-ink select-none">
                            {neededCount}
                          </span>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const current = neededCount;
                              await saveWorkOrder({ ...wo, resourceRequired: current + 1, crewSource: 'manual' });
                              toast(`Updated ${wo.workOrderId} required crew: ${current + 1}`, 'ok');
                            }}
                            className="w-6 h-6 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-3)] text-ink hover:border-[var(--accent)] flex items-center justify-center font-bold text-xs transition-colors"
                            title="Increase required crew"
                          >
                            +
                          </button>
                        </div>
                        <div className="mt-1 text-[10.5px] font-semibold">
                          {live?.crewFromStandard ? (
                            <span className="text-ink-3" title="Crew size from Setup → Work Order Resource Standards (this line, type and shift)">
                              Setup standard
                            </span>
                          ) : wo.crewSource === 'manual' ? (
                            <button
                              type="button"
                              onClick={async () => {
                                await saveWorkOrder({ ...wo, resourceRequired: 0, crewSource: 'standard' });
                                toast(`${wo.workOrderId} now uses the Setup standard crew.`, 'ok');
                              }}
                              className="text-[var(--accent)] hover:underline"
                              title="Go back to the crew size from Setup → Work Order Resource Standards"
                            >
                              ↺ Use standard
                            </button>
                          ) : (
                            <span className="text-ink-3">From file</span>
                          )}
                        </div>
                      </td>

                      {/* 7. Status */}
                      <td className="py-4 px-5 text-center whitespace-nowrap" title={live?.reason ?? ''}>
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold ${
                            isOk
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : isShort
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : 'bg-[var(--surface-3)] text-ink-3 border border-[var(--line)]'
                          }`}
                        >
                          {isOk ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-emerald-400" />
                              <span>Staffed ({assignedCount}/{neededCount})</span>
                            </>
                          ) : isShort ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                              <span>Shortfall ({assignedCount}/{neededCount})</span>
                            </>
                          ) : (
                            <>
                              <span className="w-2 h-2 rounded-full bg-gray-400" />
                              <span>
                                {live?.status === 'UNPLACED' ? 'Not placed' : live?.status === 'NO_ROSTER' ? 'No roster' : `Nobody free (0/${neededCount})`}
                              </span>
                            </>
                          )}
                        </span>
                      </td>

                      {/* 8. Allocated Staff */}
                      <td className="py-4 px-5 max-w-xs">
                        {assignedCount > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {live?.manual && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30" title="Crew picked by hand in Manage Crew">
                                Manual
                              </span>
                            )}
                            {assignedNames.map((name, i) => {
                              const initials = name
                                .split(' ')
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join('');
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold bg-[var(--surface-3)] text-ink border border-[var(--line-strong)]"
                                >
                                  <span className="w-4 h-4 rounded-full bg-[var(--accent)]/25 text-[var(--accent)] text-[10px] font-black flex items-center justify-center">
                                    {initials}
                                  </span>
                                  <span>{name}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingWo(wo)}
                            className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink italic border border-dashed border-[var(--line-strong)] px-2.5 py-1 rounded-lg hover:bg-[var(--surface-2)] transition-all"
                          >
                            <span>+ Assign Staff</span>
                          </button>
                        )}
                      </td>

                      {/* 9. Actions */}
                      <td className="py-4 px-5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditingWo(wo)}
                          className="px-3 py-1.5 rounded-lg text-[12.5px] font-bold text-[var(--accent)] hover:bg-[var(--accent)]/15 border border-[var(--accent)]/30 transition-all mr-2"
                        >
                          Manage Crew
                        </button>
                        <button
                          type="button"
                          onClick={() => removeWorkOrder(wo.id)}
                          className="p-1.5 rounded-lg text-ink-3 hover:text-red-400 hover:bg-red-500/15 transition-all"
                          title="Delete activity"
                        >
                          <Icons.Trash />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredWorkOrders.length === 0 && (
                  <tr>
                    <td colSpan={10 + extraColumns.length} className="py-20 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center text-ink-3 border border-[var(--line)]">
                          <Icons.Clipboard />
                        </div>
                        <h4 className="text-[16px] font-bold text-ink">No activities match your filters</h4>
                        <p className="text-[13px] text-ink-3 max-w-md">
                          Adjust line, work type, or shift filters, or upload a November Work Orders Excel workbook.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* =========================================================================
          CREW ASSIGNMENT MODAL (EXPANDED & SPACIOUS)
         ========================================================================= */}
      {editingWo && (
        <CrewAssignmentModal
          wo={editingWo}
          live={workload.byWo[editingWo.id]}
          staffForShift={staffForShift}
          codes={codesByLine[lineCodeToId(normalizeLineCode(editingWo.line))]}
          allEmployees={allEmployees}
          onClose={() => setEditingWo(null)}
          onSave={async (updated) => {
            await saveWorkOrder(updated);
            toast(`Saved updates for Work Order #${updated.workOrderId}.`, 'ok');
            setEditingWo(null);
          }}
        />
      )}

      {/* =========================================================================
          MANDATORY YELLOW COLUMNS DATA DICTIONARY MODAL
         ========================================================================= */}
      {showYellowGuide && (
        <YellowColumnsModal
          columns={allWorkOrderColumns(extraColumns, settings.removedBuiltinColumns)}
          isOpen={showYellowGuide}
          onClose={() => setShowYellowGuide(false)}
        />
      )}

      {/* Return to Import Screen Confirmation Modal */}
      {showClearModal && (
        <Modal
          open={showClearModal}
          onClose={() => setShowClearModal(false)}
          title="Return to Import Screen"
        >
          <div className="flex flex-col gap-4 text-ink">
            <p className="text-[13.5px] text-ink-2 leading-relaxed">
              Are you sure you want to return to the initial work order import screen?
              This will clear the currently loaded activities from view so you can upload or test a new file from scratch.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowClearModal(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="font-bold shadow-sm"
                onClick={async () => {
                  await clearWorkOrders();
                  setShowClearModal(false);
                  toast('Returned to initial import screen.', 'ok');
                }}
              >
                Yes, Back to Import Screen
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Crew Assignment Modal Component
 */
function CrewAssignmentModal({
  wo,
  live,
  staffForShift,
  codes,
  allEmployees,
  onClose,
  onSave,
}: {
  wo: WorkOrder;
  live: LiveAllocation | undefined;
  staffForShift: (lineId: string, isoDate: string, shift: ShiftFamily) => Employee[];
  codes: ShiftCode[] | undefined;
  allEmployees: Employee[];
  onClose: () => void;
  onSave: (wo: WorkOrder) => Promise<void>;
}) {
  const [draft, setDraft] = useState<WorkOrder>({
    ...wo,
    plannedShift: wo.plannedShift ?? workOrderShift(wo),
    resourceRequired: live?.needed ?? (wo.resourceRequired || 1),
    // keep the crew size's source unless the crew stepper below is used
    crewSource: wo.crewSource ?? (usesStandardCrew(wo) ? 'standard' : 'file'),
    // Start from what the live allocation currently gives this order
    assignedEmployeeIds: wo.crewMode === 'manual' ? wo.assignedEmployeeIds ?? [] : live?.assignedIds ?? [],
  });
  const lineId = lineCodeToId(normalizeLineCode(draft.line));
  const shift = (draft.plannedShift ?? 'M') as ShiftFamily;
  const isoDate = parseDateToIso(draft.scheduledStart);

  // Only people the Planner has on this shift on this day can be picked
  const onShift = useMemo(() => staffForShift(lineId, isoDate, shift), [staffForShift, lineId, isoDate, shift]);
  const onShiftIds = new Set(onShift.map((e) => e.id));
  const lineStaff = useMemo(
    // Line 4 & 6 share one team: offer people from both lines
    () => allEmployees.filter((e) => POOL_LINES[poolOfLineId(lineId)].ids.includes(e.lineId) && e.active !== false),
    [allEmployees, lineId],
  );
  const eligibleEmployees = [...onShift, ...lineStaff.filter((e) => !onShiftIds.has(e.id))];

  const assignedIds = new Set((draft.assignedEmployeeIds || []).filter((id) => onShiftIds.has(id)));

  const toggleEmployee = (emp: Employee) => {
    if (!onShiftIds.has(emp.id)) return;
    const next = new Set(assignedIds);
    if (next.has(emp.id)) next.delete(emp.id);
    else next.add(emp.id);
    setDraft({ ...draft, assignedEmployeeIds: [...next] });
  };

  const handleAutoFill = () => {
    setDraft({ ...draft, assignedEmployeeIds: onShift.slice(0, draft.resourceRequired).map((e) => e.id) });
  };

  const saveManual = () => {
    const ids = [...assignedIds];
    return onSave({
      ...draft,
      crewMode: 'manual',
      assignedEmployeeIds: ids,
      assignedEmployeeNames: ids.map((id) => lineStaff.find((e) => e.id === id)?.name ?? id),
      allocationStatus: undefined,
      conflictReason: undefined,
    });
  };

  const saveAutomatic = () =>
    onSave({
      ...draft,
      crewMode: 'auto',
      assignedEmployeeIds: [],
      assignedEmployeeNames: [],
      allocationStatus: undefined,
      conflictReason: undefined,
    });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Staff Assignment · WO #${draft.workOrderId}`}
      description={draft.description}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={saveAutomatic} title="Let the live allocation pick the crew from the roster">
            Use automatic crew
          </Button>
          <Button variant="primary" onClick={saveManual}>
            Save hand-picked crew
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 text-ink">
        {/* Summary Card */}
        <div className="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <span className="text-[11px] font-bold text-ink-3 uppercase block">Production Line</span>
            <span className="font-mono font-black text-ink text-[15px]">{draft.line}</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-ink-3 uppercase block">Work Type</span>
            <span className="font-mono font-black text-ink text-[15px]">{draft.workType}</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-ink-3 uppercase block">Execution Window</span>
            <span className="font-mono text-ink text-[12px] block">{weekdayDate(isoDate)}</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-ink-3 uppercase block">Demand Target</span>
            <span className="font-mono font-black text-[var(--accent)] text-[15px]">
              {draft.resourceRequired} Staff
            </span>
          </div>
        </div>

        {/* Crew Size Stepper & Shift */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[12px] uppercase font-bold text-ink-3 block mb-1.5">
              Required Crew Count
            </label>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...draft, resourceRequired: Math.max(1, draft.resourceRequired - 1), crewSource: 'manual' })
                }
                className="w-10 h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] font-bold text-ink hover:bg-[var(--surface-3)] text-lg"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={12}
                value={draft.resourceRequired}
                onChange={(e) =>
                  setDraft({ ...draft, resourceRequired: Math.max(1, parseInt(e.target.value, 10) || 1), crewSource: 'manual' })
                }
                className="w-24 h-10 text-center font-mono font-black text-lg bg-[var(--surface)] border border-[var(--line)] rounded-xl text-ink"
              />
              <button
                type="button"
                onClick={() => setDraft({ ...draft, resourceRequired: draft.resourceRequired + 1, crewSource: 'manual' })}
                className="w-10 h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] font-bold text-ink hover:bg-[var(--surface-3)] text-lg"
              >
                +
              </button>
            </div>
          </div>

          <div>
            <label className="text-[12px] uppercase font-bold text-ink-3 block mb-1.5">
              Assigned Shift
            </label>
            <Select
              value={draft.plannedShift || 'M'}
              onChange={(e) => setDraft({ ...draft, plannedShift: e.target.value as ShiftFamily })}
            >
              {SHIFT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {SHIFT_LABEL[f]} Shift {shiftTiming(codes, f) ? `(${shiftTiming(codes, f)})` : ''}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Staff Selection Grid */}
        <div className="mt-1">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[13px] font-bold text-ink flex items-center gap-2">
              <span>
                On {SHIFT_LABEL[shift]} that day in the Planner: {onShift.length}
              </span>
              <span className="font-mono text-[12px] text-[var(--accent)] font-bold">
                ({assignedIds.size} of {draft.resourceRequired} selected)
              </span>
            </span>
            <button
              type="button"
              onClick={handleAutoFill}
              className="text-[12.5px] font-bold text-[var(--accent)] hover:underline"
            >
              Pick first {Math.min(draft.resourceRequired, onShift.length)} on shift
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
            {eligibleEmployees.map((emp) => {
              const isSelected = assignedIds.has(emp.id);
              const available = onShiftIds.has(emp.id);
              const initials = emp.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('');

              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => toggleEmployee(emp)}
                  disabled={!available}
                  title={available ? '' : `Not on ${SHIFT_LABEL[shift]} on this day in the Planner`}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'bg-[var(--accent)]/20 border-[var(--accent)] text-ink shadow-sm'
                      : 'bg-[var(--surface-2)]/70 border-[var(--line)] text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[11px] shadow-sm ${
                      isSelected
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                        : 'bg-[var(--surface-3)] text-ink-3'
                    }`}
                  >
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-bold truncate text-ink">{emp.name}</div>
                    <div className="text-[11.5px] text-ink-3 flex items-center gap-1.5 mt-0.5">
                      <span>{available ? `On ${SHIFT_LABEL[shift]} this day` : 'Off / other shift this day'}</span>
                      {emp.isLeader && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/25 text-amber-400 font-black text-[10px]">
                          LEADER
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-lg font-black">
                    {isSelected ? (
                      <span className="text-[var(--accent)]">✓</span>
                    ) : (
                      <span className="text-ink-3/50">○</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Mandatory Yellow Columns Guide Modal
 */
function YellowColumnsModal({
  columns,
  isOpen,
  onClose,
}: {
  columns: WorkOrderColumn[];
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;
  const required = columns.filter((c) => c.required).length;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Work-order Excel — Yellow (mandatory) columns"
      width={880}
    >
      <div className="flex flex-col gap-5 text-ink">
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[13px] text-ink-2 leading-relaxed">
          <h4 className="text-[14px] font-bold text-amber-300 mb-1">
            Only these {columns.length} columns are read ({required} mandatory)
          </h4>
          Columns are matched by <strong className="text-ink">header name</strong>, so their order in Excel doesn&apos;t
          matter and title rows above the header are fine. Every other column (Status, Asset, SR Affected, Actual
          Start …) is ignored. A missing column or blank cell is reported, e.g. <em>&quot;Row 45: Scheduled Start missing&quot;</em>.
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-3)] border-b border-[var(--line)] text-[11px] uppercase font-bold text-ink-3 tracking-wider">
                <th className="py-3 px-4 w-10">#</th>
                <th className="py-3 px-4">Excel header</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Used for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {columns.map((c, i) => (
                <tr key={c.excelHeader}>
                  <td className="py-3 px-4 font-mono text-ink-3">{i + 1}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">{c.excelHeader}</span>
                    {c.required && <span className="ml-1.5 text-[10.5px] font-bold text-rose-400">required</span>}
                    {c.aliases?.length ? (
                      <div className="mt-1 text-[11px] text-ink-3">also: {c.aliases.join(', ')}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-4 font-mono text-[12px] text-ink-3">{c.type}</td>
                  <td className="py-3 px-4 text-ink-2 text-[12.5px] leading-snug">{c.usedFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12.5px] text-ink-2 leading-relaxed">
          <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
            <h5 className="font-bold text-ink mb-1">How the dates are used</h5>
            <strong>Scheduled Start</strong> places the work on the Planner and counts in shift demand.{' '}
            <strong>Start No Earlier Than → Finish No Later Than</strong> is the allowed window (outside it = flagged; FNLT before today = &quot;past FNLT&quot;).{' '}
            <strong>Target Start</strong> and <strong>Reported Date</strong> are reference only (target slip, age).
          </div>
          <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
            <h5 className="font-bold text-ink mb-1">Not in the file → worked out</h5>
            <strong>Work type</strong> from the Description:{' '}
            {WORK_TYPE_RULES.map((r) => `${r.type} if it mentions ${r.pattern.source.replace(/\\b|\(|\)/g, '').split('|').slice(0, 4).join(', ')}…`).join('; ')}; otherwise PM.{' '}
            <strong>Crew size</strong> from Setup → Work Order Resource Standards.
          </div>
        </div>

        <p className="text-[12px] text-ink-3">
          Need another column? Add it in <strong className="text-ink-2">Setup → Excel import columns</strong> (header, type, mandatory),
          then import the file again. No code change needed.
        </p>

        <div className="flex justify-end pt-1">
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * First screen for a team with no work orders yet: drop the Excel file here.
 * After the import the normal Work Orders page appears with the data.
 */
function EmptyImport({
  importing,
  columns,
  onPick,
  onDrop,
  onGuide,
}: {
  importing: boolean;
  columns: WorkOrderColumn[];
  onPick: () => void;
  onDrop: (file: File) => void;
  onGuide: () => void;
}) {
  const [over, setOver] = useState(false);
  const steps = [
    { n: 1, title: 'Import your Excel', text: 'Drop the monthly work-order sheet here, or click to choose it.' },
    { n: 2, title: 'Yellow columns are read', text: `Only the ${columns.length} yellow columns, matched by header name. Problems are listed row by row.` },
    { n: 3, title: 'Live staffing check', text: 'Every work order is matched to the Planner roster for its day and shift — deficits update as you edit.' },
  ];

  return (
    <div className="w-full px-3 sm:px-6 lg:px-10 py-6 sm:py-10">
      <div className="mx-auto max-w-4xl flex flex-col gap-6">
        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => !importing && onPick()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !importing && onPick()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file && !importing) onDrop(file);
          }}
          className={`relative overflow-hidden rounded-3xl border-2 border-dashed px-6 py-12 sm:py-16 text-center cursor-pointer transition-all ${
            over
              ? 'border-[var(--accent)] bg-[var(--accent)]/10 scale-[1.01]'
              : 'border-[var(--line-strong)] bg-[var(--surface)] hover:border-[var(--accent)]/60 hover:bg-[var(--surface-2)]'
          }`}
        >
          <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-[28rem] rounded-full bg-[var(--accent)]/15 blur-3xl" />
          <div className="relative flex flex-col items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/15 text-[var(--accent)] shadow-sm">
              {importing ? (
                <span className="h-7 w-7 rounded-full border-[3px] border-current/30 border-t-current animate-spin" />
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M12 18v-6" />
                  <path d="M9 15l3-3 3 3" />
                </svg>
              )}
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-ink">
                {importing ? 'Reading your work orders…' : 'Import your work orders to get started'}
              </h2>
              <p className="mt-2 text-[14px] text-ink-2 max-w-lg mx-auto leading-relaxed">
                {importing
                  ? 'Checking the yellow columns and matching every work order to the Planner roster.'
                  : 'Drag and drop your Excel file here, or click to choose it. Nothing is shown until you import — your data stays in this browser.'}
              </p>
            </div>
            {!importing && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[14px] font-bold text-[var(--accent-ink)] shadow-md">
                <Icons.Upload /> Choose Excel file
              </span>
            )}
            <span className="text-[12px] text-ink-3">.xlsx or .xls</span>
          </div>
        </div>

        {/* How it works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {steps.map((st) => (
            <div key={st.n} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)]/15 text-[13px] font-black text-[var(--accent)]">
                  {st.n}
                </span>
                <span className="text-[14px] font-bold text-ink">{st.title}</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{st.text}</p>
            </div>
          ))}
        </div>

        {/* Columns the file needs */}
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-ink">Columns your file needs</span>
            <button type="button" onClick={onGuide} className="text-[12.5px] font-bold text-[var(--accent)] hover:underline">
              What each column is for →
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {columns.map((c) => (
              <span
                key={c.excelHeader}
                title={c.usedFor}
                className="px-2 py-1 rounded-lg text-[12px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30"
              >
                {c.excelHeader}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink-3">
            Column order doesn&apos;t matter and other columns are ignored. Need another column? Add it in Setup → Excel import columns.
          </p>
        </div>
      </div>
    </div>
  );
}

/** What the last import found: missing columns (whole file) and row problems. */
function ImportReport({
  report,
  rowProblems,
  onDismiss,
}: {
  report: NonNullable<ReturnType<typeof useStore>['settings']['lastWorkOrderImport']>;
  rowProblems: string[];
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const clean = report.fileErrors.length === 0 && rowProblems.length === 0;
  return (
    <div
      className={`rounded-2xl border p-4 text-[13px] ${
        clean ? 'border-emerald-500/30 bg-emerald-500/5' : report.fileErrors.length ? 'border-red-500/35 bg-red-500/5' : 'border-amber-500/35 bg-amber-500/5'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-bold text-ink">Import report</span>
          <span className="text-ink-2">
            <span className="font-mono">{cleanLineNames(report.fileName)}</span> · {new Date(report.at).toLocaleString('en-GB')} · {report.rows} rows · header on row {report.headerRow}
          </span>
          {clean ? (
            <span className="font-semibold text-emerald-400">✓ All yellow columns found, no row problems</span>
          ) : (
            <>
              {report.fileErrors.length > 0 && (
                <span className="font-semibold text-red-400">{report.fileErrors.length} missing column{report.fileErrors.length === 1 ? '' : 's'}</span>
              )}
              {rowProblems.length > 0 && (
                <span className="font-semibold text-amber-400">{rowProblems.length} row problem{rowProblems.length === 1 ? '' : 's'}</span>
              )}
              <button type="button" onClick={() => setOpen(!open)} className="font-bold text-[var(--accent)] hover:underline">
                {open ? 'Hide details' : 'Show details'}
              </button>
            </>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[12px] font-bold text-ink-3 hover:text-ink px-2.5 py-1 rounded-lg hover:bg-[var(--surface-2)] transition-all ml-auto border border-[var(--line)]"
            title="Dismiss import report"
          >
            ✕ Dismiss
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-3 max-h-60 overflow-y-auto space-y-1 font-mono text-[12px]">
          {report.fileErrors.map((e) => (
            <li key={e} className="text-red-400">✕ {cleanLineNames(e)}</li>
          ))}
          {rowProblems.map((e, i) => (
            <li key={i} className="text-amber-300">⚠ {cleanLineNames(e)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
