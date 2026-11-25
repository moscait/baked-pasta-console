import { describe, expect, it } from 'vitest';
import { buildAttributeIndex, memberCount } from './attributes.logic';

const base = {
  identities: [
    { id: 'i1', name: 'alice', roleAttributes: ['sales', 'employees'] },
    { id: 'i2', name: 'bob', roleAttributes: ['employees'] },
  ],
  services: [{ id: 's1', name: 'crm', roleAttributes: ['crm'] }],
  edgeRouters: [{ id: 'r1', name: 'edge-1', roleAttributes: ['public'] }],
  postureChecks: [{ id: 'pc1', name: 'mfa', typeId: 'MFA', roleAttributes: ['mfa'] }],
  servicePolicies: [
    {
      id: 'sp1',
      name: 'crm-dial',
      type: 'Dial' as const,
      identityRoles: ['#sales', '#contractors', '@i2'],
      serviceRoles: ['#crm'],
      postureCheckRoles: ['#mfa'],
    },
  ],
  edgeRouterPolicies: [
    { id: 'erp1', name: 'all-public', identityRoles: ['#all'], edgeRouterRoles: ['#public'] },
    { id: 'erp-sys', name: 'system', isSystem: true, identityRoles: ['#ghost'], edgeRouterRoles: [] },
  ],
  serviceEdgeRouterPolicies: [],
};

describe('attribute index', () => {
  const rows = buildAttributeIndex(base);
  const by = (n: string) => rows.find((r) => r.name === n)!;

  it('lists every attribute carried or selected, sorted by name', () => {
    expect(rows.map((r) => r.name)).toEqual(['contractors', 'crm', 'employees', 'mfa', 'public', 'sales']);
  });

  it('collects members per entity kind', () => {
    expect(by('employees').members.identity.map((m) => m.name)).toEqual(['alice', 'bob']);
    expect(memberCount(by('employees'))).toBe(2);
    expect(by('mfa').members.posture).toHaveLength(1);
  });

  it('records which policy selects the attribute and for which kind', () => {
    expect(by('crm').refs).toEqual([
      { policyId: 'sp1', policyName: 'crm-dial', policyType: 'Dial service policy', selects: 'service' },
    ]);
  });

  it('ignores #all, @id entries and system policies', () => {
    expect(rows.find((r) => r.name === 'all')).toBeUndefined();
    expect(rows.find((r) => r.name === 'ghost')).toBeUndefined();
    expect(rows.find((r) => r.name === 'i2')).toBeUndefined();
  });

  it('flags policies that select an attribute nothing carries', () => {
    expect(by('contractors').dangling.map((d) => d.policyName)).toEqual(['crm-dial']);
    expect(by('sales').dangling).toEqual([]);
  });

  it('flags attributes that no policy selects', () => {
    expect(by('employees').unused).toBe(true);
    expect(by('sales').unused).toBe(false);
  });
});
