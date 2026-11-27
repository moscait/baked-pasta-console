import { useCallback, useMemo, useState } from 'react';
import { revertsOf, zitiService } from '../../services/ziti-service';
import { AcModel, AcOp, applyOps, clone, describeCalls } from './access-canvas.logic';
import type { IntentResult } from './canvas-board.logic';
import { Applied, FollowUp, Pending, ToastFn, plural } from './canvas-page.shared';

/**
 * Staged changes: queue change sets, apply them in order (rolling back a failed set), and
 * undo the last applied set. Also derives the draft: the committed model with every
 * pending change set applied, which is what the canvas shows.
 */
export function useChangeSets(opts: {
  committed: AcModel | null;
  onToast: ToastFn;
  reload: () => Promise<void>;
  newChangeId: () => string;
  /** Called after apply when there are manual follow-up steps to show. */
  onFollowUps: () => void;
}) {
  const { committed, onToast, reload, newChangeId, onFollowUps } = opts;
  const [pending, setPending] = useState<Pending[]>([]);
  const [history, setHistory] = useState<Applied[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(false);

  const draft = useMemo(() => {
    if (!committed) return null;
    return pending.reduce((acc, c) => applyOps(acc, c.ops), clone(committed));
  }, [committed, pending]);

  const queueChange = useCallback(
    (title: string, summary: string, ops: AcOp[], next?: string[]) => {
      if (!draft) return;
      const set: Pending = {
        id: newChangeId(),
        title,
        summary,
        ops,
        calls: describeCalls(draft, ops),
        next,
      };
      setPending((prev) => [...prev, set]);
      setPulse(true);
      setTimeout(() => setPulse(false), 1500);
    },
    [draft, newChangeId],
  );

  const queueIntent = useCallback(
    (r: IntentResult): boolean => {
      if ('error' in r) {
        onToast('warning', 'Not changed', r.error);
        return false;
      }
      queueChange(r.title, r.summary, r.ops);
      return true;
    },
    [onToast, queueChange],
  );

  const discard = (id: string) => setPending((prev) => prev.filter((p) => p.id !== id));
  const discardAll = () => setPending([]);
  const dismissFollowUp = (idx: number) => setFollowUps((prev) => prev.filter((_, i) => i !== idx));

  /** Drops the most recently queued change set (canvas ⌘Z). */
  const undoLastPending = useCallback(() => {
    const last = pending[pending.length - 1];
    if (last) {
      setPending((prev) => prev.filter((p) => p.id !== last.id));
      onToast('info', 'Pending change removed', last.title);
    }
  }, [pending, onToast]);

  /**
   * Applies every pending change set in order. `onIdsAssigned` receives the server ids for
   * entities that had placeholder ids on the canvas, before the model reloads.
   */
  const applyAll = async (onIdsAssigned?: (idMap: Map<string, string>) => void) => {
    if (!draft || !pending.length || busy) return;
    setBusy(true);
    const sets = [...pending];
    const idMap = new Map<string, string>();
    let done = 0;
    const newHistory: Applied[] = [];
    const newFollowUps: FollowUp[] = [];
    const remaining = [...pending];

    try {
      for (const c of sets) {
        try {
          // Each write re-reads the controller's current state, so no model reload is needed
          // between change sets.
          const reverts = await zitiService.applyCanvasOps(c.ops, idMap);
          newHistory.push({ title: c.title, reverts });
          if (c.next?.length) newFollowUps.push({ title: c.title, steps: c.next });
          const idx = remaining.findIndex((p) => p.id === c.id);
          if (idx >= 0) remaining.splice(idx, 1);
          done++;
        } catch (err) {
          const failures = await zitiService.revertCanvasOps(revertsOf(err));
          if (failures.length) {
            onToast(
              'error',
              'Change partly applied',
              `${c.title}: ${zitiService.errorText(err)}. Rolling back also failed, so these steps remain on the controller: ${zitiService.describeRevertFailures(failures)}`,
            );
          } else {
            onToast(
              'error',
              'Change not applied',
              `${c.title}: ${zitiService.errorText(err)}. Nothing from this change set was kept.`,
            );
          }
          break;
        }
      }
      setPending(remaining);
      if (newHistory.length) setHistory((prev) => [...prev, ...newHistory]);
      if (newFollowUps.length) {
        setFollowUps((prev) => [...prev, ...newFollowUps]);
        onFollowUps();
      }
      if (idMap.size) onIdsAssigned?.(idMap);
      if (done) {
        onToast('success', 'Applied', `${plural(done, 'change set', 'change sets')} sent to the controller.`);
      }
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const undoLast = async () => {
    const last = history[history.length - 1];
    if (!last || busy) return;
    setBusy(true);
    try {
      const failures = await zitiService.revertCanvasOps(last.reverts);
      if (failures.length) {
        // Keep only the steps that still need undoing, so Undo can be retried.
        setHistory((prev) => [...prev.slice(0, -1), { ...last, reverts: failures.map((f) => f.revert) }]);
        onToast('error', 'Undo incomplete', zitiService.describeRevertFailures(failures));
      } else {
        setHistory((prev) => prev.slice(0, -1));
        onToast('success', 'Undone', last.title);
      }
    } finally {
      setBusy(false);
      await reload();
    }
  };

  return {
    draft,
    pending,
    history,
    followUps,
    busy,
    pulse,
    queueChange,
    queueIntent,
    discard,
    discardAll,
    dismissFollowUp,
    undoLastPending,
    applyAll,
    undoLast,
  };
}
