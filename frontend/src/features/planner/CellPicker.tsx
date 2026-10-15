import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { useStore } from '@/app/store';
import { useCoarsePointer } from '@/app/useViewport';
import { codeVars } from '@/app/tones';
import { cx } from '@/components/ui';
import { formatHours } from '@/domain/hours';
import { OFF } from '@/domain/types';

/**
 * The shift picker that opens under a clicked cell.
 *
 * Kept flat rather than nested in a menu: every code the client uses is one
 * click away, and each carries its keyboard letter so the shortcut is
 * discoverable rather than documented.
 */
export function CellPicker({
  x,
  y,
  current,
  extra,
  dayInfo,
  onPick,
  onExtra,
  onClose,
}: {
  x: number;
  y: number;
  current: string;
  /** Extra hours already entered on this cell. */
  extra: number;
  /** This day's hours and overtime, shown under the extra-hours control. */
  dayInfo?: { worked: number; overtime: number; extraDuty: boolean };
  onPick: (code: string) => void;
  onExtra: (hours: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { codes } = useStore();
  const [draft, setDraft] = useState(extra ? String(extra) : '');
  useEffect(() => setDraft(extra ? String(extra) : ''), [extra]);

  const commitDraft = () => {
    if (!canAddExtra) return;
    const n = Number(draft);
    const next = Number.isFinite(n) && n > 0 ? Math.min(24, Math.round(n * 2) / 2) : 0;
    if (next !== extra) onExtra(next);
  };
  // Closing by clicking elsewhere unmounts before the input blurs, so the
  // outside-click handler saves a typed value through this ref.
  const commitRef = useRef(commitDraft);
  commitRef.current = commitDraft;
  const touch = useCoarsePointer();

  useEffect(() => {
    // Close on any mousedown outside the picker. The grid opens the picker on
    // mousedown too, so this is registered on the next tick to avoid catching
    // the very event that opened it.
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      commitRef.current();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const width = 232;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2));
  const top = Math.max(8, Math.min(window.innerHeight - 330, y));

  const worked = codes.filter((c) => !c.isStatus);
  const status = codes.filter((c) => c.isStatus);
  // Extra hours only go on a worked shift, never on a day off or leave.
  const onLeave = status.some((c) => c.id === current);
  const canAddExtra = current !== OFF && !onLeave;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      style={{ left, top, width }}
      className="fixed z-50 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] p-2 shadow-pop"
    >
      <div className="grid grid-cols-3 gap-1">
        {worked.map((code) => {
          const tone = codeVars(code);
          return (
            <button
              key={code.id}
              onMouseDown={(e) => { e.preventDefault(); onPick(code.id); }}
              title={`${code.label} · ${code.timing}`}
              className={cx(
                'flex flex-col items-center gap-0.5 rounded-lg py-1.5 transition-[filter] hover:brightness-125',
                current === code.id && 'ring-1 ring-[var(--accent)]',
              )}
              style={{ background: tone.bg, color: tone.fg }}
            >
              <span className="font-mono text-[13px] font-bold">{code.id}</span>
              <span className="text-[9.5px] opacity-80 leading-none">{code.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-1 grid grid-cols-3 gap-1">
        <button
          onMouseDown={(e) => { e.preventDefault(); onPick(OFF); }}
          className={cx(
            'flex flex-col items-center gap-0.5 rounded-lg py-1.5 bg-[var(--sh-off)] text-[var(--sh-off-ink)] hover:brightness-125',
            current === OFF && 'ring-1 ring-[var(--accent)]',
          )}
        >
          <span className="font-mono text-[13px] font-bold">–</span>
          <span className="text-[9.5px] opacity-80 leading-none">Off</span>
        </button>
        {status.map((code) => {
          const tone = codeVars(code);
          return (
            <button
              key={code.id}
              onMouseDown={(e) => { e.preventDefault(); onPick(code.id); }}
              title={code.label}
              className={cx(
                'hatch flex flex-col items-center gap-0.5 rounded-lg py-1.5 hover:brightness-125',
                current === code.id && 'ring-1 ring-[var(--accent)]',
              )}
              style={{ color: tone.fg }}
            >
              <span className="font-mono text-[13px] font-bold">{code.id}</span>
              <span className="text-[9.5px] opacity-80 leading-none">{code.label}</span>
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------ extra hours / overtime */}
      <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Extra hours</span>
          {dayInfo && (
            <span className="font-mono text-[10.5px] text-ink-3">
              {formatHours(dayInfo.worked)}h · OT{' '}
              <span style={{ color: dayInfo.overtime > 0 ? 'var(--warn)' : undefined, fontWeight: dayInfo.overtime > 0 ? 700 : 400 }}>
                {formatHours(dayInfo.overtime)}h
              </span>
            </span>
          )}
        </div>
        {!canAddExtra ? (
          <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
            {onLeave
              ? 'On leave — no extra hours or overtime.'
              : 'Day off — no extra hours. To call them in, pick a shift above; the whole shift counts as overtime.'}
          </p>
        ) : (
        <div className="mt-1.5 flex items-center gap-1">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onMouseDown={(e) => { e.preventDefault(); setDraft(String(n)); onExtra(n); }}
              className={cx(
                'h-7 flex-1 rounded-md bg-[var(--surface)] font-mono text-[11.5px] hover:bg-[var(--surface-3)]',
                extra === n && 'ring-1 ring-[var(--accent)]',
              )}
            >
              +{n}
            </button>
          ))}
          <input
            type="number"
            min={0}
            max={24}
            step={0.5}
            inputMode="decimal"
            placeholder="0"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitDraft(); onClose(); }
            }}
            aria-label="Extra hours"
            className="h-7 w-14 rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 text-center font-mono text-[11.5px] text-ink focus:outline-none focus:border-[var(--accent)]"
          />
          {extra > 0 && (
            <button
              onMouseDown={(e) => { e.preventDefault(); setDraft(''); onExtra(0); }}
              title="Clear extra hours"
              className="h-7 px-1.5 rounded-md text-[11px] text-ink-3 hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
        )}
        {canAddExtra && dayInfo?.extraDuty && (
          <p className="mt-1.5 text-[10.5px] leading-snug text-[var(--warn)]">
            Rest day — the whole shift counts as overtime.
          </p>
        )}
      </div>

      {!touch && <p className="mt-2 px-1 text-[10.5px] text-ink-3 leading-snug">
        Tip: with a cell focused, just type <span className="font-mono text-ink-2">M</span>{' '}
        <span className="font-mono text-ink-2">E</span> <span className="font-mono text-ink-2">N</span>{' '}
        or <span className="font-mono text-ink-2">-</span>.
      </p>}
    </motion.div>
  );
}
