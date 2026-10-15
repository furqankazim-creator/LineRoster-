import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { cx } from '@/components/ui';

import { useAuth } from './authStore';
import type { LoginNotification } from './types';

function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markAllNotificationsRead,
    clearNotifications,
    dismissNotification,
  } = useAuth();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!drawerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const handleOpen = () => {
    setOpen((v) => !v);
    if (!open && unreadCount > 0) {
      markAllNotificationsRead();
    }
  };

  return (
    <div className="relative" ref={drawerRef}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={handleOpen}
        title={unreadCount > 0 ? `${unreadCount} new alerts` : 'Notifications & Login Alerts'}
        aria-label="Login Notifications"
        className={cx(
          'relative grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] transition-colors select-none',
          unreadCount > 0
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
            : 'text-ink-2 hover:text-ink hover:bg-[var(--surface-3)]',
        )}
      >
        <span className="text-[15px]" role="img" aria-label="Bell">
          🔔
        </span>

        {/* Unread badge count */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[9.5px] font-extrabold text-white shadow-md animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Flyout Drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed inset-x-2 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full mt-2 z-50 sm:w-96 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)]/95 backdrop-blur-xl shadow-2xl p-4 space-y-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🚨</span>
                <div>
                  <h3 className="text-xs font-bold text-ink">Live Login &amp; Security Alerts</h3>
                  <p className="text-[10px] text-ink-3">Instant notifications when links are opened</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={clearNotifications}
                    className="text-[10.5px] text-ink-3 hover:text-rose-400 px-1.5 py-0.5 rounded transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-ink-3 hover:text-ink p-1 text-xs"
                >
                  ✕
                </button>
              </div>
            </div>


            {/* Notification list */}
            <div className="divide-y divide-[var(--line)]/50 max-h-72 overflow-y-auto space-y-1">
              {notifications.length === 0 ? (
                <div className="py-8 text-center space-y-1">
                  <span className="text-2xl opacity-40">🔕</span>
                  <p className="text-xs font-medium text-ink-3">No notifications yet</p>
                  <p className="text-[10px] text-ink-3">You will receive an alert whenever someone logs in.</p>
                </div>
              ) : (
                notifications.map((item) => (
                  <NotificationItem
                    key={item.id}
                    item={item}
                    onDismiss={dismissNotification}
                  />
                ))
              )}
            </div>

            {/* Footer status */}
            <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between text-[10.5px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Audio Chime: Active
              </span>
              <span>Real-Time Monitor</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationItem({
  item,
  onDismiss,
}: {
  item: LoginNotification;
  onDismiss?: (id: string) => void;
}) {
  const isLogin = item.type === 'login';
  const isLogout = item.type === 'logout';

  return (
    <div
      className={cx(
        'group relative py-2.5 px-2.5 rounded-xl transition-colors space-y-1 text-xs',
        !item.read ? 'bg-[var(--accent)]/5' : 'hover:bg-[var(--surface-2)]/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">
            {isLogin ? '👤' : isLogout ? '🚪' : item.type === 'security' ? '🛡️' : '⚡'}
          </span>
          <span className="font-bold text-ink text-[12px]">
            {item.userName.replace(/ \/ Operations Lead/g, '')}
          </span>
          <span
            className={cx(
              'text-[9.5px] uppercase font-mono px-1.5 py-0.2 rounded font-bold border',
              isLogout
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                : 'bg-[var(--surface-3)] border-[var(--line)] text-ink-2',
            )}
          >
            {isLogout ? 'logout' : item.userRole}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-ink-3">{formatTimeAgo(item.timestamp)}</span>
          {onDismiss && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(item.id);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-3 hover:text-rose-400 p-0.5 rounded text-[11px]"
              title="Dismiss notification"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <p className="text-[11.5px] text-ink-2 font-medium leading-snug">
        {item.message.replace(/ \/ Operations Lead/g, '')}
      </p>

      {item.details && (
        <p className="text-[10.5px] text-ink-3 font-mono leading-tight">{item.details}</p>
      )}
    </div>
  );
}

