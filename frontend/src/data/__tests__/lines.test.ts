import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { codeKey, db, seedCodesForLine } from '@/data/db';
import { SEED_CODES } from '@/data/seed';

/**
 * Lines must not reach into each other.
 *
 * Adding a Line 6 sheet, or retuning Line 4's minimums, has to leave every
 * other line's grid exactly as it was.
 */
describe('each line owns its shift codes', () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.shiftCodes.clear();
    // The unscoped rows are the template new lines copy from.
    await db.shiftCodes.bulkPut(SEED_CODES.map((c) => ({ ...c, key: codeKey(c.id) })));
    for (const line of ['line4', 'line5']) await seedCodesForLine(line);
  });

  const forLine = async (lineId: string) =>
    (await db.shiftCodes.toArray())
      .filter((c) => c.scope === lineId)
      .map((c) => c.id)
      .sort();

  it('gives a brand new line its own full copy', async () => {
    await seedCodesForLine('line6');
    expect(await forLine('line6')).toEqual(SEED_CODES.map((c) => c.id).sort());
  });

  it('keeps a minimum changed on one line off the others', async () => {
    const night = await db.shiftCodes.get(codeKey('N', 'line4'));
    await db.shiftCodes.put({ ...night!, minHeadcount: 9 });

    expect((await db.shiftCodes.get(codeKey('N', 'line4')))?.minHeadcount).toBe(9);
    expect((await db.shiftCodes.get(codeKey('N', 'line5')))?.minHeadcount)
      .toBe(SEED_CODES.find((c) => c.id === 'N')!.minHeadcount);
  });

  it('keeps a code invented by one line off the others', async () => {
    await db.shiftCodes.put({
      id: 'JAAFAR', label: 'JAAFAR', timing: '', tone: 'off', minHeadcount: 0,
      countsAsEngineer: false, rotates: false, order: 500,
      scope: 'line4', key: codeKey('JAAFAR', 'line4'),
    });

    expect(await forLine('line4')).toContain('JAAFAR');
    expect(await forLine('line5')).not.toContain('JAAFAR');
    await seedCodesForLine('line6');
    expect(await forLine('line6')).not.toContain('JAAFAR');
  });

  it('deleting a line takes only its own codes', async () => {
    await db.shiftCodes.where('scope').equals('line4').delete();

    expect(await forLine('line4')).toEqual([]);
    expect(await forLine('line5')).toEqual(SEED_CODES.map((c) => c.id).sort());
  });

  it('renaming a code on one line leaves the other reading the old name', async () => {
    const gs = await db.shiftCodes.get(codeKey('GS', 'line4'));
    await db.shiftCodes.put({ ...gs!, label: 'Day Crew' });

    expect((await db.shiftCodes.get(codeKey('GS', 'line4')))?.label).toBe('Day Crew');
    expect((await db.shiftCodes.get(codeKey('GS', 'line5')))?.label)
      .toBe(SEED_CODES.find((c) => c.id === 'GS')!.label);
  });
});
