export type UserRole = 'supervisor' | 'collaborator' | 'viewer';

export interface UserSession {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  loginTime: number;
  passcodeUsed: string;
  device?: string;
}

export interface LoginNotification {
  id: string;
  type: 'login' | 'logout' | 'presence' | 'edit' | 'security';
  userName: string;
  userRole: UserRole;
  timestamp: number;
  message: string;
  details?: string;
  read: boolean;
}

export interface PresenceUser {
  id: string;
  name: string;
  role: UserRole;
  joinedAt: number;
  lastActive: number;
  isSelf?: boolean;
  status?: 'online' | 'offline';
}

export interface AssignedPasscode {
  id: string;
  passcode: string;
  assignedTo: string;
  role: UserRole;
  createdAt: number;
  lastUsedAt?: number;
  status: 'active' | 'revoked';
  notes?: string;
}

export function getAssignedUrl(passcode: string, assignedTo?: string): string {
  const cleanCode = encodeURIComponent((passcode || '').trim());
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const userParam = assignedTo ? `&user=${encodeURIComponent(assignedTo.trim())}` : '';
  return `${origin}${pathname}?code=${cleanCode}${userParam}#/app`;
}

export interface SecuritySettings {
  /** Last time the supervisor saved settings; newer copy wins when syncing with the server */
  updatedAt?: number;
  /** Recent allowed passcodes so newly generated passcodes work immediately across all sessions */
  recentPasscodes?: string[];
  /** Each person's own passcode & link — the only way team members unlock the roster */
  assignedPasscodes?: AssignedPasscode[];
  /** Admin master password for supervisors */
  adminPassword: string;
  /** Whether entering a name is required when unlocking */
  requireName: boolean;
  /** Whether to trigger an alert when someone logs in via the shared link */
  notifyOnLogin: boolean;
  /** Audio chime sound when a login notification arrives */
  soundAlert: boolean;
}

/** Finds the active (not revoked) assigned passcode entry matching the input, case-insensitively. */
export function matchPasscode(
  settings: Pick<SecuritySettings, 'assignedPasscodes'>,
  passcode: string,
): AssignedPasscode | null {
  const clean = (passcode || '').trim().toLowerCase();
  if (!clean) return null;
  return (
    (settings.assignedPasscodes || []).find(
      (a) => a.status !== 'revoked' && (a.passcode || '').trim().toLowerCase() === clean,
    ) ?? null
  );
}

export type CollabBroadcastMessage =
  | {
      type: 'LOGIN_ALERT';
      notification: LoginNotification;
      user: PresenceUser;
    }
  | {
      type: 'PRESENCE_PING';
      user: PresenceUser;
    }
  | {
      type: 'PRESENCE_PONG';
      user: PresenceUser;
    }
  | {
      type: 'PRESENCE_LEAVE';
      userId: string;
    }
  | {
      type: 'LOGOUT_ALERT';
      notification: LoginNotification;
      userId: string;
    }
  | {
      type: 'SECURITY_SETTINGS_SYNC';
      settings: SecuritySettings;
    }
  | {
      type: 'NOTIFICATIONS_CLEAR';
    }
  | {
      type: 'NOTIFICATION_DISMISS';
      id: string;
    }
  | {
      type: 'ROSTER_CELL_UPDATE';
      employeeId: string;
      dayIndex: number;
      code: string;
      updatedBy: string;
      timestamp: number;
    }
  | {
      type: 'ROSTER_SYNC_REQUEST';
      fromUserId: string;
    }
  | {
      type: 'SERVER_DB_SYNC';
      data: any;
      timestamp: number;
    };

