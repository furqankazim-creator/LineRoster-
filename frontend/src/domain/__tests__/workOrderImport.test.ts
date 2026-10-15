import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';

import { WORK_ORDER_COLUMNS, allWorkOrderColumns, fieldFromHeader, type WorkOrderColumn } from '../workOrderColumns';
import { parseWorkOrdersWorkbook } from '../workload';
import { computeWorkload, windowCheck } from '../workloadLive';

/** Builds an .xlsx from rows of cells (first rows can be titles). Dates stay real Excel dates. */
function workbook(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'WO');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// Deliberately shuffled order + extra columns that must be ignored
const HEADER = [
  'Status', 'Line', 'Work Order', 'Asset', 'Scheduled Start', 'Description', 'Div / Depart', 'Location',
  'SR Affected', 'Start No Earlier Than', 'Finish No Later Than', 'Target Start', 'Reported Date', 'Asset Group', 'Actual Start',
];
const row = (o: Record<string, unknown>) => HEADER.map((h) => o[h] ?? '');
const good = {
  Status: 'APPR', Line: 'L5', 'Work Order': 13445509, Asset: 'X-1', 'Scheduled Start': new Date(2026, 10, 16),
  Description: 'Section L6 12 Monthly Maintenance', 'Div / Depart': 'SLV', Location: 'L5-MV-015', 'SR Affected': 'Y',
  'Start No Earlier Than': new Date(2026, 10, 10), 'Finish No Later Than': new Date(2026, 10, 20),
  'Target Start': new Date(2026, 10, 14), 'Reported Date': new Date(2026, 9, 1), 'Asset Group': 'SIG', 'Actual Start': 'whatever',
};

describe('work-order import reads only the yellow columns, by header name', () => {
  const res = parseWorkOrdersWorkbook(
    workbook([
      ['November Work Orders — export'], // title row above the header
      [],
      HEADER,
      row(good),
      row({ ...good, 'Work Order': 2, Line: 'Depot', 'Scheduled Start': '', Description: 'Axle counter fault' }),
      row({ ...good, 'Work Order': 3, 'Scheduled Start': 'next week', 'Asset Group': '' }),
      [], // blank row is skipped
      row({ ...good, 'Work Order': 13445509, Line: 'Line 6', Description: 'ACS audit' }),
    ]),
  );
  const [a, b, c, d] = res.workOrders;

  it('finds the header below title rows and reads all 11 fields from shuffled columns', () => {
    expect(res.headerRow).toBe(3);
    expect(res.fileErrors).toEqual([]);
    expect(res.workOrders).toHaveLength(4);
    expect(a).toMatchObject({
      workOrderId: '13445509', line: 'L5', description: 'Section L6 12 Monthly Maintenance', department: 'SLV',
      location: 'L5-MV-015', assetGroup: 'SIG', scheduledStart: '2026-11-16', startNoEarlier: '2026-11-10',
      finishNoLater: '2026-11-20', targetStart: '2026-11-14', reportedDate: '2026-10-01',
    });
  });

  it('ignores every other column', () => {
    expect(a.extra).toBeUndefined();
    expect(a.status).toBe('');
    expect(JSON.stringify(a)).not.toContain('whatever');
  });

  it('reports blank and bad cells with the Excel row number — no silent defaults', () => {
    expect(b.importWarnings).toEqual(
      expect.arrayContaining(['Row 5: Line "Depot" is not L4, L5 or L6', 'Row 5: Scheduled Start missing']),
    );
    expect(b.line).toBe('');
    expect(b.scheduledStart).toBe('');
    expect(c.importWarnings).toEqual(
      expect.arrayContaining(['Row 6: Scheduled Start "next week" is not a date', 'Row 6: Asset Group missing']),
    );
  });

  it('flags a duplicated work order number on both rows', () => {
    expect(a.importWarnings?.join()).toMatch(/appears 2 times/);
    expect(d.importWarnings?.join()).toMatch(/Row 8: Work Order 13445509 appears 2 times/);
  });

  it('works out work type from the description and leaves crew to the Setup standards', () => {
    expect(a.workType).toBe('PM');
    expect(b.workType).toBe('CM');
    expect(d.workType).toBe('ACS');
    expect(a).toMatchObject({ crewSource: 'standard', resourceRequired: 0 });
  });

  it('rows with no Scheduled Start or no valid Line are "not placed", not put on a made-up day', () => {
    const live = computeWorkload({
      workOrders: res.workOrders, getRoster: () => null, employeesByLine: {}, codesByLine: {}, requirements: [],
    });
    expect(live.byWo[b.id].status).toBe('UNPLACED');
    expect(live.byWo[c.id].status).toBe('UNPLACED');
    expect(live.conflicts.map((x) => x.woId)).not.toContain(b.id);
    expect(live.balances.every((x) => x.date !== '2026-11-01')).toBe(true);
  });
});

describe('missing columns and the allowed window', () => {
  it('a configured column missing from the file is a whole-file error', () => {
    const header = HEADER.filter((h) => h !== 'Target Start');
    const res = parseWorkOrdersWorkbook(workbook([header, header.map((h) => (good as Record<string, unknown>)[h] ?? '')]));
    expect(res.fileErrors).toEqual(['Column "Target Start" not found in the file']);
    expect(res.workOrders[0].importWarnings ?? []).toEqual([]); // not repeated on every row
  });

  it('a file without the work-order headers is rejected with a clear message', () => {
    expect(() => parseWorkOrdersWorkbook(workbook([['Name', 'Shift'], ['A', 'M']]))).toThrow(/No work-order header row/);
  });

  it('outside window / past Finish No Later Than / target slip / age', () => {
    const wo = { scheduledStart: '2026-11-25', startNoEarlier: '2026-11-10', finishNoLater: '2026-11-20', targetStart: '2026-11-14', reportedDate: '2026-10-01' } as never;
    expect(windowCheck(wo, '2026-11-21')).toEqual({ outsideWindow: true, pastFinish: true, ageDays: 51, slipDays: 11 });
    const ok = { scheduledStart: '2026-11-12', startNoEarlier: '2026-11-10', finishNoLater: '2026-11-20' } as never;
    expect(windowCheck(ok, '2026-11-01')).toMatchObject({ outsideWindow: false, pastFinish: false });
  });
});

describe('adding a column through the config only', () => {
  it('a new required column is read, validated and stored without importer changes', () => {
    const columns: WorkOrderColumn[] = [
      ...WORK_ORDER_COLUMNS,
      { excelHeader: 'Priority', appField: 'priority', required: true, type: 'text', usedFor: 'Job priority' },
    ];
    const header = [...HEADER, 'Priority'];
    const res = parseWorkOrdersWorkbook(
      workbook([header, [...row(good), 'P1'], [...row({ ...good, 'Work Order': 9 }), '']]),
      columns,
    );
    expect(res.workOrders[0].extra).toEqual({ priority: 'P1' });
    expect(res.workOrders[1].importWarnings).toContain('Row 3: Priority missing');
  });
});

describe('columns added in Setup → Excel import columns', () => {
  it('are read on import and blank cells are reported', () => {
    const added: WorkOrderColumn = { excelHeader: 'Job Priority', appField: fieldFromHeader('Job Priority'), required: true, type: 'text', usedFor: 'Setup' };
    expect(added.appField).toBe('jobPriority');
    const header = [...HEADER, 'Job Priority'];
    const res = parseWorkOrdersWorkbook(
      workbook([header, [...row(good), 'P1'], [...row({ ...good, 'Work Order': 9 }), '']]),
      allWorkOrderColumns([added]),
    );
    expect(res.workOrders[0].extra).toEqual({ jobPriority: 'P1' });
    expect(res.workOrders[1].importWarnings).toContain('Row 3: Job Priority missing');
  });

  it('a built-in column cannot be added twice', () => {
    const dup: WorkOrderColumn = { excelHeader: 'scheduled start', appField: 'x', required: true, type: 'text', usedFor: '' };
    expect(allWorkOrderColumns([dup])).toHaveLength(WORK_ORDER_COLUMNS.length);
  });
});
