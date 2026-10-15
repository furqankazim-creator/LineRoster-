import { useEffect, useMemo, useState } from 'react';

import { Button, Input, Modal, useToast } from '@/components/ui';

import { useAuth } from './authStore';
import { AssignedPasscode, getAssignedUrl, UserRole } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShareSecurityModal({ open, onClose }: Props) {
  const { session, securitySettings, updateSecuritySettings, activeUsers } = useAuth();
  const toast = useToast();

  // Login alert rules
  const [notifyOnLogin, setNotifyOnLogin] = useState(securitySettings.notifyOnLogin);
  const [soundAlert, setSoundAlert] = useState(securitySettings.soundAlert);
  const [requireName, setRequireName] = useState(securitySettings.requireName);

  // Personalized link draft fields
  const [recipientName, setRecipientName] = useState('');
  const [recipientCode, setRecipientCode] = useState('');
  const [recipientRole, setRecipientRole] = useState<UserRole>('collaborator');
  const [recipientNote, setRecipientNote] = useState('');

  // Assigned passcodes list (synced with Setup page)
  const [assignedList, setAssignedList] = useState<AssignedPasscode[]>(
    securitySettings.assignedPasscodes ?? [],
  );

  // Sync with store on mount / external update
  useEffect(() => {
    setNotifyOnLogin(securitySettings.notifyOnLogin);
    setSoundAlert(securitySettings.soundAlert);
    setRequireName(securitySettings.requireName);
    setAssignedList(securitySettings.assignedPasscodes ?? []);
  }, [securitySettings]);


  if (session?.role !== 'supervisor') {
    return null;
  }

  // Auto-generate code when recipient name is typed if code is empty
  const handleRecipientNameChange = (name: string) => {
    setRecipientName(name);
    if (!recipientCode && name.trim().length > 1) {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const rand = Math.floor(10 + Math.random() * 90);
      setRecipientCode(`shift-${slug || 'team'}-${rand}`);
    }
  };

  const handleGenerateRecipientCode = () => {
    const slug = recipientName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const rand = Math.floor(10 + Math.random() * 90);
    const newCode = `shift-${slug || 'collab'}-${rand}`;
    setRecipientCode(newCode);
    toast(`Generated passcode: ${newCode}`, 'ok');
  };

  // URL for the personalized link
  const currentPersonalUrl = useMemo(() => {
    return getAssignedUrl(recipientCode.trim(), recipientName.trim() || undefined);
  }, [recipientCode, recipientName]);

  // Check if an assigned person is currently online
  const isOnline = (name: string) => {
    const norm = name.trim().toLowerCase();
    return activeUsers.some(
      (u) =>
        u.status === 'online' &&
        (u.name.toLowerCase().includes(norm) || norm.includes(u.name.toLowerCase())),
    );
  };

  // Helper to persist an assigned passcode immediately
  const persistAssignedEntry = (name: string, code: string, role: UserRole, notes?: string) => {
    const cleanName = name.trim();
    const cleanCode = code.trim();
    if (!cleanName || !cleanCode) {
      toast('Enter both a name and a passcode for this person.', 'error');
      return null;
    }
    const clash = assignedList.find(
      (a) =>
        a.passcode.trim().toLowerCase() === cleanCode.toLowerCase() &&
        a.assignedTo.toLowerCase() !== cleanName.toLowerCase(),
    );
    if (clash) {
      toast(`Passcode "${cleanCode}" is already assigned to ${clash.assignedTo}. Use a different one.`, 'error');
      return null;
    }

    const existingIdx = assignedList.findIndex(
      (a) => a.assignedTo.toLowerCase() === cleanName.toLowerCase(),
    );
    const newEntry: AssignedPasscode = {
      id: existingIdx >= 0 ? assignedList[existingIdx].id : `assign-${Date.now()}`,
      assignedTo: cleanName,
      passcode: cleanCode,
      role,
      createdAt: Date.now(),
      status: 'active',
      notes: notes?.trim() || `${cleanName} direct link`,
    };

    let nextList = [...assignedList];
    if (existingIdx >= 0) {
      nextList[existingIdx] = newEntry;
    } else {
      nextList = [newEntry, ...nextList];
    }

    setAssignedList(nextList);
    updateSecuritySettings({ assignedPasscodes: nextList });
    return nextList;
  };

  const handleCopyPersonalLink = async () => {
    const cleanName = recipientName.trim();
    if (!persistAssignedEntry(cleanName, recipientCode, recipientRole, recipientNote)) return;

    try {
      await navigator.clipboard.writeText(currentPersonalUrl);
      toast(`Direct link for ${cleanName} copied & saved to Setup!`, 'ok');
    } catch {
      toast('Could not copy link to clipboard.', 'error');
    }
  };

  const handleCopyPersonalInvite = async () => {
    const cleanName = recipientName.trim();
    const cleanCode = recipientCode.trim();
    if (!persistAssignedEntry(cleanName, cleanCode, recipientRole, recipientNote)) return;

    const inviteText = `ShiftLine Protected Roster Access:
👤 Assigned To: ${cleanName}
🔑 Access Passcode: ${cleanCode}
🔗 Direct Link: ${currentPersonalUrl}

(Open the link above — your name and passcode are pre-filled to unlock the schedule)`;

    try {
      await navigator.clipboard.writeText(inviteText);
      toast(`Full invite for ${cleanName} copied & saved to Setup!`, 'ok');
    } catch {
      toast('Could not copy invite to clipboard.', 'error');
    }
  };

  const handleQuickCopyItemLink = async (item: AssignedPasscode) => {
    const url = getAssignedUrl(item.passcode, item.assignedTo);
    try {
      await navigator.clipboard.writeText(url);
      toast(`Copied direct link for ${item.assignedTo}!`, 'ok');
    } catch {
      toast('Could not copy link.', 'error');
    }
  };

  const handleQuickCopyItemInvite = async (item: AssignedPasscode) => {
    const url = getAssignedUrl(item.passcode, item.assignedTo);
    const invite = `ShiftLine Roster Access
👤 Name: ${item.assignedTo}
🔑 Passcode: ${item.passcode}
🔗 Link: ${url}`;
    try {
      await navigator.clipboard.writeText(invite);
      toast(`Copied full invite for ${item.assignedTo}!`, 'ok');
    } catch {
      toast('Could not copy invite.', 'error');
    }
  };

  const handleRevokeItem = (id: string) => {
    const nextList = assignedList.filter((a) => a.id !== id);
    setAssignedList(nextList);
    updateSecuritySettings({ assignedPasscodes: nextList });
    toast('Assigned link revoked and removed from table.', 'ok');
  };

  const handleSaveSettings = () => {
    let nextAssigned = assignedList;
    const cleanName = recipientName.trim();

    // A filled-in draft is saved as that person's passcode
    if (cleanName || recipientCode.trim()) {
      const saved = persistAssignedEntry(cleanName, recipientCode, recipientRole, recipientNote);
      if (!saved) return;
      nextAssigned = saved;
    }

    updateSecuritySettings({
      assignedPasscodes: nextAssigned,
      notifyOnLogin,
      soundAlert,
      requireName,
    });

    setRecipientName('');
    setRecipientCode('');
    setRecipientNote('');
    toast(
      cleanName
        ? `Saved! Password for "${cleanName}" is now recorded in Setup.`
        : 'Security settings saved to Setup.',
      'ok',
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share Link & Access Security"
      description="Give each person their own password & direct link, and see who has access."
      width={640}
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveSettings} className="font-semibold">
            Save Security Settings
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-ink text-xs max-h-[75vh] overflow-y-auto pr-1">
        {/* Create a personal password & link */}
          <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/60 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-ink text-xs block">
                  Create Personalized Password &amp; Link
                </span>
                <span className="text-[11px] text-ink-3 block">
                  When saved, this password and person&apos;s details are permanently recorded in Setup.
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-400">
                Direct Pre-filled
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[11px] font-semibold text-ink-2 mb-1 block">
                  Assign To (Person or Role Name) *
                </label>
                <Input
                  type="text"
                  value={recipientName}
                  onChange={(e) => handleRecipientNameChange(e.target.value)}
                  placeholder="e.g. Hasnain, Arif, Latif, Client..."
                  className="bg-[var(--surface-3)] font-medium text-xs h-8"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-ink-2 mb-1 block flex items-center justify-between">
                  <span>Assigned Passcode *</span>
                  <button
                    type="button"
                    onClick={handleGenerateRecipientCode}
                    className="text-[10.5px] text-[var(--accent)] hover:underline font-semibold"
                  >
                    Generate
                  </button>
                </label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    value={recipientCode}
                    onChange={(e) => setRecipientCode(e.target.value)}
                    placeholder="e.g. shift-hasnain-92"
                    className="bg-[var(--surface-3)] font-mono font-bold text-xs h-8"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-ink-2 mb-1 block">
                  Access Role
                </label>
                <select
                  value={recipientRole}
                  onChange={(e) => setRecipientRole(e.target.value as UserRole)}
                  className="w-full h-8 px-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] text-ink text-xs font-medium focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="collaborator">Collaborator (View Roster &amp; Work Orders)</option>
                  <option value="supervisor">Supervisor (Full Management &amp; Share Control)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-ink-2 mb-1 block">
                  Description / Note (Optional)
                </label>
                <Input
                  type="text"
                  value={recipientNote}
                  onChange={(e) => setRecipientNote(e.target.value)}
                  placeholder="e.g. IT Operations Partner direct link"
                  className="bg-[var(--surface-3)] text-xs h-8"
                />
              </div>
            </div>

            {/* Generated Link Preview */}
            <div className="pt-1">
              <label className="text-[11px] font-semibold text-ink-2 mb-1 block">
                Generated Direct Link Preview
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  readOnly
                  value={currentPersonalUrl}
                  className="bg-[var(--surface-3)] font-mono text-[11px] select-all text-ink-2 h-8"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyPersonalLink}
                  className="shrink-0 h-8 text-xs font-semibold"
                >
                  Copy Link
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCopyPersonalInvite}
                  className="shrink-0 h-8 text-xs font-semibold"
                >
                  Copy Invite
                </Button>
              </div>
            </div>
          </div>

        {/* Section: Assigned Passwords & Direct Links (Live Table from Setup) */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 overflow-hidden divide-y divide-[var(--line)]">
          <div className="px-3.5 py-2.5 bg-[var(--surface-3)]/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">🔐</span>
              <div>
                <span className="font-semibold text-ink text-xs block">
                  Assigned Passwords &amp; Direct Links ({assignedList.length})
                </span>
                <span className="text-[10.5px] text-ink-3 block">
                  Saved passcodes registered in Setup with direct access links.
                </span>
              </div>
            </div>
          </div>

          <div className="divide-y divide-[var(--line)] max-h-52 overflow-y-auto">
            {assignedList.length === 0 && (
              <div className="px-3.5 py-4 text-[11px] text-ink-3 text-center">
                No one has a passcode yet. Add a person above, then Save.
              </div>
            )}
            {assignedList.map((item) => {
              const online = isOnline(item.assignedTo);

              return (
                <div
                  key={item.id}
                  className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 hover:bg-[var(--surface-2)]/60 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-[140px]">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] text-white shrink-0 bg-gradient-to-br from-indigo-500 to-purple-600"
                    >
                      {item.assignedTo.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-ink text-xs">{item.assignedTo}</span>
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold uppercase tracking-wider bg-[var(--surface-3)] text-ink-2 border border-[var(--line)]">
                          {item.role}
                        </span>
                        {online && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Live
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-ink-3 block truncate max-w-[200px]">
                        {item.notes || 'Direct access link'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-[10.5px] text-ink-3">Passcode:</span>
                    <span className="px-2 py-0.5 rounded font-mono font-black text-xs bg-[var(--surface-3)] text-ink border border-[var(--line)] select-all">
                      {item.passcode}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleQuickCopyItemLink(item)}
                      className="h-7 text-[11px] px-2 font-medium"
                      title="Copy Direct Link"
                    >
                      Copy Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleQuickCopyItemInvite(item)}
                      className="h-7 text-[11px] px-2 font-medium"
                      title="Copy Full Invite"
                    >
                      Copy Invite
                    </Button>
                    <button
                        type="button"
                        onClick={() => handleRevokeItem(item.id)}
                        className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold px-1.5"
                        title="Revoke and remove"
                      >
                        Revoke
                      </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>


        {/* Section: Login Alerts & Notification Rules */}
        <div className="p-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/60 space-y-2.5">
          <span className="font-semibold text-ink text-xs block">
            Login Alerts &amp; Notification Rules
          </span>

          <div className="space-y-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnLogin}
                onChange={(e) => setNotifyOnLogin(e.target.checked)}
                className="mt-0.5 rounded border-[var(--line)] text-[var(--accent)]"
              />
              <div>
                <span className="font-medium text-ink block text-[11.5px]">
                  Send live notification when someone logs in
                </span>
                <span className="text-[10px] text-ink-3 block">
                  Dispatches an instant alert with the person&apos;s name when they open your link.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={soundAlert}
                onChange={(e) => setSoundAlert(e.target.checked)}
                className="mt-0.5 rounded border-[var(--line)] text-[var(--accent)]"
              />
              <div>
                <span className="font-medium text-ink block text-[11.5px]">
                  Play audio chime alert on login
                </span>
                <span className="text-[10px] text-ink-3 block">
                  Plays an audio tone so you immediately hear when someone unlocks the roster.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={requireName}
                onChange={(e) => setRequireName(e.target.checked)}
                className="mt-0.5 rounded border-[var(--line)] text-[var(--accent)]"
              />
              <div>
                <span className="font-medium text-ink block text-[11.5px]">
                  Require name before unlocking
                </span>
                <span className="text-[10px] text-ink-3 block">
                  Ensures team members provide their name so they show accurately in the live roster.
                </span>
              </div>
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}
