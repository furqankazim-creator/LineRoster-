/**
 * Switches between dark and light with an animation instead of a hard cut.
 *
 * Where the browser supports view transitions, the new theme spreads out as a
 * circle from the toggle button. Elsewhere every colour eases across instead.
 * Anyone who has asked their system for reduced motion gets the instant switch.
 */

type Theme = 'dark' | 'light';

const DURATION = 480;
const FADE_CLASS = 'theme-fading';

/** The subset of the View Transitions API used here. */
type StartViewTransition = (update: () => void | Promise<void>) => { ready: Promise<void>; finished?: Promise<void> };

export function switchTheme(
  next: Theme,
  origin?: HTMLElement | null,
  onApply?: () => void,
): void {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = next;
    onApply?.();
  };

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    apply();
    return;
  }

  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition?.bind(document);

  if (start) {
    // Grow the new theme outward from the button's exact centre.
    const rect = origin?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 40;
    const y = rect ? rect.top + rect.height / 2 : 28;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    try {
      const transition = start(apply);
      transition.ready
        .then(() => {
          root.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: DURATION,
              easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
              pseudoElement: '::view-transition-new(root)',
            },
          );
        })
        .catch(() => {
          /* Transition handled or aborted */
        });
      return;
    } catch {
      /* Fall back to smooth fade if startViewTransition throws */
    }
  }

  // Fallback: smooth fade for browsers without View Transitions
  root.classList.add(FADE_CLASS);
  apply();
  window.setTimeout(() => root.classList.remove(FADE_CLASS), DURATION);
}

