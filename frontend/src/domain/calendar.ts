import { WEEKDAY_LABELS, type Weekday } from './types';

export { WEEKDAY_LABELS };

/** Number of days in a given 1-based month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** `Date.getDay()` of a given day of the month. */
export function weekdayOf(year: number, month: number, day: number): Weekday {
  return new Date(year, month - 1, day).getDay() as Weekday;
}

export function weekdayLabel(w: Weekday): string {
  return WEEKDAY_LABELS[w];
}

/** "2026-09" — the key used for per-month rotation rules. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** "2026-09-04" */
export function isoDate(year: number, month: number, day: number): string {
  return `${monthKey(year, month)}-${String(day).padStart(2, '0')}`;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_ABBR = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/** Parses a sheet name or title like "SLV_Line 4&6_Roster_SEP_2026", "Line 5_SEP-2026", or "SEPTEMBER 2026 RST L5" into its parts. */
export function parseSheetMeta(title: string): { lineName: string | null; year: number | null; month: number | null } {
  // 1. Line match - prioritize composite line labels like "Line 4 & 6", "Line 4&6", "Line4&6", "L4&6", "L4 & 6"
  let lineName: string | null = null;
  if (/(?:Line|L)\s*4\s*(?:&|and|\+)?\s*6/i.test(title)) {
    lineName = 'Line 4 & 6';
  } else {
    const lineMatch = title.match(/(?:Line|L)\s*(\d+)/i);
    if (lineMatch) {
      lineName = `Line ${lineMatch[1]}`;
    }
  }

  // 2. Month and year match
  let year: number | null = null;
  let month: number | null = null;

  // Pattern: Month word/abbr followed by year (e.g. "SEP-2026", "September 2026", "June_ 2026", "MAY 2026", "AUG_2026")
  const monthYearMatch = title.match(/(?:^|[^A-Za-z])([A-Za-z]{3,9})[-_ ]*(\d{4})/i);
  if (monthYearMatch) {
    const candidateMonth = monthYearMatch[1].slice(0, 3).toUpperCase();
    const idx = MONTH_ABBR.indexOf(candidateMonth);
    if (idx >= 0) {
      month = idx + 1;
      year = Number(monthYearMatch[2]);
    }
  }

  // If year not yet found, look for any 4-digit year 2000-2099
  if (!year) {
    const yr = title.match(/\b(20\d{2})\b/);
    if (yr) year = Number(yr[1]);
  }

  // If month not yet found, search for month abbreviation anywhere
  if (!month) {
    for (let i = 0; i < MONTH_ABBR.length; i++) {
      const abbr = MONTH_ABBR[i];
      const re = new RegExp(`(?:^|[^A-Za-z])${abbr}(?:[A-Za-z]*)(?:$|[^A-Za-z])`, 'i');
      if (re.test(title)) {
        month = i + 1;
        break;
      }
    }
  }

  return { lineName, year, month };
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Column headers for the grid: day number + weekday + weekend flag. */
export interface DayColumn {
  day: number; // 1-based
  index: number; // 0-based
  weekday: Weekday;
  label: string;
  isWeekend: boolean;
}

/**
 * Builds the month's column axis.
 *
 * `weekendDays` is configurable because the client's operation runs on a
 * Fri/Sat weekend, not Sat/Sun — it only tints the column, it does not
 * decide who is off (rest days do that, per person).
 */
export function buildColumns(
  year: number,
  month: number,
  weekendDays: Weekday[] = [5, 6],
): DayColumn[] {
  const n = daysInMonth(year, month);
  const cols: DayColumn[] = [];
  for (let day = 1; day <= n; day++) {
    const weekday = weekdayOf(year, month, day);
    cols.push({
      day,
      index: day - 1,
      weekday,
      label: weekdayLabel(weekday),
      isWeekend: weekendDays.includes(weekday),
    });
  }
  return cols;
}

/** Step a month forward or backward, normalising the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

export function previousMonth(year: number, month: number) {
  return shiftMonth(year, month, -1);
}

/** Inclusive test for an ISO date falling inside an ISO range. */
export function isWithin(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** Today's day-of-month, or null when the given month isn't the current one. */
export function todayIndex(year: number, month: number): number | null {
  const now = new Date();
  if (now.getFullYear() !== year || now.getMonth() + 1 !== month) return null;
  return now.getDate() - 1;
}
