import { AcLayout } from './access-canvas.logic';

export interface LayoutStore {
  load(): AcLayout | null;
  save(layout: AcLayout): void;
}

export const LAYOUT_FILE_KIND = 'ziti-access-canvas-layout';

const KEY_PREFIX = 'ziti.access-canvas.layout.';

export function layoutStorageKey(controller: string): string {
  return KEY_PREFIX + (controller || 'default').trim().replace(/\/+$/, '').toLowerCase();
}

export function parseLayout(data: unknown): AcLayout | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { kind?: unknown; nodes?: unknown; groups?: unknown };
  if (d.kind !== undefined && d.kind !== LAYOUT_FILE_KIND) return null;
  if (!d.nodes || typeof d.nodes !== 'object' || Array.isArray(d.nodes)) return null;
  // Null prototype: a "__proto__" key in an imported file stays an ordinary key.
  const nodes: AcLayout['nodes'] = Object.create(null);
  for (const [k, v] of Object.entries(d.nodes)) {
    const p = v as { x?: unknown; y?: unknown } | null;
    if (p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      nodes[k] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }
  const groups = Array.isArray(d.groups) ? d.groups.filter((g: unknown) => typeof g === 'string') : [];
  return { v: 1, nodes, groups };
}

export function layoutFile(layout: AcLayout, controller: string): object {
  return {
    kind: LAYOUT_FILE_KIND,
    v: 1,
    controller,
    exportedAt: new Date().toISOString(),
    nodes: layout.nodes,
    groups: layout.groups || [],
  };
}

export class BrowserLayoutStore implements LayoutStore {
  constructor(
    private key: string,
    private storage: Storage | null = BrowserLayoutStore.local(),
  ) {}

  private static local(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  load(): AcLayout | null {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? parseLayout(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  save(layout: AcLayout): void {
    try {
      if (!Object.keys(layout.nodes).length && !(layout.groups || []).length) this.storage?.removeItem(this.key);
      else this.storage?.setItem(this.key, JSON.stringify({ v: 1, nodes: layout.nodes, groups: layout.groups || [] }));
    } catch (err) {
      console.warn('[access-canvas] could not keep the layout in this browser', err);
    }
  }
}
