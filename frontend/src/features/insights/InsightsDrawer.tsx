import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';

import { useStore } from '@/app/store';
import { useViewport } from '@/app/useViewport';
import { codeVars } from '@/app/tones';
import { Button, Segmented, cx } from '@/components/ui';
import { formatHours } from '@/domain/hours';
import { monthTotals } from '@/domain/summary';
import { OFF, type Issue } from '@/domain/types';
import { suggestCover } from '@/domain/validate';


type Tab = 'issues' | 'coverage' | 'hours' | 'fairness';

export function InsightsDrawer({
  open,
  onClose,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  onJump: (employeeId: string | undefined, dayIndex: number | undefined) => void;
}) {
  const [tab, setTab] = useState<Tab>('issues');
  const { issues } = useStore();
  const viewport = useViewport();
  const overlay = viewport !== 'desktop';

  const errors = issues.filter((i) => i.severity === 'error').length;

  const panel = (
    <div className={overlay ? 'w-full h-full flex flex-col' : 'w-[336px] h-full flex flex-col'}>
            <header className="flex items-center gap-2 px-4 h-14 border-b border-[var(--line)]">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold">Insights</h2>
                  {errors > 0 ? (
                    <span className="rounded-full bg-[var(--sh-leave-bg)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--danger)]">
                      {errors} error{errors > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="rounded-full bg-[var(--sh-gs-bg)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--ok)]">
                      All rules met
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-ink-3">Staffing checks, coverage, hours & overtime</span>
              </div>
              <Button size="sm" onClick={onClose} className="ml-auto px-2">✕</Button>
            </header>

            <div className="px-4 py-3 border-b border-[var(--line)]">
              <Segmented<Tab>
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'issues', label: 'Issues' },
                  { value: 'coverage', label: 'Coverage' },
                  { value: 'hours', label: 'Hours' },
                  { value: 'fairness', label: 'Fairness' },
                ]}
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === 'issues' && <IssuesTab onJump={onJump} />}
              {tab === 'coverage' && <CoverageTab onJump={onJump} />}
              {tab === 'hours' && <HoursTab onJump={onJump} />}
              {tab === 'fairness' && <FairnessTab />}
            </div>
    </div>
  );

  // Small screens: slide over the grid with a scrim instead of pushing it.
  if (overlay) {
    return (
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="no-print fixed inset-0 z-40 bg-black/50"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="no-print fixed inset-y-0 right-0 z-50 w-full max-w-[400px] border-l border-[var(--line)] bg-[var(--surface)] shadow-pop"
              style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
            >
              {panel}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 336, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className="no-print shrink-0 overflow-hidden border-l border-[var(--line)] bg-[var(--surface)]"
        >
          {panel}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ Issues */

function IssuesTab({ onJump }: { onJump: (e: string | undefined, d: number | undefined) => void }) {
  const { issues, roster, employees, codes, leave, paintCell, workOrders } = useStore();
  const woNumber = (id: string) => workOrders.find((w) => w.id === id)?.workOrderId ?? id;
  const [expanded, setExpanded] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    return { errors, warnings };
  }, [issues]);

  if (issues.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--sh-gs-bg)] text-[var(--ok)]">
          ✓
        </div>
        <p className="text-[13px] font-medium">No problems found</p>
        <p className="mt-1 text-[12px] text-ink-3 leading-relaxed">
          Every shift meets its minimum, rest days are honoured and nobody is double-booked.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <p className="px-4 py-2.5 text-[11.5px] leading-snug text-ink-3 border-b border-[var(--line)]">
        Checked on every edit. Click an item to jump to that day on the grid.
      </p>
      {(['errors', 'warnings'] as const).map((key) => {
        const list = grouped[key];
        if (list.length === 0) return null;
        return (
          <section key={key}>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-[var(--surface)] px-4 py-2 border-b border-[var(--line)]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: key === 'errors' ? 'var(--danger)' : 'var(--warn)' }}
              />
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                {key === 'errors' ? 'Must fix' : 'Worth a look'} · {list.length}
              </span>
            </div>

            {list.map((issue) => {
              const canSuggest =
                issue.rule === 'below-minimum' || issue.rule === 'empty-shift' ||
                (issue.rule === 'work-order-short' && issue.dayIndex !== undefined);
              const isWo = issue.rule === 'work-order-short' || issue.rule === 'work-order-data';
              const isOpen = expanded === issue.id;
              const suggestions =
                canSuggest && isOpen && roster && issue.dayIndex !== undefined && issue.shiftCode
                  ? suggestCover(roster, employees, codes, issue.dayIndex, issue.shiftCode, leave)
                  : [];

              return (
                <div key={issue.id} className="border-b border-[var(--line)]">
                  <button
                    onClick={() => {
                      onJump(issue.employeeId, issue.dayIndex);
                      setExpanded(isOpen ? null : issue.id);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors"
                  >
                    {isWo && (
                      <span className="mb-1 inline-flex items-center gap-1 rounded bg-[var(--sh-leave-bg)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--danger)]">
                        {issue.rule === 'work-order-data' ? 'Work Orders · data' : 'Work Orders'}
                      </span>
                    )}
                    <p className="text-[12.5px] leading-snug">{issue.message}</p>
                    {isWo && issue.workOrderIds && issue.workOrderIds.length > 0 && (
                      <p className="mt-0.5 font-mono text-[11px] text-ink-3 truncate">
                        WO {issue.workOrderIds.slice(0, 8).map(woNumber).join(', ')}
                        {issue.workOrderIds.length > 8 ? ` +${issue.workOrderIds.length - 8} more` : ''}
                      </p>
                    )}
                    {canSuggest && (
                      <span className="mt-1 inline-block text-[11px] text-[var(--accent)]">
                        {isOpen ? 'Hide suggestions' : 'Show who can cover →'}
                      </span>
                    )}
                  </button>

                  {isOpen && suggestions.length > 0 && (
                    <div className="px-4 pb-3 flex flex-col gap-1">
                      <p className="text-[11px] text-ink-3 mb-0.5">
                        {isWo
                          ? `Off that day, not on leave — assigning one adds them to ${issue.shiftCode} and the work orders update:`
                          : 'Off that day, not on leave, lightest month first:'}
                      </p>
                      {suggestions.map((emp) => (
                        <button
                          key={emp.id}
                          onClick={() => {
                            if (issue.dayIndex === undefined || !issue.shiftCode) return;
                            paintCell(emp.id, issue.dayIndex, issue.shiftCode);
                            setExpanded(null);
                          }}
                          className="flex items-center justify-between rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--surface-3)] transition-colors"
                        >
                          <span className="truncate">{emp.name}</span>
                          <span className="text-[11px] text-[var(--accent)] shrink-0 ml-2">
                            Assign {issue.shiftCode}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {isOpen && canSuggest && suggestions.length === 0 && (
                    <p className="px-4 pb-3 text-[11.5px] text-ink-3">
                      Nobody is free that day — this needs a leave change or extra headcount.
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Coverage */

function CoverageTab({ onJump }: { onJump?: (e: string | undefined, d: number | undefined) => void }) {
  const { days, codes, columns, roster, employees } = useStore();
  const totals = useMemo(() => monthTotals(days), [days]);
  // Chart only shifts that matter this month: in use, or with a minimum to police.
  const worked = codes.filter(
    (c) => !c.isStatus && (c.minHeadcount > 0 || days.some((d) => (d.total[c.id] ?? 0) > 0)),
  );
  const [search, setSearch] = useState('');

  const employeeStats = useMemo(() => {
    if (!roster) return [];
    const codeById = new Map(codes.map((c) => [c.id, c]));

    return employees.map((emp) => {
      const cells = roster.cells[emp.id] ?? [];
      let morning = 0;
      let evening = 0;
      let night = 0;
      let other = 0;
      let off = 0;
      let leaveCount = 0;
      let totalWorked = 0;

      for (let i = 0; i < columns.length; i++) {
        const cell = cells[i];
        const codeId = cell?.code ?? OFF;
        if (codeId === OFF) {
          off++;
          continue;
        }
        const def = codeById.get(codeId);
        if (def?.isStatus) {
          leaveCount++;
        } else {
          totalWorked++;
          if (def?.tone === 'morning') morning++;
          else if (def?.tone === 'evening') evening++;
          else if (def?.tone === 'night') night++;
          else other++;
        }
      }

      return {
        employee: emp,
        morning,
        evening,
        night,
        other,
        off,
        leave: leaveCount,
        totalWorked,
      };
    });
  }, [employees, roster, codes, columns.length]);

  const filteredStats = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employeeStats;
    return employeeStats.filter(
      (s) =>
        s.employee.name.toLowerCase().includes(q) ||
        s.employee.contact.toLowerCase().includes(q),
    );
  }, [employeeStats, search]);

  return (
    <div className="p-4 flex flex-col gap-4">
      <p className="text-[11.5px] leading-snug text-ink-3">
        People on each shift, day by day. A red bar is a day below that shift's minimum.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Shift days" value={Object.values(totals.shiftDays).reduce((a, b) => a + b, 0)} />
        <MiniStat label="Rest days" value={totals.offDays} />
        <MiniStat label="On leave" value={totals.leaveDays} />
        <MiniStat label="Days in month" value={columns.length} />
      </div>

      {worked.map((code) => {
        const tone = codeVars(code);
        const counts = days.map((d) => d.total[code.id] ?? 0);
        const peak = Math.max(1, ...counts);
        const min = Math.min(...counts);
        const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);

        return (
          <div key={code.id}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
              <span className="text-[12px] font-medium">{code.label}</span>
              <span className="ml-auto font-mono text-[11px] text-ink-3">
                avg {avg.toFixed(1)} · low {min}
              </span>
            </div>
            <div className="flex items-end gap-[2px] h-11 rounded-lg bg-[var(--surface-2)] px-1.5 py-1">
              {counts.map((n, i) => {
                const short = code.minHeadcount > 0 && n < code.minHeadcount;
                return (
                  <span
                    key={i}
                    title={`Day ${i + 1}: ${n}`}
                    className="flex-1 rounded-[1px] min-h-[2px]"
                    style={{
                      height: `${(n / peak) * 100}%`,
                      background: short ? 'var(--danger)' : tone.accent,
                      opacity: short ? 1 : 0.7,
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ----------------- Employee Breakdown (Client requested Nos. per employee) */}
      <div className="mt-2 pt-3 border-t border-[var(--line)] flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[12.5px] font-semibold text-ink">Employee Breakdown</h3>
            <p className="text-[10.5px] text-ink-3">Total shift counts (Nos.) per person this month</p>
          </div>
          <span className="text-[10.5px] font-mono text-ink-3 bg-[var(--surface-2)] px-1.5 py-0.5 rounded">
            {filteredStats.length} people
          </span>
        </div>

        <input
          type="text"
          placeholder="Filter employee name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 px-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[11.5px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-[var(--accent)]"
        />

        <div className="flex flex-col gap-1.5 max-h-[360px] overflow-y-auto pr-0.5">
          {filteredStats.map(({ employee, morning, evening, night, other, off, leave, totalWorked }) => (
            <div
              key={employee.id}
              onClick={() => onJump?.(employee.id, 0)}
              className="group flex flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 hover:border-[var(--accent)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer"
              title={`Click to jump to ${employee.name}'s row`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12px] font-medium text-ink truncate group-hover:text-[var(--accent)] transition-colors">
                  {employee.name}
                </span>
                <span className="font-mono text-[10.5px] font-bold text-ink-2 bg-[var(--surface)] px-1.5 py-0.5 rounded shrink-0">
                  {totalWorked} worked
                </span>
              </div>

              <div className="grid grid-cols-6 gap-1 text-center font-mono text-[10px]">
                <div className="rounded bg-[var(--sh-m-bg)] py-0.5 text-[var(--sh-m-ink)]" title="Morning shifts">
                  <div className="text-[9px] uppercase font-sans text-ink-3">M</div>
                  <div className="font-bold">{morning}</div>
                </div>
                <div className="rounded bg-[var(--sh-e-bg)] py-0.5 text-[var(--sh-e-ink)]" title="Evening shifts">
                  <div className="text-[9px] uppercase font-sans text-ink-3">E</div>
                  <div className="font-bold">{evening}</div>
                </div>
                <div className="rounded bg-[var(--sh-n-bg)] py-0.5 text-[var(--sh-n-ink)]" title="Night shifts">
                  <div className="text-[9px] uppercase font-sans text-ink-3">N</div>
                  <div className="font-bold">{night}</div>
                </div>
                <div className="rounded bg-[var(--sh-gs-bg)] py-0.5 text-[var(--sh-gs-ink)]" title="General / Other worked shifts">
                  <div className="text-[9px] uppercase font-sans text-ink-3">Oth</div>
                  <div className="font-bold">{other}</div>
                </div>
                <div className="rounded bg-[var(--sh-leave-bg)] py-0.5 text-[var(--danger)]" title="Leave days">
                  <div className="text-[9px] uppercase font-sans text-ink-3">LV</div>
                  <div className="font-bold">{leave}</div>
                </div>
                <div className="rounded bg-[var(--surface)] py-0.5 text-ink-2" title="Rest / Days Off">
                  <div className="text-[9px] uppercase font-sans text-ink-3">Off</div>
                  <div className="font-bold">{off}</div>
                </div>
              </div>
            </div>
          ))}
          {filteredStats.length === 0 && (
            <p className="text-[11.5px] text-ink-3 py-3 text-center">No employee matches "{search}".</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Hours */

type HoursSort = 'overtime' | 'worked' | 'name';

function HoursTab({ onJump }: { onJump: (e: string | undefined, d: number | undefined) => void }) {
  const { employees, hours, settings } = useStore();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<HoursSort>('overtime');
  const standard = settings.standardHours ?? 9;

  const rows = useMemo(() => {
    const list = employees
      .map((employee) => ({ employee, h: hours[employee.id] }))
      .filter((r): r is { employee: typeof r.employee; h: NonNullable<typeof r.h> } => !!r.h);
    const q = search.trim().toLowerCase();
    const filtered = q ? list.filter((r) => r.employee.name.toLowerCase().includes(q)) : list;
    return filtered.sort((a, b) =>
      sort === 'name'
        ? a.employee.name.localeCompare(b.employee.name)
        : sort === 'worked'
          ? b.h.worked - a.h.worked
          : b.h.overtime - a.h.overtime || b.h.worked - a.h.worked,
    );
  }, [employees, hours, search, sort]);

  const totals = useMemo(() => {
    let worked = 0;
    let overtime = 0;
    let people = 0;
    for (const h of Object.values(hours)) {
      worked += h.worked;
      overtime += h.overtime;
      if (h.overtime > 0) people++;
    }
    return { worked, overtime, people };
  }, [hours]);

  /** First day with overtime, so clicking a person lands on it. */
  const firstOtDay = (days: { overtime: number }[]) => {
    const i = days.findIndex((d) => d.overtime > 0);
    return i >= 0 ? i : 0;
  };

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11.5px] leading-snug text-ink-3">
        Standard day is <span className="font-mono text-ink-2">{formatHours(standard)}h</span>. Overtime (OT) is every
        hour past that on a working day, plus every hour of a shift worked on a rest day. To add extra hours,
        click a cell on the grid and use <span className="text-ink-2">Extra hours</span>.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Hours worked" value={formatHours(totals.worked)} />
        <MiniStat label="Overtime hours" value={formatHours(totals.overtime)} accent={totals.overtime > 0} />
      </div>
      <p className="text-[11px] text-ink-3 -mt-1">
        {totals.people === 0
          ? 'Nobody has overtime this month.'
          : `${totals.people} of ${employees.length} people have overtime this month.`}
      </p>

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter employee name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 flex-1 min-w-0 px-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[11.5px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-[var(--accent)]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as HoursSort)}
          aria-label="Sort by"
          className="h-7 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-1.5 text-[11.5px] text-ink focus:outline-none"
        >
          <option value="overtime">Most OT</option>
          <option value="worked">Most hours</option>
          <option value="name">Name</option>
        </select>
      </div>

      <div className="rounded-lg border border-[var(--line)] overflow-hidden">
        <div className="grid grid-cols-[1fr_44px_44px_44px_40px] gap-1 bg-[var(--surface-2)] px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3">
          <span>Employee</span>
          <span className="text-right" title="Days worked">Days</span>
          <span className="text-right" title="Total hours worked">Hrs</span>
          <span className="text-right" title="Extra hours entered by hand">Extra</span>
          <span className="text-right" title="Overtime hours">OT</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--line)]">
          {rows.map(({ employee, h }) => (
            <button
              key={employee.id}
              onClick={() => onJump(employee.id, firstOtDay(h.days))}
              title={
                h.extraDutyDays
                  ? `${h.extraDutyDays} shift(s) worked on a rest day — counted fully as OT`
                  : `Jump to ${employee.name}'s row`
              }
              className="grid w-full grid-cols-[1fr_44px_44px_44px_40px] gap-1 items-center px-2.5 py-1.5 text-left font-mono text-[11.5px] hover:bg-[var(--surface-2)] transition-colors"
            >
              <span className="truncate font-sans text-[12px] text-ink">
                {employee.name}
                {h.extraDutyDays > 0 && (
                  <span className="ml-1.5 rounded bg-[var(--surface-3)] px-1 font-mono text-[9.5px] text-[var(--warn)]">
                    +{h.extraDutyDays} duty
                  </span>
                )}
              </span>
              <span className="text-right text-ink-3">{h.daysWorked}</span>
              <span className="text-right text-ink-2">{formatHours(h.worked)}</span>
              <span className="text-right text-ink-3">{h.extra ? formatHours(h.extra) : '–'}</span>
              <span
                className="text-right"
                style={{ color: h.overtime > 0 ? 'var(--warn)' : 'var(--ink-3)', fontWeight: h.overtime > 0 ? 700 : 400 }}
              >
                {formatHours(h.overtime)}
              </span>
            </button>
          ))}
          {rows.length === 0 && (
            <p className="text-[11.5px] text-ink-3 py-3 text-center">No employee matches "{search}".</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Fairness */

function FairnessTab() {
  const { fairnessRows, codes } = useStore();
  const { rows, spread } = fairnessRows;
  const peak = Math.max(1, ...rows.map((r) => r.nights));
  const nightTone = codeVars(codes.find((c) => c.tone === 'night') ?? { tone: 'night' });

  return (
    <div className="p-4 flex flex-col gap-4">
      <p className="text-[11.5px] leading-snug text-ink-3">
        Night shifts worked per person across the months in the tool. Auto-rotate uses this to decide who moves off nights next.
      </p>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
          Night-shift spread
        </div>
        <div
          className="mt-1 font-mono text-[22px] leading-none"
          style={{ color: spread > 10 ? 'var(--warn)' : 'var(--ok)' }}
        >
          {spread}
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-3 leading-snug">
          {spread === 0
            ? 'Night duty is split evenly across the rotating pool.'
            : `The gap between the most and least nights worked is ${spread} shifts. Auto-rotate will narrow it.`}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.employee.id} className="flex items-center gap-2.5">
            <span className="w-[108px] shrink-0 truncate text-[12px]">{row.employee.name}</span>
            <div className="flex-1 h-[7px] rounded-full bg-[var(--surface-3)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${(row.nights / peak) * 100}%`, background: nightTone.accent }}
              />
            </div>
            <span className="w-6 shrink-0 text-right font-mono text-[11px] text-ink-3">
              {row.nights}
            </span>
          </div>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="text-[12px] text-ink-3">
          No history yet — generate a month or two and the balance will appear here.
        </p>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={cx('rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2')}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-0.5 font-mono text-[17px] leading-none" style={{ color: accent ? 'var(--warn)' : 'var(--ink)' }}>{value}</div>
    </div>
  );
}

export type { Issue };
