import logoLight from '@/assets/alstom-logo.png';
import logoDark from '@/assets/alstom-logo-dark.png';

/**
 * Official ALSTOM logo as provided by client.
 * Uses the exact brand mark from the client image:
 * - Light theme: Navy blue letters (#011D70) + red swirl "O" (#DC3223)
 * - Dark theme: Crisp white letters + red swirl "O" (#DC3223)
 */
/** The logo now includes the "mobility by nature" tagline, so it is drawn taller than the old wordmark-only image. */
const SCALE = 1.7;

export function AlstomLogo({
  height = 22,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center shrink-0 select-none ${className}`}>
      {/* Light theme: official navy + red swirl */}
      <img
        src={logoLight}
        alt="ALSTOM"
        style={{ height: `${Math.round(height * SCALE)}px`, width: 'auto' }}
        className="block dark:hidden object-contain pointer-events-none"
        draggable={false}
      />
      {/* Dark theme: white + red swirl */}
      <img
        src={logoDark}
        alt="ALSTOM"
        style={{ height: `${Math.round(height * SCALE)}px`, width: 'auto' }}
        className="hidden dark:block object-contain pointer-events-none"
        draggable={false}
      />
    </span>
  );
}
