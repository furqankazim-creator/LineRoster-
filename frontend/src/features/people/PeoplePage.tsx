import { useMemo, useState } from 'react';

import { useStore } from '@/app/store';
import { codeVars } from '@/app/tones';
import { Button, Field, Input, Modal, Select, Switch, cx, useToast } from '@/components/ui';
import { newId } from '@/data/db';
import { WEEKDAY_LABELS, daysInMonth, monthKey, monthLabel } from '@/domain/calendar';
import { isLeaderEmployee } from '@/domain/rotation';
import type { Employee, LeaveBlock, RotationRule, Weekday } from '@/domain/types';

/**
 * People — the input side of the tool.
 *
 * Everything the generator needs lives here: a person's shift, their rest-day
 * pair, any mid-month rotation and any leave. Getting these four things right
 * is the only manual work; the month builds itself from them.
 */
export function PeoplePage() {
  const { employees, codes, lines, settings, addEmployee, saveEmployee, removeEmployee, reorderEmployees } =
    useStore();
  const toast = useToast();

  const [editing, setEditing] = useState<Employee | null>(null);
  const line = lines.find((l) => l.id === settings.activeLineId);

  const grouped = useMemo(() => {
    const order = new Map(codes.map((c, i) => [c.id, i]));
    return [...employees].sort(
      (a, b) =>
        (order.get(a.defaultShift) ?? 99) - (order.get(b.defaultShift) ?? 99) ||
        a.name.localeCompare(b.name),
    );
  }, [employees, codes]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-5 sm:py-7">
        <header className="mb-5 flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-[19px] font-semibold tracking-[-0.015em]">People</h1>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {employees.length} on {line?.name ?? 'this line'} · shift, rest days and rotation drive
              the whole month
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await reorderEmployees(grouped.map((e) => e.id));
                toast('Reordered by shift.', 'ok');
              }}
            >
              Group by shift
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => setEditing(await addEmployee())}
            >
              Add person
            </Button>
          </div>
        </header>

        <div className="overflow-hidden rounded-xl border border-[var(--line)]">
          <div className="grid grid-cols-[1fr_56px_92px_24px] md:grid-cols-[1fr_120px_84px_120px_90px_36px] gap-3 bg-[var(--surface-3)] px-3 md:px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
            <span>Name</span>
            <span className="hidden md:block">Contact</span>
            <span>Shift</span>
            <span>Rest days</span>
            <span className="hidden md:block">Rotation</span>
            <span />
          </div>

          <div className="divide-y divide-[var(--line)]">
            {employees.map((employee) => {
              const code = codes.find((c) => c.id === employee.defaultShift);
              const tone = codeVars(code);
              const rotations = employee.rotations?.[monthKey(settings.activeYear, settings.activeMonth)] ?? [];

              return (
                <button
                  key={employee.id}
                  onClick={() => setEditing(employee)}
                  className="grid w-full grid-cols-[1fr_56px_92px_24px] md:grid-cols-[1fr_120px_84px_120px_90px_36px] items-center gap-3 bg-[var(--surface)] px-3 md:px-4 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="h-4 w-[3px] rounded-full shrink-0" style={{ background: tone.accent }} />
                    <span className="truncate text-[13px] font-medium">{employee.name}</span>
                    {isLeaderEmployee(employee) && (
                      <span className="shrink-0 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-px text-[9.5px] uppercase tracking-wide font-semibold flex items-center gap-0.5">
                        <span title="Team leader">👑</span>
                        <span className="hidden sm:inline">Leader</span>
                      </span>
                    )}
                    {employee.pinned && (
                      <span className="shrink-0 rounded bg-[var(--surface-3)] px-1.5 py-px text-[9.5px] uppercase tracking-wide text-ink-3" title="Fixed — never auto-rotated">
                        <span className="sm:hidden">📌</span>
                        <span className="hidden sm:inline">fixed</span>
                      </span>
                    )}
                  </span>
                  <span className="hidden md:block font-mono text-[11.5px] text-ink-3 truncate">{employee.contact || '—'}</span>
                  <span
                    className="justify-self-start rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {employee.defaultShift}
                  </span>
                  <span className="font-mono text-[11.5px] text-ink-2">
                    {employee.restDays.length
                      ? employee.restDays.map((d) => WEEKDAY_LABELS[d].slice(0, 2)).join(' + ')
                      : '—'}
                  </span>
                  <span className="hidden md:block font-mono text-[11px] text-ink-3">
                    {rotations.length > 1 ? `${rotations.length} blocks` : '—'}
                  </span>
                  <span className="text-ink-3 text-[13px] justify-self-end">›</span>
                </button>
              );
            })}
          </div>

          {employees.length === 0 && (
            <div className="bg-[var(--surface)] px-4 py-10 text-center">
              <p className="text-[13px] font-medium">Nobody on this line yet</p>
              <p className="mt-1 text-[12px] text-ink-3">
                Add people one by one, or import an existing Excel roster from the Planner.
              </p>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EmployeeEditor
          employee={editing}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await saveEmployee(next);
            setEditing(null);
            toast(`${next.name} saved.`, 'ok');
          }}
          onDelete={async () => {
            await removeEmployee(editing.id);
            setEditing(null);
            toast('Person removed.', 'ok');
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- editor */

function EmployeeEditor({
  employee,
  onClose,
  onSave,
  onDelete,
}: {
  employee: Employee;
  onClose: () => void;
  onSave: (next: Employee) => void;
  onDelete: () => void;
}) {
  const { codes, settings, leave, saveLeave, removeLeave } = useStore();
  const [draft, setDraft] = useState<Employee>({ ...employee });

  const key = monthKey(settings.activeYear, settings.activeMonth);
  const span = daysInMonth(settings.activeYear, settings.activeMonth);
  const rotations = draft.rotations?.[key] ?? [];
  const myLeave = leave.filter((l) => l.employeeId === employee.id);

  const setRotations = (next: RotationRule[]) =>
    setDraft((d) => ({ ...d, rotations: { ...(d.rotations ?? {}), [key]: next } }));

  const toggleRest = (day: Weekday) =>
    setDraft((d) => ({
      ...d,
      restDays: d.restDays.includes(day)
        ? d.restDays.filter((x) => x !== day)
        : [...d.restDays, day].sort((a, b) => a - b),
    }));

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={employee.name}
      description="Set the rules once; every month builds itself from them."
      footer={
        <>
          <Button variant="danger" size="sm" onClick={onDelete} className="mr-auto">
            Remove
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(draft)}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Contact">
            <Input
              value={draft.contact}
              onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Default shift" hint="Used on any working day no rotation covers.">
            <Select
              value={draft.defaultShift}
              onChange={(e) => setDraft({ ...draft, defaultShift: e.target.value })}
            >
              {codes.filter((c) => !c.isStatus).map((c) => (
                <option key={c.id} value={c.id}>{c.id} — {c.label}</option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-2 pb-2 justify-end">
            <Switch
              checked={draft.isLeader ?? isLeaderEmployee(draft)}
              onChange={(v) => setDraft({ ...draft, isLeader: v })}
              label="Team Leader (rotates on 2-week cycle)"
            />
            <Switch
              checked={!!draft.pinned}
              onChange={(v) => setDraft({ ...draft, pinned: v })}
              label="Fixed — never auto-rotate"
            />
          </div>
        </div>

        <Field
          label="Rest days"
          hint="The person's weekly days off. This is what turns one shift into a full month."
        >
          <div className="flex gap-1">
            {WEEKDAY_LABELS.map((label, day) => {
              const on = draft.restDays.includes(day as Weekday);
              return (
                <button
                  key={label}
                  onClick={() => toggleRest(day as Weekday)}
                  className={cx(
                    'flex-1 h-9 rounded-lg text-[12px] font-medium transition-colors border',
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

        {/* -------------------------------------------------- rotations */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Rotation · {monthLabel(settings.activeYear, settings.activeMonth)}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setRotations([
                  ...rotations,
                  {
                    fromDay: rotations.at(-1) ? Math.min(span, rotations.at(-1)!.toDay + 1) : 1,
                    toDay: span,
                    code: draft.defaultShift,
                  },
                ])
              }
            >
              Add block
            </Button>
          </div>

          {rotations.length === 0 ? (
            <p className="text-[12px] text-ink-3 leading-snug">
              No mid-month change — {draft.name.split(' ')[0]} stays on{' '}
              <span className="font-mono text-ink-2">{draft.defaultShift}</span> all month.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {rotations.map((rule, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={rule.code}
                    onChange={(e) => {
                      const next = rotations.slice();
                      next[i] = { ...rule, code: e.target.value };
                      setRotations(next);
                    }}
                    className="h-8 w-[72px] text-[12px]"
                  >
                    {codes.filter((c) => !c.isStatus).map((c) => (
                      <option key={c.id} value={c.id}>{c.id}</option>
                    ))}
                  </Select>
                  <span className="text-[11.5px] text-ink-3">days</span>
                  <Input
                    type="number"
                    min={1}
                    max={span}
                    value={rule.fromDay}
                    onChange={(e) => {
                      const next = rotations.slice();
                      next[i] = { ...rule, fromDay: Number(e.target.value) };
                      setRotations(next);
                    }}
                    className="h-8 w-[58px] text-center"
                  />
                  <span className="text-[11.5px] text-ink-3">to</span>
                  <Input
                    type="number"
                    min={1}
                    max={span}
                    value={rule.toDay}
                    onChange={(e) => {
                      const next = rotations.slice();
                      next[i] = { ...rule, toDay: Number(e.target.value) };
                      setRotations(next);
                    }}
                    className="h-8 w-[58px] text-center"
                  />
                  <Button
                    size="sm"
                    onClick={() => setRotations(rotations.filter((_, j) => j !== i))}
                    className="ml-auto px-2"
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------ leave */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Leave &amp; status
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void saveLeave({
                  id: newId('lv'),
                  employeeId: employee.id,
                  from: `${key}-01`,
                  to: `${key}-${String(Math.min(7, span)).padStart(2, '0')}`,
                  code: codes.find((c) => c.isStatus)?.id ?? 'LV',
                } satisfies LeaveBlock)
              }
            >
              Add leave
            </Button>
          </div>

          {myLeave.length === 0 ? (
            <p className="text-[12px] text-ink-3">No leave recorded.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {myLeave.map((block) => (
                <div key={block.id} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={block.code}
                    onChange={(e) => void saveLeave({ ...block, code: e.target.value })}
                    className="h-8 w-[84px] text-[12px]"
                  >
                    {codes.filter((c) => c.isStatus).map((c) => (
                      <option key={c.id} value={c.id}>{c.id}</option>
                    ))}
                  </Select>
                  <Button size="sm" onClick={() => void removeLeave(block.id)} className="px-2 ml-auto sm:order-last sm:ml-0">✕</Button>
                  <Input
                    type="date"
                    value={block.from}
                    onChange={(e) => void saveLeave({ ...block, from: e.target.value })}
                    className="h-8 flex-1 min-w-[140px] text-[12px]"
                  />
                  <Input
                    type="date"
                    value={block.to}
                    onChange={(e) => void saveLeave({ ...block, to: e.target.value })}
                    className="h-8 flex-1 min-w-[140px] text-[12px]"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
