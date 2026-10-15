import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { codeKey, db } from '@/data/db';
import { SEED_CODES } from '@/data/seed';

/**
 * Codes invented by an Excel import belong to the month they came from.
 * These tests pin the isolation the client asked for: a code on one sheet
 * must not turn up on another sheet's brush.
 */
describe('shift codes scoped to an imported month', () => {
  const SEPT = 'line5:2026-9';
  const OCT = 'line5:2026-10';

  /** What the planner shows for a given month. */
  const brushFor = async (rosterId: string) =>
    (await db.shiftCodes.toArray())
      .filter((c) => !c.scope || c.scope === rosterId)
      .map((c) => c.id)
      .sort();

  beforeEach(async () => {
    await db.shiftCodes.clear();
    await db.shiftCodes.bulkPut(SEED_CODES.map((c) => ({ ...c, key: codeKey(c.id) })));
  });

  it('keeps an imported code off other months', async () => {
    await db.shiftCodes.put({
      id: 'H', label: 'Holiday', timing: '', tone: 'off', minHeadcount: 0,
      countsAsEngineer: false, rotates: false, order: 500, scope: SEPT,
      key: codeKey('H', SEPT),
    });

    expect(await brushFor(SEPT)).toContain('H');
    expect(await brushFor(OCT)).not.toContain('H');
  });

  it('lets two sheets each define the same token differently', async () => {
    await db.shiftCodes.bulkPut([
      { id: 'H', label: 'Holiday', timing: '', tone: 'off', minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 500, scope: SEPT, key: codeKey('H', SEPT) },
      { id: 'H', label: 'Half day', timing: '08:00 – 12:00', tone: 'general', minHeadcount: 0, countsAsEngineer: true, rotates: false, order: 500, scope: OCT, key: codeKey('H', OCT) },
    ]);

    expect((await db.shiftCodes.get(codeKey('H', SEPT)))?.label).toBe('Holiday');
    expect((await db.shiftCodes.get(codeKey('H', OCT)))?.label).toBe('Half day');
  });

  it('leaves the standard codes visible on every month', async () => {
    const standard = SEED_CODES.map((c) => c.id).sort();
    expect(await brushFor(SEPT)).toEqual(standard);
    expect(await brushFor(OCT)).toEqual(standard);
  });

  it('deletes only the scoped copy, not the global one', async () => {
    await db.shiftCodes.put({
      id: 'GS', label: 'Site override', timing: '', tone: 'general', minHeadcount: 0,
      countsAsEngineer: true, rotates: false, order: 501, scope: SEPT, key: codeKey('GS', SEPT),
    });
    await db.shiftCodes.delete(codeKey('GS', SEPT));

    expect(await db.shiftCodes.get(codeKey('GS'))).toBeDefined();
    expect(await brushFor(SEPT)).toContain('GS');
  });
});
