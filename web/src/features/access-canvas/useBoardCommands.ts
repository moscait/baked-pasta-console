import { Dispatch, SetStateAction, useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { AcEndpoint, AcKind, AcLayout, AcModel, AcOp, KIND_LABEL, clone, entitiesOf } from './access-canvas.logic';
import {
  BoardNode,
  Clip,
  ClipItem,
  IntentResult,
  freeKey,
  moveMember,
  pasteAsNew,
  pasteIntoGroup,
  pasteOntoEntities,
  removeFromGroups,
} from './canvas-board.logic';
import type { BoardCommand, MemberDrop, NodeDrop, SelItem } from './CanvasBoard';
import { DrawerKind, ENTITY_ROUTE, POLICY_ROUTE, ToastFn } from './canvas-page.shared';

export interface NewGroupDraft {
  kind: AcKind;
  attr: string;
  at: { x: number; y: number };
}

/**
 * Turns board gestures (drops, clipboard, keyboard and context-menu commands) into queued
 * change sets, layout edits, or dialogs.
 */
export function useBoardCommands(opts: {
  draft: AcModel | null;
  boardNodes: BoardNode[];
  layoutDraft: AcLayout;
  saveLayout: (layout: AcLayout) => void;
  clip: Clip | null;
  setClip: Dispatch<SetStateAction<Clip | null>>;
  newId: () => string;
  queueIntent: (r: IntentResult) => boolean;
  undoLastPending: () => void;
  openGrant: (src: AcEndpoint, tgt: AcEndpoint | null) => void;
  autoArrange: () => void;
  setNewGroup: (g: NewGroupDraft) => void;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  showAdvisorFor: (kind: AcKind, id: string) => void;
  setDrawer: (d: DrawerKind) => void;
  navigate: NavigateFunction;
  onToast: ToastFn;
}) {
  const {
    draft,
    boardNodes,
    layoutDraft,
    saveLayout,
    clip,
    setClip,
    newId,
    queueIntent,
    undoLastPending,
    openGrant,
    autoArrange,
    setNewGroup,
    setExpanded,
    showAdvisorFor,
    setDrawer,
    navigate,
    onToast,
  } = opts;

  const handleMemberDrop = useCallback(
    (ev: MemberDrop) => {
      if (!draft) return;
      const it = ev.item;
      const t = ev.target;
      const ent = { kind: it.kind!, id: it.id!, name: it.name || '' };
      if (t.type === 'empty') {
        if (it.type === 'member') queueIntent(moveMember(draft, ent, it.attr, null, false));
        return;
      }
      if (it.kind === 'identity' && t.kind === 'service') {
        openGrant(
          { kind: 'identity', id: it.id },
          t.type === 'group' ? { kind: 'group', attr: t.attr } : { kind: 'service', id: t.id },
        );
        return;
      }
      if (t.kind !== it.kind) {
        onToast(
          'warning',
          "Can't drop there",
          `Drop ${KIND_LABEL[it.kind!][1]} into an ${KIND_LABEL[it.kind!][0]} group${
            it.kind === 'identity' ? ', or onto a service to give access' : ''
          }.`,
        );
        return;
      }
      if (t.type === 'group' || t.type === 'member') {
        queueIntent(moveMember(draft, ent, it.type === 'member' ? it.attr : undefined, t.attr, ev.copy));
      } else {
        onToast(
          'info',
          'Drop into a group',
          'To give it the same access, copy it (⌘C), select the other card and paste (⌘V).',
        );
      }
    },
    [draft, queueIntent, openGrant, onToast],
  );

  const handleNodeDrop = useCallback(
    (ev: NodeDrop) => {
      const it = ev.item;
      const t = ev.target;
      if (t.type === 'empty' || it.kind !== 'identity' || t.kind !== 'service') return;
      const src: AcEndpoint = it.type === 'group' ? { kind: 'group', attr: it.attr } : { kind: 'identity', id: it.id };
      const tgt: AcEndpoint = t.type === 'group' ? { kind: 'group', attr: t.attr } : { kind: 'service', id: t.id };
      openGrant(src, tgt);
    },
    [openGrant],
  );

  const clipItems = useCallback(
    (items: SelItem[]): ClipItem[] => {
      if (!draft) return [];
      const out: ClipItem[] = [];
      const add = (kind: AcKind, id: string, fromAttr?: string) => {
        const e = entitiesOf(draft, kind).find((x) => x.id === id);
        if (e && !out.some((o) => o.kind === kind && o.id === id && o.fromAttr === fromAttr)) {
          out.push({ kind, id, name: e.name, attrs: [...e.attrs], fromAttr });
        }
      };
      for (const it of items) {
        if (it.type === 'member') add(it.kind!, it.id!, it.attr);
        else if (it.type === 'free') add(it.kind!, it.id!);
        else if (it.type === 'group') {
          const n = boardNodes.find((x) => x.key === it.node);
          n?.members.forEach((x) => add(it.kind!, x.id, it.attr));
        }
      }
      return out;
    },
    [draft, boardNodes],
  );

  const paste = useCallback(
    (items: SelItem[], at: { x: number; y: number }) => {
      if (!draft) return;
      if (!clip) {
        onToast('info', 'Clipboard is empty', 'Copy (⌘C) or cut (⌘X) something first.');
        return;
      }
      const groupsSel = items.filter((t) => t.type === 'group');
      const entities = items.filter((t) => t.type === 'member' || t.type === 'free');
      let res: IntentResult;
      const nextLayout = clone(layoutDraft);
      if (groupsSel.length) {
        const ops: AcOp[] = [];
        let first: IntentResult | null = null;
        for (const g of groupsSel) {
          const r = pasteIntoGroup(draft, clip, g.kind!, g.attr!);
          if ('error' in r) {
            first = first || r;
            continue;
          }
          first = first && !('error' in first) ? first : r;
          ops.push(...r.ops);
        }
        res = ops.length && first && !('error' in first) ? { ...first, ops } : first || { error: 'Nothing to paste.' };
      } else if (entities.length) {
        res = pasteOntoEntities(
          draft,
          clip,
          entities.map((e) => ({ kind: e.kind!, id: e.id! })),
        );
      } else {
        const r = pasteAsNew(draft, clip, newId);
        if (!('error' in r)) {
          // New cards without attributes are free cards; stack them where the paste happened.
          let dy = 0;
          for (const cr of r.created || []) {
            const op = r.ops.find(
              (o) =>
                (o.op === 'createIdentity' && o.identity.id === cr.id) ||
                (o.op === 'createService' && o.service.id === cr.id),
            );
            const attrs =
              op?.op === 'createIdentity' ? op.identity.attrs : op?.op === 'createService' ? op.service.attrs : [];
            if (!attrs.length) {
              nextLayout.nodes[freeKey(cr.kind, cr.id)] = { x: Math.round(at.x), y: Math.round(at.y + dy) };
              dy += 50;
            }
          }
        }
        res = r;
      }
      if (queueIntent(res) && clip.mode === 'cut') setClip(null);
      saveLayout(nextLayout);
    },
    [draft, clip, layoutDraft, newId, queueIntent, setClip, saveLayout, onToast],
  );

  const removeSelected = useCallback(
    (items: SelItem[]) => {
      if (!draft) return;
      const members = items
        .filter((i) => i.type === 'member')
        .map((i) => ({ kind: i.kind!, id: i.id!, name: i.name || '', attr: i.attr! }));
      if (members.length) {
        queueIntent(removeFromGroups(draft, members));
        return;
      }
      // Empty groups that exist only in the browser layout can simply be dropped.
      const emptyNew = items.filter(
        (i) =>
          i.type === 'group' &&
          (layoutDraft.groups || []).includes(`${i.kind}:${i.attr}`) &&
          !boardNodes.find((n) => n.key === i.node)?.members.length,
      );
      if (emptyNew.length) {
        const next = clone(layoutDraft);
        next.groups = (next.groups || []).filter((g) => !emptyNew.some((i) => g === `${i.kind}:${i.attr}`));
        emptyNew.forEach((i) => delete next.nodes[i.node]);
        saveLayout(next);
        return;
      }
      onToast(
        'info',
        'Nothing removed',
        'Delete takes selected cards out of their group. Identities and services are never deleted here.',
      );
    },
    [draft, layoutDraft, boardNodes, queueIntent, saveLayout, onToast],
  );

  const handleCommand = useCallback(
    (c: BoardCommand) => {
      if (!draft) return;
      if (c.cmd === 'copy' || c.cmd === 'cut') {
        const ci = clipItems(c.items);
        if (!ci.length) {
          onToast('info', `Nothing to ${c.cmd}`, 'Select identities, services or routers (or a group) first.');
          return;
        }
        setClip({ mode: c.cmd, items: ci });
        onToast(
          'info',
          `${c.cmd === 'cut' ? 'Cut' : 'Copied'} ${ci.length === 1 ? ci[0].name : `${ci.length} items`}`,
          'Paste into a group, onto another card (same access), or on empty canvas (a new copy).',
        );
      } else if (c.cmd === 'paste') {
        paste(c.items, c.at);
      } else if (c.cmd === 'delete') {
        removeSelected(c.items);
      } else if (c.cmd === 'give') {
        const i = c.items.find((x) => x.kind === 'identity');
        if (i) openGrant(i.type === 'group' ? { kind: 'group', attr: i.attr } : { kind: 'identity', id: i.id }, null);
      } else if (c.cmd === 'advise') {
        const it = c.items[0];
        if (!it || !it.id) return;
        if (it.kind) showAdvisorFor(it.kind, it.id);
        setDrawer('advisor');
      } else if (c.cmd === 'open') {
        const it = c.items[0];
        if (!it) return;
        if (it.id?.startsWith('new-') || it.policy?.startsWith('new-')) {
          onToast('info', 'Not created yet', 'Apply pending changes first.');
          return;
        }
        if (it.type === 'hub') {
          navigate(POLICY_ROUTE[it.node.split(':')[1]] || '/service-policies');
        } else if (it.kind) {
          navigate(ENTITY_ROUTE[it.kind]);
        }
      } else if (c.cmd === 'undo') {
        undoLastPending();
      } else if (c.cmd === 'arrange') {
        autoArrange();
      } else if (c.cmd === 'newGroup') {
        setNewGroup({ kind: 'identity', attr: '', at: c.at });
      } else if (c.cmd === 'expand') {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(c.node)) next.delete(c.node);
          else next.add(c.node);
          return next;
        });
      }
    },
    [
      draft,
      clipItems,
      paste,
      removeSelected,
      setClip,
      openGrant,
      showAdvisorFor,
      setDrawer,
      navigate,
      undoLastPending,
      autoArrange,
      setNewGroup,
      setExpanded,
      onToast,
    ],
  );

  return { handleMemberDrop, handleNodeDrop, handleCommand };
}
