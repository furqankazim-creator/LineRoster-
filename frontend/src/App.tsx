import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

import { StoreProvider, useStore } from '@/app/store';
import { switchTheme } from '@/app/themeTransition';
import { AlstomLogo } from '@/components/AlstomLogo';
import { TipLayer } from '@/components/TipLayer';
import { Button, ToastHost, cx } from '@/components/ui';
import { THEME_STORAGE_KEY, getStoredTheme, saveStoredTheme } from '@/data/db';
import { monthLabel } from '@/domain/calendar';
import { AuthProvider, useAuth } from '@/features/auth/authStore';
import { LivePresence } from '@/features/auth/LivePresence';
import { LoginGate } from '@/features/auth/LoginGate';
import { NotificationBell } from '@/features/auth/NotificationDrawer';
import { ShareSecurityModal } from '@/features/auth/ShareSecurityModal';
import { PeoplePage } from '@/features/people/PeoplePage';
import { PlannerPage } from '@/features/planner/PlannerPage';
import { SetupPage } from '@/features/setup/SetupPage';
import { AssistantWidget } from '@/features/assistant/AssistantWidget';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { LandingPage } from '@/features/landing/LandingPage';
import { WorkOrdersPage } from '@/features/workorders/WorkOrdersPage';

type Page = 'dashboard' | 'planner' | 'workorders' | 'people' | 'setup';

const APP_HASH = '#/app';
const PAGES: Page[] = ['dashboard', 'planner', 'workorders', 'people', 'setup'];

/** The app lives at #/app (Dashboard) and #/app/<tab>; anything else shows the landing page. */
const isAppHash = (hash: string) => hash === APP_HASH || hash.startsWith(`${APP_HASH}/`);

/** Which tab the address names, so a refresh stays on it instead of falling back to Dashboard. */
function pageFromHash(): Page {
  const name = window.location.hash.slice(APP_HASH.length + 1) as Page;
  return PAGES.includes(name) ? name : 'dashboard';
}

function useInApp(): [boolean, (open: boolean) => void] {
  const [inApp, setInApp] = useState(() => isAppHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setInApp(isAppHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const set = (open: boolean) => {
    window.location.hash = open ? APP_HASH : '';
  };
  return [inApp, set];
}

export default function App() {
  const [inApp, setInApp] = useInApp();

  useEffect(() => {
    const theme = getStoredTheme();
    document.documentElement.dataset.theme = theme;

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        document.documentElement.dataset.theme = e.newValue;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!inApp) return <LandingPage onOpen={() => setInApp(true)} />;

  return (
    <ToastHost>
      <AuthProvider>
        <AppContent onHome={() => setInApp(false)} />
      </AuthProvider>
    </ToastHost>
  );
}

function AppContent({ onHome }: { onHome: () => void }) {
  const { isAuthenticated, session } = useAuth();

  if (!isAuthenticated) {
    return <LoginGate onBackToHome={onHome} />;
  }

  const storeKey = session?.id
    ? `${session.id}_${session.workspaceMode || 'shared'}_${session.passcodeUsed || 'admin'}`
    : 'guest';

  return (
    <StoreProvider key={storeKey}>
      <Shell onHome={onHome} />
    </StoreProvider>
  );
}

function Shell({ onHome }: { onHome: () => void }) {
  const { ready, settings, setTheme, lines } = useStore();
  const { session, logout } = useAuth();
  const [page, setPageState] = useState<Page>(pageFromHash);
  // The tab lives in the address (#/app/planner …): refresh and the back button keep it
  const setPage = (p: Page) => {
    window.location.hash = p === 'dashboard' ? APP_HASH : `${APP_HASH}/${p}`;
  };
  useEffect(() => {
    const onHash = () => {
      if (isAppHash(window.location.hash)) setPageState(pageFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    saveStoredTheme(settings.theme);
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.fontSize = settings.fontSize ?? 'normal';
    document.documentElement.dataset.fontFamily = settings.fontFamily ?? 'default';
  }, [settings.theme, settings.fontSize, settings.fontFamily]);

  if (!ready) {
    return (
      <div className="h-full grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <AlstomLogo height={26} />
          <Wordmark className="text-[18px]" />
          <span className="text-[12px] text-ink-3">Loading roster…</span>
        </div>
      </div>
    );
  }

  const line = lines.find((l) => l.id === settings.activeLineId);

  return (
    <div className="flex h-full flex-col">
      <header
        className="no-print relative mx-2 sm:mx-4 xl:mx-6 my-2 sm:my-3 shrink-0 rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 sm:px-5 xl:px-5 2xl:px-7 z-50 shadow-sm"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* Row 1: brand · (desktop: tabs) · actions */}
        <div className="flex h-14 xl:h-16 items-center justify-between gap-2 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3 xl:gap-4 2xl:gap-6">
            <button
              type="button"
              onClick={onHome}
              data-tip={'Back to home\nGo to the RailOPS landing page. You stay signed in on this tab.'}
              aria-label="Back to home page"
              className="flex min-w-0 shrink items-center gap-2 sm:gap-3 text-left group py-0.5"
            >
              <span className="sm:hidden">
                <AlstomLogo height={17} className="group-hover:opacity-85 transition-opacity" />
              </span>
              <span className="hidden sm:inline-flex">
                <AlstomLogo height={21} className="group-hover:opacity-85 transition-opacity" />
              </span>
              <span className="h-6 sm:h-8 w-px shrink-0 bg-[var(--line)]" aria-hidden />
              <div className="flex min-w-0 flex-col leading-tight">
                <Wordmark className="text-[15px] sm:text-[17.5px] font-black group-hover:text-[var(--accent)] transition-colors" />
                <span className="hidden md:block truncate text-[11.5px] xl:text-[12px] font-bold text-ink-3">
                  {/* Full subtitle only where there is room: tablets-landscape and ≥1536px */}
                  <span className="hidden lg:inline xl:hidden 2xl:inline">Riyadh SLV Maintenance <span className="text-ink-3">·</span> </span>
                  {line?.name} <span className="text-ink-3">·</span> {monthLabel(settings.activeYear, settings.activeMonth)}
                </span>
              </div>
            </button>

            {/* Desktop: tabs inline */}
            <span className="hidden xl:block h-7 w-px bg-[var(--line)]" aria-hidden />
            <MainNav page={page} setPage={setPage} className="hidden xl:flex shrink-0" />
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5 xl:gap-3">
            <span className="hidden sm:contents">
              <LivePresence />
            </span>

            {/* Notifications: Supervisor Only */}
            {session?.role === 'supervisor' && <NotificationBell />}

            {/* Share Link: Supervisor Only */}
            {session?.role === 'supervisor' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1.5 text-xs font-bold h-8 sm:h-9 px-2 sm:px-3.5 text-ink rounded-xl border-[var(--line-strong)] hover:border-[var(--line)] shadow-xs"
                data-tip={'Share Link\nCreate a password-protected link so a colleague can open this roster, and manage who has access and what they can do.'}
                aria-label="Share link"
              >
                <span>🔗</span>
                <span className="hidden lg:inline">Share Link</span>
              </Button>
            )}

            {/* User badge & Lock button */}
            <div className="flex items-center gap-2.5 sm:pl-2.5 sm:border-l border-[var(--line)]">
              <div
                className="hidden 2xl:flex flex-col text-right leading-tight max-w-[170px]"
                title={`Signed in as ${session?.name ?? 'User'} (${session?.role ?? 'viewer'})`}
              >
                <span className="truncate text-[12px] font-bold text-ink">
                  {session?.name ? session.name.replace(/ \/ Operations Lead/g, '') : 'Supervisor'}
                </span>
                <div className="flex items-center justify-end">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[var(--accent)]">
                    {session?.role === 'supervisor' ? 'Supervisor' : 'Collaborator'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  logout();
                  onHome(); // signing out lands on the landing page
                }}
                data-tip={`Sign out\nSigned in as ${session?.name ?? 'User'}. Ends your session and returns to the home page; the login is asked for again.`}
                aria-label="Lock Screen / Sign Out"
                className="grid h-8 w-8 sm:h-9 sm:w-9 place-items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] text-ink-2 hover:text-amber-400 hover:bg-[var(--surface-3)] transition-all shadow-xs"
              >
                <span className="text-[13px]" role="img" aria-label="Lock">
                  🔒
                </span>
              </button>
            </div>

            <button
              onClick={(e) => {
                const next = settings.theme === 'dark' ? 'light' : 'dark';
                // Paint the new theme now, animated, then save it.
                switchTheme(next, e.currentTarget, () => {
                  saveStoredTheme(next);
                  setTheme(next);
                });
              }}
              data-tip={settings.theme === 'dark' ? 'Light theme\nSwitch the whole app to the light colour scheme.' : 'Dark theme\nSwitch the whole app to the dark colour scheme.'}
              aria-label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="grid h-8 w-8 sm:h-9 sm:w-9 place-items-center overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] text-ink-2 hover:text-ink hover:bg-[var(--surface-3)] transition-all shadow-xs"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={settings.theme}
                  initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
                  animate={{ rotate: 0, scale: 1, opacity: 1 }}
                  exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="grid place-items-center"
                >
                  {settings.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>

        {/* Row 2 (below desktop): tabs across the full width */}
        <MainNav page={page} setPage={setPage} className="flex xl:hidden mb-2.5" fill />
      </header>

      {page === 'dashboard' && (
        <DashboardPage
          onOpenPlanner={() => setPage('planner')}
          onOpenWorkOrders={() => setPage('workorders')}
        />
      )}
      {page === 'planner' && <PlannerPage />}
      {page === 'workorders' && <WorkOrdersPage onOpenPlanner={() => setPage('planner')} />}
      {page === 'people' && <PeoplePage />}
      {page === 'setup' && <SetupPage />}
      <AssistantWidget />
      {/* No hover explanations on the Duty Roster and Maintenance Workorders pages */}
      <TipLayer pausedOutsideHeader={page === 'planner' || page === 'workorders'} />
      <ShareSecurityModal open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}

const NAV_TIPS: Record<Page, string> = {
  dashboard: 'Dashboard\nA live overview: how many work orders each day, how many people are working, and where a shift is short.',
  planner: 'Duty Roster\nThe monthly roster grid for each line: who works which shift every day. Edit it here and the work orders re-check themselves.',
  workorders: 'Maintenance Workorders\nImport the work-order Excel file and see every job checked against the roster for its own day and shift.',
  people: 'People\nEveryone on the line with their shift, rest days and rotation. Add people or change their rules here.',
  setup: 'Setup\nLines, shift codes and colours, minimum headcounts, Excel import columns, and backup or restore.',
};

const NAV_ITEMS = [
  ['dashboard', 'Dashboard', <HomeIcon key="i" />, 'Board'],
  ['planner', 'Duty Roster', <GridIcon key="i" />, 'Roster'],
  ['workorders', 'Maintenance Workorders', <ClipboardIcon key="i" />, 'Orders'],
  ['people', 'People', <PeopleIcon key="i" />, 'People'],
  ['setup', 'Setup', <GearIcon key="i" />, 'Setup'],
] as const;

/**
 * The four main tabs. Desktop: inline pill group. Smaller screens (`fill`):
 * a full-width row of equal tabs; on phones the icon sits above the label.
 */
function MainNav({
  page,
  setPage,
  className,
  fill = false,
}: {
  page: Page;
  setPage: (p: Page) => void;
  className?: string;
  fill?: boolean;
}) {
  return (
    <nav
      className={cx('items-center gap-1 sm:gap-1.5 bg-[var(--surface-2)] p-1 sm:p-1.5 rounded-xl border border-[var(--line)] shadow-xs', className)}
      aria-label="Main"
    >
      {NAV_ITEMS.map(([key, label, icon, short]) => {
        const active = page === key;
        return (
          <button
            key={key}
            onClick={() => setPage(key)}
            data-tip={NAV_TIPS[key]}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex items-center justify-center rounded-lg font-bold transition-all whitespace-nowrap',
              fill
                ? 'flex-1 min-w-0 flex-col sm:flex-row gap-0.5 sm:gap-2 px-1 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-[13px]'
                : 'gap-1.5 2xl:gap-2 px-3 2xl:px-4 py-1.5 text-[13px] 2xl:text-[13.5px]',
              active
                ? 'bg-[var(--surface)] text-ink shadow-sm border border-[var(--line-strong)]'
                : 'border border-transparent text-ink-3 hover:text-ink hover:bg-[var(--surface-3)]/60',
            )}
          >
            <span className={cx('transition-colors', active ? 'text-[var(--accent)]' : 'text-ink-3')}>{icon}</span>
            {/* Phones get the short label so all four tabs fit */}
            <span className="truncate max-w-full">
              {fill ? (
                <>
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </>
              ) : (
                <>
                  {/* Laptops drop "Maintenance" so the tabs never crowd the brand */}
                  <span className="2xl:hidden">{label.replace('Maintenance ', '')}</span>
                  <span className="hidden 2xl:inline">{label}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function HomeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-extrabold tracking-[-0.025em] leading-none text-ink', className)}>
      Rail<span className="text-[var(--accent)]">OPS</span>
    </span>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 4v17M16 2v4M8 2v4" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
