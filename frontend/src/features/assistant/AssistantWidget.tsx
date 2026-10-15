import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import {
  askAssistant, cloudEnabled, getUser, health, signIn, type AiAction, type AiReply, type CloudUser,
} from '@/app/api';
import { useStore } from '@/app/store';
import { codeVars } from '@/app/tones';
import { useViewport } from '@/app/useViewport';
import { Button, cx, useToast } from '@/components/ui';

import { QUICK_HELP, buildWorkOrderContext } from './appKnowledge';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  reply?: AiReply;
  applied?: boolean;
}

const SUGGESTIONS = [
  'Which days are short-staffed?',
  'Which work orders are short this month, and how do I fix them?',
  'Who can cover Night on the short days?',
  'Are there import problems in the work-order file?',
  'Summarise this month in three lines.',
  'Who has worked the most nights?',
];

const OPEN_KEY = 'shiftline.assistant-open';

/**
 * The assistant as a chat bubble — bottom-right on every screen, like a
 * support widget. One click opens it; sign-in, if needed, happens inside the
 * chat rather than in Setup.
 *
 * The model only ever proposes. Any edit it suggests comes back as cell
 * actions with a before/after error count, and is applied through the same
 * paintCell path as a hand edit — undoable and validated.
 */
export function AssistantWidget() {
  const viewport = useViewport();
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
      // Ctrl+/ toggles the assistant from anywhere.
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!cloudEnabled()) return null;

  const mobile = viewport === 'mobile';

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className={cx(
              'no-print fixed z-[70] flex flex-col overflow-hidden border border-[var(--line-strong)] bg-[var(--surface)] shadow-pop',
              mobile ? 'inset-0 rounded-none' : 'bottom-20 right-5 w-[400px] h-[600px] max-h-[calc(100vh-110px)] rounded-2xl',
            )}
            style={mobile ? { paddingTop: 'env(safe-area-inset-top, 0px)' } : undefined}
          >
            <Chat onClose={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.95 }}
        title="Assistant (Ctrl+/)"
        className={cx(
          'no-print fixed z-[71] flex items-center gap-2 rounded-full shadow-pop transition-colors',
          'bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110',
          mobile ? 'bottom-4 right-4 h-12 w-12 justify-center' : 'bottom-5 right-5 h-11 px-4',
          open && mobile && 'hidden',
        )}
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <SparkIcon />
        {!mobile && <span className="text-[13px] font-semibold">{open ? 'Close' : 'Ask ShiftLine'}</span>}
      </motion.button>
    </>
  );
}

/* ------------------------------------------------------------------- chat */

function Chat({ onClose }: { onClose: () => void }) {
  const { settings, roster, employees, codes, leave, paintCell, workOrders, workload, resourceRequirements } = useStore();
  const toast = useToast();
  const [user, setUser] = useState<CloudUser | null>(getUser());
  const [publicAi, setPublicAi] = useState<boolean>(true);
  const [serverDown, setServerDown] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  // Ask the server once whether the chat is open to everyone.
  useEffect(() => {
    health()
      .then((h) => {
        setPublicAi(h.aiPublic !== false);
        setServerDown(false);
      })
      .catch(() => {
        setServerDown(false);
        setPublicAi(true);
      });
  }, []);
  const canChat = Boolean(user) || publicAi !== false;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  useEffect(() => {
    if (canChat) inputRef.current?.focus();
  }, [canChat]);

  const codeById = new Map(codes.map((c) => [c.id, c]));
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? id;

  const send = async (question: string) => {
    if (!roster || !question.trim() || busy) return;
    const q = question.trim();
    setInput('');
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const reply = await askAssistant({
        lineId: settings.activeLineId,
        year: settings.activeYear,
        month: settings.activeMonth,
        question: q,
        history: turns.slice(-6).map((t) => ({ role: t.role, content: t.content })),
        context: {
          roster,
          employees,
          codes,
          leave,
          workOrders,
          workload,
          requirements: resourceRequirements,
          workOrderSummary: buildWorkOrderContext({ settings, workOrders, workload, requirements: resourceRequirements }),
        },
      });
      setTurns((t) => [...t, { role: 'assistant', content: reply.answer, reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The assistant is unavailable.';
      // A lapsed session drops back to the sign-in form instead of a dead end.
      if (/sign in/i.test(msg) && !publicAi) setUser(null);
      setTurns((t) => [...t, { role: 'assistant', content: msg }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = (turnIndex: number, actions: AiAction[]) => {
    for (const a of actions) paintCell(a.employeeId, a.dayIndex, a.code);
    setTurns((t) => t.map((turn, i) => (i === turnIndex ? { ...turn, applied: true } : turn)));
    toast(`Applied ${actions.length} change${actions.length === 1 ? '' : 's'}. Ctrl+Z undoes them.`, 'ok');
  };

  return (
    <>
      <header className="flex items-center gap-2.5 px-4 h-14 border-b border-[var(--line)] shrink-0">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]">
          <SparkIcon />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold">ShiftLine Assistant</span>
          <span className="text-[10.5px] text-ink-3">
            {user ? `${user.email} · ` : ''}{monthName(settings.activeMonth)} {settings.activeYear}
          </span>
        </div>
        <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:text-ink hover:bg-[var(--surface-3)]">
          ✕
        </button>
      </header>

      {publicAi === null ? (
        <div className="flex-1 grid place-items-center text-[12px] text-ink-3">Connecting…</div>
      ) : serverDown ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pt-5 text-center">
          <p className="px-6 text-[13px] font-medium">The assistant is offline</p>
          <p className="px-6 text-[12px] text-ink-3 leading-relaxed">
            The ShiftLine server is not running. Start it with{' '}
            <code className="font-mono text-ink-2">cd server &amp;&amp; npm run dev</code>, then reopen this chat.
          </p>
          <QuickHelp />
        </div>
      ) : !canChat ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SignIn onDone={setUser} />
          <QuickHelp />
        </div>
      ) : (
        <>
          <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
            {turns.length === 0 && (
              <div className="flex flex-col gap-2">
                <div className="max-w-[92%] rounded-xl bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2 text-[12.5px] leading-relaxed">
                  Hi. Ask me anything about this month's roster, or tell me what to change — I'll show you
                  the changes before they're applied.
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      className="rounded-full border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-1 text-[11.5px] text-ink-2 hover:border-[var(--accent)] hover:text-ink transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, i) => (
              <div key={i} className={cx('flex flex-col gap-2', turn.role === 'user' ? 'items-end' : 'items-start')}>
                <div
                  className={cx(
                    'max-w-[92%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap',
                    turn.role === 'user'
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--surface-2)] border border-[var(--line)] text-ink',
                  )}
                >
                  {turn.content}
                </div>

                {turn.reply && turn.reply.actions.length > 0 && (
                  <div className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                        Changes · {turn.reply.actions.length}
                      </span>
                      {turn.reply.preview && (
                        <span className="font-mono text-[11px]">
                          errors <span className="text-ink-2">{turn.reply.preview.errorsBefore}</span>
                          <span className="text-ink-3"> → </span>
                          <span
                            style={{
                              color:
                                turn.reply.preview.errorsAfter < turn.reply.preview.errorsBefore
                                  ? 'var(--ok)'
                                  : turn.reply.preview.errorsAfter > turn.reply.preview.errorsBefore
                                  ? 'var(--danger)'
                                  : 'var(--ink-2)',
                            }}
                          >
                            {turn.reply.preview.errorsAfter}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      {turn.reply.actions.map((a, j) => {
                        const tone = codeVars(codeById.get(a.code));
                        return (
                          <div key={j} className="flex items-center gap-2 text-[12px]">
                            <span className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold shrink-0" style={{ background: tone.bg, color: tone.fg }}>
                              {a.code}
                            </span>
                            <span className="truncate">{nameOf(a.employeeId)} · day {a.dayIndex + 1}</span>
                            {a.reason && <span className="ml-auto text-[11px] text-ink-3 truncate max-w-[45%]">{a.reason}</span>}
                          </div>
                        );
                      })}
                    </div>
                    {turn.reply.preview && turn.reply.preview.rejected.length > 0 && (
                      <p className="text-[11px] text-[var(--warn)]">
                        {turn.reply.preview.rejected.length} suggestion{turn.reply.preview.rejected.length === 1 ? ' was' : 's were'} dropped ({turn.reply.preview.rejected.map((r) => r.why).join(', ')}).
                      </p>
                    )}
                    <div className="flex justify-end pt-1">
                      {turn.applied ? (
                        <span className="text-[11.5px] text-[var(--ok)]">✓ Applied</span>
                      ) : (
                        <Button variant="primary" size="sm" onClick={() => apply(i, turn.reply!.actions)}>
                          Apply
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                Thinking…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-[var(--line)] p-3 flex gap-2 shrink-0"
            style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a question…"
              disabled={busy}
              className="h-10 flex-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4 text-[13px] text-ink placeholder:text-ink-3 focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="grid h-10 w-10 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] disabled:opacity-40"
              title="Send"
            >
              <SendIcon />
            </button>
          </form>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- quick help */

/** Built-in answers that work without the AI server. */
function QuickHelp() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="px-4 pb-4 text-left">
      <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Quick help</p>
      <div className="flex flex-col gap-1.5">
        {QUICK_HELP.map((h, i) => (
          <div key={h.q} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]">
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full px-3 py-2 text-left text-[12.5px] font-medium text-ink flex items-center justify-between gap-2"
            >
              {h.q}
              <span className="text-ink-3">{open === i ? '−' : '+'}</span>
            </button>
            {open === i && <p className="px-3 pb-2.5 text-[12px] leading-relaxed text-ink-2">{h.a}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- sign-in */

function SignIn({ onDone }: { onDone: (u: CloudUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onDone(await signIn(email, password));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Sign-in failed.');
        } finally {
          setBusy(false);
        }
      }}
      className="flex-1 flex flex-col justify-center gap-3 px-6"
    >
      <p className="text-[13px] font-medium">Sign in to chat</p>
      <p className="-mt-2 text-[12px] text-ink-3">Use your ShiftLine supervisor account.</p>
      <input
        type="email"
        autoComplete="username"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 text-[13px] focus:border-[var(--accent)] focus:outline-none"
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-10 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 text-[13px] focus:border-[var(--accent)] focus:outline-none"
      />
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy || !email || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

function monthName(m: number) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.8 5.6L19.5 9.4l-5.7 1.8L12 17l-1.8-5.8L4.5 9.4l5.7-1.8L12 2zM5 16l.9 2.6L8.5 19.5l-2.6.9L5 23l-.9-2.6L1.5 19.5l2.6-.9L5 16z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
