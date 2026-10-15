import type { ShiftCode, ShiftTone } from '@/domain/types';

/** CSS custom-property triple backing each shift tone. */
export interface ToneVars {
  bg: string;
  fg: string;
  accent: string;
}

const TONES: Record<ShiftTone, ToneVars> = {
  morning: { bg: 'var(--sh-m-bg)', fg: 'var(--sh-m-ink)', accent: 'var(--sh-m)' },
  evening: { bg: 'var(--sh-e-bg)', fg: 'var(--sh-e-ink)', accent: 'var(--sh-e)' },
  night: { bg: 'var(--sh-n-bg)', fg: 'var(--sh-n-ink)', accent: 'var(--sh-n)' },
  general: { bg: 'var(--sh-gs-bg)', fg: 'var(--sh-gs-ink)', accent: 'var(--sh-gs)' },
  project: { bg: 'var(--sh-p-bg)', fg: 'var(--sh-p-ink)', accent: 'var(--sh-p)' },
  leave: { bg: 'var(--sh-leave-bg)', fg: 'var(--sh-leave-ink)', accent: 'var(--sh-leave)' },
  off: { bg: 'var(--sh-off)', fg: 'var(--sh-off-ink)', accent: 'var(--ink-3)' },
};

export function toneVars(tone: ShiftTone): ToneVars {
  return TONES[tone] ?? TONES.off;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string | undefined): value is string {
  return !!value && HEX.test(value);
}

/**
 * How to draw a code: its own colour when one is set, otherwise its tone.
 *
 * A custom colour is mixed against the theme so one pick works in both dark
 * and light mode: a translucent fill, and text pulled towards the theme's ink
 * so it stays readable.
 */
export function codeVars(code: Pick<ShiftCode, 'tone' | 'color'> | undefined): ToneVars {
  if (!code) return TONES.off;
  if (!isHexColor(code.color)) return toneVars(code.tone);
  const c = code.color;
  return {
    bg: `color-mix(in srgb, ${c} 26%, var(--canvas))`,
    fg: `color-mix(in srgb, ${c} 62%, var(--ink))`,
    accent: c,
  };
}

/** Quick picks for a code's own colour, chosen to stay distinct from each other. */
export const COLOR_SWATCHES = [
  '#e8a33d', '#d9622b', '#c9453b', '#d6457f', '#a64fd1', '#6b5ce7',
  '#3f7fe0', '#2aa9c9', '#23a597', '#3aa45b', '#8aa332', '#8d6e57',
] as const;

export function toneOf(codes: ShiftCode[], id: string): ShiftTone {
  return codes.find((c) => c.id === id)?.tone ?? 'off';
}

export const TONE_OPTIONS: { value: ShiftTone; label: string }[] = [
  { value: 'morning', label: 'Amber (Morning)' },
  { value: 'evening', label: 'Teal (Evening)' },
  { value: 'night', label: 'Indigo (Night)' },
  { value: 'general', label: 'Green (General)' },
  { value: 'project', label: 'Violet (Project)' },
  { value: 'leave', label: 'Red (Leave / status)' },
  { value: 'off', label: 'Muted (Off)' },
];

/**
 * Hex equivalents of the tone palette, for the Excel export.
 *
 * SheetJS writes literal ARGB fills, so the exported workbook can't reference
 * the CSS variables — these are the light-theme values, which is what a
 * printed or emailed sheet should look like.
 */
/** Mixes a "#RRGGBB" colour towards white (t > 0) or black (t < 0), as ARGB. */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const ch = (v: number) => Math.round(v + (target - v) * k).toString(16).padStart(2, '0');
  return `FF${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`.toUpperCase();
}

/** Excel fill and font for a code: its own colour when set, else its tone's. */
export function exportColors(code: Pick<ShiftCode, 'tone' | 'color'> | undefined): { fill: string; font: string } {
  if (!code) return EXPORT_COLORS.off;
  if (!isHexColor(code.color)) return EXPORT_COLORS[code.tone] ?? EXPORT_COLORS.off;
  return { fill: shade(code.color, 0.6), font: shade(code.color, -0.55) };
}

export const EXPORT_COLORS: Record<ShiftTone, { fill: string; font: string }> = {
  morning: { fill: 'FFF3D9A6', font: 'FF6B4200' },
  evening: { fill: 'FFB9E8EA', font: 'FF05494C' },
  night: { fill: 'FFC8CEFB', font: 'FF20297E' },
  general: { fill: 'FFC3E6CE', font: 'FF14512C' },
  project: { fill: 'FFE0CCF7', font: 'FF4A1D79' },
  leave: { fill: 'FFF7C2C7', font: 'FF7E0F1A' },
  off: { fill: 'FFE9EBEF', font: 'FF8A93A6' },
};
