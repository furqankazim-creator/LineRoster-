import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireSupervisor } from '../auth.ts';
import { audit } from '../audit.ts';
import {
  Allocation,
  BackupSnapshot,
  Employee,
  Leave,
  Line,
  ResourceRequirement,
  Roster,
  Settings,
  ShiftCode,
  WorkOrder,
} from '../models.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLAB_DB_FILE = path.resolve(__dirname, '../../data/collab-db.json');

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const syncRouter = Router();

const backupShape = z.object({
  lines: z.array(z.any()).default([]),
  codes: z.array(z.any()).default([]),
  employees: z.array(z.any()).default([]),
  leave: z.array(z.any()).default([]),
  rosters: z.array(z.any()).default([]),
  workOrders: z.array(z.any()).default([]),
  resourceRequirements: z.array(z.any()).default([]),
  allocations: z.array(z.any()).default([]),
  monthCodes: z.array(z.any()).default([]),
  layouts: z.array(z.any()).default([]),
  updatedAt: z.number().optional(),
  settings: z.any().optional(),
});

export async function readSnapshotFromMongo() {
  const [lines, codes, employees, leave, rosters, workOrders, resourceRequirements, allocations, settings, latestBackup] =
    await Promise.all([
      Line.find().sort({ order: 1 }).lean(),
      ShiftCode.find().sort({ order: 1 }).lean(),
      Employee.find().sort({ order: 1 }).lean(),
      Leave.find().lean(),
      Roster.find().lean(),
      WorkOrder.find().lean(),
      ResourceRequirement.find().lean(),
      Allocation.find().lean(),
      Settings.findOne({ key: 'app' }).lean(),
      BackupSnapshot.findOne({ id: 'latest-backup' }).lean(),
    ]);
  const stripMongo = (rows: any[]) => rows.map(({ _id, __v, createdAt: _c, updatedAt: _u, ...rest }) => rest);
  const stripRoster = (rows: any[]) => rows.map(({ _id, __v, createdAt: _c, ...rest }) => rest);
  const backupData = (latestBackup as any)?.data ?? {};
  const updatedAt =
    (latestBackup as any)?.updatedAtMs ??
    (settings as any)?.data?.updatedAt ??
    Date.now();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    updatedAt,
    lines: stripMongo(lines),
    codes: stripMongo(codes),
    employees: stripMongo(employees),
    leave: stripMongo(leave),
    rosters: stripRoster(rosters),
    workOrders: stripMongo(workOrders),
    resourceRequirements: stripMongo(resourceRequirements),
    allocations: stripMongo(allocations),
    monthCodes: Array.isArray(backupData.monthCodes) ? backupData.monthCodes : [],
    layouts: Array.isArray(backupData.layouts) ? backupData.layouts : [],
    settings: settings?.data ?? null,
  };
}

export async function syncSnapshotToMongo(raw: any) {
  const body = backupShape.safeParse(raw);
  if (!body.success) return null;
  const d = body.data;
  const syncedAtISO = new Date().toISOString();

  const strip = (rows: any[]) => rows.map(({ _id, __v, ...rest }) => rest);

  // Lookup maps for rich relational metadata inside MongoDB documents
  const lineById = new Map<string, any>();
  for (const l of d.lines) {
    if (l?.id) lineById.set(l.id, l);
  }

  const empById = new Map<string, any>();
  for (const e of d.employees) {
    if (e?.id) empById.set(e.id, e);
  }

  const codeLabelByKey = new Map<string, string>();
  for (const c of d.codes) {
    if (c?.id) {
      const text = c.timing ? `${c.label || c.id} (${c.timing})` : c.label || c.id;
      codeLabelByKey.set(`${c.scope ?? '*'}::${c.id}`, text);
      if (!codeLabelByKey.has(`*::${c.id}`)) {
        codeLabelByKey.set(`*::${c.id}`, text);
      }
    }
  }

  // Enrich Lines
  const enrichedLines = strip(d.lines).map((l: any) => {
    const lineEmps = d.employees.filter((e: any) => e.lineId === l.id);
    const lineCodes = d.codes.filter((c: any) => c.scope === l.id);
    const lineRosters = d.rosters.filter((r: any) => r.lineId === l.id);
    const lineWOs = d.workOrders.filter(
      (w: any) =>
        w.lineId === l.id ||
        String(w.line || '').toLowerCase().includes(String(l.name || l.id).toLowerCase()),
    );
    return {
      ...l,
      employeeCount: lineEmps.length,
      activeEmployeeCount: lineEmps.filter((e: any) => e.active !== false).length,
      shiftCodeCount: lineCodes.length,
      rosterMonthsCount: lineRosters.length,
      workOrderCount: lineWOs.length,
      poolGroup: l.id === 'line4' || l.id === 'line6' ? 'Line 4 & Line 6 Shared Pool' : `${l.name || l.id} Dedicated Pool`,
      lastSyncedAt: syncedAtISO,
    };
  });

  // Enrich Shift Codes
  const enrichedCodes = strip(d.codes).map((c: any) => {
    const scopeLine = c.scope ? lineById.get(c.scope) : null;
    return {
      ...c,
      key: c.key ?? `${c.scope ?? '*'}::${c.id}`,
      lineName: scopeLine ? scopeLine.name : 'Global Template',
      lastSyncedAt: syncedAtISO,
    };
  });

  // Enrich Employees
  const enrichedEmployees = strip(d.employees).map((e: any) => {
    const line = lineById.get(e.lineId);
    const empLeaves = d.leave.filter((lv: any) => lv.employeeId === e.id);
    const assignedWOs = d.workOrders.filter(
      (wo: any) => Array.isArray(wo.assignedEmployeeIds) && wo.assignedEmployeeIds.includes(e.id),
    );
    const shiftLabel =
      codeLabelByKey.get(`${e.lineId}::${e.defaultShift}`) ??
      codeLabelByKey.get(`*::${e.defaultShift}`) ??
      e.defaultShift;
    const restDayNames = Array.isArray(e.restDays)
      ? e.restDays.map((dayIdx: number) => WEEKDAY_NAMES[dayIdx] ?? String(dayIdx))
      : [];
    return {
      ...e,
      lineName: line?.name ?? e.lineId,
      defaultShiftLabel: shiftLabel,
      restDayNames,
      leaveBlocksCount: empLeaves.length,
      assignedWorkOrdersCount: assignedWOs.length,
      lastSyncedAt: syncedAtISO,
    };
  });

  // Enrich Leave Blocks
  const enrichedLeaves = strip(d.leave).map((lv: any) => {
    const emp = empById.get(lv.employeeId);
    const line = emp ? lineById.get(emp.lineId) : null;
    let durationDays = 1;
    if (lv.from && lv.to) {
      const diff = (new Date(lv.to).getTime() - new Date(lv.from).getTime()) / 86400000;
      if (!Number.isNaN(diff) && diff >= 0) durationDays = Math.round(diff) + 1;
    }
    return {
      ...lv,
      employeeName: emp?.name ?? lv.employeeId,
      lineId: emp?.lineId ?? null,
      lineName: line?.name ?? emp?.lineId ?? null,
      durationDays,
      lastSyncedAt: syncedAtISO,
    };
  });

  // Enrich Rosters
  const enrichedRosters = strip(d.rosters).map((r: any) => {
    const line = lineById.get(r.lineId);
    const cells = r.cells && typeof r.cells === 'object' ? r.cells : {};
    const overrides = r.overrides && typeof r.overrides === 'object' ? r.overrides : {};
    const empIds = Object.keys(cells);
    const daysInMonth = empIds.length > 0 && Array.isArray(cells[empIds[0]]) ? cells[empIds[0]].length : 30;

    let manualOverridesCount = 0;
    for (const ov of Object.values(overrides) as any[]) {
      if (ov && typeof ov === 'object') {
        manualOverridesCount += Object.keys(ov).length;
      }
    }

    const shiftTotals: Record<string, number> = {};
    for (const row of Object.values(cells) as any[]) {
      if (Array.isArray(row)) {
        for (const cell of row) {
          const code = typeof cell === 'string' ? cell : cell?.code;
          if (code) {
            shiftTotals[code] = (shiftTotals[code] || 0) + 1;
          }
        }
      }
    }

    return {
      ...r,
      lineName: line?.name ?? r.lineId,
      monthName: `${MONTH_NAMES[r.month] || r.month} ${r.year}`,
      daysInMonth,
      employeeCount: empIds.length,
      manualOverridesCount,
      shiftTotals,
      lastSyncedAt: syncedAtISO,
    };
  });

  // Enrich Work Orders
  const enrichedWorkOrders = strip(d.workOrders).map((wo: any) => {
    const assignedIds: string[] = Array.isArray(wo.assignedEmployeeIds) ? wo.assignedEmployeeIds : [];
    const assignedNames = assignedIds.map((id) => empById.get(id)?.name ?? id);
    return {
      ...wo,
      assignedEmployeeCount: assignedIds.length,
      assignedEmployeeNames: assignedNames,
      lastSyncedAt: syncedAtISO,
    };
  });

  const enrichedResourceRequirements = strip(d.resourceRequirements).map((rr: any) => ({
    ...rr,
    lastSyncedAt: syncedAtISO,
  }));

  const enrichedAllocations = strip(d.allocations).map((al: any) => {
    const emp = empById.get(al.personId);
    return {
      ...al,
      personName: emp?.name ?? al.personId,
      lineId: emp?.lineId ?? null,
      lastSyncedAt: syncedAtISO,
    };
  });

  const replace = async (model: any, rows: any[]) => {
    await model.deleteMany({});
    if (rows.length) await model.insertMany(rows, { ordered: false }).catch(() => {});
  };

  try {
    await ShiftCode.collection.dropIndex('id_1');
  } catch {
    /* index already dropped or never created */
  }

  await replace(Line, enrichedLines);
  await replace(ShiftCode, enrichedCodes);
  await replace(Employee, enrichedEmployees);
  await replace(Leave, enrichedLeaves);
  await replace(Roster, enrichedRosters);
  await replace(WorkOrder, enrichedWorkOrders);
  await replace(ResourceRequirement, enrichedResourceRequirements);
  await replace(Allocation, enrichedAllocations);

  const updatedAtMs = d.updatedAt || d.settings?.updatedAt || Date.now();
  const summary = {
    linesCount: enrichedLines.length,
    employeesCount: enrichedEmployees.length,
    shiftCodesCount: enrichedCodes.length,
    leavesCount: enrichedLeaves.length,
    rostersCount: enrichedRosters.length,
    workOrdersCount: enrichedWorkOrders.length,
    resourceRequirementsCount: enrichedResourceRequirements.length,
    allocationsCount: enrichedAllocations.length,
  };

  if (d.settings) {
    const { key: _k, seeded: _s, ...data } = d.settings;
    await Settings.updateOne(
      { key: 'app' },
      {
        data: {
          ...data,
          updatedAt: updatedAtMs,
          totalLines: enrichedLines.length,
          totalEmployees: enrichedEmployees.length,
          totalShiftCodes: enrichedCodes.length,
          totalRosters: enrichedRosters.length,
          totalWorkOrders: enrichedWorkOrders.length,
          lastSyncedAt: syncedAtISO,
        },
      },
      { upsert: true },
    );
  }

  const fullBackupDoc = {
    version: 1,
    exportedAt: syncedAtISO,
    updatedAtMs,
    summary,
    data: {
      lines: strip(d.lines),
      codes: strip(d.codes),
      employees: strip(d.employees),
      leave: strip(d.leave),
      rosters: strip(d.rosters),
      workOrders: strip(d.workOrders),
      resourceRequirements: strip(d.resourceRequirements),
      allocations: strip(d.allocations),
      monthCodes: d.monthCodes,
      layouts: d.layouts,
      settings: d.settings,
      updatedAt: updatedAtMs,
    },
  };

  const dayTag = syncedAtISO.slice(0, 10);
  await Promise.all([
    BackupSnapshot.updateOne(
      { id: 'latest-backup' },
      { $set: { id: 'latest-backup', label: 'Latest Live Cloud Backup', ...fullBackupDoc } },
      { upsert: true },
    ),
    BackupSnapshot.updateOne(
      { id: `backup-${dayTag}` },
      { $set: { id: `backup-${dayTag}`, label: `Daily Cloud Backup (${dayTag})`, ...fullBackupDoc } },
      { upsert: true },
    ),
  ]);

  return d;
}

export async function seedMongoIfEmpty(): Promise<void> {
  try {
    if (fs.existsSync(COLLAB_DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(COLLAB_DB_FILE, 'utf8'));
      if (raw && Array.isArray(raw.lines) && raw.lines.length > 0) {
        await syncSnapshotToMongo(raw);
        console.log(
          `Synced detailed RailOPS dataset to MongoDB (${raw.lines.length} lines, ${raw.employees?.length ?? 0} employees, ${raw.rosters?.length ?? 0} rosters, ${raw.workOrders?.length ?? 0} work orders)`,
        );
        return;
      }
    }
  } catch (err) {
    console.warn('Could not read collab-db.json for MongoDB sync:', err);
  }

  const existingLines = await Line.countDocuments();
  if (existingLines > 0) return;

  try {
    const seed = await import('../../../frontend/src/data/seed.ts');
    await syncSnapshotToMongo({
      lines: seed.SEED_LINES,
      codes: seed.SEED_CODES,
      employees: seed.SEED_EMPLOYEES,
      leave: seed.SEED_LEAVE,
      rosters: [],
      workOrders: seed.SEED_WORK_ORDERS ?? [],
      resourceRequirements: seed.SEED_RESOURCE_REQUIREMENTS ?? [],
      allocations: [],
      settings: {
        theme: 'dark',
        activeLineId: 'line5',
        activeYear: 2026,
        activeMonth: 9,
        weekendDays: [5, 6],
        maxConsecutive: 6,
      },
    });
    console.log(`Seeded MongoDB with default RailOPS dataset (${seed.SEED_EMPLOYEES.length} employees)`);
  } catch (err) {
    console.warn('Failed to seed default dataset into MongoDB:', err);
  }
}

syncRouter.use(requireAuth);

syncRouter.get('/', async (_req, res) => {
  res.json(await readSnapshotFromMongo());
});

syncRouter.post('/', requireSupervisor, async (req, res) => {
  const d = await syncSnapshotToMongo(req.body);
  if (!d) return res.status(400).json({ error: 'That is not a RailOPS backup.' });

  audit(req, 'sync.push', 'all', undefined, {
    lines: d.lines.length,
    employees: d.employees.length,
    rosters: d.rosters.length,
    workOrders: d.workOrders.length,
  });
  res.json({ ok: true, employees: d.employees.length, rosters: d.rosters.length, workOrders: d.workOrders.length });
});
