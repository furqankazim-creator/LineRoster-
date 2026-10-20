import { useEffect, useState } from 'react';

import { useStore } from '@/app/store';
import { useViewport } from '@/app/useViewport';
import { Button, Modal, useToast } from '@/components/ui';
import { InsightsDrawer } from '@/features/insights/InsightsDrawer';
import { ImportModal } from '@/features/io/ImportModal';
import { ExportModal } from '@/features/io/ExportModal';

import { GenerateModal } from './GenerateModal';
import { RosterGrid, type JumpTarget } from './RosterGrid';
import { RotateModal } from './RotateModal';
import { Toolbar } from './Toolbar';

export function PlannerPage() {
  const { undo, redo, saveRoster, clearLineRoster, lines, settings, employees } = useStore();
  const toast = useToast();

  const [brush, setBrush] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState(0);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const viewport = useViewport();
  const [insightsOpen, setInsightsOpen] = useState(() => viewport === 'desktop');
  const [jumpTo, setJumpTo] = useState<JumpTarget | null>(null);

  const activeLine = lines.find((l) => l.id === settings.activeLineId);

  // Close Insights drawer when viewing the initial "Import Roster to Get Started" screen (0 employees)
  useEffect(() => {
    if (employees.length === 0 && insightsOpen) {
      setInsightsOpen(false);
    }
  }, [employees.length, insightsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRoster()
          .then(() => toast('Backup saved.', 'ok'))
          .catch((err) => toast(err instanceof Error ? err.message : 'Save failed.', 'error'));
      }
      if (e.key === 'Escape') setBrush(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveRoster, toast]);

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex flex-1 min-w-0 flex-col">
        <Toolbar
          brush={brush}
          setBrush={setBrush}
          onGenerate={() => setGenerateOpen(true)}
          onRotate={() => setRotateOpen(true)}
          onImport={() => setImportOpen(true)}
          onExport={() => setExportOpen(true)}
          onReturnToImport={() => setShowClearModal(true)}
          insightsOpen={insightsOpen}
          toggleInsights={() => setInsightsOpen((v) => !v)}
        />
        <RosterGrid
          brush={brush}
          revealKey={revealKey}
          jumpTo={jumpTo}
          onOpenImport={() => setImportOpen(true)}
        />
      </div>

      <InsightsDrawer
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        onJump={(employeeId, dayIndex) => setJumpTo({ employeeId, dayIndex, nonce: Date.now() })}
      />

      <GenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onDone={() => setRevealKey((k) => k + 1)}
      />
      <RotateModal open={rotateOpen} onClose={() => setRotateOpen(false)} />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={(n) => {
          toast(`Imported ${n} people from Excel. Auto-saved!`, 'ok');
          setRevealKey((k) => k + 1);
        }}
      />
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />

      {/* Return to Import Screen Confirmation Modal */}
      {showClearModal && (
        <Modal
          open={showClearModal}
          onClose={() => setShowClearModal(false)}
          title="Return to Import Screen"
        >
          <div className="flex flex-col gap-4 text-ink">
            <p className="text-[13.5px] text-ink-2 leading-relaxed">
              Are you sure you want to return to the initial roster import screen for{' '}
              <strong className="text-ink font-semibold">{activeLine?.name || 'this line'}</strong>?
              This will clear the currently loaded roster for this line so you can upload a new Excel file from scratch.
              Other lines will not be affected.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowClearModal(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="font-bold shadow-sm"
                onClick={async () => {
                  await clearLineRoster(settings.activeLineId);
                  setShowClearModal(false);
                  setRevealKey((k) => k + 1);
                  toast(`Returned to initial import screen for ${activeLine?.name || 'this line'}.`, 'ok');
                }}
              >
                Yes, Back to Import Screen
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
