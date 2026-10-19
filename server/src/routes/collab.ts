import { Router } from 'express';

import {
  Audit,
  BackupSnapshot,
  Collaborator,
  CollabNotification,
  CollabSession,
  SecuritySetting,
} from '../models.ts';
import { readSnapshotFromMongo, syncSnapshotToMongo } from './sync.ts';

export const collabRouter = Router();

export const DEFAULT_COLLABORATORS = [
  {
    id: 'assign-hasnain',
    assignedTo: 'Hasnain',
    passcode: 'shift-hasnain-92',
    role: 'collaborator' as const,
    createdAt: Date.now() - 86400000 * 2,
    status: 'active' as const,
    notes: 'IT Operations Partner direct link',
  },
  {
    id: 'assign-arif',
    assignedTo: 'Arif',
    passcode: 'shift-arif-44',
    role: 'collaborator' as const,
    createdAt: Date.now() - 86400000,
    status: 'active' as const,
    notes: 'Team Collaborator direct link',
  },
  {
    id: 'assign-latif',
    assignedTo: 'Latif',
    passcode: 'shift-latif-71',
    role: 'collaborator' as const,
    createdAt: Date.now() - 3600000 * 6,
    status: 'active' as const,
    notes: 'Operations Line Staff direct link',
  },
];

function buildShareUrl(passcode: string, assignedTo: string): string {
  const cleanCode = encodeURIComponent((passcode || '').trim());
  const cleanUser = encodeURIComponent((assignedTo || '').trim());
  return `http://localhost:5173/?code=${cleanCode}&user=${cleanUser}#/app`;
}

function buildPermissionsForRole(role: string) {
  if (role === 'viewer') {
    return {
      canEditRosterCells: false,
      canManageEmployees: false,
      canManageShiftCodes: false,
      canImportExportExcel: true,
      canManageWorkOrders: false,
      canRunAutoRotation: false,
    };
  }
  return {
    canEditRosterCells: true,
    canManageEmployees: true,
    canManageShiftCodes: true,
    canImportExportExcel: true,
    canManageWorkOrders: true,
    canRunAutoRotation: true,
  };
}

export async function syncCollaboratorsCollection(assignedPasscodes: any[]): Promise<void> {
  if (!Array.isArray(assignedPasscodes)) return;
  const keepIds: string[] = [];

  for (const item of assignedPasscodes) {
    if (!item || !item.id || !item.passcode) continue;
    keepIds.push(item.id);
    const role = item.role || 'collaborator';
    await Collaborator.updateOne(
      { id: item.id },
      {
        $set: {
          id: item.id,
          assignedTo: item.assignedTo || 'Team Member',
          passcode: item.passcode,
          shareUrl: buildShareUrl(item.passcode, item.assignedTo || 'Team Member'),
          role,
          status: item.status || 'active',
          notes: item.notes || `${item.assignedTo || 'Team Member'} direct link`,
          permissions: buildPermissionsForRole(role),
          createdAtMs: item.createdAt || Date.now(),
        },
        $setOnInsert: {
          onlineStatus: 'offline',
          loginCount: 0,
          recentSessions: [],
        },
      },
      { upsert: true },
    );
  }

  if (keepIds.length > 0) {
    await Collaborator.deleteMany({ id: { $nin: keepIds } });
  }
}

export async function seedCollabInMongo(): Promise<void> {
  let sec = await SecuritySetting.findOne({ key: 'security' }).lean();
  if (!sec) {
    const now = Date.now();
    await SecuritySetting.create({
      key: 'security',
      adminPassword: 'supervisor1',
      requireName: true,
      notifyOnLogin: true,
      soundAlert: true,
      assignedPasscodes: DEFAULT_COLLABORATORS,
      updatedAt: now,
      updatedAtISO: new Date(now).toISOString(),
    });
    sec = await SecuritySetting.findOne({ key: 'security' }).lean();
    console.log('Seeded securitysettings collection in MongoDB');
  }

  const assigned = Array.isArray((sec as any)?.assignedPasscodes) && (sec as any).assignedPasscodes.length > 0
    ? (sec as any).assignedPasscodes
    : DEFAULT_COLLABORATORS;
  await syncCollaboratorsCollection(assigned);

  const notifCount = await CollabNotification.countDocuments();
  if (notifCount <= 1) {
    const now = Date.now();
    const seedNotifs = [
      {
        id: 'seed-notif-1',
        type: 'security' as const,
        userName: 'Security Service',
        userRole: 'supervisor' as const,
        timestamp: now - 1000 * 60 * 30,
        isoTimestamp: new Date(now - 1000 * 60 * 30).toISOString(),
        message: 'Protected access gate active.',
        details: 'You will receive immediate alerts whenever someone unlocks this roster.',
        read: false,
      },
      {
        id: 'seed-notif-cloud-sync',
        type: 'edit' as const,
        userName: 'Cloud Backup Service',
        userRole: 'supervisor' as const,
        timestamp: now - 1000 * 60 * 10,
        isoTimestamp: new Date(now - 1000 * 60 * 10).toISOString(),
        message: 'MongoDB Atlas live synchronization & cloud backup active',
        details: 'All lines, shift codes, employees, rosters, work orders, and collaborator passcodes are backed up in real time.',
        read: false,
      },
      {
        id: 'seed-notif-supervisor',
        type: 'login' as const,
        userName: 'Supervisor',
        userRole: 'supervisor' as const,
        timestamp: now - 1000 * 60 * 5,
        isoTimestamp: new Date(now - 1000 * 60 * 5).toISOString(),
        message: 'Supervisor authenticated on primary console',
        details: 'Full administrative, shift-code, people, and Excel import/export privileges enabled.',
        read: false,
      },
    ];
    for (const n of seedNotifs) {
      await CollabNotification.updateOne({ id: n.id }, { $set: n }, { upsert: true });
    }
  }

  const sessionCount = await CollabSession.countDocuments();
  if (sessionCount === 0) {
    const now = Date.now();
    await CollabSession.create({
      id: 'admin-initial-session',
      collaboratorId: null,
      name: 'Supervisor',
      role: 'supervisor',
      passcodeUsed: 'supervisor1',
      device: 'Admin Console',
      status: 'online',
      joinedAt: now,
      joinedAtISO: new Date(now).toISOString(),
      lastActive: now,
      lastActiveISO: new Date(now).toISOString(),
    });
  }

  const auditCount = await Audit.countDocuments();
  if (auditCount === 0) {
    await Audit.create({
      userId: 'system',
      userEmail: 'supervisor@example.com',
      action: 'database.initialize',
      target: 'shiftline.atlas',
      after: {
        collaborators: assigned.map((a: any) => ({ name: a.assignedTo, passcode: a.passcode, role: a.role })),
        status: 'connected',
      },
    });
  }
}

collabRouter.get('/state', async (_req, res) => {
  const [sec, notifications, activeSessions, collaborators] = await Promise.all([
    SecuritySetting.findOne({ key: 'security' }).lean(),
    CollabNotification.find().sort({ timestamp: -1 }).limit(50).lean(),
    CollabSession.find({ status: 'online' }).sort({ joinedAt: 1 }).lean(),
    Collaborator.find().sort({ createdAtMs: -1 }).lean(),
  ]);
  res.json({
    ok: true,
    users: activeSessions,
    notifications,
    settings: sec,
    collaborators,
  });
});

collabRouter.get('/collaborators', async (_req, res) => {
  const [collaborators, sessions] = await Promise.all([
    Collaborator.find().sort({ createdAtMs: -1 }).lean(),
    CollabSession.find().sort({ lastActive: -1 }).limit(100).lean(),
  ]);
  res.json({ ok: true, collaborators, sessions });
});

collabRouter.post('/login', async (req, res) => {
  const body = req.body || {};
  const cleanName = String(body.name || 'Team Member').trim();
  const cleanPasscode = String(body.passcode || '').trim().toLowerCase();
  const role = body.role || 'collaborator';
  const device = body.device || 'Desktop Browser';
  const now = Date.now();
  const nowISO = new Date(now).toISOString();

  const collabDoc: any = await Collaborator.findOne({
    passcode: { $regex: new RegExp(`^${cleanPasscode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    status: { $ne: 'revoked' },
  }).lean();

  const userId = body.user?.id || `user-${now}-${Math.random().toString(36).substring(2, 7)}`;
  const sessionDoc = {
    id: userId,
    collaboratorId: collabDoc?.id ?? null,
    name: cleanName,
    role,
    passcodeUsed: cleanPasscode,
    device,
    status: 'online' as const,
    joinedAt: body.user?.joinedAt || now,
    joinedAtISO: nowISO,
    lastActive: now,
    lastActiveISO: nowISO,
  };

  await CollabSession.updateOne({ id: userId }, { $set: sessionDoc }, { upsert: true });

  if (collabDoc) {
    const nextRecent = [
      { sessionId: userId, userName: cleanName, loginAt: now, loginAtISO: nowISO, device, status: 'online' },
      ...(Array.isArray(collabDoc.recentSessions) ? collabDoc.recentSessions : []).slice(0, 19),
    ];
    await Collaborator.updateOne(
      { id: collabDoc.id },
      {
        $set: {
          onlineStatus: 'online',
          lastLoginAt: now,
          lastLoginISO: nowISO,
          lastActiveAt: now,
          lastDevice: device,
          recentSessions: nextRecent,
        },
        $inc: { loginCount: 1 },
      },
    );
  }

  const notif = body.notification || {
    id: `notif-${now}-${Math.random().toString(36).substring(2, 5)}`,
    type: 'login',
    userName: cleanName,
    userRole: role,
    timestamp: now,
    isoTimestamp: nowISO,
    message: `${cleanName} logged in via shared link`,
    details: `Access granted with passcode (${cleanPasscode}). Device: ${device}.`,
    read: false,
  };

  await CollabNotification.updateOne(
    { id: notif.id },
    { $set: { ...notif, isoTimestamp: new Date(notif.timestamp || now).toISOString() } },
    { upsert: true },
  );

  await Audit.create({
    userId,
    userEmail: cleanName,
    action: 'collab.login',
    target: collabDoc?.id ?? cleanName,
    after: { name: cleanName, role, passcodeUsed: cleanPasscode, device },
  });

  res.json({ ok: true, user: sessionDoc, notification: notif });
});

collabRouter.post('/admin-login', async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || 'Supervisor').replace(/ \/ Operations Lead/g, '').trim() || 'Supervisor';
  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const userId = body.user?.id || `admin-${now}`;

  const sessionDoc = {
    id: userId,
    collaboratorId: 'supervisor-admin',
    name,
    role: 'supervisor' as const,
    passcodeUsed: 'adminPassword',
    device: 'Admin Console',
    status: 'online' as const,
    joinedAt: body.user?.joinedAt || now,
    joinedAtISO: nowISO,
    lastActive: now,
    lastActiveISO: nowISO,
  };

  await CollabSession.updateOne({ id: userId }, { $set: sessionDoc }, { upsert: true });

  const notif = body.notification || {
    id: `notif-${now}`,
    type: 'login',
    userName: name,
    userRole: 'supervisor',
    timestamp: now,
    isoTimestamp: nowISO,
    message: `${name} authenticated as Supervisor`,
    details: 'Full administrative and schedule lock privileges enabled.',
    read: false,
  };

  await CollabNotification.updateOne(
    { id: notif.id },
    { $set: { ...notif, isoTimestamp: new Date(notif.timestamp || now).toISOString() } },
    { upsert: true },
  );

  await Audit.create({
    userId,
    userEmail: name,
    action: 'collab.admin_login',
    target: 'supervisor',
    after: { name, role: 'supervisor', device: 'Admin Console' },
  });

  res.json({ ok: true, user: sessionDoc, notification: notif });
});

collabRouter.post('/logout', async (req, res) => {
  const body = req.body || {};
  const userId = body.userId || '';
  const name = String(body.name || 'Team Member').trim();
  const role = body.role || 'collaborator';
  const now = Date.now();
  const nowISO = new Date(now).toISOString();

  await CollabSession.updateMany(
    { $or: [{ id: userId }, { name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }] },
    { $set: { status: 'offline', loggedOutAt: now, loggedOutAtISO: nowISO } },
  );

  await Collaborator.updateMany(
    { assignedTo: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
    { $set: { onlineStatus: 'offline', lastLogoutAt: now } },
  );

  const logoutNotif = body.notification || {
    id: `notif-logout-${now}`,
    type: 'logout',
    userName: name,
    userRole: role,
    timestamp: now,
    isoTimestamp: nowISO,
    message: `${name} logged out of roster`,
    details: `Session ended (${role}).`,
    read: false,
  };

  await CollabNotification.updateOne({ id: logoutNotif.id }, { $set: logoutNotif }, { upsert: true });

  await Audit.create({
    userId: userId || name,
    userEmail: name,
    action: 'collab.logout',
    target: name,
    after: { name, role, loggedOutAtISO: nowISO },
  });

  res.json({ ok: true });
});

collabRouter.post('/heartbeat', async (req, res) => {
  const body = req.body || {};
  const userId = body.userId;
  const name = body.name;
  const role = body.role || 'collaborator';
  const now = Date.now();
  const nowISO = new Date(now).toISOString();

  if (userId) {
    await CollabSession.updateOne(
      { id: userId },
      {
        $set: {
          name: name || 'Team Member',
          role,
          status: 'online',
          lastActive: now,
          lastActiveISO: nowISO,
        },
        $setOnInsert: {
          joinedAt: now,
          joinedAtISO: nowISO,
          device: 'Desktop Browser',
        },
      },
      { upsert: true },
    );
  }
  if (name) {
    await Collaborator.updateMany(
      { assignedTo: { $regex: new RegExp(`^${String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      { $set: { onlineStatus: 'online', lastActiveAt: now } },
    );
  }
  res.json({ ok: true });
});

collabRouter.post('/settings', async (req, res) => {
  const s = req.body?.settings;
  if (s && typeof s === 'object') {
    const now = Date.now();
    await SecuritySetting.updateOne(
      { key: 'security' },
      {
        $set: {
          adminPassword: s.adminPassword || 'supervisor1',
          requireName: typeof s.requireName === 'boolean' ? s.requireName : true,
          notifyOnLogin: typeof s.notifyOnLogin === 'boolean' ? s.notifyOnLogin : true,
          soundAlert: typeof s.soundAlert === 'boolean' ? s.soundAlert : true,
          assignedPasscodes: Array.isArray(s.assignedPasscodes) ? s.assignedPasscodes : [],
          updatedAt: s.updatedAt || now,
          updatedAtISO: new Date(s.updatedAt || now).toISOString(),
        },
      },
      { upsert: true },
    );

    if (Array.isArray(s.assignedPasscodes)) {
      await syncCollaboratorsCollection(s.assignedPasscodes);
    }

    await Audit.create({
      userId: 'supervisor',
      userEmail: 'supervisor@example.com',
      action: 'security.settings_update',
      target: 'collaborators',
      after: {
        collaboratorCount: Array.isArray(s.assignedPasscodes) ? s.assignedPasscodes.length : 0,
        collaborators: Array.isArray(s.assignedPasscodes)
          ? s.assignedPasscodes.map((a: any) => ({
              assignedTo: a.assignedTo,
              passcode: a.passcode,
              role: a.role,
              status: a.status,
            }))
          : [],
      },
    });
  }
  const latest = await SecuritySetting.findOne({ key: 'security' }).lean();
  res.json({ ok: true, settings: latest });
});

collabRouter.post('/clear-notifications', async (_req, res) => {
  await CollabNotification.deleteMany({});
  res.json({ ok: true });
});

collabRouter.post('/dismiss-notification', async (req, res) => {
  const id = req.body?.id;
  if (id) {
    await CollabNotification.deleteOne({ id });
  }
  res.json({ ok: true });
});

collabRouter.post('/notifications-sync', async (req, res) => {
  const list = req.body?.notifications;
  if (Array.isArray(list)) {
    for (const n of list) {
      if (n && n.id && n.message) {
        const ts = typeof n.timestamp === 'number' ? n.timestamp : Date.now();
        await CollabNotification.updateOne(
          { id: n.id },
          {
            $set: {
              id: n.id,
              type: n.type || 'login',
              userName: n.userName || 'Supervisor',
              userRole: n.userRole || 'supervisor',
              timestamp: ts,
              isoTimestamp: new Date(ts).toISOString(),
              message: n.message,
              details: n.details || '',
              read: Boolean(n.read),
            },
          },
          { upsert: true },
        );
      }
    }
  }
  const notifications = await CollabNotification.find().sort({ timestamp: -1 }).limit(50).lean();
  res.json({ ok: true, notifications });
});

collabRouter.get('/cloud-meta', async (_req, res) => {
  const [latestBackup, sec, latestNotif] = await Promise.all([
    BackupSnapshot.findOne({ id: 'latest-backup' }, { updatedAtMs: 1 }).lean(),
    SecuritySetting.findOne({ key: 'security' }, { updatedAt: 1 }).lean(),
    CollabNotification.findOne().sort({ timestamp: -1 }).lean(),
  ]);
  res.json({
    ok: true,
    dbUpdatedAt: (latestBackup as any)?.updatedAtMs ?? 0,
    settingsUpdatedAt: (sec as any)?.updatedAt ?? 0,
    latestNotifId: (latestNotif as any)?.id ?? null,
    latestNotifTimestamp: (latestNotif as any)?.timestamp ?? 0,
  });
});

collabRouter.get('/backups', async (_req, res) => {
  const backups = await BackupSnapshot.find({}, { data: 0 }).sort({ updatedAtMs: -1 }).lean();
  res.json({ ok: true, backups });
});

collabRouter.get('/db', async (_req, res) => {
  res.json({ ok: true, data: await readSnapshotFromMongo() });
});

collabRouter.post('/db', async (req, res) => {
  const saved = await syncSnapshotToMongo(req.body);
  if (!saved) return res.status(400).json({ error: 'Invalid data' });

  const now = Date.now();
  const activeLine = saved.settings?.activeLineId || 'line5';
  const editNotif = {
    id: `notif-sync-${ Math.floor(now / 10000) }`,
    type: 'edit' as const,
    userName: 'Supervisor / Collaborator',
    userRole: 'supervisor' as const,
    timestamp: now,
    isoTimestamp: new Date(now).toISOString(),
    message: `Live database & backup updated (${activeLine.toUpperCase()})`,
    details: `Synced ${saved.lines.length} lines, ${saved.employees.length} employees, ${saved.codes.length} shift codes, ${saved.rosters.length} rosters, ${saved.workOrders.length} work orders.`,
    read: false,
  };
  await CollabNotification.updateOne({ id: editNotif.id }, { $set: editNotif }, { upsert: true });

  await Audit.create({
    userId: 'live-sync',
    userEmail: 'supervisor@example.com',
    action: 'database.live_sync',
    target: activeLine,
    after: {
      lines: saved.lines.length,
      employees: saved.employees.length,
      codes: saved.codes.length,
      rosters: saved.rosters.length,
      workOrders: saved.workOrders.length,
      updatedAtISO: new Date(now).toISOString(),
    },
  });

  res.json({ ok: true });
});

