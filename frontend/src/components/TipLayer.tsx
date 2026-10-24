import { useEffect, useRef, useState } from 'react';

/**
 * Hover explanations. Put `data-tip="Title\nExplanation text"` on any element (HTML or SVG)
 * and this layer shows it on hover: bold title, then the explanation. One layer serves a whole
 * page, positions itself above the element (below when there is no room) and is never clipped
 * by a scrolling container.
 */
interface TipState {
  x: number;
  top: number;
  bottom: number;
  title: string;
  body: string[];
}

const WIDTH = 300;

/**
 * Reads an element's tip. A plain `title="…"` is taken over too (and removed, so the browser's
 * slow native tooltip doesn't also appear): "Name: what it does" splits into a bold name and text.
 */
function read(el: Element): Pick<TipState, 'title' | 'body'> | null {
  let raw = el.getAttribute('data-tip');
  if (!raw) {
    const native = el.getAttribute('title');
    if (!native) return null;
    el.setAttribute('data-tip', native);
    el.removeAttribute('title');
    raw = native;
  }
  let [title, ...body] = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (title && !body.length) {
    const m = title.match(/^(.{2,48}?)(?::| — )\s+(.+)$/);
    if (m) [title, body] = [m[1], [m[2]]];
  }
  return title ? { title, body } : null;
}

export function TipLayer({ pausedOutsideHeader = false }: { pausedOutsideHeader?: boolean }) {
  const [tip, setTip] = useState<TipState | null>(null);
  // On pages that opt out, only the top navigation bar (<header>) keeps its tips
  const paused = useRef(pausedOutsideHeader);
  paused.current = pausedOutsideHeader;
  useEffect(() => {
    if (pausedOutsideHeader) setTip(null);
  }, [pausedOutsideHeader]);

  useEffect(() => {
    let current: Element | null = null;
    const show = (el: Element) => {
      const t = read(el);
      if (!t) return;
      const r = el.getBoundingClientRect();
      const half = WIDTH / 2 + 8;
      setTip({ ...t, x: Math.min(window.innerWidth - half, Math.max(half, r.left + r.width / 2)), top: r.top, bottom: r.bottom });
    };
    const over = (e: MouseEvent) => {
      let el = (e.target as Element | null)?.closest?.('[data-tip],[title]') ?? null;
      // Leave the page's own (native) tooltips alone while paused
      if (el && paused.current && !el.closest('header')) el = null;
      if (el === current) return;
      current = el;
      if (el) show(el);
      else setTip(null);
    };
    const hide = () => {
      current = null;
      setTip(null);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseleave', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseleave', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  const below = tip.top < 150;
  return (
    <div
      role="tooltip"
      className="no-print pointer-events-none fixed z-[100] rounded-xl border border-[var(--line-strong)] bg-[var(--surface-3)] px-3.5 py-2.5 shadow-xl"
      style={{
        left: tip.x,
        width: WIDTH,
        top: below ? tip.bottom + 10 : tip.top - 10,
        transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
      }}
    >
      <div className="text-[12.5px] font-semibold text-ink leading-snug">{tip.title}</div>
      {tip.body.map((line, i) => (
        <div key={i} className="mt-1 text-[12px] leading-relaxed text-ink-2">
          {line}
        </div>
      ))}
    </div>
  );
}
