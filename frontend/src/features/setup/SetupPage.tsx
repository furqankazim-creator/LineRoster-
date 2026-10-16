import { useEffect, useMemo, useRef, useState } from 'react';

import { useStore } from '@/app/store';
import { COLOR_SWATCHES, TONE_OPTIONS, codeVars, isHexColor } from '@/app/tones';
import { Button, Field, Input, Modal, Select, Switch, cx, useToast } from '@/components/ui';
import { exportBackup, importBackup, importBackupData, newId, resetToSeed } from '@/data/db';
import { WEEKDAY_LABELS } from '@/domain/calendar';
import { formatHours, shiftHours } from '@/domain/hours';
import type { Employee, Line, ResourceRequirement, ShiftCode, Weekday } from '@/domain/types';
import { normalizeWorkType } from '@/domain/workload';
import { codeFamily, type ShiftFamily } from '@/domain/workloadLive';
import {
  WORK_ORDER_COLUMNS, allWorkOrderColumns, fieldFromHeader, headerKey,
  type ColumnType, type WorkOrderColumn,
} from '@/domain/workOrderColumns';
import { useAuth } from '@/features/auth/authStore';
import type { AssignedPasscode, UserRole } from '@/features/auth/types';

export function SetupPage() {
  const { session } = useAuth();
  const {
    codes, lineCodes, lines, settings, employees, saveCode, removeCode, saveLine, removeLine, updateSettings,
    resourceRequirements, saveResourceRequirement,
  } = useStore();
  const toast = useToast();

  const [editingCode, setEditingCode] = useState<ShiftCode | null>(null);
  const [editingLine, setEditingLine] = useState<Line | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-5 sm:py-7 flex flex-col gap-7">
        <header>
          <h1 className="text-[19px] font-semibold tracking-[-0.015em]">Setup</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Lines, shift codes and the rules the planner checks against.
          </p>
        </header>

        {/* ------------------------------------------------------- lines */}
        <Section
          title="Lines"
          description="Each line keeps its own people and rosters."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEditingLine({ id: newId('line'), name: 'New line', prefix: 'SLV', order: lines.length + 1 })
              }
            >
              Add line
            </Button>
          }
        >
          <div className="divide-y divide-[var(--line)]">
            {lines.map((line) => (
              <button
                key={line.id}
                onClick={() => setEditingLine(line)}
                className="flex w-full items-center gap-3 bg-[var(--surface)] px-4 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors"
              >
                <span className="text-[13px] font-medium">{line.name}</span>
                <span className="font-mono text-[11px] text-ink-3">{line.prefix}</span>
                {line.id === settings.activeLineId && (
                  <span className="rounded bg-[var(--surface-3)] px-1.5 py-px text-[9.5px] uppercase tracking-wide text-ink-3">
                    active
                  </span>
                )}
                <span className="ml-auto text-ink-3">›</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ------------------------------------------------- shift codes */}
        <Section
          title="Shift codes"
          description="This line's own tokens — colour, timing and how many people each needs. Every line keeps a separate set, so changing one here never affects another line."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEditingCode({
                  id: '', label: '', timing: '08:00 – 17:00', tone: 'general',
                  minHeadcount: 0, countsAsEngineer: true, rotates: false,
                  order: lineCodes.length + 1,
                  scope: settings.activeLineId,
                })
              }
            >
              Add code
            </Button>
          }
        >
          <div className="divide-y divide-[var(--line)]">
            {lineCodes.map((code) => {
              const tone = codeVars(code);
              return (
                <button
                  key={`${code.scope ?? ""}:${code.id}`}
                  onClick={() => setEditingCode(code)}
                  className="grid w-full grid-cols-[56px_1fr_64px_20px] md:grid-cols-[56px_1fr_120px_84px_72px_20px] items-center gap-3 bg-[var(--surface)] px-3 md:px-4 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors"
                >
                  <span
                    className={cx(
                      'justify-self-start rounded px-2 py-0.5 font-mono text-[11.5px] font-bold',
                      code.isStatus && 'hatch',
                    )}
                    style={{ background: code.isStatus ? undefined : tone.bg, color: tone.fg }}
                  >
                    {code.id}
                  </span>
                  <span className="text-[13px]">
                    {code.label}
                  </span>
                  <span className="hidden md:block font-mono text-[11.5px] text-ink-3">
                    {code.timing}
                    {!code.isStatus && (
                      <span className="ml-1.5 text-ink-2">{formatHours(shiftHours(code, settings.standardHours))}h</span>
                    )}
                  </span>
                  <span className="text-[11.5px] text-ink-3">
                    {code.minHeadcount > 0 ? `min ${code.minHeadcount}` : '—'}
                  </span>
                  <span className="hidden md:block text-[11px] text-ink-3">
                    {code.isStatus ? 'status' : code.rotates ? 'rotates' : 'fixed'}
                  </span>
                  <span className="text-ink-3">›</span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ------------------------------------------------------- rules */}
        <Section title="Planner rules & working hours" description="What the validator checks on every edit, and how hours and overtime are counted.">
          <div className="bg-[var(--surface)] px-4 py-4 flex flex-col gap-4">
            <Field
              label="Warn after this many days worked in a row"
              hint="The client's roster runs a 5-on / 2-off cycle, so 6 is a sensible ceiling."
            >
              <Input
                type="number"
                min={1}
                max={31}
                value={settings.maxConsecutive}
                onChange={(e) => void updateSettings({ maxConsecutive: Number(e.target.value) })}
                className="w-24"
              />
            </Field>

            <Field
              label="Standard working hours per day"
              hint="Hours past this on a working day are overtime (OT). A shift worked on someone's rest day counts entirely as OT. Extra hours are entered by clicking a cell on the Planner."
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  step={0.5}
                  value={settings.standardHours}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0 && n <= 24) void updateSettings({ standardHours: n });
                  }}
                  className="w-24"
                />
                <span className="text-[12px] text-ink-3">hours</span>
              </div>
            </Field>

            <Field label="Weekend columns" hint="Tints those columns. It does not decide who is off — rest days do that, per person.">
              <div className="flex gap-1">
                {WEEKDAY_LABELS.map((label, day) => {
                  const on = settings.weekendDays.includes(day);
                  return (
                    <button
                      key={label}
                      onClick={() =>
                        void updateSettings({
                          weekendDays: on
                            ? settings.weekendDays.filter((d) => d !== day)
                            : [...settings.weekendDays, day as Weekday].sort((a, b) => a - b),
                        })
                      }
                      className={cx(
                        'h-8 flex-1 rounded-lg border text-[12px] font-medium transition-colors',
                        on
                          ? 'border-[var(--accent)] bg-[var(--surface-3)] text-ink'
                          : 'border-[var(--line)] bg-[var(--surface-2)] text-ink-3 hover:text-ink-2',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </Section>

        {/* ----------------------------- work order resource requirements */}
        <ResourceRequirementsSection
          resourceRequirements={resourceRequirements}
          onSave={saveResourceRequirement}
        />

        {/* ------------------------------------- work-order Excel import columns */}
        <ExcelColumnsSection />

        {/* ---------------------------------------------------- security */}
        {session?.role === 'supervisor' && <SecuritySettingsSection employees={employees} />}

        {/* ---------------------------------------------------- display */}
        <Section title="Display & Fonts" description="Screen zoom, text size and font style preferences for this device.">
          <div className="bg-[var(--surface)] px-4 py-4 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Screen Zoom" hint="Scales roster cells and columns.">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={70}
                    max={140}
                    step={5}
                    value={settings.zoomLevel ?? 100}
                    onChange={(e) => void updateSettings({ zoomLevel: Number(e.target.value) })}
                    className="w-24 font-mono text-center"
                  />
                  <span className="text-ink-3 text-[12px]">%</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void updateSettings({ zoomLevel: 100 })}
                    className="text-[11px]"
                  >
                    Reset
                  </Button>
                </div>
              </Field>

              <Field label="Font Size" hint="Adjusts text size throughout the application.">
                <Select
                  value={settings.fontSize ?? 'normal'}
                  onChange={(e) => void updateSettings({ fontSize: e.target.value as any })}
                >
                  <option value="xs">Extra Compact (11.5px — High Density)</option>
                  <option value="compact">Compact (13px — Dense)</option>
                  <option value="normal">Normal (14px — Standard)</option>
                  <option value="large">Large (15.5px — Relaxed)</option>
                  <option value="xl">Extra Large (17px — Maximum Readability)</option>
                </Select>
              </Field>

              <Field label="Font Family" hint="Select preferred typography across the application.">
                <Select
                  value={settings.fontFamily ?? 'default'}
                  onChange={(e) => void updateSettings({ fontFamily: e.target.value as any })}
                >
                  <option value="default">Inter (Default Modern Sans)</option>
                  <option value="roboto">Roboto (Clean Google Standard)</option>
                  <option value="segoe">Segoe UI / Aptos (Office & Windows Standard)</option>
                  <option value="apple">SF Pro / Apple System (Native macOS/iOS)</option>
                  <option value="open-sans">Open Sans (Humanist High Readability)</option>
                  <option value="plex">IBM Plex Sans (Industrial & Operations)</option>
                  <option value="mono">JetBrains Mono (Monospace Table Columns)</option>
                  <option value="calibri">Calibri (Classic Spreadsheet Font)</option>
                  <option value="serif">Georgia (Classic Serif)</option>
                  <option value="system">System Default Sans-Serif</option>
                </Select>
              </Field>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------- data */}
        <Section title="Data & Backups" description="Everything is stored locally in your browser. Download a backup before switching machines or clearing your browser.">
          <div className="bg-[var(--surface)] px-4 py-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  try {
                    const [{ getFullBackupData }, { downloadBackupXlsx }] = await Promise.all([
                      import('@/data/db'),
                      import('@/io/exportXlsx'),
                    ]);
                    const data = await getFullBackupData();
                    const filename = downloadBackupXlsx(data);
                    toast(`Excel backup downloaded: ${filename}`, 'ok');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Excel export failed.', 'error');
                  }
                }}
                title="Download all rosters, employees, shift codes, and lines in an Excel spreadsheet (.xlsx)"
                className="font-medium"
              >
                Download backup (Excel .xlsx)
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const json = await exportBackup();
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `shiftline-backup-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast('JSON backup downloaded successfully.', 'ok');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Export failed.', 'error');
                  }
                }}
                title="Download complete raw database dump as JSON"
              >
                Download backup (JSON)
              </Button>

              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                Restore from backup (.xlsx or .json)
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                      const buf = await file.arrayBuffer();
                      const { importBackupWorkbook } = await import('@/io/importXlsx');
                      const parsed = importBackupWorkbook(buf);
                      await importBackupData(parsed);
                      toast('Excel backup restored successfully! Refreshing...', 'ok');
                    } else {
                      const text = await file.text();
                      await importBackup(text);
                      toast('JSON backup restored successfully! Refreshing...', 'ok');
                    }
                    setTimeout(() => {
                      window.location.reload();
                    }, 600);
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Restore failed.', 'error');
                  }
                  e.target.value = '';
                }}
              />

              <Button variant="danger" size="sm" onClick={() => setConfirmReset(true)}>
                Reset to Demo Data (September 2026)
              </Button>
            </div>

            {/* Explanatory note answering the client's question */}
            <div className="rounded-lg bg-[var(--surface-2)] p-3 text-[12px] text-ink-3 leading-relaxed border border-[var(--line)]">
              <p className="font-semibold text-ink-2 mb-1">
                Backup Formats: Excel (.xlsx) vs JSON
              </p>
              <p className="mb-2">
                <strong>Excel (.xlsx)</strong> produces a real workbook you can open in Microsoft Excel, view and edit employees, shift codes, and monthly rosters.
                <strong> JSON (.json)</strong> is a technical data file used to clone your exact system state between browsers. Both can be restored using the <em>Restore from backup</em> button above.
              </p>
              <p className="font-semibold text-ink-2 mb-1">
                What does &ldquo;Reset to Demo Data&rdquo; mean?
              </p>
              <p>
                This button reloads the pre-configured September 2026 sample roster (Line 5 / 4&amp;6, sample employees, and shifts) that came with the tool.
                Use this if you want to wipe test changes and return to the initial demonstration state.
                To preserve your work before resetting, click <strong>Download backup (Excel .xlsx)</strong>.
              </p>
            </div>
          </div>
        </Section>
      </div>

      {editingCode && (
        <CodeEditor
          code={editingCode}
          isNew={!codes.some((c) => c.id === editingCode.id)}
          onClose={() => setEditingCode(null)}
          onSave={async (next) => {
            await saveCode(next);
            setEditingCode(null);
            toast(`Shift code ${next.id} saved.`, 'ok');
          }}
          onDelete={async () => {
            await removeCode(editingCode.id, editingCode.scope);
            setEditingCode(null);
            toast('Shift code removed.', 'ok');
          }}
        />
      )}

      {editingLine && (
        <LineEditor
          line={editingLine}
          onClose={() => setEditingLine(null)}
          onSave={async (next) => {
            await saveLine(next);
            setEditingLine(null);
            toast(`${next.name} saved.`, 'ok');
          }}
          onDelete={async () => {
            await removeLine(editingLine.id);
            setEditingLine(null);
            toast('Line removed.', 'ok');
          }}
        />
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset to Sample Demo Data?"
        description="This will clear all current lines, people, rosters and custom changes in this browser, and restore the default September 2026 demonstration roster. This cannot be undone."
        width={440}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await resetToSeed();
                setConfirmReset(false);
                toast('Reset to demo data. Refreshing...', 'ok');
                setTimeout(() => window.location.reload(), 600);
              }}
            >
              Reset Data
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-ink-2 leading-relaxed">
          If you have custom roster edits you wish to keep, cancel and click <strong>Download backup</strong> first.
        </p>
      </Modal>
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <p className="mt-0.5 text-[12px] text-ink-3">{description}</p>
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--line)]">{children}</div>
    </section>
  );
}

function CodeEditor({
  code, isNew, onClose, onSave, onDelete,
}: {
  code: ShiftCode;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: ShiftCode) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ShiftCode>({ ...code });
  const tone = codeVars(draft);

  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={isNew ? 'New shift code' : `Shift code ${code.id}`}
      footer={
        <>
          {!isNew && (
            <Button variant="danger" size="sm" onClick={onDelete} className="mr-auto">Remove</Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!draft.id.trim()} onClick={() => onSave(draft)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-[88px_1fr] gap-3">
          <Field label="Code">
            <Input
              value={draft.id}
              disabled={!isNew}
              onChange={(e) => setDraft({ ...draft, id: e.target.value.toUpperCase() })}
              className="font-mono text-center"
            />
          </Field>
          <Field label="Name">
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Timing"
            hint={draft.isStatus ? undefined : `${formatHours(shiftHours(draft))} hours per shift — used for hours and overtime`}
          >
            <Input value={draft.timing} onChange={(e) => setDraft({ ...draft, timing: e.target.value })} />
          </Field>
          <Field label="Shift family" hint="Groups the code with Morning, Night … in headcount totals.">
            <Select
              value={draft.tone}
              onChange={(e) => setDraft({ ...draft, tone: e.target.value as ShiftCode['tone'] })}
            >
              {TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Colour"
          hint={
            isHexColor(draft.color)
              ? 'Own colour — shown on the grid, the brush and in Excel.'
              : "Using the shift family's colour. Pick one to tell this code apart from others in its family."
          }
        >
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setDraft({ ...draft, color: undefined })}
              title="Use the shift family's colour"
              className={cx(
                'h-6 rounded-md border px-2 text-[11px] transition-colors',
                !isHexColor(draft.color)
                  ? 'border-[var(--accent)] text-ink'
                  : 'border-[var(--line)] text-ink-3 hover:text-ink-2',
              )}
            >
              Family
            </button>
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDraft({ ...draft, color: c })}
                title={c}
                aria-label={`Colour ${c}`}
                className={cx(
                  'h-6 w-6 rounded-md border-2 transition-transform hover:scale-110',
                  draft.color?.toLowerCase() === c ? 'border-[var(--ink)]' : 'border-transparent',
                )}
                style={{ background: c }}
              />
            ))}
            <label
              title="Any colour"
              className="relative grid h-6 w-6 cursor-pointer place-items-center rounded-md border border-dashed border-[var(--line-strong)] text-[13px] text-ink-3 hover:text-ink"
              style={
                isHexColor(draft.color) && !COLOR_SWATCHES.includes(draft.color.toLowerCase() as typeof COLOR_SWATCHES[number])
                  ? { background: draft.color, borderStyle: 'solid', borderColor: 'var(--ink)' }
                  : undefined
              }
            >
              {!(isHexColor(draft.color) && !COLOR_SWATCHES.includes(draft.color.toLowerCase() as typeof COLOR_SWATCHES[number])) && '+'}
              <input
                type="color"
                value={isHexColor(draft.color) ? draft.color : '#3f7fe0'}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </Field>

        <div className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
          <span className="text-[11px] text-ink-3">Preview</span>
          <span
            className={cx('rounded px-2.5 py-1 font-mono text-[12px] font-bold', draft.isStatus && 'hatch')}
            style={{ background: draft.isStatus ? undefined : tone.bg, color: tone.fg }}
          >
            {draft.id || '?'}
          </span>
        </div>

        <Field
          label="Minimum people per day"
          hint="A day below this is flagged as a coverage error. Zero turns the check off."
        >
          <Input
            type="number"
            min={0}
            value={draft.minHeadcount}
            onChange={(e) => setDraft({ ...draft, minHeadcount: Number(e.target.value) })}
            className="w-24"
          />
        </Field>

        <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3">
          <Switch
            checked={draft.countsAsEngineer}
            onChange={(v) => setDraft({ ...draft, countsAsEngineer: v })}
            label="Counts in the Engineers row"
          />
          <Switch
            checked={draft.rotates}
            onChange={(v) => setDraft({ ...draft, rotates: v })}
            label="Include in auto-rotation"
          />
          <Switch
            checked={!!draft.isStatus}
            onChange={(v) => setDraft({ ...draft, isStatus: v })}
            label="A status, not a worked shift (leave, training)"
          />
        </div>
      </div>
    </Modal>
  );
}

function LineEditor({
  line, onClose, onSave, onDelete,
}: {
  line: Line;
  onClose: () => void;
  onSave: (next: Line) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Line>({ ...line });

  return (
    <Modal
      open
      onClose={onClose}
      width={420}
      title={line.name}
      description="Removing a line deletes its people and saved rosters."
      footer={
        <>
          <Button variant="danger" size="sm" onClick={onDelete} className="mr-auto">Remove</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(draft)}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <Field label="Name">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Prefix" hint="Used in export filenames.">
          <Input
            value={draft.prefix}
            onChange={(e) => setDraft({ ...draft, prefix: e.target.value })}
            className="font-mono"
          />
        </Field>
      </div>
    </Modal>
  );
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return 'Never used';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function getAssignedUrl(passcode: string, assignedTo?: string): string {
  const cleanCode = encodeURIComponent((passcode || '').trim());
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const userParam = assignedTo ? `&user=${encodeURIComponent(assignedTo.trim())}` : '';
  return `${origin}${pathname}?code=${cleanCode}${userParam}#/app`;
}

function SecuritySettingsSection({ employees = [] }: { employees?: Employee[] }) {
  const { securitySettings, updateSecuritySettings, activeUsers } = useAuth();
  const toast = useToast();

  const [adminPassword, setAdminPassword] = useState(securitySettings.adminPassword || 'supervisor1');
  const [notifyOnLogin, setNotifyOnLogin] = useState(securitySettings.notifyOnLogin);
  const [soundAlert, setSoundAlert] = useState(securitySettings.soundAlert);
  const [requireName, setRequireName] = useState(securitySettings.requireName);
  const [showAdminPass, setShowAdminPass] = useState(false);

  // Assigned passcodes list
  const [assignedList, setAssignedList] = useState<AssignedPasscode[]>(
    securitySettings.assignedPasscodes ?? [],
  );

  // Modal to assign new password & link
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [draftRole, setDraftRole] = useState<UserRole>('collaborator');
  const [draftNote, setDraftNote] = useState('');

  useEffect(() => {
    setAdminPassword(securitySettings.adminPassword || 'supervisor1');
    setNotifyOnLogin(securitySettings.notifyOnLogin);
    setSoundAlert(securitySettings.soundAlert);
    setRequireName(securitySettings.requireName);
    setAssignedList(securitySettings.assignedPasscodes ?? []);
  }, [securitySettings]);

  // Check if a person is currently online
  const isUserOnline = (name: string) => {
    const norm = name.trim().toLowerCase();
    return activeUsers.some(
      (u) =>
        u.status === 'online' &&
        (u.name.toLowerCase().includes(norm) || norm.includes(u.name.toLowerCase())),
    );
  };

  const handleCopyLink = async (item: AssignedPasscode) => {
    const url = getAssignedUrl(item.passcode, item.assignedTo);
    try {
      await navigator.clipboard.writeText(url);
      toast(`Copied direct link for ${item.assignedTo}!`, 'ok');
    } catch {
      toast('Could not copy link to clipboard.', 'error');
    }
  };

  const handleCopyInvite = async (item: AssignedPasscode) => {
    const url = getAssignedUrl(item.passcode, item.assignedTo);
    const inviteText = `ShiftLine Protected Roster Access
👤 Assigned To: ${item.assignedTo}
🔑 Security Password: ${item.passcode}
🔗 Direct Link: ${url}

Open the link above (your name and password will be pre-filled) to view the schedule.`;

    try {
      await navigator.clipboard.writeText(inviteText);
      toast(`Copied full invite for ${item.assignedTo} to clipboard!`, 'ok');
    } catch {
      toast('Could not copy invite to clipboard.', 'error');
    }
  };

  const handleDeleteAssigned = (id: string) => {
    const nextList = assignedList.filter((a) => a.id !== id);
    setAssignedList(nextList);
    updateSecuritySettings({ assignedPasscodes: nextList });
    toast('Assigned link removed.', 'ok');
  };

  const handleCreateAssigned = () => {
    const name = draftName.trim();
    const code = draftCode.trim();
    if (!name || !code) {
      toast('Please provide both recipient name and passcode.', 'error');
      return;
    }
    const clash = assignedList.find((a) => a.passcode.trim().toLowerCase() === code.toLowerCase());
    if (clash) {
      toast(`Passcode "${code}" is already assigned to ${clash.assignedTo}. Use a different one.`, 'error');
      return;
    }

    const newEntry: AssignedPasscode = {
      id: `assign-${Date.now()}`,
      assignedTo: name,
      passcode: code,
      role: draftRole,
      createdAt: Date.now(),
      status: 'active',
      notes: draftNote.trim() || undefined,
    };

    const nextList = [newEntry, ...assignedList];
    setAssignedList(nextList);
    updateSecuritySettings({ assignedPasscodes: nextList });
    setNewModalOpen(false);
    toast(`Created and assigned link for ${name}!`, 'ok');
  };

  const handleSave = () => {
    const cleanAdminPass = adminPassword.trim() || 'supervisor1';
    updateSecuritySettings({
      adminPassword: cleanAdminPass,
      assignedPasscodes: assignedList,
      notifyOnLogin,
      soundAlert,
      requireName,
    });
    toast('Security settings and assigned passwords saved!', 'ok');
  };

  return (
    <Section
      title="Security & Access Passcodes"
      description="Manage the supervisor master password and each person's assigned password & direct link."
      action={
        <Button
          size="sm"
          variant="primary"
          onClick={handleSave}
          className="font-medium"
        >
          Save Security Settings
        </Button>
      }
    >
      <div className="bg-[var(--surface)] px-4 py-4 flex flex-col gap-5">
        {/* Row 1: Supervisor Master Password */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Supervisor Master Password"
            hint="Password for Supervisor login with full management & share control."
          >
            <div className="flex items-center gap-2">
              <Input
                type={showAdminPass ? 'text' : 'password'}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="e.g. supervisor1"
                className="font-mono font-semibold h-9"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAdminPass((prev) => !prev)}
                className="shrink-0 text-xs h-9 px-3 font-semibold"
                type="button"
              >
                {showAdminPass ? 'Hide' : 'Show'}
              </Button>
            </div>
          </Field>
        </div>

        {/* Row 2: Assigned Passwords & Personalized Links Table (The Detail View) */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 overflow-hidden divide-y divide-[var(--line)]">
          <div className="px-4 py-3 bg-[var(--surface-3)]/40 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <h3 className="font-semibold text-ink text-[13px] flex items-center gap-1.5">
                <span>🔐</span> Assigned Passwords &amp; Direct Links
              </h3>
              <p className="text-[11px] text-ink-3">
                Shows each password and personalized link assigned to specific individuals with live status.
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setNewModalOpen(true);
                setDraftName('');
                setDraftCode(`shift-${Math.floor(1000 + Math.random() * 9000)}`);
                setDraftRole('collaborator');
                setDraftNote('');
              }}
              className="text-xs h-8 px-3 gap-1 font-semibold"
            >
              <span>➕</span> Assign New Password &amp; Link
            </Button>
          </div>

          <div className="divide-y divide-[var(--line)]">
            {assignedList.length === 0 && (
              <div className="p-4 text-[11.5px] text-ink-3 text-center">
                No one has a passcode yet. Click “Assign New Password &amp; Link” to add someone.
              </div>
            )}
            {assignedList.map((item) => {
              const isOnline = isUserOnline(item.assignedTo);
              const url = getAssignedUrl(item.passcode, item.assignedTo);

              return (
                <div
                  key={item.id}
                  className="p-3.5 sm:p-4 hover:bg-[var(--surface-2)]/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  {/* Left: Recipient Details */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-full bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center font-black text-xs text-indigo-400 shrink-0">
                      {item.assignedTo.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-ink text-[13.5px] truncate">
                          {item.assignedTo}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-black tracking-wide bg-[var(--surface-3)] text-ink-2 border border-[var(--line)]">
                          {item.role}
                        </span>
                        {isOnline ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10.5px] font-bold border border-emerald-500/25">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Online Now
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-3">
                            {item.lastUsedAt ? `Used ${formatRelativeTime(item.lastUsedAt)}` : 'Active'}
                          </span>
                        )}
                      </div>
                      {item.notes ? (
                        <p className="text-[11.5px] text-ink-3 mt-0.5 truncate">{item.notes}</p>
                      ) : (
                        <p className="text-[11px] font-mono text-ink-3 mt-0.5 truncate max-w-sm">{url}</p>
                      )}
                    </div>
                  </div>

                  {/* Right: Passcode badge + Action buttons */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap justify-end">
                    <div className="flex items-center gap-1.5 shrink-0 mr-1">
                      <span className="text-[11px] text-ink-3 font-semibold hidden lg:inline">Passcode:</span>
                      <code className="px-2.5 py-1 rounded-lg bg-[var(--surface-3)] font-mono font-black text-[12px] text-ink border border-[var(--line-strong)] whitespace-nowrap select-all tracking-wide">
                        {item.passcode}
                      </code>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyLink(item)}
                      className="text-xs h-8 px-2.5 font-bold"
                      title="Copy direct roster link"
                    >
                      <span>🔗</span> Copy Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyInvite(item)}
                      className="text-xs h-8 px-2.5 font-bold"
                      title="Copy complete invite message"
                    >
                      <span>📋</span> Copy Invite
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAssigned(item.id)}
                      className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2.5 h-8 rounded-lg transition-colors font-bold"
                      title="Revoke / Delete assigned link"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>


        {/* Row 3: Notification & Security Policies */}
        <div className="border-t border-[var(--line)] pt-3.5 space-y-2.5">
          <div className="text-[12px] font-semibold text-ink">
            Login Alerts &amp; Notification Rules
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyOnLogin}
              onChange={(e) => setNotifyOnLogin(e.target.checked)}
              className="mt-0.5 rounded border-[var(--line)] text-[var(--accent)]"
            />
            <div>
              <span className="font-medium text-ink block text-[12px]">
                Send live notification when someone logs in
              </span>
              <span className="text-[11px] text-ink-3 block">
                Dispatches an instant alert notification with the person&apos;s name as soon as they open your link.
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
              <span className="font-medium text-ink block text-[12px]">
                Play audio chime alert on login
              </span>
              <span className="text-[11px] text-ink-3 block">
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
              <span className="font-medium text-ink block text-[12px]">
                Require name before unlocking
              </span>
              <span className="text-[11px] text-ink-3 block">
                Ensures team members provide their name so they show accurately in the live online roster.
              </span>
            </div>
          </label>
        </div>

        {/* Row 4: Footer info & save */}
        <div className="flex items-center justify-between border-t border-[var(--line)] pt-3">
          <span className="text-[11px] text-ink-3">
            Credentials and notification rules sync immediately across all connected browsers and live sessions.
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            className="font-medium"
          >
            Save Security Settings
          </Button>
        </div>
      </div>

      {/* Modal: Assign New Password & Link */}
      {newModalOpen && (
        <Modal
          open
          onClose={() => setNewModalOpen(false)}
          title="Assign New Password & Direct Link"
          description="Generate a secure password and personalized roster link for a team member, staff, or client."
          width={480}
          footer={
            <>
              <Button onClick={() => setNewModalOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleCreateAssigned}
                disabled={!draftName.trim() || !draftCode.trim()}
              >
                Create &amp; Assign Link
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Name Input with Quick Select from Roster */}
            <Field label="Assign To (Recipient Name)" hint="Who will use this link?">
              <Input
                value={draftName}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraftName(val);
                  if (!draftCode || draftCode.startsWith('shift-')) {
                    const slug = val.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 10);
                    setDraftCode(`shift-${slug || 'team'}-${Math.floor(100 + Math.random() * 900)}`);
                  }
                }}
                placeholder="e.g. Arif, Latif, Hasnain, or Client"
              />
              {employees && employees.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-ink-3">Quick select from roster:</span>
                  {employees.slice(0, 8).map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => {
                        setDraftName(emp.name);
                        const slug = emp.name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 10);
                        setDraftCode(`shift-${slug}-${Math.floor(100 + Math.random() * 900)}`);
                      }}
                      className={cx(
                        'px-2 py-0.5 rounded text-[10.5px] border transition-colors',
                        draftName === emp.name
                          ? 'border-[var(--accent)] bg-[var(--surface-3)] text-ink font-semibold'
                          : 'border-[var(--line)] bg-[var(--surface-2)] text-ink-2 hover:bg-[var(--surface-3)]',
                      )}
                    >
                      {emp.name}
                    </button>
                  ))}
                </div>
              )}
            </Field>

            {/* Security Password Input */}
            <Field label="Assigned Password / Passcode" hint="Password required to open this link.">
              <div className="flex items-center gap-2">
                <Input
                  value={draftCode}
                  onChange={(e) => setDraftCode(e.target.value)}
                  className="font-mono font-bold"
                  placeholder="e.g. shift-arif-44"
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    const slug = draftName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 10);
                    setDraftCode(`shift-${slug || 'team'}-${Math.floor(1000 + Math.random() * 9000)}`);
                  }}
                  className="shrink-0 text-[11px]"
                >
                  Generate
                </Button>
              </div>
            </Field>

            {/* Access Role */}
            <Field label="Access Permission" hint="Controls whether this person can edit shifts or view only.">
              <Select value={draftRole} onChange={(e) => setDraftRole(e.target.value as UserRole)}>
                <option value="collaborator">Collaborator (Can view &amp; edit roster shifts)</option>
                <option value="viewer">Viewer (Read-only access)</option>
              </Select>
            </Field>

            {/* Note / Purpose */}
            <Field label="Note / Purpose (Optional)" hint="Remind yourself what this link was created for.">
              <Input
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="e.g. Line 5 team schedule, External client review"
              />
            </Field>

            {/* Live Preview */}
            <div className="p-3 rounded-lg bg-[var(--surface-3)] border border-[var(--line)] space-y-1">
              <span className="text-[10.5px] font-bold text-ink-3 uppercase tracking-wider block">
                Link Preview
              </span>
              <p className="font-mono text-[11px] text-ink-2 break-all select-all">
                {getAssignedUrl(draftCode, draftName)}
              </p>
            </div>
          </div>
        </Modal>
      )}
    </Section>
  );
}

/**
 * Which Excel columns the work-order import reads. The 11 yellow columns are
 * built in; the supervisor can add more here — no code change needed.
 */
function ExcelColumnsSection() {
  const { settings, updateSettings } = useStore();
  const toast = useToast();
  const custom = settings.customWorkOrderColumns ?? [];
  const removed = settings.removedBuiltinColumns ?? [];
  const activeBuiltIn = WORK_ORDER_COLUMNS.filter((c) => !removed.includes(c.excelHeader));
  const removedBuiltIn = WORK_ORDER_COLUMNS.filter((c) => removed.includes(c.excelHeader));
  const [header, setHeader] = useState('');
  const [required, setRequired] = useState(true);
  const [type, setType] = useState<ColumnType>('text');
  const [note, setNote] = useState('');

  const add = () => {
    const h = header.trim();
    if (!h) return toast('Type the column header exactly as it is in Excel.', 'error');
    const taken = allWorkOrderColumns(custom, removed).find((c) =>
      [c.excelHeader, ...(c.aliases ?? [])].some((x) => headerKey(x) === headerKey(h)),
    );
    if (taken) return toast(`"${h}" is already read (as "${taken.excelHeader}").`, 'error');
    const col: WorkOrderColumn = {
      excelHeader: h,
      appField: fieldFromHeader(h),
      required,
      type,
      usedFor: note.trim() || 'Added in Setup',
    };
    void updateSettings({ customWorkOrderColumns: [...custom, col] });
    setHeader('');
    setNote('');
    toast(`"${h}" added. Import the Excel file again to read it.`, 'ok');
  };

  const update = (i: number, patch: Partial<WorkOrderColumn>) =>
    void updateSettings({ customWorkOrderColumns: custom.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const remove = (i: number) => {
    void updateSettings({ customWorkOrderColumns: custom.filter((_, j) => j !== i) });
    toast('Column removed. Import again to drop it from the work orders.', 'ok');
  };

  const removeBuiltIn = (c: WorkOrderColumn) => {
    void updateSettings({ removedBuiltinColumns: [...removed, c.excelHeader] });
    toast(`"${c.excelHeader}" removed. The next import will not read it.`, 'ok');
  };
  const restoreBuiltIn = (c: WorkOrderColumn) => {
    void updateSettings({ removedBuiltinColumns: removed.filter((h) => h !== c.excelHeader) });
    toast(`"${c.excelHeader}" restored. Import again to read it.`, 'ok');
  };

  const TYPES: { id: ColumnType; label: string }[] = [
    { id: 'text', label: 'Text' },
    { id: 'number', label: 'Number' },
    { id: 'date', label: 'Date' },
    { id: 'line', label: 'Line (L5 / L4&6)' },
  ];

  return (
    <Section
      title="Excel import columns"
      description="The work-order import reads only these columns, matched by header name; every other column is ignored. Add a column here and the next import reads and checks it."
    >
      <div className="bg-[var(--surface)] p-4 sm:p-5 flex flex-col gap-5">
        {/* Built-in yellow columns */}
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-3">
            Yellow columns (read on import) · {activeBuiltIn.length + custom.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeBuiltIn.map((c) => (
              <span
                key={c.excelHeader}
                title={c.usedFor}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg text-[12px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30"
              >
                {c.excelHeader}
                <button
                  type="button"
                  onClick={() => removeBuiltIn(c)}
                  aria-label={`Remove ${c.excelHeader}`}
                  title="Remove — stop importing this column"
                  className="w-4 h-4 leading-none rounded hover:bg-amber-500/30"
                >
                  ×
                </button>
              </span>
            ))}
            {custom.map((c, i) => (
              <span
                key={`custom-${c.excelHeader}`}
                title={c.usedFor}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg text-[12px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30"
              >
                {c.excelHeader}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${c.excelHeader}`}
                  title="Remove this added column"
                  className="w-4 h-4 leading-none rounded hover:bg-amber-500/30"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {removedBuiltIn.length > 0 && (
            <div className="mt-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-3">
                Removed (not imported) · {removedBuiltIn.length}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {removedBuiltIn.map((c) => (
                  <button
                    key={c.excelHeader}
                    type="button"
                    onClick={() => restoreBuiltIn(c)}
                    title="Click to restore"
                    className="px-2 py-1 rounded-lg text-[12px] font-semibold text-ink-3 border border-dashed border-[var(--line)] line-through hover:text-ink hover:no-underline"
                  >
                    + {c.excelHeader}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Added columns */}
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-3">
            Added columns · {custom.length}
          </div>
          {custom.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">None yet. Add one below.</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
              {custom.map((c, i) => (
                <div key={c.excelHeader} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink truncate">{c.excelHeader}</div>
                    <div className="text-[11.5px] text-ink-3 truncate">{c.usedFor}</div>
                  </div>
                  <span className="font-mono text-[11px] text-ink-3">{TYPES.find((t) => t.id === c.type)?.label}</span>
                  <Switch checked={c.required} onChange={(v) => update(i, { required: v })} label="Mandatory" />
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-[12px] font-bold text-rose-400 hover:text-rose-300 px-1.5"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add form */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/50 p-3.5 flex flex-col gap-3">
          <div className="text-[12.5px] font-bold text-ink">Add a column</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Excel header (exactly as in the file)">
              <Input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="e.g. Priority" />
            </Field>
            <Field label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value as ColumnType)}>
                {TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="What it's for (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Job priority P1–P4" />
            </Field>
            <div className="flex items-end pb-1.5">
              <Switch checked={required} onChange={setRequired} label="Mandatory (report blank cells)" />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] text-ink-3">
              After adding, import the Excel file again. Values show on each work order and in the CSV export.
            </span>
            <Button variant="primary" size="sm" onClick={add}>
              Add column
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

function ResourceRequirementsSection({
  resourceRequirements,
  onSave,
}: {
  resourceRequirements: ResourceRequirement[];
  onSave: (req: ResourceRequirement) => Promise<void>;
}) {
  // Line 4 & 6 are one team with one set of standards, stored under L4
  const [activeLine, setActiveLine] = useState<'L4' | 'L5'>('L5');
  const lineLabel = activeLine === 'L4' ? 'Line 4&6' : 'Line 5';
  const toast = useToast();
  const { codesByLine, workload, workOrders } = useStore();
  const workOrderTypes = useMemo(
    () => new Map(workOrders.map((w) => [w.id, normalizeWorkType(w.workType)])),
    [workOrders],
  );

  // Real shift times from this line's codes (Setup → shift codes)
  const lineCodesList = codesByLine[activeLine === 'L4' ? 'line4' : 'line5'] ?? [];
  const timingOf = (fam: ShiftFamily) =>
    (lineCodesList.find((c) => c.id === fam) ?? lineCodesList.find((c) => codeFamily(c.id, lineCodesList) === fam))?.timing ?? '';

  /** How many work orders currently take their crew size from a standard. */
  const usage = (type: string, fam?: ShiftFamily) =>
    Object.values(workload.byWo).filter(
      (a) => a.crewFromStandard && (activeLine === 'L4' ? a.lineCode !== 'L5' : a.lineCode === 'L5') && (!fam || a.shift === fam) &&
        (workOrderTypes.get(a.woId) ?? '') === type,
    ).length;

  const lineRequirements = useMemo(() => {
    return resourceRequirements.filter((r) => r.line === activeLine);
  }, [resourceRequirements, activeLine]);

  const handleUpdate = async (req: ResourceRequirement, newCount: number) => {
    const updated: ResourceRequirement = {
      ...req,
      defaultPeopleCount: Math.max(1, newCount),
    };
    await onSave(updated);
    toast(
      `${lineLabel} ${req.workType} ${req.shift === 'all' ? '' : req.shift + ' '}standard is now ${updated.defaultPeopleCount}. Work Orders and Planner issues updated.`,
      'ok',
    );
  };

  const shiftsConfig = [
    { id: 'morning', fam: 'M', label: 'Morning Shift', icon: '🌅' },
    { id: 'evening', fam: 'E', label: 'Evening Shift', icon: '🌆' },
    { id: 'night', fam: 'N', label: 'Night Shift', icon: '🌙' },
  ] as const;

  const acsReq = lineRequirements.find((r) => r.workType === 'ACS');

  return (
    <Section
      title="Work Order Resource Standards"
      description="Crew size per work order (PM / CM / ACS) for each line and shift. Used whenever the imported Excel row gives no crew size — change a number and Work Orders, buffers and Planner issues update immediately."
    >
      <div className="bg-[var(--surface)] p-5 flex flex-col gap-5">
        {/* Line Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-ink-2 uppercase tracking-wider">Select Line:</span>
            <div className="flex items-center gap-1.5 bg-[var(--surface-2)] p-1 rounded-xl border border-[var(--line)]">
              {(['L5', 'L4'] as const).map((line) => (
                <button
                  key={line}
                  type="button"
                  onClick={() => setActiveLine(line)}
                  className={cx(
                    'px-4 py-1.5 rounded-lg text-xs font-bold transition-all',
                    activeLine === line
                      ? 'bg-[var(--surface)] text-ink shadow-sm border border-[var(--line-strong)]'
                      : 'text-ink-3 hover:text-ink hover:bg-[var(--surface-3)]/60',
                  )}
                >
                  {line === 'L4' ? 'Line 4&6' : 'Line 5'}
                </button>
              ))}
            </div>
          </div>

          <span className="text-xs font-semibold text-ink-3">
            {lineLabel} Resource Standards
          </span>
        </div>

        {/* 3 Core Shift Cards: Morning, Evening, Night */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {shiftsConfig.map((shift) => {
            const pmReq = lineRequirements.find((r) => r.shift === shift.id && r.workType === 'PM');
            const cmReq = lineRequirements.find((r) => r.shift === shift.id && r.workType === 'CM');
            const ordersUsing = usage('PM', shift.fam) + usage('CM', shift.fam);

            return (
              <div
                key={shift.id}
                className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-4 flex flex-col justify-between gap-4 hover:border-[var(--line-strong)] transition-all"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--line)]/70 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{shift.icon}</span>
                    <div>
                      <h4 className="font-bold text-ink text-[13.5px] leading-tight">{shift.label}</h4>
                      <span className="text-[11px] font-mono text-ink-3">{timingOf(shift.fam)}</span>
                    </div>
                  </div>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[var(--surface-3)] text-ink-2 border border-[var(--line)]"
                    title="Work orders on this line & shift whose crew size comes from these standards"
                  >
                    {ordersUsing} order{ordersUsing === 1 ? '' : 's'} use this
                  </span>
                </div>

                {/* Requirements rows inside shift */}
                <div className="space-y-3">
                  {/* PM */}
                  {pmReq && (
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] shadow-xs">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase font-mono bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25">
                          PM
                        </span>
                        <div>
                          <div className="text-xs font-bold text-ink leading-tight">Preventive</div>
                          <div className="text-[10.5px] text-ink-3">Scheduled tasks</div>
                        </div>
                      </div>

                      {/* Stepper */}
                      <div className="flex items-center gap-1.5 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--line)]">
                        <button
                          type="button"
                          onClick={() => handleUpdate(pmReq, pmReq.defaultPeopleCount - 1)}
                          disabled={pmReq.defaultPeopleCount <= 1}
                          className="w-7 h-7 flex items-center justify-center rounded text-ink hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:pointer-events-none font-black text-sm"
                          title="Decrease staff"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-mono font-black text-[13.5px] text-ink">
                          {pmReq.defaultPeopleCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdate(pmReq, pmReq.defaultPeopleCount + 1)}
                          className="w-7 h-7 flex items-center justify-center rounded text-ink hover:bg-[var(--surface-3)] font-black text-sm"
                          title="Increase staff"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}

                  {/* CM */}
                  {cmReq && (
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] shadow-xs">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                          CM
                        </span>
                        <div>
                          <div className="text-xs font-bold text-ink leading-tight">Corrective</div>
                          <div className="text-[10.5px] text-ink-3">Unscheduled reserve</div>
                        </div>
                      </div>

                      {/* Stepper */}
                      <div className="flex items-center gap-1.5 bg-[var(--surface-2)] p-1 rounded-lg border border-[var(--line)]">
                        <button
                          type="button"
                          onClick={() => handleUpdate(cmReq, cmReq.defaultPeopleCount - 1)}
                          disabled={cmReq.defaultPeopleCount <= 1}
                          className="w-7 h-7 flex items-center justify-center rounded text-ink hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:pointer-events-none font-black text-sm"
                          title="Decrease staff"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-mono font-black text-[13.5px] text-ink">
                          {cmReq.defaultPeopleCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdate(cmReq, cmReq.defaultPeopleCount + 1)}
                          className="w-7 h-7 flex items-center justify-center rounded text-ink hover:bg-[var(--surface-3)] font-black text-sm"
                          title="Increase staff"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Dedicated / All Shifts ACS Card */}
        {acsReq && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]/30">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛡️</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10.5px] font-black uppercase font-mono bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25">
                    ACS
                  </span>
                  <h4 className="font-bold text-ink text-sm">Access Control &amp; System Audits</h4>
                  <span className="text-[11px] text-ink-3">· All shifts · {usage('ACS')} order{usage('ACS') === 1 ? '' : 's'} use this</span>
                </div>
                <p className="text-[11.5px] text-ink-3 mt-0.5">
                  Standard personnel reserved for site access, security verification, and regulatory line audits.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-[var(--surface)] p-1 rounded-xl border border-[var(--line)] shrink-0 self-start sm:self-center">
              <button
                type="button"
                onClick={() => handleUpdate(acsReq, acsReq.defaultPeopleCount - 1)}
                disabled={acsReq.defaultPeopleCount <= 1}
                className="w-7 h-7 flex items-center justify-center rounded text-ink hover:bg-[var(--surface-3)] disabled:opacity-30 disabled:pointer-events-none font-black text-sm"
                title="Decrease staff"
              >
                −
              </button>
              <span className="w-8 text-center font-mono font-black text-[13.5px] text-ink">
                {acsReq.defaultPeopleCount}
              </span>
              <button
                type="button"
                onClick={() => handleUpdate(acsReq, acsReq.defaultPeopleCount + 1)}
                className="w-7 h-7 flex items-center justify-center rounded text-ink hover:bg-[var(--surface-3)] font-black text-sm"
                title="Increase staff"
              >
                +
              </button>
              <span className="text-xs text-ink-3 font-semibold px-2">per order</span>
            </div>
          </div>
        )}

        {/* Informative Guidance Footer */}
        <div className="text-[12px] text-ink-3 bg-[var(--surface-2)]/60 p-3 rounded-xl border border-[var(--line)]/60 flex items-center gap-2.5">
          <span className="text-base">💡</span>
          <span>
            Each number is the crew <strong>one</strong> work order needs on {lineLabel}. It applies to rows whose Excel file gave no crew size (tagged &quot;Setup standard&quot; in Work Orders). Rows with a crew size in the file, or changed by hand with −/+, keep their own number — use &quot;↺ Use standard&quot; there to switch back.
          </span>
        </div>
      </div>
    </Section>
  );
}

