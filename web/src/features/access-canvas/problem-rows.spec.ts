import { describe, expect, it } from 'vitest';
import type { AcModel } from './access-canvas.logic';
import { emptyLayout } from './canvas-board.logic';
import { collectProblems, filterProblemRows } from './problem-rows';

// alice can dial "crm", but nobody hosts it; bob is not enrolled; the router is offline.
const model: AcModel = {
  identities: [
    { id: 'i-alice', name: 'alice', attrs: ['sales'], enrolled: true, online: true, isAdmin: false },
    { id: 'i-bob', name: 'bob', attrs: ['sales'], enrolled: false, online: false, isAdmin: false },
  ],
  services: [
    { id: 's-crm', name: 'crm', attrs: ['crm'], configs: [], encryptionRequired: true, terminatorStrategy: 'smartrouting' },
  ],
  routers: [{ id: 'r-1', name: 'edge-1', attrs: ['public'], online: false }],
  servicePolicies: [
    { id: 'p-dial', name: 'crm-dial', type: 'Dial', semantic: 'AnyOf', identityRoles: ['#sales'], serviceRoles: ['#crm'], posture: [] },
  ],
  erPolicies: [{ id: 'erp', name: 'all', semantic: 'AnyOf', identityRoles: ['#all'], routerRoles: ['#all'] }],
  serps: [{ id: 'serp', name: 'all', semantic: 'AnyOf', serviceRoles: ['#all'], routerRoles: ['#all'] }],
};

describe('problem rows', () => {
  const { rows, total } = collectProblems(model, emptyLayout());

  it('reports each problem once per entity, with a hint and a console route', () => {
    const byName = (name: string) => rows.filter((r) => r.name === name).map((r) => r.problem);
    expect(byName('crm')).toContain('Not hosted');
    expect(byName('bob')).toContain('Not enrolled');
    expect(byName('edge-1')).toContain('Offline');
    // bob appears in the #sales group but must be counted once.
    expect(rows.filter((r) => r.name === 'bob' && r.problem === 'Not enrolled')).toHaveLength(1);
    for (const r of rows) {
      expect(r.route).toMatch(/^\//);
      if (['Not hosted', 'Not enrolled', 'Offline'].includes(r.problem)) expect(r.hint).not.toBe('');
    }
  });

  it('counts distinct items, not problems', () => {
    const items = new Set(rows.map((r) => `${r.kind}:${r.name}`));
    expect(total).toBe(items.size);
    expect(rows.length).toBeGreaterThanOrEqual(total);
  });

  it('filters by kind, problem and text, and sorts both ways', () => {
    const services = filterProblemRows(rows, { q: '', kind: 'service', type: '' }, { col: 'type', dir: 1 });
    expect(services.every((r) => r.kind === 'service')).toBe(true);
    expect(filterProblemRows(rows, { q: 'BOB', kind: 'all', type: '' }, { col: 'name', dir: 1 }).every((r) => r.name === 'bob')).toBe(true);
    expect(filterProblemRows(rows, { q: '', kind: 'all', type: 'Offline' }, { col: 'name', dir: 1 }).map((r) => r.name)).toEqual(['edge-1']);

    const asc = filterProblemRows(rows, { q: '', kind: 'all', type: '' }, { col: 'name', dir: 1 }).map((r) => r.name);
    const desc = filterProblemRows(rows, { q: '', kind: 'all', type: '' }, { col: 'name', dir: -1 }).map((r) => r.name);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
    expect(desc).toEqual([...asc].reverse());
  });
});
