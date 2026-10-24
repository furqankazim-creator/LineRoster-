// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import type { Plugin } from 'vite';

declare const process: any;

function getDbFilePath(): string {
  const fromCwd = path.resolve(process.cwd(), 'server/data/collab-db.json');
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromParent = path.resolve(process.cwd(), '../server/data/collab-db.json');
  if (fs.existsSync(fromParent)) return fromParent;
  try {
    return path.resolve(__dirname, 'data/collab-db.json');
  } catch {
    return fromCwd;
  }
}

const DB_FILE = getDbFilePath();
let cachedDb: any = null;

function loadServerDb() {
  if (cachedDb) return cachedDb;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      cachedDb = JSON.parse(raw);
      return cachedDb;
    }
  } catch (err) {
    console.error('Failed to read server DB:', err);
  }
  return null;
}

let lastCloudDbUpdatedAt = 0;

async function loadServerDbAsync() {
  try {
    const apiPort = process.env.PORT || '4400';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600);
    const r = await fetch(`http://127.0.0.1:${apiPort}/api/collab/db`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (r.ok) {
      const j = (await r.json()) as { ok?: boolean; data?: any };
      if (j?.data && Array.isArray(j.data.lines) && j.data.lines.length > 0) {
        cachedDb = j.data;
        if (typeof j.data.updatedAt === 'number' && j.data.updatedAt > lastCloudDbUpdatedAt) {
          lastCloudDbUpdatedAt = j.data.updatedAt;
        }
        return j.data;
      }
    }
  } catch {
    /* fallback to local file */
  }
  return loadServerDb();
}

function forwardToMongoCollab(subpath: string, payload: any) {
  try {
    const apiPort = process.env.PORT || '4400';
    fetch(`http://127.0.0.1:${apiPort}/api/collab/${subpath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* ignore if Express API is not running */
  }
}

function saveServerDb(data: any) {
  if (data && typeof data === 'object') {
    const now = Date.now();
    data.updatedAt = now;
    lastCloudDbUpdatedAt = now;
  }
  cachedDb = data;
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write server DB:', err);
  }
  forwardToMongoCollab('db', data);
}

interface CollabUser {
  id: string;
  name: string;
  role: 'supervisor' | 'collaborator' | 'viewer';
  joinedAt: number;
  lastActive: number;
  status: 'online' | 'offline';
  device?: string;
}

interface CollabNotification {
  id: string;
  type: 'login' | 'logout' | 'security' | 'presence';
  userName: string;
  userRole: 'supervisor' | 'collaborator' | 'viewer';
  timestamp: number;
  message: string;
  details?: string;
  read: boolean;
}

interface CollabSettings {
  updatedAt: number;
  assignedPasscodes: Array<{ id: string; passcode: string; assignedTo: string; role: string; status: string; [k: string]: any }>;
  adminPassword: string;
  requireName: boolean;
  notifyOnLogin: boolean;
  soundAlert: boolean;
}

// In-Memory Real-Time Collaboration State
const usersMap = new Map<string, CollabUser>();
const notificationsList: CollabNotification[] = [
  {
    id: 'seed-notif-1',
    type: 'security',
    userName: 'Security Service',
    userRole: 'supervisor',
    timestamp: Date.now() - 1000 * 60 * 15,
    message: 'Protected access gate active.',
    details: 'You will receive immediate alerts whenever someone unlocks this roster.',
    read: false,
  },
];

// updatedAt = 0 means "never configured": the supervisor's browser pushes its saved copy up.
const currentSettings: CollabSettings = {
  updatedAt: 0,
  assignedPasscodes: [],
  adminPassword: 'supervisor1',
  requireName: true,
  notifyOnLogin: true,
  soundAlert: true,
};

const sseClients = new Set<any>();
let serverWorkOrders: any[] = [];

function getActiveUsersList(): CollabUser[] {
  const now = Date.now();
  const list: CollabUser[] = [];
  const seenNames = new Set<string>();

  for (const user of usersMap.values()) {
    const isRecent = now - user.lastActive < 60000; // 60s window (prevents background tabs from dropping)
    if (user.status === 'online' && isRecent) {
      const norm = user.name.trim().toLowerCase();
      if (!seenNames.has(norm)) {
        seenNames.add(norm);
        list.push(user);
      }
    }
  }

  list.sort((a, b) => a.joinedAt - b.joinedAt);
  return list;
}

function broadcastSSE(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function readJsonBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: any) => {
      body += String(chunk);
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => {
      resolve({});
    });
  });
}

function sendJson(res: any, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

// Background cleanup: prune users who haven't sent a heartbeat in 75s.
// Started from configureServer (dev server only) — a module-level timer would
// keep `vite build` alive forever, which hangs CI / Vercel builds.
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let cloudPollTimer: ReturnType<typeof setInterval> | null = null;
function startPruning() {
  if (!pruneTimer) {
    pruneTimer = setInterval(pruneInactiveUsers, 5000);
  }
  if (!cloudPollTimer) {
    cloudPollTimer = setInterval(() => {
      void pollCloudChanges();
    }, 3000);
  }
}

async function pollCloudChanges() {
  if (sseClients.size === 0) return;
  try {
    const apiPort = process.env.PORT || '4400';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600);
    const metaRes = await fetch(`http://127.0.0.1:${apiPort}/api/collab/cloud-meta`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!metaRes.ok) return;
    const meta = (await metaRes.json()) as {
      ok?: boolean;
      dbUpdatedAt?: number;
      settingsUpdatedAt?: number;
    };
    if (
      typeof meta.dbUpdatedAt === 'number' &&
      meta.dbUpdatedAt > 0 &&
      lastCloudDbUpdatedAt > 0 &&
      meta.dbUpdatedAt > lastCloudDbUpdatedAt
    ) {
      lastCloudDbUpdatedAt = meta.dbUpdatedAt;
      const freshDb = await loadServerDbAsync();
      if (freshDb) {
        try {
          fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
          fs.writeFileSync(DB_FILE, JSON.stringify(freshDb, null, 2), 'utf8');
        } catch {}
        broadcastSSE({
          type: 'SERVER_DB_SYNC',
          timestamp: Date.now(),
          data: freshDb,
        });
      }
    } else if (typeof meta.dbUpdatedAt === 'number' && meta.dbUpdatedAt > 0 && lastCloudDbUpdatedAt === 0) {
      lastCloudDbUpdatedAt = meta.dbUpdatedAt;
    }

    if (
      typeof meta.settingsUpdatedAt === 'number' &&
      meta.settingsUpdatedAt > currentSettings.updatedAt
    ) {
      const stateRes = await fetch(`http://127.0.0.1:${apiPort}/api/collab/state`);
      if (stateRes.ok) {
        const st = await stateRes.json();
        if (st?.settings) {
          const s = st.settings;
          currentSettings.updatedAt = s.updatedAt || meta.settingsUpdatedAt;
          if (Array.isArray(s.assignedPasscodes)) currentSettings.assignedPasscodes = s.assignedPasscodes;
          if (s.adminPassword) currentSettings.adminPassword = s.adminPassword;
          if (typeof s.notifyOnLogin === 'boolean') currentSettings.notifyOnLogin = s.notifyOnLogin;
          if (typeof s.soundAlert === 'boolean') currentSettings.soundAlert = s.soundAlert;
          if (typeof s.requireName === 'boolean') currentSettings.requireName = s.requireName;
          broadcastSSE({
            type: 'SECURITY_SETTINGS_SYNC',
            settings: currentSettings,
          });
        }
      }
    }
  } catch {
    /* ignore when API is offline */
  }
}

function pruneInactiveUsers() {
  const now = Date.now();
  let changed = false;

  for (const [id, user] of usersMap.entries()) {
    if (user.status === 'online' && now - user.lastActive > 75000) {
      usersMap.delete(id);
      changed = true;
    }
  }

  if (changed) {
    broadcastSSE({
      type: 'PRESENCE_SYNC',
      users: getActiveUsersList(),
    });
  }
}

export function collabServerPlugin(): Plugin {
  return {
    name: 'collab-server',
    configureServer(server) {
      startPruning();
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';

        // Only handle /api/collab/* endpoints
        if (!url.startsWith('/api/collab')) {
          return next();
        }

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          });
          return res.end();
        }

        // Health check for RailOPS Assistant and API capabilities
        if ((url === '/health' || url === '/api/health') && req.method === 'GET') {
          return sendJson(res, 200, { ok: true, ai: true, aiPublic: true });
        }

        // Assistant ask endpoint
        if ((url === '/ai/ask' || url === '/api/ai/ask') && req.method === 'POST') {
          return sendJson(res, 200, { ok: true, message: 'RailOPS Engine ready' });
        }

        // 1. SSE Stream: GET /api/collab/events
        if (url.startsWith('/api/collab/events') && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          res.write(': keepalive\n\n');

          sseClients.add(res);

          // Immediately push current live state to new subscriber
          const initialPayload = {
            type: 'INIT_SYNC',
            users: getActiveUsersList(),
            notifications: notificationsList.slice(0, 50),
            settings: currentSettings,
            serverDb: await loadServerDbAsync(),
          };
          res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

          req.on('close', () => {
            sseClients.delete(res);
          });
          return;
        }

        // 2. Fetch current state: GET /api/collab/state
        if (url.startsWith('/api/collab/state') && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            users: getActiveUsersList(),
            notifications: notificationsList.slice(0, 50),
            settings: currentSettings,
          });
        }

        // 3. User Login: POST /api/collab/login
        if (url.startsWith('/api/collab/login') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const cleanName = (body.name || 'Team Member').trim();
          const cleanPasscode = (body.passcode || '').trim().toLowerCase();
          const role = body.role || 'collaborator';
          const device = body.device || 'Desktop Browser';

          // Only a person's own assigned (not revoked) passcode is accepted
          const isValid =
            !!cleanPasscode &&
            currentSettings.assignedPasscodes.some(
              (a) => a.status !== 'revoked' && String(a.passcode).trim().toLowerCase() === cleanPasscode,
            );

          if (!isValid) {
            return sendJson(res, 401, {
              ok: false,
              error: 'Incorrect passcode. Please check with your supervisor.',
            });
          }

          const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const userObj: CollabUser = {
            id: userId,
            name: cleanName,
            role,
            joinedAt: Date.now(),
            lastActive: Date.now(),
            status: 'online',
            device,
          };

          // Store user
          usersMap.set(userId, userObj);

          // Create notification
          const notif: CollabNotification = {
            id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            type: 'login',
            userName: cleanName,
            userRole: role,
            timestamp: Date.now(),
            message: `${cleanName} logged in via shared link`,
            details: `Access granted with passcode. Device: ${device}.`,
            read: false,
          };

          notificationsList.unshift(notif);
          forwardToMongoCollab('login', { name: cleanName, passcode: cleanPasscode, role, device, user: userObj, notification: notif });

          // Broadcast instantly to all connected SSE clients (e.g. Supervisor window)
          broadcastSSE({
            type: 'LOGIN_ALERT',
            notification: notif,
            user: userObj,
            users: getActiveUsersList(),
          });

          return sendJson(res, 200, {
            ok: true,
            user: userObj,
            notification: notif,
            settings: currentSettings,
          });
        }

        // 4. Admin / Supervisor Login: POST /api/collab/admin-login
        if (url.startsWith('/api/collab/admin-login') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const password = (body.password || '').trim();
          const name = (body.name || 'Supervisor').replace(/ \/ Operations Lead/g, '').trim() || 'Supervisor';

          if (password !== currentSettings.adminPassword) {
            return sendJson(res, 401, {
              ok: false,
              error: 'Invalid supervisor password.',
            });
          }

          const userId = `admin-${Date.now()}`;
          const userObj: CollabUser = {
            id: userId,
            name,
            role: 'supervisor',
            joinedAt: Date.now(),
            lastActive: Date.now(),
            status: 'online',
            device: 'Admin Console',
          };

          usersMap.set(userId, userObj);

          const notif: CollabNotification = {
            id: `notif-${Date.now()}`,
            type: 'login',
            userName: name,
            userRole: 'supervisor',
            timestamp: Date.now(),
            message: `${name} authenticated as Supervisor`,
            details: 'Full administrative and schedule lock privileges enabled.',
            read: false,
          };

          notificationsList.unshift(notif);
          forwardToMongoCollab('admin-login', { name, user: userObj, notification: notif });

          broadcastSSE({
            type: 'LOGIN_ALERT',
            notification: notif,
            user: userObj,
            users: getActiveUsersList(),
          });

          return sendJson(res, 200, {
            ok: true,
            user: userObj,
            notification: notif,
            settings: currentSettings,
          });
        }

        // 5. User Logout: POST /api/collab/logout
        if (url.startsWith('/api/collab/logout') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const userId = body.userId || '';
          const name = (body.name || 'Team Member').trim();
          const role = body.role || 'collaborator';

          // Remove user and any entries matching this name
          if (userId) usersMap.delete(userId);
          for (const [k, u] of usersMap.entries()) {
            if (u.name.trim().toLowerCase() === name.toLowerCase()) {
              usersMap.delete(k);
            }
          }

          const logoutNotif: CollabNotification = {
            id: `notif-logout-${Date.now()}`,
            type: 'logout',
            userName: name,
            userRole: role,
            timestamp: Date.now(),
            message: `${name} logged out of roster`,
            details: `Session ended (${role}).`,
            read: false,
          };

          notificationsList.unshift(logoutNotif);
          forwardToMongoCollab('logout', { userId, name, role, notification: logoutNotif });

          // Broadcast immediately to supervisor
          broadcastSSE({
            type: 'LOGOUT_ALERT',
            notification: logoutNotif,
            userId,
            userName: name,
            users: getActiveUsersList(),
          });

          return sendJson(res, 200, { ok: true });
        }

        // 6. Heartbeat Ping: POST /api/collab/heartbeat
        if (url.startsWith('/api/collab/heartbeat') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const userId = body.userId;
          const name = body.name;
          const role = body.role || 'collaborator';

          if (userId) {
            const existing = usersMap.get(userId);
            if (existing) {
              existing.lastActive = Date.now();
              existing.status = 'online';
            } else if (name) {
              usersMap.set(userId, {
                id: userId,
                name,
                role,
                joinedAt: Date.now(),
                lastActive: Date.now(),
                status: 'online',
              });
            }
          }
          forwardToMongoCollab('heartbeat', { userId, name, role });

          return sendJson(res, 200, {
            ok: true,
            users: getActiveUsersList(),
          });
        }

        // 7. Security Settings Update: POST /api/collab/settings
        if (url.startsWith('/api/collab/settings') && req.method === 'POST') {
          const body = await readJsonBody(req);
          if (body.settings) {
            const s = body.settings;
            // Ignore stale copies (e.g. an old tab saving after a newer change)
            if (typeof s.updatedAt === 'number' && s.updatedAt < currentSettings.updatedAt) {
              return sendJson(res, 200, { ok: true, settings: currentSettings });
            }
            if (typeof s.updatedAt === 'number') currentSettings.updatedAt = s.updatedAt;
            if (Array.isArray(s.assignedPasscodes)) currentSettings.assignedPasscodes = s.assignedPasscodes;
            if (s.adminPassword) currentSettings.adminPassword = s.adminPassword;
            if (typeof s.notifyOnLogin === 'boolean') currentSettings.notifyOnLogin = s.notifyOnLogin;
            if (typeof s.soundAlert === 'boolean') currentSettings.soundAlert = s.soundAlert;
            if (typeof s.requireName === 'boolean') currentSettings.requireName = s.requireName;

            forwardToMongoCollab('settings', { settings: currentSettings });

            broadcastSSE({
              type: 'SECURITY_SETTINGS_SYNC',
              settings: currentSettings,
            });
          }

          return sendJson(res, 200, {
            ok: true,
            settings: currentSettings,
          });
        }

        // 8. Clear Notifications: POST /api/collab/clear-notifications
        if (url.startsWith('/api/collab/clear-notifications') && req.method === 'POST') {
          notificationsList.length = 0;
          forwardToMongoCollab('clear-notifications', {});
          broadcastSSE({
            type: 'NOTIFICATIONS_CLEAR',
          });
          return sendJson(res, 200, { ok: true });
        }

        // 9. Dismiss Individual Notification: POST /api/collab/dismiss-notification
        if (url.startsWith('/api/collab/dismiss-notification') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const id = body.id;
          if (id) {
            const idx = notificationsList.findIndex((n) => n.id === id);
            if (idx !== -1) {
              notificationsList.splice(idx, 1);
            }
            forwardToMongoCollab('dismiss-notification', { id });
            broadcastSSE({
              type: 'NOTIFICATION_DISMISS',
              id,
            });
          }
          return sendJson(res, 200, { ok: true });
        }

        // 9b. Sync Notifications from Client to Server & MongoDB: POST /api/collab/notifications-sync
        if (url.startsWith('/api/collab/notifications-sync') && req.method === 'POST') {
          const body = await readJsonBody(req);
          if (Array.isArray(body.notifications)) {
            const existingIds = new Set(notificationsList.map((n) => n.id));
            for (const n of body.notifications) {
              if (n && n.id && !existingIds.has(n.id)) {
                notificationsList.push(n);
                existingIds.add(n.id);
              }
            }
            notificationsList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          }
          forwardToMongoCollab('notifications-sync', body);
          return sendJson(res, 200, { ok: true, notifications: notificationsList.slice(0, 50) });
        }

        // 10. Database Sync: GET /api/collab/db
        if (url.startsWith('/api/collab/db') && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            data: await loadServerDbAsync(),
          });
        }

        // 11. Database Update: POST /api/collab/db
        if (url === '/api/collab/db' && req.method === 'POST') {
          const body = await readJsonBody(req);
          if (body && typeof body === 'object') {
            saveServerDb(body);
            broadcastSSE({
              type: 'SERVER_DB_SYNC',
              timestamp: Date.now(),
              senderClientId: body.clientId,
              data: body,
            });
            return sendJson(res, 200, { ok: true });
          }
          return sendJson(res, 400, { error: 'Invalid data' });
        }

        // 12. Delete Line Cascade on Server: POST /api/collab/db/delete-line
        if (url.startsWith('/api/collab/db/delete-line') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const lineId = body.lineId;
          const sdb = loadServerDb();
          if (sdb && lineId) {
            sdb.lines = (sdb.lines || []).filter((l: any) => l.id !== lineId);
            sdb.codes = (sdb.codes || []).filter((c: any) => c.scope !== lineId);
            const lineEmpIds = new Set(
              (sdb.employees || []).filter((e: any) => e.lineId === lineId).map((e: any) => e.id),
            );
            sdb.employees = (sdb.employees || []).filter((e: any) => e.lineId !== lineId);
            sdb.leave = (sdb.leave || []).filter((l: any) => !lineEmpIds.has(l.employeeId));
            sdb.rosters = (sdb.rosters || []).filter((r: any) => r.lineId !== lineId);
            sdb.allocations = (sdb.allocations || []).filter((a: any) => !lineEmpIds.has(a.personId));
            if (Array.isArray(sdb.workOrders)) {
              sdb.workOrders = sdb.workOrders.map((wo: any) => ({
                ...wo,
                assignedEmployeeIds: (wo.assignedEmployeeIds || []).filter((id: string) => !lineEmpIds.has(id)),
              }));
            }
            if (sdb.settings) {
              const nextLineMonths = { ...(sdb.settings.lineMonths || {}) };
              delete nextLineMonths[lineId];
              sdb.settings.lineMonths = nextLineMonths;
              if (sdb.settings.activeLineId === lineId) {
                const nextLine = (sdb.lines || [])[0];
                sdb.settings.activeLineId = nextLine?.id ?? 'line5';
              }
            }
            saveServerDb(sdb);
            broadcastSSE({
              type: 'SERVER_DB_SYNC',
              timestamp: Date.now(),
              data: sdb,
            });
          }
          return sendJson(res, 200, { ok: true });
        }

        // 13. Delete Employee Cascade on Server: POST /api/collab/db/delete-employee
        if (url.startsWith('/api/collab/db/delete-employee') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const empId = body.empId;
          const sdb = loadServerDb();
          if (sdb && empId) {
            sdb.employees = (sdb.employees || []).filter((e: any) => e.id !== empId);
            sdb.leave = (sdb.leave || []).filter((l: any) => l.employeeId !== empId);
            sdb.allocations = (sdb.allocations || []).filter((a: any) => a.personId !== empId);
            if (Array.isArray(sdb.rosters)) {
              sdb.rosters = sdb.rosters.map((r: any) => {
                if (r.cells?.[empId] || r.overrides?.[empId] || r.extraHours?.[empId]) {
                  const nextCells = { ...r.cells };
                  const nextOverrides = { ...r.overrides };
                  const nextExtraHours = { ...(r.extraHours || {}) };
                  delete nextCells[empId];
                  delete nextOverrides[empId];
                  delete nextExtraHours[empId];
                  return { ...r, cells: nextCells, overrides: nextOverrides, extraHours: nextExtraHours };
                }
                return r;
              });
            }
            if (Array.isArray(sdb.workOrders)) {
              sdb.workOrders = sdb.workOrders.map((wo: any) => ({
                ...wo,
                assignedEmployeeIds: (wo.assignedEmployeeIds || []).filter((id: string) => id !== empId),
              }));
            }
            saveServerDb(sdb);
            broadcastSSE({
              type: 'SERVER_DB_SYNC',
              timestamp: Date.now(),
              data: sdb,
            });
          }
          return sendJson(res, 200, { ok: true });
        }

        // 14. Delete Shift Code on Server: POST /api/collab/db/delete-code
        if (url.startsWith('/api/collab/db/delete-code') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const { codeId, scope } = body;
          const sdb = loadServerDb();
          if (sdb && codeId) {
            sdb.codes = (sdb.codes || []).filter((c: any) => !(c.id === codeId && (!scope || c.scope === scope)));
            saveServerDb(sdb);
            broadcastSSE({
              type: 'SERVER_DB_SYNC',
              timestamp: Date.now(),
              data: sdb,
            });
          }
          return sendJson(res, 200, { ok: true });
        }

        // 15. Clear Work Orders on Server: POST /api/collab/db/clear-workorders
        if (url.startsWith('/api/collab/db/clear-workorders') && req.method === 'POST') {
          const sdb = loadServerDb();
          if (sdb) {
            sdb.workOrders = [];
            sdb.allocations = [];
            if (sdb.settings) {
              delete sdb.settings.lastWorkOrderImport;
            }
            saveServerDb(sdb);
            broadcastSSE({
              type: 'SERVER_DB_SYNC',
              timestamp: Date.now(),
              data: sdb,
            });
          }
          return sendJson(res, 200, { ok: true });
        }

        // 10. Upload Work Orders: POST /api/upload-workorders
        if (url.startsWith('/api/upload-workorders') && req.method === 'POST') {
          const body = await readJsonBody(req);
          const workOrders = Array.isArray(body.workOrders) ? body.workOrders : [];
          serverWorkOrders = workOrders;
          broadcastSSE({ type: 'WORK_ORDERS_UPDATED', count: workOrders.length });
          return sendJson(res, 200, {
            ok: true,
            message: `Successfully uploaded and validated ${workOrders.length} work orders.`,
            count: workOrders.length,
          });
        }

        // 11. Allocate Resources: POST /api/allocate-resources
        if (url.startsWith('/api/allocate-resources') && req.method === 'POST') {
          const body = await readJsonBody(req);
          return sendJson(res, 200, {
            ok: true,
            allocatedCount: body.allocatedCount ?? serverWorkOrders.length,
            conflicts: body.conflicts ?? [],
            buffer: body.buffer ?? 1,
          });
        }

        // 12. Allocation Grid: GET /api/allocation-grid
        if (url.startsWith('/api/allocation-grid') && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            workOrders: serverWorkOrders,
          });
        }

        // 13. Resource Conflicts: GET /api/resource-conflicts
        if (url.startsWith('/api/resource-conflicts') && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            conflicts: [
              {
                line: 'L4',
                shift: 'morning',
                date: '2026-11-12',
                need: 3,
                have: 2,
                short: 1,
                reason: 'Line 4 Morning PM short 1 person',
              },
            ],
          });
        }

        // 14. Export Roster: POST /api/export-roster
        if (url.startsWith('/api/export-roster') && req.method === 'POST') {
          return sendJson(res, 200, {
            ok: true,
            exportUrl: '/exports/November_Work_Orders_Allocations.xlsx',
            timestamp: new Date().toISOString(),
          });
        }

        return next();
      });
    },
  };
}
