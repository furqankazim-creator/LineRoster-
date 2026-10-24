import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

import { switchTheme } from '@/app/themeTransition';
import { Button, Input, Segmented } from '@/components/ui';
import { THEME_STORAGE_KEY, getStoredTheme, patchSettings, saveStoredTheme } from '@/data/db';

import { useAuth } from './authStore';

interface Props {
  onBackToHome?: () => void;
}

export function LoginGate({ onBackToHome }: Props) {
  const { loginWithPasscode, loginAsAdmin, securitySettings } = useAuth();

  const [theme, setTheme] = useState<'light' | 'dark'>(getStoredTheme);
  const [mode, setMode] = useState<'passcode' | 'admin'>('passcode');
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    const next: 'light' | 'dark' = theme === 'dark' ? 'light' : 'dark';
    switchTheme(next, e?.currentTarget, () => {
      setTheme(next);
      saveStoredTheme(next);
    });
    patchSettings({ theme: next }).catch(() => {});
  };

  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPasscode = passcode.trim();
    const cleanName = name.trim();

    if (!cleanPasscode) {
      setError('Please enter the access passcode provided by your supervisor.');
      return;
    }

    if (securitySettings.requireName && !cleanName) {
      setError('Please enter your name so the supervisor knows who opened the roster.');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const ok = loginWithPasscode(cleanName || 'Team Member', cleanPasscode);
      setIsSubmitting(false);
      if (!ok) {
        setError('Incorrect passcode. Please check with your supervisor.');
      }
    }, 250);
  };

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!adminPassword.trim()) {
      setError('Please enter the supervisor master password.');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const ok = loginAsAdmin(adminPassword.trim());
      setIsSubmitting(false);
      if (!ok) {
        setError('Invalid supervisor password.');
      }
    }, 250);
  };

  // Auto-detect passcode and assigned recipient name from URL param if opened via link
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let codeFromUrl = urlParams.get('code') || urlParams.get('passcode') || urlParams.get('p');
      let nameFromUrl = urlParams.get('user') || urlParams.get('name') || urlParams.get('u');
      if ((!codeFromUrl || !nameFromUrl) && window.location.hash.includes('?')) {
        const hashQuery = window.location.hash.split('?')[1];
        if (hashQuery) {
          const hashParams = new URLSearchParams(hashQuery);
          if (!codeFromUrl) {
            codeFromUrl = hashParams.get('code') || hashParams.get('passcode') || hashParams.get('p');
          }
          if (!nameFromUrl) {
            nameFromUrl = hashParams.get('user') || hashParams.get('name') || hashParams.get('u');
          }
        }
      }
      if (codeFromUrl) {
        const clean = decodeURIComponent(codeFromUrl).trim();
        if (clean) {
          setPasscode(clean);
        }
      }
      if (nameFromUrl) {
        const cleanName = decodeURIComponent(nameFromUrl).trim();
        if (cleanName) {
          setName(cleanName);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);


  const switchMode = (next: 'passcode' | 'admin') => {
    setMode(next);
    setError(null);
  };

  return (
    // No font-family here on purpose: the page inherits the app font (and the
    // font chosen in Display settings) so login matches every other screen.
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-[var(--canvas)] overflow-hidden select-none">
      {/* soft accent glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[720px] h-[360px] rounded-full blur-[140px] opacity-25 pointer-events-none bg-[var(--accent)]" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative w-full max-w-[420px] rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-6 sm:p-8 shadow-pop"
      >
        {/* Theme switcher */}
        <div className="absolute top-4 right-4">
          <button
            type="button"
            onClick={(e) => handleToggleTheme(e)}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-ink-2 hover:text-ink hover:bg-[var(--surface-3)] transition-colors"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="grid place-items-center"
              >
                {theme === 'dark' ? (
                  <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>
                ) : (
                  <Icon><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></Icon>
                )}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>

        {/* Brand */}
        <div className="text-center">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Sign in to LineRoster</h1>
          <p className="mt-1.5 text-[13px] text-ink-2 leading-relaxed">
            This Duty Roster link is protected. Sign in as a team member or supervisor to open it.
          </p>
        </div>

        {/* Team member / Supervisor */}
        <div className="mt-6 flex justify-center">
          <Segmented
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'passcode', label: 'Team member' },
              { value: 'admin', label: 'Supervisor' },
            ]}
          />
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            role="alert"
            className="mt-5 px-3 py-2.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)] text-[13px] font-medium"
          >
            {error}
          </motion.div>
        )}

        {mode === 'passcode' ? (
          <form onSubmit={handlePasscodeSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-ink-2 flex items-center justify-between">
                <span>Your name</span>
                {securitySettings.requireName && <span className="text-[11px] text-ink-3">Required</span>}
              </label>
              <FieldIcon icon={<Icon><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Icon>}>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Arif"
                  required={securitySettings.requireName}
                  autoFocus
                  className="h-10 pl-9 text-[13px]"
                />
              </FieldIcon>
              <p className="text-[11.5px] text-ink-3">
                The supervisor is alerted: &ldquo;{name.trim() || 'Team member'} logged in&rdquo;.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-ink-2">Roster passcode</label>
                <ShowToggle shown={showPassword} onClick={() => setShowPassword(!showPassword)} />
              </div>
              <FieldIcon icon={<Icon><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Enter your passcode"
                  required
                  className="h-10 pl-9 text-[13px]"
                />
              </FieldIcon>
            </div>

            <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full h-10 text-[13px] font-semibold mt-1">
              {isSubmitting ? 'Verifying…' : 'Open Duty Roster'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleAdminSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-ink-2">Supervisor password</label>
                <ShowToggle shown={showPassword} onClick={() => setShowPassword(!showPassword)} />
              </div>
              <FieldIcon icon={<Icon><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3" /></Icon>}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter supervisor password"
                  required
                  autoFocus
                  className="h-10 pl-9 text-[13px]"
                />
              </FieldIcon>
              <p className="text-[11.5px] text-ink-3">Unlocks link sharing, login alerts and the active-member monitor.</p>
            </div>

            <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full h-10 text-[13px] font-semibold mt-1">
              {isSubmitting ? 'Authenticating…' : 'Sign in as supervisor'}
            </Button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-[var(--line)] flex items-center justify-between text-[12px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)]" />
            Multi-user sync active
          </span>
          {onBackToHome && (
            <button type="button" onClick={onBackToHome} className="text-ink-2 hover:text-ink font-medium transition-colors">
              ← Back to overview
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** An input with a leading icon. */
function FieldIcon({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">{icon}</span>
      {children}
    </div>
  );
}

function ShowToggle({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[12px] text-[var(--accent)] hover:underline font-medium">
      {shown ? 'Hide' : 'Show'}
    </button>
  );
}
