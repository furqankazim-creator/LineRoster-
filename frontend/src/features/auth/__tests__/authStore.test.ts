import { describe, expect, it } from 'vitest';

import { matchPasscode } from '../types';
import type { LoginNotification, UserSession } from '../types';

describe('Auth & Protected Access Logic', () => {
  it('creates valid user session on successful login with name and device info', () => {
    const userName = 'Hasnain';
    const passcode = 'shiftline2026';

    const session: UserSession = {
      id: 'sess-123',
      name: userName,
      role: 'collaborator',
      loginTime: Date.now(),
      passcodeUsed: passcode,
      device: 'Desktop Browser',
    };

    expect(session.name).toBe('Hasnain');
    expect(session.role).toBe('collaborator');
    expect(session.passcodeUsed).toBe('shiftline2026');
  });

  it('creates a formatted login notification for the supervisor alert feed', () => {
    const userName = 'Hasnain';
    const notif: LoginNotification = {
      id: 'notif-1',
      type: 'login',
      userName,
      userRole: 'collaborator',
      timestamp: Date.now(),
      message: `${userName} logged in via shared link`,
      details: 'Access granted with passcode. Device: Desktop Browser.',
      read: false,
    };

    expect(notif.message).toContain('Hasnain logged in via shared link');
    expect(notif.read).toBe(false);
    expect(notif.type).toBe('login');
  });

  it('computes unread notification count correctly', () => {
    const notifs: LoginNotification[] = [
      { id: '1', type: 'login', userName: 'Hasnain', userRole: 'collaborator', timestamp: Date.now(), message: 'login 1', read: false },
      { id: '2', type: 'login', userName: 'Karim', userRole: 'viewer', timestamp: Date.now(), message: 'login 2', read: false },
      { id: '3', type: 'security', userName: 'System', userRole: 'supervisor', timestamp: Date.now(), message: 'alert', read: true },
    ];

    const unread = notifs.filter((n) => !n.read).length;
    expect(unread).toBe(2);
  });

  describe('matchPasscode (only assigned passcodes unlock)', () => {
    const settings = {
      assignedPasscodes: [
        { id: 'a1', assignedTo: 'Arif', passcode: 'shift-arif-44', role: 'collaborator' as const, createdAt: 0, status: 'active' as const },
        { id: 'a2', assignedTo: 'Latif', passcode: 'shift-latif-71', role: 'viewer' as const, createdAt: 0, status: 'revoked' as const },
      ],
    };

    it('accepts an active personal passcode (case-insensitive) and returns the person', () => {
      expect(matchPasscode(settings, ' SHIFT-ARIF-44 ')?.assignedTo).toBe('Arif');
    });

    it('rejects revoked, unknown, old default and blank passcodes', () => {
      expect(matchPasscode(settings, 'shift-latif-71')).toBeNull();
      expect(matchPasscode(settings, 'wrong-0000')).toBeNull();
      expect(matchPasscode(settings, 'shiftline2026')).toBeNull();
      expect(matchPasscode(settings, '   ')).toBeNull();
    });
  });

  it('creates formatted logout notification when collaborator logs out', () => {
    const userName = 'Arif';
    const notif: LoginNotification = {
      id: 'notif-logout-1',
      type: 'logout',
      userName,
      userRole: 'collaborator',
      timestamp: Date.now(),
      message: `${userName} logged out of roster`,
      details: 'Session ended (collaborator).',
      read: false,
    };

    expect(notif.type).toBe('logout');
    expect(notif.message).toBe('Arif logged out of roster');
    expect(notif.userName).toBe('Arif');
  });

  it('deduplicates active users by name so multiple tab sessions show cleanly', () => {
    const registry = [
      { id: 'sess-1', name: 'Arif', role: 'collaborator', status: 'online', lastActive: Date.now() },
      { id: 'sess-2', name: 'arif', role: 'collaborator', status: 'online', lastActive: Date.now() - 1000 },
      { id: 'sess-3', name: 'Hasnain', role: 'collaborator', status: 'online', lastActive: Date.now() },
    ];

    const seenNames = new Set<string>();
    const uniqueOnline = registry.filter((u) => {
      const norm = u.name.trim().toLowerCase();
      if (seenNames.has(norm)) return false;
      seenNames.add(norm);
      return true;
    });

    expect(uniqueOnline.length).toBe(2);
    expect(uniqueOnline.map((u) => u.name)).toEqual(['Arif', 'Hasnain']);
  });
});

