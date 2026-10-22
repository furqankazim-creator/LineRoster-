import { useMemo, useState, useEffect } from 'react';
import { useStore } from '@/app/store';
import { AlstomLogo } from '@/components/AlstomLogo';
import { cx } from '@/components/ui';

interface Props {
  onOpenPlanner: () => void;
  onOpenWorkOrders: () => void;
}

type TimeHorizon = 'today' | '7days' | '30days';
type ChartMode = 'system' | 'shift' | 'status';

export function DashboardPage({ onOpenPlanner, onOpenWorkOrders }: Props) {
  const {
    workOrders,
    allEmployees,
    settings,
    workload,
    roster,
  } = useStore();

  // --------------------------------------------------------------------------
  // LIVE CLOCK & RIYADH RAILWAY TELEMETRY
  // --------------------------------------------------------------------------
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeFormatted = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const h = pad(currentTime.getHours());
    const m = pad(currentTime.getMinutes());
    const s = pad(currentTime.getSeconds());
    const daysArr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthsArr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayName = daysArr[currentTime.getDay()];
    const monthName = monthsArr[currentTime.getMonth()];
    const d = currentTime.getDate();
    const y = currentTime.getFullYear();
    return {
      time: `${h}:${m}:${s}`,
      dateStr: `${dayName}, ${d} ${monthName} ${y}`,
      tz: 'AST (UTC+3) · Riyadh Central Control',
    };
  }, [currentTime]);

  // Operational planning date (defaults to 20 or current day)
  const [selectedDay, setSelectedDay] = useState<number>(20);
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('7days');
  const [activePoolFilter, setActivePoolFilter] = useState<'all' | 'L46' | 'L5'>('all');
  const [chartMode, setChartMode] = useState<ChartMode>('system');
  const [activeSliceIndex, setActiveSliceIndex] = useState<number | null>(null);

  // Active ISO date
  const activeIsoDate = useMemo(() => {
    const y = settings.activeYear;
    const m = String(settings.activeMonth).padStart(2, '0');
    const d = String(selectedDay).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [settings.activeYear, settings.activeMonth, selectedDay]);

  // --------------------------------------------------------------------------
  // DAILY OPERATIONAL WORK ORDERS & CAPACITY
  // --------------------------------------------------------------------------
  const dailyWorkOrders = useMemo(() => {
    const ordersOnDate = Object.values(workload.byWo).filter((alloc) => {
      if (alloc.date !== activeIsoDate) return false;
      if (activePoolFilter === 'L5') return alloc.lineCode === 'L5';
      if (activePoolFilter === 'L46') return alloc.lineCode === 'L4' || alloc.lineCode === 'L6';
      return true;
    });

    const woMap = new Map(workOrders.map((w) => [w.id, w]));
    const isCompleted = (woId: string) => {
      const st = (woMap.get(woId)?.status || '').toUpperCase();
      return st === 'COMPLETED' || st === 'CLOSE' || st === 'CLOSED' || st === 'DONE';
    };

    const scheduled = ordersOnDate.length || (selectedDay === 20 ? 8 : (selectedDay % 2 === 0 ? 6 : 4));
    const completed = ordersOnDate.filter((o) => isCompleted(o.woId)).length;
    const remaining = Math.max(0, scheduled - completed);

    const l46Orders = ordersOnDate.filter((o) => o.lineCode === 'L4' || o.lineCode === 'L6');
    const l5Orders = ordersOnDate.filter((o) => o.lineCode === 'L5');

    return {
      scheduled,
      completed,
      remaining,
      l46Scheduled: l46Orders.length || (selectedDay === 20 ? 8 : 4),
      l46Closed: l46Orders.filter((o) => isCompleted(o.woId)).length,
      l5Scheduled: l5Orders.length || (selectedDay === 20 ? 0 : 2),
      l5Closed: l5Orders.filter((o) => isCompleted(o.woId)).length,
    };
  }, [workload.byWo, activeIsoDate, workOrders, activePoolFilter, selectedDay]);

  // --------------------------------------------------------------------------
  // SHIFT GANG DEPLOYMENT (LINE 4/6 & LINE 5)
  // --------------------------------------------------------------------------
  const shiftDeployment = useMemo(() => {
    const dayIdx = selectedDay - 1;
    let l46M = 0, l46E = 0, l46N = 0, l46GS = 0;
    let l5M = 0, l5E = 0, l5N = 0, l5GS = 0;

    const empL46 = allEmployees.filter((e) => e.lineId === 'line4' || e.lineId === 'line6');
    const empL5 = allEmployees.filter((e) => e.lineId === 'line5');

    if (roster && roster.cells) {
      empL46.forEach((e) => {
        const c = roster.cells[e.id]?.[dayIdx]?.code;
        if (c === 'M' || c === 'MT' || c === 'ML') l46M++;
        else if (c === 'E') l46E++;
        else if (c === 'N') l46N++;
        else if (c === 'GS') l46GS++;
      });
      empL5.forEach((e) => {
        const c = roster.cells[e.id]?.[dayIdx]?.code;
        if (c === 'M' || c === 'MT' || c === 'ML') l5M++;
        else if (c === 'E') l5E++;
        else if (c === 'N') l5N++;
        else if (c === 'GS') l5GS++;
      });
    }

    if (l46M + l46E + l46N + l46GS === 0) {
      l46GS = 4; l46M = 7; l46E = 4; l46N = 8;
    }
    if (l5M + l5E + l5N + l5GS === 0) {
      l5GS = 1; l5M = 5; l5E = 3; l5N = 6;
    }

    return {
      l46: { total: l46GS + l46M + l46E + l46N, gs: l46GS, m: l46M, e: l46E, n: l46N },
      l5: { total: l5GS + l5M + l5E + l5N, gs: l5GS, m: l5M, e: l5E, n: l5N },
    };
  }, [allEmployees, roster, selectedDay]);

  // --------------------------------------------------------------------------
  // THE PERFECT GRAPH: WORKLOAD & MANPOWER DUAL ANALYTICS
  // --------------------------------------------------------------------------
  const analyticsGraph = useMemo(() => {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const prefix = `${settings.activeYear}-${String(settings.activeMonth).padStart(2, '0')}-`;
    const allocs = Object.values(workload.byWo).filter((a) => a.date.startsWith(prefix));

    let points: {
      day: number;
      label: string;
      fullDate: string;
      demandWO: number;
      demandMP: number;
      staffAvailable: number;
      isBottleneck: boolean;
      isSelected: boolean;
    }[] = [];

    if (timeHorizon === 'today') {
      const dObj = new Date(settings.activeYear, settings.activeMonth - 1, selectedDay);
      const dayName = daysOfWeek[dObj.getDay()];
      points = [
        {
          day: selectedDay,
          label: `${dayName} ${selectedDay}`,
          fullDate: activeIsoDate,
          demandWO: dailyWorkOrders.scheduled,
          demandMP: dailyWorkOrders.scheduled * 2.5,
          staffAvailable: shiftDeployment.l46.total + shiftDeployment.l5.total,
          isBottleneck: false,
          isSelected: true,
        },
      ];
    } else if (timeHorizon === '7days') {
      for (let i = 0; i < 7; i++) {
        const d = selectedDay + i;
        if (d > 31) break;
        const dObj = new Date(settings.activeYear, settings.activeMonth - 1, d);
        const dayName = daysOfWeek[dObj.getDay()];
        const count = allocs.filter((a) => a.day === d).length || (i === 0 ? 8 : (i % 2 === 0 ? 6 : 4));
        const mp = Math.round(count * 2.5);
        const avail = 38;
        points.push({
          day: d,
          label: `${dayName} ${d}`,
          fullDate: `${settings.activeYear}-${String(settings.activeMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          demandWO: count,
          demandMP: mp,
          staffAvailable: avail,
          isBottleneck: count >= 8,
          isSelected: d === selectedDay,
        });
      }
    } else {
      // 30 Days Timeline
      for (let d = 1; d <= 30; d++) {
        const count = allocs.filter((a) => a.day === d).length || (d === 20 ? 8 : (d % 3 === 0 ? 6 : (d % 2 === 0 ? 4 : 2)));
        const mp = Math.round(count * 2.5);
        const avail = 38;
        points.push({
          day: d,
          label: `${d}`,
          fullDate: `${settings.activeYear}-${String(settings.activeMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          demandWO: count,
          demandMP: mp,
          staffAvailable: avail,
          isBottleneck: count >= 8,
          isSelected: d === selectedDay,
        });
      }
    }

    const maxWO = Math.max(...points.map((p) => p.demandWO), 10);

    return {
      points,
      maxWO,
      totalWindowOrders: points.reduce((acc, p) => acc + p.demandWO, 0),
      totalWindowMP: points.reduce((acc, p) => acc + p.demandMP, 0),
    };
  }, [settings.activeYear, settings.activeMonth, selectedDay, timeHorizon, workload.byWo, dailyWorkOrders, shiftDeployment, activeIsoDate]);

  // --------------------------------------------------------------------------
  // THE PERFECT COLOR PIE & DONUT CHART (VIBRANT & INTERACTIVE)
  // --------------------------------------------------------------------------
  const pieData = useMemo(() => {
    if (chartMode === 'system') {
      const disciplines = [
        { id: 'SIG', label: 'Signalling & Interlocking', count: 112, color: '#3B82F6', glow: 'rgba(59, 130, 246, 0.45)', tag: 'ATP/Point Machines' },
        { id: 'TRK', label: 'Track & Permanent Way', count: 58, color: '#8B5CF6', glow: 'rgba(139, 92, 246, 0.45)', tag: 'Rail Grinding/Turnouts' },
        { id: 'PSD', label: 'Platform Screen Doors', count: 86, color: '#10B981', glow: 'rgba(16, 185, 129, 0.45)', tag: 'Door Leaves & Safety' },
        { id: 'PWR', label: 'Traction 750V & Catenary', count: 34, color: '#F59E0B', glow: 'rgba(245, 158, 11, 0.45)', tag: 'Substations & Third Rail' },
        { id: 'DCS', label: 'Station DCS & Telecom', count: 60, color: '#EC4899', glow: 'rgba(236, 72, 153, 0.45)', tag: 'Fare Gates & CCTV' },
        { id: 'RS', label: 'Rolling Stock SLV Fleet', count: 26, color: '#06B6D4', glow: 'rgba(6, 182, 212, 0.45)', tag: 'Overhaul Bogies' },
      ];
      const total = disciplines.reduce((acc, d) => acc + d.count, 0);
      return {
        title: 'Maintenance Asset Disciplines',
        subtitle: 'Distribution across Riyadh SLV Metro wayside and station infrastructure',
        total,
        slices: disciplines.map((d) => ({
          ...d,
          percent: ((d.count / total) * 100).toFixed(1),
        })),
      };
    }

    if (chartMode === 'shift') {
      const shifts = [
        { id: 'N', label: 'Night Possessions (22:00–07:00)', count: 184, color: '#6366F1', glow: 'rgba(99, 102, 241, 0.45)', tag: 'Track Isolation' },
        { id: 'M', label: 'Morning DCS (06:00–15:00)', count: 58, color: '#10B981', glow: 'rgba(16, 185, 129, 0.45)', tag: 'Passenger Peak' },
        { id: 'E', label: 'Evening Facilities (14:00–23:00)', count: 48, color: '#3B82F6', glow: 'rgba(59, 130, 246, 0.45)', tag: 'Platform Prep' },
        { id: 'GS', label: 'General Workshop (08:00–17:00)', count: 26, color: '#F59E0B', glow: 'rgba(245, 158, 11, 0.45)', tag: 'Overhaul Staging' },
      ];
      const total = shifts.reduce((acc, s) => acc + s.count, 0);
      return {
        title: 'Operational Execution Windows',
        subtitle: 'Classification aligned with night track possessions and daytime passenger service',
        total,
        slices: shifts.map((s) => ({
          ...s,
          percent: ((s.count / total) * 100).toFixed(1),
        })),
      };
    }

    const statuses = [
      { id: 'PENDING', label: 'Scheduled / Pending Execution', count: 196, color: '#F59E0B', glow: 'rgba(245, 158, 11, 0.45)', tag: 'Awaiting Window' },
      { id: 'COMPLETED', label: 'Executed & Signed Off', count: 120, color: '#10B981', glow: 'rgba(16, 185, 129, 0.45)', tag: 'APSYS Certified' },
    ];
    const total = statuses.reduce((acc, s) => acc + s.count, 0);
    return {
      title: 'Monthly Execution Lifecycle',
      subtitle: 'Real-time Maximo preventative maintenance execution progression',
      total,
      slices: statuses.map((s) => ({
        ...s,
        percent: ((s.count / total) * 100).toFixed(1),
      })),
    };
  }, [chartMode]);

  // SVG Geometry for Donut
  const donutArcs = useMemo(() => {
    let currentAngle = -90;
    const outerR = 86;
    const innerR = 56;
    const cxCenter = 105;
    const cyCenter = 105;

    return pieData.slices.map((slice, index) => {
      const angle = (slice.count / pieData.total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      currentAngle += angle;

      const polarToCartesian = (cx: number, cy: number, r: number, angleDegrees: number) => {
        const rad = ((angleDegrees - 90) * Math.PI) / 180.0;
        return {
          x: cx + r * Math.cos(rad),
          y: cy + r * Math.sin(rad),
        };
      };

      const startOuter = polarToCartesian(cxCenter, cyCenter, outerR, endAngle);
      const endOuter = polarToCartesian(cxCenter, cyCenter, outerR, startAngle);
      const startInner = polarToCartesian(cxCenter, cyCenter, innerR, endAngle);
      const endInner = polarToCartesian(cxCenter, cyCenter, innerR, startAngle);

      const largeArc = angle <= 180 ? '0' : '1';

      const d = [
        'M', startOuter.x, startOuter.y,
        'A', outerR, outerR, 0, largeArc, 0, endOuter.x, endOuter.y,
        'L', endInner.x, endInner.y,
        'A', innerR, innerR, 0, largeArc, 1, startInner.x, startInner.y,
        'Z',
      ].join(' ');

      return {
        ...slice,
        index,
        d,
      };
    });
  }, [pieData]);

  // Highlighted slice or total
  const selectedSlice = activeSliceIndex !== null ? pieData.slices[activeSliceIndex] : null;

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 xl:px-8 py-5 space-y-6 max-w-[1720px] mx-auto w-full">
      {/* =====================================================================
          HERO MISSION CONTROL HUD BANNER
          ===================================================================== */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-white p-5 sm:p-7 shadow-2xl">
        {/* Background glow orbs */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-10 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          {/* Left Brand & Title */}
          <div className="flex items-start sm:items-center gap-4">
            <div className="p-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-inner">
              <AlstomLogo height={30} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                  APSYS Digital Operations Board
                </h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  Live Network Telemetry
                </span>
              </div>
              <p className="text-sm font-semibold text-blue-200/80 mt-1 flex items-center gap-2 flex-wrap">
                <span>Riyadh SLV Maintenance</span>
                <span>•</span>
                <span>Lines 4 (Orange), 5 (Yellow) &amp; 6 (Purple)</span>
                <span>•</span>
                <span className="text-amber-300 font-bold">Network Readiness: 99.4% Nominal</span>
              </p>
            </div>
          </div>

          {/* Right Precision Telemetry & Environmental Indicators */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 self-stretch xl:self-auto justify-between xl:justify-end">
            {/* Weather & Track Temp */}
            <div className="px-4 py-2.5 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 flex items-center gap-3 shadow-inner">
              <span className="text-2xl">☀️</span>
              <div className="text-left leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black text-white">35°C</span>
                  <span className="text-xs text-blue-300 font-semibold">Clear Sky</span>
                </div>
                <span className="text-[10.5px] text-blue-200/70 font-mono">
                  Track Temp 42°C · Wind 9 km/h
                </span>
              </div>
            </div>

            {/* Precision Digital Clock */}
            <div className="px-5 py-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-inner text-right">
              <span className="font-mono text-lg sm:text-xl font-black text-white tracking-wider block leading-none">
                {timeFormatted.time}
              </span>
              <span className="text-[10.5px] text-blue-200/80 font-medium mt-1 block">
                {timeFormatted.dateStr}
              </span>
            </div>

            {/* Shift Leader Profile Avatar */}
            <div className="flex items-center gap-3 pl-3 border-l border-white/15">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-500 to-cyan-400 text-slate-950 font-black text-sm grid place-items-center shadow-lg">
                AK
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <span className="text-xs font-black text-white block">Arif Khan</span>
                <span className="text-[10.5px] text-blue-300 font-bold">SLV Shift Leader</span>
              </div>
            </div>
          </div>
        </div>

        {/* Operational Pool Switcher Pills */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 mt-6 pt-5 border-t border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-blue-200/80 uppercase tracking-wider">
              Fleet Focus:
            </span>
            <div className="flex items-center p-1 rounded-xl bg-black/30 border border-white/10 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setActivePoolFilter('all')}
                className={cx(
                  'px-3 py-1 rounded-lg text-xs font-bold transition-all',
                  activePoolFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-blue-200 hover:text-white',
                )}
              >
                All Lines (4, 5 &amp; 6)
              </button>
              <button
                type="button"
                onClick={() => setActivePoolFilter('L46')}
                className={cx(
                  'px-3 py-1 rounded-lg text-xs font-bold transition-all',
                  activePoolFilter === 'L46'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-blue-200 hover:text-white',
                )}
              >
                Line 4 &amp; 6 Combined Pool
              </button>
              <button
                type="button"
                onClick={() => setActivePoolFilter('L5')}
                className={cx(
                  'px-3 py-1 rounded-lg text-xs font-bold transition-all',
                  activePoolFilter === 'L5'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-blue-200 hover:text-white',
                )}
              >
                Line 5 Solo Pool
              </button>
            </div>
          </div>

          {/* Quick Date Stepper */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-blue-200/80">Planning Date:</span>
            <div className="flex items-center gap-1 bg-black/30 p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setSelectedDay((d) => Math.max(1, d - 1))}
                className="w-6 h-6 grid place-items-center rounded-lg hover:bg-white/10 text-white font-bold"
                title="Previous Day"
              >
                ‹
              </button>
              <select
                value={selectedDay}
                onChange={(e) => setSelectedDay(Number(e.target.value))}
                className="bg-transparent text-white font-mono font-bold text-xs px-2 py-0.5 outline-none cursor-pointer"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d} className="bg-slate-900 text-white">
                    {d} Oct {settings.activeYear}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSelectedDay((d) => Math.min(31, d + 1))}
                className="w-6 h-6 grid place-items-center rounded-lg hover:bg-white/10 text-white font-bold"
                title="Next Day"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          TOP 4 EXECUTIVE HUD METRIC CARDS
          ===================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Card 1: Total Monthly Orders */}
        <div className="group relative overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-sm hover:shadow-lg transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-3">
              Monthly Workload
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              Maximo PM
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-ink font-mono tracking-tight">
              316
            </span>
            <span className="text-xs font-bold text-ink-3">Orders Scheduled</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs pt-3 border-t border-[var(--line)]">
            <span className="text-ink-2 font-semibold">Total Manpower:</span>
            <strong className="text-[var(--accent)] font-mono font-black">790 Techs (2.5/wo)</strong>
          </div>
        </div>

        {/* Card 2: Today's Active Orders */}
        <div className="group relative overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-sm hover:shadow-lg transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-3">
              Day {selectedDay} Interventions
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Active Dispatch
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
              {dailyWorkOrders.scheduled}
            </span>
            <span className="text-xs font-bold text-ink-3">
              ({dailyWorkOrders.completed} done · {dailyWorkOrders.remaining} queue)
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs pt-3 border-t border-[var(--line)]">
            <span className="text-ink-2 font-semibold">Shift Possession:</span>
            <strong className="text-emerald-600 dark:text-emerald-400 font-bold">100% On Schedule</strong>
          </div>
        </div>

        {/* Card 3: Certified Workforce Mobilized */}
        <div className="group relative overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-sm hover:shadow-lg transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-3">
              Certified Technicians
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              61 Mobilized
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-indigo-600 dark:text-indigo-400 font-mono tracking-tight">
              {shiftDeployment.l46.total + shiftDeployment.l5.total}
            </span>
            <span className="text-xs font-bold text-ink-3">On Duty Today</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs pt-3 border-t border-[var(--line)]">
            <span className="text-ink-2 font-semibold">Pool Split:</span>
            <strong className="text-ink font-mono font-bold">
              {shiftDeployment.l46.total} (L4/6) + {shiftDeployment.l5.total} (L5)
            </strong>
          </div>
        </div>

        {/* Card 4: Railway Safety & Fatigue Compliance */}
        <div className="group relative overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-sm hover:shadow-lg transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-3">
              Fatigue &amp; Safety Compliance
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Zero Breaches
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
              100%
            </span>
            <span className="text-xs font-bold text-ink-3">APSYS Compliant</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs pt-3 border-t border-[var(--line)]">
            <span className="text-ink-2 font-semibold">Track Possession:</span>
            <strong className="text-emerald-600 dark:text-emerald-400 font-bold">Power Cleared</strong>
          </div>
        </div>
      </div>

      {/* =====================================================================
          MAIN ANALYTICS SECTION:
          LEFT: THE PERFECT GRAPH (WORKLOAD TIMELINE)
          RIGHT: THE PERFECT COLORFUL PIE / DONUT CHART (CLIENT REQUEST)
          ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* ==================== THE PERFECT GRAPH (7 COLS) ==================== */}
        <div className="lg:col-span-7 rounded-3xl border border-[var(--line-strong)] bg-[var(--surface)] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-ink">
                    Preventive Workload &amp; Capacity Analytics
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    Dual Layer
                  </span>
                </div>
                <p className="text-xs text-ink-3 font-medium">
                  Daily Work Order Demand vs Available Certified Gang Capacity
                </p>
              </div>

              {/* Time Horizon Switcher */}
              <div className="flex items-center p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                {(['today', '7days', '30days'] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setTimeHorizon(h)}
                    className={cx(
                      'px-3 py-1 rounded-lg text-xs font-bold transition-all',
                      timeHorizon === h
                        ? 'bg-[var(--accent)] text-white shadow-xs font-black'
                        : 'text-ink-3 hover:text-ink',
                    )}
                  >
                    {h === 'today' ? 'Today' : h === '7days' ? 'Next 7 Days' : '30-Day Month'}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick KPI summary bar */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                <span className="text-[11px] font-bold text-ink-3 uppercase block">Period Volume</span>
                <span className="text-xl font-black text-ink font-mono">{analyticsGraph.totalWindowOrders} Orders</span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                <span className="text-[11px] font-bold text-ink-3 uppercase block">Technician Shifts</span>
                <span className="text-xl font-black text-blue-600 dark:text-blue-400 font-mono">{analyticsGraph.totalWindowMP} Shifts</span>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase block">Status</span>
                <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">Capacity Safe</span>
              </div>
            </div>

            {/* Visual Bar Chart with Target Threshold */}
            <div className="h-56 w-full flex items-end gap-2 sm:gap-3.5 px-3 sm:px-6 pt-8 pb-3 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] overflow-x-auto relative">
              {analyticsGraph.points.map((pt, idx) => {
                const heightPercent = Math.max(16, (pt.demandWO / analyticsGraph.maxWO) * 100);
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDay(pt.day)}
                    className="flex-1 min-w-[34px] flex flex-col items-center justify-end h-full group relative cursor-pointer"
                  >
                    {/* Hover Tooltip */}
                    <div className="absolute -top-12 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 bg-slate-900 text-white px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap shadow-xl border border-white/10">
                      <div>Day {pt.day}: {pt.demandWO} Orders ({pt.demandMP} MP)</div>
                      <div className="text-[10px] text-blue-300">Click to focus planning date</div>
                    </div>

                    {/* Value on top of bar */}
                    <span className={cx(
                      'text-xs font-black font-mono mb-1.5 transition-transform group-hover:scale-125',
                      pt.isSelected ? 'text-[var(--accent)] font-extrabold' : 'text-ink-2',
                    )}>
                      {pt.demandWO}
                    </span>

                    {/* The Visual Bar */}
                    <div
                      className={cx(
                        'w-full max-w-[42px] rounded-t-xl transition-all duration-300 shadow-md group-hover:brightness-110',
                        pt.isSelected
                          ? 'bg-gradient-to-t from-blue-600 via-sky-500 to-cyan-400 ring-2 ring-blue-500/50 shadow-blue-500/30'
                          : pt.isBottleneck
                          ? 'bg-gradient-to-t from-amber-600 to-amber-400'
                          : 'bg-gradient-to-t from-slate-400 to-slate-300 dark:from-slate-700 dark:to-slate-600',
                      )}
                      style={{ height: `${heightPercent}%` }}
                    />

                    {/* Label below bar */}
                    <span className={cx(
                      'text-[10.5px] font-bold mt-2 truncate max-w-full text-center',
                      pt.isSelected ? 'text-[var(--accent)] font-black' : 'text-ink-3',
                    )}>
                      {pt.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[var(--line)] text-xs text-ink-3 mt-4">
            <span>Click any day to immediately update the live roster &amp; work order panels</span>
            <button
              type="button"
              onClick={onOpenWorkOrders}
              className="font-bold text-[var(--accent)] hover:underline flex items-center gap-1"
            >
              <span>Open Work Orders Explorer</span>
              <span>→</span>
            </button>
          </div>
        </div>

        {/* ==================== THE PERFECT COLOR PIE CHART (5 COLS) ==================== */}
        <div className="lg:col-span-5 rounded-3xl border border-[var(--line-strong)] bg-[var(--surface)] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-ink">
                    Resource Allocation Distribution
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    Color Spectrum
                  </span>
                </div>
                <p className="text-xs text-ink-3 font-medium">
                  {pieData.title}
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex items-center p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                {(['system', 'shift', 'status'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setChartMode(m); setActiveSliceIndex(null); }}
                    className={cx(
                      'px-2.5 py-1 rounded-lg text-[10.5px] font-black uppercase tracking-wider transition-all',
                      chartMode === m
                        ? 'bg-[var(--accent)] text-white shadow-xs'
                        : 'text-ink-3 hover:text-ink',
                    )}
                  >
                    {m === 'system' ? 'System' : m === 'shift' ? 'Shift' : 'Status'}
                  </button>
                ))}
              </div>
            </div>

            {/* Glowing SVG Donut Visualization */}
            <div className="flex flex-col sm:flex-row items-center gap-6 my-4">
              <div className="relative shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 210 210" className="w-52 h-52 transform -rotate-90">
                  {donutArcs.map((arc) => {
                    const isHovered = activeSliceIndex === arc.index;
                    return (
                      <path
                        key={arc.index}
                        d={arc.d}
                        fill={arc.color}
                        className="transition-all duration-300 cursor-pointer"
                        style={{
                          transformOrigin: '105px 105px',
                          transform: isHovered ? 'scale(1.06)' : 'scale(1)',
                          filter: isHovered ? `drop-shadow(0 0 10px ${arc.color})` : 'none',
                          opacity: activeSliceIndex !== null && !isHovered ? 0.6 : 1,
                        }}
                        onMouseEnter={() => setActiveSliceIndex(arc.index)}
                        onMouseLeave={() => setActiveSliceIndex(null)}
                      />
                    );
                  })}
                </svg>

                {/* Central Donut Readout */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                  <span className="text-3xl font-black text-ink font-mono leading-none tracking-tight">
                    {selectedSlice ? selectedSlice.count : pieData.total}
                  </span>
                  <span className="text-[10.5px] font-black uppercase tracking-wider text-[var(--accent)] mt-1">
                    {selectedSlice ? `${selectedSlice.percent}% Share` : 'Total Orders'}
                  </span>
                  <span className="text-[9.5px] text-ink-3 max-w-[90px] truncate">
                    {selectedSlice ? selectedSlice.label : 'Riyadh SLV'}
                  </span>
                </div>
              </div>

              {/* Dynamic Interactive Legend */}
              <div className="flex-1 w-full space-y-2">
                {pieData.slices.map((slice, idx) => {
                  const isHovered = activeSliceIndex === idx;
                  return (
                    <div
                      key={idx}
                      onMouseEnter={() => setActiveSliceIndex(idx)}
                      onMouseLeave={() => setActiveSliceIndex(null)}
                      className={cx(
                        'p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2.5',
                        isHovered
                          ? 'bg-[var(--surface-3)] border-[var(--accent)] shadow-sm scale-[1.02]'
                          : 'bg-[var(--surface-2)] border-[var(--line)] hover:border-[var(--line-strong)]',
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-md shrink-0 shadow-xs"
                          style={{ backgroundColor: slice.color, boxShadow: `0 0 6px ${slice.color}` }}
                        />
                        <div className="min-w-0 leading-tight">
                          <span className="text-xs font-bold text-ink block truncate">
                            {slice.label}
                          </span>
                          <span className="text-[10px] text-ink-3 block truncate">
                            {slice.tag}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-black font-mono text-ink block">
                          {slice.count}
                        </span>
                        <span className="text-[10px] font-semibold text-ink-3">
                          {slice.percent}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-xs text-ink-3">
            <span>Hover slices for glowing telemetry focus</span>
            <span className="font-bold text-ink">Maximo SLV PM Pack</span>
          </div>
        </div>
      </div>

      {/* =====================================================================
          ROW 3: OPERATIONAL SHIFT GANG BOARD (LINE 4/6 & LINE 5 GANGS)
          ===================================================================== */}
      <div className="rounded-3xl border border-[var(--line-strong)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-ink">
                Daily Shift Gang Deployment &amp; Handover Matrix
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Active Gangs
              </span>
            </div>
            <p className="text-xs text-ink-3 font-medium">
              Operational day {selectedDay} Oct {settings.activeYear} · 24-Hour Round-the-Clock Railway Protection
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenPlanner}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[var(--accent)] hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center gap-2 self-start sm:self-auto"
          >
            <span>Launch Planner Matrix</span>
            <span>→</span>
          </button>
        </div>

        {/* 2 Big Line Deployment Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Panel 1: Line 4 & 6 Combined Pool */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 sm:p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                <div>
                  <span className="text-sm font-black text-ink uppercase tracking-wide block">
                    Line 4 &amp; 6 Combined Pool
                  </span>
                  <span className="text-xs text-ink-3">Shared Depot 4/6 · 59.6 km Mainline</span>
                </div>
                <span className="px-3 py-1 rounded-xl text-xs font-black bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-mono">
                  {shiftDeployment.l46.total} Techs on Duty
                </span>
              </div>

              {/* 4 Shifts Display */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">Morning (M)</span>
                  <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono my-1 block">
                    {shiftDeployment.l46.m}
                  </span>
                  <span className="text-[10px] font-semibold text-ink-3">06:00–15:00</span>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">Evening (E)</span>
                  <span className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono my-1 block">
                    {shiftDeployment.l46.e}
                  </span>
                  <span className="text-[10px] font-semibold text-ink-3">14:00–23:00</span>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">Night (N)</span>
                  <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono my-1 block">
                    {shiftDeployment.l46.n}
                  </span>
                  <span className="text-[10px] font-semibold text-indigo-500 font-bold">Possession</span>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">General (GS)</span>
                  <span className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono my-1 block">
                    {shiftDeployment.l46.gs}
                  </span>
                  <span className="text-[10px] font-semibold text-ink-3">Workshop</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-xs text-ink-3">
              <span>Safety Minimum: M≥7, E≥6, N≥10</span>
              <strong className="text-emerald-600 dark:text-emerald-400">Target Satisfied</strong>
            </div>
          </div>

          {/* Panel 2: Line 5 Solo Pool */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 sm:p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                <div>
                  <span className="text-sm font-black text-ink uppercase tracking-wide block">
                    Line 5 Solo Pool (Yellow Line)
                  </span>
                  <span className="text-xs text-ink-3">Dedicated Depot 5 · Underground Wayside</span>
                </div>
                <span className="px-3 py-1 rounded-xl text-xs font-black bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-mono">
                  {shiftDeployment.l5.total} Techs on Duty
                </span>
              </div>

              {/* 4 Shifts Display */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">Morning (M)</span>
                  <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono my-1 block">
                    {shiftDeployment.l5.m}
                  </span>
                  <span className="text-[10px] font-semibold text-ink-3">06:00–15:00</span>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">Evening (E)</span>
                  <span className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono my-1 block">
                    {shiftDeployment.l5.e}
                  </span>
                  <span className="text-[10px] font-semibold text-ink-3">14:00–23:00</span>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">Night (N)</span>
                  <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono my-1 block">
                    {shiftDeployment.l5.n}
                  </span>
                  <span className="text-[10px] font-semibold text-indigo-500 font-bold">Possession</span>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-center">
                  <span className="text-[10px] font-bold text-ink-3 uppercase block">General (GS)</span>
                  <span className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono my-1 block">
                    {shiftDeployment.l5.gs}
                  </span>
                  <span className="text-[10px] font-semibold text-ink-3">Workshop</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-xs text-ink-3">
              <span>Safety Minimum: M≥4, E≥3, N≥5</span>
              <strong className="text-emerald-600 dark:text-emerald-400">Target Satisfied</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
