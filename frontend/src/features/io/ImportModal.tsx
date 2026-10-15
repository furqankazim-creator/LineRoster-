import { useRef, useState } from 'react';

import { useStore } from '@/app/store';
import { codeVars } from '@/app/tones';
import { Button, Modal, Select, Switch, cx } from '@/components/ui';
import { codeKey, db, newId } from '@/data/db';
import { MONTH_NAMES, WEEKDAY_LABELS } from '@/domain/calendar';
import { rosterId } from '@/domain/generator';
import { OFF } from '@/domain/types';
import type { ImportResult } from '@/io/importXlsx';

/** The xlsx parser is ~900 kB, so it loads on first use rather than at startup. */
const loadImporter = () => import('@/io/importXlsx');

type Stage = 'pick-file' | 'pick-sheet' | 'review';

/**
 * Excel import, with a mandatory review step.
 *
 * Importing replaces the people on a line, so the client sees exactly what was
 * understood — each person's rest days, shift and detected rotation — before
 * anything is written. Nothing is silently overwritten.
 */
export function ImportModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const { settings, lines, codes, allCodes, openSheet } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('pick-file');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [targetLine, setTargetLine] = useState(settings.activeLineId);
  const [replace, setReplace] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const codeById = new Map(codes.map((c) => [c.id, c]));

  const reset = () => {
    setStage('pick-file');
    setBuffer(null);
    setSheets([]);
    setResult(null);
    setError(null);
  };

  const onFile = async (file: File) => {
    try {
      setError(null);
      const buf = await file.arrayBuffer();
      const { listSheets } = await loadImporter();
      const names = listSheets(buf);
      setBuffer(buf);
      setSheets(names);
      if (names.length === 1) await parseSheet(buf, names[0]);
      else setStage('pick-sheet');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const parseSheet = async (buf: ArrayBuffer, sheetName: string) => {
    try {
      setError(null);
      const { importSheet } = await loadImporter();
      setResult(importSheet(buf, sheetName));
      setStage('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that sheet.');
    }
  };

  /**
   * Smart defaults for a shift code that appears in the imported Excel but
   * doesn't yet exist in the app.  The tone/label/timing are inferred from
   * the code's first letter(s) so the code shows up with the right colour
   * straight away — the user can fine-tune timings in Setup → Shift codes.
   */
  const guessShiftCode = (id: string, existingCount: number) => {
    const up = id.toUpperCase();
    type Tone = 'morning' | 'evening' | 'night' | 'general' | 'project' | 'leave' | 'off';

    const KNOWN_LABELS: Record<string, { label: string; timing: string; tone: Tone; rotates: boolean; isStatus?: boolean }> = {
      M:    { label: 'Morning',           timing: '06:00 – 15:00', tone: 'morning',  rotates: true  },
      ML:   { label: 'Morning Late',      timing: '07:00 – 18:00', tone: 'morning',  rotates: false },
      MT:   { label: 'Morning – Support', timing: '06:00 – 15:00', tone: 'morning',  rotates: false },
      E:    { label: 'Evening',           timing: '14:00 – 23:00', tone: 'evening',  rotates: true  },
      EL:   { label: 'Evening Late',      timing: '15:00 – 00:00', tone: 'evening',  rotates: false },
      ET:   { label: 'Evening – Support', timing: '14:00 – 23:00', tone: 'evening',  rotates: false },
      N:    { label: 'Night',             timing: '22:00 – 07:00', tone: 'night',    rotates: true  },
      NL:   { label: 'Night Late',        timing: '19:00 – 07:00', tone: 'night',    rotates: false },
      NT:   { label: 'Night – Support',   timing: '22:00 – 07:00', tone: 'night',    rotates: false },
      GS:   { label: 'General Shift',     timing: '08:00 – 17:00', tone: 'general',  rotates: false },
      P:    { label: 'Project',           timing: '08:00 – 17:00', tone: 'project',  rotates: false },
      LV:   { label: 'Leave',             timing: '',              tone: 'leave',    rotates: false, isStatus: true },
      FLRT: { label: 'FLRT',             timing: '',              tone: 'leave',    rotates: false, isStatus: true },
    };

    const defaults = KNOWN_LABELS[up];
    if (defaults) {
      return { id: up, ...defaults, minHeadcount: 0, countsAsEngineer: !defaults.isStatus, order: 500 + existingCount };
    }

    // Infer tone from first letter
    const tone: Tone = /^M/i.test(up) ? 'morning'
      : /^E/i.test(up) ? 'evening'
      : /^N/i.test(up) ? 'night'
      : /^GS/i.test(up) ? 'general'
      : /^P/i.test(up) ? 'project'
      : /^LV|^AL|^SL/i.test(up) ? 'leave'
      : 'off';

    return {
      id: up,
      label: up,
      timing: '',
      tone,
      minHeadcount: 0,
      countsAsEngineer: false,
      rotates: false,
      order: 500 + existingCount,
    };
  };

  const commit = async () => {
    if (!result) return;
    const { toRecords } = await loadImporter();
    const { employees, leave } = toRecords(result, targetLine, () => newId('e'));

    // ---- collect every shift code used by the imported employees ----------
    const usedCodes = new Set<string>();
    for (const emp of result.employees) {
      for (const code of emp.codes) {
        if (code && code !== '-' && code !== OFF) usedCodes.add(code);
      }
    }

    // ---- find which codes are missing from the current setup --------------
    // Codes this sheet invents belong to the line being imported into, so they
    // never appear on another line's grid.
    const rid = rosterId(targetLine, result.year, result.month);
    // A code only needs creating when nothing in the catalogue defines it —
    // not merely when the month being replaced happened not to use it.
    const lineCodeIds = new Set(
      allCodes.filter((c) => c.scope === targetLine).map((c) => c.id),
    );
    const toCreate = [...usedCodes]
      .filter((id) => !lineCodeIds.has(id))
      .map((id, i) => ({ ...guessShiftCode(id, lineCodeIds.size + i), scope: targetLine }));

    // ---- write everything in one transaction ------------------------------
    await db.transaction('rw', db.employees, db.leave, db.rosters, db.shiftCodes, db.layouts, async () => {
      // Auto-create any shift codes that don't exist yet
      if (toCreate.length) {
        await db.shiftCodes.bulkPut(toCreate.map((c) => ({ ...c, key: codeKey(c.id, c.scope) })));
      }

      if (replace) {
        const existing = await db.employees.where('lineId').equals(targetLine).toArray();
        await db.leave.where('employeeId').anyOf(existing.map((e) => e.id)).delete();
        await db.employees.where('lineId').equals(targetLine).delete();
      }
      await db.employees.bulkPut(employees);
      await db.leave.bulkPut(leave);
      // Drop the cached grid so it rebuilds from the imported rules.
      await db.rosters.delete(rid);
      // Remember the source file's shape so Export can hand it back the same way.
      await db.layouts.put({ rosterId: rid, layout: result.layout });
    });

    // Land on the sheet that was just imported, on the line it went into.
    await openSheet(targetLine, result.year, result.month);
    onDone(employees.length);
    reset();
    onClose();
  };


  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      width={660}
      title="Import from Excel"
      description="Reads one of your existing roster sheets and works out each person's shift, rest days, rotation and leave."
      footer={
        <>
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          {stage === 'review' && result && (
            <Button variant="primary" onClick={commit}>
              Import {result.employees.length} people
            </Button>
          )}
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--sh-leave-bg)] px-3 py-2.5 text-[12.5px] text-[var(--danger)]">
          {error}
        </div>
      )}

      {stage === 'pick-file' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void onFile(file);
          }}
          className="rounded-xl border-2 border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] px-6 py-10 text-center"
        >
          <p className="text-[13px] font-medium">Drop an .xlsx roster here</p>
          <p className="mt-1 text-[12px] text-ink-3">or</p>
          <Button variant="outline" size="sm" className="mt-2.5" onClick={() => fileInput.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <p className="mt-4 text-[11.5px] text-ink-3 leading-relaxed max-w-sm mx-auto">
            Works with both simple rosters and operational roster sheets (such as{' '}
            <span className="font-mono text-ink-2">Line 5_SEP-2026</span> or{' '}
            <span className="font-mono text-ink-2">SEPTEMBER 2026 RST L5</span>). Detects employee names,
            shift schedules, rotations, and leave automatically.
          </p>
        </div>
      )}

      {stage === 'pick-sheet' && buffer && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-ink-2">That workbook has several sheets. Which one?</p>
          {sheets.map((name) => (
            <button
              key={name}
              onClick={() => void parseSheet(buffer, name)}
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-left text-[13px] hover:border-[var(--accent)] transition-colors"
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {stage === 'review' && result && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Month</div>
              <div className="text-[13px] font-medium">
                {MONTH_NAMES[result.month - 1]} {result.year}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">People</div>
              <div className="text-[13px] font-medium font-mono">{result.employees.length}</div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                  Import into
                </span>
                <Select value={targetLine} onChange={(e) => setTargetLine(e.target.value)} className="h-7 text-[12px]">
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              </label>
            </div>
          </div>

          <Switch
            checked={replace}
            onChange={setReplace}
            label="Replace the people already on this line"
          />

          {result.warnings.map((w, i) => (
            <p key={i} className="text-[12px] text-[var(--warn)]">{w}</p>
          ))}

          {result.unknownCodes.length > 0 && (
            <p className="text-[12px] text-[var(--accent)] leading-snug rounded-lg border border-[var(--accent)] px-3 py-2">
              ✨ New shift codes found:{' '}
              <span className="font-mono font-bold">{result.unknownCodes.join(', ')}</span>.{' '}
              They will be <strong>auto-created for this line only</strong>, with colour and timing defaults — other lines are untouched. You can customise them in Setup → Shift codes.
            </p>
          )}

          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
              What was understood
            </div>
            <div className="rounded-xl border border-[var(--line)] overflow-hidden">
              <div className="grid grid-cols-[1fr_52px_70px] sm:grid-cols-[1fr_58px_78px_1fr] gap-2 bg-[var(--surface-3)] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
                <span>Name</span>
                <span>Shift</span>
                <span>Rest days</span>
                <span className="hidden sm:block">Rotation</span>
              </div>
              <div className="max-h-[240px] overflow-y-auto divide-y divide-[var(--line)]">
                {result.employees.map((row, i) => {
                  const tone = codeVars(codeById.get(row.defaultShift));
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_52px_70px] sm:grid-cols-[1fr_58px_78px_1fr] items-center gap-2 px-3 py-1.5 bg-[var(--surface-2)]"
                    >
                      <span className="truncate text-[12px]">{row.name}</span>
                      <span
                        className="justify-self-start rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
                        style={{ background: tone.bg, color: tone.fg }}
                      >
                        {row.defaultShift}
                      </span>
                      <span className="font-mono text-[11px] text-ink-2">
                        {row.restDays.length
                          ? row.restDays.map((d) => WEEKDAY_LABELS[d].slice(0, 2)).join('+')
                          : '—'}
                      </span>
                      <span className="hidden sm:block truncate font-mono text-[10.5px] text-ink-3">
                        {row.rotations.length
                          ? row.rotations.map((r) => `${r.code}:${r.fromDay}-${r.toDay}`).join(' ')
                          : 'none'}
                        {row.leaveRanges.length > 0 && (
                          <span className="text-[var(--sh-leave-ink)]">
                            {' '}· {row.leaveRanges.length} leave
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <details className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-[12px] text-ink-2 select-none">
              Preview the grid as read
            </summary>
            <div className="overflow-x-auto px-3 pb-3">
              <table className="border-separate border-spacing-[1px]">
                <tbody>
                  {result.employees.map((row, i) => (
                    <tr key={i}>
                      <td className="pr-2 text-[10.5px] text-ink-3 whitespace-nowrap sticky left-0 bg-[var(--surface-2)]">
                        {row.name}
                      </td>
                      {row.codes.map((code, j) => {
                        const def = codeById.get(code);
                        const tone = codeVars(def);
                        return (
                          <td
                            key={j}
                            className={cx(
                              'w-[17px] h-[17px] text-center font-mono text-[8.5px] font-bold rounded-[2px]',
                              def?.isStatus && 'hatch',
                            )}
                            style={{
                              background: def?.isStatus ? undefined : tone.bg,
                              color: tone.fg,
                            }}
                          >
                            {code === OFF ? '' : code[0]}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Modal>
  );
}
