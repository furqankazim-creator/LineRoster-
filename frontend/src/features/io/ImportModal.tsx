import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';

import { useStore } from '@/app/store';
import { codeVars } from '@/app/tones';
import { Button, Modal, Select, Switch, cx } from '@/components/ui';
import { codeKey, db, newId, patchSettings } from '@/data/db';
import { MONTH_NAMES, WEEKDAY_LABELS, parseSheetMeta } from '@/domain/calendar';
import { rosterId } from '@/domain/generator';
import { OFF } from '@/domain/types';
import type { ImportResult } from '@/io/importXlsx';

/** The xlsx parser is ~900 kB, so it loads on first use rather than at startup. */
const loadImporter = () => import('@/io/importXlsx');

type Stage = 'pick-file' | 'pick-sheet' | 'review';

function formatDate(ts?: number): string {
  if (!ts) return 'previously';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Excel import with single-sheet isolation, newest-month sorting, duplicate protection,
 * and review step.
 *
 * Only the chosen sheet is parsed and loaded. Sheets previously imported are hidden by
 * default to avoid clutter and prevent accidental re-imports.
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

  const storedLayouts = useLiveQuery(() => db.layouts.toArray(), [], []) ?? [];
  const storedRosters = useLiveQuery(() => db.rosters.toArray(), [], []) ?? [];

  const [stage, setStage] = useState<Stage>('pick-file');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [allWorkbookSheets, setAllWorkbookSheets] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [targetLine, setTargetLine] = useState(settings.activeLineId);
  const [replace, setReplace] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImportedSheets, setShowImportedSheets] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    sheetName: string;
    importedAt?: number;
  } | null>(null);
  const [isReimport, setIsReimport] = useState(false);

  const codeById = new Map(codes.map((c) => [c.id, c]));

  const reset = () => {
    setStage('pick-file');
    setBuffer(null);
    setFileName('');
    setSheets([]);
    setAllWorkbookSheets([]);
    setResult(null);
    setError(null);
    setShowImportedSheets(false);
    setDuplicateWarning(null);
    setIsReimport(false);
  };

  // Inspect each sheet in the workbook to detect month, line, and import status
  const sheetsInfo = useMemo(() => {
    return sheets.map((name) => {
      const meta = parseSheetMeta(name);

      // Check whether this sheet was previously imported:
      // 1. Direct record in settings.importedSheets
      const record = settings.importedSheets?.[name];

      // 2. Matching layout in Dexie
      const matchingLayout = storedLayouts.find((l) => l.layout.sheetName === name);
      const layoutRoster = matchingLayout
        ? storedRosters.find((r) => r.id === matchingLayout.rosterId)
        : undefined;

      // 3. Line & Month match in rosters
      let matchedRoster = layoutRoster;
      const matchedLine = lines.find(
        (l) =>
          (meta.lineName && l.name.toLowerCase() === meta.lineName.toLowerCase()) ||
          (meta.lineName?.includes('4') &&
            meta.lineName?.includes('6') &&
            l.name.includes('4') &&
            l.name.includes('6')) ||
          (meta.lineName && l.name.toLowerCase().includes(meta.lineName.toLowerCase())),
      );

      if (!matchedRoster && meta.year && meta.month && matchedLine) {
        matchedRoster = storedRosters.find((r) => r.id === `${matchedLine.id}:${meta.year}-${meta.month}`);
      }

      const isImported = Boolean(record || matchingLayout || matchedRoster);
      const importedAt = record?.importedAt ?? matchedRoster?.updatedAt;

      // Score for sorting newest first: year * 100 + month
      const score = (meta.year ?? 0) * 100 + (meta.month ?? 0);

      return {
        name,
        meta,
        matchedLine,
        isImported,
        importedAt,
        score,
      };
    });
  }, [sheets, settings.importedSheets, storedLayouts, storedRosters, lines]);

  // Sort newest month first
  const sortedSheets = useMemo(() => {
    return [...sheetsInfo].sort((a, b) => {
      // 1. Primary: Year and Month descending (newest month first)
      if (b.score !== a.score) return b.score - a.score;
      // 2. Un-imported sheets before imported sheets if same month
      if (a.isImported !== b.isImported) return a.isImported ? 1 : -1;
      // 3. Alphabetical tie-breaker
      return a.name.localeCompare(b.name);
    });
  }, [sheetsInfo]);

  const importedCount = useMemo(() => {
    return sortedSheets.filter((s) => s.isImported).length;
  }, [sortedSheets]);

  const visibleSheets = useMemo(() => {
    if (showImportedSheets) return sortedSheets;
    return sortedSheets.filter((s) => !s.isImported);
  }, [sortedSheets, showImportedSheets]);

  const onFile = async (file: File) => {
    try {
      setError(null);
      setFileName(file.name);
      const buf = await file.arrayBuffer();
      const { listSheets } = await loadImporter();
      const names = listSheets(buf);
      setBuffer(buf);
      setAllWorkbookSheets(names);
      setShowImportedSheets(false);
      setDuplicateWarning(null);
      setIsReimport(false);

      if (names.length === 0) {
        throw new Error('No sheets found in this file.');
      }

      // Automatically determine the single sheet to open and remove all other sheets
      const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const baseFileName = file.name.replace(/\.[^/.]+$/, '').trim();
      const normBase = clean(baseFileName);

      // 1. Exact match with file name (without extension)
      let targetSheet = names.find((n) => clean(n) === normBase);

      // 2. Partial match with file name
      if (!targetSheet && normBase.length > 3) {
        targetSheet = names.find((n) => {
          const c = clean(n);
          return c.includes(normBase) || normBase.includes(c);
        });
      }

      // 3. Newest month matching active line
      if (!targetSheet) {
        const activeLineObj = lines.find((l) => l.id === targetLine || l.id === settings.activeLineId);
        const activeName = activeLineObj?.name.toLowerCase() ?? '';
        const isLine46 = activeName.includes('4') && activeName.includes('6');

        const scored = names.map((name) => {
          const meta = parseSheetMeta(name);
          const score = (meta.year ?? 0) * 100 + (meta.month ?? 0);
          const lineMatch = meta.lineName
            ? (isLine46 && meta.lineName.includes('4') && meta.lineName.includes('6')) ||
              meta.lineName.toLowerCase() === activeName
            : false;
          return { name, score, lineMatch };
        });

        const lineMatches = scored.filter((s) => s.lineMatch).sort((a, b) => b.score - a.score);
        if (lineMatches.length > 0) {
          targetSheet = lineMatches[0].name;
        } else {
          // 4. Otherwise, latest/newest month sheet in the workbook
          scored.sort((a, b) => b.score - a.score);
          targetSheet = scored[0]?.name;
        }
      }

      targetSheet = targetSheet || names[0];

      // Remove all other sheets so only the chosen file/sheet is open
      setSheets([targetSheet]);
      await selectSheet(buf, targetSheet);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const selectSheet = async (buf: ArrayBuffer, sheetName: string, reimporting = false) => {
    try {
      setError(null);
      setDuplicateWarning(null);
      setIsReimport(reimporting);

      // Auto-target line matching sheet name
      const meta = parseSheetMeta(sheetName);
      if (meta.lineName) {
        const matched = lines.find(
          (l) =>
            l.name.toLowerCase() === meta.lineName?.toLowerCase() ||
            (meta.lineName?.includes('4') &&
              meta.lineName?.includes('6') &&
              l.name.includes('4') &&
              l.name.includes('6')) ||
            (meta.lineName && l.name.toLowerCase().includes(meta.lineName.toLowerCase())),
        );
        if (matched) {
          setTargetLine(matched.id);
        }
      }

      const { importSheet } = await loadImporter();
      const res = importSheet(buf, sheetName);
      setResult(res);

      if (res.lineName) {
        const matched = lines.find(
          (l) =>
            l.name.toLowerCase() === res.lineName?.toLowerCase() ||
            (res.lineName?.includes('4') &&
              res.lineName?.includes('6') &&
              l.name.includes('4') &&
              l.name.includes('6')),
        );
        if (matched) {
          setTargetLine(matched.id);
        }
      }

      setStage('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that sheet.');
    }
  };

  const handleSheetClick = (sheet: (typeof sortedSheets)[0]) => {
    if (sheet.isImported) {
      setDuplicateWarning({ sheetName: sheet.name, importedAt: sheet.importedAt });
    } else if (buffer) {
      // Keep only this chosen sheet so others are removed
      setSheets([sheet.name]);
      void selectSheet(buffer, sheet.name, false);
    }
  };

  /**
   * Smart defaults for a shift code that appears in the imported Excel but
   * doesn't yet exist in the app. The tone/label/timing are inferred from
   * the code's first letter(s) so the code shows up with the right colour
   * straight away — the user can fine-tune timings in Setup → Shift codes.
   */
  const guessShiftCode = (id: string, existingCount: number, legendLabel?: string) => {
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

    // The sheet's own key wins over guesses: leave / sick / training are statuses, not shifts.
    if (legendLabel) {
      const label = legendLabel.trim();
      const isStatus = /leave|sick|training|\bofficial\b|holiday/i.test(label);
      const base = KNOWN_LABELS[up];
      const tone: Tone = isStatus
        ? 'leave'
        : base?.tone ?? (/^M/.test(up) ? 'morning' : /^E/.test(up) ? 'evening' : /^N/.test(up) ? 'night' : /^P/.test(up) ? 'project' : 'general');
      return {
        id: up,
        label,
        timing: isStatus ? '' : base?.timing ?? '',
        tone,
        minHeadcount: 0,
        countsAsEngineer: !isStatus,
        rotates: false,
        ...(isStatus ? { isStatus: true } : {}),
        order: 500 + existingCount,
      };
    }

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
    const { toRecords, overridesForImport } = await loadImporter();
    const { employees, leave } = toRecords(result, targetLine, () => newId('e'));
    // Pin every cell the inferred rules can't reproduce so the grid matches the sheet.
    const overrides = overridesForImport(result, employees, leave, targetLine);

    // ---- collect every shift code used by the imported employees ----------
    const usedCodes = new Set<string>();
    for (const emp of result.employees) {
      for (const code of emp.codes) {
        if (code && code !== '-' && code !== OFF) usedCodes.add(code);
      }
    }

    // ---- find which codes are missing from the current setup --------------
    const rid = rosterId(targetLine, result.year, result.month);
    const lineCodeIds = new Set(
      allCodes.filter((c) => c.scope === targetLine).map((c) => c.id),
    );
    const toCreate = [...usedCodes]
      .filter((id) => !lineCodeIds.has(id))
      .map((id, i) => ({ ...guessShiftCode(id, lineCodeIds.size + i, result.legend?.[id]), scope: targetLine }));

    // ---- write everything in one transaction ------------------------------
    await db.transaction(
      'rw',
      [db.employees, db.leave, db.rosters, db.shiftCodes, db.layouts, db.settings],
      async () => {
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
        // Store the sheet's exact cells as overrides; the grid rebuilds from rules + these.
        const prior = replace ? undefined : await db.rosters.get(rid);
        await db.rosters.put({
          id: rid,
          lineId: targetLine,
          year: result.year,
          month: result.month,
          cells: {},
          overrides: { ...(prior?.overrides ?? {}), ...overrides },
          extraHours: prior?.extraHours ?? {},
          updatedAt: Date.now(),
        });
        // Remember the source file's shape so Export can hand it back the same way.
        await db.layouts.put({ rosterId: rid, layout: result.layout });
      },
    );

    // Save record of imported sheet into settings
    const updatedImported = {
      ...(settings.importedSheets ?? {}),
      [result.sheetName]: {
        sheetName: result.sheetName,
        lineId: targetLine,
        year: result.year,
        month: result.month,
        importedAt: Date.now(),
        fileName: fileName || undefined,
        employeeCount: employees.length,
      },
    };
    await patchSettings({
      importedSheets: updatedImported,
      activeLineId: targetLine,
      activeYear: result.year,
      activeMonth: result.month,
      lineMonths: { ...(settings.lineMonths ?? {}), [targetLine]: { year: result.year, month: result.month } },
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
      width={680}
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
            <span className="font-mono text-ink-2">SLV_Line 4&6_Roster_SEP_2026</span>). Detects employee names,
            shift schedules, rotations, and leave automatically.
          </p>
        </div>
      )}

      {stage === 'pick-sheet' && buffer && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1.5 border-b border-[var(--line)]">
            <div>
              <p className="text-[13px] font-semibold text-ink">Choose a roster sheet to import</p>
              <p className="text-[11.5px] text-ink-3">
                Showing newest months first. Only the selected sheet will be imported.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {visibleSheets.length > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const topSheet = visibleSheets[0]?.name;
                    if (topSheet) {
                      setSheets([topSheet]);
                    }
                  }}
                  className="text-[11px] h-7 px-2 text-[var(--danger)] hover:bg-[var(--danger)]/10 border-[var(--line)]"
                  title="Remove all other sheets and keep only the top / selected sheet"
                >
                  Remove other sheets
                </Button>
              )}
              {allWorkbookSheets.length > sheets.length && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSheets(allWorkbookSheets)}
                  className="text-[11px] h-7 px-2 text-ink-2"
                  title="Show all sheets from the uploaded file"
                >
                  Restore all ({allWorkbookSheets.length})
                </Button>
              )}
              {importedCount > 0 && (
                <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] text-ink-2">
                  <Switch
                    checked={showImportedSheets}
                    onChange={setShowImportedSheets}
                    label={`Show previously imported (${importedCount})`}
                  />
                </label>
              )}
            </div>
          </div>

          {duplicateWarning && (
            <div className="rounded-xl border border-[var(--warn)] bg-[var(--surface-3)] p-3.5 flex flex-col gap-2.5 shadow-md animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <span className="text-[16px] leading-tight">⚠️</span>
                <div>
                  <div className="text-[12.5px] font-semibold text-ink">
                    This sheet was imported on {formatDate(duplicateWarning.importedAt)}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-2 leading-relaxed">
                    Importing <span className="font-mono font-bold text-ink">{duplicateWarning.sheetName}</span> again will replace the active roster records for this line and month. Import again?
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setDuplicateWarning(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (buffer) {
                      setSheets([duplicateWarning.sheetName]);
                      void selectSheet(buffer, duplicateWarning.sheetName, true);
                    }
                  }}
                >
                  Yes, import again
                </Button>
              </div>
            </div>
          )}

          {visibleSheets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-6 text-center">
              <p className="text-[13px] font-medium text-ink">No sheets visible in this list</p>
              <p className="mt-1 text-[11.5px] text-ink-3">
                Sheets were removed or previously imported.
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                {allWorkbookSheets.length > 0 && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setSheets(allWorkbookSheets)}
                  >
                    Restore all sheets ({allWorkbookSheets.length})
                  </Button>
                )}
                {importedCount > 0 && !showImportedSheets && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowImportedSheets(true)}
                  >
                    Show previously imported sheets ({importedCount})
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto pr-1">
              {visibleSheets.map((sheet, index) => {
                const isLatest = index === 0 && !sheet.isImported;
                return (
                  <button
                    key={sheet.name}
                    onClick={() => handleSheetClick(sheet)}
                    className={cx(
                      'group relative flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all',
                      sheet.isImported
                        ? 'border-[var(--line)] bg-[var(--surface)] opacity-70 hover:opacity-100 hover:border-[var(--accent)] hover:bg-[var(--surface-2)]'
                        : isLatest
                        ? 'border-[var(--accent)] bg-[var(--surface-2)] shadow-xs hover:border-[var(--accent)] hover:brightness-105'
                        : 'border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--accent)] hover:bg-[var(--surface-3)]',
                    )}
                  >
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{sheet.name}</span>
                        {isLatest && (
                          <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-[var(--accent-ink)] uppercase tracking-wide">
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                        {sheet.meta.month && sheet.meta.year && (
                          <span className="font-medium text-ink-2">
                            {MONTH_NAMES[sheet.meta.month - 1]} {sheet.meta.year}
                          </span>
                        )}
                        {sheet.meta.lineName && (
                          <>
                            <span>·</span>
                            <span className="font-medium text-ink-2">{sheet.meta.lineName}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {sheet.isImported ? (
                        <span className="rounded-md border border-[var(--line)] bg-[var(--surface-3)] px-2 py-1 text-[11px] font-medium text-ink-3">
                          Already imported · {formatDate(sheet.importedAt)}
                        </span>
                      ) : (
                        <span className="rounded-md bg-[var(--surface-3)] px-2 py-1 text-[11px] font-semibold text-ink-2 group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-ink)] transition-colors">
                          Select sheet ›
                        </span>
                      )}
                      <button
                        type="button"
                        title={`Remove "${sheet.name}" from import list`}
                        aria-label={`Remove sheet ${sheet.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSheets((prev) => prev.filter((s) => s !== sheet.name));
                        }}
                        className="rounded-md p-1.5 text-ink-3 hover:text-[var(--danger)] hover:bg-[var(--surface-3)] transition-colors"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
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

          {isReimport && (
            <div className="rounded-lg border border-[var(--warn)] bg-[var(--surface-3)] px-3 py-2 text-[12px] text-ink-2">
              ⚠️ <strong>Re-import:</strong> This sheet was previously imported. Confirming will update records for {MONTH_NAMES[result.month - 1]} {result.year}.
            </div>
          )}

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
              What was understood from this sheet
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
