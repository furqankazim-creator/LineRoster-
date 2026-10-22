/**
 * What the assistant knows beyond the open month's roster:
 *  - a compact, live text summary of Work Orders & staffing (sent with every question)
 *  - built-in quick-help answers, shown when the AI server is offline or not signed in
 *
 * The summary is built here, in the browser, from the same live workload the
 * Work Orders page shows — so the assistant and the screen always agree.
 */
import type { Settings } from '@/data/db';
import type { ResourceRequirement, WorkOrder } from '@/domain/types';
import { POOL_LINES, SHIFT_LABEL, poolOfLineId, windowCheck, type WorkloadResult } from '@/domain/workloadLive';

const MAX_LINES = 60;

export function buildWorkOrderContext(input: {
  settings: Settings;
  workOrders: WorkOrder[];
  workload: WorkloadResult;
  requirements: ResourceRequirement[];
}): string {
  const { settings, workOrders, workload, requirements } = input;
  const out: string[] = [];
  const pool = poolOfLineId(settings.activeLineId);
  const monthPrefix = `${settings.activeYear}-${String(settings.activeMonth).padStart(2, '0')}-`;
  const today = new Date().toISOString().slice(0, 10);

  out.push(`WORK ORDERS (live, ${workOrders.length} loaded). Open sheet: ${settings.activeLineId}, ${monthPrefix.slice(0, 7)}. Staff pool of the open line: ${POOL_LINES[pool].label}.`);
  if (!workOrders.length) {
    out.push('No work orders are loaded. They come from Maintenance Workorders → Import Excel (.xlsx).');
    return out.join('\n');
  }

  // Status counts per pool
  for (const p of Object.keys(POOL_LINES) as (keyof typeof POOL_LINES)[]) {
    const rows = Object.values(workload.byWo).filter((a) => POOL_LINES[p].codes.includes(a.lineCode));
    if (!rows.length) continue;
    const n = (s: string) => rows.filter((a) => a.status === s).length;
    out.push(`${POOL_LINES[p].label}: ${rows.length} orders — ${n('OK')} staffed, ${n('SHORT')} short, ${n('UNASSIGNED')} nobody free, ${n('NO_ROSTER')} no people on the line, ${n('UNPLACED')} not placed (no Scheduled Start/Line).`);
  }

  // Deficit days (pool + date + shift), open month first
  const deficits = workload.balances
    .filter((b) => b.buffer < 0)
    .sort((a, b) => Number(!(a.pool === pool && a.date.startsWith(monthPrefix))) - Number(!(b.pool === pool && b.date.startsWith(monthPrefix))) || a.date.localeCompare(b.date));
  out.push(`Shift deficits (${deficits.length}) — pool | date | shift | on shift in Duty Roster | crew needed | buffer | work order numbers:`);
  for (const b of deficits.slice(0, 30)) {
    const ids = Object.values(workload.byWo)
      .filter((a) => POOL_LINES[b.pool].codes.includes(a.lineCode) && a.date === b.date && a.shift === b.shift && a.status !== 'OK')
      .map((a) => workOrders.find((w) => w.id === a.woId)?.workOrderId ?? a.woId);
    out.push(`  ${POOL_LINES[b.pool].label} | ${b.date} | ${SHIFT_LABEL[b.shift]} | ${b.onDuty} | ${b.demand} | ${b.buffer} | ${ids.slice(0, 6).join(', ')}`);
  }
  if (deficits.length > 30) out.push(`  …and ${deficits.length - 30} more deficit day-shifts`);

  // Individual problem orders (open sheet first)
  const problems = workload.conflicts.slice(0, MAX_LINES - out.length - 10);
  if (problems.length) {
    out.push('Orders not fully staffed (WO | line | date | shift | needed | assigned | reason):');
    for (const c of problems.slice(0, 20)) {
      const wo = workOrders.find((w) => w.id === c.woId);
      out.push(`  ${wo?.workOrderId ?? c.woId} | ${c.lineCode} | ${c.date} | ${SHIFT_LABEL[c.shift]} | ${c.needed} | ${c.assignedNames.join(', ') || 'none'} | ${c.reason ?? ''}`);
    }
  }

  // Allowed window & import data
  const checks = workOrders.map((w) => windowCheck(w, today));
  if (workOrders.some((w) => w.startNoEarlier || w.finishNoLater)) {
    out.push(`Allowed window: ${checks.filter((c) => c.outsideWindow).length} planned outside Start No Earlier Than → Finish No Later Than; ${checks.filter((c) => c.pastFinish).length} past Finish No Later Than (today ${today}).`);
  } else {
    out.push('Allowed-window dates are not in the loaded data (imported before those columns were read) — re-import the Excel file.');
  }
  const imp = settings.lastWorkOrderImport;
  if (imp) {
    out.push(`Last import: ${imp.fileName}, ${imp.rows} rows, header on row ${imp.headerRow}, ${imp.fileErrors.length} missing columns${imp.fileErrors.length ? ` (${imp.fileErrors.join('; ')})` : ''}, ${imp.problemRows} rows with problems.`);
  }
  const rowProblems = workOrders.flatMap((w) => w.importWarnings ?? []);
  if (rowProblems.length) out.push(`Row problems (first 8): ${rowProblems.slice(0, 8).join(' | ')}`);

  // Crew standards
  const std = requirements
    .filter((r) => r.line !== 'L6')
    .map((r) => `${r.line === 'L4' ? 'L4&6' : r.line} ${r.workType} ${r.shift}=${r.defaultPeopleCount}`);
  if (std.length) out.push(`Crew standards (Setup → Work Order Resource Standards; used when a row has no crew size): ${std.join(', ')}.`);

  return out.join('\n');
}

/** Built-in answers for when the AI server can't be reached. */
export const QUICK_HELP: { q: string; a: string }[] = [
  {
    q: 'How do Duty Roster edits change Maintenance Workorders?',
    a: 'Every work order is checked against the Duty Roster of its own line, on its Scheduled Start date and shift. Available = people on that shift family that day (M, ML, MT count as Morning; GS, leave and rest do not). Demand = crew of that day\'s work orders on that shift. Buffer = Available − Demand. Paint a cell in the Duty Roster and the Work Orders cards, statuses and deficit alerts update immediately — no button.',
  },
  {
    q: 'How do I clear a staff deficit?',
    a: 'Duty Roster → Insights → Issues shows each work-order shortfall ("Day 16 · Morning: need 3, only 2 on Morning"). Click "Show who can cover →" and "Assign" a free person, or paint someone onto that shift yourself. You can also lower "Required People" on the work order. From Work Orders, "Fix in Duty Roster →" on an alert opens the right line and month.',
  },
  {
    q: 'Why does Line 4&6 say "No roster"?',
    a: 'Line 4 and Line 6 are one shared team (Line 4&6), but no people are set up for them yet. Choose Line 4 in the Duty Roster, open People and "Add person" for each team member (default shift + rest days). Line 6 work orders use the same people.',
  },
  {
    q: 'Which Excel columns are read?',
    a: 'Only the 11 yellow columns, matched by header name: Work Order, Description, Location, Reported Date, Start No Earlier Than, Target Start, Scheduled Start, Finish No Later Than, Div / Depart, Line, Asset Group. Everything else is ignored. Missing columns or blank cells are listed in the Import report ("Row 45: Scheduled Start missing"). New columns are added in src/domain/workOrderColumns.ts.',
  },
  {
    q: 'What do the statuses mean?',
    a: 'Staffed = enough people. Shortfall = some assigned, not enough. Unassigned = nobody free, or no people on the line. "Not placed" = the Excel row has no valid Scheduled Start or Line (listed in the Import report). Rows also show "Outside window" (Scheduled Start outside Start No Earlier Than → Finish No Later Than) and "Past FNLT" (Finish No Later Than before today).',
  },
  {
    q: 'Where does a work order\'s crew size come from?',
    a: 'Setup → Work Order Resource Standards (per line, work type and shift) — tagged "Setup standard". Pressing −/+ on a row sets its own number ("↺ Use standard" goes back). Work type (PM/CM/ACS) is read from the Description: fault/repair/breakdown → CM, ACS/audit → ACS, otherwise PM.',
  },
  {
    q: 'How do team members get access?',
    a: 'Share Link (top bar) or Setup → Security: give each person their own passcode and direct link. Only active assigned passcodes unlock the roster; Revoke removes one person. You get a notification and chime when someone logs in, and see who is online.',
  },
  {
    q: 'How do I add a new person or team member?',
    a: 'Open People in the navigation bar. Click "+ Add person", enter their name, employee ID, role, line assignment, and their default shift pattern (Morning, Evening, Night) and rest days. Save to add them to the active roster.',
  },
  {
    q: 'How do I change shift codes?',
    a: 'Open Setup → Shift Codes. You can edit shift definitions, start/end hours, paid hours, and visual color tones.',
  },
  {
    q: 'Is my data saved?',
    a: 'Every edit is saved in this browser automatically (works offline). "Save" also downloads an Excel backup. Setup has backup export/import.',
  },
];

