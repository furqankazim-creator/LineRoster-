import { useMemo, useState } from 'react';
import { useStore } from '@/app/store';
import { Button, Segmented, Select, cx } from '@/components/ui';
import { normalizeWorkType } from '@/domain/workload';
import {
  POOL_LINES,
  SHIFT_FAMILIES,
  SHIFT_LABEL,
  poolOf,
  poolOfLineId,
  type ShiftFamily,
  type StaffPool,
} from '@/domain/workloadLive';

interface Props {
  onOpenPlanner: () => void;
  onOpenWorkOrders: () => void;
}

type PoolFilter = 'all' | 'L46' | 'L5';
type Horizon = 'today' | '7days' | 'month';
type ChartView = 'orders' | 'crew';
type ChartMode = 'type' | 'shift' | 'status' | 'line';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const POOL_TITLE: Record<StaffPool, string> = { L4_L6: 'Line 4 & 6 Combined Pool', L5: 'Line 5 Pool' };
const SHIFT_TIMING: Record<ShiftFamily, string> = { M: '06:00–15:00', E: '14:00–23:00', N: '22:00–07:00' };
const SHIFT_COLOR: Record<ShiftFamily, string> = { M: 'var(--sh-m)', E: 'var(--sh-e)', N: 'var(--sh-n)' };

const DONE_STATUSES = new Set(['COMPLETED', 'CLOSE', 'CLOSED', 'DONE']);

interface Cell {
  onDuty: number;
  demand: number;
  pm: number;
  cm: number;
  acs: number;
  orders: number;
}
const EMPTY_CELL: Cell = { onDuty: 0, demand: 0, pm: 0, cm: 0, acs: 0, orders: 0 };

export function DashboardPage({ onOpenPlanner, onOpenWorkOrders }: Props) {
  const { workOrders, workOrdersReady, allEmployees, settings, workload, staffForShift, codesByLine } = useStore();
  const { activeYear: year, activeMonth: month } = settings;
  const nDays = new Date(year, month, 0).getDate();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const isoOf = (d: number) => `${monthPrefix}${String(d).padStart(2, '0')}`;

  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all');
  const [horizon, setHorizon] = useState<Horizon>('7days');
  const [chartView, setChartView] = useState<ChartView>('orders');
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('type');
  const [activeSlice, setActiveSlice] = useState<number | null>(null);

  const pools = useMemo<StaffPool[]>(
    () => (poolFilter === 'all' ? ['L4_L6', 'L5'] : poolFilter === 'L46' ? ['L4_L6'] : ['L5']),
    [poolFilter],
  );

  const woMap = useMemo(() => new Map(workOrders.map((w) => [w.id, w])), [workOrders]);

  // Work orders placed in the open month, for the chosen pools
  const monthAllocs = useMemo(
    () =>
      Object.values(workload.byWo).filter(
        (a) => a.status !== 'UNPLACED' && a.date.startsWith(monthPrefix) && pools.includes(poolOf(a.lineCode)),
      ),
    [workload.byWo, monthPrefix, pools],
  );

  const unplaced = useMemo(
    () => Object.values(workload.byWo).filter((a) => a.status === 'UNPLACED').length,
    [workload.byWo],
  );

  // Planning date: today when it falls in the open month, else the first day that has work
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const defaultDay = useMemo(() => {
    const now = new Date();
    if (now.getFullYear() === year && now.getMonth() + 1 === month) return now.getDate();
    const first = Object.values(workload.byWo)
      .filter((a) => a.status !== 'UNPLACED' && a.date.startsWith(monthPrefix))
      .map((a) => a.day)
      .sort((a, b) => a - b)[0];
    return first ?? 1;
  }, [year, month, monthPrefix, workload.byWo]);
  const selectedDay = Math.min(nDays, Math.max(1, pickedDay ?? defaultDay));
  const setSelectedDay = (d: number | ((p: number) => number)) =>
    setPickedDay(typeof d === 'function' ? d(selectedDay) : d);

  // --------------------------------------------------------------------------
  // Roster × work order grid: [day][pool][shift] → on duty, crew demand, orders
  // --------------------------------------------------------------------------
  const grid = useMemo(() => {
    const balanceByKey = new Map(workload.balances.map((b) => [`${b.pool}|${b.date}|${b.shift}`, b]));
    const days: Record<StaffPool, Record<ShiftFamily, Cell>>[] = [];
    for (let d = 1; d <= nDays; d++) {
      const iso = isoOf(d);
      const day = {} as Record<StaffPool, Record<ShiftFamily, Cell>>;
      for (const pool of ['L4_L6', 'L5'] as StaffPool[]) {
        const row = {} as Record<ShiftFamily, Cell>;
        for (const shift of SHIFT_FAMILIES) {
          const onDuty = staffForShift(POOL_LINES[pool].ids[0], iso, shift).length;
          const b = balanceByKey.get(`${pool}|${iso}|${shift}`);
          row[shift] = b
            ? { onDuty, demand: b.demand, pm: b.pm, cm: b.cm, acs: b.acs, orders: b.orders }
            : { ...EMPTY_CELL, onDuty };
        }
        day[pool] = row;
      }
      days.push(day);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workload.balances, staffForShift, nDays, monthPrefix]);

  const dayStats = useMemo(
    () =>
      grid.map((day, i) => {
        let demand = 0;
        let capacity = 0;
        let orders = 0;
        let shortBy = 0;
        for (const pool of pools) {
          for (const shift of SHIFT_FAMILIES) {
            const c = day[pool][shift];
            demand += c.demand;
            capacity += c.onDuty;
            orders += c.orders;
            shortBy += Math.max(0, c.demand - c.onDuty);
          }
        }
        return { day: i + 1, demand, capacity, orders, shortBy };
      }),
    [grid, pools],
  );

  const today = dayStats[selectedDay - 1];

  const dayAllocs = useMemo(() => monthAllocs.filter((a) => a.day === selectedDay), [monthAllocs, selectedDay]);
  const dayDone = dayAllocs.filter((a) => DONE_STATUSES.has((woMap.get(a.woId)?.status || '').toUpperCase())).length;
  const dayStaffed = dayAllocs.filter((a) => a.status === 'OK').length;

  const monthShortDays = dayStats.filter((d) => d.shortBy > 0).length;
  const monthShortBy = dayStats.reduce((s, d) => s + d.shortBy, 0);
  const typeCounts = useMemo(() => {
    const t = { PM: 0, CM: 0, ACS: 0 };
    for (const a of monthAllocs) t[normalizeWorkType(woMap.get(a.woId)?.workType)]++;
    return t;
  }, [monthAllocs, woMap]);

  const peopleByPool = useMemo(() => {
    const out: Record<StaffPool, number> = { L4_L6: 0, L5: 0 };
    for (const e of allEmployees) if (e.active !== false) out[poolOfLineId(e.lineId)]++;
    return out;
  }, [allEmployees]);

  const dutyToday = pools.reduce(
    (s, p) => s + SHIFT_FAMILIES.reduce((n, sh) => n + grid[selectedDay - 1][p][sh].onDuty, 0),
    0,
  );
  const rosterPeople = pools.reduce((s, p) => s + peopleByPool[p], 0);

  // Shift-level shortfalls across the month, worst first by date
  const shortfalls = useMemo(() => {
    const out: { day: number; pool: StaffPool; shift: ShiftFamily; need: number; have: number }[] = [];
    grid.forEach((day, i) => {
      for (const pool of pools) {
        for (const shift of SHIFT_FAMILIES) {
          const c = day[pool][shift];
          if (c.demand > c.onDuty) out.push({ day: i + 1, pool, shift, need: c.demand, have: c.onDuty });
        }
      }
    });
    return out;
  }, [grid, pools]);

  // --------------------------------------------------------------------------
  // Demand vs capacity chart
  // --------------------------------------------------------------------------
  const chartPoints = useMemo(() => {
    const from = horizon === 'month' ? 1 : selectedDay;
    const to = horizon === 'month' ? nDays : horizon === 'today' ? selectedDay : Math.min(nDays, selectedDay + 6);
    return dayStats.slice(from - 1, to).map((s) => {
      const dow = WEEKDAYS[new Date(year, month - 1, s.day).getDay()];
      return { ...s, label: horizon === 'month' ? String(s.day) : `${dow} ${s.day}` };
    });
  }, [dayStats, horizon, selectedDay, nDays, year, month]);
  const chartMax =
    chartView === 'orders'
      ? Math.max(10, ...chartPoints.map((p) => p.orders))
      : Math.max(1, ...chartPoints.map((p) => Math.max(p.demand, p.capacity)));
  const windowOrders = chartPoints.reduce((s, p) => s + p.orders, 0);
  const windowDemand = chartPoints.reduce((s, p) => s + p.demand, 0);
  const windowShort = chartPoints.filter((p) => p.shortBy > 0).length;

  // --------------------------------------------------------------------------
  // Allocation distribution donut
  // --------------------------------------------------------------------------
  const pie = useMemo(() => {
    type Row = { key: string; label: string; hint: string; color: string; count: number; crew: number };
    const cats: Row[] =
      chartMode === 'type'
        ? [
            { key: 'PM', label: 'Preventive (PM)', hint: 'Planned maintenance', color: 'var(--accent)', count: 0, crew: 0 },
            { key: 'CM', label: 'Corrective (CM)', hint: 'Repairs and faults', color: 'var(--warn)', count: 0, crew: 0 },
            { key: 'ACS', label: 'ACS / Inspection', hint: 'Checks and inspections', color: 'var(--sh-p)', count: 0, crew: 0 },
          ]
        : chartMode === 'shift'
        ? SHIFT_FAMILIES.map((sh) => ({ key: sh, label: SHIFT_LABEL[sh], hint: SHIFT_TIMING[sh], color: SHIFT_COLOR[sh], count: 0, crew: 0 }))
        : chartMode === 'line'
        ? (['L4', 'L5', 'L6'] as const)
            .filter((l) => pools.includes(poolOf(l)))
            .map((l) => ({
              key: l,
              label: `Line ${l.slice(1)}`,
              hint: l === 'L5' ? 'Line 5 team' : 'Line 4 & 6 shared team',
              color: l === 'L4' ? 'var(--sh-m)' : l === 'L5' ? 'var(--sh-e)' : 'var(--sh-p)',
              count: 0,
              crew: 0,
            }))
        : [
            { key: 'OK', label: 'Fully staffed', hint: 'Enough people on its shift', color: 'var(--ok)', count: 0, crew: 0 },
            { key: 'SHORT', label: 'Short of crew', hint: 'Some people, not enough', color: 'var(--warn)', count: 0, crew: 0 },
            { key: 'UNASSIGNED', label: 'Nobody on shift', hint: 'No one rostered on that shift', color: 'var(--danger)', count: 0, crew: 0 },
            { key: 'NO_ROSTER', label: 'No roster for line', hint: 'Add people in People', color: 'var(--ink-3)', count: 0, crew: 0 },
          ];
    const byKey = new Map(cats.map((r) => [r.key, r]));
    for (const a of monthAllocs) {
      const key =
        chartMode === 'type' ? normalizeWorkType(woMap.get(a.woId)?.workType)
        : chartMode === 'shift' ? a.shift
        : chartMode === 'line' ? a.lineCode
        : a.status;
      const row = byKey.get(key);
      if (!row) continue;
      row.count++;
      row.crew += a.needed;
    }
    const total = cats.reduce((s, x) => s + x.count, 0);
    const totalCrew = cats.reduce((s, x) => s + x.crew, 0);
    const title =
      chartMode === 'type' ? 'by type of work' : chartMode === 'shift' ? 'by shift' : chartMode === 'line' ? 'by line' : 'by staffing result';

    // Donut geometry
    const R = 86, r = 56, c = 105;
    let angle = 0;
    const pt = (rad: number, deg: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [c + rad * Math.cos(a), c + rad * Math.sin(a)];
    };
    const arcs = cats.map((s, index) => {
      const share = total ? s.count / total : 0;
      const sweep = Math.min(359.99, share * 360);
      const [x1, y1] = pt(R, angle);
      const [x2, y2] = pt(R, angle + sweep);
      const [x3, y3] = pt(r, angle + sweep);
      const [x4, y4] = pt(r, angle);
      const large = sweep > 180 ? 1 : 0;
      angle += share * 360;
      return {
        ...s,
        index,
        share,
        percent: (share * 100).toFixed(1),
        d: s.count ? `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${large} 0 ${x4} ${y4} Z` : '',
      };
    });
    return { title, total, totalCrew, arcs };
  }, [monthAllocs, woMap, chartMode, pools]);
  const sel = activeSlice !== null ? pie.arcs[activeSlice] : null;

  const dateLabel = (d: number) => `${d} ${MONTHS[month - 1]} ${year}`;
  const noData = workOrdersReady && workOrders.length === 0 && rosterPeople === 0;

  /** Hover text for one day: its work orders, crew, roster and what each shift looks like. */
  const dayTip = (day: number) => {
    const st = dayStats[day - 1];
    const dow = WEEKDAYS[new Date(year, month - 1, day).getDay()];
    const lines = SHIFT_FAMILIES.map((sh) => {
      let need = 0, have = 0;
      for (const pool of pools) {
        need += grid[day - 1][pool][sh].demand;
        have += grid[day - 1][pool][sh].onDuty;
      }
      return `${SHIFT_LABEL[sh]}: need ${need}, have ${have}${need > have ? ` (short ${need - have})` : ''}`;
    });
    return [
      `${dow} ${dateLabel(day)}`,
      st.orders
        ? `${st.orders} work order${st.orders === 1 ? '' : 's'} start this day and need ${st.demand} crew. The Duty Roster has ${st.capacity} people working.`
        : `No work orders start this day. The Duty Roster has ${st.capacity} people working.`,
      lines.join('  ·  '),
      st.shortBy > 0
        ? `Short by ${st.shortBy} in total — open the Duty Roster and move people onto the short shift.`
        : st.orders ? 'Every shift has enough people.' : '',
      'Click to make this the planning date.',
    ].join('\n');
  };

  const shiftMinimum = (pool: StaffPool, shift: ShiftFamily) =>
    POOL_LINES[pool].ids.reduce(
      (s, id) => s + (codesByLine[id]?.find((c) => c.id === shift)?.minHeadcount ?? 0),
      0,
    );

  // Details for the day under the pointer (or the planning date when none)
  const detailDay = Math.min(nDays, hoverDay ?? selectedDay);
  const detail = useMemo(() => {
    const stat = dayStats[detailDay - 1];
    const shifts = SHIFT_FAMILIES.map((sh) => {
      let need = 0, have = 0, orders = 0;
      for (const pool of pools) {
        const c = grid[detailDay - 1][pool][sh];
        need += c.demand; have += c.onDuty; orders += c.orders;
      }
      return { sh, need, have, orders };
    });
    const dow = WEEKDAYS[new Date(year, month - 1, detailDay).getDay()];
    return { stat, shifts, dow };
  }, [dayStats, grid, pools, detailDay, year, month]);

  // Plain-language status for the planning date
  const dayShort = SHIFT_FAMILIES.flatMap((sh) =>
    pools.flatMap((p) => {
      const c = grid[selectedDay - 1][p][sh];
      return c.demand > c.onDuty ? [`${SHIFT_LABEL[sh]}${pools.length > 1 ? ` (${POOL_LINES[p].label})` : ''}`] : [];
    }),
  );
  const status: { tone: Tone; text: string } = !dayAllocs.length
    ? { tone: 'neutral', text: `No work orders on ${dateLabel(selectedDay)}.` }
    : dayShort.length
    ? { tone: 'bad', text: `${dateLabel(selectedDay)}: not enough people on ${dayShort.join(', ')}. Open the Duty Roster to move someone onto that shift.` }
    : { tone: 'good', text: `${dateLabel(selectedDay)}: every work order has enough people on its shift.` };

  const now = new Date();
  const todayDay = now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : null;

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 xl:px-8 py-5 space-y-5 max-w-[1720px] mx-auto w-full">
      {/* ===== Header: title + filters ===== */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold text-ink leading-tight">Dashboard</h1>
          <p className="text-[13px] text-ink-2 mt-0.5">
            {MONTHS[month - 1]} {year} · built from your Duty Roster and Maintenance Workorders
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={poolFilter}
            onChange={setPoolFilter}
            options={[
              { value: 'all', label: 'All lines', tip: 'All lines\nLine 4 & 6 and Line 5 together. Every card, graph and box on this page follows this filter.' },
              { value: 'L46', label: 'Line 4 & 6', tip: 'Line 4 & 6\nOne shared team: Line 4 and Line 6 work orders are covered by the same people on the Duty Roster.' },
              { value: 'L5', label: 'Line 5', tip: 'Line 5\nLine 5 has its own team. Only Line 5 work orders and Line 5 people are counted.' },
            ]}
          />

          {/* Planning date — accent coloured so it reads as the main control */}
          <div
            data-tip={'Planning date\nThe day this whole page is about. The status line, the four cards and the Morning / Evening / Night boxes show this day, and the graph starts from it.\nUse ‹ › to move one day, pick a date from the list, or press Today to jump back to today.'}
            className="flex items-center gap-1 rounded-lg border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] p-0.5"
          >
            <span className="pl-2.5 pr-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              Planning date
            </span>
            <Button size="sm" onClick={() => setSelectedDay((d) => Math.max(1, d - 1))} className="px-2 text-[var(--accent)]" data-tip={'Previous day\nMove the planning date back one day.'}>
              ‹
            </Button>
            <Select
              value={selectedDay}
              onChange={(e) => setSelectedDay(Number(e.target.value))}
              className="h-7 rounded-md border-0 bg-transparent text-[13px] font-semibold text-[var(--accent)]"
            >
              {Array.from({ length: nDays }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {dateLabel(d)}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => setSelectedDay((d) => Math.min(nDays, d + 1))} className="px-2 text-[var(--accent)]" data-tip={'Next day\nMove the planning date forward one day.'}>
              ›
            </Button>
            {todayDay !== null && selectedDay !== todayDay && (
              <Button variant="primary" size="sm" data-tip={'Today\nJump the planning date back to today.'} onClick={() => setSelectedDay(todayDay)}>
                Today
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ===== How to read this ===== */}
      <details className="group rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
        <summary data-tip={'How to read this dashboard\nOpens a short guide to the status line, the cards and both graphs.'} className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden text-[13px] font-medium text-ink flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span className="text-ink-3 text-[10px] transition-transform group-open:rotate-90">▶</span>
            How to read this dashboard
          </span>
          <span className="text-ink-3 text-xs group-open:hidden">Show</span>
          <span className="text-ink-3 text-xs hidden group-open:inline">Hide</span>
        </summary>

        <ol className="mt-3 grid gap-2 text-[13px] text-ink-2 sm:grid-cols-2 xl:grid-cols-4 list-none">
          <li><strong className="text-ink">1. Pick a date.</strong> The accent-coloured Planning date drives the status line, the cards and the shift boxes.</li>
          <li><strong className="text-ink">2. Read the status line.</strong> Green means every work order has enough people. Red means a shift is short.</li>
          <li><strong className="text-ink">3. Check the graph.</strong> Bars show how busy each day is. Amber or red marks days where a shift is short.</li>
          <li><strong className="text-ink">4. Fix it in the Duty Roster.</strong> The numbers are live, so once you move people the shortfall disappears here.</li>
        </ol>

        <div className="mt-4 pt-3 border-t border-[var(--line)] text-[13px] text-ink-2 leading-relaxed space-y-2">
          <p>
            <strong className="text-ink">How to read the graph.</strong> Each bar is one day. In the{' '}
            <strong className="text-ink">Work orders</strong> view, the <strong className="text-ink">number on top</strong> is how
            many work orders are scheduled that day, and a taller bar means a busier day. A{' '}
            <strong className="text-[var(--warn)]">amber</strong> bar means at least one shift that day has fewer people on the
            roster than its work orders need. The <strong className="text-[var(--accent)]">blue</strong> bar is the planning date.
          </p>
          <p>
            In the <strong className="text-ink">Needed vs available</strong> view, the bar is the crew the work orders need and
            the <strong className="text-[var(--ok)]">green line</strong> is how many people the Duty Roster has working. If the bar
            reaches above the line, or turns <strong className="text-[var(--danger)]">red</strong>, a shift is short. Check the
            Morning, Evening and Night boxes to see which one.
          </p>
          <p>Point at any bar to see its details. Click it to make it the planning date.</p>
        </div>
      </details>

      {noData && (
        <div className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] p-8 text-center text-[13px] text-ink-2">
          Nothing to show yet. Add people in <strong className="text-ink">People</strong> and import work orders in{' '}
          <strong className="text-ink">Maintenance Workorders</strong>; this page fills in from them.
        </div>
      )}

      {/* ===== Status line ===== */}
      <div
        data-tip={'Status for the planning date\nGreen: every work order that day has enough people on its shift. Red: at least one shift has fewer people on the Duty Roster than its work orders need. Grey: no work orders that day.'}
        className={cx('rounded-xl border px-4 py-3 text-[13px] font-medium', STATUS_STYLE[status.tone])}
      >
        {status.text}
      </div>

      {/* ===== KPI cards ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label={`Work orders in ${MONTHS[month - 1]}`}
          value={monthAllocs.length}
          note={`${typeCounts.PM} preventive · ${typeCounts.CM} corrective · ${typeCounts.ACS} inspection`}
          tip={`Work orders in ${MONTHS[month - 1]}\nEvery work order whose Scheduled Start falls in this month, for the lines selected at the top. Preventive = planned maintenance (PM), corrective = repairs (CM), inspection = checks (ACS).\nWork orders with no valid date or line cannot be placed on a day, so they are left out.`}
        />
        <Kpi
          label={`Work orders on ${dateLabel(selectedDay)}`}
          value={dayAllocs.length}
          note={dayAllocs.length ? `${dayStaffed} fully staffed · ${dayDone} completed` : 'Nothing scheduled'}
          tone={dayAllocs.length && dayStaffed < dayAllocs.length ? 'bad' : undefined}
          tip={`Work orders on ${dateLabel(selectedDay)}\nHow many work orders start on the planning date. "Fully staffed" means every one of them has all the people it needs on its shift, taken from the Duty Roster. "Completed" are ones the Excel file already marks as done.`}
        />
        <Kpi
          label="People working that day"
          value={dutyToday}
          note={`${today?.demand ?? 0} needed by work orders · ${rosterPeople} on roster`}
          tone={today && today.shortBy > 0 ? 'bad' : undefined}
          tip={'People working that day\nPeople the Duty Roster has on a Morning, Evening or Night shift on the planning date. Compare with "needed by work orders", the crew those jobs call for.\n"On roster" is everyone in the team, including people on rest days or leave.'}
        />
        <Kpi
          label="Crew short this month"
          value={monthShortBy}
          note={monthShortDays ? `Across ${monthShortDays} day${monthShortDays === 1 ? '' : 's'}` : 'Every day is covered'}
          tone={monthShortBy ? 'bad' : 'good'}
          tip={'Crew short this month\nFor every day and shift, how many more people the work orders need than the Duty Roster has — all added up. 0 means every day is covered.\nIt counts people, not work orders. "Across N days" is how many days have a gap.'}
        />
      </div>

      {/* ===== Charts ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Demand vs capacity */}
        <section className="lg:col-span-7 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-ink">{chartView === 'orders' ? 'Work orders per day' : 'People needed vs people available'}</h2>
                <p className="text-[12px] text-ink-2 mt-0.5">
                  {chartView === 'orders'
                    ? 'Number of work orders each day. Amber means that day has a shift without enough people.'
                    : 'Bar = crew the work orders need. Green line = people on the roster. Red bar = a shift is short.'}
                </p>
              </div>
              <div className="flex flex-nowrap items-center gap-2 shrink-0 self-start whitespace-nowrap">
              <Segmented
                value={chartView}
                onChange={setChartView}
                options={[
                  { value: 'orders', label: 'Work orders', tip: 'Work orders view\nOne bar per day. The number on top is how many work orders start that day. Amber bars have a shift without enough people.' },
                  { value: 'crew', label: 'Needed vs available', tip: 'Needed vs available view\nBar = crew the work orders need that day. Green line = people the Duty Roster has working. A bar above the line (red) means a shortage.' },
                ]}
              />
              <Segmented
                value={horizon}
                onChange={setHorizon}
                options={[
                  { value: 'today', label: 'Today', tip: 'Today\nShow only the planning date.' },
                  { value: '7days', label: 'Next 7 Days', tip: 'Next 7 days\nThe planning date and the six days after it.' },
                  { value: 'month', label: '30-Day Month', tip: 'Whole month\nEvery day of the month, one bar each.' },
                ]}
              />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat label="Period volume" value={`${windowOrders} orders`} tip={'Period volume\nTotal work orders on the days shown in the graph — whatever Today, Next 7 days or Month is selected.'} />
              <Stat label="Crew shifts needed" value={String(windowDemand)} tip={'Crew shifts needed\nTotal crew those work orders call for, added up over the days shown. Two people on one shift counts as 2.'} />
              <Stat
                label="Status"
                value={windowShort ? `${windowShort} day${windowShort === 1 ? '' : 's'} short` : 'Capacity safe'}
                tone={windowShort ? 'bad' : 'good'}
                tip={'Status\nHow many of the days shown have a shift short of people. "Capacity safe" means no day in the graph is short.'}
              />
            </div>

            {/* Details of the hovered day — kept outside the scrolling chart so it is never cut off */}
            <div
              data-tip={'Day details\nShows the day under your pointer, or the planning date when you are not pointing at a bar. "Need" is the crew that day\'s work orders call for; "have" is the people the Duty Roster has on that shift.'}
              className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-ink">
                  {detail.dow}, {dateLabel(detailDay)}
                  <span className="ml-2 text-[11px] font-medium text-ink-3">
                    {hoverDay === null ? 'planning date' : 'under your pointer'}
                  </span>
                </div>
                <span
                  className={cx(
                    'px-2 py-0.5 rounded-full text-[11px] font-semibold',
                    BADGE_STYLE[detail.stat.shortBy > 0 ? 'bad' : detail.stat.orders ? 'good' : 'neutral'],
                  )}
                >
                  {detail.stat.shortBy > 0 ? `Short by ${detail.stat.shortBy}` : detail.stat.orders ? 'Fully covered' : 'No work'}
                </span>
              </div>
              <div className="mt-2 text-[12px] text-ink-2">
                <strong className="text-ink">{detail.stat.orders}</strong> work orders need{' '}
                <strong className="text-ink">{detail.stat.demand}</strong> crew · roster has{' '}
                <strong className="text-ink">{detail.stat.capacity}</strong> people working
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {detail.shifts.map((x) => {
                  const short = x.need > x.have;
                  return (
                    <div
                      key={x.sh}
                      data-tip={`${SHIFT_LABEL[x.sh]} shift (${SHIFT_TIMING[x.sh]})\nNeed ${x.need}: crew the ${x.orders} work order${x.orders === 1 ? '' : 's'} on this shift call for. Have ${x.have}: people the Duty Roster has on ${SHIFT_LABEL[x.sh]} that day.\n${short ? `Short by ${x.need - x.have} — move people onto this shift in the Duty Roster.` : 'This shift is covered.'}`}
                      className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                        <span className="w-2 h-2 rounded-full" style={{ background: SHIFT_COLOR[x.sh] }} />
                        {SHIFT_LABEL[x.sh]}
                      </div>
                      <div className={cx('text-[12px] tabular-nums mt-0.5', short ? 'text-[var(--danger)] font-semibold' : 'text-ink-2')}>
                        need {x.need} · have {x.have}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {chartView === 'orders' ? (
              <>
            <div className="h-56 w-full flex items-end gap-2 sm:gap-3.5 px-3 sm:px-6 pt-8 pb-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] overflow-x-auto relative">
              {chartPoints.map((pt) => {
                const isSel = pt.day === selectedDay;
                const heightPercent = Math.max(16, (pt.orders / chartMax) * 100);
                return (
                  <div
                    key={pt.day}
                    data-tip={dayTip(pt.day)}
                    onClick={() => setSelectedDay(pt.day)}
                    onMouseEnter={() => setHoverDay(pt.day)}
                    onMouseLeave={() => setHoverDay(null)}
                    className="flex-1 min-w-[34px] flex flex-col items-center justify-end h-full group relative cursor-pointer"
                  >
                    <span
                      className={cx(
                        'text-xs font-semibold tabular-nums mb-1.5 transition-transform group-hover:scale-125',
                        isSel ? 'text-[var(--accent)]' : 'text-ink-2',
                      )}
                    >
                      {pt.orders}
                    </span>
                    <div
                      className={cx(
                        'w-full max-w-[42px] rounded-t-xl transition-all duration-300 shadow-md group-hover:brightness-110',
                        isSel
                          ? 'bg-gradient-to-t from-blue-600 via-sky-500 to-cyan-400 ring-2 ring-blue-500/50'
                          : pt.shortBy > 0
                          ? 'bg-gradient-to-t from-amber-600 to-amber-400'
                          : 'bg-gradient-to-t from-slate-400 to-slate-300 dark:from-slate-700 dark:to-slate-600',
                      )}
                      style={{ height: `${heightPercent}%` }}
                    />
                    <span className={cx('text-[10.5px] font-medium mt-2 truncate max-w-full text-center', isSel ? 'text-[var(--accent)] font-semibold' : 'text-ink-3')}>
                      {pt.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-ink-2">
              <span data-tip={'Selected date\nThe blue bar is the planning date.'} className="flex items-center gap-1.5"><i className="w-3 h-2.5 rounded-sm inline-block bg-gradient-to-t from-blue-600 to-cyan-400" />Selected date</span>
              <span data-tip={'A shift is short that day\nAmber: at least one shift (Morning, Evening or Night) has fewer people on the roster than its work orders need.'} className="flex items-center gap-1.5"><i className="w-3 h-2.5 rounded-sm inline-block bg-gradient-to-t from-amber-600 to-amber-400" />A shift is short that day</span>
              <span data-tip={'Work orders\nGrey bars are days that are fully covered. The number on top is how many work orders start that day; a taller bar is a busier day.'} className="flex items-center gap-1.5"><i className="w-3 h-2.5 rounded-sm inline-block bg-slate-400" />Work orders (number on top)</span>
            </div>
              </>
            ) : (
              <>
                <div className="h-56 w-full flex items-end gap-1.5 sm:gap-2.5 px-3 sm:px-5 pt-8 pb-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] overflow-x-auto">
                  {chartPoints.map((pt) => {
                    const isSel = pt.day === selectedDay;
                    return (
                      <button
                        key={pt.day}
                        type="button"
                        data-tip={dayTip(pt.day)}
                        onClick={() => setSelectedDay(pt.day)}
                        onMouseEnter={() => setHoverDay(pt.day)}
                        onMouseLeave={() => setHoverDay(null)}
                        className="flex-1 min-w-[26px] h-full flex flex-col items-center justify-end group relative cursor-pointer"
                      >
                        <span className={cx('text-[11px] font-semibold tabular-nums mb-1', isSel ? 'text-[var(--accent)]' : 'text-ink-2')}>
                          {pt.demand}
                        </span>
                        <div className="relative w-full flex-1 flex items-end justify-center min-h-0">
                          <div
                            className={cx('w-full max-w-[36px] rounded-t-md transition-all', isSel && 'ring-2 ring-[var(--accent)]')}
                            style={{
                              height: `${(pt.demand / chartMax) * 100}%`,
                              minHeight: pt.demand ? 3 : 0,
                              background: pt.shortBy > 0 ? 'var(--danger)' : isSel ? 'var(--accent)' : 'var(--ink-3)',
                              opacity: pt.shortBy > 0 || isSel ? 1 : 0.55,
                            }}
                          />
                          <div
                            className="absolute left-1/2 -translate-x-1/2 w-full max-w-[44px] h-0.5 pointer-events-none"
                            style={{ bottom: `${(pt.capacity / chartMax) * 100}%`, background: 'var(--ok)' }}
                          />
                        </div>
                        <span className={cx('text-[10.5px] font-medium mt-1.5 truncate max-w-full', isSel ? 'text-[var(--accent)] font-semibold' : 'text-ink-3')}>
                          {pt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-ink-2">
                  <span data-tip={'People needed\nThe bar: crew the day\'s work orders call for.'} className="flex items-center gap-1.5"><i className="w-3 h-2.5 rounded-sm inline-block bg-[var(--ink-3)] opacity-60" />People needed</span>
                  <span data-tip={'A shift is short\nRed bar: on that day, at least one shift has fewer people on the roster than its work orders need.'} className="flex items-center gap-1.5"><i className="w-3 h-2.5 rounded-sm inline-block bg-[var(--danger)]" />A shift is short</span>
                  <span data-tip={'People available\nThe green line: people the Duty Roster has working that day. A bar reaching above the line means a shortage.'} className="flex items-center gap-1.5"><i className="w-4 h-0.5 inline-block bg-[var(--ok)]" />People available</span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[var(--line)] text-[12px] text-ink-3 mt-4">
            <span>Point at a bar for details · click to pick the date</span>
            <Button size="sm" variant="outline" onClick={onOpenWorkOrders} data-tip={'Open Maintenance Workorders\nSee every work order, who is assigned to it, and the full list of shortfalls.'}>Open Maintenance Workorders →</Button>
          </div>
        </section>

        {/* Allocation distribution */}
        <section className="lg:col-span-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Resource Allocation Distribution</h2>
              <p className="text-[12px] text-ink-2 mt-0.5">{MONTHS[month - 1]} work orders {pie.title}</p>
            </div>
            <Segmented
              value={chartMode}
              onChange={(m) => {
                setChartMode(m);
                setActiveSlice(null);
              }}
              options={[
                { value: 'type', label: 'Type', tip: 'By type\nSplits this month\'s work orders into preventive (PM), corrective (CM) and inspection (ACS).' },
                { value: 'shift', label: 'Shift', tip: 'By shift\nWhich shift each work order is planned on: Morning, Evening or Night.' },
                { value: 'line', label: 'Line', tip: 'By line\nHow many work orders belong to Line 4, Line 5 and Line 6.' },
                { value: 'status', label: 'Staffing', tip: 'By staffing\nWhether each work order has enough people on its shift: fully staffed, short of crew, nobody on shift, or no roster.' },
              ]}
            />
          </div>

          {pie.total === 0 ? (
            <div className="flex-1 grid place-items-center py-10 text-center text-[13px] text-ink-3">
              No work orders placed in this month.
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center gap-6 py-5">
              <div className="relative mx-auto w-full max-w-[280px] aspect-square">
                <svg viewBox="0 0 210 210" className="w-full h-full">
                  {pie.arcs.map(
                    (arc) =>
                      arc.d && (
                        <path
                          key={arc.key}
                          d={arc.d}
                          data-tip={`${arc.label} — ${arc.count} work orders (${arc.percent}%)\n${arc.hint}. These work orders need ${arc.crew} crew shifts in total.\nThe full circle is all ${pie.total} work orders in ${MONTHS[month - 1]}.`}
                          fill={arc.color}
                          className="transition-all duration-200 cursor-pointer"
                          style={{
                            transformOrigin: '105px 105px',
                            transform: activeSlice === arc.index ? 'scale(1.04)' : 'scale(1)',
                            opacity: activeSlice !== null && activeSlice !== arc.index ? 0.5 : 1,
                          }}
                          onMouseEnter={() => setActiveSlice(arc.index)}
                          onMouseLeave={() => setActiveSlice(null)}
                        />
                      ),
                  )}
                </svg>
                <div
                  data-tip={'Centre of the chart\nTotal work orders this month and the crew shifts they need — or the figures of the slice you point at.'}
                  className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none"
                >
                  <span className="text-[44px] font-semibold text-ink tabular-nums leading-none">{sel ? sel.count : pie.total}</span>
                  <span className="text-[12px] font-medium text-ink-2 mt-1.5 max-w-[120px] truncate">
                    {sel ? `${sel.label} · ${sel.percent}%` : 'work orders'}
                  </span>
                  <span className="text-[11px] text-ink-3 mt-0.5">
                    {sel ? `${sel.crew} crew needed` : `${pie.totalCrew} crew needed`}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {pie.arcs.map((arc) => (
                  <div
                    key={arc.key}
                    data-tip={`${arc.label}\n${arc.count} work orders (${arc.percent}% of the month) needing ${arc.crew} crew shifts. ${arc.hint}.\nPoint here to highlight its slice in the chart.`}
                    onMouseEnter={() => setActiveSlice(arc.count ? arc.index : null)}
                    onMouseLeave={() => setActiveSlice(null)}
                    className={cx(
                      'px-3 py-2.5 rounded-lg border transition-colors',
                      arc.count ? 'cursor-pointer' : 'opacity-60',
                      activeSlice === arc.index ? 'bg-[var(--surface-3)] border-[var(--accent)]' : 'bg-[var(--surface-2)] border-[var(--line)]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: arc.color }} />
                        <div className="min-w-0">
                          <span className="text-[13px] font-medium text-ink block truncate">{arc.label}</span>
                          <span className="text-[11px] text-ink-3 block truncate">{arc.hint}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <span className="text-[13px] text-ink-2">
                          <strong className="text-ink font-semibold">{arc.count}</strong> · {arc.percent}%
                        </span>
                        <span className="text-[11px] text-ink-3 block">{arc.crew} crew</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--surface-3)] mt-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${arc.share * 100}%`, background: arc.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-[12px] text-ink-3">
            <span>Follows the line filter at the top</span>
            <span className="text-ink-2 font-medium tabular-nums">{pie.total} orders · {pie.totalCrew} crew shifts</span>
          </div>
        </section>
      </div>

      {/* ===== Shift deployment for the planning date ===== */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Shifts on {dateLabel(selectedDay)}</h2>
            <p className="text-[12px] text-ink-2 mt-0.5">People on each shift against the crew its work orders need</p>
          </div>
          <Button variant="primary" onClick={onOpenPlanner} className="self-start sm:self-auto" data-tip={'Open Duty Roster\nGo to the planner to move people between shifts. This page updates as soon as you do.'}>
            Open Duty Roster →
          </Button>
        </div>

        <div className={cx('grid grid-cols-1 gap-4', pools.length > 1 && 'md:grid-cols-2')}>
          {pools.map((pool) => {
            const row = grid[selectedDay - 1][pool];
            const total = SHIFT_FAMILIES.reduce((s, sh) => s + row[sh].onDuty, 0);
            return (
              <div key={pool} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div
                  data-tip={`${POOL_TITLE[pool]}\n"Working" is people the Duty Roster has on a Morning, Evening or Night shift on ${dateLabel(selectedDay)}. "On roster" is everyone in this team, including rest days and leave.`}
                  className="flex items-center justify-between pb-3 border-b border-[var(--line)]"
                >
                  <span className="text-[13px] font-semibold text-ink">{POOL_TITLE[pool]}</span>
                  <span className="text-[12px] text-ink-2 tabular-nums">{total} working · {peopleByPool[pool]} on roster</span>
                </div>

                <div className="space-y-2.5 mt-3">
                  {SHIFT_FAMILIES.map((shift) => {
                    const c = row[shift];
                    const min = shiftMinimum(pool, shift);
                    const buffer = c.onDuty - c.demand;
                    const belowMin = c.onDuty < min;
                    const fill = c.onDuty ? Math.min(100, (c.demand / c.onDuty) * 100) : c.demand ? 100 : 0;
                    const tone: Tone = buffer < 0 ? 'bad' : belowMin ? 'warn' : c.demand ? 'good' : 'neutral';
                    return (
                      <div
                        key={shift}
                        data-tip={`${SHIFT_LABEL[shift]} shift · ${POOL_TITLE[pool]}\n${c.onDuty} people work this shift on ${dateLabel(selectedDay)}; its ${c.orders} work order${c.orders === 1 ? '' : 's'} need ${c.demand} crew.\n${buffer < 0 ? `Short by ${-buffer} — move people onto ${SHIFT_LABEL[shift]} in the Duty Roster.` : belowMin ? `Fewer people than the minimum of ${min} set in Setup.` : c.demand ? `${buffer} spare after the work orders are staffed.` : 'No work orders on this shift.'}\nThe bar shows how much of the people on shift the work orders use up; red means they need more than there are.`}
                        className="rounded-lg bg-[var(--surface)] border border-[var(--line)] p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: SHIFT_COLOR[shift] }} />
                            <span className="text-[13px] font-semibold text-ink">{SHIFT_LABEL[shift]}</span>
                            <span className="text-[11px] text-ink-3">{SHIFT_TIMING[shift]}</span>
                          </div>
                          <span className={cx('px-2 py-0.5 rounded-full text-[11px] font-semibold', BADGE_STYLE[tone])}>
                            {buffer < 0 ? `Short by ${-buffer}` : belowMin ? `Below minimum (${min})` : c.demand ? `${buffer} spare` : 'No work'}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-5 mt-2 text-[12px] text-ink-2">
                          <span><strong className="text-[18px] font-semibold text-ink tabular-nums">{c.onDuty}</strong> working</span>
                          <span><strong className="text-[18px] font-semibold text-ink tabular-nums">{c.demand}</strong> needed</span>
                          <span><strong className="text-[18px] font-semibold text-ink tabular-nums">{c.orders}</strong> orders</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[var(--surface-3)] mt-2.5 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${fill}%`, background: buffer < 0 ? 'var(--danger)' : 'var(--ok)' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== Attention list ===== */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Needs attention</h2>
            <p className="text-[12px] text-ink-2 mt-0.5">Shifts in {MONTHS[month - 1]} where work orders need more people than the roster has</p>
          </div>
          <span className={cx('px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0', BADGE_STYLE[shortfalls.length ? 'bad' : 'good'])}>
            {shortfalls.length ? `${shortfalls.length} to fix` : 'All clear'}
          </span>
        </div>

        {shortfalls.length === 0 ? (
          <p className="text-[13px] text-ink-2">Every shift with work orders has enough people on the roster.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {shortfalls.slice(0, 12).map((s) => (
              <button
                key={`${s.day}-${s.pool}-${s.shift}`}
                type="button"
                data-tip={`${dateLabel(s.day)} · ${SHIFT_LABEL[s.shift]} · ${POOL_LINES[s.pool].label}\nWork orders that day need ${s.need} people on this shift but the Duty Roster has only ${s.have}. Click to make it the planning date, then fix it in the Duty Roster.`}
                onClick={() => setSelectedDay(s.day)}
                className="text-left px-3 py-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--danger)] transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="text-[13px] font-semibold text-ink block">{dateLabel(s.day)} · {SHIFT_LABEL[s.shift]}</span>
                  <span className="text-[11px] text-ink-3 block truncate">{POOL_LINES[s.pool].label}</span>
                </div>
                <span className="text-[12px] font-semibold tabular-nums text-[var(--danger)] shrink-0">
                  need {s.need}, have {s.have}
                </span>
              </button>
            ))}
          </div>
        )}
        {shortfalls.length > 12 && (
          <p className="text-[12px] text-ink-3 mt-3">Showing the first 12 of {shortfalls.length}. Open Maintenance Workorders for the full list.</p>
        )}
        {unplaced > 0 && (
          <p className="text-[12px] text-[var(--warn)] font-medium mt-3">
            {unplaced} work order{unplaced === 1 ? ' has' : 's have'} no usable Scheduled Start or Line, so {unplaced === 1 ? 'it is' : 'they are'} left out of these numbers. Fix the Excel file and import again.
          </p>
        )}
      </section>
    </div>
  );
}

type Tone = 'good' | 'bad' | 'warn' | 'neutral';

const mix = (v: string) => `bg-[color-mix(in_srgb,var(${v})_14%,transparent)] text-[var(${v})]`;
const BADGE_STYLE: Record<Tone, string> = {
  good: mix('--ok'),
  bad: mix('--danger'),
  warn: mix('--warn'),
  neutral: 'bg-[var(--surface-3)] text-ink-2',
};
const STATUS_STYLE: Record<Tone, string> = {
  good: `${mix('--ok')} border-[color-mix(in_srgb,var(--ok)_35%,transparent)]`,
  bad: `${mix('--danger')} border-[color-mix(in_srgb,var(--danger)_35%,transparent)]`,
  warn: `${mix('--warn')} border-[color-mix(in_srgb,var(--warn)_35%,transparent)]`,
  neutral: 'bg-[var(--surface)] text-ink-2 border-[var(--line)]',
};

function Stat({ label, value, tone, tip }: { label: string; value: string; tone?: Tone; tip?: string }) {
  return (
    <div
      data-tip={tip}
      className={cx(
        'p-3 rounded-lg border',
        tone ? `${STATUS_STYLE[tone]}` : 'bg-[var(--surface-2)] border-[var(--line)]',
      )}
    >
      <span className="text-[11px] font-medium text-ink-2 block">{label}</span>
      <span className={cx('text-[17px] font-semibold tabular-nums', !tone && 'text-ink')}>{value}</span>
    </div>
  );
}

function Kpi({ label, value, note, tone, tip }: { label: string; value: number; note: string; tone?: Tone; tip?: string }) {
  return (
    <div data-tip={tip} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <span className="text-[12px] font-medium text-ink-2 block truncate">{label}</span>
      <span
        className={cx(
          'mt-2 block text-[32px] leading-none font-semibold tabular-nums',
          tone === 'bad' ? 'text-[var(--danger)]' : tone === 'good' ? 'text-[var(--ok)]' : 'text-ink',
        )}
      >
        {value}
      </span>
      <span className="mt-2 block text-[12px] text-ink-3">{note}</span>
    </div>
  );
}
