import { useEffect, useState } from 'react';

export type Viewport = 'mobile' | 'tablet' | 'desktop';

const query = (v: Viewport) =>
  v === 'mobile' ? '(max-width: 767px)' : v === 'tablet' ? '(min-width: 768px) and (max-width: 1023px)' : '(min-width: 1024px)';

function current(): Viewport {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia(query('mobile')).matches) return 'mobile';
  if (window.matchMedia(query('tablet')).matches) return 'tablet';
  return 'desktop';
}

/** Which layout tier the window is in. Mirrors Tailwind's md / lg breakpoints. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(current);
  useEffect(() => {
    const lists = (['mobile', 'tablet', 'desktop'] as Viewport[]).map((v) => window.matchMedia(query(v)));
    const update = () => setVp(current());
    lists.forEach((l) => l.addEventListener('change', update));
    return () => lists.forEach((l) => l.removeEventListener('change', update));
  }, []);
  return vp;
}

/** True on devices whose primary input can't hover — phones and most tablets. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );
  useEffect(() => {
    const l = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(l.matches);
    l.addEventListener('change', update);
    return () => l.removeEventListener('change', update);
  }, []);
  return coarse;
}
