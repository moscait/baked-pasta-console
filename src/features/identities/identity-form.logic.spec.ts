import { describe, expect, it } from 'vitest';
import { identityBody, identityDraft } from './identity-form.logic';

describe('identityBody', () => {
  it('creates a Default identity with a one-time token by default', () => {
    const r = identityBody({ ...identityDraft(), name: 'laptop', roleAttributes: '#sales ops' }, true);
    expect(r).toEqual({
      ok: true,
      body: {
        name: 'laptop',
        isAdmin: false,
        roleAttributes: ['sales', 'ops'],
        externalId: null,
        defaultHostingCost: 0,
        defaultHostingPrecedence: 'default',
        appData: {},
        type: 'Default',
        enrollment: { ott: true },
      },
    });
  });

  it.each([
    ['ottca', { enrollmentCaId: 'ca1' }, { ottca: 'ca1' }],
    ['updb', { enrollmentUsername: ' jdoe ' }, { updb: 'jdoe' }],
    ['none', {}, {}],
  ] as const)('builds %s enrollment', (enrollment, extra, expected) => {
    const r = identityBody({ ...identityDraft(), name: 'x', enrollment, ...extra }, true);
    expect(r.ok && r.body.enrollment).toEqual(expected);
  });

  it('requires the CA or username its enrollment method needs', () => {
    expect(identityBody({ ...identityDraft(), name: 'x', enrollment: 'ottca' }, true)).toEqual({
      ok: false,
      errors: ['Choose the CA the identity will enroll with.'],
    });
    expect(identityBody({ ...identityDraft(), name: 'x', enrollment: 'updb' }, true).ok).toBe(false);
  });

  it('leaves enrollment and type out of an edit and keeps existing fields', () => {
    const row = {
      id: 'i1',
      name: 'host',
      isAdmin: true,
      roleAttributes: ['db'],
      authPolicyId: 'ap1',
      externalId: 'host@corp',
      defaultHostingCost: 10,
      defaultHostingPrecedence: 'required' as const,
      appData: { owner: 'ops' },
    };
    expect(identityBody(identityDraft(row), false)).toEqual({
      ok: true,
      body: {
        name: 'host',
        isAdmin: true,
        roleAttributes: ['db'],
        authPolicyId: 'ap1',
        externalId: 'host@corp',
        defaultHostingCost: 10,
        defaultHostingPrecedence: 'required',
        appData: { owner: 'ops' },
      },
    });
  });

  it('rejects bad hosting cost and app data', () => {
    const r = identityBody({ ...identityDraft(), name: 'x', defaultHostingCost: '-3', appData: '{oops' }, false);
    expect(r.ok ? [] : r.errors.map((e) => e.slice(0, 24))).toEqual([
      'Default hosting cost mus',
      'App data: Not valid JSON',
    ]);
  });
});
