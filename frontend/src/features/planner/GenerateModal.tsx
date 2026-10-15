import { useMemo, useState } from 'react';

import { useStore } from '@/app/store';
import { codeVars } from '@/app/tones';
import { Button, Modal, Switch, useToast } from '@/components/ui';
import { daysInMonth, monthLabel } from '@/domain/calendar';
import { generateMonth } from '@/domain/generator';
import { summarise } from '@/domain/summary';
import { validate } from '@/domain/validate';

/**
 * The Generate dialog.
 *
 * Shows what the rebuild will produce *before* committing it — how many cells
 * change, how many hand edits are at stake, and what the coverage looks like
 * afterwards. Regenerating a month he has already tuned is the one destructive
 * action in the app, so it never happens without a preview.
 */
export function GenerateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { settings, employees, codes, leave, roster, regenerate } = useStore();
  const toast = useToast();

  const [respectOverrides, setRespectOverrides] = useState(true);
  const [respectLeave, setRespectLeave] = useState(true);

  const { activeYear: year, activeMonth: month, activeLineId: lineId } = settings;
  const nDays = daysInMonth(year, month);

  const preview = useMemo(() => {
    if (!open) return null;

    const next = generateMonth({
      year, month, lineId, employees, leaveBlocks: leave,
      overrides: respectOverrides ? roster?.overrides ?? {} : {},
      respectOverrides,
      respectLeave,
    });

    let changed = 0;
    if (roster) {
      for (const [empId, row] of Object.entries(next.cells)) {
        const before = roster.cells[empId];
        if (!before) continue;
        row.forEach((cell, i) => {
          if (before[i]?.code !== cell.code) changed++;
        });
      }
    }

    const manualCount = Object.values(roster?.overrides ?? {}).reduce(
      (n, row) => n + Object.keys(row).length,
      0,
    );

    const days = summarise(next, codes, nDays);
    const issues = validate({ roster: next, employees, codes, leaveBlocks: leave, nDays });

    return {
      changed,
      manualCount,
      days,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    };
  }, [open, year, month, lineId, employees, leave, roster, respectOverrides, respectLeave, codes, nDays]);

  const worked = codes.filter((c) => !c.isStatus);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title={`Generate ${monthLabel(year, month)}`}
      description="Rebuilds every cell from each person's shift, rest days, rotation rules and leave."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await regenerate({ respectOverrides });
              toast(
                `${monthLabel(year, month)} generated — ${preview?.changed ?? 0} cells updated.`,
                'ok',
              );
              onDone();
              onClose();
            }}
          >
            Generate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
          <Switch
            checked={respectOverrides}
            onChange={setRespectOverrides}
            label="Keep my hand edits"
          />
          <p className="-mt-1 pl-[42px] text-[11.5px] text-ink-3 leading-snug">
            {preview?.manualCount
              ? `${preview.manualCount} cell${preview.manualCount === 1 ? '' : 's'} in this month ${
                  preview.manualCount === 1 ? 'was' : 'were'
                } set by hand. ${
                  respectOverrides ? 'They will be preserved.' : 'They will be overwritten.'
                }`
              : 'Nothing has been hand-edited in this month yet.'}
          </p>

          <Switch checked={respectLeave} onChange={setRespectLeave} label="Respect leave blocks" />
        </div>

        {preview && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Stat label="Cells changing" value={preview.changed} />
              <Stat
                label="Coverage errors"
                value={preview.errors}
                tone={preview.errors ? 'var(--danger)' : 'var(--ok)'}
              />
              <Stat
                label="Warnings"
                value={preview.warnings}
                tone={preview.warnings ? 'var(--warn)' : 'var(--ok)'}
              />
            </div>

            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                Daily coverage after generating
              </div>
              <div className="flex flex-col gap-1.5">
                {worked.map((code) => {
                  const tone = codeVars(code);
                  const counts = preview.days.map((d) => d.total[code.id] ?? 0);
                  const peak = Math.max(1, ...counts);
                  return (
                    <div key={code.id} className="flex items-center gap-2.5">
                      <span className="w-[68px] shrink-0 text-[11px] text-ink-2 truncate">
                        {code.label}
                      </span>
                      <div className="flex flex-1 items-end gap-[2px] h-7">
                        {counts.map((n, i) => {
                          const short = code.minHeadcount > 0 && n < code.minHeadcount;
                          return (
                            <span
                              key={i}
                              title={`Day ${i + 1}: ${n}`}
                              className="flex-1 rounded-[1px] min-h-[2px]"
                              style={{
                                height: `${(n / peak) * 100}%`,
                                background: short ? 'var(--danger)' : tone.accent,
                                opacity: short ? 1 : 0.75,
                              }}
                            />
                          );
                        })}
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] text-ink-3">
                        {Math.min(...counts)}–{Math.max(...counts)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-0.5 font-mono text-[19px] leading-none" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}
