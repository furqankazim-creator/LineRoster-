import { AnimatePresence, motion } from 'framer-motion';
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110 shadow-[0_1px_0_0_rgba(255,255,255,.14)_inset]',
  ghost: 'text-ink-2 hover:text-ink hover:bg-[var(--surface-3)]',
  outline: 'border border-[var(--line-strong)] text-ink hover:bg-[var(--surface-3)]',
  danger: 'bg-[var(--danger)] text-white hover:brightness-110',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-lg',
};

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-[background,color,filter,opacity] duration-150',
        'disabled:opacity-40 disabled:pointer-events-none select-none',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------- Input */

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3',
        'text-[13px] text-ink placeholder:text-ink-3',
        'focus:border-[var(--accent)] focus:outline-none transition-colors',
        className,
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        'h-9 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 pr-7',
        'text-[13px] text-ink appearance-none cursor-pointer',
        'focus:border-[var(--accent)] focus:outline-none transition-colors',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 8l3-3.5' fill='none' stroke='%239aa3b5' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E\")] bg-[length:12px] bg-[right_8px_center] bg-no-repeat",
        className,
      )}
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------- Label */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

/* --------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative px-3 h-7 rounded-md text-[12px] font-medium transition-colors',
            value === o.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId="segmented-thumb"
              className="absolute inset-0 rounded-md bg-[var(--surface-3)] shadow-inset"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span className="relative z-10">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Switch */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-[13px] text-ink"
    >
      <span
        className={cx(
          'relative h-[18px] w-[32px] rounded-full transition-colors',
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          className="absolute top-[3px] h-3 w-3 rounded-full bg-white shadow"
          style={{ left: checked ? 17 : 3 }}
        />
      </span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{ width, maxWidth: '100%' }}
            className="relative w-full max-h-[92vh] sm:max-h-[86vh] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-pop flex flex-col"
          >
            <header className="px-5 pt-4 pb-3 border-b border-[var(--line)]">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
              {description && <p className="mt-1 text-[12.5px] text-ink-2 leading-relaxed">{description}</p>}
            </header>
            <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
            {footer && (
              <footer
                className="px-5 py-3 border-t border-[var(--line)] bg-[var(--surface-2)] flex flex-wrap items-center justify-end gap-2"
                style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
              >
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ Toasts */

interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error' | 'info';
}

const ToastCtx = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 flex flex-col items-center gap-2 no-print">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="flex items-center gap-2.5 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] px-3.5 py-2.5 text-[13px] shadow-pop"
            >
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{
                  background:
                    t.tone === 'ok' ? 'var(--ok)' : t.tone === 'error' ? 'var(--danger)' : 'var(--accent)',
                }}
              />
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* -------------------------------------------------------------- Empty/Misc */

export function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-1 font-mono text-[21px] leading-none tracking-tight" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
  );
}
