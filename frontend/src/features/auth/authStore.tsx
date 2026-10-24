import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getSettings, importBackupData, setActiveDatabase } from '@/data/db';
import { useToast } from '@/components/ui';

import { playNotificationChime } from './sound';
import { matchPasscode } from './types';
import type {
  AssignedPasscode,
  CollabBroadcastMessage,
  LoginNotification,
  PresenceUser,
  SecuritySettings,
  UserRole,
  UserSession,
} from './types';

const TAB_SESSION_KEY = 'shiftline.auth.session.tab.v1';
const GLOBAL_SESSION_KEY = 'shiftline.auth.session.v1';
const SETTINGS_STORAGE_KEY = 'shiftline.auth.security.v1';
const NOTIFICATIONS_STORAGE_KEY = 'shiftline.auth.notifications.v1';
const PRESENCE_REGISTRY_KEY = 'shiftline.auth.presence_registry.v1';
const BROADCAST_CHANNEL_NAME = 'shiftline_collab_network_v1';

export const DEFAULT_ASSIGNED_PASSCODES: AssignedPasscode[] = [
  {
    id: 'assign-hasnain',
    assignedTo: 'Hasnain',
    passcode: 'shift-hasnain-92',
    role: 'collaborator',
    createdAt: Date.now() - 86400000 * 2,
    status: 'active',
    notes: 'IT Operations Partner direct link',
    workspaceMode: 'shared',
    allowedLineId: 'all',
  },
  {
    id: 'assign-arif',
    assignedTo: 'Arif',
    passcode: 'shift-arif-44',
    role: 'collaborator',
    createdAt: Date.now() - 86400000,
    status: 'active',
    notes: 'Team Collaborator direct link',
    workspaceMode: 'shared',
    allowedLineId: 'all',
  },
  {
    id: 'assign-latif',
    assignedTo: 'Latif',
    passcode: 'shift-latif-71',
    role: 'collaborator',
    createdAt: Date.now() - 3600000 * 6,
    status: 'active',
    notes: 'Operations Line Staff direct link',
    workspaceMode: 'isolated',
    allowedLineId: 'all',
  },
];

const DEFAULT_SETTINGS: SecuritySettings = {
  updatedAt: 0,
  assignedPasscodes: DEFAULT_ASSIGNED_PASSCODES,
  adminPassword: 'supervisor1',
  requireName: true,
  notifyOnLogin: true,
  soundAlert: true,
};

/**
 * Fills in defaults for settings coming from storage, other tabs or the server.
 * An empty assigned list is kept as-is (all links revoked). Leftover fields from the
 * removed shared-passcode feature (and its 'assign-general' row) are dropped.
 */
export function normalizeSecuritySettings(raw: Partial<SecuritySettings> | null | undefined): SecuritySettings {
  const { sharedPasscode: _s, accessMode: _m, defaultSharedRole: _r, recentPasscodes: _p, ...rest } =
    (raw || {}) as Partial<SecuritySettings> & Record<string, unknown>;
  const assigned = Array.isArray(raw?.assignedPasscodes) ? raw!.assignedPasscodes! : DEFAULT_ASSIGNED_PASSCODES;
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    assignedPasscodes: assigned
      .filter((a) => a && a.id !== 'assign-general' && a.passcode)
      .map((a) => ({
        ...a,
        workspaceMode: a.workspaceMode || 'shared',
        allowedLineId: a.allowedLineId || 'all',
      })),
  };
};

function persistSettingsLocally(settings: SecuritySettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function getStoredPresenceRegistry(): Record<string, PresenceUser> {
  try {
    const raw = localStorage.getItem(PRESENCE_REGISTRY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePresenceRegistry(registry: Record<string, PresenceUser>) {
  try {
    localStorage.setItem(PRESENCE_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    /* ignore */
  }
}

interface AuthContextType {
  session: UserSession | null;
  isAuthenticated: boolean;
  securitySettings: SecuritySettings;
  notifications: LoginNotification[];
  unreadCount: number;
  activeUsers: PresenceUser[];
  loginWithPasscode: (name: string, passcode: string, role?: UserRole) => boolean;
  loginAsAdmin: (password: string, name?: string) => boolean;
  logout: () => void;
  updateSecuritySettings: (patch: Partial<SecuritySettings>) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  dismissNotification: (id: string) => void;
  simulateLoginAlert: (customName?: string) => void;
  broadcastCellEdit: (rosterId: string, employeeId: string, dayIndex: number, code: string) => void;
  subscribeToRemoteCellEdits: (
    callback: (data: { rosterId: string; employeeId: string; dayIndex: number; code: string; updatedBy: string }) => void,
  ) => () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();

  // 1. Security Settings
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return normalizeSecuritySettings(stored ? JSON.parse(stored) : null);
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // 2. Session (Tab isolated so testing supervisor + collaborator in two tabs works cleanly!)
  const [session, setSession] = useState<UserSession | null>(() => {
    try {
      // Check if URL has a specific passcode param — if so, do NOT inherit globalStored!
      let urlPasscode: string | null = null;
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        urlPasscode = params.get('code') || params.get('passcode') || params.get('p');
        if (!urlPasscode && window.location.hash.includes('?')) {
          const hp = new URLSearchParams(window.location.hash.split('?')[1]);
          urlPasscode = hp.get('code') || hp.get('passcode') || hp.get('p');
        }
      }

      if (urlPasscode) {
        // If a direct link URL (?code=...) is opened or pasted, always present the Login Gate
        // pre-filled with the credentials so the user explicitly clicks to log in.
        sessionStorage.removeItem(TAB_SESSION_KEY);
        return null;
      }

      // A sign-in belongs to ONE tab: a refresh keeps it, but an address pasted into a new
      // tab or window starts signed out and asks for the login.
      const tabStored = sessionStorage.getItem(TAB_SESSION_KEY);
      const s: UserSession | null = tabStored ? JSON.parse(tabStored) : null;
      // Drop any shared sign-in an older version left behind in this browser
      localStorage.removeItem(GLOBAL_SESSION_KEY);
      if (s) {
        s.name = s.name.replace(/ \/ Operations Lead/g, '').trim() || 'Supervisor';
        if (s.role !== 'supervisor' && s.passcodeUsed) {
          const cleanCode = s.passcodeUsed.replace(/[^a-z0-9_-]/gi, '_');
          setActiveDatabase(`shiftline_collab_${cleanCode}`);
        } else {
          setActiveDatabase('shiftline');
        }
        return s;
      }
      return null;
    } catch {
      return null;
    }
  });

  // 3. Notifications list
  const [notifications, setNotifications] = useState<LoginNotification[]>(() => {
    try {
      const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      if (stored !== null) return JSON.parse(stored);
    } catch {
      /* ignore */
    }
    return [];
  });

  const mountTimeRef = useRef<number>(Date.now());
  const alertedIdsRef = useRef<Set<string>>(new Set());

  // Track already-seen notification IDs on mount so refreshing the page NEVER plays alert sounds or toasts
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          parsed.forEach((n: any) => alertedIdsRef.current.add(n.id));
        }
      }
    } catch {}
  }, []);

  // 4. Live Presence (Who is Online / Offline)
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

  // Refs to avoid tearing down BroadcastChannel or event listeners
  const sessionRef = useRef<UserSession | null>(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const securitySettingsRef = useRef<SecuritySettings>(securitySettings);
  useEffect(() => {
    securitySettingsRef.current = securitySettings;
  }, [securitySettings]);

  const notificationsRef = useRef<LoginNotification[]>(notifications);
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const cellSubscribersRef = useRef<Set<(data: any) => void>>(new Set());
  const serverUsersRef = useRef<PresenceUser[]>([]);

  // Save Settings & Broadcast to all open tabs
  const updateSecuritySettings = useCallback((patch: Partial<SecuritySettings>) => {
    // Only a signed-in supervisor may change the supervisor master password
    if ('adminPassword' in patch && sessionRef.current?.role !== 'supervisor') {
      const { adminPassword: _ignored, ...rest } = patch;
      patch = rest;
    }
    setSecuritySettings((prev) => {
      const next = normalizeSecuritySettings({ ...prev, ...patch, updatedAt: Date.now() });
      persistSettingsLocally(next);

      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'SECURITY_SETTINGS_SYNC',
          settings: next,
        } as CollabBroadcastMessage);
      }

      try {
        fetch('/api/collab/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: next }),
        }).catch(() => {});
      } catch {}

      return next;
    });
  }, []);

  // Compute active presence list from shared registry + server users + current tab
  const syncPresenceState = useCallback(() => {
    const registry = getStoredPresenceRegistry();
    const now = Date.now();
    const list: PresenceUser[] = [];
    const cur = sessionRef.current;
    const seenNames = new Set<string>();

    if (cur) {
      seenNames.add(cur.name.trim().toLowerCase());
    }

    // 1. First include live server users (from Incognito / Cross-Browser / Network)
    for (const user of serverUsersRef.current) {
      const isSelf = cur
        ? user.id === cur.id || user.name.trim().toLowerCase() === cur.name.trim().toLowerCase()
        : false;
      const norm = user.name.trim().toLowerCase();
      if (!isSelf && !seenNames.has(norm) && user.status === 'online') {
        seenNames.add(norm);
        list.push({
          ...user,
          status: 'online',
          isSelf: false,
        });
      }
    }

    // 2. Next include local tab storage registry
    for (const [id, user] of Object.entries(registry)) {
      const isSelf = cur
        ? id === cur.id || user.name.trim().toLowerCase() === cur.name.trim().toLowerCase()
        : false;
      const isRecent = now - user.lastActive < 60000;
      const isOnline = user.status === 'online' && isRecent;

      if (isOnline && !isSelf) {
        const norm = user.name.trim().toLowerCase();
        if (!seenNames.has(norm)) {
          seenNames.add(norm);
          list.push({
            ...user,
            status: 'online',
            isSelf: false,
          });
        }
      }
    }

    // Always include current session as online at the top
    if (cur) {
      list.unshift({
        id: cur.id,
        name: cur.name,
        role: cur.role,
        joinedAt: cur.loginTime,
        lastActive: now,
        status: 'online',
        isSelf: true,
      });
    }

    // Sort: self first, then other online users by joinedAt
    list.sort((a, b) => {
      if (a.isSelf) return -1;
      if (b.isSelf) return 1;
      return a.joinedAt - b.joinedAt;
    });

    setActiveUsers(list);
  }, []);

  // Note: a ?code= in the URL only pre-fills the login form (see LoginGate);
  // it must never change the stored passcode, or any link would unlock itself.

  // Save Notifications
  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)));
    } catch {
      /* ignore */
    }
  }, [notifications]);

  const updatePresenceFromList = useCallback((remoteUsers: PresenceUser[]) => {
    serverUsersRef.current = remoteUsers;
    const cur = sessionRef.current;
    const now = Date.now();
    const list: PresenceUser[] = [];
    const seenNames = new Set<string>();

    if (cur) {
      seenNames.add(cur.name.trim().toLowerCase());
      list.push({
        id: cur.id,
        name: cur.name,
        role: cur.role,
        joinedAt: cur.loginTime,
        lastActive: now,
        status: 'online',
        isSelf: true,
      });
    }

    for (const u of remoteUsers) {
      const isSelf = cur ? u.id === cur.id || u.name.trim().toLowerCase() === cur.name.trim().toLowerCase() : false;
      const norm = u.name.trim().toLowerCase();
      if (!isSelf && !seenNames.has(norm) && u.status === 'online') {
        seenNames.add(norm);
        list.push({
          ...u,
          status: 'online',
          isSelf: false,
        });
      }
    }

    // Persist to registry as well
    const registry = getStoredPresenceRegistry();
    for (const u of remoteUsers) {
      registry[u.id] = { ...u, lastActive: Date.now(), status: 'online' };
    }
    savePresenceRegistry(registry);

    setActiveUsers(list);
  }, []);

  // Real-Time Server-Sent Events (SSE) Client: Connects Incognito, Cross-Browser, and Networked Devices!
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/collab/events');

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg || !msg.type) return;

          if (msg.type === 'INIT_SYNC') {
            // Newer copy wins: adopt the server's settings, or push ours up if the
            // server restarted and lost them (it starts with updatedAt = 0).
            const local = securitySettingsRef.current;
            const serverUpdatedAt = msg.settings?.updatedAt || 0;
            if (msg.settings && serverUpdatedAt >= (local.updatedAt || 0)) {
              const incoming = normalizeSecuritySettings(msg.settings);
              persistSettingsLocally(incoming);
              setSecuritySettings(incoming);
            } else if ((local.updatedAt || 0) > serverUpdatedAt) {
              fetch('/api/collab/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: local }),
              }).catch(() => {});
            }
            if (Array.isArray(msg.notifications)) {
              const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
              if (stored === '[]') {
                setNotifications([]);
              } else {
                const localNotifs = notificationsRef.current || [];
                const mergedMap = new Map<string, LoginNotification>();
                for (const n of [...msg.notifications, ...localNotifs]) {
                  if (n && n.id) mergedMap.set(n.id, n);
                }
                const mergedList = [...mergedMap.values()].sort(
                  (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
                );
                if (mergedList.length > 0) {
                  setNotifications(mergedList);
                  mergedList.forEach((n: any) => alertedIdsRef.current.add(n.id));
                  fetch('/api/collab/notifications-sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notifications: mergedList }),
                  }).catch(() => {});
                }
              }
            }
            if (Array.isArray(msg.users)) {
              updatePresenceFromList(msg.users);
            }
            if (msg.serverDb && sessionRef.current?.role === 'supervisor') {
              const serverTime = msg.serverDb.updatedAt || 0;
              getSettings().then((localSettings) => {
                const localTime = localSettings?.updatedAt || 0;
                if (serverTime > localTime) {
                  importBackupData(msg.serverDb).catch(() => {});
                }
              }).catch(() => {});
            }
          } else if (msg.type === 'SERVER_DB_SYNC') {
            if (sessionRef.current?.role !== 'supervisor') {
              return;
            }
            const myClientId = typeof window !== 'undefined' ? (window as any).__shiftline_client_id : undefined;
            if (msg.senderClientId && myClientId && msg.senderClientId === myClientId) {
              // Ignore self-broadcast to avoid clearing and re-writing local DB
              return;
            }
            if (msg.data) {
              const serverTime = msg.data.updatedAt || 0;
              getSettings().then((localSettings) => {
                const localTime = localSettings?.updatedAt || 0;
                if (serverTime > localTime) {
                  importBackupData(msg.data).catch(() => {});
                }
              }).catch(() => {});
            }
          } else if (msg.type === 'NOTIFICATIONS_CLEAR') {
            setNotifications([]);
            try {
              localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify([]));
            } catch {}
          } else if (msg.type === 'NOTIFICATION_DISMISS') {
            const dismissedId = msg.id;
            setNotifications((prev) => prev.filter((n) => n.id !== dismissedId));
            try {
              const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
              if (stored) {
                const list: LoginNotification[] = JSON.parse(stored);
                localStorage.setItem(
                  NOTIFICATIONS_STORAGE_KEY,
                  JSON.stringify(list.filter((n) => n.id !== dismissedId)),
                );
              }
            } catch {}
          } else if (msg.type === 'LOGIN_ALERT') {
            setNotifications((prev) => {
              if (prev.some((n) => n.id === msg.notification.id)) return prev;
              return [msg.notification, ...prev];
            });

            if (Array.isArray(msg.users)) {
              updatePresenceFromList(msg.users);
            } else if (msg.user) {
              updatePresenceFromList([...serverUsersRef.current, msg.user]);
            }

            // Supervisor receives loud chime and toast alert immediately (only for fresh real-time events)
            if (sessionRef.current?.role === 'supervisor') {
              const isNew = !alertedIdsRef.current.has(msg.notification.id);
              if (isNew) {
                alertedIdsRef.current.add(msg.notification.id);
                toast(
                  `🔔 Login Alert: ${msg.notification.userName} has logged in via shared link!`,
                  'ok',
                );
                if (securitySettingsRef.current.soundAlert) {
                  playNotificationChime();
                }
              }
            }
          } else if (msg.type === 'LOGOUT_ALERT') {
            setNotifications((prev) => {
              if (prev.some((n) => n.id === msg.notification.id)) return prev;
              return [msg.notification, ...prev];
            });

            if (Array.isArray(msg.users)) {
              updatePresenceFromList(msg.users);
            } else {
              serverUsersRef.current = serverUsersRef.current.filter(
                (u) =>
                  u.name.trim().toLowerCase() !== msg.userName.trim().toLowerCase() &&
                  u.id !== msg.userId,
              );
              syncPresenceState();
            }

            // Supervisor receives logout alert & chime (only for fresh real-time events)
            if (sessionRef.current?.role === 'supervisor') {
              const isNew = !alertedIdsRef.current.has(msg.notification.id);
              if (isNew) {
                alertedIdsRef.current.add(msg.notification.id);
                toast(`🔔 Logout Alert: ${msg.notification.userName} has logged out.`, 'info');
                if (securitySettingsRef.current.soundAlert) {
                  playNotificationChime();
                }
              }
            }
          } else if (msg.type === 'PRESENCE_SYNC') {
            if (Array.isArray(msg.users)) {
              updatePresenceFromList(msg.users);
            }
          } else if (msg.type === 'SECURITY_SETTINGS_SYNC') {
            if (msg.settings && (msg.settings.updatedAt || 0) >= (securitySettingsRef.current.updatedAt || 0)) {
              const incoming = normalizeSecuritySettings(msg.settings);
              persistSettingsLocally(incoming);
              setSecuritySettings(incoming);
            }
          }
        } catch {
          /* ignore parse error */
        }
      };
    } catch {
      /* EventSource fallback */
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  }, [toast, updatePresenceFromList]);

  // Unread Count
  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  // Initialize Broadcast Channel (Local Tab Bridge)
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channelRef.current = bc;
      bc.onmessage = (event) => {
        const msg = event.data as CollabBroadcastMessage;
        if (!msg) return;

        if (msg.type === 'SECURITY_SETTINGS_SYNC') {
          setSecuritySettings(normalizeSecuritySettings(msg.settings));
        } else if (msg.type === 'LOGIN_ALERT') {
          // Record notification
          setNotifications((prev) => {
            if (prev.some((n) => n.id === msg.notification.id)) return prev;
            return [msg.notification, ...prev];
          });

          // Update registry with new user
          const registry = getStoredPresenceRegistry();
          registry[msg.user.id] = { ...msg.user, status: 'online', lastActive: Date.now() };
          savePresenceRegistry(registry);
          syncPresenceState();

          // Only the supervisor receives audible chimes and instant toast alerts
          if (sessionRef.current?.role === 'supervisor') {
            toast(
              `🔔 Login Alert: ${msg.notification.userName} has logged in via shared link!`,
              'ok',
            );

            if (securitySettingsRef.current.soundAlert) {
              playNotificationChime();
            }
          }
        } else if (msg.type === 'PRESENCE_PING' || msg.type === 'PRESENCE_PONG') {
          const registry = getStoredPresenceRegistry();
          registry[msg.user.id] = { ...msg.user, status: 'online', lastActive: Date.now() };
          savePresenceRegistry(registry);
          syncPresenceState();

          // Respond with PONG if requested
          if (msg.type === 'PRESENCE_PING' && sessionRef.current && sessionRef.current.id !== msg.user.id) {
            bc?.postMessage({
              type: 'PRESENCE_PONG',
              user: {
                id: sessionRef.current.id,
                name: sessionRef.current.name,
                role: sessionRef.current.role,
                joinedAt: sessionRef.current.loginTime,
                lastActive: Date.now(),
                status: 'online',
              },
            } as CollabBroadcastMessage);
          }
        } else if (msg.type === 'LOGOUT_ALERT') {
          // Record logout notification
          setNotifications((prev) => {
            if (prev.some((n) => n.id === msg.notification.id)) return prev;
            return [msg.notification, ...prev];
          });

          // Prune from presence registry so user is immediately removed from online
          const registry = getStoredPresenceRegistry();
          delete registry[msg.userId];
          for (const [key, val] of Object.entries(registry)) {
            if (val.name.trim().toLowerCase() === msg.notification.userName.trim().toLowerCase()) {
              delete registry[key];
            }
          }
          savePresenceRegistry(registry);
          syncPresenceState();

          // Supervisor receives immediate notification and loud audible chime
          if (sessionRef.current?.role === 'supervisor') {
            toast(`🔔 Logout Alert: ${msg.notification.userName} has logged out.`, 'info');
            if (securitySettingsRef.current.soundAlert) {
              playNotificationChime();
            }
          }
        } else if (msg.type === 'PRESENCE_LEAVE') {
          const registry = getStoredPresenceRegistry();
          const leavingUser = registry[msg.userId];
          delete registry[msg.userId];
          savePresenceRegistry(registry);
          syncPresenceState();

          if (leavingUser && sessionRef.current?.role === 'supervisor') {
            toast(`🔔 ${leavingUser.name} has left the session.`, 'info');
          }
        } else if (msg.type === 'ROSTER_CELL_UPDATE') {
          // Do not mutate other logins/tabs
          return;
        } else if (msg.type === 'SERVER_DB_SYNC') {
          if (sessionRef.current?.role !== 'supervisor') return;
          const myClientId = typeof window !== 'undefined' ? (window as any).__shiftline_client_id : undefined;
          if ((msg as any).senderClientId && myClientId && (msg as any).senderClientId === myClientId) {
            return;
          }
          if (msg.data) {
            importBackupData(msg.data).catch(() => {});
          }
        }
      };
    } catch {
      /* BroadcastChannel not supported in ancient envs */
    }

    return () => {
      if (bc) {
        bc.close();
        channelRef.current = null;
      }
    };
  }, [syncPresenceState, toast]);

  // Periodic Heartbeat + Cross-Tab Polling
  useEffect(() => {
    syncPresenceState();

    const interval = setInterval(() => {
      const cur = sessionRef.current;
      const now = Date.now();

      // 1. Send heartbeat if session active
      if (cur) {
        const registry = getStoredPresenceRegistry();
        registry[cur.id] = {
          id: cur.id,
          name: cur.name,
          role: cur.role,
          joinedAt: cur.loginTime,
          lastActive: now,
          status: 'online',
        };
        savePresenceRegistry(registry);

        if (channelRef.current) {
          channelRef.current.postMessage({
            type: 'PRESENCE_PING',
            user: { ...registry[cur.id], isSelf: false },
          } as CollabBroadcastMessage);
        }

        try {
          fetch('/api/collab/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: cur.id,
              name: cur.name,
              role: cur.role,
            }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data && data.ok && Array.isArray(data.users)) {
                updatePresenceFromList(data.users);
              }
            })
            .catch(() => {});
        } catch {}
      }

      // 2. Recompute presence state
      syncPresenceState();

      // 3. Auto-sync notifications from storage for Supervisor
      if (sessionRef.current?.role === 'supervisor') {
        try {
          const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
          if (stored) {
            const parsed: LoginNotification[] = JSON.parse(stored);
            const currentIds = new Set(notificationsRef.current.map((n) => n.id));
            const newOnes = parsed.filter(
              (n) => !currentIds.has(n.id) && !alertedIdsRef.current.has(n.id),
            );
            if (newOnes.length > 0) {
              setNotifications(parsed);
              const latest = newOnes[0];
              const isRecent = latest.timestamp > mountTimeRef.current - 2000;
              if (isRecent) {
                alertedIdsRef.current.add(latest.id);
                const isLogout = latest.type === 'logout';
                toast(
                  isLogout
                    ? `🔔 Logout Alert: ${latest.userName} has logged out.`
                    : `🔔 Login Alert: ${latest.userName} has logged in via shared link!`,
                  isLogout ? 'info' : 'ok',
                );
                if (securitySettingsRef.current.soundAlert) {
                  playNotificationChime();
                }
              }
            } else if (parsed.length !== notificationsRef.current.length) {
              setNotifications(parsed);
            }
          }
        } catch {
          /* ignore */
        }
      }
    }, 2000);

    const onWindowFocus = () => {
      const cur = sessionRef.current;
      if (cur) {
        fetch('/api/collab/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: cur.id,
            name: cur.name,
            role: cur.role,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data && data.ok && Array.isArray(data.users)) {
              updatePresenceFromList(data.users);
            }
          })
          .catch(() => {});
      }
    };

    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('visibilitychange', onWindowFocus);

    // Cross-Tab Storage Event Listener
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY && e.newValue) {
        try {
          setSecuritySettings(normalizeSecuritySettings(JSON.parse(e.newValue)));
        } catch {}
      } else if (e.key === PRESENCE_REGISTRY_KEY) {
        syncPresenceState();
      } else if (e.key === NOTIFICATIONS_STORAGE_KEY && e.newValue) {
        try {
          const parsed: LoginNotification[] = JSON.parse(e.newValue);
          const currentIds = new Set(notificationsRef.current.map((n) => n.id));
          const newOnes = parsed.filter((n) => !currentIds.has(n.id));
          setNotifications(parsed);
          if (newOnes.length > 0 && sessionRef.current?.role === 'supervisor') {
            const latest = newOnes[0];
            const isLogout = latest.type === 'logout';
            toast(
              isLogout
                ? `🔔 Logout Alert: ${latest.userName} has logged out.`
                : `🔔 Login Alert: ${latest.userName} has logged in via shared link!`,
              isLogout ? 'info' : 'ok',
            );
            if (securitySettingsRef.current.soundAlert) {
              playNotificationChime();
            }
          }
        } catch {}
      }
    };

    window.addEventListener('storage', onStorage);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('visibilitychange', onWindowFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [syncPresenceState, toast]);

  // Handle tab unload (remove from active presence)
  useEffect(() => {
    const onBeforeUnload = () => {
      const cur = sessionRef.current;
      if (cur) {
        const registry = getStoredPresenceRegistry();
        delete registry[cur.id];
        savePresenceRegistry(registry);
        if (channelRef.current) {
          channelRef.current.postMessage({
            type: 'PRESENCE_LEAVE',
            userId: cur.id,
          } as CollabBroadcastMessage);
        }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Login With Assigned Passcode
  const loginWithPasscode = useCallback(
    (name: string, passcode: string, role: UserRole = 'collaborator') => {
      const cleanPasscode = passcode.trim().toLowerCase();
      const cleanName = name.trim() || 'Team Member';

      // Always check latest stored settings to prevent multi-tab race conditions
      let latestSettings = securitySettingsRef.current;
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          const parsed = normalizeSecuritySettings(JSON.parse(stored));
          if ((parsed.updatedAt || 0) >= (latestSettings.updatedAt || 0)) latestSettings = parsed;
        }
      } catch {
        /* ignore */
      }

      // Only a person's own assigned (not revoked) passcode unlocks the roster
      const assignedMatch = matchPasscode(latestSettings, cleanPasscode);
      if (!assignedMatch) {
        return false;
      }

      if (assignedMatch) {
        const updatedList = (latestSettings.assignedPasscodes || []).map((a) =>
          a.id === assignedMatch.id ? { ...a, lastUsedAt: Date.now() } : a,
        );
        updateSecuritySettings({ assignedPasscodes: updatedList });
      }

      const effectiveRole = assignedMatch.role || role;
      const effectiveName = (cleanName && cleanName !== 'Team Member')
        ? cleanName
        : (assignedMatch?.assignedTo || cleanName);

      const effectiveWorkspaceMode = assignedMatch?.workspaceMode || 'shared';
      const effectiveAllowedLineId = assignedMatch?.allowedLineId || 'all';

      const newSession: UserSession = {
        id: `sess-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: effectiveName,
        role: effectiveRole,
        loginTime: Date.now(),
        passcodeUsed: cleanPasscode,
        device: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Browser',
        workspaceMode: effectiveWorkspaceMode,
        allowedLineId: effectiveAllowedLineId,
      };

      if (effectiveRole !== 'supervisor' && cleanPasscode) {
        const cleanCode = cleanPasscode.replace(/[^a-z0-9_-]/gi, '_');
        setActiveDatabase(`shiftline_collab_${cleanCode}`);
      } else {
        setActiveDatabase('shiftline');
      }

      setSession(newSession);
      sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(newSession));

      // Create notification
      const notif: LoginNotification = {
        id: `notif-${Date.now()}`,
        type: 'login',
        userName: effectiveName,
        userRole: effectiveRole,
        timestamp: Date.now(),
        message: `${effectiveName} logged in via shared link`,
        details: assignedMatch
          ? `Access granted using personalized link assigned to ${assignedMatch.assignedTo} (passcode: "${cleanPasscode}"). Device: ${newSession.device}.`
          : `Access granted with passcode. Device: ${newSession.device}.`,
        read: false,
      };

      // Add to notifications & persist
      setNotifications((prev) => {
        const updated = [notif, ...prev];
        try {
          localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated.slice(0, 50)));
        } catch {}
        return updated;
      });

      // Register presence in shared registry
      const userObj: PresenceUser = {
        id: newSession.id,
        name: newSession.name,
        role: newSession.role,
        joinedAt: newSession.loginTime,
        lastActive: Date.now(),
        status: 'online',
      };
      const registry = getStoredPresenceRegistry();
      registry[newSession.id] = userObj;
      savePresenceRegistry(registry);
      syncPresenceState();

      // Broadcast to other open windows/sessions (Local BroadcastChannel)
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'LOGIN_ALERT',
          notification: notif,
          user: userObj,
        } as CollabBroadcastMessage);
      }

      // Sync with collaboration backend (works across Incognito, different browsers & devices)
      try {
        fetch('/api/collab/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: cleanName,
            passcode: cleanPasscode,
            role,
            device: newSession.device,
          }),
        }).catch(() => {});
      } catch {}

      return true;
    },
    [syncPresenceState],
  );

  // Login As Admin / Supervisor
  const loginAsAdmin = useCallback(
    (password: string, name = 'Supervisor') => {
      const cleanPassword = password.trim();
      const cleanName = name.replace(/ \/ Operations Lead/g, '').trim() || 'Supervisor';
      if (cleanPassword !== securitySettingsRef.current.adminPassword) {
        return false;
      }

      const newSession: UserSession = {
        id: `admin-${Date.now()}`,
        name: cleanName,
        role: 'supervisor',
        loginTime: Date.now(),
        passcodeUsed: 'admin_password',
        device: 'Admin Console',
        workspaceMode: 'shared',
        allowedLineId: 'all',
      };
      setActiveDatabase('shiftline');

      setSession(newSession);
      sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(newSession));

      const notif: LoginNotification = {
        id: `notif-${Date.now()}`,
        type: 'login',
        userName: newSession.name,
        userRole: 'supervisor',
        timestamp: Date.now(),
        message: `${newSession.name} authenticated as Supervisor`,
        details: 'Full administrative and schedule lock privileges enabled.',
        read: false,
      };

      setNotifications((prev) => {
        const updated = [notif, ...prev];
        try {
          localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated.slice(0, 50)));
        } catch {}
        return updated;
      });

      const userObj: PresenceUser = {
        id: newSession.id,
        name: newSession.name,
        role: 'supervisor',
        joinedAt: newSession.loginTime,
        lastActive: Date.now(),
        status: 'online',
      };
      const registry = getStoredPresenceRegistry();
      registry[newSession.id] = userObj;
      savePresenceRegistry(registry);
      syncPresenceState();

      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'LOGIN_ALERT',
          notification: notif,
          user: userObj,
        } as CollabBroadcastMessage);
      }

      try {
        fetch('/api/collab/admin-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: cleanPassword,
            name: newSession.name,
          }),
        }).catch(() => {});
      } catch {}

      return true;
    },
    [syncPresenceState],
  );

  // Logout / Lock & Alert Supervisor
  const logout = useCallback(() => {
    if (session) {
      const registry = getStoredPresenceRegistry();
      delete registry[session.id];
      // Prune any sessions matching this user's name
      for (const [key, val] of Object.entries(registry)) {
        if (val.name.trim().toLowerCase() === session.name.trim().toLowerCase()) {
          delete registry[key];
        }
      }
      savePresenceRegistry(registry);

      const logoutNotif: LoginNotification = {
        id: `notif-logout-${Date.now()}`,
        type: 'logout',
        userName: session.name,
        userRole: session.role,
        timestamp: Date.now(),
        message: `${session.name} logged out of roster`,
        details: `Session ended (${session.role}).`,
        read: false,
      };

      // Add to notifications & persist so supervisor sees it immediately
      setNotifications((prev) => {
        const updated = [logoutNotif, ...prev];
        try {
          localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated.slice(0, 50)));
        } catch {}
        return updated;
      });

      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'LOGOUT_ALERT',
          notification: logoutNotif,
          userId: session.id,
        } as CollabBroadcastMessage);
      }

      // Sync logout with collaboration backend
      try {
        fetch('/api/collab/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: session.id,
            name: session.name,
            role: session.role,
          }),
        }).catch(() => {});
      } catch {}
    }
    setSession(null);
    sessionStorage.removeItem(TAB_SESSION_KEY);
    localStorage.removeItem(GLOBAL_SESSION_KEY); // nothing is remembered across tabs
    setActiveDatabase('shiftline');
    syncPresenceState();
  }, [session, syncPresenceState]);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      try {
        localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify([]));
    } catch {}
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'NOTIFICATIONS_CLEAR' } as CollabBroadcastMessage);
    }
    fetch('/api/collab/clear-notifications', { method: 'POST' }).catch(() => {});
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      try {
        localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'NOTIFICATION_DISMISS', id } as CollabBroadcastMessage);
    }
    fetch('/api/collab/dismiss-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  // Simulate a live login alert (for demo & testing)
  const simulateLoginAlert = useCallback(
    (customName = 'Arif (Collaborator)') => {
      const notif: LoginNotification = {
        id: `sim-${Date.now()}`,
        type: 'login',
        userName: customName,
        userRole: 'collaborator',
        timestamp: Date.now(),
        message: `${customName} logged in via shared link`,
        details: 'Access validated using an assigned passcode.',
        read: false,
      };

      setNotifications((prev) => {
        const updated = [notif, ...prev];
        try {
          localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });

      toast(`🔔 Login Alert: ${customName} has logged in via shared link!`, 'ok');
      if (securitySettingsRef.current.soundAlert) {
        playNotificationChime();
      }

      const simUser: PresenceUser = {
        id: `sim-user-${Date.now()}`,
        name: customName,
        role: 'collaborator',
        joinedAt: Date.now(),
        lastActive: Date.now(),
        status: 'online',
      };

      const registry = getStoredPresenceRegistry();
      registry[simUser.id] = simUser;
      savePresenceRegistry(registry);
      syncPresenceState();

      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'LOGIN_ALERT',
          notification: notif,
          user: simUser,
        } as CollabBroadcastMessage);
      }
    },
    [syncPresenceState, toast],
  );

  // Broadcast cell edit for real-time collaboration
  const broadcastCellEdit = useCallback(
    (rosterId: string, employeeId: string, dayIndex: number, code: string) => {
      if (!channelRef.current || !session || session.workspaceMode === 'isolated') return;
      channelRef.current.postMessage({
        type: 'ROSTER_CELL_UPDATE',
        rosterId,
        employeeId,
        dayIndex,
        code,
        updatedBy: session.name,
        timestamp: Date.now(),
      } as CollabBroadcastMessage);
    },
    [session],
  );

  // Subscribe to remote cell edits
  const subscribeToRemoteCellEdits = useCallback(
    (
      callback: (data: { rosterId: string; employeeId: string; dayIndex: number; code: string; updatedBy: string }) => void,
    ) => {
      cellSubscribersRef.current.add(callback as any);
      return () => {
        cellSubscribersRef.current.delete(callback as any);
      };
    },
    [],
  );

  const value = useMemo(
    () => ({
      session,
      isAuthenticated: session !== null,
      securitySettings,
      notifications,
      unreadCount,
      activeUsers,
      loginWithPasscode,
      loginAsAdmin,
      logout,
      updateSecuritySettings,
      markAllNotificationsRead,
      clearNotifications,
      dismissNotification,
      simulateLoginAlert,
      broadcastCellEdit,
      subscribeToRemoteCellEdits,
    }),
    [
      session,
      securitySettings,
      notifications,
      unreadCount,
      activeUsers,
      loginWithPasscode,
      loginAsAdmin,
      logout,
      updateSecuritySettings,
      markAllNotificationsRead,
      clearNotifications,
      dismissNotification,
      simulateLoginAlert,
      broadcastCellEdit,
      subscribeToRemoteCellEdits,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}
