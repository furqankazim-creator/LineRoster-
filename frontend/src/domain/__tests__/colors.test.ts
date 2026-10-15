import { describe, expect, it } from 'vitest';

import { EXPORT_COLORS, codeVars, exportColors, toneVars } from '@/app/tones';

describe('custom code colours', () => {
  it('falls back to the tone palette when no colour is set', () => {
    expect(codeVars({ tone: 'night' })).toEqual(toneVars('night'));
    expect(exportColors({ tone: 'night' })).toEqual(EXPORT_COLORS.night);
  });

  it('ignores a colour that is not #RRGGBB', () => {
    expect(codeVars({ tone: 'morning', color: 'red' })).toEqual(toneVars('morning'));
  });

  it('draws its own colour on screen and in Excel', () => {
    expect(codeVars({ tone: 'morning', color: '#3f7fe0' }).accent).toBe('#3f7fe0');
    const { fill, font } = exportColors({ tone: 'morning', color: '#3f7fe0' });
    expect(fill).toMatch(/^FF[0-9A-F]{6}$/);
    expect(font).toMatch(/^FF[0-9A-F]{6}$/);
    expect(fill).not.toBe(EXPORT_COLORS.morning.fill);
    // A light fill with dark text, so it prints readably.
    expect(parseInt(fill.slice(2), 16)).toBeGreaterThan(parseInt(font.slice(2), 16));
  });
});
