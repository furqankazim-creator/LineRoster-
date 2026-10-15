import { OFF, type DaySummary, type RosterMonth, type ShiftCode } from './types';

/**
 * Per-day headcounts — the client's sheet rows 27–32.
 *
 * His sheet keeps two tallies that differ: `Engineers Count` counts only the
 * plain M/E/N codes, while `Total Head Counts` adds the support categories
 * (his formula is `COUNTIF(...,"M")+COUNTIF(...,"MT")+COUNTIF(...,"ML")`).
 * `countsAsEngineer` on each shift code reproduces that split.
 */
export function summarise(roster: RosterMonth, codes: ShiftCode[], nDays: number): DaySummary[] {
  const engineerCodes = new Set(codes.filter((c) => c.countsAsEngineer && !c.isStatus).map((c) => c.id));
  const statusCodes = new Set(codes.filter((c) => c.isStatus).map((c) => c.id));

  const days: DaySummary[] = [];
  for (let i = 0; i < nDays; i++) {
    const engineers: Record<string, number> = {};
    const total: Record<string, number> = {};
    let off = 0;
    let onLeave = 0;

    for (const row of Object.values(roster.cells)) {
      const code = row[i]?.code;
      if (!code) continue;
      if (code === OFF) {
        off++;
        continue;
      }
      if (statusCodes.has(code)) {
        onLeave++;
        continue;
      }
      total[code] = (total[code] ?? 0) + 1;
      if (engineerCodes.has(code)) engineers[code] = (engineers[code] ?? 0) + 1;
    }

    days.push({ engineers, total, off, onLeave });
  }
  return days;
}

/** Shifts worth a summary row: worked, rotating or not, but never a status. */
export function summaryCodes(codes: ShiftCode[]): ShiftCode[] {
  return codes.filter((c) => !c.isStatus).sort((a, b) => a.order - b.order);
}

/**
 * How many of each shift a person worked this month.
 *
 * Feeds the fairness table and the auto-rotation debt score — it is the
 * answer to "who has been stuck on nights?".
 */
export function shiftLoad(roster: RosterMonth): Record<string, Record<string, number>> {
  const load: Record<string, Record<string, number>> = {};
  for (const [empId, row] of Object.entries(roster.cells)) {
    const tally: Record<string, number> = {};
    for (const cell of row) {
      if (!cell || cell.code === OFF) continue;
      tally[cell.code] = (tally[cell.code] ?? 0) + 1;
    }
    load[empId] = tally;
  }
  return load;
}

/** Totals across the whole month, for the Insights header tiles. */
export function monthTotals(days: DaySummary[]): {
  shiftDays: Record<string, number>;
  offDays: number;
  leaveDays: number;
} {
  const shiftDays: Record<string, number> = {};
  let offDays = 0;
  let leaveDays = 0;
  for (const d of days) {
    for (const [code, n] of Object.entries(d.total)) shiftDays[code] = (shiftDays[code] ?? 0) + n;
    offDays += d.off;
    leaveDays += d.onLeave;
  }
  return { shiftDays, offDays, leaveDays };
}
