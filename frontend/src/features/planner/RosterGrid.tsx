import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useStore } from '@/app/store';
import { useViewport } from '@/app/useViewport';
import { codeVars } from '@/app/tones';
import { cx } from '@/components/ui';
import { todayIndex } from '@/domain/calendar';
import { formatHours } from '@/domain/hours';
import { isLeaderEmployee } from '@/domain/rotation';
import { OFF, type Issue, type ShiftCode } from '@/domain/types';

import { CellPicker } from './CellPicker';

/** Grid metrics per layout tier. Touch targets grow on small screens. */
const METRICS = {
  desktop: { name: 228, cell: 38, row: 30 },
  tablet: { name: 180, cell: 40, row: 34 },
  mobile: { name: 132, cell: 40, row: 38 },
} as const;

export interface Focus {
  employeeId: string;
  dayIndex: number;
}

export interface JumpTarget {
  employeeId?: string;
  dayIndex?: number;
  /** Changes on every request so the same target can be jumped to twice. */
  nonce: number;
}

interface Props {
  /** The shift code being painted, or null for select-mode. */
  brush: string | null;
  /** Bumped by the Generate action to replay the reveal animation. */
  revealKey: number;
  /** Set by the Insights panel: scroll to and highlight this cell or day. */
  jumpTo: JumpTarget | null;
  onOpenImport?: () => void;
}

export function RosterGrid({ brush, revealKey, jumpTo, onOpenImport }: Props) {
  const {
    roster, employees, codes, columns, days, issues, settings, hours, paintCell, paintRange,
    setExtraHours,
  } = useStore();
  const viewport = useViewport();
  const zoom = (settings.zoomLevel ?? 100) / 100;
  const base = METRICS[viewport];
  const NAME_COL = Math.round(base.name * zoom);
  const CELL_W = Math.round(base.cell * zoom);
  const CELL_H = Math.round(base.row * zoom);
  /** Width of each month-total column (Hrs, OT) pinned to the right edge. */
  const TOTAL_W = Math.round(50 * zoom);
  const showContact = viewport === 'desktop';

  const [focus, setFocus] = useState<Focus | null>(null);
  const [picker, setPicker] = useState<{ focus: Focus; x: number; y: number } | null>(null);
  const drag = useRef<{ employeeId: string; from: number; to: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ employeeId: string; from: number; to: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  }, []);

  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);
  const today = todayIndex(settings.activeYear, settings.activeMonth);

  const lineEmployees = useMemo(
    () => employees.filter((e) => e.lineId === settings.activeLineId),
    [employees, settings.activeLineId],
  );

  // ---- jump from Insights -------------------------------------------------
  // Scrolls the requested day into the middle of the view, focuses the cell if
  // a person was named, and flashes the whole column so the eye lands on it.
  const [flashDay, setFlashDay] = useState<number | null>(null);
  useEffect(() => {
    if (!jumpTo || jumpTo.dayIndex === undefined) return;
    const el = scrollRef.current;
    if (el) {
      const x = NAME_COL + jumpTo.dayIndex * CELL_W - (el.clientWidth - NAME_COL) / 2 + CELL_W / 2;
      el.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
      if (jumpTo.employeeId) {
        const rowIdx = lineEmployees.findIndex((e) => e.id === jumpTo.employeeId);
        if (rowIdx >= 0) {
          const y = 46 + rowIdx * CELL_H - el.clientHeight / 2;
          el.scrollTo({ top: Math.max(0, y), left: Math.max(0, x), behavior: 'smooth' });
        }
      }
    }
    if (jumpTo.employeeId) setFocus({ employeeId: jumpTo.employeeId, dayIndex: jumpTo.dayIndex });
    setFlashDay(jumpTo.dayIndex);
    const t = setTimeout(() => setFlashDay(null), 1600);
    return () => clearTimeout(t);
  }, [jumpTo, lineEmployees, NAME_COL, CELL_W, CELL_H]);

  /** Cell-level issue lookup, so a cell can paint its own warning ring. */
  const issueMap = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) {
      if (!issue.employeeId || issue.dayIndex === undefined) continue;
      const key = `${issue.employeeId}:${issue.dayIndex}`;
      // An error outranks a warning on the same cell.
      if (!map.has(key) || issue.severity === 'error') map.set(key, issue);
    }
    return map;
  }, [issues]);

  /** Day columns that are short-staffed, for the header + summary tint. */
  const shortDays = useMemo(() => {
    const map = new Map<number, 'error' | 'warning'>();
    for (const issue of issues) {
      if (issue.employeeId || issue.dayIndex === undefined) continue;
      if (issue.severity === 'error') map.set(issue.dayIndex, 'error');
      else if (!map.has(issue.dayIndex)) map.set(issue.dayIndex, 'warning');
    }
    return map;
  }, [issues]);

  // ---- painting ---------------------------------------------------------
  const endDrag = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    setDragPreview(null);
    if (!d || !brush) return;
    if (d.from === d.to) paintCell(d.employeeId, d.from, brush);
    else paintRange(d.employeeId, d.from, d.to, brush);
  }, [brush, paintCell, paintRange]);

  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [endDrag]);

  const onCellDown = (employeeId: string, dayIndex: number, e: React.MouseEvent) => {
    setFocus({ employeeId, dayIndex });
    if (brush) {
      drag.current = { employeeId, from: dayIndex, to: dayIndex };
      setDragPreview({ employeeId, from: dayIndex, to: dayIndex });
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPicker({ focus: { employeeId, dayIndex }, x: rect.left + rect.width / 2, y: rect.bottom + 6 });
    }
  };

  // On touch screens a tap fires emulated mouse events after touchend, which
  // already routes through onCellDown / the window mouseup. A finger dragged
  // across cells scrolls the grid instead of painting, which is the right
  // trade on a phone — painting a run there is done tap by tap.
  const onCellEnter = (employeeId: string, dayIndex: number) => {
    if (!drag.current || drag.current.employeeId !== employeeId) return;
    drag.current.to = dayIndex;
    setDragPreview({ ...drag.current });
  };

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    if (!focus || !roster) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const rowIds = lineEmployees.map((emp) => emp.id);
      const r = rowIds.indexOf(focus.employeeId);
      const lastDay = columns.length - 1;

      const move = (dr: number, dc: number) => {
        e.preventDefault();
        const nr = Math.max(0, Math.min(rowIds.length - 1, r + dr));
        const nc = Math.max(0, Math.min(lastDay, focus.dayIndex + dc));
        setFocus({ employeeId: rowIds[nr], dayIndex: nc });
      };

      switch (e.key) {
        case 'ArrowUp': return move(-1, 0);
        case 'ArrowDown': return move(1, 0);
        case 'ArrowLeft': return move(0, -1);
        case 'ArrowRight': return move(0, 1);
        case 'Escape': return setFocus(null);
      }

      // Typing a shift's first letter writes it straight into the focused cell —
      // the fastest path for someone rostering a whole row by hand.
      if (e.key === '-' || e.key === '0') {
        e.preventDefault();
        paintCell(focus.employeeId, focus.dayIndex, OFF);
        return;
      }

      const typed = e.key.toUpperCase();
      const match =
        codes.find((c) => c.id === typed) ??
        codes.find((c) => c.id[0] === typed && !c.isStatus);
      if (match) {
        e.preventDefault();
        paintCell(focus.employeeId, focus.dayIndex, match.id);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, roster, lineEmployees, columns.length, codes, paintCell]);

  if (!roster || roster.lineId !== settings.activeLineId) {
    return (
      <div className="flex-1 grid place-items-center text-ink-3 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-ping" />
          <span>Loading line roster…</span>
        </div>
      </div>
    );
  }

  const gridWidth = NAME_COL + columns.length * CELL_W + 2 * TOTAL_W;
  const standard = settings.standardHours ?? 9;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto">
        <div style={{ width: gridWidth, minWidth: '100%' }} className="relative">
          {/* ---------------------------------------------------- header */}
          <div
            className="sticky top-0 z-30 flex bg-[var(--canvas)]/95 backdrop-blur border-b border-[var(--line-strong)]"
            style={{ height: 46 }}
          >
            <div
              className="sticky left-0 z-10 flex items-end px-3 pb-1.5 bg-[var(--canvas)] border-r border-[var(--line-strong)]"
              style={{ width: NAME_COL, minWidth: NAME_COL }}
            >
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                {lineEmployees.length} people
              </span>
            </div>
            {columns.map((col) => {
              const short = shortDays.get(col.index);
              return (
                <div
                  key={col.day}
                  className={cx(
                    'flex flex-col items-center justify-end pb-1 border-r border-[var(--line)] relative',
                    col.isWeekend && 'bg-[var(--weekend-tint)]',
                  )}
                  style={{ width: CELL_W, minWidth: CELL_W }}
                >
                  <span
                    className={cx(
                      'text-[10px] uppercase tracking-wide',
                      col.isWeekend ? 'text-ink-3' : 'text-ink-3',
                    )}
                  >
                    {col.label}
                  </span>
                  <span
                    className={cx(
                      'font-mono text-[12.5px] leading-tight',
                      today === col.index ? 'text-[var(--accent)] font-bold' : 'text-ink-2',
                    )}
                  >
                    {col.day}
                  </span>
                  {short && (
                    <span
                      className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full"
                      style={{ background: short === 'error' ? 'var(--danger)' : 'var(--warn)' }}
                    />
                  )}
                  {today === col.index && (
                    <span className="absolute inset-x-0 top-0 h-[2px] bg-[var(--accent)]" />
                  )}
                  {flashDay === col.index && (
                    <motion.span
                      initial={{ opacity: 0.9 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: 1.5, ease: 'easeOut' }}
                      className="pointer-events-none absolute inset-0 bg-[var(--accent)]/30"
                    />
                  )}
                </div>
              );
            })}
            <TotalHeader
              label="Hrs"
              right={TOTAL_W}
              width={TOTAL_W}
              title="Hours worked this month: shift hours plus any extra hours"
            />
            <TotalHeader
              label="OT"
              right={0}
              width={TOTAL_W}
              title={`Overtime: hours past ${standard} a day, plus every hour of a shift worked on a rest day`}
            />
          </div>

          {/* ------------------------------------------------------- rows */}
          {lineEmployees.length === 0 && (
            <div className="py-20 flex flex-col items-center justify-center text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--line-strong)] flex items-center justify-center text-ink-3 mb-4 shadow-xs">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              </div>
              <h3 className="text-[16px] font-bold text-ink">Clean Slate (Scratch Workspace)</h3>
              <p className="text-[13px] text-ink-3 max-w-md mt-1.5 mb-5">
                No roster has been imported yet for this line. You have a fresh, isolated workspace ready for your own data.
              </p>
              {onOpenImport && (
                <button
                  type="button"
                  onClick={onOpenImport}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white font-bold text-[13px] hover:opacity-90 transition-opacity shadow-sm flex items-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>Import Excel Roster</span>
                </button>
              )}
            </div>
          )}
          {lineEmployees.map((employee, rowIndex) => {
            const row = roster.cells[employee.id] ?? [];
            const empHours = hours[employee.id];
            const extras = roster.extraHours?.[employee.id] ?? {};
            return (
              <div key={employee.id} className="flex border-b border-[var(--line)] group">
                <div
                  className="sticky left-0 z-20 flex items-center gap-2 px-3 bg-[var(--canvas)] group-hover:bg-[var(--surface)] border-r border-[var(--line-strong)] transition-colors"
                  style={{ width: NAME_COL, minWidth: NAME_COL, height: CELL_H }}
                >
                  <span
                    className="h-4 w-[3px] rounded-full shrink-0"
                    style={{ background: codeVars(codeById.get(employee.defaultShift)).accent }}
                  />
                  <span
                    className={cx('truncate font-medium', viewport === 'mobile' ? 'text-[11.5px]' : 'text-[12.5px]')}
                    style={{ fontSize: `${Math.max(10, Math.round(12.5 * zoom))}px` }}
                  >
                    {employee.name}
                  </span>
                  {isLeaderEmployee(employee) && (
                    <span className="shrink-0 text-[11px] leading-none" title="Team leader" aria-label="Team leader">👑</span>
                  )}
                  {showContact && (
                    <span
                      className="ml-auto font-mono text-[10.5px] text-ink-3 shrink-0"
                      style={{ fontSize: `${Math.max(8.5, Math.round(10.5 * zoom))}px` }}
                    >
                      {employee.contact}
                    </span>
                  )}
                </div>

                {columns.map((col) => {
                  const cell = row[col.index];
                  const code = cell?.code ?? OFF;
                  const def = codeById.get(code);
                  const isOff = code === OFF;
                  const tone = codeVars(def);
                  const issue = issueMap.get(`${employee.id}:${col.index}`);
                  const focused = focus?.employeeId === employee.id && focus.dayIndex === col.index;
                  // Hours left on a cell that later became off or leave don't count.
                  const extra = isOff || def?.isStatus ? 0 : extras[col.index] ?? 0;
                  const dayHours = empHours?.days[col.index];
                  const inDrag =
                    dragPreview?.employeeId === employee.id &&
                    col.index >= Math.min(dragPreview.from, dragPreview.to) &&
                    col.index <= Math.max(dragPreview.from, dragPreview.to);

                  return (
                    <motion.button
                      key={col.day}
                      // Re-keying on generate replays the stagger, which is what
                      // makes the automation visible rather than instantaneous.
                      initial={{ opacity: 0, scale: 0.86 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.16,
                        delay: Math.min(0.4, (rowIndex * 3 + col.index) * 0.0016),
                      }}
                      onMouseDown={(e) => onCellDown(employee.id, col.index, e)}
                      onMouseEnter={() => onCellEnter(employee.id, col.index)}
                      className={cx(
                        'relative flex items-center justify-center border-r border-[var(--line)]',
                        'font-mono font-bold tracking-tight transition-[filter,background] duration-100',
                        'hover:brightness-125 cursor-pointer',
                        def?.isStatus && 'hatch',
                        col.isWeekend && isOff && 'bg-[var(--weekend-tint)]',
                      )}
                      style={{
                        width: CELL_W,
                        minWidth: CELL_W,
                        height: CELL_H,
                        fontSize: `${Math.max(9, Math.round(11.5 * zoom))}px`,
                        background: def?.isStatus ? undefined : tone.bg,
                        color: tone.fg,
                      }}
                      title={[
                        issue
                          ? issue.message
                          : `${employee.name} · ${col.label} ${col.day} · ${def?.label ?? 'Off'}`,
                        dayHours && dayHours.worked > 0
                          ? `${formatHours(dayHours.worked)}h worked${extra ? ` (incl. +${formatHours(extra)}h extra)` : ''}`
                          : null,
                        dayHours && dayHours.overtime > 0
                          ? `OT ${formatHours(dayHours.overtime)}h${dayHours.extraDuty ? ' — extra duty on a rest day' : ''}`
                          : null,
                      ].filter(Boolean).join(' · ')}
                    >
                      {isOff ? <span className="opacity-45">·</span> : code}

                      {/* extra hours entered on top of the shift */}
                      {extra > 0 && (
                        <span
                          className="pointer-events-none absolute left-[2px] top-[1px] font-mono font-bold leading-none"
                          style={{ fontSize: `${Math.max(7, Math.round(8 * zoom))}px`, color: 'var(--warn)' }}
                        >
                          +{formatHours(extra)}
                        </span>
                      )}

                      {/* any overtime on this day gets an underline */}
                      {dayHours && dayHours.overtime > 0 && (
                        <span
                          className="pointer-events-none absolute inset-x-[3px] bottom-[2px] h-[2px] rounded-full"
                          style={{ background: 'var(--warn)' }}
                        />
                      )}

                      {/* a hand edit gets a corner tick so he can see what he changed */}
                      {cell?.source === 'manual' && (
                        <span className="absolute right-[2px] top-[2px] h-1 w-1 rounded-full bg-[var(--accent)]" />
                      )}

                      {issue && (
                        <span
                          className="pointer-events-none absolute inset-0 border"
                          style={{
                            borderColor: issue.severity === 'error' ? 'var(--danger)' : 'var(--warn)',
                          }}
                        />
                      )}

                      {(focused || inDrag) && (
                        <span
                          className="pointer-events-none absolute inset-0 border-2"
                          style={{ borderColor: 'var(--accent)' }}
                        />
                      )}
                      {flashDay === col.index && (
                        <motion.span
                          initial={{ opacity: 0.55 }}
                          animate={{ opacity: 0 }}
                          transition={{ duration: 1.5, ease: 'easeOut' }}
                          className="pointer-events-none absolute inset-0 bg-[var(--accent)]"
                        />
                      )}
                    </motion.button>
                  );
                })}

                <TotalCell right={TOTAL_W} width={TOTAL_W} height={CELL_H} zoom={zoom}>
                  {empHours ? formatHours(empHours.worked) : '·'}
                </TotalCell>
                <TotalCell
                  right={0}
                  width={TOTAL_W}
                  height={CELL_H}
                  zoom={zoom}
                  highlight={!!empHours && empHours.overtime > 0}
                  title={
                    empHours && empHours.overtime > 0
                      ? `${formatHours(empHours.overtime)}h overtime` +
                        (empHours.extraDutyDays ? ` · ${empHours.extraDutyDays} extra-duty day(s)` : '') +
                        (empHours.extra ? ` · ${formatHours(empHours.extra)}h extra entered` : '')
                      : 'No overtime this month'
                  }
                >
                  {empHours ? formatHours(empHours.overtime) : '·'}
                </TotalCell>
              </div>
            );
          })}

        </div>
      </div>

      {/* The headcount rail sits *below* the scroll area rather than sticky
          inside it, moved downward with spacing so it never crowds rows. */}
      <SummaryRail
        codes={codes.filter(
          (c) =>
            !c.isStatus &&
            (c.minHeadcount > 0 || days.some((d) => (d.total[c.id] ?? 0) > 0)),
        )}
        days={days}
        columns={columns}
        nameWidth={NAME_COL}
        cellWidth={CELL_W}
        gridWidth={gridWidth}
        totalsWidth={2 * TOTAL_W}
        revealKey={revealKey}
        scrollLeft={scrollLeft}
        issues={issues}
        zoom={zoom}
      />

      {picker && (
        <CellPicker
          x={picker.x}
          y={picker.y}
          current={roster.cells[picker.focus.employeeId]?.[picker.focus.dayIndex]?.code ?? OFF}
          extra={roster.extraHours?.[picker.focus.employeeId]?.[picker.focus.dayIndex] ?? 0}
          dayInfo={hours[picker.focus.employeeId]?.days[picker.focus.dayIndex]}
          onPick={(code) => {
            paintCell(picker.focus.employeeId, picker.focus.dayIndex, code);
            setPicker(null);
          }}
          onExtra={(value) => setExtraHours(picker.focus.employeeId, picker.focus.dayIndex, value)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** Header for a month-total column pinned to the grid's right edge. */
function TotalHeader({ label, right, width, title }: { label: string; right: number; width: number; title: string }) {
  return (
    <div
      className="sticky z-10 flex items-end justify-center pb-1.5 bg-[var(--canvas)] border-l border-[var(--line-strong)]"
      style={{ right, width, minWidth: width }}
      title={title}
    >
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-2">{label}</span>
    </div>
  );
}

function TotalCell({
  right, width, height, zoom, highlight, title, children,
}: {
  right: number;
  width: number;
  height: number;
  zoom: number;
  highlight?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="sticky z-10 flex items-center justify-center font-mono bg-[var(--canvas)] group-hover:bg-[var(--surface)] border-l border-[var(--line-strong)] transition-colors"
      style={{
        right,
        width,
        minWidth: width,
        height,
        fontSize: `${Math.max(9, Math.round(11.5 * zoom))}px`,
        color: highlight ? 'var(--warn)' : 'var(--ink-2)',
        fontWeight: highlight ? 700 : 500,
      }}
      title={title}
    >
      {children}
    </div>
  );
}

const RAIL_KEY = 'shiftline.rail-open';

/**
 * The headcount rows at the foot of the grid.
 *
 * Collapsible: the bottom-left button opens and closes it like a shutter. When
 * closed, a one-line strip keeps the per-shift range and the error count in
 * view so the grid can take the full height without losing the signal.
 */
function SummaryRail({
  codes,
  days,
  columns,
  nameWidth,
  cellWidth,
  gridWidth,
  totalsWidth,
  revealKey,
  scrollLeft,
  issues,
  zoom = 1,
}: {
  codes: ShiftCode[];
  days: ReturnType<typeof import('@/domain/summary').summarise>;
  columns: ReturnType<typeof import('@/domain/calendar').buildColumns>;
  nameWidth: number;
  cellWidth: number;
  gridWidth: number;
  /** The grid's pinned Hrs + OT columns, mirrored here so days line up. */
  totalsWidth: number;
  revealKey: number;
  scrollLeft: number;
  issues: Issue[];
  zoom?: number;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== 'closed';
    } catch {
      return true;
    }
  });

  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(RAIL_KEY, v ? 'closed' : 'open');
      } catch {
        /* per-viewer convenience only */
      }
      return !v;
    });
  };

  const shortDays = issues.filter((i) => !i.employeeId && i.severity === 'error').length;
  const rowHeight = Math.max(22, Math.round(26 * zoom));
  const fontSz = Math.max(9, Math.round(11 * zoom));

  return (
    <div className="shrink-0 mt-3 border-t-2 border-[var(--line-strong)] bg-[var(--surface)] shadow-sm">
      {/* ---------------------------------------------------- toggle strip */}
      <div className="flex items-center h-8 border-b border-[var(--line)]">
        <button
          onClick={toggle}
          aria-expanded={open}
          className="flex h-full items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-2 hover:text-ink hover:bg-[var(--surface-2)] transition-colors border-r border-[var(--line-strong)]"
          style={{ width: nameWidth, minWidth: nameWidth }}
          title={open ? 'Collapse headcount rows' : 'Expand headcount rows'}
        >
          <span className="grid h-5 w-5 place-items-center rounded-md bg-[var(--surface-3)] text-ink-2">
            <BarsIcon />
          </span>
          Headcount
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="text-ink-3"
          >
            <ChevronDownIcon />
          </motion.span>
          <span className="text-[10px] lowercase text-ink-3 font-normal">
            ({open ? 'collapse' : 'expand'})
          </span>
          {shortDays > 0 && (
            <span className="ml-auto rounded-full bg-[var(--sh-leave-bg)] px-1.5 font-mono text-[10px] normal-case tracking-normal text-[var(--danger)]">
              {shortDays}
            </span>
          )}
        </button>

        {/* When shut, show each shift's range for the month so nothing is lost. */}
        {!open && (
          <div className="flex items-center gap-4 px-3 overflow-x-auto">
            {codes.map((code) => {
              const tone = codeVars(code);
              const counts = days.map((d) => d.total[code.id] ?? 0);
              const lo = Math.min(...counts);
              const hi = Math.max(...counts);
              const short = code.minHeadcount > 0 && lo < code.minHeadcount;
              return (
                <span key={code.id} className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
                  <span className="text-ink-3">{code.label}</span>
                  <span
                    className="font-mono"
                    style={{ color: short ? 'var(--danger)' : 'var(--ink-2)', fontWeight: short ? 700 : 500 }}
                  >
                    {lo}–{hi}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- the shutter */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.8 }}
            className="overflow-hidden"
          >
            <div className="relative overflow-hidden">
              {/* Covers the days that sit under the grid's pinned Hrs / OT columns. */}
              <div
                className="absolute inset-y-0 right-0 z-20 bg-[var(--surface)] border-l border-[var(--line-strong)]"
                style={{ width: totalsWidth }}
                aria-hidden
              />
              <div style={{ width: gridWidth, transform: `translateX(-${scrollLeft}px)` }}>
                {codes.map((code) => {
                  const tone = codeVars(code);
                  return (
                    <div key={code.id} className="flex border-b border-[var(--line)] last:border-b-0">
                      <div
                        className="sticky left-0 z-10 flex items-center gap-2 px-3 bg-[var(--surface)] border-r border-[var(--line-strong)]"
                        style={{ width: nameWidth, minWidth: nameWidth, height: rowHeight, transform: `translateX(${scrollLeft}px)` }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
                        <span className="text-[11px] font-medium text-ink-2 truncate" style={{ fontSize: `${fontSz}px` }}>{code.label}</span>
                        {code.minHeadcount > 0 && (
                          <span className="ml-auto font-mono text-[10px] text-ink-3">min {code.minHeadcount}</span>
                        )}
                      </div>
                      {columns.map((col) => {
                        const n = days[col.index]?.total[code.id] ?? 0;
                        const short = code.minHeadcount > 0 && n < code.minHeadcount;
                        return (
                          <div
                            key={`${revealKey}-${col.day}`}
                            className={cx(
                              'flex items-center justify-center border-r border-[var(--line)] font-mono',
                              col.isWeekend && 'bg-[var(--weekend-tint)]',
                            )}
                            style={{
                              width: cellWidth,
                              minWidth: cellWidth,
                              height: rowHeight,
                              fontSize: `${fontSz}px`,
                              background: short ? 'var(--sh-leave-bg)' : undefined,
                              color: short ? 'var(--danger)' : n === 0 ? 'var(--ink-3)' : 'var(--ink-2)',
                              fontWeight: short ? 700 : 500,
                            }}
                            title={short ? `${code.label}: ${n} of ${code.minHeadcount} required` : undefined}
                          >
                            {n || '·'}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BarsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3" y="12" width="4" height="9" rx="1" />
      <rect x="10" y="6" width="4" height="15" rx="1" />
      <rect x="17" y="9" width="4" height="12" rx="1" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
