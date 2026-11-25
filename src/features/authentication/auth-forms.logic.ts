// Form state <-> management API bodies for certificate authorities, auth policies and external
// JWT signers. Field names and rules follow openziti/edge-api and the upstream console's forms.

import {
  FormOutcome,
  formOutcome,
  isHttpUrl,
  looksLikePemCertificate,
  parseWholeNumber,
  splitList,
} from '../../components/form-values';
import type {
  AuthPolicy,
  CaClaimLocation,
  CaClaimMatcher,
  CaClaimParser,
  CaExternalIdClaim,
  CertificateAuthority,
  ExternalJwtSigner,
  JwtTargetToken,
} from '../../services/api-types';

// ------------------------------------------------------------------ certificate authorities

export const DEFAULT_IDENTITY_NAME_FORMAT = '[caName]-[commonName]';
export const CA_CLAIM_LOCATIONS: CaClaimLocation[] = ['COMMON_NAME', 'SAN_URI', 'SAN_EMAIL'];
export const CA_CLAIM_MATCHERS: CaClaimMatcher[] = ['ALL', 'PREFIX', 'SUFFIX', 'SCHEME'];
export const CA_CLAIM_PARSERS: CaClaimParser[] = ['NONE', 'SPLIT'];

export interface CaDraft {
  name: string;
  certPem: string;
  identityRoles: string;
  identityNameFormat: string;
  isAutoCaEnrollmentEnabled: boolean;
  isOttCaEnrollmentEnabled: boolean;
  isAuthEnabled: boolean;
  useExternalIdClaim: boolean;
  claimLocation: CaClaimLocation;
  claimMatcher: CaClaimMatcher;
  claimMatcherCriteria: string;
  claimParser: CaClaimParser;
  claimParserCriteria: string;
  claimIndex: string;
}

export interface CaBody {
  name: string;
  certPem?: string;
  identityRoles: string[];
  identityNameFormat: string;
  isAutoCaEnrollmentEnabled: boolean;
  isOttCaEnrollmentEnabled: boolean;
  isAuthEnabled: boolean;
  externalIdClaim: CaExternalIdClaim | null;
}

export function caDraft(ca?: CertificateAuthority): CaDraft {
  const claim = ca?.externalIdClaim;
  return {
    name: ca?.name || '',
    certPem: '',
    identityRoles: (ca?.identityRoles || []).join(', '),
    identityNameFormat: ca?.identityNameFormat || DEFAULT_IDENTITY_NAME_FORMAT,
    isAutoCaEnrollmentEnabled: ca?.isAutoCaEnrollmentEnabled ?? true,
    isOttCaEnrollmentEnabled: ca?.isOttCaEnrollmentEnabled ?? true,
    isAuthEnabled: ca?.isAuthEnabled ?? true,
    useExternalIdClaim: !!claim,
    claimLocation: claim?.location || 'COMMON_NAME',
    claimMatcher: claim?.matcher || 'ALL',
    claimMatcherCriteria: claim?.matcherCriteria || '',
    claimParser: claim?.parser || 'NONE',
    claimParserCriteria: claim?.parserCriteria || '',
    claimIndex: String(claim?.index ?? 0),
  };
}

/** The certificate is only sent on create; the controller does not allow changing it. */
export function caBody(d: CaDraft, isNew: boolean): FormOutcome<CaBody> {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push('Name is required.');
  if (isNew && !looksLikePemCertificate(d.certPem)) errors.push('Paste the CA certificate in PEM format.');
  if (!d.identityNameFormat.trim()) errors.push('Identity name format is required.');
  const index = parseWholeNumber(d.claimIndex, 'Claim index', { fallback: 0 });
  if (d.useExternalIdClaim) {
    if (d.claimMatcher !== 'ALL' && !d.claimMatcherCriteria.trim()) {
      errors.push(`Matcher ${d.claimMatcher} needs match criteria.`);
    }
    if (d.claimParser === 'SPLIT' && !d.claimParserCriteria) errors.push('The SPLIT parser needs a separator.');
    if (!index.ok) errors.push(index.error);
  }
  return formOutcome(errors, () => ({
    name: d.name.trim(),
    ...(isNew ? { certPem: d.certPem.trim() } : {}),
    identityRoles: splitList(d.identityRoles),
    identityNameFormat: d.identityNameFormat.trim(),
    isAutoCaEnrollmentEnabled: d.isAutoCaEnrollmentEnabled,
    isOttCaEnrollmentEnabled: d.isOttCaEnrollmentEnabled,
    isAuthEnabled: d.isAuthEnabled,
    externalIdClaim: d.useExternalIdClaim
      ? {
          location: d.claimLocation,
          matcher: d.claimMatcher,
          matcherCriteria: d.claimMatcher === 'ALL' ? '' : d.claimMatcherCriteria.trim(),
          parser: d.claimParser,
          parserCriteria: d.claimParser === 'SPLIT' ? d.claimParserCriteria : '',
          index: index.ok ? index.value : 0,
        }
      : null,
  }));
}

/** openssl steps that produce the verification certificate for an unverified CA. */
export function caVerifyInstructions(ca: CertificateAuthority): string {
  const token = ca.verificationToken || '<verificationToken>';
  return [
    `# Sign a certificate whose common name is the CA's verification token, using the CA's own key:`,
    `openssl req -new -newkey rsa:2048 -nodes -keyout verify.key -subj "/CN=${token}" -out verify.csr`,
    `openssl x509 -req -in verify.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 1 -out verify.pem`,
  ].join('\n');
}

// ------------------------------------------------------------------ auth policies

export interface AuthPolicyDraft {
  name: string;
  certAllowed: boolean;
  certAllowExpired: boolean;
  updbAllowed: boolean;
  minPasswordLength: string;
  requireMixedCase: boolean;
  requireNumberChar: boolean;
  requireSpecialChar: boolean;
  maxAttempts: string;
  lockoutDurationMinutes: string;
  extJwtAllowed: boolean;
  allowedSigners: string[];
  requireTotp: boolean;
  requireExtJwtSigner: string;
}

export interface AuthPolicyBody {
  name: string;
  primary: {
    cert: { allowed: boolean; allowExpiredCerts: boolean };
    updb: {
      allowed: boolean;
      minPasswordLength: number;
      requireMixedCase: boolean;
      requireNumberChar: boolean;
      requireSpecialChar: boolean;
      maxAttempts: number;
      lockoutDurationMinutes: number;
    };
    extJwt: { allowed: boolean; allowedSigners: string[] };
  };
  secondary: { requireTotp: boolean; requireExtJwtSigner: string | null };
}

/** The controller rejects passwords shorter than this regardless of policy. */
export const MIN_PASSWORD_LENGTH = 5;

export function authPolicyDraft(p?: AuthPolicy): AuthPolicyDraft {
  const updb = p?.primary?.updb;
  return {
    name: p?.name || '',
    certAllowed: p?.primary?.cert?.allowed ?? true,
    certAllowExpired: p?.primary?.cert?.allowExpiredCerts ?? true,
    updbAllowed: updb?.allowed ?? true,
    minPasswordLength: String(updb?.minPasswordLength ?? MIN_PASSWORD_LENGTH),
    requireMixedCase: updb?.requireMixedCase ?? false,
    requireNumberChar: updb?.requireNumberChar ?? false,
    requireSpecialChar: updb?.requireSpecialChar ?? false,
    maxAttempts: String(updb?.maxAttempts ?? 0),
    lockoutDurationMinutes: String(updb?.lockoutDurationMinutes ?? 0),
    extJwtAllowed: p?.primary?.extJwt?.allowed ?? true,
    allowedSigners: p?.primary?.extJwt?.allowedSigners || [],
    requireTotp: p?.secondary?.requireTotp ?? false,
    requireExtJwtSigner: p?.secondary?.requireExtJwtSigner || '',
  };
}

export function authPolicyBody(d: AuthPolicyDraft): FormOutcome<AuthPolicyBody> {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push('Name is required.');
  if (!d.certAllowed && !d.updbAllowed && !d.extJwtAllowed) {
    errors.push('Allow at least one primary sign-in method, or identities on this policy can never sign in.');
  }
  const minLen = parseWholeNumber(d.minPasswordLength, 'Minimum password length', { min: MIN_PASSWORD_LENGTH, max: 1024 });
  const attempts = parseWholeNumber(d.maxAttempts, 'Max attempts', { fallback: 0 });
  const lockout = parseWholeNumber(d.lockoutDurationMinutes, 'Lockout duration', { fallback: 0 });
  for (const r of [minLen, attempts, lockout]) if (!r.ok) errors.push(r.error);
  return formOutcome(errors, () => ({
    name: d.name.trim(),
    primary: {
      cert: { allowed: d.certAllowed, allowExpiredCerts: d.certAllowExpired },
      updb: {
        allowed: d.updbAllowed,
        minPasswordLength: minLen.ok ? minLen.value : MIN_PASSWORD_LENGTH,
        requireMixedCase: d.requireMixedCase,
        requireNumberChar: d.requireNumberChar,
        requireSpecialChar: d.requireSpecialChar,
        maxAttempts: attempts.ok ? attempts.value : 0,
        lockoutDurationMinutes: lockout.ok ? lockout.value : 0,
      },
      extJwt: { allowed: d.extJwtAllowed, allowedSigners: d.extJwtAllowed ? d.allowedSigners : [] },
    },
    secondary: { requireTotp: d.requireTotp, requireExtJwtSigner: d.requireExtJwtSigner || null },
  }));
}

// ------------------------------------------------------------------ external JWT signers

export type JwtKeySource = 'jwks' | 'cert';

export interface JwtSignerDraft {
  name: string;
  issuer: string;
  audience: string;
  enabled: boolean;
  keySource: JwtKeySource;
  jwksEndpoint: string;
  certPem: string;
  kid: string;
  claimsProperty: string;
  useExternalId: boolean;
  clientId: string;
  scopes: string;
  externalAuthUrl: string;
  targetToken: JwtTargetToken;
  enrollToCertEnabled: boolean;
  enrollToTokenEnabled: boolean;
  enrollNameClaimsSelector: string;
  enrollAttributeClaimsSelector: string;
  enrollAuthPolicyId: string;
}

export interface JwtSignerBody {
  name: string;
  issuer: string;
  audience: string;
  enabled: boolean;
  jwksEndpoint: string | null;
  certPem: string | null;
  kid: string | null;
  claimsProperty: string;
  useExternalId: boolean;
  clientId: string | null;
  scopes: string[];
  externalAuthUrl: string | null;
  targetToken: JwtTargetToken;
  enrollToCertEnabled: boolean;
  enrollToTokenEnabled: boolean;
  enrollNameClaimsSelector: string;
  enrollAttributeClaimsSelector: string;
  enrollAuthPolicyId: string;
}

export function jwtSignerDraft(s?: ExternalJwtSigner): JwtSignerDraft {
  return {
    name: s?.name || '',
    issuer: s?.issuer || '',
    audience: s?.audience || '',
    enabled: s?.enabled ?? true,
    keySource: s?.certPem && !s.jwksEndpoint ? 'cert' : 'jwks',
    jwksEndpoint: s?.jwksEndpoint || '',
    certPem: s?.certPem || '',
    kid: s?.kid || '',
    claimsProperty: s?.claimsProperty || 'sub',
    useExternalId: s?.useExternalId ?? false,
    clientId: s?.clientId || '',
    scopes: (s?.scopes || []).join(' '),
    externalAuthUrl: s?.externalAuthUrl || '',
    targetToken: s?.targetToken || 'ACCESS',
    enrollToCertEnabled: s?.enrollToCertEnabled ?? false,
    enrollToTokenEnabled: s?.enrollToTokenEnabled ?? false,
    enrollNameClaimsSelector: s?.enrollNameClaimsSelector || '',
    enrollAttributeClaimsSelector: s?.enrollAttributeClaimsSelector || '',
    enrollAuthPolicyId: s?.enrollAuthPolicyId || '',
  };
}

/** Unset optional fields are sent as `null` so that clearing one in an edit really clears it. */
export function jwtSignerBody(d: JwtSignerDraft): FormOutcome<JwtSignerBody> {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push('Name is required.');
  if (!d.issuer.trim()) errors.push('Issuer is required.');
  if (!d.audience.trim()) errors.push('Audience is required.');
  if (d.keySource === 'jwks' && !isHttpUrl(d.jwksEndpoint)) errors.push('JWKS endpoint must be an http(s) URL.');
  if (d.keySource === 'cert' && !looksLikePemCertificate(d.certPem)) {
    errors.push('Paste the signing certificate in PEM format.');
  }
  if (d.externalAuthUrl.trim() && !isHttpUrl(d.externalAuthUrl)) errors.push('External auth URL must be an http(s) URL.');
  if (!d.claimsProperty.trim()) errors.push('Claims property is required (usually "sub").');
  const optional = (v: string) => v.trim() || null;
  return formOutcome(errors, () => ({
    name: d.name.trim(),
    issuer: d.issuer.trim(),
    audience: d.audience.trim(),
    enabled: d.enabled,
    jwksEndpoint: d.keySource === 'jwks' ? d.jwksEndpoint.trim() : null,
    certPem: d.keySource === 'cert' ? d.certPem.trim() : null,
    kid: d.keySource === 'cert' ? optional(d.kid) : null,
    claimsProperty: d.claimsProperty.trim(),
    useExternalId: d.useExternalId,
    clientId: optional(d.clientId),
    scopes: d.scopes.split(/[,\s]+/).filter(Boolean),
    externalAuthUrl: optional(d.externalAuthUrl),
    targetToken: d.targetToken,
    enrollToCertEnabled: d.enrollToCertEnabled,
    enrollToTokenEnabled: d.enrollToTokenEnabled,
    enrollNameClaimsSelector: d.enrollNameClaimsSelector.trim(),
    enrollAttributeClaimsSelector: d.enrollAttributeClaimsSelector.trim(),
    enrollAuthPolicyId: d.enrollAuthPolicyId,
  }));
}
