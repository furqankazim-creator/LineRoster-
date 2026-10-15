import Groq from 'groq-sdk';

import { config } from './config.ts';
import {
  daysInMonth, setCell, summarise, validate,
  type DomainCode, type DomainEmployee, type DomainLeave, type RosterMonth,
} from './engine.ts';

export interface AiContext {
  roster: RosterMonth;
  employees: DomainEmployee[];
  codes: DomainCode[];
  leave: DomainLeave[];
  /** Live Work Orders / staffing summary from the web app (plain text). */
  workOrders?: string;
}

export interface ProposedAction {
  employeeId: string;
  dayIndex: number; // 0-based
  code: string;
  reason?: string;
}

export interface AiAnswer {
  answer: string;
  actions: ProposedAction[];
  preview: {
    errorsBefore: number;
    errorsAfter: number;
    warningsBefore: number;
    warningsAfter: number;
    rejected: { action: ProposedAction; why: string }[];
  } | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Renders the month for the model as compact text — one line per person —
 * rather than JSON. 22 people × 30 days is ~1k tokens this way; as JSON it
 * would be ten times that and no easier for the model to read.
 */
function describe(ctx: AiContext): string {
  const { roster, employees, codes, leave } = ctx;
  const nDays = daysInMonth(roster.year, roster.month);
  const days = summarise(roster, codes, nDays);
  const issues = validate({ roster, employees, codes, leaveBlocks: leave, nDays });

  const lines: string[] = [];
  lines.push(`Month: ${roster.year}-${String(roster.month).padStart(2, '0')} (${nDays} days). Day 1 is a ${WEEKDAYS[new Date(roster.year, roster.month - 1, 1).getDay()]}.`);
  lines.push('');
  lines.push('Shift codes (id: label, timing, minimum people per day):');
  for (const c of codes) {
    lines.push(`  ${c.id}: ${c.label}, ${c.timing}, min ${c.minHeadcount}${c.isStatus ? ' (non-working status)' : ''}${c.rotates ? ' (rotates)' : ''}`);
  }
  lines.push('  -: day off');
  lines.push('');
  lines.push('People (id | name | default shift | rest days | fixed?) and their month, one character-code per day from day 1:');
  for (const e of employees) {
    const row = roster.cells[e.id]?.map((c) => c.code).join(' ') ?? '';
    const rest = e.restDays.map((d) => WEEKDAYS[d]).join('+');
    lines.push(`  ${e.id} | ${e.name} | ${e.defaultShift} | ${rest} | ${e.pinned ? 'fixed' : 'rotates'}`);
    lines.push(`     ${row}`);
  }
  lines.push('');
  lines.push('Headcount per day (day: M/E/N …):');
  const worked = codes.filter((c) => !c.isStatus && (c.minHeadcount > 0 || days.some((d) => (d.total[c.id] ?? 0) > 0)));
  lines.push('  ' + days.map((d, i) => `${i + 1}:${worked.map((c) => `${c.id}${d.total[c.id] ?? 0}`).join('/')}`).join('  '));
  lines.push('');
  lines.push(`Current issues (${issues.length}):`);
  for (const i of issues.slice(0, 40)) lines.push(`  [${i.severity}] ${i.message}`);
  if (issues.length > 40) lines.push(`  …and ${issues.length - 40} more`);
  if (ctx.workOrders) {
    lines.push('');
    lines.push(ctx.workOrders);
  }
  return lines.join('\n');
}

/**
 * How the ShiftLine app works — so the assistant can answer "how do I…" and
 * "why does it show…" questions, not just questions about the grid.
 */
const APP_GUIDE = `HOW SHIFTLINE WORKS (ALSTOM signalling & communication maintenance, Line 5 / 4&6)
Pages (top bar): Planner, Work Orders, People, Setup. Plus Share Link, notifications, Ask ShiftLine (you).
- Planner: monthly grid per line. Brush codes: M Morning, E Evening, N Night, ML/MT Morning variants, EL/ET Evening variants, NL/NT Night variants, GS General Shift, P Project, LV leave, - rest. "Generate month" builds from people's rules; "Auto-rotate" builds next month. Every edit autosaves in the browser; Ctrl+Z undoes. Insights panel → Issues (Must fix / Worth a look), Coverage, Hours, Fairness. "Show who can cover →" on a shortfall lists people off that day and assigns them in one click.
- People: per line; name, default shift, rest days, rotation, leader, fixed. Line 4 and Line 6 are ONE shared team: their work orders use the people of both lines together.
- Work Orders: imported from Excel (Import Excel). Only the 11 yellow columns are read, by header name: Work Order, Description, Location, Reported Date, Start No Earlier Than, Target Start, Scheduled Start, Finish No Later Than, Div / Depart, Line, Asset Group. Missing columns/blank cells appear in the Import report ("Row 45: Scheduled Start missing").
  Each order is placed on its Scheduled Start date and a shift (its own choice, else CM→Evening, PM needing 4+→Night, otherwise Morning). Available staff = people of the line's team on that shift family that day in the Planner (M/ML/MT count as Morning; GS, leave, rest do not). Demand = sum of crew needed by that day's orders on that shift. Buffer = Available − Demand; negative = staff deficit. People are assigned without double-booking. All of this recalculates live on every Planner edit.
  Statuses: Staffed, Shortfall (some but not enough), Unassigned/Nobody free, No roster (line has no people), Not placed (no valid Scheduled Start or Line). Window checks: "outside window" = Scheduled Start before Start No Earlier Than or after Finish No Later Than; "past FNLT" = Finish No Later Than before today. Target Start and Reported Date are reference (target slip, age).
  Crew size: from Setup → Work Order Resource Standards per line/type/shift (tagged "Setup standard"), or set by hand with −/+ on the row. Work type from Description keywords: fault/repair/breakdown/corrective → CM; ACS/audit → ACS; else PM. "Manage Crew" lets you hand-pick people who are on that shift that day.
- Setup: lines, shift codes (timings, minimum headcount, family/tone), Work Order Resource Standards (Line 4&6 share one set), security (supervisor password, each person's own passcode & link; revoke anytime), backups.
How to fix a work-order deficit: add people to that shift on that day in the Planner (or Insights → Show who can cover → Assign), move the order's shift, or lower its Required People.`;

const SYSTEM = `You are ShiftLine's assistant for a supervisor running a three-shift operation (Morning, Evening, Night) with fixed weekly rest days per person, and the maintenance work orders that need staff on those shifts.

${APP_GUIDE}

Answer plainly and briefly, in the supervisor's terms. Use day numbers, dates, people's names and work order numbers, not internal ids, in the answer text. For questions about work orders, deficits, imports or standards, use the WORK ORDERS section of the context. For "how do I…" questions, give the exact clicks in the app.

If the supervisor asks you to CHANGE the roster, propose the specific cell edits as actions. Each action sets one person on one day to one code. Rules you must respect:
- Never put someone on a day inside their leave block.
- Prefer not to work someone on their rest days; if you must, say so.
- Never schedule Night one day and Morning the next for the same person.
- Keep every shift at or above its minimum on every day.
- People marked "fixed" stay on their current shift unless explicitly asked.

Respond ONLY with JSON of the form:
{"answer": "<plain-English answer>", "actions": [{"employeeId": "<id>", "day": <1-based day number>, "code": "<code>", "reason": "<short why>"}]}
If no change is being requested, "actions" is an empty array. Do not invent employee ids or codes that are not listed.`;

export async function ask(question: string, ctx: AiContext, history: { role: 'user' | 'assistant'; content: string }[] = []): Promise<AiAnswer> {
  if (!config.groqApiKey) {
    throw new Error('GROQ_API_KEY is not set on the server.');
  }
  const groq = new Groq({ apiKey: config.groqApiKey });

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: `ROSTER CONTEXT\n\n${describe(ctx)}` },
    ...history.slice(-6),
    { role: 'user' as const, content: question },
  ];

  // gpt-oss models reason before answering; give them room and keep the
  // reasoning short, or the budget runs out before any JSON is written.
  const base = {
    model: config.groqModel,
    temperature: 0.2,
    max_tokens: 4000,
    messages,
    ...(config.groqModel.includes('gpt-oss') ? { reasoning_effort: 'low' as const } : {}),
  };

  let raw = '';
  try {
    const strict = await groq.chat.completions.create({ ...base, response_format: { type: 'json_object' } });
    raw = strict.choices[0]?.message?.content ?? '';
  } catch (e) {
    // Groq's strict JSON validation occasionally rejects a fine answer; fall
    // back to a free-form completion and pull the JSON object out of it.
    if (!(e instanceof Error && /json/i.test(e.message))) throw e;
    const loose = await groq.chat.completions.create(base);
    raw = loose.choices[0]?.message?.content ?? '';
  }

  let parsed: { answer?: string; actions?: { employeeId?: string; day?: number; code?: string; reason?: string }[] };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return { answer: raw.trim() || 'I could not form an answer — please try rephrasing.', actions: [], preview: null };
  }

  const actions = validateActions(parsed.actions ?? [], ctx);
  return {
    answer: parsed.answer ?? '',
    actions: actions.accepted,
    preview: actions.accepted.length || actions.rejected.length ? preview(actions.accepted, actions.rejected, ctx) : null,
  };
}

/** The first balanced {...} in a string — tolerates prose or code fences around the JSON. */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no json');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unbalanced json');
}

/** Drops anything the model made up: unknown people, codes, or days. */
function validateActions(
  raw: { employeeId?: string; day?: number; code?: string; reason?: string }[],
  ctx: AiContext,
): { accepted: ProposedAction[]; rejected: { action: ProposedAction; why: string }[] } {
  const nDays = daysInMonth(ctx.roster.year, ctx.roster.month);
  const empIds = new Set(ctx.employees.map((e) => e.id));
  const codeIds = new Set([...ctx.codes.map((c) => c.id), '-']);
  const accepted: ProposedAction[] = [];
  const rejected: { action: ProposedAction; why: string }[] = [];

  for (const a of raw) {
    const action: ProposedAction = {
      employeeId: String(a.employeeId ?? ''),
      dayIndex: Number(a.day ?? 0) - 1,
      code: String(a.code ?? ''),
      reason: a.reason,
    };
    if (!empIds.has(action.employeeId)) { rejected.push({ action, why: 'unknown person' }); continue; }
    if (!codeIds.has(action.code)) { rejected.push({ action, why: `unknown code "${action.code}"` }); continue; }
    if (!(action.dayIndex >= 0 && action.dayIndex < nDays)) { rejected.push({ action, why: 'day out of range' }); continue; }
    accepted.push(action);
  }
  return { accepted, rejected };
}

/** Applies the actions to a copy and reports how the issue count moves. */
function preview(actions: ProposedAction[], rejected: { action: ProposedAction; why: string }[], ctx: AiContext): AiAnswer['preview'] {
  const nDays = daysInMonth(ctx.roster.year, ctx.roster.month);
  const count = (r: RosterMonth) => {
    const issues = validate({ roster: r, employees: ctx.employees, codes: ctx.codes, leaveBlocks: ctx.leave, nDays });
    return {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    };
  };
  const before = count(ctx.roster);
  let next = ctx.roster;
  for (const a of actions) next = setCell(next, a.employeeId, a.dayIndex, a.code);
  const after = count(next);
  return {
    errorsBefore: before.errors, errorsAfter: after.errors,
    warningsBefore: before.warnings, warningsAfter: after.warnings,
    rejected,
  };
}
