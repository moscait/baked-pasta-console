// Identity create/edit form state <-> management API body, matching the upstream console's
// identity form (enrollment method, auth policy, external ID, hosting defaults, appData).

import {
  FormOutcome,
  formOutcome,
  formatJsonObject,
  parseJsonObject,
  parseWholeNumber,
  splitList,
} from '../../components/form-values';
import type { HostingPrecedence, Identity, JsonObject } from '../../services/api-types';

/** How a new identity enrolls: one-time token, one-time token + third-party CA, username/password, or not at all. */
export type EnrollmentMethod = 'ott' | 'ottca' | 'updb' | 'none';

export const ENROLLMENT_METHODS: { value: EnrollmentMethod; label: string }[] = [
  { value: 'ott', label: 'One-time token (JWT)' },
  { value: 'ottca', label: 'One-time token + third-party CA' },
  { value: 'updb', label: 'Username / password' },
  { value: 'none', label: 'None (enroll later)' },
];

export const HOSTING_PRECEDENCES: HostingPrecedence[] = ['default', 'required', 'failed'];

/** Terminator costs are 16-bit on the controller. */
export const MAX_HOSTING_COST = 65535;

export interface IdentityDraft {
  name: string;
  roleAttributes: string;
  isAdmin: boolean;
  enrollment: EnrollmentMethod;
  enrollmentCaId: string;
  enrollmentUsername: string;
  authPolicyId: string;
  externalId: string;
  defaultHostingCost: string;
  defaultHostingPrecedence: HostingPrecedence;
  appData: string;
}

export type IdentityEnrollment = { ott: true } | { ottca: string } | { updb: string } | Record<string, never>;

export interface IdentityBody {
  name: string;
  isAdmin: boolean;
  roleAttributes: string[];
  externalId: string | null;
  defaultHostingCost: number;
  defaultHostingPrecedence: HostingPrecedence;
  appData: JsonObject;
  authPolicyId?: string;
  type?: 'Default';
  enrollment?: IdentityEnrollment;
}

export function identityDraft(row?: Identity): IdentityDraft {
  return {
    name: row?.name || '',
    roleAttributes: (row?.roleAttributes || []).join(', '),
    isAdmin: !!row?.isAdmin,
    enrollment: 'ott',
    enrollmentCaId: '',
    enrollmentUsername: '',
    authPolicyId: row?.authPolicyId || row?.authPolicy?.id || '',
    externalId: row?.externalId || '',
    defaultHostingCost: String(row?.defaultHostingCost ?? 0),
    defaultHostingPrecedence: row?.defaultHostingPrecedence || 'default',
    appData: formatJsonObject(row?.appData),
  };
}

function enrollmentOf(d: IdentityDraft): IdentityEnrollment {
  switch (d.enrollment) {
    case 'ottca':
      return { ottca: d.enrollmentCaId };
    case 'updb':
      return { updb: d.enrollmentUsername.trim() };
    case 'none':
      return {};
    default:
      return { ott: true };
  }
}

/**
 * Enrollment and type are create-only. A blank auth policy is left to the controller default;
 * a blank external ID is sent as `null` so an edit can clear it.
 */
export function identityBody(d: IdentityDraft, isNew: boolean): FormOutcome<IdentityBody> {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push('Name is required.');
  if (isNew && d.enrollment === 'ottca' && !d.enrollmentCaId) errors.push('Choose the CA the identity will enroll with.');
  if (isNew && d.enrollment === 'updb' && !d.enrollmentUsername.trim()) errors.push('Enter the username to enroll.');
  const cost = parseWholeNumber(d.defaultHostingCost, 'Default hosting cost', { max: MAX_HOSTING_COST, fallback: 0 });
  if (!cost.ok) errors.push(cost.error);
  const appData = parseJsonObject(d.appData);
  if (!appData.ok) errors.push(`App data: ${appData.error}`);
  return formOutcome(errors, () => ({
    name: d.name.trim(),
    isAdmin: d.isAdmin,
    roleAttributes: splitList(d.roleAttributes),
    externalId: d.externalId.trim() || null,
    defaultHostingCost: cost.ok ? cost.value : 0,
    defaultHostingPrecedence: d.defaultHostingPrecedence,
    appData: appData.ok ? appData.value : {},
    ...(d.authPolicyId ? { authPolicyId: d.authPolicyId } : {}),
    ...(isNew ? { type: 'Default' as const, enrollment: enrollmentOf(d) } : {}),
  }));
}
