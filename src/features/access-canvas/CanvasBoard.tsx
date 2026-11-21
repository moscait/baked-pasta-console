import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AcKind } from './access-canvas.logic';
import { Board, BoardEdge, BoardMember, BoardNode, boardBounds, edgePath } from './canvas-board.logic';

export interface SelItem {
  type: 'group' | 'free' | 'hub' | 'member';
  node: string;
  kind?: AcKind;
  id?: string;
  name?: string;
  attr?: string;
  policy?: string;
}

export type DropTarget =
  | { type: 'group'; node: string; kind: AcKind; attr: string }
  | { type: 'member'; node: string; kind: AcKind; id: string; attr: string }
  | { type: 'free'; node: string; kind: AcKind; id: string }
  | { type: 'empty'; at: { x: number; y: number } };

export interface MemberDrop {
  item: SelItem;
  target: DropTarget;
  copy: boolean;
}

export interface NodeDrop {
  item: SelItem;
  target: DropTarget;
}

export type BoardCommand =
  | { cmd: 'copy' | 'cut' | 'delete' | 'give' | 'advise' | 'open' | 'select'; items: SelItem[] }
  | { cmd: 'paste'; items: SelItem[]; at: { x: number; y: number } }
  | { cmd: 'undo' | 'arrange' }
  | { cmd: 'newGroup'; at: { x: number; y: number } }
  | { cmd: 'expand'; node: string };

export interface CanvasBoardHandle {
  fit: () => void;
  reveal: (key: string, selectMemberKey?: string) => void;
}

interface CanvasBoardProps {
  board: Board;
  readOnly?: boolean;
  hasClip?: boolean;
  onMoved: (moves: { key: string; x: number; y: number }[]) => void;
  onMemberDrop: (ev: MemberDrop) => void;
  onNodeDrop: (ev: NodeDrop) => void;
  onCommand: (cmd: BoardCommand) => void;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean }
  | { kind: 'marquee'; sx: number; sy: number; x0: number; y0: number; moved: boolean }
  | {
      kind: 'nodes';
      sx: number;
      sy: number;
      start: Map<string, { x: number; y: number }>;
      primary: string;
      moved: boolean;
    }
  | { kind: 'member'; sx: number; sy: number; item: SelItem; moved: boolean; copy: boolean };

const memberKey = (node: string, id: string) => `m|${node}|${id}`;
const kindLetter = (k?: AcKind) => (k === 'service' ? 'S' : k === 'router' ? 'R' : 'I');
const famLabel = (n: BoardNode) =>
  ({ dial: 'Dial', bind: 'Bind', erp: 'Routers', serp: 'Svc routers' }[n.policy!.family]);

export const CanvasBoard = React.forwardRef<CanvasBoardHandle, CanvasBoardProps>(
  ({ board, readOnly = false, hasClip = false, onMoved, onMemberDrop, onNodeDrop, onCommand }, ref) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);

    const [tx, setTx] = useState(40);
    const [ty, setTy] = useState(40);
    const [z, setZ] = useState(1);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [hotNode, setHotNode] = useState<string | null>(null);
    const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [ghost, setGhost] = useState<{ x: number; y: number; label: string; copy: boolean } | null>(null);
    const [dropKey, setDropKey] = useState('');
    const [menu, setMenu] = useState<{
      x: number;
      y: number;
      at: { x: number; y: number };
      items: SelItem[];
    } | null>(null);
    const [dragOffsets, setDragOffsets] = useState<Map<string, { x: number; y: number }> | null>(null);

    const gestureRef = useRef<Gesture | null>(null);
    const lastWorldRef = useRef({ x: 200, y: 200 });
    const fittedRef = useRef(false);

    // Apply live drag position overrides to board nodes
    const liveNodes = useMemo(() => {
      if (!dragOffsets) return board.nodes;
      return board.nodes.map((n) => {
        const pos = dragOffsets.get(n.key);
        return pos ? { ...n, x: pos.x, y: pos.y } : n;
      });
    }, [board.nodes, dragOffsets]);

    const nodeMap = useMemo(() => new Map(liveNodes.map((n) => [n.key, n])), [liveNodes]);

    const { hotNodes, hotEdges } = useMemo(() => {
      const hn = new Set<string>();
      const he = new Set<string>();
      if (hotNode && !gestureRef.current) {
        const hubs = new Set<string>();
        for (const e of board.edges) {
          if (e.from.node === hotNode || e.to.node === hotNode) {
            hubs.add(e.from.node.startsWith('p:') ? e.from.node : e.to.node);
          }
        }
        if (hotNode.startsWith('p:')) hubs.add(hotNode);
        for (const e of board.edges) {
          if (hubs.has(e.from.node) || hubs.has(e.to.node)) {
            he.add(e.id);
            hn.add(e.from.node);
            hn.add(e.to.node);
          }
        }
      }
      return { hotNodes: hn, hotEdges: he };
    }, [hotNode, board.edges]);

    const paths = useMemo(() => {
      const edgeCls = (e: BoardEdge) =>
        ['ab-edge', e.family, e.pending ? 'pending' : '', e.byName ? 'byname' : '', hotEdges.has(e.id) ? 'hot' : '']
          .filter(Boolean)
          .join(' ');
      return board.edges
        .map((e) => ({ id: e.id, d: edgePath(nodeMap, e), cls: edgeCls(e) }))
        .filter((p) => p.d);
    }, [board.edges, nodeMap, hotEdges]);

    const toWorld = useCallback(
      (cx: number, cy: number) => {
        const r = viewportRef.current?.getBoundingClientRect();
        if (!r) return { x: 0, y: 0 };
        return { x: (cx - r.left - tx) / z, y: (cy - r.top - ty) / z };
      },
      [tx, ty, z],
    );

    const fit = useCallback(() => {
      const b = boardBounds(board.nodes);
      const r = viewportRef.current?.getBoundingClientRect();
      if (!b.w || !r || !r.width) return;
      const nextZ = Math.min(1.2, Math.max(0.15, Math.min((r.width - 60) / b.w, (r.height - 60) / b.h)));
      setZ(nextZ);
      setTx((r.width - b.w * nextZ) / 2 - b.x * nextZ);
      setTy((r.height - b.h * nextZ) / 2 - b.y * nextZ);
    }, [board.nodes]);

    const reveal = useCallback(
      (key: string, selectMemberKey?: string) => {
        const n = nodeMap.get(key);
        const r = viewportRef.current?.getBoundingClientRect();
        if (!n || !r) return;
        setTx(r.width / 2 - (n.x + n.w / 2) * z);
        setTy(r.height / 3 - n.y * z);
        setSelected(new Set([selectMemberKey || key]));
        setMenu(null);
      },
      [nodeMap, z],
    );

    useImperativeHandle(ref, () => ({ fit, reveal }), [fit, reveal]);

    useEffect(() => {
      if (!fittedRef.current && board.nodes.length) {
        fittedRef.current = true;
        requestAnimationFrame(() => fit());
      }
    }, [board.nodes.length, fit]);

    const zoomBy = useCallback(
      (factor: number, cx?: number, cy?: number) => {
        const r = viewportRef.current?.getBoundingClientRect();
        if (!r) return;
        const px = cx ?? r.left + r.width / 2;
        const py = cy ?? r.top + r.height / 2;
        const wx = (px - r.left - tx) / z;
        const wy = (py - r.top - ty) / z;
        const nextZ = Math.min(2.5, Math.max(0.15, z * factor));
        setZ(nextZ);
        setTx(px - r.left - wx * nextZ);
        setTy(py - r.top - wy * nextZ);
      },
      [tx, ty, z],
    );

    const resolveItem = useCallback(
      (key: string): SelItem | null => {
        if (key.startsWith('m|')) {
          const [, node, id] = key.split('|');
          const n = nodeMap.get(node);
          const m = n?.members.find((x) => x.id === id);
          return n && m ? { type: 'member', node, kind: n.kind, id, name: m.name, attr: n.attr } : null;
        }
        const n = nodeMap.get(key);
        if (!n) return null;
        if (n.type === 'group') return { type: 'group', node: key, kind: n.kind, attr: n.attr, name: '#' + n.attr };
        if (n.type === 'free') return { type: 'free', node: key, kind: n.kind, id: n.entity!.id, name: n.entity!.name };
        return { type: 'hub', node: key, policy: n.policy!.id, name: n.policy!.name };
      },
      [nodeMap],
    );

    const getSelectionItems = useCallback(
      (selSet: Set<string> = selected): SelItem[] =>
        [...selSet].map((k) => resolveItem(k)).filter(Boolean) as SelItem[],
      [selected, resolveItem],
    );

    const targetAt = useCallback(
      (cx: number, cy: number, ignore: Set<string>): DropTarget | null => {
        const els = document.elementsFromPoint(cx, cy) as HTMLElement[];
        for (const el of els) {
          const d = el.closest('[data-drop]') as HTMLElement | null;
          if (!d || !hostRef.current?.contains(d)) continue;
          const node = d.dataset['node']!;
          const n = nodeMap.get(node);
          if (!n || ignore.has(node)) continue;
          const id = d.dataset['member'];
          if (id && n.type === 'group') return { type: 'member', node, kind: n.kind!, id, attr: n.attr! };
          if (n.type === 'group') return { type: 'group', node, kind: n.kind!, attr: n.attr! };
          if (n.type === 'free') return { type: 'free', node, kind: n.kind!, id: n.entity!.id };
        }
        return els.some((el) => el === viewportRef.current || el.classList?.contains('ab-world'))
          ? { type: 'empty', at: toWorld(cx, cy) }
          : null;
      },
      [nodeMap, toWorld],
    );

    const grantTargetKey = useCallback(
      (cx: number, cy: number, primary: string): string => {
        const src = nodeMap.get(primary);
        if (!src || src.type === 'hub') return '';
        const t = targetAt(cx, cy, new Set([primary]));
        if (!t || t.type === 'empty') return '';
        const grant = src.kind === 'identity' && t.kind === 'service';
        const join = src.type === 'free' && t.type !== 'free' && t.kind === src.kind;
        if (!grant && !join) return '';
        return join ? t.node : t.type === 'member' ? memberKey(t.node, t.id) : t.node;
      },
      [nodeMap, targetAt],
    );

    const pickKey = (key: string, ev: React.PointerEvent | React.MouseEvent): Set<string> => {
      const multi = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      const next = new Set(selected);
      if (multi) {
        if (next.has(key)) next.delete(key);
        else next.add(key);
      } else if (!next.has(key)) {
        return new Set([key]);
      }
      return next;
    };

    const startPointerTracking = (ev: React.PointerEvent) => {
      const el = ev.currentTarget as HTMLElement;
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }

      const onMove = (e: PointerEvent) => {
        const g = gestureRef.current;
        if (!g) return;
        const dx = e.clientX - g.sx;
        const dy = e.clientY - g.sy;
        if (!g.moved && Math.hypot(dx, dy) < 4) return;
        g.moved = true;
        const w = toWorld(e.clientX, e.clientY);
        lastWorldRef.current = w;

        if (g.kind === 'pan') {
          setTx(g.tx + dx);
          setTy(g.ty + dy);
        } else if (g.kind === 'marquee') {
          setMarquee({
            x: Math.min(g.x0, w.x),
            y: Math.min(g.y0, w.y),
            w: Math.abs(w.x - g.x0),
            h: Math.abs(w.y - g.y0),
          });
        } else if (g.kind === 'nodes') {
          if (readOnly) return;
          const nextOffsets = new Map<string, { x: number; y: number }>();
          for (const [k, p] of g.start) {
            nextOffsets.set(k, { x: Math.round(p.x + dx / z), y: Math.round(p.y + dy / z) });
          }
          setDragOffsets(nextOffsets);
          setDropKey(grantTargetKey(e.clientX, e.clientY, g.primary));
        } else if (g.kind === 'member') {
          if (readOnly) return;
          g.copy = e.altKey;
          setGhost({ x: w.x + 8, y: w.y + 8, label: g.item.name || '', copy: g.copy });
          const t = targetAt(e.clientX, e.clientY, new Set());
          setDropKey(t && t.type !== 'empty' ? (t.type === 'member' ? memberKey(t.node, t.id) : t.node) : '');
        }
      };

      const onUp = (e: PointerEvent) => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);

        const g = gestureRef.current;
        gestureRef.current = null;
        setGhost(null);
        setDropKey('');

        if (!g) return;
        if (g.kind === 'pan' && !g.moved) {
          setSelected(new Set());
        } else if (g.kind === 'marquee') {
          setMarquee((curr) => {
            if (curr) {
              const next = new Set(selected);
              for (const n of board.nodes) {
                if (n.x < curr.x + curr.w && n.x + n.w > curr.x && n.y < curr.y + curr.h && n.y + n.h > curr.y) {
                  next.add(n.key);
                }
              }
              setSelected(next);
            }
            return null;
          });
        } else if (g.kind === 'nodes' && g.moved && !readOnly) {
          const item = resolveItem(g.primary);
          const dk = grantTargetKey(e.clientX, e.clientY, g.primary);
          const target = dk ? targetAt(e.clientX, e.clientY, new Set(g.start.keys())) : null;
          const joins =
            item?.type === 'free' && target && target.type !== 'empty' && target.type !== 'free' && target.kind === item.kind;
          setDragOffsets(null);
          if (item && target && joins) {
            onMemberDrop({ item, target, copy: false });
          } else if (item && target && target.type !== 'empty' && item.kind === 'identity' && target.kind === 'service') {
            onNodeDrop({ item, target });
          } else {
            const dx = e.clientX - g.sx;
            const dy = e.clientY - g.sy;
            const moves = [...g.start.entries()].map(([key, p]) => ({
              key,
              x: Math.round(p.x + dx / z),
              y: Math.round(p.y + dy / z),
            }));
            onMoved(moves);
          }
        } else if (g.kind === 'member' && g.moved && !readOnly) {
          const target = targetAt(e.clientX, e.clientY, new Set());
          if (target && !(target.type === 'group' && target.node === g.item.node)) {
            onMemberDrop({ item: g.item, target, copy: g.copy || e.altKey });
          }
        }
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    };

    const handleBgDown = (ev: React.PointerEvent) => {
      if (ev.button !== 0) return;
      setMenu(null);
      hostRef.current?.focus({ preventScroll: true });
      const w = toWorld(ev.clientX, ev.clientY);
      gestureRef.current = ev.shiftKey
        ? { kind: 'marquee', sx: ev.clientX, sy: ev.clientY, x0: w.x, y0: w.y, moved: false }
        : { kind: 'pan', sx: ev.clientX, sy: ev.clientY, tx, ty, moved: false };
      startPointerTracking(ev);
    };

    const handleNodeDown = (ev: React.PointerEvent, n: BoardNode) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      setMenu(null);
      hostRef.current?.focus({ preventScroll: true });
      const nextSel = pickKey(n.key, ev);
      setSelected(nextSel);
      const keys = [...nextSel].filter((k) => !k.startsWith('m|') && nodeMap.has(k));
      if (!keys.includes(n.key)) keys.push(n.key);
      const start = new Map(
        keys.map((k) => {
          const x = nodeMap.get(k)!;
          return [k, { x: x.x, y: x.y }];
        }),
      );
      gestureRef.current = { kind: 'nodes', sx: ev.clientX, sy: ev.clientY, start, primary: n.key, moved: false };
      startPointerTracking(ev);
    };

    const handleMemberDown = (ev: React.PointerEvent, n: BoardNode, m: BoardMember) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      setMenu(null);
      hostRef.current?.focus({ preventScroll: true });
      const key = memberKey(n.key, m.id);
      const nextSel = pickKey(key, ev);
      setSelected(nextSel);
      const resolved = resolveItem(key);
      if (!resolved) return;
      gestureRef.current = {
        kind: 'member',
        sx: ev.clientX,
        sy: ev.clientY,
        item: resolved,
        moved: false,
        copy: ev.altKey,
      };
      startPointerTracking(ev);
    };

    const handleContextMenu = (ev: React.MouseEvent, key: string | null) => {
      ev.preventDefault();
      ev.stopPropagation();
      let nextSel = selected;
      if (key && !selected.has(key)) {
        nextSel = new Set([key]);
        setSelected(nextSel);
      } else if (!key) {
        nextSel = new Set();
        setSelected(nextSel);
      }
      const r = hostRef.current?.getBoundingClientRect();
      if (!r) return;
      setMenu({
        x: ev.clientX - r.left,
        y: ev.clientY - r.top,
        at: toWorld(ev.clientX, ev.clientY),
        items: getSelectionItems(nextSel),
      });
    };

    const runMenuCmd = (
      cmd:
        | 'copy'
        | 'cut'
        | 'delete'
        | 'give'
        | 'advise'
        | 'open'
        | 'select'
        | 'paste'
        | 'arrange'
        | 'newGroup'
        | 'fit'
        | 'expand',
    ) => {
      const m = menu;
      setMenu(null);
      const items = m?.items || getSelectionItems();
      if (cmd === 'fit') fit();
      else if (cmd === 'paste') onCommand({ cmd, items, at: m?.at || lastWorldRef.current });
      else if (cmd === 'arrange') onCommand({ cmd });
      else if (cmd === 'newGroup') onCommand({ cmd, at: m?.at || lastWorldRef.current });
      else if (cmd === 'expand') {
        const g = items.find((i) => i.type === 'group');
        if (g) onCommand({ cmd, node: g.node });
      } else if (cmd === 'select') {
        const g = items.find((i) => i.type === 'group');
        const n = g && nodeMap.get(g.node);
        if (n) {
          setSelected(new Set(n.shown.map((x) => memberKey(n.key, x.id))));
        }
      } else {
        onCommand({ cmd, items });
      }
    };

    const handleKeyDown = (ev: React.KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, select, textarea')) return;
      const mod = ev.metaKey || ev.ctrlKey;
      const key = ev.key.toLowerCase();
      if (mod && key === 'c') {
        ev.preventDefault();
        runMenuCmd('copy');
      } else if (mod && key === 'x') {
        ev.preventDefault();
        runMenuCmd('cut');
      } else if (mod && key === 'v') {
        ev.preventDefault();
        runMenuCmd('paste');
      } else if (mod && key === 'z') {
        ev.preventDefault();
        onCommand({ cmd: 'undo' });
      } else if (mod && key === 'a') {
        ev.preventDefault();
        setSelected(new Set(board.nodes.map((n) => n.key)));
      } else if (key === 'delete' || key === 'backspace') {
        ev.preventDefault();
        runMenuCmd('delete');
      } else if (key === '+' || key === '=') {
        ev.preventDefault();
        zoomBy(1.2);
      } else if (key === '-' || key === '_') {
        ev.preventDefault();
        zoomBy(1 / 1.2);
      } else if (key === '0' && !mod) {
        ev.preventDefault();
        fit();
      } else if (key === 'escape') {
        setSelected(new Set());
        setMenu(null);
      } else if (key === 'enter') {
        const s = getSelectionItems();
        if (s.length === 1 && (s[0].type === 'member' || s[0].type === 'free')) {
          onCommand({ cmd: 'advise', items: s });
        }
      } else if (key.startsWith('arrow') && !readOnly) {
        const keys = [...selected].filter((k) => !k.startsWith('m|') && nodeMap.has(k));
        if (!keys.length) return;
        ev.preventDefault();
        const step = ev.shiftKey ? 50 : 10;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        onMoved(
          keys.map((k) => {
            const n = nodeMap.get(k)!;
            return { key: k, x: n.x + dx, y: n.y + dy };
          }),
        );
      }
    };

    useEffect(() => {
      const vp = viewportRef.current;
      if (!vp) return;
      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
        const dx = ev.deltaX * unit;
        const dy = ev.deltaY * unit;
        if (ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
          setTx((prev) => prev - (dx || dy));
        } else if (ev.ctrlKey || ev.metaKey) {
          zoomBy(Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.01), ev.clientX, ev.clientY);
        } else {
          const legacy = (ev as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
          const isMouse = ev.deltaMode !== 0 || (!dx && !!legacy && legacy % 120 === 0 && Math.abs(ev.deltaY) >= 50);
          if (isMouse) {
            zoomBy(Math.exp(-Math.sign(dy) * Math.min(Math.abs(dy), 120) * 0.0018), ev.clientX, ev.clientY);
          } else {
            setTx((prev) => prev - dx);
            setTy((prev) => prev - dy);
          }
        }
      };
      vp.addEventListener('wheel', onWheel, { passive: false });
      return () => vp.removeEventListener('wheel', onWheel);
    }, [zoomBy]);

    const menuHas = (t: SelItem['type'] | 'entity' | 'identity'): boolean => {
      const items = menu?.items || [];
      if (t === 'entity') return items.some((i) => i.type === 'member' || i.type === 'free');
      if (t === 'identity')
        return items.some((i) => (i.type === 'member' || i.type === 'free' || i.type === 'group') && i.kind === 'identity');
      return items.some((i) => i.type === t);
    };
    const menuSingleEntity =
      menu?.items.length === 1 && (menu.items[0].type === 'member' || menu.items[0].type === 'free')
        ? menu.items[0]
        : null;

    return (
      <div
        ref={hostRef}
        tabIndex={0}
        role="application"
        onKeyDown={handleKeyDown}
        aria-label="Access canvas. Scroll or pinch to zoom, plus and minus keys to zoom, 0 to fit. Drag boxes to arrange them, drag cards between groups, Cmd or Ctrl with C, X and V to copy, cut and paste access, Delete to remove from a group, right-click for more."
        className={`ab-canvas-board ${hotNodes.size > 0 ? 'has-hot' : ''}`}
      >
        <div
          ref={viewportRef}
          className="ab-viewport"
          onPointerDown={handleBgDown}
          onContextMenu={(ev) => handleContextMenu(ev, null)}
        >
          <div className="ab-world" style={{ transform: `translate(${tx}px, ${ty}px) scale(${z})` }}>
            <svg className="ab-edges" width="1" height="1" aria-hidden="true">
              {paths.map((p) => (
                <path key={p.id} d={p.d} className={p.cls} />
              ))}
            </svg>

            {liveNodes.map((n) => {
              if (n.type === 'group') {
                return (
                  <section
                    key={n.key}
                    data-kind={n.kind}
                    data-drop=""
                    data-node={n.key}
                    style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                    onPointerDown={(ev) => handleNodeDown(ev, n)}
                    onContextMenu={(ev) => handleContextMenu(ev, n.key)}
                    onMouseEnter={() => setHotNode(n.key)}
                    onMouseLeave={() => setHotNode(null)}
                    aria-label={`${n.kind} group #${n.attr}, ${n.members.length} members`}
                    className={[
                      'ab-node ab-group',
                      selected.has(n.key) ? 'sel' : '',
                      hotNodes.has(n.key) ? 'hot' : '',
                      n.dim ? 'dim' : '',
                      dropKey === n.key ? 'drop' : '',
                      n.pending ? 'pending' : '',
                      n.hit && !n.dim ? 'hit' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <header className="ab-gh" tabIndex={0}>
                      <span className="ab-kind" title={`${n.kind} group`}>
                        {kindLetter(n.kind)}
                      </span>
                      <span className="ab-attr">#{n.attr}</span>
                      <span className="ab-count">{n.members.length}</span>
                      {n.problemCount > 0 && (
                        <span className="ab-prob" title={n.problems.join('; ')}>
                          {n.problemCount}
                        </span>
                      )}
                    </header>

                    {n.shown.length > 0 ? (
                      n.shown.map((m) => {
                        const mKey = memberKey(n.key, m.id);
                        return (
                          <div
                            key={m.id}
                            data-drop=""
                            data-node={n.key}
                            data-member={m.id}
                            tabIndex={0}
                            onPointerDown={(ev) => handleMemberDown(ev, n, m)}
                            onDoubleClick={() => {
                              const resolved = resolveItem(mKey);
                              if (resolved) onCommand({ cmd: 'advise', items: [resolved] });
                            }}
                            onContextMenu={(ev) => handleContextMenu(ev, mKey)}
                            title={m.problems.length ? m.problems.join('; ') : undefined}
                            className={[
                              'ab-row',
                              selected.has(mKey) ? 'sel' : '',
                              dropKey === mKey ? 'drop' : '',
                              m.pending ? 'pending' : '',
                              m.hit ? 'hit' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {!readOnly && (
                              <span className="ab-grip" aria-hidden="true">
                                ⠿
                              </span>
                            )}
                            <span className="ab-name">{m.name}</span>
                            {m.problems.length > 0 && <span className="ab-dot bad" aria-label={m.problems.join('; ')} />}
                            {m.pending && <span className="ab-dot pend" aria-label="pending change" />}
                          </div>
                        );
                      })
                    ) : (
                      <div
                        className="ab-empty-row"
                        title={`Nothing has #${n.attr} yet. Drag or paste ${
                          n.kind === 'service' ? 'services' : n.kind === 'router' ? 'routers' : 'identities'
                        } here.`}
                      >
                        Empty: drag {n.kind === 'service' ? 'services' : n.kind === 'router' ? 'routers' : 'identities'} here
                      </div>
                    )}

                    {n.more > 0 && (
                      <button
                        type="button"
                        className="ab-more"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onCommand({ cmd: 'expand', node: n.key })}
                      >
                        +{n.more} more
                      </button>
                    )}
                  </section>
                );
              }

              if (n.type === 'free') {
                return (
                  <div
                    key={n.key}
                    data-kind={n.kind}
                    data-drop=""
                    data-node={n.key}
                    tabIndex={0}
                    style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                    onPointerDown={(ev) => handleNodeDown(ev, n)}
                    onDoubleClick={() => {
                      const resolved = resolveItem(n.key);
                      if (resolved) onCommand({ cmd: 'advise', items: [resolved] });
                    }}
                    onContextMenu={(ev) => handleContextMenu(ev, n.key)}
                    onMouseEnter={() => setHotNode(n.key)}
                    onMouseLeave={() => setHotNode(null)}
                    title={
                      n.problems.length
                        ? n.problems.join('; ')
                        : 'In no group yet. Drag it onto a group to add it there.'
                    }
                    className={[
                      'ab-node ab-free',
                      selected.has(n.key) ? 'sel' : '',
                      hotNodes.has(n.key) ? 'hot' : '',
                      n.dim ? 'dim' : '',
                      dropKey === n.key ? 'drop' : '',
                      n.pending ? 'pending' : '',
                      n.hit && !n.dim ? 'hit' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="ab-kind">{kindLetter(n.kind)}</span>
                    <span className="ab-name">{n.entity!.name}</span>
                    {n.problemCount > 0 && <span className="ab-dot bad" />}
                    {n.pending && <span className="ab-dot pend" />}
                  </div>
                );
              }

              return (
                <div
                  key={n.key}
                  data-family={n.policy!.family}
                  data-node={n.key}
                  tabIndex={0}
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                  onPointerDown={(ev) => handleNodeDown(ev, n)}
                  onContextMenu={(ev) => handleContextMenu(ev, n.key)}
                  onMouseEnter={() => setHotNode(n.key)}
                  onMouseLeave={() => setHotNode(null)}
                  title={
                    `${famLabel(n)} policy ${n.policy!.name} (${n.policy!.semantic})` +
                    (n.policy!.all.length ? `; ${n.policy!.all.join(', ')}` : '') +
                    (n.policy!.posture.length ? `; posture: ${n.policy!.posture.join(', ')}` : '') +
                    (n.problems.length ? `; ${n.problems.join('; ')}` : '')
                  }
                  className={[
                    'ab-node ab-hub',
                    selected.has(n.key) ? 'sel' : '',
                    hotNodes.has(n.key) ? 'hot' : '',
                    n.dim ? 'dim' : '',
                    n.pending ? 'pending' : '',
                    n.hit && !n.dim ? 'hit' : '',
                    n.problemCount > 0 ? 'bad' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="ab-fam">{famLabel(n)}</span>
                  <span className="ab-pname">{n.policy!.name}</span>
                  {n.policy!.all.length > 0 && <span className="ab-all">all</span>}
                  {n.policy!.posture.length > 0 && <span className="ab-all">posture</span>}
                </div>
              );
            })}

            {marquee && (
              <div
                className="ab-marquee"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}
            {ghost && (
              <div className="ab-ghost" style={{ left: ghost.x, top: ghost.y }}>
                {ghost.copy ? '+ ' : ''}
                {ghost.label}
              </div>
            )}
          </div>
        </div>

        {/* Zoom Controls */}
        <div
          role="group"
          aria-label="Zoom"
          className="absolute right-3 bottom-3 flex items-center gap-0.5 p-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-md text-xs"
        >
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="Zoom out"
            className="min-w-7 h-6.5 rounded hover:bg-[var(--ac-surface-2)] cursor-pointer"
          >
            −
          </button>
          <span className="min-w-11 text-center text-[var(--ac-muted)] font-mono">{Math.round(z * 100)}%</span>
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            aria-label="Zoom in"
            className="min-w-7 h-6.5 rounded hover:bg-[var(--ac-surface-2)] cursor-pointer"
          >
            +
          </button>
          <button
            type="button"
            onClick={fit}
            className="px-2 h-6.5 rounded hover:bg-[var(--ac-surface-2)] cursor-pointer font-medium"
          >
            Fit
          </button>
        </div>

        {/* Context Menu */}
        {menu && (
          <>
            <div
              className="absolute inset-0 z-10"
              onPointerDown={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(null);
              }}
            />
            <div
              role="menu"
              style={{ left: menu.x, top: menu.y }}
              className="absolute z-20 min-w-52 p-1.5 grid rounded-xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-xl text-xs"
            >
              {menu.items.length > 0 ? (
                <>
                  {(menuHas('entity') || menuHas('group')) && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runMenuCmd('copy')}
                        className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                      >
                        <span>Copy</span>
                        <kbd className="font-mono text-[11px] text-[var(--ac-muted)]">⌘C</kbd>
                      </button>
                      {!readOnly && menuHas('entity') && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => runMenuCmd('cut')}
                          className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                        >
                          <span>Cut</span>
                          <kbd className="font-mono text-[11px] text-[var(--ac-muted)]">⌘X</kbd>
                        </button>
                      )}
                    </>
                  )}
                  {!readOnly && hasClip && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuCmd('paste')}
                      className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                    >
                      <span>{menuHas('group') ? 'Paste into group' : 'Paste access onto this'}</span>
                      <kbd className="font-mono text-[11px] text-[var(--ac-muted)]">⌘V</kbd>
                    </button>
                  )}
                  {!readOnly && menuHas('member') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuCmd('delete')}
                      className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                    >
                      <span>Remove from group</span>
                      <kbd className="font-mono text-[11px] text-[var(--ac-muted)]">⌫</kbd>
                    </button>
                  )}
                  {!readOnly && menuHas('identity') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuCmd('give')}
                      className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                    >
                      <span>Give access…</span>
                    </button>
                  )}
                  {menuSingleEntity && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runMenuCmd('advise')}
                        className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                      >
                        <span>Check in the advisor</span>
                        <kbd className="font-mono text-[11px] text-[var(--ac-muted)]">↵</kbd>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runMenuCmd('open')}
                        className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                      >
                        <span>Open details</span>
                      </button>
                    </>
                  )}
                  {menuHas('group') && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runMenuCmd('select')}
                        className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                      >
                        <span>Select its members</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runMenuCmd('expand')}
                        className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                      >
                        <span>Show / hide all members</span>
                      </button>
                    </>
                  )}
                  {menuHas('hub') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuCmd('open')}
                      className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                    >
                      <span>Open policy</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  {!readOnly && hasClip && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuCmd('paste')}
                      className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                    >
                      <span>Paste as new</span>
                      <kbd className="font-mono text-[11px] text-[var(--ac-muted)]">⌘V</kbd>
                    </button>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuCmd('newGroup')}
                      className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                    >
                      <span>New group here…</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => runMenuCmd('fit')}
                    className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                  >
                    <span>Fit to screen</span>
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runMenuCmd('arrange')}
                      className="flex justify-between items-center gap-4 px-2.5 py-1.5 rounded-lg hover:bg-[var(--ac-dial-soft)] text-left cursor-pointer"
                    >
                      <span>Auto-arrange</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  },
);
