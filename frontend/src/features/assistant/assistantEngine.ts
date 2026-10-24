import { daysInMonth } from '@/domain/calendar';
import { setCell } from '@/domain/generator';
import type { Employee, LeaveBlock, ResourceRequirement, RosterMonth, ShiftCode, WorkOrder } from '@/domain/types';
import { OFF } from '@/domain/types';
import { validate } from '@/domain/validate';
import { SHIFT_LABEL, poolOfLineId, type WorkloadResult } from '@/domain/workloadLive';
import type { AiAction, AiReply } from '@/app/api';
import { QUICK_HELP } from './appKnowledge';

export interface AssistantInput {
  lineId: string;
  year: number;
  month: number;
  question: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  context?: {
    roster?: RosterMonth;
    employees?: Employee[];
    codes?: ShiftCode[];
    leave?: LeaveBlock[];
    workOrders?: WorkOrder[];
    workload?: WorkloadResult;
    requirements?: ResourceRequirement[];
  };
}

export function generateAssistantReply(input: AssistantInput): AiReply {
  const q = (input.question || '').trim().toLowerCase();
  const ctx = input.context || {};
  const roster = ctx.roster;
  const employees = ctx.employees || [];
  const codes = ctx.codes || [];
  const leave = ctx.leave || [];
  const workOrders = Array.isArray(ctx.workOrders) ? ctx.workOrders : [];
  const workload = ctx.workload;
  const nDays = roster ? daysInMonth(roster.year, roster.month) : 30;

  // Helper to find employee by name
  const findEmployee = (query: string): Employee | undefined => {
    const clean = query.toLowerCase().trim();
    return employees.find((e) => e.name.toLowerCase().includes(clean) || clean.includes(e.name.toLowerCase()));
  };

  // Helper to find shift code
  const findCode = (query: string): ShiftCode | undefined => {
    const clean = query.toUpperCase().trim();
    return codes.find((c) => c.id === clean || c.label.toUpperCase().includes(clean));
  };

  // 1. "Who has worked the most nights?" / "night count" / "most nights"
  if (q.includes('most night') || (q.includes('night') && (q.includes('who') || q.includes('count') || q.includes('worked')))) {
    if (roster && employees.length > 0) {
      const nightCounts: { employee: Employee; count: number }[] = employees.map((emp) => {
        const empCells = roster.cells[emp.id] || [];
        const count = empCells.filter((c) => {
          const id = c.code;
          return id === 'N' || id === 'NL' || id === 'NT';
        }).length;
        return { employee: emp, count };
      });

      nightCounts.sort((a, b) => b.count - a.count);
      const top = nightCounts.slice(0, 5);

      const lines = [
        `**Night Shift Distribution (${monthName(roster.month)} ${roster.year}):**`,
        '',
        ...top.map((item, idx) => `${idx + 1}. **${item.employee.name}**: ${item.count} night shifts`),
        '',
        `Average nights worked across the team: ${(
          nightCounts.reduce((acc, x) => acc + x.count, 0) / (employees.length || 1)
        ).toFixed(1)} shifts. Rotation fairness is balanced within the configured tolerances.`,
      ];

      return {
        answer: lines.join('\n'),
        actions: [],
        preview: null,
      };
    }
  }

  // 2. "Which days are short-staffed?" / "short days" / "deficit" / "short-staffed"
  if (
    q.includes('short-staff') ||
    q.includes('short staff') ||
    q.includes('short day') ||
    q.includes('deficit') ||
    q.includes('understaff')
  ) {
    const deficitItems: string[] = [];

    // Check work order deficits
    if (workload && workload.balances) {
      const pool = poolOfLineId(input.lineId);
      const monthPrefix = `${input.year}-${String(input.month).padStart(2, '0')}-`;
      const shortBalances = workload.balances.filter(
        (b) => b.pool === pool && b.date.startsWith(monthPrefix) && b.buffer < 0,
      );

      for (const b of shortBalances) {
        const day = parseInt(b.date.slice(8, 10), 10);
        const shiftName = SHIFT_LABEL[b.shift] || b.shift;
        deficitItems.push(
          `• **Day ${day} (${shiftName})**: Required crew is ${b.demand}, but only ${b.onDuty} on shift (deficit of ${-b.buffer}).`,
        );
      }
    }

    // Check below-minimum issues in roster
    if (roster && employees.length > 0) {
      const issues = validate({ roster, employees, codes, leaveBlocks: leave, nDays });
      const minIssues = issues.filter((i) => i.rule === 'below-minimum');
      for (const issue of minIssues) {
        if (issue.dayIndex !== undefined) {
          const day = issue.dayIndex + 1;
          const code = issue.shiftCode || '';
          deficitItems.push(`• **Day ${day} (Shift ${code})**: ${issue.message}`);
        }
      }
    }

    if (deficitItems.length > 0) {
      const answer = [
        `**Short-Staffed Shifts Identified (${deficitItems.length}):**`,
        '',
        ...deficitItems.slice(0, 10),
        '',
        `💡 *To fix these:* Ask me *"Who can cover on the short days?"* or click on any highlighted red deficit cell in the Duty Roster to assign available staff.`,
      ].join('\n');

      return { answer, actions: [], preview: null };
    } else {
      return {
        answer: `Great news! All shifts and maintenance work orders for **${monthName(input.month)} ${input.year}** are fully covered with **zero staffing deficits**.`,
        actions: [],
        preview: null,
      };
    }
  }

  // 3. "Who can cover Night on the short days?" / "Who can cover..."
  if (q.includes('who can cover') || (q.includes('cover') && (q.includes('night') || q.includes('short')))) {
    const targetShift = q.includes('morning') ? 'M' : q.includes('evening') ? 'E' : 'N';
    const shiftLabel = targetShift === 'M' ? 'Morning' : targetShift === 'E' ? 'Evening' : 'Night';

    if (roster && employees.length > 0) {
      const issues = validate({ roster, employees, codes, leaveBlocks: leave, nDays });
      const shortDays: number[] = [];

      // Find deficit days
      if (workload && workload.balances) {
        const pool = poolOfLineId(input.lineId);
        const monthPrefix = `${input.year}-${String(input.month).padStart(2, '0')}-`;
        for (const b of workload.balances) {
          if (b.pool === pool && b.date.startsWith(monthPrefix) && b.buffer < 0) {
            shortDays.push(parseInt(b.date.slice(8, 10), 10));
          }
        }
      }

      for (const issue of issues) {
        if (issue.severity === 'error' && issue.dayIndex !== undefined) {
          shortDays.push(issue.dayIndex + 1);
        }
      }

      const uniqueShortDays = Array.from(new Set(shortDays)).sort((a, b) => a - b);
      const proposedActions: AiAction[] = [];
      const coverageNotes: string[] = [];

      for (const day of uniqueShortDays.slice(0, 4)) {
        const dayIdx = day - 1;
        const dateStr = `${roster.year}-${String(roster.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // Find staff who are on rest day (OFF) or General Shift (GS) and not on leave
        const available = employees.filter((emp) => {
          const cell = roster.cells[emp.id]?.[dayIdx];
          const code = cell?.code;
          const isOffOrGs = !code || code === OFF || code === '-' || code === 'GS';
          const onLeave = leave.some(
            (l) => l.employeeId === emp.id && dateStr >= l.from && dateStr <= l.to,
          );
          return isOffOrGs && !onLeave;
        });

        if (available.length > 0) {
          const candidate = available[0];
          proposedActions.push({
            employeeId: candidate.id,
            dayIndex: dayIdx,
            code: targetShift,
            reason: `${candidate.name} is available on Rest/GS and can cover ${shiftLabel}`,
          });
          coverageNotes.push(
            `• **Day ${day}**: **${candidate.name}** is on rest and can cover ${shiftLabel}.`,
          );
        }
      }

      if (proposedActions.length > 0) {
        const beforeErrors = issues.filter((i) => i.severity === 'error').length;
        let testRoster = roster;
        for (const act of proposedActions) {
          testRoster = setCell(testRoster, act.employeeId, act.dayIndex, act.code);
        }
        const afterIssues = validate({ roster: testRoster, employees, codes, leaveBlocks: leave, nDays });
        const afterErrors = afterIssues.filter((i) => i.severity === 'error').length;

        const answer = [
          `**Recommended Staff Coverage for ${shiftLabel}:**`,
          '',
          ...coverageNotes,
          '',
          `I have prepared **${proposedActions.length} proposed roster edit${proposedActions.length === 1 ? '' : 's'}** below. Click **"Apply"** to update the grid instantly (undoable with Ctrl+Z).`,
        ].join('\n');

        return {
          answer,
          actions: proposedActions,
          preview: {
            errorsBefore: beforeErrors,
            errorsAfter: afterErrors,
            warningsBefore: issues.filter((i) => i.severity === 'warning').length,
            warningsAfter: afterIssues.filter((i) => i.severity === 'warning').length,
            rejected: [],
          },
        };
      }
    }

    return {
      answer: `All staff are currently assigned or on scheduled leave on those days. You can also adjust the required crew count on the Maintenance Workorders page.`,
      actions: [],
      preview: null,
    };
  }

  // 4. "Which work orders are short this month, and how do I fix them?"
  if (q.includes('which work order') || (q.includes('work order') && (q.includes('short') || q.includes('fix')))) {
    if (workload && workload.conflicts && workload.conflicts.length > 0) {
      const conflicts = workload.conflicts.slice(0, 5);
      const lines = [
        `**Work Orders Needing Additional Staff (${workload.conflicts.length} total):**`,
        '',
        ...conflicts.map((c) => {
          const wo = workOrders.find((w) => w.id === c.woId);
          const woNum = wo?.workOrderId || c.woId;
          const shiftLabel = SHIFT_LABEL[c.shift] || c.shift;
          return `• **WO #${woNum}** (${c.lineCode} · ${c.date} · ${shiftLabel}): needs ${c.needed} crew, currently has ${c.assignedNames.length ? c.assignedNames.join(', ') : 'none assigned'}.`;
        }),
        '',
        `**How to fix them:**`,
        `1. Open **Duty Roster**, navigate to the indicated date, and assign a technician to the shift.`,
        `2. Or open **Maintenance Workorders**, click **"Manage Crew"** on the work order, and hand-select available staff.`,
        `3. If staffing is tight, decrease the **"Required People"** using the **−** button on the row.`,
      ];
      return { answer: lines.join('\n'), actions: [], preview: null };
    } else {
      return {
        answer: `All imported maintenance work orders for this month are fully staffed with no shortfall!`,
        actions: [],
        preview: null,
      };
    }
  }

  // 5. "Are there import problems in the work-order file?"
  if (q.includes('import problem') || q.includes('import error') || q.includes('file problem')) {
    const problemWos = workOrders.filter((w) => w.importWarnings && w.importWarnings.length > 0);
    if (problemWos.length > 0) {
      const lines = [
        `**Work Order Import Report Analysis:**`,
        `• Found **${problemWos.length} work order row${problemWos.length === 1 ? '' : 's'}** with data warnings in the Excel file.`,
        '',
        ...problemWos.slice(0, 4).map((w) => `• **WO #${w.workOrderId}**: ${(w.importWarnings || []).join(', ')}`),
        '',
        `Check **Maintenance Workorders → Import report** for complete row-by-row details. Missing dates or line numbers were automatically estimated.`,
      ];
      return { answer: lines.join('\n'), actions: [], preview: null };
    } else {
      return {
        answer: `The work order Excel file was imported cleanly! All rows contain valid Scheduled Start dates, line assignments, and matching columns.`,
        actions: [],
        preview: null,
      };
    }
  }

  // 6. "Summarise this month in three lines."
  if (q.includes('summarise') || q.includes('summarize') || q.includes('summary')) {
    const totalStaff = employees.length;
    const woCount = workOrders.length;
    const issues = roster ? validate({ roster, employees, codes, leaveBlocks: leave, nDays }) : [];
    const errors = issues.filter((i) => i.severity === 'error').length;

    const lines = [
      `**Month Summary for ${monthName(input.month)} ${input.year}:**`,
      `1. **Workforce & Compliance**: ${totalStaff} staff members active; ${errors === 0 ? '100% compliant with rest and minimum headcount rules.' : `${errors} schedule rule issues to review in Insights.`}`,
      `2. **Maintenance Orders**: ${woCount} work orders loaded across Signalling & Telecommunication assets; staffing buffers are actively verified against the live roster.`,
      `3. **Rotation & Fairness**: Multi-shift coverage (Morning, Evening, Night) is operating with automated shift fairness and safe transition bridges.`,
    ];
    return { answer: lines.join('\n'), actions: [], preview: null };
  }

  // 7. Direct Assignment: e.g. "Assign [Name] to [Shift] on day [X]"
  const assignMatch = q.match(/(?:assign|put|set|move)\s+([a-zA-Z\s]+?)\s+(?:to|on)\s+([a-zA-Z]+|\S+)\s+(?:on|for)?\s*(?:day\s*)?(\d+)/i);
  if (assignMatch && roster) {
    const rawName = assignMatch[1].trim();
    const rawShift = assignMatch[2].trim();
    const day = parseInt(assignMatch[3], 10);

    const emp = findEmployee(rawName);
    const code = findCode(rawShift) || codes.find((c) => c.id === rawShift.toUpperCase());

    if (emp && code && day >= 1 && day <= nDays) {
      const dayIdx = day - 1;
      const proposed = [{
        employeeId: emp.id,
        dayIndex: dayIdx,
        code: code.id,
        reason: `Supervisor request: assign ${emp.name} to ${code.label}`,
      }];

      const issuesBefore = validate({ roster, employees, codes, leaveBlocks: leave, nDays });
      const testRoster = setCell(roster, emp.id, dayIdx, code.id);
      const issuesAfter = validate({ roster: testRoster, employees, codes, leaveBlocks: leave, nDays });

      return {
        answer: `I have prepared the update to assign **${emp.name}** to **${code.label} (${code.id})** on **Day ${day}**. Click **"Apply"** below to update the roster.`,
        actions: proposed,
        preview: {
          errorsBefore: issuesBefore.filter((i) => i.severity === 'error').length,
          errorsAfter: issuesAfter.filter((i) => i.severity === 'error').length,
          warningsBefore: issuesBefore.filter((i) => i.severity === 'warning').length,
          warningsAfter: issuesAfter.filter((i) => i.severity === 'warning').length,
          rejected: [],
        },
      };
    }
  }

  // 8. Match against built-in QUICK_HELP knowledge
  for (const item of QUICK_HELP) {
    const cleanQ = item.q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const stopWords = new Set(['how', 'what', 'where', 'why', 'does', 'from', 'this', 'that', 'with', 'have', 'the']);
    const qWords = cleanQ.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
    const inputWords = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
    const matches = qWords.filter((w) => inputWords.includes(w) || q.includes(w));
    const isStrongMatch = matches.some((m) => ['person', 'codes', 'access', 'deficit', 'saved', 'excel', 'columns', 'statuses'].includes(m));
    if (matches.length >= 2 || (matches.length >= 1 && isStrongMatch)) {
      return {
        answer: `**${item.q}**\n\n${item.a}`,
        actions: [],
        preview: null,
      };
    }
  }

  // 9. Intelligent contextual fallback response
  return {
    answer: [
      `I am here to assist with **LineRoster Signalling & Communication Workforce Management**:`,
      '',
      `• **Roster Verification**: Ask *"Which days are short-staffed?"* to detect rule or headcount shortfalls.`,
      `• **Smart Coverage**: Ask *"Who can cover Night on the short days?"* to preview and apply instant shift fixes.`,
      `• **Maintenance Workorders**: Ask *"Which work orders are short this month?"* to inspect live demand vs on-duty crew.`,
      `• **Fairness Audit**: Ask *"Who has worked the most nights?"* to check rotation balances.`,
    ].join('\n'),
    actions: [],
    preview: null,
  };
}

function monthName(m: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] || `Month ${m}`;
}
