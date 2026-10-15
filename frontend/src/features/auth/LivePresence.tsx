import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { cx } from '@/components/ui';

import { useAuth } from './authStore';
import type { PresenceUser } from './types';

export function LivePresence() {
  const { activeUsers, session } = useAuth();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const isSupervisor = session?.role === 'supervisor';
  const onlineUsers = activeUsers.filter((u) => u.status === 'online');
  const count = Math.max(1, onlineUsers.length);

  // Collaborators cannot see who is online
  if (!isSupervisor) {
    return (
      <div
        title="Live connection active"
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 select-none text-xs font-semibold shadow-xs"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="hidden sm:inline">Online</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Live Collaborators viewing this roster"
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/70 hover:bg-[var(--surface-3)] text-ink transition-colors select-none text-xs shadow-xs"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>

        {/* Avatar list for online users */}
        <div className="flex items-center gap-1">
          {onlineUsers.slice(0, 3).map((u) => {
            const initial = u.name.trim().charAt(0).toUpperCase();
            const isSup = u.role === 'supervisor';
            return (
              <span
                key={u.id}
                title={`${u.name} (${u.role}) — Online`}
                className={cx(
                  'inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold border shadow-xs',
                  isSup
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
                )}
              >
                {initial}
              </span>
            );
          })}
        </div>

        <span className="font-semibold text-ink-2 hidden sm:inline">
          {count} Online
        </span>
      </button>

      {/* Live Collaborator Popover */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)]/95 backdrop-blur-xl shadow-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-base">👥</span>
                <div>
                  <h4 className="text-xs font-bold text-ink">Active Collaborators</h4>
                  <p className="text-[10px] text-ink-3">Live sessions viewing this roster</p>
                </div>
              </div>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400">
                {onlineUsers.length} online
              </span>
            </div>

            {/* Online Users List */}
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {onlineUsers.map((u) => (
                <UserPresenceCard key={u.id} user={u} sessionUserId={session?.id} />
              ))}
            </div>

            {!isSupervisor && (
              <div className="p-2 rounded-xl bg-[var(--surface-2)]/80 text-[11px] text-ink-3">
                <span className="font-semibold text-ink">Collaborator Mode:</span> Your schedule edits sync automatically with all team members in real-time.
              </div>
            )}

            <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between text-[10px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="text-emerald-400">⚡</span> Real-time live synchronization active
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserPresenceCard({
  user,
  sessionUserId,
}: {
  user: PresenceUser;
  sessionUserId?: string;
}) {
  const isSelf = user.id === sessionUserId;
  const displayName = user.name.replace(/ \/ Operations Lead/g, '');
  const initial = displayName.trim().charAt(0).toUpperCase();
  const isSup = user.role === 'supervisor';

  return (
    <div
      className={cx(
        'flex items-center justify-between p-2.5 rounded-xl transition-colors text-xs',
        isSelf
          ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/25'
          : 'bg-[var(--surface-2)]/90 border border-[var(--line)]',
      )}
    >
      <div className="flex items-center gap-2.5 truncate">
        <span
          className={cx(
            'w-7 h-7 rounded-full font-bold text-[11px] grid place-items-center shrink-0 border shadow-xs',
            isSup
              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          )}
        >
          {initial}
        </span>
        <div className="truncate">
          <div className="font-semibold text-ink text-[12px] truncate flex items-center gap-1.5">
            <span>{displayName}</span>
            {isSelf && (
              <span className="text-[10px] text-ink-3 font-normal px-1 rounded bg-[var(--surface-3)]">
                You
              </span>
            )}
          </div>
          <div className="text-[10px] text-ink-3 uppercase font-semibold tracking-wider">
            {user.role}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 pl-2">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Live</span>
        </span>
      </div>
    </div>
  );
}
