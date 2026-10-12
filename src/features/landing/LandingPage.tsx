import { motion, useScroll, type Variants } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { AlstomLogo } from '@/components/AlstomLogo';
import { getSettings, patchSettings } from '@/data/db';

/* ==========================================================================
   THEME DEFINITIONS & COLOR TOKENS (LIGHT & DARK ENTERPRISE SAAS PALETTES)
   Tailored for ShiftLine: metro signalling & communication roster planning.
   ========================================================================== */

type Theme = 'light' | 'dark';

const PALETTES: Record<Theme, Record<string, string>> = {
  light: {
    '--bg-main': '#F8FAFC',
    '--bg-surface': '#FFFFFF',
    '--bg-surface-subtle': '#F1F5F9',
    '--bg-card': '#FFFFFF',
    '--bg-card-hover': '#F8FAFC',
    '--bg-card-elevated': '#FFFFFF',
    '--bg-hero': 'linear-gradient(180deg, #EFF6FF 0%, #F8FAFC 100%)',
    '--bg-cta-banner': 'linear-gradient(135deg, #1E40AF 0%, #1D4ED8 50%, #2563EB 100%)',
    '--text-primary': '#0F172A',
    '--text-secondary': '#475569',
    '--text-muted': '#64748B',
    '--text-subtle': '#94A3B8',
    '--brand-primary': '#1D4ED8',
    '--brand-primary-hover': '#1E40AF',
    '--brand-accent': '#2563EB',
    '--brand-accent-subtle': '#DBEAFE',
    '--brand-gradient': 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 50%, #3B82F6 100%)',
    '--border-subtle': '#E2E8F0',
    '--border-medium': '#CBD5E1',
    '--border-strong': '#94A3B8',
    '--nav-glass': 'rgba(255, 255, 255, 0.92)',
    '--badge-bg': '#DBEAFE',
    '--badge-text': '#1E40AF',
    '--badge-border': '#BFDBFE',
    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
    '--shadow-lg': '0 10px 25px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04)',
    '--shadow-xl': '0 20px 35px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
    '--shadow-glow': '0 12px 30px -10px rgba(37, 99, 235, 0.35)',
    // Shift chips
    '--chip-m-bg': '#FEF3C7',
    '--chip-m-fg': '#92400E',
    '--chip-e-bg': '#CCFBF1',
    '--chip-e-fg': '#0F766E',
    '--chip-n-bg': '#EDE9FE',
    '--chip-n-fg': '#5B21B6',
    '--chip-ml-bg': '#FDE68A',
    '--chip-ml-fg': '#78350F',
    '--chip-nl-bg': '#DDD6FE',
    '--chip-nl-fg': '#4C1D95',
    '--chip-lv-bg': '#FEE2E2',
    '--chip-lv-fg': '#B91C1C',
    '--chip-off-bg': '#F1F5F9',
    '--chip-off-fg': '#64748B',
    '--alert-red': '#DC2626',
    '--alert-red-bg': '#FEF2F2',
    '--alert-green': '#16A34A',
    '--alert-green-bg': '#F0FDF4',
    '--alert-amber': '#B45309',
    '--alert-amber-bg': '#FFFBEB',
    '--chip-gs-bg': '#DCFCE7',
    '--chip-gs-fg': '#166534',
    '--chip-el-bg': '#CCFBF1',
    '--chip-el-fg': '#115E59',
  },
  dark: {
    '--bg-main': '#0B0F19',
    '--bg-surface': '#111827',
    '--bg-surface-subtle': '#1F2937',
    '--bg-card': '#111827',
    '--bg-card-hover': '#1F2937',
    '--bg-card-elevated': '#1E293B',
    '--bg-hero': 'linear-gradient(180deg, #0F172A 0%, #0B0F19 100%)',
    '--bg-cta-banner': 'linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 50%, #2563EB 100%)',
    '--text-primary': '#F8FAFC',
    '--text-secondary': '#CBD5E1',
    '--text-muted': '#94A3B8',
    '--text-subtle': '#64748B',
    '--brand-primary': '#3B82F6',
    '--brand-primary-hover': '#60A5FA',
    '--brand-accent': '#60A5FA',
    '--brand-accent-subtle': 'rgba(59, 130, 246, 0.15)',
    '--brand-gradient': 'linear-gradient(135deg, #3B82F6 0%, #60A5FA 50%, #93C5FD 100%)',
    '--border-subtle': 'rgba(255, 255, 255, 0.08)',
    '--border-medium': 'rgba(255, 255, 255, 0.16)',
    '--border-strong': 'rgba(255, 255, 255, 0.28)',
    '--nav-glass': 'rgba(11, 15, 25, 0.88)',
    '--badge-bg': 'rgba(59, 130, 246, 0.15)',
    '--badge-text': '#93C5FD',
    '--badge-border': 'rgba(59, 130, 246, 0.3)',
    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
    '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
    '--shadow-lg': '0 10px 25px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.4)',
    '--shadow-xl': '0 20px 35px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
    '--shadow-glow': '0 12px 30px -10px rgba(59, 130, 246, 0.35)',
    // Shift chips
    '--chip-m-bg': '#3D2A08',
    '--chip-m-fg': '#FBBF24',
    '--chip-e-bg': '#0F3836',
    '--chip-e-fg': '#2DD4BF',
    '--chip-n-bg': '#2E1065',
    '--chip-n-fg': '#C4B5FD',
    '--chip-ml-bg': '#452A05',
    '--chip-ml-fg': '#FCD34D',
    '--chip-nl-bg': '#3B0764',
    '--chip-nl-fg': '#D8B4FE',
    '--chip-lv-bg': '#4C0519',
    '--chip-lv-fg': '#FDA4AF',
    '--chip-off-bg': 'rgba(255, 255, 255, 0.05)',
    '--chip-off-fg': '#64748B',
    '--alert-red': '#F87171',
    '--alert-red-bg': 'rgba(239, 68, 68, 0.15)',
    '--alert-green': '#4ADE80',
    '--alert-green-bg': 'rgba(34, 197, 94, 0.15)',
    '--alert-amber': '#FBBF24',
    '--alert-amber-bg': 'rgba(245, 158, 11, 0.15)',
    '--chip-gs-bg': '#0B3B24',
    '--chip-gs-fg': '#4ADE80',
    '--chip-el-bg': '#0D3F3B',
    '--chip-el-fg': '#5EEAD4',
  },
};

const THEME_KEY = 'shiftline-theme';

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  const fromDoc = document.documentElement.dataset.theme;
  return fromDoc === 'light' ? 'light' : 'dark';
}

/* ==========================================================================
   DEMO DATA (mirrors the real app: Lines 4/5/6, shift codes, work orders)
   ========================================================================== */

type ShiftGroup = 'M' | 'E' | 'N';
type LineId = 'line4' | 'line5' | 'line6';

const SHIFT_TOKENS: Record<string, { bg: string; fg: string; label: string; timing: string; group?: ShiftGroup }> = {
  M: { bg: 'var(--chip-m-bg)', fg: 'var(--chip-m-fg)', label: 'Morning', timing: '06:00 – 15:00', group: 'M' },
  E: { bg: 'var(--chip-e-bg)', fg: 'var(--chip-e-fg)', label: 'Evening', timing: '14:00 – 23:00', group: 'E' },
  N: { bg: 'var(--chip-n-bg)', fg: 'var(--chip-n-fg)', label: 'Night', timing: '22:00 – 07:00', group: 'N' },
  ML: { bg: 'var(--chip-ml-bg)', fg: 'var(--chip-ml-fg)', label: 'Morning Late', timing: '07:00 – 18:00', group: 'M' },
  EL: { bg: 'var(--chip-el-bg)', fg: 'var(--chip-el-fg)', label: 'Evening Late', timing: '15:00 – 00:00', group: 'E' },
  NL: { bg: 'var(--chip-nl-bg)', fg: 'var(--chip-nl-fg)', label: 'Night Late', timing: '19:00 – 07:00', group: 'N' },
  GS: { bg: 'var(--chip-gs-bg)', fg: 'var(--chip-gs-fg)', label: 'General Shift', timing: '08:00 – 17:00' },
  LV: { bg: 'var(--chip-lv-bg)', fg: 'var(--chip-lv-fg)', label: 'Leave', timing: '—' },
  '-': { bg: 'var(--chip-off-bg)', fg: 'var(--chip-off-fg)', label: 'Rest Day', timing: '—' },
};

const BRUSH_OPTIONS = ['M', 'E', 'N', 'ML', 'EL', 'NL', 'GS', 'LV', '-'] as const;
const WORKED = new Set(['M', 'E', 'N', 'ML', 'EL', 'NL', 'GS']);
const GROUPS: ShiftGroup[] = ['M', 'E', 'N'];
const GROUP_LABEL: Record<ShiftGroup, string> = { M: 'Morning', E: 'Evening', N: 'Night' };
const DEMO_DAYS = 14;
const MAX_STRAIGHT = 6;

// October 2026 starts on a Thursday
const DAY_LABELS = Array.from({ length: DEMO_DAYS }, (_, i) => {
  const d = new Date(2026, 9, i + 1);
  return { num: i + 1, wd: d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2) };
});

const codes = (row: string) => row.trim().split(/\s+/);

const DEMO_LINES: Record<LineId, { label: string; crew: { name: string; role: string; codes: string[] }[] }> = {
  line5: {
    label: 'Line 5',
    crew: [
      { name: 'Zouhair Azzabi', role: 'PIC · Lead', codes: codes('M M M M ML - - M M M M M - -') },
      { name: 'Wesam B', role: 'MP · Engineer', codes: codes('E E E E E - - E E EL E E - -') },
      { name: 'Sher Khan', role: 'PIC · Lead', codes: codes('N N N N N - - N N N N NL - -') },
      { name: 'Ajay Pal', role: 'MP · Engineer', codes: codes('- - LV LV M M M - - M M M M M') },
      { name: 'John Paul', role: 'MP · Engineer', codes: codes('- - E E E E E - - E E E E E') },
      { name: 'Srinivasa Rao', role: 'PIC · Lead', codes: codes('- - N N N N N - - N N N N N') },
    ],
  },
  line4: {
    label: 'Line 4',
    crew: [
      { name: 'Imran Siddiqui', role: 'PIC · Lead', codes: codes('M M M - - M M M M M - - M M') },
      { name: 'Faisal Noor', role: 'MP · Engineer', codes: codes('E E E - - E E E E E - - E E') },
      { name: 'Rakesh Menon', role: 'MP · Engineer', codes: codes('N N N - - N N N N N - - N N') },
      { name: 'Omar Haddad', role: 'PIC · Lead', codes: codes('GS - - M M M M - - M M M M -') },
      { name: 'Vijay Kumar', role: 'MP · Engineer', codes: codes('E - - E E E E - - E E E E -') },
      { name: 'Tariq Aziz', role: 'MP · Engineer', codes: codes('N - - N N N N - - N N N N -') },
    ],
  },
  line6: {
    label: 'Line 6',
    crew: [
      { name: 'Hasnain Ali', role: 'PIC · Lead', codes: codes('M - - M M M ML M - - M M M M') },
      { name: 'Arif Khan', role: 'MP · Engineer', codes: codes('E - - E E E E E - - E E E E') },
      { name: 'Latif Rahman', role: 'MP · Engineer', codes: codes('N - - N N N N N - - N N N N') },
      { name: 'Naveed Iqbal', role: 'PIC · Lead', codes: codes('M M M - - M M M M M - - LV LV') },
      { name: 'Samir Fares', role: 'MP · Engineer', codes: codes('E E E - - E E E E E - - E E') },
      { name: 'Deepak Nair', role: 'MP · Engineer', codes: codes('N N N - - N N N N N - - N N') },
    ],
  },
};

interface DemoWorkOrder {
  id: string;
  desc: string;
  type: 'PM' | 'CM' | 'ACS';
  line: LineId;
  day: number;
  shift: ShiftGroup;
  crew: number;
}

const DEMO_WORK_ORDERS: DemoWorkOrder[] = [
  { id: '13445509', desc: 'Point machine PM — depot turnout 12', type: 'PM', line: 'line5', day: 3, shift: 'M', crew: 2 },
  { id: '13445517', desc: 'Axle counter reset fault — section 5B', type: 'CM', line: 'line5', day: 3, shift: 'E', crew: 1 },
  { id: '13445522', desc: 'Interlocking cabinet cleaning', type: 'PM', line: 'line5', day: 3, shift: 'N', crew: 2 },
  { id: '13445530', desc: 'Platform CCTV camera inspection', type: 'ACS', line: 'line5', day: 4, shift: 'E', crew: 1 },
  { id: '13445541', desc: 'Radio base station quarterly PM', type: 'PM', line: 'line5', day: 9, shift: 'N', crew: 1 },
  { id: '13446102', desc: 'Signal lamp replacement — S4-17', type: 'CM', line: 'line4', day: 1, shift: 'M', crew: 1 },
  { id: '13446110', desc: 'Track circuit fault investigation', type: 'CM', line: 'line4', day: 1, shift: 'N', crew: 2 },
  { id: '13446125', desc: 'Point machine PM — crossover 4C', type: 'PM', line: 'line4', day: 6, shift: 'M', crew: 2 },
  { id: '13446131', desc: 'PIS display fault — station 407', type: 'CM', line: 'line4', day: 6, shift: 'E', crew: 1 },
  { id: '13447201', desc: 'SCADA panel functional test', type: 'ACS', line: 'line6', day: 6, shift: 'M', crew: 2 },
  { id: '13447214', desc: 'Balise inspection — mainline 6A', type: 'PM', line: 'line6', day: 6, shift: 'N', crew: 1 },
  { id: '13447220', desc: 'Telephone exchange fault', type: 'CM', line: 'line6', day: 13, shift: 'E', crew: 1 },
];

type AllocStatus = 'OK' | 'SHORT' | 'UNASSIGNED';

/** Same greedy idea as the app: fill each work order from staff on that day & shift, no double-booking. */
function allocate(grid: string[][], crew: { name: string }[], orders: DemoWorkOrder[], crewOverride: Record<string, number>) {
  const busy = new Set<string>();
  return orders.map((wo) => {
    const needed = crewOverride[wo.id] ?? wo.crew;
    const free: string[] = [];
    grid.forEach((row, r) => {
      const code = row[wo.day - 1];
      const key = `${r}-${wo.day}-${wo.shift}`;
      if (SHIFT_TOKENS[code]?.group === wo.shift && !busy.has(key)) free.push(String(r));
    });
    const picked = free.slice(0, needed);
    picked.forEach((r) => busy.add(`${r}-${wo.day}-${wo.shift}`));
    const status: AllocStatus = picked.length >= needed ? 'OK' : picked.length > 0 ? 'SHORT' : 'UNASSIGNED';
    return { wo, needed, names: picked.map((r) => crew[Number(r)].name), status };
  });
}

/** Rule checks matching the planner: night→morning gap, empty shifts, too many days straight. */
function checkRules(grid: string[][], crew: { name: string }[]) {
  const flagged = new Set<string>();
  const issues: string[] = [];
  grid.forEach((row, r) => {
    let streak = 0;
    row.forEach((code, d) => {
      const next = row[d + 1];
      if (next && SHIFT_TOKENS[code]?.group === 'N' && SHIFT_TOKENS[next]?.group === 'M') {
        flagged.add(`${r}-${d + 1}`);
        issues.push(`${crew[r].name}: night on day ${d + 1} then morning on day ${d + 2} — no rest gap.`);
      }
      streak = WORKED.has(code) ? streak + 1 : 0;
      if (streak === MAX_STRAIGHT + 1) {
        flagged.add(`${r}-${d}`);
        issues.push(`${crew[r].name} works ${MAX_STRAIGHT + 1}+ days straight ending day ${d + 1}.`);
      }
    });
  });
  const coverage = DAY_LABELS.map((_, d) => {
    const c: Record<ShiftGroup, number> = { M: 0, E: 0, N: 0 };
    grid.forEach((row) => {
      const g = SHIFT_TOKENS[row[d]]?.group;
      if (g) c[g] += 1;
    });
    GROUPS.forEach((g) => {
      if (c[g] === 0) issues.push(`Day ${d + 1}: nobody is on ${GROUP_LABEL[g]}.`);
    });
    return c;
  });
  return { flagged, issues, coverage };
}

/* ==========================================================================
   ANIMATION HELPERS
   ========================================================================== */

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] },
  }),
};

function SectionReveal({
  children,
  delayIndex = 0,
  className = '',
}: {
  children: ReactNode;
  delayIndex?: number;
  className?: string;
}) {
  return (
    <motion.div
      variants={fadeInUp}
      custom={delayIndex}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-30px' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function ArrowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--alert-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ==========================================================================
   MAIN LANDING PAGE (HERO + FOOTER)
   ========================================================================== */

export function LandingPage({ onOpen }: { onOpen: () => void }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Synchronize theme with database settings
  useEffect(() => {
    let unmounted = false;
    getSettings()
      .then((settings) => {
        if (!unmounted && (settings.theme === 'light' || settings.theme === 'dark')) {
          setTheme(settings.theme);
        }
      })
      .catch(() => undefined);
    return () => {
      unmounted = true;
    };
  }, []);

  const handleToggleTheme = () => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = nextTheme;
    patchSettings({ theme: nextTheme }).catch(() => undefined);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const { scrollY } = useScroll({ container: scrollContainerRef });
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    return scrollY.on('change', (latest) => {
      setIsScrolled(latest > 20);
    });
  }, [scrollY]);

  const pageContainerStyles = useMemo<CSSProperties>(() => {
    return {
      ...PALETTES[theme],
      backgroundColor: 'var(--bg-main)',
      color: 'var(--text-primary)',
      fontFamily: "'Poppins', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      colorScheme: theme,
    };
  }, [theme]);

  return (
    <div
      ref={scrollContainerRef}
      className="fixed inset-0 overflow-y-auto overflow-x-hidden selection:bg-blue-500 selection:text-white"
      style={pageContainerStyles}
    >
      {/* NAVBAR */}
      <nav
        className={`sticky top-0 z-50 transition-all duration-300 ${
          isScrolled ? 'border-b border-[var(--border-subtle)] shadow-[var(--shadow-sm)]' : 'border-b border-transparent'
        }`}
        style={{ backgroundColor: isScrolled ? 'var(--nav-glass)' : 'transparent', backdropFilter: 'blur(16px)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-3">
          <button
            onClick={() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-2 sm:gap-4 group focus:outline-none min-w-0"
            aria-label="ALSTOM ShiftLine — back to top"
          >
            {/* Client brand */}
            <span className="sm:hidden"><AlstomLogo height={12} /></span>
            <span className="hidden sm:inline-flex group-hover:scale-[1.03] transition-transform"><AlstomLogo height={19} /></span>
            <span className="h-6 sm:h-9 w-px bg-[var(--border-medium)] shrink-0" aria-hidden />
            <span className="flex flex-col text-left min-w-0">
              <span className="text-base sm:text-xl font-black tracking-tight text-[var(--text-primary)] leading-tight">ShiftLine</span>
              <span className="text-[10.5px] font-semibold tracking-wide uppercase text-[var(--text-muted)] truncate hidden sm:block">
                Roster &amp; Work-Order Planning
              </span>
            </span>
          </button>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              onClick={handleToggleTheme}
              aria-label="Toggle theme"
              className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-all shadow-sm"
              title="Toggle Light/Dark Theme"
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button
              onClick={onOpen}
              aria-label="Launch Roster Platform"
              className="inline-flex items-center gap-2 px-3 min-[420px]:px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-sm font-extrabold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 shadow-lg shadow-indigo-500/25 border border-indigo-400/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span className="hidden sm:inline">Launch Roster Platform</span>
              <span className="hidden min-[420px]:inline sm:hidden">Launch</span>
              <ArrowIcon />
            </button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-[calc(100vh-4rem)] pt-10 pb-16 sm:pt-16 sm:pb-20 overflow-hidden bg-[var(--bg-hero)]">
        <div className="absolute inset-0 pointer-events-none -z-0 opacity-30">
          <div className="absolute top-10 left-[8%] w-96 h-96 bg-blue-500/30 rounded-full blur-[130px]" />
          <div className="absolute top-24 right-[8%] w-96 h-96 bg-violet-500/30 rounded-full blur-[140px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <SectionReveal delayIndex={0}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] sm:text-xs font-bold tracking-wide uppercase bg-[var(--badge-bg)] text-[var(--badge-text)] border border-[var(--badge-border)] shadow-sm">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75" />
                <span className="relative w-2 h-2 rounded-full bg-blue-500" />
              </span>
              <span>ShiftLine · Lines 4, 5 &amp; 6 · Roster + Work Orders</span>
            </div>
          </SectionReveal>

          <SectionReveal delayIndex={1}>
            <h1 className="mt-6 text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-[var(--text-primary)] max-w-5xl mx-auto leading-[1.1]">
              Signalling and Communication System &amp;{' '}
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'var(--brand-gradient)' }}>
                Roster Planning
              </span>
            </h1>
          </SectionReveal>

          <SectionReveal delayIndex={2}>
            <p className="mt-6 text-base sm:text-xl text-[var(--text-secondary)] max-w-3xl mx-auto leading-relaxed">
              Plan 24/7 Morning, Evening and Night rosters for every line, generate and rotate whole months from each
              engineer&apos;s rules, and allocate maintenance work orders to the people actually on shift — with live
              shift-buffer checks and secure, personal access links for your team.
            </p>
          </SectionReveal>

          <SectionReveal delayIndex={3}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={onOpen}
                className="px-7 sm:px-8 py-3.5 sm:py-4 rounded-xl text-base font-extrabold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 shadow-xl shadow-indigo-600/25 transition-all hover:scale-[1.03] active:scale-[0.98] inline-flex items-center gap-3 border border-indigo-400/30"
              >
                <span>Launch Live Roster Platform</span>
                <ArrowIcon size={18} />
              </button>
            </div>
          </SectionReveal>

          <SectionReveal delayIndex={4}>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs sm:text-sm font-semibold text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5"><CheckIcon />Works offline — saved in your browser</span>
              <span className="flex items-center gap-1.5"><CheckIcon />Excel import &amp; export</span>
              <span className="flex items-center gap-1.5"><CheckIcon />Personal password links &amp; live alerts</span>
            </div>
          </SectionReveal>

          <SectionReveal delayIndex={5}>
            <div className="mt-12 max-w-6xl mx-auto">
              <HeroShowcase onLaunch={onOpen} />
            </div>
          </SectionReveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10 text-left">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3.5">
              <AlstomLogo height={17} />
              <span className="h-8 w-px bg-[var(--border-medium)]" aria-hidden />
              <div className="leading-tight">
                <div className="text-lg font-black tracking-tight text-[var(--text-primary)]">ShiftLine</div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Roster &amp; Work-Order Planning
                </div>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--text-secondary)] max-w-sm">
              Signalling and communication roster planning for Lines 4, 5 &amp; 6 — shifts, rest rules, leave and
              work-order manpower allocation in one place.
            </p>
          </div>

          {/* Workspaces */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-primary)]">Workspaces</h4>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              {[
                ['Planner', 'Roster, rules & insights'],
                ['Work Orders', 'Allocation & shift buffer'],
                ['People', 'Shifts, rest days, rotation'],
                ['Setup', 'Codes, lines & security'],
              ].map(([name, hint]) => (
                <li key={name}>
                  <button onClick={onOpen} className="group text-left">
                    <span className="block font-semibold text-[var(--text-secondary)] group-hover:text-[var(--brand-primary)] transition-colors">
                      {name}
                    </span>
                    <span className="block text-[11.5px] text-[var(--text-muted)]">{hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Shift legend */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-primary)]">Shifts</h4>
            <ul className="mt-4 space-y-2.5">
              {(['M', 'E', 'N', 'GS'] as const).map((code) => {
                const t = SHIFT_TOKENS[code];
                return (
                  <li key={code} className="flex items-center gap-2.5 text-[13px]">
                    <span className="w-9 py-0.5 rounded-md text-center text-[11px] font-bold" style={{ backgroundColor: t.bg, color: t.fg }}>
                      {code}
                    </span>
                    <span className="text-[var(--text-secondary)] font-medium">{t.label}</span>
                    <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">{t.timing}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Get started */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-primary)]">Get started</h4>
            <p className="mt-4 text-[13px] text-[var(--text-secondary)] leading-relaxed">
              Sign in with your supervisor password or the personal link you were given.
            </p>
            <button
              onClick={onOpen}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-extrabold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Launch Roster Platform
              <ArrowIcon size={14} />
            </button>
            <button
              onClick={handleToggleTheme}
              className="mt-3 block text-[12px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Switch to {theme === 'dark' ? 'light' : 'dark'} mode
            </button>
          </div>
        </div>

        <div className="border-t border-[var(--border-subtle)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-[11.5px] text-[var(--text-muted)] text-center md:text-left">
            <span>&copy; {new Date().getFullYear()} ShiftLine · Signalling and Communication System &amp; Roster Planning</span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--alert-green)]" />
              Local-first · Works offline · Data stays in your browser
            </span>
            <span className="font-semibold text-[var(--text-secondary)]">
              Built by TimeGlobal
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: 'green' | 'red' | 'amber' | 'blue'; children: ReactNode }) {
  const map = {
    green: ['var(--alert-green)', 'var(--alert-green-bg)'],
    red: ['var(--alert-red)', 'var(--alert-red-bg)'],
    amber: ['var(--alert-amber)', 'var(--alert-amber-bg)'],
    blue: ['var(--badge-text)', 'var(--badge-bg)'],
  }[tone];
  return (
    <span
      className="px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap"
      style={{ color: map[0], backgroundColor: map[1], borderColor: 'color-mix(in srgb, currentColor 30%, transparent)' }}
    >
      {children}
    </span>
  );
}

/* ==========================================================================
   HERO SHOWCASE — linked Roster Planner + Work Order Allocation demo
   ========================================================================== */

function initialGrids(): Record<LineId, string[][]> {
  return {
    line4: DEMO_LINES.line4.crew.map((c) => [...c.codes]),
    line5: DEMO_LINES.line5.crew.map((c) => [...c.codes]),
    line6: DEMO_LINES.line6.crew.map((c) => [...c.codes]),
  };
}

function HeroShowcase({ onLaunch }: { onLaunch: () => void }) {
  const [view, setView] = useState<'roster' | 'orders'>('roster');
  const [line, setLine] = useState<LineId>('line5');
  const [grids, setGrids] = useState<Record<LineId, string[][]>>(initialGrids);
  const [crewOverride, setCrewOverride] = useState<Record<string, number>>({});
  const [selectedBrush, setSelectedBrush] = useState<string>('M');
  const [selectedDay, setSelectedDay] = useState<number>(3);
  const isMouseDownRef = useRef(false);

  const crew = DEMO_LINES[line].crew;
  const grid = grids[line];
  const lineOrders = useMemo(() => DEMO_WORK_ORDERS.filter((w) => w.line === line), [line]);

  const rules = useMemo(() => checkRules(grid, crew), [grid, crew]);
  const allocations = useMemo(() => allocate(grid, crew, lineOrders, crewOverride), [grid, crew, lineOrders, crewOverride]);
  const fullyStaffed = allocations.filter((a) => a.status === 'OK').length;

  const changeLine = (next: LineId) => {
    setLine(next);
    const first = DEMO_WORK_ORDERS.find((w) => w.line === next);
    if (first) setSelectedDay(first.day);
  };

  const applyBrush = useCallback(
    (rowIdx: number, dayIdx: number) => {
      setGrids((current) => {
        if (current[line][rowIdx][dayIdx] === selectedBrush) return current;
        const nextGrid = current[line].map((r) => [...r]);
        nextGrid[rowIdx][dayIdx] = selectedBrush;
        return { ...current, [line]: nextGrid };
      });
    },
    [line, selectedBrush],
  );

  useEffect(() => {
    const up = () => {
      isMouseDownRef.current = false;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const handleReset = () => {
    setGrids((g) => ({ ...g, [line]: initialGrids()[line] }));
    setCrewOverride({});
  };

  const tabBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-md text-[12px] font-bold transition-all ${
      active ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
    }`;

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-xl)] text-left">
      {/* Window chrome + controls */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-3 h-3 rounded-full bg-red-400" />
          <span className="w-3 h-3 rounded-full bg-amber-400" />
          <span className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 flex items-center gap-2 font-mono text-xs font-bold text-[var(--text-muted)] truncate">
            <AlstomLogo height={9} /> ShiftLine · {DEMO_LINES[line].label} · October 2026
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-surface-subtle)] border border-[var(--border-subtle)]" role="tablist" aria-label="Demo view">
            <button role="tab" aria-selected={view === 'roster'} className={tabBtn(view === 'roster')} onClick={() => setView('roster')}>
              Roster Planner
            </button>
            <button role="tab" aria-selected={view === 'orders'} className={tabBtn(view === 'orders')} onClick={() => setView('orders')}>
              Work Orders
            </button>
          </div>
          <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-surface-subtle)] border border-[var(--border-subtle)]" aria-label="Line">
            {(['line4', 'line5', 'line6'] as LineId[]).map((id) => (
              <button key={id} className={tabBtn(line === id)} onClick={() => changeLine(id)}>
                {DEMO_LINES[id].label.replace('Line ', 'L')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Status strip */}
      <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] flex flex-wrap items-center gap-2">
        <StatusPill tone={rules.issues.length ? 'red' : 'green'}>
          {rules.issues.length ? `⚠ ${rules.issues.length} rule issue${rules.issues.length > 1 ? 's' : ''}` : '✓ All shift rules satisfied'}
        </StatusPill>
        <StatusPill tone={fullyStaffed === allocations.length ? 'green' : 'amber'}>
          {fullyStaffed}/{allocations.length} work orders fully staffed
        </StatusPill>
        <StatusPill tone="blue">{crew.length} engineers</StatusPill>
        <button
          type="button"
          onClick={handleReset}
          className="ml-auto px-2.5 py-1 rounded-lg text-[11.5px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition-colors"
        >
          Reset demo
        </button>
      </div>

      {view === 'roster' ? (
        <>
          {/* Brush toolbar */}
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mr-1">Brush</span>
            {BRUSH_OPTIONS.map((code) => {
              const token = SHIFT_TOKENS[code];
              const isSelected = selectedBrush === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setSelectedBrush(code)}
                  title={`${token.label} ${token.timing !== '—' ? `(${token.timing})` : ''}`}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                    isSelected ? 'ring-2 ring-blue-500 scale-105 border-transparent' : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                  }`}
                  style={{ backgroundColor: token.bg, color: token.fg }}
                >
                  <span>{code === '-' ? 'RD' : code}</span>
                  <span className="text-[10px] opacity-75 font-medium hidden md:inline">{token.label}</span>
                </button>
              );
            })}
          </div>

          {/* Grid */}
          <div className="p-4 overflow-x-auto select-none" onPointerLeave={() => (isMouseDownRef.current = false)}>
            <div className="min-w-[760px]">
              <DemoRow label={<span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Engineer</span>}>
                {DAY_LABELS.map((d) => (
                  <span key={d.num} className="text-center leading-tight">
                    <span className="block text-[11px] font-bold font-mono text-[var(--text-primary)]">{d.num}</span>
                    <span className={`block text-[9.5px] font-semibold ${d.wd === 'Fr' || d.wd === 'Sa' ? 'text-[var(--brand-primary)]' : 'text-[var(--text-subtle)]'}`}>{d.wd}</span>
                  </span>
                ))}
              </DemoRow>
              <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)] my-1">
                {crew.map((emp, r) => (
                  <DemoRow
                    key={emp.name}
                    label={
                      <>
                        <div className="font-bold text-xs text-[var(--text-primary)] truncate">{emp.name}</div>
                        <div className="text-[10px] text-[var(--text-muted)] truncate">{emp.role}</div>
                      </>
                    }
                  >
                    {grid[r].map((code, d) => {
                      const token = SHIFT_TOKENS[code] ?? SHIFT_TOKENS['-'];
                      const bad = rules.flagged.has(`${r}-${d}`);
                      return (
                        <button
                          key={d}
                          type="button"
                          onPointerDown={() => {
                            isMouseDownRef.current = true;
                            applyBrush(r, d);
                          }}
                          onPointerEnter={() => {
                            if (isMouseDownRef.current) applyBrush(r, d);
                          }}
                          className={`h-8 rounded-md font-bold text-[11px] flex items-center justify-center transition-all ${bad ? 'ring-2 ring-red-500 scale-105' : 'hover:opacity-85'}`}
                          style={{ backgroundColor: token.bg, color: token.fg }}
                          title={`${emp.name} · ${d + 1} Oct: ${token.label}${token.timing !== '—' ? ` (${token.timing})` : ''}`}
                        >
                          {code === '-' ? '·' : code}
                        </button>
                      );
                    })}
                  </DemoRow>
                ))}
              </div>
              {GROUPS.map((g) => (
                <DemoRow key={g} label={<span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: SHIFT_TOKENS[g].fg }}>{GROUP_LABEL[g]} on duty</span>} dense>
                  {rules.coverage.map((c, d) => (
                    <span
                      key={d}
                      className="text-center text-[11px] font-mono font-bold rounded py-0.5"
                      style={c[g] === 0 ? { color: 'var(--alert-red)', backgroundColor: 'var(--alert-red-bg)' } : { color: 'var(--text-secondary)' }}
                    >
                      {c[g]}
                    </span>
                  ))}
                </DemoRow>
              ))}
            </div>
          </div>

          {rules.issues.length > 0 && (
            <ul className="mx-4 mb-4 rounded-xl border p-3 space-y-1 text-[12px]" style={{ borderColor: 'var(--alert-red)', backgroundColor: 'var(--alert-red-bg)', color: 'var(--alert-red)' }}>
              {rules.issues.slice(0, 3).map((msg) => (
                <li key={msg}>• {msg}</li>
              ))}
              {rules.issues.length > 3 && <li className="font-bold">+ {rules.issues.length - 3} more</li>}
            </ul>
          )}
        </>
      ) : (
        <OrdersView
          allocations={allocations}
          coverage={rules.coverage}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onCrewChange={(id, n) => setCrewOverride((o) => ({ ...o, [id]: Math.max(1, Math.min(4, n)) }))}
        />
      )}

      {/* Footer */}
      <div className="px-4 py-3 bg-[var(--bg-surface-subtle)] border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)] flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px]">
          {view === 'roster'
            ? '💡 Click or drag to paint shifts — then open Work Orders to see allocation re-run.'
            : '💡 Change crew with − / +, or repaint the roster: allocation and buffer update instantly.'}
        </span>
        <button type="button" onClick={onLaunch} className="font-bold text-[var(--brand-primary)] hover:underline inline-flex items-center gap-1 text-[13px]">
          Open the full planner <span>&rarr;</span>
        </button>
      </div>
    </div>
  );
}

function DemoRow({ label, children, dense }: { label: ReactNode; children: ReactNode; dense?: boolean }) {
  return (
    <div
      className={`grid items-center gap-1.5 ${dense ? 'py-0.5' : 'py-1.5'}`}
      style={{ gridTemplateColumns: `140px repeat(${DEMO_DAYS}, minmax(0, 1fr))` }}
    >
      <div className="px-1 min-w-0">{label}</div>
      {children}
    </div>
  );
}

function OrdersView({
  allocations,
  coverage,
  selectedDay,
  onSelectDay,
  onCrewChange,
}: {
  allocations: ReturnType<typeof allocate>;
  coverage: Record<ShiftGroup, number>[];
  selectedDay: number;
  onSelectDay: (d: number) => void;
  onCrewChange: (id: string, n: number) => void;
}) {
  const daysWithOrders = new Set(allocations.map((a) => a.wo.day));
  const dayAllocs = allocations.filter((a) => a.wo.day === selectedDay);

  return (
    <div className="p-4 space-y-4">
      {/* Day picker */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mr-1 shrink-0">Day</span>
        {DAY_LABELS.map((d) => {
          const active = d.num === selectedDay;
          return (
            <button
              key={d.num}
              onClick={() => onSelectDay(d.num)}
              className={`relative shrink-0 w-10 py-1 rounded-lg text-center border transition-all ${
                active ? 'bg-[var(--brand-primary)] text-white border-transparent' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)]'
              }`}
            >
              <span className="block text-[12px] font-bold font-mono">{d.num}</span>
              <span className={`block text-[9px] font-semibold ${active ? 'text-blue-100' : 'text-[var(--text-subtle)]'}`}>{d.wd}</span>
              {daysWithOrders.has(d.num) && (
                <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-[var(--brand-primary)]'}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Shift buffer cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {GROUPS.map((g) => {
          const onDuty = coverage[selectedDay - 1][g];
          const demand = dayAllocs.filter((a) => a.wo.shift === g).reduce((s, a) => s + a.needed, 0);
          const buffer = onDuty - demand;
          const tone = buffer < 0 ? 'red' : buffer === 0 && demand > 0 ? 'amber' : 'green';
          return (
            <div key={g} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: SHIFT_TOKENS[g].fg }}>
                  <span className="px-1.5 py-0.5 rounded text-[10.5px]" style={{ backgroundColor: SHIFT_TOKENS[g].bg }}>{g}</span>
                  {GROUP_LABEL[g]}
                </span>
                <StatusPill tone={tone}>
                  {buffer < 0 ? `${buffer} deficit` : buffer === 0 && demand > 0 ? '0 · tight' : `+${buffer} buffer`}
                </StatusPill>
              </div>
              <div className="mt-2.5 flex items-end gap-4 text-[11.5px] text-[var(--text-muted)]">
                <span><b className="block text-lg font-black text-[var(--text-primary)]">{onDuty}</b>on duty</span>
                <span><b className="block text-lg font-black text-[var(--text-primary)]">{demand}</b>required</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-surface-subtle)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${onDuty === 0 ? (demand ? 100 : 0) : Math.min(100, (demand / onDuty) * 100)}%`,
                    backgroundColor: `var(--alert-${tone === 'red' ? 'red' : tone === 'amber' ? 'amber' : 'green'})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Work orders for the day */}
      <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        <div className="px-3.5 py-2 bg-[var(--bg-surface-subtle)] text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Work orders · {selectedDay} October
        </div>
        {dayAllocs.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
            No work orders on this day — pick a day with a dot.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {dayAllocs.map(({ wo, needed, names, status }) => (
              <li key={wo.id} className="px-3.5 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 md:gap-4 items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-[11px] font-mono font-bold text-[var(--text-muted)]">{wo.id}</code>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--bg-surface-subtle)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">{wo.type}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: SHIFT_TOKENS[wo.shift].bg, color: SHIFT_TOKENS[wo.shift].fg }}>
                      {GROUP_LABEL[wo.shift]}
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">{wo.desc}</div>
                  <div className="mt-0.5 text-[11.5px] text-[var(--text-muted)] truncate">
                    {names.length ? `Assigned: ${names.join(', ')}` : 'Nobody free on this shift'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text-muted)] mr-1">Crew</span>
                  <button
                    onClick={() => onCrewChange(wo.id, needed - 1)}
                    className="w-6 h-6 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] font-bold"
                    aria-label="Decrease crew"
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-mono font-bold text-[13px]">{needed}</span>
                  <button
                    onClick={() => onCrewChange(wo.id, needed + 1)}
                    className="w-6 h-6 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] font-bold"
                    aria-label="Increase crew"
                  >
                    +
                  </button>
                </div>
                <div className="md:text-right">
                  <StatusPill tone={status === 'OK' ? 'green' : status === 'SHORT' ? 'amber' : 'red'}>
                    {status === 'OK' ? `✓ OK ${names.length}/${needed}` : status === 'SHORT' ? `Shortfall ${names.length}/${needed}` : 'Unassigned'}
                  </StatusPill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
