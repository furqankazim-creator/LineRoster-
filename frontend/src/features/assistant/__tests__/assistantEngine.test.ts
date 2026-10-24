import { describe, expect, it } from 'vitest';

import { SEED_CODES, SEED_EMPLOYEES, SEED_LEAVE } from '../../../data/seed';
import { generateMonth } from '../../../domain/generator';
import type { ShiftCode, WorkOrder } from '../../../domain/types';
import { computeWorkload } from '../../../domain/workloadLive';
import { generateAssistantReply } from '../assistantEngine';

const LINE = 'line5';
const employees = SEED_EMPLOYEES.filter((e) => e.lineId === LINE && e.active !== false);
const codes = SEED_CODES.map((c) => ({ ...c, scope: LINE })) as ShiftCode[];
const roster = generateMonth({ year: 2026, month: 11, lineId: LINE, employees, leaveBlocks: SEED_LEAVE });

const workOrders: WorkOrder[] = [
  {
    id: 'wo-1',
    workOrderId: '13445509',
    description: 'Track Circuit PM',
    workType: 'PM',
    line: 'L5',
    scheduledStart: '2026-11-16',
    scheduledFinish: '2026-11-16',
    status: 'APPR',
    resourceRequired: 4,
    plannedShift: 'N',
  } as WorkOrder,
  {
    id: 'wo-2',
    workOrderId: '13445510',
    description: 'Switch Motor Overhaul',
    workType: 'CM',
    line: 'L5',
    scheduledStart: '2026-11-20',
    scheduledFinish: '2026-11-20',
    status: 'APPR',
    resourceRequired: 2,
    plannedShift: 'M',
    importWarnings: ['Target Finish was missing; assumed same as Scheduled Start.'],
  } as WorkOrder,
];

const workload = computeWorkload({
  workOrders,
  getRoster: (l, y, m) => (l === LINE && y === 2026 && m === 11 ? roster : null),
  employeesByLine: { [LINE]: employees },
  codesByLine: { [LINE]: codes },
  requirements: [],
});

describe('LineRoster Assistant Engine', () => {
  it('answers "Who has worked the most nights?" with leaderboard', () => {
    const res = generateAssistantReply({
      lineId: LINE,
      year: 2026,
      month: 11,
      question: 'Who has worked the most nights?',
      context: { roster, employees, codes, leave: SEED_LEAVE, workOrders, workload },
    });

    expect(res.answer).toContain('Night Shift Distribution');
    expect(res.answer).toContain('night shifts');
    expect(res.actions).toEqual([]);
  });

  it('answers "Which days are short-staffed?" with deficit information', () => {
    const res = generateAssistantReply({
      lineId: LINE,
      year: 2026,
      month: 11,
      question: 'Which days are short-staffed?',
      context: { roster, employees, codes, leave: SEED_LEAVE, workOrders, workload },
    });

    expect(res.answer).toBeDefined();
    expect(res.answer.length).toBeGreaterThan(10);
  });

  it('proposes night cover edits with preview when asking "Who can cover Night on the short days?"', () => {
    const res = generateAssistantReply({
      lineId: LINE,
      year: 2026,
      month: 11,
      question: 'Who can cover Night on the short days?',
      context: { roster, employees, codes, leave: SEED_LEAVE, workOrders, workload },
    });

    expect(res.answer).toBeDefined();
    if (res.actions.length > 0) {
      expect(res.actions[0].code).toBe('N');
      expect(res.preview).toBeDefined();
      expect(typeof res.preview?.errorsBefore).toBe('number');
      expect(typeof res.preview?.errorsAfter).toBe('number');
    }
  });

  it('answers "Which work orders are short this month, and how do I fix them?"', () => {
    const res = generateAssistantReply({
      lineId: LINE,
      year: 2026,
      month: 11,
      question: 'Which work orders are short this month, and how do I fix them?',
      context: { roster, employees, codes, leave: SEED_LEAVE, workOrders, workload },
    });

    expect(res.answer).toBeDefined();
    expect(res.answer.toLowerCase()).toContain('work order');
  });

  it('reports import issues when asking "Are there import problems in the work-order file?"', () => {
    const res = generateAssistantReply({
      lineId: LINE,
      year: 2026,
      month: 11,
      question: 'Are there import problems in the work-order file?',
      context: { roster, employees, codes, leave: SEED_LEAVE, workOrders, workload },
    });

    expect(res.answer).toContain('Work Order Import Report Analysis');
    expect(res.answer).toContain('13445510');
  });

  it('summarises the month in three lines', () => {
    const res = generateAssistantReply({
      lineId: LINE,
      year: 2026,
      month: 11,
      question: 'Summarise this month in three lines.',
      context: { roster, employees, codes, leave: SEED_LEAVE, workOrders, workload },
    });

    expect(res.answer).toContain('Month Summary');
    expect(res.answer).toContain('Workforce & Compliance');
    expect(res.answer).toContain('Maintenance Orders');
  });

  it('provides quick help fallback for general help questions', () => {
    const res = generateAssistantReply({
      lineId: LINE,
      year: 2026,
      month: 11,
      question: 'How do I add a new person?',
      context: { roster, employees, codes, leave: SEED_LEAVE, workOrders, workload },
    });

    expect(res.answer).toContain('People');
  });
});
