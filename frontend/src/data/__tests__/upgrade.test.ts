import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

/**
 * Upgrading a database that already holds data.
 *
 * The v3 change re-keys shift codes by (scope, id). IndexedDB cannot change a
 * store's primary key in place, and getting this wrong throws on open — the
 * app then hangs on "Loading roster…" with every month inaccessible. This
 * walks the real upgrade path rather than starting from an empty database.
 */
describe('upgrading a v2 database', () => {
  it('opens, and gives every line its own copy of the codes', async () => {
    // ---- a database as shipped before the scoping change -----------------
    const old = new Dexie('shiftline');
    old.version(1).stores({
      lines: 'id, order',
      employees: 'id, lineId, order',
      codes: 'id, order',
      leave: 'id, employeeId, from, to',
      rosters: 'id, lineId, [year+month]',
      settings: 'key',
    });
    old.version(2).stores({});
    await old.open();
    await old.table('codes').bulkPut([
      { id: 'M', label: 'Morning', timing: '06:00 – 15:00', tone: 'morning', minHeadcount: 2, countsAsEngineer: true, rotates: true, order: 1 },
      { id: 'N', label: 'Night', timing: '22:00 – 07:00', tone: 'night', minHeadcount: 2, countsAsEngineer: true, rotates: true, order: 3 },
      { id: 'H', label: 'Holiday', timing: '', tone: 'off', minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 99 },
    ]);
    await old.table('lines').bulkPut([
      { id: 'line4', name: 'Line 4', prefix: 'SLV', order: 1 },
      { id: 'line5', name: 'Line 5', prefix: 'SLV', order: 2 },
    ]);
    await old.table('employees').put({
      id: 'e01', lineId: 'line5', name: 'Abdul Saeed', contact: '', order: 1,
      defaultShift: 'M', restDays: [5, 6],
    });
    old.close();

    // ---- open with the current schema ------------------------------------
    const { db, codeKey } = await import('@/data/db');
    await db.open();

    // Every line ends up with its own copy of what was there before.
    const all = await db.shiftCodes.toArray();
    const ids = (lineId: string) =>
      all.filter((c) => c.scope === lineId).map((c) => c.id).sort();
    expect(ids('line4')).toEqual(['H', 'M', 'N']);
    expect(ids('line5')).toEqual(['H', 'M', 'N']);
    expect((await db.shiftCodes.get(codeKey('H', 'line4')))?.label).toBe('Holiday');
    // The unscoped rows remain only as the template for new lines.
    expect(all.filter((c) => !c.scope).map((c) => c.id).sort()).toEqual(['H', 'M', 'N']);

    // The rest of the data is untouched and the old store is gone.
    expect((await db.employees.get('e01'))?.name).toBe('Abdul Saeed');
    expect(db.tables.map((t) => t.name)).not.toContain('codes');
    expect(db.verno).toBe(7);

    db.close();
  });
});

/**
 * A build in between cloned a global code to put it on one month's brush,
 * which listed the same code twice in Setup ("Evening" and "Evening · this
 * month only"). The clones are removed on upgrade and recorded against the
 * month instead.
 */
describe('cleaning up cloned codes', () => {
  it('drops a scoped copy of a global code and remembers the month', async () => {
    const { db, codeKey } = await import('@/data/db');
    if (!db.isOpen()) await db.open();
    const SEPT = 'line4:2026-9';

    await db.shiftCodes.bulkPut([
      { id: 'E', label: 'Evening', timing: '14:00 – 23:00', tone: 'evening', minHeadcount: 2, countsAsEngineer: true, rotates: true, order: 2, key: codeKey('E') },
      { id: 'E', label: 'Evening', timing: '14:00 – 23:00', tone: 'evening', minHeadcount: 0, countsAsEngineer: true, rotates: true, order: 2, scope: SEPT, key: codeKey('E', SEPT) },
      { id: 'JAAFAR', label: 'JAAFAR', timing: '', tone: 'off', minHeadcount: 0, countsAsEngineer: false, rotates: false, order: 500, scope: SEPT, key: codeKey('JAAFAR', SEPT) },
    ]);

    // Re-run the v5 cleanup over the current contents.
    const all = await db.shiftCodes.toArray();
    const globalIds = new Set(all.filter((c) => !c.scope).map((c) => c.id));
    for (const c of all) {
      if (c.scope && globalIds.has(c.id)) {
        await db.shiftCodes.delete(codeKey(c.id, c.scope));
        const prev = (await db.monthCodes.get(c.scope))?.codeIds ?? [];
        await db.monthCodes.put({ rosterId: c.scope, codeIds: [...prev, c.id] });
      }
    }

    // Evening appears once; the genuinely new code keeps its scope.
    const evenings = (await db.shiftCodes.toArray()).filter((c) => c.id === 'E');
    expect(evenings).toHaveLength(1);
    expect(evenings[0].scope).toBeUndefined();
    expect((await db.shiftCodes.get(codeKey('JAAFAR', SEPT)))?.scope).toBe(SEPT);
    expect((await db.monthCodes.get(SEPT))?.codeIds).toContain('E');
  });
});
