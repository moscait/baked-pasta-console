/**
 * Role-attribute index: which entities carry each `#attribute`, which policies select it,
 * and where the two disagree (a policy selecting an attribute nothing has, or an attribute
 * no policy uses). Pure, so the Attributes page and tests share it.
 */

import type {
  EdgeRouter,
  EdgeRouterPolicy,
  Identity,
  PostureCheck,
  Service,
  ServiceEdgeRouterPolicy,
  ServicePolicy,
} from '../../services/api-types';

export type AttrKind = 'identity' | 'service' | 'router' | 'posture';

export const ATTR_KIND_LABEL: Record<AttrKind, string> = {
  identity: 'identities',
  service: 'services',
  router: 'edge routers',
  posture: 'posture checks',
};

export interface AttrMember {
  id: string;
  name: string;
}

export interface AttrPolicyRef {
  policyId: string;
  policyName: string;
  /** e.g. "Dial service policy", "Edge router policy". */
  policyType: string;
  /** Which kind of entity this role list selects. */
  selects: AttrKind;
}

export interface AttributeRow {
  /** The attribute name, without `#`. Used as the row id. */
  id: string;
  name: string;
  members: Record<AttrKind, AttrMember[]>;
  refs: AttrPolicyRef[];
  /** Policies that select this attribute for a kind no entity of which carries it. */
  dangling: AttrPolicyRef[];
  /** True when nothing selects this attribute (members exist but no policy uses it). */
  unused: boolean;
}

export interface AttributeInput {
  identities: Identity[];
  services: Service[];
  edgeRouters: EdgeRouter[];
  postureChecks: PostureCheck[];
  servicePolicies: ServicePolicy[];
  edgeRouterPolicies: EdgeRouterPolicy[];
  serviceEdgeRouterPolicies: ServiceEdgeRouterPolicy[];
}

/** `#name` role entries; `@id` (direct) entries and the `#all` wildcard select no attribute. */
function attrRoles(roles?: string[]): string[] {
  return (roles || [])
    .filter((r) => r.startsWith('#') && r !== '#all')
    .map((r) => r.slice(1))
    .filter(Boolean);
}

export function buildAttributeIndex(input: AttributeInput): AttributeRow[] {
  const rows = new Map<string, AttributeRow>();
  const row = (name: string): AttributeRow => {
    let r = rows.get(name);
    if (!r) {
      r = {
        id: name,
        name,
        members: { identity: [], service: [], router: [], posture: [] },
        refs: [],
        dangling: [],
        unused: false,
      };
      rows.set(name, r);
    }
    return r;
  };

  const addMembers = (kind: AttrKind, list: { id: string; name: string; roleAttributes?: string[] }[]) => {
    for (const e of list) {
      for (const a of new Set(e.roleAttributes || [])) row(a).members[kind].push({ id: e.id, name: e.name });
    }
  };
  addMembers('identity', input.identities);
  addMembers('service', input.services);
  addMembers('router', input.edgeRouters);
  addMembers('posture', input.postureChecks);

  const addRefs = (
    policy: { id: string; name: string },
    policyType: string,
    selects: AttrKind,
    roles?: string[],
  ) => {
    for (const a of new Set(attrRoles(roles))) {
      row(a).refs.push({ policyId: policy.id, policyName: policy.name, policyType, selects });
    }
  };
  for (const p of input.servicePolicies) {
    const t = `${p.type} service policy`;
    addRefs(p, t, 'identity', p.identityRoles);
    addRefs(p, t, 'service', p.serviceRoles);
    addRefs(p, t, 'posture', p.postureCheckRoles);
  }
  for (const p of input.edgeRouterPolicies) {
    if (p.isSystem) continue;
    addRefs(p, 'Edge router policy', 'identity', p.identityRoles);
    addRefs(p, 'Edge router policy', 'router', p.edgeRouterRoles);
  }
  for (const p of input.serviceEdgeRouterPolicies) {
    if (p.isSystem) continue;
    addRefs(p, 'Service edge router policy', 'service', p.serviceRoles);
    addRefs(p, 'Service edge router policy', 'router', p.edgeRouterRoles);
  }

  for (const r of rows.values()) {
    r.dangling = r.refs.filter((ref) => r.members[ref.selects].length === 0);
    r.unused = r.refs.length === 0;
    for (const k of Object.keys(r.members) as AttrKind[]) {
      r.members[k].sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function memberCount(r: AttributeRow): number {
  return r.members.identity.length + r.members.service.length + r.members.router.length + r.members.posture.length;
}
