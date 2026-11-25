// Edge and transit router form state <-> management API body.

import {
  FormOutcome,
  formOutcome,
  formatJsonObject,
  parseJsonObject,
  parseWholeNumber,
  splitList,
} from '../../components/form-values';
import type { EdgeRouter, JsonObject, TransitRouter } from '../../services/api-types';

export type RouterKind = 'edge-routers' | 'transit-routers';

/** Link costs are 16-bit on the controller. */
export const MAX_ROUTER_COST = 65535;

export interface RouterDraft {
  name: string;
  cost: string;
  noTraversal: boolean;
  /** Edge routers only. */
  roleAttributes: string;
  isTunnelerEnabled: boolean;
  appData: string;
}

export interface TransitRouterBody {
  name: string;
  cost: number;
  noTraversal: boolean;
}

export interface EdgeRouterBody extends TransitRouterBody {
  roleAttributes: string[];
  isTunnelerEnabled: boolean;
  appData: JsonObject;
}

export function routerDraft(row?: EdgeRouter | TransitRouter): RouterDraft {
  const edge: EdgeRouter | undefined = row && 'roleAttributes' in row ? row : undefined;
  return {
    name: row?.name || '',
    cost: String(row?.cost ?? 0),
    noTraversal: !!row?.noTraversal,
    roleAttributes: row ? (edge?.roleAttributes || []).join(', ') : 'public',
    isTunnelerEnabled: row ? !!edge?.isTunnelerEnabled : false,
    appData: formatJsonObject(edge?.appData),
  };
}

export function transitRouterBody(d: RouterDraft): FormOutcome<TransitRouterBody> {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push('Name is required.');
  const cost = parseWholeNumber(d.cost, 'Cost', { max: MAX_ROUTER_COST, fallback: 0 });
  if (!cost.ok) errors.push(cost.error);
  return formOutcome(errors, () => ({
    name: d.name.trim(),
    cost: cost.ok ? cost.value : 0,
    noTraversal: d.noTraversal,
  }));
}

export function edgeRouterBody(d: RouterDraft): FormOutcome<EdgeRouterBody> {
  const base = transitRouterBody(d);
  const appData = parseJsonObject(d.appData);
  const errors = [...(base.ok ? [] : base.errors), ...(appData.ok ? [] : [`App data: ${appData.error}`])];
  return formOutcome(errors, () => ({
    ...(base.ok ? base.body : { name: '', cost: 0, noTraversal: false }),
    roleAttributes: splitList(d.roleAttributes),
    isTunnelerEnabled: d.isTunnelerEnabled,
    appData: appData.ok ? appData.value : {},
  }));
}

/** Waiting for its first enrollment (or re-enrollment): a JWT is outstanding and it has never verified. */
export const awaitingEnrollment = (r: EdgeRouter | TransitRouter): boolean => !!r.enrollmentJwt && !r.isVerified;
