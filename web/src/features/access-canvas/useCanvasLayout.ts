import { RefObject, useCallback, useState } from 'react';
import { zitiService } from '../../services/ziti-service';
import { AcLayout, AcModel, clone } from './access-canvas.logic';
import { buildBoard, emptyLayout, marksFor } from './canvas-board.logic';
import { layoutFile, parseLayout } from './canvas-layout.store';
import type { CanvasBoardHandle } from './CanvasBoard';
import { ToastFn, plural, showEverything } from './canvas-page.shared';

/**
 * Card positions and empty groups: presentation only, kept in this browser per controller.
 * Never touches access policies.
 */
export function useCanvasLayout(opts: {
  draft: AcModel | null;
  committed: AcModel | null;
  expanded: Set<string>;
  boardRef: RefObject<CanvasBoardHandle | null>;
  onToast: ToastFn;
}) {
  const { draft, committed, expanded, boardRef, onToast } = opts;
  const [layoutDraft, setLayoutDraft] = useState<AcLayout>(() => zitiService.layoutStore().load() || emptyLayout());

  const saveLayout = useCallback((nextLayout: AcLayout) => {
    setLayoutDraft(nextLayout);
    zitiService.layoutStore().save(nextLayout);
  }, []);

  /** The saved layout plus the auto-placed position of every node that has none yet. */
  const positionsNow = useCallback((): AcLayout => {
    const out = clone(layoutDraft);
    if (!draft) return out;
    const all = buildBoard(draft, {
      layout: layoutDraft,
      marks: marksFor([]),
      expanded,
      filters: showEverything(),
    });
    for (const n of all.nodes) {
      if (!out.nodes[n.key]) out.nodes[n.key] = { x: n.x, y: n.y };
    }
    return out;
  }, [draft, layoutDraft, expanded]);

  const handleMoved = useCallback(
    (moves: { key: string; x: number; y: number }[]) => {
      if (!committed) return;
      let next = clone(layoutDraft);
      if (Object.keys(next.nodes).length === 0 || moves.some((mv) => !next.nodes[mv.key])) {
        next = positionsNow();
      }
      for (const mv of moves) next.nodes[mv.key] = { x: mv.x, y: mv.y };
      saveLayout(next);
    },
    [committed, layoutDraft, positionsNow, saveLayout],
  );

  const autoArrange = useCallback(() => {
    const next: AcLayout = { v: 1, nodes: {}, groups: [...(layoutDraft.groups || [])] };
    saveLayout(next);
    requestAnimationFrame(() => boardRef.current?.fit());
  }, [layoutDraft.groups, saveLayout, boardRef]);

  const exportLayout = () => {
    const controller = zitiService.controllerUrl();
    const json = JSON.stringify(layoutFile(positionsNow(), controller), null, 2);
    const host = (controller.replace(/^https?:\/\//, '').split(/[/:]/)[0] || 'controller').replace(
      /[^a-z0-9.-]/gi,
      '_',
    );
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `access-canvas-layout-${host}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importLayout = async (file: File) => {
    let data: unknown = null;
    try {
      data = JSON.parse(await file.text());
    } catch {
      // handled below
    }
    const parsed = parseLayout(data);
    if (!parsed) {
      onToast('warning', 'Not imported', "That file isn't an Access Canvas layout. Use a file made with Export layout.");
      return;
    }
    const known = new Set(Object.keys(positionsNow().nodes));
    const matched = Object.keys(parsed.nodes).filter((k) => known.has(k)).length;
    saveLayout(parsed);
    requestAnimationFrame(() => boardRef.current?.fit());
    onToast('success', 'Layout imported', `${plural(matched, 'item', 'items')} placed from ${file.name}.`);
  };

  return { layoutDraft, saveLayout, positionsNow, handleMoved, autoArrange, exportLayout, importLayout };
}
