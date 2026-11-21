import type { AcRevert } from '../../services/ziti-service';
import type { AcKind, AcOp } from './access-canvas.logic';
import type { BoardFilters } from './canvas-board.logic';

export type ToastFn = (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;

/** A change set queued on the canvas, not yet sent to the controller. */
export interface Pending {
  id: string;
  title: string;
  summary: string;
  ops: AcOp[];
  calls: string[];
  next?: string[];
}

/** A change set that was applied, with the steps that undo it. */
export interface Applied {
  title: string;
  reverts: AcRevert[];
}

/** Manual steps left after applying a change set (e.g. enrolling a new identity). */
export interface FollowUp {
  title: string;
  steps: string[];
}

export type DrawerKind = 'pending' | 'advisor';

export const KINDS: AcKind[] = ['identity', 'service', 'router'];

export const ENTITY_ROUTE: Record<AcKind, string> = {
  identity: '/identities',
  service: '/services',
  router: '/routers',
};

/** Console page for each policy hub family on the board. */
export const POLICY_ROUTE: Record<string, string> = {
  dial: '/service-policies',
  bind: '/service-policies',
  erp: '/router-policies',
  serp: '/service-router-policies',
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Filters that hide nothing. */
export const showEverything = (): BoardFilters => ({
  types: { identity: true, service: true, router: true },
  attrs: [],
  search: '',
  problemsOnly: false,
});
