/**
 * <ac-board>: the Access Canvas drawing surface. The server computes the board (node boxes,
 * members, policy hubs and edges with positions); this element only draws it and turns pointer
 * and keyboard gestures into events the server acts on:
 *
 *   ac-moved        { moves: [{ key, x, y }] }             nodes dragged or nudged
 *   ac-member-drop  { item, target, copy }                  a card dropped on a group/card/empty
 *   ac-node-drop    { item, target }                        an identity box dropped on a service
 *   ac-command      { cmd, items?, at?, node? }             clipboard, delete, advise, open, …
 *
 * Each event carries its payload as JSON in `detail.json`. Light DOM, styled by styles.css.
 * mode="graph" adds connector handles (drag identity → service to grant) and a minimap.
 */
import { LitElement, html, svg, nothing } from 'lit';

type Kind = 'identity' | 'service' | 'router';

interface Member {
  id: string;
  name: string;
  problems: string[];
  pending: boolean;
  hit: boolean;
  ips?: string[] | null;
  liveSessions?: number | null;
  concurrentSeverity?: string | null;
}

interface PolicyInfo {
  id: string;
  name: string;
  family: 'dial' | 'bind' | 'erp' | 'serp';
  semantic: string;
  posture: string[];
  all: string[];
}

interface BNode {
  key: string;
  type: 'group' | 'free' | 'hub';
  kind?: Kind;
  attr?: string;
  entity?: Member;
  policy?: PolicyInfo;
  memberCount: number;
  members: { id: string; name: string }[];
  shown: Member[];
  more: number;
  x: number;
  y: number;
  w: number;
  h: number;
  problems: string[];
  problemCount: number;
  pending: boolean;
  hit: boolean;
  dim: boolean;
}

interface Anchor {
  node: string;
  member?: string | null;
}

interface BEdge {
  id: string;
  family: string;
  from: Anchor;
  to: Anchor;
  pending: boolean;
  byName: boolean;
}

interface SelItem {
  type: 'group' | 'free' | 'hub' | 'member';
  node: string;
  kind?: Kind;
  id?: string;
  name?: string;
  attr?: string;
  policy?: string;
}

type DropTarget =
  | { type: 'group'; node: string; kind: Kind; attr: string }
  | { type: 'member'; node: string; kind: Kind; id: string; attr: string }
  | { type: 'free'; node: string; kind: Kind; id: string }
  | { type: 'empty'; at: { x: number; y: number } };

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean }
  | { kind: 'marquee'; sx: number; sy: number; x0: number; y0: number; moved: boolean }
  | { kind: 'nodes'; sx: number; sy: number; start: Map<string, { x: number; y: number }>; primary: string; moved: boolean }
  | { kind: 'member'; sx: number; sy: number; item: SelItem; moved: boolean; copy: boolean }
  | { kind: 'connect'; sx: number; sy: number; from: string; moved: boolean };

const HEADER_H = 38;
const ROW_H = 26;

const memberKey = (node: string, id: string) => `m|${node}|${id}`;
const kindLetter = (k?: Kind) => (k === 'service' ? 'S' : k === 'router' ? 'R' : 'I');
const kindPlural = (k?: Kind) => (k === 'service' ? 'services' : k === 'router' ? 'routers' : 'identities');
const FAM_LABEL: Record<string, string> = { dial: 'Dial', bind: 'Bind', erp: 'Routers', serp: 'Svc routers' };
const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

function anchorRect(nodes: Map<string, BNode>, a: Anchor) {
  const n = nodes.get(a.node);
  if (!n) return null;
  if (n.type === 'group' && a.member) {
    const i = n.shown.findIndex((m) => m.id === a.member);
    if (i >= 0) return { x: n.x, y: n.y + HEADER_H + i * ROW_H, w: n.w, h: ROW_H };
  }
  if (n.type === 'group') return { x: n.x, y: n.y, w: n.w, h: HEADER_H };
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

/** Same curve as BoardLogic.edgePath on the server, so dragging redraws lines locally. */
function edgePath(nodes: Map<string, BNode>, e: BEdge): string {
  const a = anchorRect(nodes, e.from);
  const b = anchorRect(nodes, e.to);
  if (!a || !b) return '';
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  let x1: number;
  let x2: number;
  if (a.x + a.w <= b.x) {
    x1 = a.x + a.w;
    x2 = b.x;
  } else if (b.x + b.w <= a.x) {
    x1 = a.x;
    x2 = b.x + b.w;
  } else {
    x1 = a.x + a.w;
    x2 = b.x + b.w;
  }
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  const c1 = x1 + (x1 <= x2 || a.x + a.w === x1 ? bend : -bend);
  const c2 = x2 + (x1 <= x2 ? -bend : bend);
  return `M${x1},${ay} C${c1},${ay} ${c2},${by} ${x2},${by}`;
}

function bounds(nodes: BNode[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.w));
  const y1 = Math.max(...nodes.map((n) => n.y + n.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export class AcBoard extends LitElement {
  static properties = {
    boardJson: { type: String, attribute: false },
    readOnly: { type: Boolean, attribute: 'read-only' },
    hasClip: { type: Boolean, attribute: 'has-clip' },
    mode: { type: String },
    tx: { state: true },
    ty: { state: true },
    z: { state: true },
    selected: { state: true },
    hotNode: { state: true },
    marquee: { state: true },
    ghost: { state: true },
    dropKey: { state: true },
    menu: { state: true },
    dragOffsets: { state: true },
    connectLine: { state: true },
  };

  declare boardJson: string;
  declare readOnly: boolean;
  declare hasClip: boolean;
  declare mode: string;
  declare tx: number;
  declare ty: number;
  declare z: number;
  declare selected: Set<string>;
  declare hotNode: string | null;
  declare marquee: { x: number; y: number; w: number; h: number } | null;
  declare ghost: { x: number; y: number; label: string; copy: boolean } | null;
  declare dropKey: string;
  declare menu: { x: number; y: number; at: { x: number; y: number }; items: SelItem[] } | null;
  declare dragOffsets: Map<string, { x: number; y: number }> | null;
  declare connectLine: { x1: number; y1: number; x2: number; y2: number } | null;

  private nodes: BNode[] = [];
  private edges: BEdge[] = [];
  private gesture: Gesture | null = null;
  private lastWorld = { x: 200, y: 200 };
  private fitted = false;
  private wheelBound = false;

  constructor() {
    super();
    this.boardJson = '';
    this.readOnly = false;
    this.hasClip = false;
    this.mode = 'board';
    this.tx = 40;
    this.ty = 40;
    this.z = 1;
    this.selected = new Set();
    this.hotNode = null;
    this.marquee = null;
    this.ghost = null;
    this.dropKey = '';
    this.menu = null;
    this.dragOffsets = null;
    this.connectLine = null;
  }

  protected createRenderRoot() {
    return this;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('boardJson')) {
      try {
        const b = this.boardJson ? JSON.parse(this.boardJson) : { nodes: [], edges: [] };
        this.nodes = b.nodes || [];
        this.edges = b.edges || [];
        // The new board carries the moved positions, so local drag overrides are done.
        if (!this.gesture) this.dragOffsets = null;
      } catch {
        this.nodes = [];
        this.edges = [];
      }
      // Drop selections that no longer exist.
      const keys = new Set(this.nodes.map((n) => n.key));
      const sel = [...this.selected].filter((k) => keys.has(k.startsWith('m|') ? k.split('|')[1] : k));
      if (sel.length !== this.selected.size) this.selected = new Set(sel);
    }
  }

  protected updated() {
    if (!this.fitted && this.nodes.length && this.viewport()?.getBoundingClientRect().width) {
      this.fitted = true;
      requestAnimationFrame(() => this.fit());
    }
    const vp = this.viewport();
    if (vp && !this.wheelBound) {
      this.wheelBound = true;
      vp.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });
    }
  }

  // ------------------------------------------------------------------ public API (called from the server)

  fit() {
    const b = bounds(this.nodes);
    const r = this.viewport()?.getBoundingClientRect();
    if (!b.w || !r || !r.width) return;
    const z = Math.min(1.2, Math.max(0.15, Math.min((r.width - 60) / b.w, (r.height - 60) / b.h)));
    this.z = z;
    this.tx = (r.width - b.w * z) / 2 - b.x * z;
    this.ty = (r.height - b.h * z) / 2 - b.y * z;
  }

  reveal(key: string, selectMemberKey?: string | null) {
    const n = this.nodeMap().get(key);
    const r = this.viewport()?.getBoundingClientRect();
    if (!n || !r) return;
    this.tx = r.width / 2 - (n.x + n.w / 2) * this.z;
    this.ty = r.height / 3 - n.y * this.z;
    this.selected = new Set([selectMemberKey || key]);
    this.menu = null;
  }

  /** Re-fit on the next frame (after a new board was set). */
  refit() {
    requestAnimationFrame(() => this.fit());
  }

  // ------------------------------------------------------------------ helpers

  private viewport(): HTMLElement | null {
    return this.querySelector('.ab-viewport');
  }

  private host(): HTMLElement | null {
    return this.querySelector('.ab-canvas-board');
  }

  private liveNodes(): BNode[] {
    const o = this.dragOffsets;
    if (!o) return this.nodes;
    return this.nodes.map((n) => {
      const p = o.get(n.key);
      return p ? { ...n, x: p.x, y: p.y } : n;
    });
  }

  private nodeMap(): Map<string, BNode> {
    return new Map(this.liveNodes().map((n) => [n.key, n]));
  }

  private emit(name: string, payload: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail: { json: JSON.stringify(payload) }, bubbles: false }));
  }

  private toWorld(cx: number, cy: number) {
    const r = this.viewport()?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (cx - r.left - this.tx) / this.z, y: (cy - r.top - this.ty) / this.z };
  }

  private zoomBy(factor: number, cx?: number, cy?: number) {
    const r = this.viewport()?.getBoundingClientRect();
    if (!r) return;
    const px = cx ?? r.left + r.width / 2;
    const py = cy ?? r.top + r.height / 2;
    const wx = (px - r.left - this.tx) / this.z;
    const wy = (py - r.top - this.ty) / this.z;
    const z = Math.min(2.5, Math.max(0.15, this.z * factor));
    this.z = z;
    this.tx = px - r.left - wx * z;
    this.ty = py - r.top - wy * z;
  }

  private resolveItem(key: string): SelItem | null {
    const map = this.nodeMap();
    if (key.startsWith('m|')) {
      const [, node, id] = key.split('|');
      const n = map.get(node);
      const m = n?.members.find((x) => x.id === id);
      return n && m ? { type: 'member', node, kind: n.kind, id, name: m.name, attr: n.attr } : null;
    }
    const n = map.get(key);
    if (!n) return null;
    if (n.type === 'group') return { type: 'group', node: key, kind: n.kind, attr: n.attr, name: '#' + n.attr };
    if (n.type === 'free') return { type: 'free', node: key, kind: n.kind, id: n.entity!.id, name: n.entity!.name };
    return { type: 'hub', node: key, policy: n.policy!.id, name: n.policy!.name };
  }

  private selectionItems(sel: Set<string> = this.selected): SelItem[] {
    return [...sel].map((k) => this.resolveItem(k)).filter((x): x is SelItem => !!x);
  }

  private targetAt(cx: number, cy: number, ignore: Set<string>): DropTarget | null {
    const map = this.nodeMap();
    const els = document.elementsFromPoint(cx, cy) as HTMLElement[];
    for (const el of els) {
      const d = el.closest('[data-drop]') as HTMLElement | null;
      if (!d || !this.contains(d)) continue;
      const node = d.dataset['node']!;
      const n = map.get(node);
      if (!n || ignore.has(node)) continue;
      const id = d.dataset['member'];
      if (id && n.type === 'group') return { type: 'member', node, kind: n.kind!, id, attr: n.attr! };
      if (n.type === 'group') return { type: 'group', node, kind: n.kind!, attr: n.attr! };
      if (n.type === 'free') return { type: 'free', node, kind: n.kind!, id: n.entity!.id };
    }
    return els.some((el) => el === this.viewport() || el.classList?.contains('ab-world'))
      ? { type: 'empty', at: this.toWorld(cx, cy) }
      : null;
  }

  private grantTargetKey(cx: number, cy: number, primary: string): string {
    const src = this.nodeMap().get(primary);
    if (!src || src.type === 'hub') return '';
    const t = this.targetAt(cx, cy, new Set([primary]));
    if (!t || t.type === 'empty') return '';
    const grant = src.kind === 'identity' && t.kind === 'service';
    const join = src.type === 'free' && t.type !== 'free' && t.kind === src.kind;
    if (!grant && !join) return '';
    return join ? t.node : t.type === 'member' ? memberKey(t.node, t.id) : t.node;
  }

  private pickKey(key: string, ev: PointerEvent | MouseEvent): Set<string> {
    const multi = ev.shiftKey || ev.metaKey || ev.ctrlKey;
    const next = new Set(this.selected);
    if (multi) {
      if (next.has(key)) next.delete(key);
      else next.add(key);
    } else if (!next.has(key)) {
      return new Set([key]);
    }
    return next;
  }

  private focusHost() {
    this.host()?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ gestures

  private track(ev: PointerEvent) {
    const el = ev.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    const onMove = (e: PointerEvent) => this.onMove(e);
    const onUp = (e: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      this.onUp(e);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  private onMove(e: PointerEvent) {
    const g = this.gesture;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    const w = this.toWorld(e.clientX, e.clientY);
    this.lastWorld = w;
    if (g.kind === 'pan') {
      this.host()?.classList.add('panning');
      this.tx = g.tx + dx;
      this.ty = g.ty + dy;
    } else if (g.kind === 'marquee') {
      this.marquee = { x: Math.min(g.x0, w.x), y: Math.min(g.y0, w.y), w: Math.abs(w.x - g.x0), h: Math.abs(w.y - g.y0) };
    } else if (g.kind === 'nodes') {
      if (this.readOnly) return;
      const next = new Map<string, { x: number; y: number }>();
      for (const [k, p] of g.start) next.set(k, { x: Math.round(p.x + dx / this.z), y: Math.round(p.y + dy / this.z) });
      this.dragOffsets = next;
      this.dropKey = this.grantTargetKey(e.clientX, e.clientY, g.primary);
    } else if (g.kind === 'member') {
      if (this.readOnly) return;
      g.copy = e.altKey;
      this.ghost = { x: w.x + 8, y: w.y + 8, label: g.item.name || '', copy: g.copy };
      const t = this.targetAt(e.clientX, e.clientY, new Set());
      this.dropKey = t && t.type !== 'empty' ? (t.type === 'member' ? memberKey(t.node, t.id) : t.node) : '';
    } else if (g.kind === 'connect') {
      const n = this.nodeMap().get(g.from);
      if (!n) return;
      const y = n.type === 'group' ? n.y + HEADER_H / 2 : n.y + n.h / 2;
      this.connectLine = { x1: n.x + n.w, y1: y, x2: w.x, y2: w.y };
      const t = this.targetAt(e.clientX, e.clientY, new Set([g.from]));
      this.dropKey = t && t.type !== 'empty' && t.kind === 'service' ? (t.type === 'member' ? memberKey(t.node, t.id) : t.node) : '';
    }
  }

  private onUp(e: PointerEvent) {
    const g = this.gesture;
    this.gesture = null;
    this.ghost = null;
    this.dropKey = '';
    this.connectLine = null;
    this.host()?.classList.remove('panning');
    if (!g) return;
    if (g.kind === 'pan' && !g.moved) {
      this.selected = new Set();
    } else if (g.kind === 'marquee') {
      const m = this.marquee;
      if (m) {
        const next = new Set(this.selected);
        for (const n of this.nodes) {
          if (n.x < m.x + m.w && n.x + n.w > m.x && n.y < m.y + m.h && n.y + n.h > m.y) next.add(n.key);
        }
        this.selected = next;
      }
      this.marquee = null;
    } else if (g.kind === 'nodes' && g.moved && !this.readOnly) {
      const item = this.resolveItem(g.primary);
      const dk = this.grantTargetKey(e.clientX, e.clientY, g.primary);
      const target = dk ? this.targetAt(e.clientX, e.clientY, new Set(g.start.keys())) : null;
      const joins =
        item?.type === 'free' && target && target.type !== 'empty' && target.type !== 'free' && target.kind === item.kind;
      if (item && target && joins) {
        this.dragOffsets = null;
        this.emit('ac-member-drop', { item, target, copy: false });
      } else if (item && target && target.type !== 'empty' && item.kind === 'identity' && target.kind === 'service') {
        this.dragOffsets = null;
        this.emit('ac-node-drop', { item, target });
      } else {
        const dx = e.clientX - g.sx;
        const dy = e.clientY - g.sy;
        const moves = [...g.start.entries()].map(([key, p]) => ({
          key,
          x: Math.round(p.x + dx / this.z),
          y: Math.round(p.y + dy / this.z),
        }));
        // Keep the moved positions until the server sends the new board, so nothing jumps back.
        this.emit('ac-moved', { moves });
      }
    } else if (g.kind === 'member' && g.moved && !this.readOnly) {
      const target = this.targetAt(e.clientX, e.clientY, new Set());
      if (target && !(target.type === 'group' && target.node === g.item.node)) {
        this.emit('ac-member-drop', { item: g.item, target, copy: g.copy || e.altKey });
      }
    } else if (g.kind === 'connect' && g.moved && !this.readOnly) {
      const item = this.resolveItem(g.from);
      const target = this.targetAt(e.clientX, e.clientY, new Set([g.from]));
      if (item && target && target.type !== 'empty' && target.kind === 'service') {
        this.emit('ac-node-drop', { item, target });
      }
    }
  }

  private onBgDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    this.menu = null;
    this.focusHost();
    const w = this.toWorld(ev.clientX, ev.clientY);
    this.gesture = ev.shiftKey
      ? { kind: 'marquee', sx: ev.clientX, sy: ev.clientY, x0: w.x, y0: w.y, moved: false }
      : { kind: 'pan', sx: ev.clientX, sy: ev.clientY, tx: this.tx, ty: this.ty, moved: false };
    this.track(ev);
  }

  private onNodeDown(ev: PointerEvent, n: BNode) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    this.menu = null;
    this.focusHost();
    const sel = this.pickKey(n.key, ev);
    this.selected = sel;
    const map = this.nodeMap();
    const keys = [...sel].filter((k) => !k.startsWith('m|') && map.has(k));
    if (!keys.includes(n.key)) keys.push(n.key);
    const start = new Map(keys.map((k) => [k, { x: map.get(k)!.x, y: map.get(k)!.y }]));
    this.gesture = { kind: 'nodes', sx: ev.clientX, sy: ev.clientY, start, primary: n.key, moved: false };
    this.track(ev);
  }

  private onMemberDown(ev: PointerEvent, n: BNode, m: Member) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    this.menu = null;
    this.focusHost();
    const key = memberKey(n.key, m.id);
    this.selected = this.pickKey(key, ev);
    const item = this.resolveItem(key);
    if (!item) return;
    this.gesture = { kind: 'member', sx: ev.clientX, sy: ev.clientY, item, moved: false, copy: ev.altKey };
    this.track(ev);
  }

  private onHandleDown(ev: PointerEvent, n: BNode) {
    if (ev.button !== 0 || this.readOnly) return;
    ev.stopPropagation();
    this.menu = null;
    this.selected = new Set([n.key]);
    this.gesture = { kind: 'connect', sx: ev.clientX, sy: ev.clientY, from: n.key, moved: false };
    this.track(ev);
  }

  private onContextMenu(ev: MouseEvent, key: string | null) {
    ev.preventDefault();
    ev.stopPropagation();
    let sel = this.selected;
    if (key && !sel.has(key)) sel = new Set([key]);
    else if (!key) sel = new Set();
    this.selected = sel;
    const r = this.host()?.getBoundingClientRect();
    if (!r) return;
    this.menu = { x: ev.clientX - r.left, y: ev.clientY - r.top, at: this.toWorld(ev.clientX, ev.clientY), items: this.selectionItems(sel) };
  }

  private runCmd(cmd: string) {
    const m = this.menu;
    this.menu = null;
    const items = m?.items || this.selectionItems();
    if (cmd === 'fit') this.fit();
    else if (cmd === 'paste') this.emit('ac-command', { cmd, items, at: m?.at || this.lastWorld });
    else if (cmd === 'arrange' || cmd === 'undo') this.emit('ac-command', { cmd });
    else if (cmd === 'newGroup') this.emit('ac-command', { cmd, at: m?.at || this.lastWorld });
    else if (cmd === 'expand') {
      const g = items.find((i) => i.type === 'group');
      if (g) this.emit('ac-command', { cmd, node: g.node });
    } else if (cmd === 'select') {
      const g = items.find((i) => i.type === 'group');
      const n = g && this.nodeMap().get(g.node);
      if (n) this.selected = new Set(n.shown.map((x) => memberKey(n.key, x.id)));
    } else {
      this.emit('ac-command', { cmd, items });
    }
  }

  private onKeyDown(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key.toLowerCase();
    if (mod && key === 'c') {
      ev.preventDefault();
      this.runCmd('copy');
    } else if (mod && key === 'x') {
      ev.preventDefault();
      this.runCmd('cut');
    } else if (mod && key === 'v') {
      ev.preventDefault();
      this.runCmd('paste');
    } else if (mod && key === 'z') {
      ev.preventDefault();
      this.runCmd('undo');
    } else if (mod && key === 'a') {
      ev.preventDefault();
      this.selected = new Set(this.nodes.map((n) => n.key));
    } else if (key === 'delete' || key === 'backspace') {
      ev.preventDefault();
      this.runCmd('delete');
    } else if (key === '+' || key === '=') {
      ev.preventDefault();
      this.zoomBy(1.2);
    } else if (key === '-' || key === '_') {
      ev.preventDefault();
      this.zoomBy(1 / 1.2);
    } else if (key === '0' && !mod) {
      ev.preventDefault();
      this.fit();
    } else if (key === 'escape') {
      this.selected = new Set();
      this.menu = null;
    } else if (key === 'enter') {
      const s = this.selectionItems();
      if (s.length === 1 && (s[0].type === 'member' || s[0].type === 'free')) this.emit('ac-command', { cmd: 'advise', items: s });
    } else if (key.startsWith('arrow') && !this.readOnly) {
      const map = this.nodeMap();
      const keys = [...this.selected].filter((k) => !k.startsWith('m|') && map.has(k));
      if (!keys.length) return;
      ev.preventDefault();
      const step = ev.shiftKey ? 50 : 10;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      const moves = keys.map((k) => ({ key: k, x: map.get(k)!.x + dx, y: map.get(k)!.y + dy }));
      this.dragOffsets = new Map([...(this.dragOffsets || new Map()), ...moves.map((m) => [m.key, { x: m.x, y: m.y }] as const)]);
      this.emit('ac-moved', { moves });
    }
  }

  private onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const dx = ev.deltaX * unit;
    const dy = ev.deltaY * unit;
    if (ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      this.tx -= dx || dy;
    } else if (ev.ctrlKey || ev.metaKey) {
      this.zoomBy(Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.01), ev.clientX, ev.clientY);
    } else {
      const legacy = (ev as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      const isMouse = ev.deltaMode !== 0 || (!dx && !!legacy && legacy % 120 === 0 && Math.abs(ev.deltaY) >= 50);
      if (isMouse) {
        this.zoomBy(Math.exp(-Math.sign(dy) * Math.min(Math.abs(dy), 120) * 0.0018), ev.clientX, ev.clientY);
      } else {
        this.tx -= dx;
        this.ty -= dy;
      }
    }
  }

  /** The server sends a new board after a move; until then the dragged positions stay. */
  clearDrag() {
    this.dragOffsets = null;
  }

  // ------------------------------------------------------------------ rendering

  private hot() {
    const hn = new Set<string>();
    const he = new Set<string>();
    const hotNode = this.hotNode;
    if (hotNode && !this.gesture) {
      const hubs = new Set<string>();
      for (const e of this.edges) {
        if (e.from.node === hotNode || e.to.node === hotNode) hubs.add(e.from.node.startsWith('p:') ? e.from.node : e.to.node);
      }
      if (hotNode.startsWith('p:')) hubs.add(hotNode);
      for (const e of this.edges) {
        if (hubs.has(e.from.node) || hubs.has(e.to.node)) {
          he.add(e.id);
          hn.add(e.from.node);
          hn.add(e.to.node);
        }
      }
    }
    return { hn, he };
  }

  private renderGroup(n: BNode, hn: Set<string>) {
    const graph = this.mode === 'graph';
    return html`<section
      data-kind=${n.kind ?? nothing}
      data-drop=""
      data-node=${n.key}
      style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px"
      aria-label="${n.kind} group #${n.attr}, ${n.memberCount} members"
      class=${cls('ab-node ab-group', this.selected.has(n.key) && 'sel', hn.has(n.key) && 'hot', n.dim && 'dim',
        this.dropKey === n.key && 'drop', n.pending && 'pending', n.hit && !n.dim && 'hit')}
      @pointerdown=${(ev: PointerEvent) => this.onNodeDown(ev, n)}
      @contextmenu=${(ev: MouseEvent) => this.onContextMenu(ev, n.key)}
      @mouseenter=${() => (this.hotNode = n.key)}
      @mouseleave=${() => (this.hotNode = null)}
    >
      <header class="ab-gh" tabindex="0">
        <span class="ab-kind" title="${n.kind} group">${kindLetter(n.kind)}</span>
        <span class="ab-attr">#${n.attr}</span>
        <span class="ab-count">${n.memberCount}</span>
        ${n.problemCount > 0 ? html`<span class="ab-prob" title=${n.problems.join('; ')}>${n.problemCount}</span>` : nothing}
      </header>
      ${n.shown.length
        ? n.shown.map((m) => {
            const mk = memberKey(n.key, m.id);
            const title = [...(m.ips?.length ? [`Client IP: ${m.ips.join(', ')}`] : []), ...m.problems].join('; ');
            return html`<div
              data-drop=""
              data-node=${n.key}
              data-member=${m.id}
              tabindex="0"
              title=${title || nothing}
              class=${cls('ab-row', this.selected.has(mk) && 'sel', this.dropKey === mk && 'drop', m.pending && 'pending', m.hit && 'hit')}
              @pointerdown=${(ev: PointerEvent) => this.onMemberDown(ev, n, m)}
              @dblclick=${() => {
                const it = this.resolveItem(mk);
                if (it) this.emit('ac-command', { cmd: 'advise', items: [it] });
              }}
              @contextmenu=${(ev: MouseEvent) => this.onContextMenu(ev, mk)}
            >
              ${this.readOnly ? nothing : html`<span class="ab-grip" aria-hidden="true">⠿</span>`}
              <span class="ab-name">${m.name}</span>
              ${m.concurrentSeverity
                ? html`<span class="ab-ip-badge ${m.concurrentSeverity}">${m.ips && m.ips.length >= 2 ? `${m.ips.length} IPs` : `${m.liveSessions || 2}×`}</span>`
                : nothing}
              ${m.problems.length ? html`<span class="ab-dot bad" aria-label=${m.problems.join('; ')}></span>` : nothing}
              ${m.pending ? html`<span class="ab-dot pend" aria-label="pending change"></span>` : nothing}
            </div>`;
          })
        : html`<div class="ab-empty-row" title="Nothing has #${n.attr} yet. Drag or paste ${kindPlural(n.kind)} here.">
            Empty: drag ${kindPlural(n.kind)} here
          </div>`}
      ${n.more > 0
        ? html`<button
            type="button"
            class="ab-more"
            @pointerdown=${(e: Event) => e.stopPropagation()}
            @click=${() => this.emit('ac-command', { cmd: 'expand', node: n.key })}
          >
            +${n.more} more
          </button>`
        : nothing}
      ${graph && n.kind === 'identity' ? this.renderHandle(n) : nothing}
    </section>`;
  }

  private renderHandle(n: BNode) {
    return html`<span
      class="ab-handle"
      title="Drag onto a service to give access"
      style="top:${n.type === 'group' ? HEADER_H / 2 : n.h / 2}px"
      @pointerdown=${(ev: PointerEvent) => this.onHandleDown(ev, n)}
    ></span>`;
  }

  private renderFree(n: BNode, hn: Set<string>) {
    const e = n.entity!;
    const title = [...(e.ips?.length ? [`Client IP: ${e.ips.join(', ')}`] : []), ...n.problems].join('; ') ||
      'In no group yet. Drag it onto a group to add it there.';
    return html`<div
      data-kind=${n.kind ?? nothing}
      data-drop=""
      data-node=${n.key}
      tabindex="0"
      style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px"
      title=${title}
      class=${cls('ab-node ab-free', this.selected.has(n.key) && 'sel', hn.has(n.key) && 'hot', n.dim && 'dim',
        this.dropKey === n.key && 'drop', n.pending && 'pending', n.hit && !n.dim && 'hit')}
      @pointerdown=${(ev: PointerEvent) => this.onNodeDown(ev, n)}
      @dblclick=${() => {
        const it = this.resolveItem(n.key);
        if (it) this.emit('ac-command', { cmd: 'advise', items: [it] });
      }}
      @contextmenu=${(ev: MouseEvent) => this.onContextMenu(ev, n.key)}
      @mouseenter=${() => (this.hotNode = n.key)}
      @mouseleave=${() => (this.hotNode = null)}
    >
      <span class="ab-kind">${kindLetter(n.kind)}</span>
      <span class="ab-name">${e.name}</span>
      ${e.concurrentSeverity
        ? html`<span class="ab-ip-badge ${e.concurrentSeverity}">${e.ips && e.ips.length >= 2 ? `${e.ips.length} IPs` : `${e.liveSessions || 2}×`}</span>`
        : nothing}
      ${n.problemCount > 0 ? html`<span class="ab-dot bad"></span>` : nothing}
      ${n.pending ? html`<span class="ab-dot pend"></span>` : nothing}
      ${this.mode === 'graph' && n.kind === 'identity' ? this.renderHandle(n) : nothing}
    </div>`;
  }

  private renderHub(n: BNode, hn: Set<string>) {
    const p = n.policy!;
    const title = `${FAM_LABEL[p.family]} policy ${p.name} (${p.semantic})` +
      (p.all.length ? `; ${p.all.join(', ')}` : '') +
      (p.posture.length ? `; posture: ${p.posture.join(', ')}` : '') +
      (n.problems.length ? `; ${n.problems.join('; ')}` : '');
    return html`<div
      data-family=${p.family}
      data-node=${n.key}
      tabindex="0"
      style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px"
      title=${title}
      class=${cls('ab-node ab-hub', this.selected.has(n.key) && 'sel', hn.has(n.key) && 'hot', n.dim && 'dim',
        n.pending && 'pending', n.hit && !n.dim && 'hit', n.problemCount > 0 && 'bad')}
      @pointerdown=${(ev: PointerEvent) => this.onNodeDown(ev, n)}
      @dblclick=${() => this.emit('ac-command', { cmd: 'open', items: [this.resolveItem(n.key)] })}
      @contextmenu=${(ev: MouseEvent) => this.onContextMenu(ev, n.key)}
      @mouseenter=${() => (this.hotNode = n.key)}
      @mouseleave=${() => (this.hotNode = null)}
    >
      <span class="ab-fam">${FAM_LABEL[p.family]}</span>
      <span class="ab-pname">${p.name}</span>
      ${p.all.length ? html`<span class="ab-all">all</span>` : nothing}
      ${p.posture.length ? html`<span class="ab-all">posture</span>` : nothing}
    </div>`;
  }

  private menuItem(label: string, cmd: string, kbd?: string) {
    return html`<button type="button" role="menuitem" @click=${() => this.runCmd(cmd)}>
      <span>${label}</span>${kbd ? html`<kbd>${kbd}</kbd>` : nothing}
    </button>`;
  }

  private renderMenu() {
    const m = this.menu;
    if (!m) return nothing;
    const items = m.items;
    const has = (t: string) => {
      if (t === 'entity') return items.some((i) => i.type === 'member' || i.type === 'free');
      if (t === 'identity') return items.some((i) => i.type !== 'hub' && i.kind === 'identity');
      return items.some((i) => i.type === t);
    };
    const single = items.length === 1 && (items[0].type === 'member' || items[0].type === 'free');
    const ro = this.readOnly;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const k = (c: string) => (mac ? '⌘' : 'Ctrl+') + c;
    return html`<div
        class="ab-menu-scrim"
        @pointerdown=${() => (this.menu = null)}
        @contextmenu=${(e: Event) => {
          e.preventDefault();
          this.menu = null;
        }}
      ></div>
      <div class="ab-menu" role="menu" style="left:${m.x}px;top:${m.y}px">
        ${items.length
          ? html`
              ${has('entity') || has('group') ? this.menuItem('Copy', 'copy', k('C')) : nothing}
              ${!ro && has('entity') ? this.menuItem('Cut', 'cut', k('X')) : nothing}
              ${!ro && this.hasClip ? this.menuItem(has('group') ? 'Paste into group' : 'Paste access onto this', 'paste', k('V')) : nothing}
              ${!ro && has('member') ? this.menuItem('Remove from group', 'delete', '⌫') : nothing}
              ${!ro && has('identity') ? this.menuItem('Give access…', 'give') : nothing}
              ${single ? html`${this.menuItem('Check in the advisor', 'advise', '↵')}${this.menuItem('Open details', 'open')}` : nothing}
              ${has('group') ? html`${this.menuItem('Select its members', 'select')}${this.menuItem('Show / hide all members', 'expand')}` : nothing}
              ${has('hub') ? this.menuItem('Open policy', 'open') : nothing}
            `
          : html`
              ${!ro && this.hasClip ? this.menuItem('Paste as new', 'paste', k('V')) : nothing}
              ${!ro ? this.menuItem('New group here…', 'newGroup') : nothing}
              ${this.menuItem('Fit to screen', 'fit', '0')}
              ${!ro ? this.menuItem('Auto-arrange', 'arrange') : nothing}
            `}
      </div>`;
  }

  private renderMinimap(nodes: BNode[]) {
    if (this.mode !== 'graph' || !nodes.length) return nothing;
    const b = bounds(nodes);
    const r = this.viewport()?.getBoundingClientRect();
    const W = 180;
    const H = 120;
    const pad = 40;
    const s = Math.min(W / (b.w + pad * 2), H / (b.h + pad * 2));
    const ox = b.x - pad;
    const oy = b.y - pad;
    const view = r
      ? { x: (-this.tx / this.z - ox) * s, y: (-this.ty / this.z - oy) * s, w: (r.width / this.z) * s, h: (r.height / this.z) * s }
      : null;
    const onDown = (ev: PointerEvent) => {
      ev.stopPropagation();
      const rect = (ev.currentTarget as SVGElement).getBoundingClientRect();
      const go = (e: PointerEvent) => {
        const wx = (e.clientX - rect.left) / s + ox;
        const wy = (e.clientY - rect.top) / s + oy;
        const vr = this.viewport()?.getBoundingClientRect();
        if (!vr) return;
        this.tx = vr.width / 2 - wx * this.z;
        this.ty = vr.height / 2 - wy * this.z;
      };
      go(ev);
      const el = ev.currentTarget as SVGElement;
      el.setPointerCapture(ev.pointerId);
      const up = () => {
        el.removeEventListener('pointermove', go);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', go);
      el.addEventListener('pointerup', up);
    };
    return html`<svg class="ab-minimap" width=${W} height=${H} aria-label="Minimap" @pointerdown=${onDown}>
      ${nodes.map(
        (n) => svg`<rect x=${(n.x - ox) * s} y=${(n.y - oy) * s} width=${Math.max(2, n.w * s)} height=${Math.max(2, n.h * s)}
          rx="2" class=${cls('mm', n.type === 'hub' ? n.policy?.family : n.kind, n.dim && 'dim')}></rect>`,
      )}
      ${view ? svg`<rect class="mm-view" x=${view.x} y=${view.y} width=${view.w} height=${view.h}></rect>` : nothing}
    </svg>`;
  }

  render() {
    const nodes = this.liveNodes();
    const map = new Map(nodes.map((n) => [n.key, n]));
    const { hn, he } = this.hot();
    const paths = this.edges
      .map((e) => ({
        id: e.id,
        d: edgePath(map, e),
        cls: cls('ab-edge', e.family, e.pending && 'pending', e.byName && 'byname', he.has(e.id) && 'hot'),
      }))
      .filter((p) => p.d);
    const c = this.connectLine;
    return html`<div
      tabindex="0"
      role="application"
      aria-label="Access canvas. Scroll or pinch to zoom, plus and minus keys to zoom, 0 to fit. Drag boxes to arrange them, drag cards between groups, Cmd or Ctrl with C, X and V to copy, cut and paste access, Delete to remove from a group, right-click for more."
      class=${cls('ab-canvas-board', hn.size > 0 && 'has-hot', this.mode === 'graph' && 'graph')}
      @keydown=${(ev: KeyboardEvent) => this.onKeyDown(ev)}
    >
      <div class="ab-viewport" @pointerdown=${(ev: PointerEvent) => this.onBgDown(ev)} @contextmenu=${(ev: MouseEvent) => this.onContextMenu(ev, null)}>
        <div class="ab-world" style="transform:translate(${this.tx}px, ${this.ty}px) scale(${this.z})">
          <svg class="ab-edges" width="1" height="1" aria-hidden="true">
            ${paths.map((p) => svg`<path d=${p.d} class=${p.cls}></path>`)}
            ${c ? svg`<path class="ab-edge dial pending" d="M${c.x1},${c.y1} C${c.x1 + 60},${c.y1} ${c.x2 - 60},${c.y2} ${c.x2},${c.y2}"></path>` : nothing}
          </svg>
          ${nodes.map((n) => (n.type === 'group' ? this.renderGroup(n, hn) : n.type === 'free' ? this.renderFree(n, hn) : this.renderHub(n, hn)))}
          ${this.marquee
            ? html`<div class="ab-marquee" style="left:${this.marquee.x}px;top:${this.marquee.y}px;width:${this.marquee.w}px;height:${this.marquee.h}px"></div>`
            : nothing}
          ${this.ghost ? html`<div class="ab-ghost" style="left:${this.ghost.x}px;top:${this.ghost.y}px">${this.ghost.copy ? '+ ' : ''}${this.ghost.label}</div>` : nothing}
        </div>
      </div>
      ${nodes.length ? nothing : html`<div class="ab-empty">Nothing to show with these filters.</div>`}
      <div class="ab-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" @click=${() => this.zoomBy(1.2)}>+</button>
        <button type="button" aria-label="Zoom out" title="Zoom out (−)" @click=${() => this.zoomBy(1 / 1.2)}>−</button>
        <button type="button" aria-label="Fit to screen" title="Fit (0)" @click=${() => this.fit()}>⤢</button>
      </div>
      ${this.renderMinimap(nodes)}
      ${this.renderMenu()}
    </div>`;
  }
}

if (!customElements.get('ac-board')) {
  customElements.define('ac-board', AcBoard);
}
