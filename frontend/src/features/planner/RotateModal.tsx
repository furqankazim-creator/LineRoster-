import { useEffect, useMemo, useState } from 'react';

import { useStore } from '@/app/store';
import { codeVars } from '@/app/tones';
import { Button, Modal, useToast } from '@/components/ui';
import { monthLabel, shiftMonth } from '@/domain/calendar';
import { isLeaderEmployee } from '@/domain/rotation';

/**
 * Auto-rotate: build next month's shift allocation.
 *
 * Supports client's 2-week Team Leader cycle:
 * 2 weeks Night -> weekend off -> 2 weeks Evening -> Morning / repeat.
 * Engineers stay on their regular shift sequence throughout the month.
 */
export function RotateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, employees, codes, previewRotation, applyRotation, fairnessRows } = useStore();
  const toast = useToast();

  const [targetScope, setTargetScope] = useState<'leaders_only' | 'all'>('leaders_only');
  const [patternMode, setPatternMode] = useState<'two_week_cycle' | 'monthly'>('two_week_cycle');
  const [aggressiveness, setAggressiveness] = useState(1);

  // Available leaders on this line
  const leaderEmployees = useMemo(
    () => employees.filter((e) => e.active !== false && isLeaderEmployee(e)),
    [employees],
  );

  // Track which leaders are selected to rotate
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSelectedLeaderIds(leaderEmployees.map((e) => e.id));
    }
  }, [open, leaderEmployees]);

  const toggleLeader = (id: string) => {
    setSelectedLeaderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const target = shiftMonth(settings.activeYear, settings.activeMonth, 1);
  const result = useMemo(() => {
    if (!open) return null;
    return previewRotation({
      aggressiveness,
      targetScope,
      patternMode,
      selectedLeaderIds: targetScope === 'leaders_only' ? selectedLeaderIds : undefined,
    });
  }, [open, aggressiveness, targetScope, patternMode, selectedLeaderIds, previewRotation]);

  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);

  const moves = useMemo(() => {
    if (!result) return [];
    return employees
      .filter((e) => result.assignments[e.id] && result.assignments[e.id] !== e.defaultShift)
      .map((e) => ({ employee: e, from: e.defaultShift, to: result.assignments[e.id] }));
  }, [result, employees]);

  const nightsBefore = useMemo(
    () => new Map(fairnessRows.rows.map((r) => [r.employee.id, r.nights])),
    [fairnessRows],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={660}
      title={`Auto-rotate into ${monthLabel(target.year, target.month)}`}
      description={
        targetScope === 'leaders_only'
          ? 'Rotates designated Team Leaders on a 2-week shift sequence while keeping engineers on their regular shift.'
          : 'Balances night-shift load across the rotating pool, then repairs any day that would fall below its minimum.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!result}
            onClick={async () => {
              if (!result) return;
              await applyRotation(result, target.year, target.month);
              if (targetScope === 'leaders_only') {
                toast(
                  `${monthLabel(target.year, target.month)} rotated — ${result.leadersRotated?.length ?? selectedLeaderIds.length} Team Leaders updated with 2-week sequence.`,
                  'ok',
                );
              } else {
                toast(
                  `${monthLabel(target.year, target.month)} rotated — ${moves.length} people moved.`,
                  'ok',
                );
              }
              onClose();
            }}
          >
            {targetScope === 'leaders_only'
              ? `Apply Leader Rotation (${selectedLeaderIds.length})`
              : `Apply to ${monthLabel(target.year, target.month)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Scope selector */}
        <div className="flex rounded-xl bg-[var(--surface-3)] p-1 border border-[var(--line)]">
          <button
            type="button"
            onClick={() => setTargetScope('leaders_only')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-[12.5px] font-semibold transition-all ${
              targetScope === 'leaders_only'
                ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm'
                : 'text-ink-3 hover:text-ink'
            }`}
          >
            <span>👑</span>
            <span>Rotate Leaders Only</span>
            <span className="rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider">
              Recommended
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTargetScope('all')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-[12.5px] font-semibold transition-all ${
              targetScope === 'all'
                ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm'
                : 'text-ink-3 hover:text-ink'
            }`}
          >
            <span>👥</span>
            <span>Rotate All Staff</span>
          </button>
        </div>

        {targetScope === 'leaders_only' ? (
          <>
            {/* Pattern Mode selector */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Rotation Pattern
                </span>
                <span className="text-[11px] text-ink-3">
                  Client requirement: 2w Night → Weekend Off → 2w Evening
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPatternMode('two_week_cycle')}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    patternMode === 'two_week_cycle'
                      ? 'border-[var(--accent)] bg-[var(--surface)] text-[var(--ink)] ring-1 ring-[var(--accent)]'
                      : 'border-[var(--line)] bg-[var(--surface-2)] text-ink-2 hover:bg-[var(--surface-3)]'
                  }`}
                >
                  <div className="text-[12.5px] font-bold flex items-center gap-1.5">
                    <span>🔄 2-Week Shift Sequence</span>
                  </div>
                  <div className="text-[11px] text-ink-3 mt-1 leading-snug">
                    2 weeks Night → Weekend off → 2 weeks Evening / Morning cycle
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPatternMode('monthly')}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    patternMode === 'monthly'
                      ? 'border-[var(--accent)] bg-[var(--surface)] text-[var(--ink)] ring-1 ring-[var(--accent)]'
                      : 'border-[var(--line)] bg-[var(--surface-2)] text-ink-2 hover:bg-[var(--surface-3)]'
                  }`}
                >
                  <div className="text-[12.5px] font-bold flex items-center gap-1.5">
                    <span>📅 Monthly Shift Step</span>
                  </div>
                  <div className="text-[11px] text-ink-3 mt-1 leading-snug">
                    Rotates leaders once per full month (Night → Evening → Morning)
                  </div>
                </button>
              </div>
            </div>

            {/* Leader selection chips */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Designated Team Leaders ({selectedLeaderIds.length} of {leaderEmployees.length} selected)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedLeaderIds(
                      selectedLeaderIds.length === leaderEmployees.length
                        ? []
                        : leaderEmployees.map((e) => e.id),
                    )
                  }
                  className="text-[11.5px] font-semibold text-[var(--accent)] hover:underline"
                >
                  {selectedLeaderIds.length === leaderEmployees.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {leaderEmployees.map((leader) => {
                  const active = selectedLeaderIds.includes(leader.id);
                  return (
                    <button
                      key={leader.id}
                      type="button"
                      onClick={() => toggleLeader(leader.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--surface)] text-[var(--ink)] shadow-sm'
                          : 'border-[var(--line)] bg-[var(--surface-3)] text-ink-3 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <span className="text-[13px]">{active ? '👑' : '○'}</span>
                      <span>{leader.name}</span>
                      <Pill code={leader.defaultShift} label={codeById.get(leader.defaultShift)?.label} />
                    </button>
                  );
                })}
              </div>
              <p className="text-[11.5px] text-ink-3">
                Engineers ({employees.length - leaderEmployees.length} staff) remain fixed on their regular shift sequence throughout the month.
              </p>
            </div>
          </>
        ) : (
          /* Shuffle slider for Rotate All Staff */
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                How much to shuffle
              </span>
              <span className="font-mono text-[12px] text-ink-2">
                {moves.length} of {employees.length} move
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={aggressiveness}
              onChange={(e) => setAggressiveness(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between text-[11px] text-ink-3 mt-1">
              <span>Keep things stable</span>
              <span>Rotate everyone</span>
            </div>
          </div>
        )}

        {/* Headcount preview across shifts */}
        {result && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {codes
              .filter((c) => c.rotates && !c.isStatus)
              .map((code) => {
                const worst = result.worstCoverage[code.id] ?? 0;
                const short = worst < code.minHeadcount;
                return (
                  <div
                    key={code.id}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: codeVars(code).accent }}
                      />
                      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                        {code.label}
                      </span>
                    </div>
                    <div
                      className="mt-1 font-mono text-[18px] leading-none"
                      style={{ color: short ? 'var(--danger)' : 'var(--ok)' }}
                    >
                      {worst}
                    </div>
                    <div className="mt-1 text-[10.5px] text-ink-3">
                      thinnest day · min {code.minHeadcount}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Schedule & Movement Preview */}
        <div>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 flex items-center justify-between">
            <span>
              {targetScope === 'leaders_only'
                ? patternMode === 'two_week_cycle'
                  ? 'Leader 2-Week Shift Schedule'
                  : 'Leader Shift Rotation'
                : 'Who moves'}
            </span>
            {targetScope === 'leaders_only' && (
              <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
                ✓ Engineers stay fixed
              </span>
            )}
          </div>

          {targetScope === 'leaders_only' ? (
            <div className="flex flex-col divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] overflow-hidden">
              {leaderEmployees
                .filter((l) => selectedLeaderIds.includes(l.id))
                .map((leader) => {
                  const rules = result?.rotationRules?.[leader.id];
                  const rule1 = rules?.[0];
                  const rule2 = rules?.[1];

                  return (
                    <div
                      key={leader.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 bg-[var(--surface-2)]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[13px]">👑</span>
                        <span className="text-[12.5px] font-semibold truncate text-ink">
                          {leader.name}
                        </span>
                      </div>

                      {patternMode === 'two_week_cycle' && rule1 && rule2 ? (
                        <div className="flex items-center gap-2 text-[11.5px] text-ink-2 font-mono">
                          <span className="text-ink-3 text-[11px]">Days 1–14:</span>
                          <Pill code={rule1.code} label={codeById.get(rule1.code)?.label} />
                          <span className="text-ink-3 text-[10.5px] px-1 py-0.5 rounded bg-[var(--surface-3)]">
                            Weekend Off
                          </span>
                          <span className="text-ink-3 text-[11px]">Days 15+:</span>
                          <Pill code={rule2.code} label={codeById.get(rule2.code)?.label} />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[11.5px] text-ink-3">Current:</span>
                          <Pill code={leader.defaultShift} label={codeById.get(leader.defaultShift)?.label} />
                          <span className="text-ink-3 text-[11px]">→</span>
                          <span className="text-[11.5px] text-ink-3">Next:</span>
                          <Pill
                            code={result?.assignments[leader.id] ?? leader.defaultShift}
                            label={codeById.get(result?.assignments[leader.id] ?? leader.defaultShift)?.label}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

              <div className="px-3.5 py-2 bg-[var(--surface)] text-[11.5px] text-ink-3 flex items-center gap-2">
                <span>🛡️</span>
                <span>
                  {employees.length - selectedLeaderIds.length} Engineers continue on their regular shift sequence without change.
                </span>
              </div>
            </div>
          ) : moves.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">
              Nobody moves at this setting — everyone stays on their current shift.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] overflow-hidden">
              {moves.map(({ employee, from, to }) => (
                <div key={employee.id} className="flex items-center gap-3 px-3 py-2 bg-[var(--surface-2)]">
                  <span className="flex-1 truncate text-[12.5px]">{employee.name}</span>
                  <span className="text-[11px] text-ink-3 font-mono">
                    {nightsBefore.get(employee.id) ?? 0} nights so far
                  </span>
                  <Pill code={from} label={codeById.get(from)?.label} />
                  <span className="text-ink-3 text-[11px]">→</span>
                  <Pill code={to} label={codeById.get(to)?.label} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Why / explanation notes */}
        {result && result.notes.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
              Summary & Insights
            </div>
            <ul className="flex flex-col gap-1">
              {result.notes.map((note, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-ink-2 leading-snug">
                  <span className="text-ink-3 shrink-0">·</span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );

  function Pill({ code, label }: { code: string; label?: string }) {
    const tone = codeVars(codeById.get(code));
    return (
      <span
        title={label}
        className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
        style={{ background: tone.bg, color: tone.fg }}
      >
        {code}
      </span>
    );
  }
}
