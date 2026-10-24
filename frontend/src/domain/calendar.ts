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


/**
 * Which line a roster file is about, from its name: "TSM_SLV_Line 4-6-Roster" → Line 4 & 6,
 * "Line_5_Roster_SEP_2026" → Line 5. A name that mentions several lines (4, 5 and 6) or none
 * says nothing.
 */
export function lineFromFileName(fileName: string): 'line 4 & 6' | 'line 5' | null {
  const base = fileName.replace(/\.[^/.]+$/, '');
  const has = (d: string) => new RegExp(`(^|[^0-9])${d}([^0-9]|$)`).test(base);
  if (has('4') && has('6') && !has('5')) return 'line 4 & 6';
  if (has('5') && !has('4') && !has('6')) return 'line 5';
  return null;
}

/**
 * Which sheet of a roster workbook to open, so the FILE the person chose decides:
 *  1. a sheet named like the file (and only one does),
 *  2. otherwise the newest month of the line the file's NAME is about,
 *  3. otherwise (name says nothing) the newest month of the line open in the app,
 *  4. otherwise the newest month of any sheet.
 */
export function pickRosterSheet(sheetNames: string[], fileName: string, openLineName: string): string {
  const clean = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normBase = clean(fileName.replace(/\.[^/.]+$/, '').trim());

  const exact = sheetNames.find((n) => clean(n) === normBase);
  if (exact) return exact;
  if (normBase.length > 3) {
    // Only when ONE sheet fits: a generic name like "roster.xlsx" fits every sheet, so it decides nothing
    const partial = sheetNames.filter((n) => {
      const c = clean(n);
      return c.length > 5 && (c.includes(normBase) || normBase.includes(c));
    });
    if (partial.length === 1) return partial[0];
  }

  const wanted = (lineFromFileName(fileName) ?? openLineName.toLowerCase()).trim();
  const wants46 = wanted.includes('4') && wanted.includes('6');
  const scored = sheetNames.map((name) => {
    const meta = parseSheetMeta(name);
    const line = meta.lineName?.toLowerCase().trim() ?? '';
    return {
      name,
      score: (meta.year ?? 0) * 100 + (meta.month ?? 0),
      lineMatch: !!line && ((wants46 && line.includes('4') && line.includes('6')) || line === wanted),
    };
  });
  const onLine = scored.filter((x) => x.lineMatch).sort((a, b) => b.score - a.score);
  if (onLine.length) return onLine[0].name;
  return scored.sort((a, b) => b.score - a.score)[0]?.name ?? sheetNames[0];
}
