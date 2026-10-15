import { useLiveQuery } from 'dexie-react-hooks';

import { useStore } from '@/app/store';
import { Button, Modal, useToast } from '@/components/ui';
import { db, exportBackup } from '@/data/db';
import { monthLabel } from '@/domain/calendar';
import { rosterId } from '@/domain/generator';


export function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { roster, employees, codes, lines, settings } = useStore();
  const toast = useToast();

  const line = lines.find((l) => l.id === settings.activeLineId);

  // The shape of the workbook this month was imported from, if it was.
  const stored = useLiveQuery(
    () => (roster ? db.layouts.get(rosterId(roster.lineId, roster.year, roster.month)) : undefined),
    [roster?.lineId, roster?.year, roster?.month],
  );

  const options = [
    ...(stored
      ? [{
          key: 'original',
          title: `Original imported format (${stored.layout.sheetName})`,
          body: 'Writes this month back into the workbook you imported — same title, same header position, your own extra columns kept, day headers spelled the same way. Only the shift letters are updated, and an OT or Total Hours column of yours is refilled from the roster.',
          action: async () => {
            if (!roster) return;
            const { downloadFromLayout } = await import('@/io/exportXlsx');
            const filename = downloadFromLayout({ roster, employees, codes, standardHours: settings.standardHours }, stored.layout);
            toast(`Saved ${filename}`, 'ok');
            onClose();
          },
        }]
      : []),
    {
      key: 'operational',
      title: 'Operational roster layout',
      body: 'Sections by role and shift (PIC Morning, MP Night…), date headers, verbose shift timings, Total Hours and Total OT per person, and count rows.',
      action: async () => {
        if (!roster || !line) return;
        const { downloadOperationalXlsx } = await import('@/io/exportXlsx');
        const filename = downloadOperationalXlsx({ roster, employees, codes, line, standardHours: settings.standardHours });
        toast(`Saved ${filename}`, 'ok');
        onClose();
      },
    },
    {
      key: 'xlsx',
      title: 'Standard Excel workbook',
      body: 'Your layout, with colour-filled shift codes and live COUNTIF headcount rows, plus Hours and OT per person — the file you send to management.',
      action: async () => {
        if (!roster || !line) return;
        // The workbook writer is large; pull it in only when exporting.
        const { downloadXlsx } = await import('@/io/exportXlsx');
        const filename = downloadXlsx({ roster, employees, codes, line, standardHours: settings.standardHours });
        toast(`Saved ${filename}`, 'ok');
        onClose();
      },
    },
    {
      key: 'print',
      title: 'Print / PDF',
      body: 'Opens the browser print dialog on the roster grid. Choose A3 landscape and "Save as PDF" for a wall sheet.',
      action: () => {
        onClose();
        setTimeout(() => window.print(), 120);
      },
    },
    {
      key: 'backup',
      title: 'Full backup (JSON)',
      body: 'Everything — all lines, people, rotation rules, leave and saved months. Restore it from Setup.',
      action: async () => {
        const json = await exportBackup();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shiftline-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Backup saved.', 'ok');
        onClose();
      },
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={480}
      title="Export"
      description={
        roster ? `${line?.name ?? 'Roster'} · ${monthLabel(roster.year, roster.month)}` : undefined
      }
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={o.action}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3 text-left hover:border-[var(--accent)] transition-colors"
          >
            <div className="text-[13px] font-medium">{o.title}</div>
            <div className="mt-0.5 text-[11.5px] text-ink-3 leading-relaxed">{o.body}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
