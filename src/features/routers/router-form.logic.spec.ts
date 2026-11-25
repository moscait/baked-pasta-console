import { describe, expect, it } from 'vitest';
import { awaitingEnrollment, edgeRouterBody, routerDraft, transitRouterBody } from './router-form.logic';

describe('router forms', () => {
  it('starts a new edge router on #public with the tunneler off', () => {
    const r = edgeRouterBody({ ...routerDraft(), name: ' er-1 ' });
    expect(r).toEqual({
      ok: true,
      body: { name: 'er-1', cost: 0, noTraversal: false, roleAttributes: ['public'], isTunnelerEnabled: false, appData: {} },
    });
  });

  it('round-trips an existing edge router', () => {
    const row = {
      id: 'er',
      name: 'er',
      cost: 7,
      noTraversal: true,
      roleAttributes: ['eu'],
      isTunnelerEnabled: true,
      appData: { rack: 'b4' },
    };
    const r = edgeRouterBody(routerDraft(row));
    expect(r).toEqual({ ok: true, body: { name: 'er', cost: 7, noTraversal: true, roleAttributes: ['eu'], isTunnelerEnabled: true, appData: { rack: 'b4' } } });
  });

  it('collects errors from cost and app data together', () => {
    const r = edgeRouterBody({ ...routerDraft(), name: 'er', cost: '70000', appData: '[]' });
    expect(r.ok ? [] : r.errors).toEqual([
      'Cost must be between 0 and 65535.',
      'App data: Must be a JSON object, e.g. { "key": "value" }.',
    ]);
  });

  it('builds a transit router body without edge-only fields', () => {
    const r = transitRouterBody({ ...routerDraft({ id: 't', name: 't', cost: 3 }), noTraversal: true });
    expect(r).toEqual({ ok: true, body: { name: 't', cost: 3, noTraversal: true } });
  });

  it('flags routers waiting on a JWT', () => {
    expect(awaitingEnrollment({ id: 'r', name: 'r', enrollmentJwt: 'x', isVerified: false })).toBe(true);
    expect(awaitingEnrollment({ id: 'r', name: 'r', enrollmentJwt: 'x', isVerified: true })).toBe(false);
    expect(awaitingEnrollment({ id: 'r', name: 'r' })).toBe(false);
  });
});
