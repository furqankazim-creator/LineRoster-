import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx-js-style';

import { listWorkOrderSheets, parseWorkOrdersWorkbook } from '@/domain/workload';

const HEADER = ['Work Order', 'Description', 'Location', 'Reported Date', 'Start No Earlier Than', 'Target Start', 'Scheduled Start', 'Finish No Later Than', 'Line'];

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
const row = (id: string) => [id, 'PM job', 'L5-PW', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-09', 'L5'];

describe('work-order sheet choice', () => {
  const buf = workbook({
    Calendar: [['Mon', 'Tue'], ['x', 'y']],
    'List A': [HEADER, row('A1'), row('A2')],
    'List B': [HEADER, row('B1'), row('B2'), row('B3')],
  });

  it('lists only sheets that look like work-order lists', () => {
    expect(listWorkOrderSheets(buf).map((s) => [s.name, s.rows])).toEqual([['List A', 2], ['List B', 3]]);
  });

  it('imports exactly the chosen sheet, not the first', () => {
    const r = parseWorkOrdersWorkbook(buf, undefined, 'List B');
    expect(r.sheetName).toBe('List B');
    expect(r.workOrders.map((w) => w.workOrderId)).toEqual(['B1', 'B2', 'B3']);
  });

  it('never combines sheets: a plain work-order list file imports that one list', () => {
    const r = parseWorkOrdersWorkbook(buf);
    expect(r.sheetName).toBe('List A'); // first list, calendar skipped, List B not merged in
    expect(r.workOrders.map((w) => w.workOrderId)).toEqual(['A1', 'A2']);
  });

  it('opens "List of SEP SNE WOs" when the file has it, and not the other list', () => {
    const f = workbook({
      'List of Work Orders': [HEADER, row('W1'), row('W2')],
      'List of SEP SNE WOs': [HEADER, row('S1'), row('S2'), row('S3')],
      'Maintenance Calender': [['Mon'], ['x']],
    });
    const r = parseWorkOrdersWorkbook(f);
    expect(r.sheetName).toBe('List of SEP SNE WOs');
    expect(r.workOrders.map((w) => w.workOrderId)).toEqual(['S1', 'S2', 'S3']);
  });

  it('imports "List of Work Orders" directly when that is the file\'s list', () => {
    const f = workbook({ 'List of Work Orders': [HEADER, row('W1')], Notes: [['hello']] });
    expect(parseWorkOrdersWorkbook(f).sheetName).toBe('List of Work Orders');
  });
});

describe('dates come out exactly as Excel shows them', () => {
  it('reads a date serial as its own day, not a day early', async () => {
    const { tryParseDate } = await import('@/domain/workload');
    expect(tryParseDate(46290)).toBe('2026-09-25'); // 25-Sep-2026 12:00 AM
    expect(tryParseDate(46289.291666666664)).toBe('2026-09-24'); // 24-Sep-2026 7:00 AM
    expect(tryParseDate(46259.98819444444)).toBe('2026-08-25');
  });

  it('reads day-first text dates', async () => {
    const { tryParseDate } = await import('@/domain/workload');
    expect(tryParseDate('19-08-2026 01:15 AM')).toBe('2026-08-19');
    expect(tryParseDate('21-08-2026 01:00:AM')).toBe('2026-08-21');
  });
});
