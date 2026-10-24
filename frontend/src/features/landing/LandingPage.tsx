import { AnimatePresence, motion, useScroll, type Variants } from 'framer-motion';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { switchTheme } from '@/app/themeTransition';
import { THEME_STORAGE_KEY, getSettings, getStoredTheme, patchSettings, saveStoredTheme } from '@/data/db';

/* ==========================================================================
   THEME DEFINITIONS & COLOR TOKENS (LIGHT & DARK ENTERPRISE SAAS PALETTES)
   Tailored for LineRoster: metro signalling & communication roster planning.
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
    '--chip-gs-bg': '#DCFCE7',
    '--chip-gs-fg': '#166534',
    '--alert-green': '#16A34A',
    '--alert-green-bg': '#F0FDF4',
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
    '--chip-gs-bg': '#0B3B24',
    '--chip-gs-fg': '#4ADE80',
    '--alert-green': '#4ADE80',
    '--alert-green-bg': 'rgba(34, 197, 94, 0.15)',
  },
};

type ShiftGroup = 'M' | 'E' | 'N';

const SHIFT_TOKENS: Record<string, { bg: string; fg: string; label: string; timing: string; group?: ShiftGroup }> = {
  M: { bg: 'var(--chip-m-bg)', fg: 'var(--chip-m-fg)', label: 'Morning', timing: '06:00 – 15:00', group: 'M' },
  E: { bg: 'var(--chip-e-bg)', fg: 'var(--chip-e-fg)', label: 'Evening', timing: '14:00 – 23:00', group: 'E' },
  N: { bg: 'var(--chip-n-bg)', fg: 'var(--chip-n-fg)', label: 'Night', timing: '22:00 – 07:00', group: 'N' },
  GS: { bg: 'var(--chip-gs-bg)', fg: 'var(--chip-gs-fg)', label: 'General Shift', timing: '08:00 – 17:00' },
};

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
      viewport={{ once: true, margin: '-50px' }}
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
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  // Synchronize theme with database settings
  useEffect(() => {
    let unmounted = false;
    getSettings()
      .then((settings) => {
        if (!unmounted && (settings.theme === 'light' || settings.theme === 'dark')) {
          const current = getStoredTheme();
          if (settings.theme !== current) {
            setTheme(settings.theme);
            saveStoredTheme(settings.theme);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      unmounted = true;
    };
  }, []);

  // Synchronize across tabs/windows
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleToggleTheme = (e?: React.MouseEvent<HTMLElement>) => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    switchTheme(nextTheme, e?.currentTarget, () => {
      setTheme(nextTheme);
      saveStoredTheme(nextTheme);
    });
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
            aria-label="LineRoster"
          >
            <span className="flex flex-col text-left min-w-0">
              <span className="text-base sm:text-xl font-black tracking-tight text-[var(--text-primary)] leading-tight">LineRoster</span>
              <span className="text-[10.5px] font-semibold tracking-wide uppercase text-[var(--text-muted)] truncate hidden sm:block">
                Roster &amp; Work-Order Planning
              </span>
            </span>
          </button>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              onClick={(e) => handleToggleTheme(e)}
              aria-label="Toggle theme"
              className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-all shadow-sm active:scale-95 overflow-hidden"
              title="Toggle Light/Dark Theme"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
                  animate={{ rotate: 0, scale: 1, opacity: 1 }}
                  exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="grid place-items-center"
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
                </motion.span>
              </AnimatePresence>
            </button>
            <button
              onClick={onOpen}
              aria-label="Open LineRoster"
              className="inline-flex items-center gap-2 px-3 min-[420px]:px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-sm font-extrabold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 shadow-lg shadow-indigo-500/25 border border-indigo-400/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span className="hidden sm:inline">Open LineRoster</span>
              <span className="hidden min-[420px]:inline sm:hidden">Open</span>
              <ArrowIcon />
            </button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-[calc(100vh-5rem)] flex flex-col justify-center pt-12 pb-20 sm:pt-20 sm:pb-28 overflow-hidden bg-[var(--bg-hero)]">
        <div className="absolute inset-0 pointer-events-none -z-0 opacity-30">
          <div className="absolute top-10 left-[8%] w-96 h-96 bg-blue-500/30 rounded-full blur-[130px]" />
          <div className="absolute top-24 right-[8%] w-96 h-96 bg-violet-500/30 rounded-full blur-[140px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center my-auto">
          <SectionReveal delayIndex={0}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] sm:text-xs font-bold tracking-wide uppercase bg-[var(--badge-bg)] text-[var(--badge-text)] border border-[var(--badge-border)] shadow-sm">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75" />
                <span className="relative w-2 h-2 rounded-full bg-blue-500" />
              </span>
              <span>Line 4, 5 &amp; 6 Monthly Roster + Preventive Maintenance Workorders</span>
            </div>
          </SectionReveal>

          <SectionReveal delayIndex={1}>
            <h1 className="mt-6 text-center text-3xl min-[420px]:text-4xl sm:text-5xl xl:text-6xl font-black tracking-tight text-[var(--text-primary)] max-w-7xl mx-auto leading-[1.15]">
              {/* White line, the "&" centred on its own line, then the blue line */}
              <span className="block lg:whitespace-nowrap">SLV Operational Roster Planning</span>
              <span className="block text-center bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-500">&amp;</span>
              <span className="block lg:whitespace-nowrap bg-clip-text text-transparent" style={{ backgroundImage: 'var(--brand-gradient)' }}>
                Maintenance Work Scheduling System
              </span>
            </h1>
          </SectionReveal>

          <SectionReveal delayIndex={2}>
            <p className="mt-6 text-base sm:text-xl text-[var(--text-secondary)] max-w-3xl mx-auto leading-relaxed">
              <strong className="text-[var(--text-primary)] font-bold">Comprehensive Workforce Planning:</strong> Plan and optimize 24/7 operations by generating monthly shift rosters, managing engineer rotations, assigning maintenance activities to available staff, and ensuring continuous workforce coverage through live staffing checks.
            </p>

            {/* Core Signalling & Communication Capabilities */}
            <div className="mt-7 max-w-3xl mx-auto grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 text-left">
              {[
                'Workforce planning',
                'Solver round-the-clock roster generation',
                'Engineer rotation',
                'Maintenance work orders',
                'Location / shift bridge verification',
                'Secure user access management',
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/85 shadow-xs"
                >
                  <CheckIcon />
                  <span className="text-[12px] sm:text-[12.5px] font-semibold text-[var(--text-secondary)] leading-snug">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </SectionReveal>

          <SectionReveal delayIndex={3}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={onOpen}
                className="px-8 sm:px-10 py-4 sm:py-4.5 rounded-xl text-base sm:text-lg font-extrabold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 shadow-xl shadow-indigo-600/30 transition-all hover:scale-[1.03] active:scale-[0.98] inline-flex items-center gap-3 border border-indigo-400/30"
              >
                <span>Open LineRoster</span>
                <ArrowIcon size={20} />
              </button>
            </div>
          </SectionReveal>

          <SectionReveal delayIndex={4}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs sm:text-sm font-semibold text-[var(--text-muted)]">
              <span className="flex items-center gap-2"><CheckIcon />Works offline — saved in your browser</span>
              <span className="flex items-center gap-2"><CheckIcon />Excel import &amp; export</span>
              <span className="flex items-center gap-2"><CheckIcon />Personal password links &amp; live alerts</span>
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
              <div className="leading-tight">
                <div className="text-lg font-black tracking-tight text-[var(--text-primary)]">LineRoster</div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Roster &amp; Work-Order Planning
                </div>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--text-secondary)] max-w-sm">
              Signalling and communication roster planning for Line 4, 5 &amp; 6 — shifts, rest rules, leave and
              work-order manpower allocation in one place.
            </p>
          </div>

          {/* Workspaces */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-primary)]">Workspaces</h4>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              {[
                ['Duty Roster', 'Roster, rules & insights'],
                ['Maintenance Workorders', 'Allocation & shift buffer'],
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
              {(['M', 'E', 'N'] as const).map((code) => {
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
              Open LineRoster
              <ArrowIcon size={14} />
            </button>
          </div>
        </div>

        <div className="border-t border-[var(--border-subtle)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-[11.5px] text-[var(--text-muted)] text-center md:text-left">
            <span>LineRoster · Signalling &amp; Communication Workforce Management System</span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--alert-green)]" />
              Built by TimeGlobal
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
