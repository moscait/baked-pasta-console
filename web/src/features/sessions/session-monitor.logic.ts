/**
 * Pure, framework-free session correlation, client-IP/CIDR traffic filtering, and concurrent
 * identity session detection for OpenZiti networks.
 *
 * No DOM, React, or browser storage globals are referenced here.
 */

import type { ApiSession, Authenticator, Identity, Session } from '../../services/api-types';

export type IdentityAuthMethod = 'cert' | 'ext-jwt' | 'updb' | 'unknown';
export type ConcurrencySeverity = 'warning' | 'critical';
export type RemediationAction =
  | 'warn'
  | 'terminate-newer-sessions'
  | 'terminate-all-sessions'
  | 'revoke-authenticators';

export type SessionConcurrencyState =
  | 'single'
  | 'stale'
  | 'exempt-multi'
  | 'concurrent-same-ip'
  | 'concurrent-multi-ip';

export type ConcurrencyFilterMode = 'all' | 'concurrent-any' | 'concurrent-multi-ip' | 'concurrent-same-ip';

/**
 * Policy governing what counts as "concurrent" sessions on a single OpenZiti identity.
 */
export interface ConcurrencyPolicy {
  /**
   * Maximum age (in seconds) since `lastActivityAt` / `cachedLastActivityAt` (falling back to
   * `updatedAt`/`createdAt`) for an API session to count as live. `0` disables age filtering.
   */
  activeWithinSeconds: number;
  /**
   * Maximum time gap (in seconds) from the newest active session on the same identity for
   * another session to join the concurrent cluster. Filters sequential Wi-Fi -> cellular
   * handoffs where the previous session has gone quiet. `null` disables skew clustering.
   */
  maxActivitySkewSeconds: number | null;
  /** Minimum clustered concurrent sessions on one identity required to raise a finding (>= 2). */
  minConcurrentSessions: number;
  /** When true, only flag concurrent sessions if they span >= 2 distinct client IPs. */
  requireDistinctIps: boolean;
  /** When true, admin identities (`isAdmin` / `isDefaultAdmin`) are exempted so console/CLI admins don't self-lockout. */
  exemptAdminIdentities: boolean;
  /** When true, identities mapped via `externalId` (OIDC / External JWT SSO) are exempted. */
  exemptExternalIdentities: boolean;
  /** Role attributes (without `#`) that opt an identity out of concurrency alerts. */
  exemptRoleAttributes: string[];
  /** Explicit identity IDs opted out of concurrency alerts. */
  exemptIdentityIds: string[];
  /** Default/recommended action for concurrent sessions from a single IP. */
  sameIpAction: RemediationAction;
  /** Default/recommended action for concurrent sessions across >= 2 distinct IPs. */
  multiIpAction: RemediationAction;
}

export const DEFAULT_CONCURRENCY_POLICY: ConcurrencyPolicy = {
  activeWithinSeconds: 300,
  maxActivitySkewSeconds: 120,
  minConcurrentSessions: 2,
  requireDistinctIps: false,
  exemptAdminIdentities: true,
  exemptExternalIdentities: true,
  exemptRoleAttributes: ['multi-device'],
  exemptIdentityIds: [],
  sameIpAction: 'warn',
  multiIpAction: 'warn',
};

export interface RemediationStep {
  method: 'DELETE';
  /** Relative path under `/edge/management/v1/`. */
  path: string;
  collection: 'api-sessions' | 'sessions' | 'authenticators';
  targetId: string;
  reason: string;
}

export interface RemediationPlan {
  steps: RemediationStep[];
  error?: string;
}

export interface ConcurrentSessionSnapshot {
  apiSessionId: string;
  ipAddress: string | null;
  createdAt: string | null;
  activityAt: string | null;
  ageSeconds: number | null;
  services: string[];
  isCurrentSession: boolean;
}

export interface ConcurrencyFinding {
  identityId: string;
  identityName: string;
  roleAttributes: string[];
  authMethod: IdentityAuthMethod;
  severity: ConcurrencySeverity;
  concurrentSessionCount: number;
  totalSessionCount: number;
  distinctIps: string[];
  concurrentSessions: ConcurrentSessionSnapshot[];
  /** Maximum gap (ms) across the clustered concurrent sessions, when timestamps are present. */
  activitySkewMs: number | null;
  recommendedAction: RemediationAction;
  remediationSteps: RemediationStep[];
  summary: string;
}

export interface EnrichedServiceRef {
  sessionId: string;
  serviceId: string;
  serviceName: string;
  type: 'Dial' | 'Bind';
  routers: string[];
  createdAt: string | null;
}

export interface EnrichedApiSession {
  id: string;
  identityId: string;
  identityName: string;
  isAdmin: boolean;
  roleAttributes: string[];
  authMethod: IdentityAuthMethod;
  isExternalIdentity: boolean;
  authenticatorId: string | null;
  ipAddress: string | null;
  rawIpAddress: string | null;
  createdAt: string | null;
  activityAt: string | null;
  ageSeconds: number | null;
  isActiveInWindow: boolean;
  isCurrentSession: boolean;
  concurrencyState: SessionConcurrencyState;
  services: EnrichedServiceRef[];
}

export interface ServiceFlowRow {
  id: string;
  sessionId: string;
  apiSessionId: string | null;
  identityId: string;
  identityName: string;
  roleAttributes: string[];
  authMethod: IdentityAuthMethod;
  ipAddress: string | null;
  serviceId: string;
  serviceName: string;
  type: 'Dial' | 'Bind';
  routers: string[];
  activityAt: string | null;
  ageSeconds: number | null;
  isCurrentSession: boolean;
  concurrencyState: SessionConcurrencyState;
  findingSeverity: ConcurrencySeverity | null;
}

export interface IdentitySessionSummary {
  identityId: string;
  identityName: string;
  isAdmin: boolean;
  roleAttributes: string[];
  authMethod: IdentityAuthMethod;
  isExternalIdentity: boolean;
  totalSessionCount: number;
  liveSessionCount: number;
  distinctLiveIps: string[];
  allIps: string[];
  activeServiceIds: string[];
  activeServiceNames: string[];
  concurrencyState: SessionConcurrencyState;
  finding: ConcurrencyFinding | null;
}

export interface SessionMonitorReport {
  evaluatedAt: string;
  nowMs: number;
  policy: ConcurrencyPolicy;
  apiSessions: EnrichedApiSession[];
  serviceFlows: ServiceFlowRow[];
  identities: IdentitySessionSummary[];
  byIdentity: Map<string, IdentitySessionSummary>;
  findings: ConcurrencyFinding[];
}

export interface SessionMonitorInput {
  identities: Identity[];
  apiSessions: ApiSession[];
  sessions: Session[];
  authenticators?: Authenticator[];
  policy?: Partial<ConcurrencyPolicy>;
  /** Active `zt-session` token of the caller (if any), protected from accidental termination. */
  currentSessionToken?: string | null;
  now?: number | string;
}

export interface TrafficFilter {
  search: string;
  ipFilter: string;
  serviceId: string;
  roleAttribute: string;
  sessionType: 'all' | 'Dial' | 'Bind';
  concurrency: ConcurrencyFilterMode;
}

export const DEFAULT_TRAFFIC_FILTER = (): TrafficFilter => ({
  search: '',
  ipFilter: '',
  serviceId: 'all',
  roleAttribute: '',
  sessionType: 'all',
  concurrency: 'all',
});

// ------------------------------------------------------------------ policy normalization

const VALID_ACTIONS = new Set<RemediationAction>([
  'warn',
  'terminate-newer-sessions',
  'terminate-all-sessions',
  'revoke-authenticators',
]);

function normalizeAction(raw: unknown): RemediationAction {
  if (raw === 'terminate-older-sessions') return 'terminate-newer-sessions';
  return typeof raw === 'string' && VALID_ACTIONS.has(raw as RemediationAction)
    ? (raw as RemediationAction)
    : 'warn';
}

export function normalizeConcurrencyPolicy(partial?: Partial<ConcurrencyPolicy>): ConcurrencyPolicy {
  const base = { ...DEFAULT_CONCURRENCY_POLICY, ...partial };
  const activeWithinSeconds = Number.isFinite(base.activeWithinSeconds)
    ? Math.max(0, Math.round(base.activeWithinSeconds))
    : DEFAULT_CONCURRENCY_POLICY.activeWithinSeconds;
  const maxActivitySkewSeconds =
    base.maxActivitySkewSeconds === null || base.maxActivitySkewSeconds === undefined
      ? null
      : Number.isFinite(base.maxActivitySkewSeconds) && base.maxActivitySkewSeconds > 0
        ? Math.round(base.maxActivitySkewSeconds)
        : null;
  const minConcurrentSessions = Number.isFinite(base.minConcurrentSessions)
    ? Math.max(2, Math.round(base.minConcurrentSessions))
    : 2;
  const cleanAttrs = (base.exemptRoleAttributes || [])
    .map((a) => a.trim().replace(/^#/, ''))
    .filter(Boolean);
  const cleanIds = (base.exemptIdentityIds || []).map((id) => id.trim()).filter(Boolean);
  return {
    activeWithinSeconds,
    maxActivitySkewSeconds,
    minConcurrentSessions,
    requireDistinctIps: !!base.requireDistinctIps,
    exemptAdminIdentities: base.exemptAdminIdentities !== false,
    exemptExternalIdentities: !!base.exemptExternalIdentities,
    exemptRoleAttributes: [...new Set(cleanAttrs)],
    exemptIdentityIds: [...new Set(cleanIds)],
    sameIpAction: normalizeAction(base.sameIpAction),
    multiIpAction: normalizeAction(base.multiIpAction),
  };
}

// ------------------------------------------------------------------ IP & CIDR parsing

/**
 * Strips port suffixes (`1.2.3.4:54321`, `[2001:db8::1]:443`) and unwraps IPv4-mapped IPv6
 * (`::ffff:1.2.3.4`) so addresses compare consistently across controller builds.
 */
export function normalizeIp(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close > 1) s = s.slice(1, close);
  } else {
    const firstColon = s.indexOf(':');
    const lastColon = s.lastIndexOf(':');
    if (firstColon > 0 && firstColon === lastColon) {
      const maybeIpv4 = s.slice(0, firstColon);
      if (parseIpv4(maybeIpv4) !== null) s = maybeIpv4;
    }
  }
  const mappedPrefix = '::ffff:';
  if (s.toLowerCase().startsWith(mappedPrefix)) {
    const tail = s.slice(mappedPrefix.length);
    if (parseIpv4(tail) !== null) return tail;
  }
  return s;
}

export function parseIpv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = ((out << 8) | n) >>> 0;
  }
  return out >>> 0;
}

export function parseIpv6(ip: string): bigint | null {
  const zoneIdx = ip.indexOf('%');
  const clean = (zoneIdx >= 0 ? ip.slice(0, zoneIdx) : ip).trim().toLowerCase();
  if (!clean || !clean.includes(':')) return null;

  let working = clean;
  const lastColon = working.lastIndexOf(':');
  const tail = working.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    working = `${working.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const dbl = working.split('::');
  if (dbl.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const groups = side.split(':');
    const nums: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      nums.push(parseInt(g, 16));
    }
    return nums;
  };

  let hextets: number[];
  if (dbl.length === 2) {
    const left = parseSide(dbl[0]);
    const right = parseSide(dbl[1]);
    if (!left || !right || left.length + right.length >= 8) return null;
    const zeros = new Array<number>(8 - left.length - right.length).fill(0);
    hextets = [...left, ...zeros, ...right];
  } else {
    const all = parseSide(working);
    if (!all || all.length !== 8) return null;
    hextets = all;
  }

  let out = 0n;
  for (const h of hextets) {
    out = (out << 16n) | BigInt(h);
  }
  return out;
}

interface CompiledIpRule {
  negated: boolean;
  match: (normalizedIp: string) => boolean;
}

function compileSingleToken(rawToken: string): CompiledIpRule | { error: string } {
  const negated = rawToken.startsWith('!');
  const token = (negated ? rawToken.slice(1) : rawToken).trim();
  if (!token) return { error: 'Incomplete IP filter token' };

  const slash = token.indexOf('/');
  if (slash >= 0) {
    const addr = token.slice(0, slash);
    const prefixStr = token.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixStr)) return { error: `Invalid CIDR prefix in "${rawToken}"` };
    const prefix = Number(prefixStr);

    const v4 = parseIpv4(addr);
    if (v4 !== null) {
      if (prefix < 0 || prefix > 32) return { error: `IPv4 CIDR prefix out of range (0-32) in "${rawToken}"` };
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const net = (v4 & mask) >>> 0;
      return {
        negated,
        match: (ip) => {
          const cand = parseIpv4(ip);
          return cand !== null && ((cand & mask) >>> 0) === net;
        },
      };
    }

    const v6 = parseIpv6(addr);
    if (v6 !== null) {
      if (prefix < 0 || prefix > 128) return { error: `IPv6 CIDR prefix out of range (0-128) in "${rawToken}"` };
      const shift = BigInt(128 - prefix);
      const net = shift === 128n ? 0n : (v6 >> shift) << shift;
      return {
        negated,
        match: (ip) => {
          const cand = parseIpv6(ip);
          if (cand === null) return false;
          const masked = shift === 128n ? 0n : (cand >> shift) << shift;
          return masked === net;
        },
      };
    }

    return { error: `Invalid IP address in CIDR "${rawToken}"` };
  }

  const exactV4 = parseIpv4(token);
  if (exactV4 !== null) {
    return {
      negated,
      match: (ip) => parseIpv4(ip) === exactV4,
    };
  }
  const exactV6 = parseIpv6(token);
  if (exactV6 !== null) {
    return {
      negated,
      match: (ip) => parseIpv6(ip) === exactV6,
    };
  }

  // Partial IP tokens match from the start of the normalized address (so `!10.` never excludes `110.x`).
  if (!/^[0-9a-f:.]+$/i.test(token)) {
    return { error: `Invalid IP prefix "${rawToken}"` };
  }
  const prefixNeedle = token.toLowerCase();
  return {
    negated,
    match: (ip) => ip.toLowerCase().startsWith(prefixNeedle),
  };
}

export function validateIpFilter(expr: string): { valid: boolean; error?: string } {
  const tokens = expr
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const t of tokens) {
    const res = compileSingleToken(t);
    if ('error' in res) return { valid: false, error: res.error };
  }
  return { valid: true };
}

/**
 * Evaluates an IP address against a filter expression supporting exact IPs, anchored prefixes,
 * IPv4/IPv6 CIDRs (`10.0.0.0/8`, `2001:db8::/32`), comma/space lists, and `!` exclusions.
 *
 * Incomplete or invalid expressions (e.g. `10.0.0.0/` while typing) act as a no-op rather than
 * blanking the UI; callers can inspect `validateIpFilter(expr)` to display inline feedback.
 */
export function matchesIpFilter(ipAddress: string | null | undefined, expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;

  const tokens = trimmed
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;

  const positives: CompiledIpRule[] = [];
  const negatives: CompiledIpRule[] = [];
  for (const t of tokens) {
    const compiled = compileSingleToken(t);
    if ('error' in compiled) return true;
    if (compiled.negated) negatives.push(compiled);
    else positives.push(compiled);
  }

  const ip = normalizeIp(ipAddress);
  if (!ip) return false;

  if (negatives.some((r) => r.match(ip))) return false;
  if (positives.length > 0 && !positives.some((r) => r.match(ip))) return false;
  return true;
}

// ------------------------------------------------------------------ evaluation & remediation

export function inferIdentityAuthMethod(identity?: Identity, authenticators?: Authenticator[]): IdentityAuthMethod {
  if (!identity) return 'unknown';
  if (identity.externalId) return 'ext-jwt';
  if (identity.authenticators?.cert) return 'cert';
  if (identity.authenticators?.updb) return 'updb';
  if (authenticators?.length) {
    const own = authenticators.filter((a) => a.identityId === identity.id || a.identity?.id === identity.id);
    if (own.some((a) => a.method === 'cert')) return 'cert';
    if (own.some((a) => a.method === 'updb')) return 'updb';
  }
  return 'unknown';
}

function parseTimestampMs(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function sessionActivityIso(s: ApiSession): string | null {
  return s.lastActivityAt || s.cachedLastActivityAt || s.updatedAt || s.createdAt || null;
}

const NON_REVOCABLE_AUTH_IDS = new Set(['', 'oidc', 'ext-jwt', 'internal', 'none']);

function authenticatorIdsForIdentity(
  identity: Identity | undefined,
  apiSessions: { authenticatorId?: string | null }[],
  authenticators?: Authenticator[],
): string[] {
  const ids = new Set<string>();
  const add = (id?: string | null) => {
    const clean = id?.trim() || '';
    if (clean && !NON_REVOCABLE_AUTH_IDS.has(clean.toLowerCase())) ids.add(clean);
  };
  add(identity?.authenticators?.cert?.id);
  add(identity?.authenticators?.updb?.id);
  for (const s of apiSessions) add(s.authenticatorId);
  if (identity && authenticators?.length) {
    for (const a of authenticators) {
      if (a.identityId === identity.id || a.identity?.id === identity.id) add(a.id);
    }
  }
  return [...ids];
}

export function buildRemediationPlan(params: {
  action: RemediationAction;
  identity?: Identity;
  identityName: string;
  allApiSessions: {
    id: string;
    ipAddress: string | null;
    createdAt?: string | null;
    authenticatorId?: string | null;
    isCurrentSession?: boolean;
  }[];
  concurrentSessions: {
    apiSessionId: string;
    ipAddress: string | null;
    createdAt?: string | null;
    isCurrentSession?: boolean;
  }[];
  authenticators?: Authenticator[];
}): RemediationPlan {
  const { action, identity, identityName, allApiSessions, concurrentSessions, authenticators } = params;
  if (action === 'warn') return { steps: [] };

  if (action === 'terminate-newer-sessions') {
    // Keep the earliest-established session (by createdAt, breaking ties by ID) and never drop the caller's own session.
    const ordered = [...concurrentSessions].sort((a, b) => {
      if (a.isCurrentSession !== b.isCurrentSession) return a.isCurrentSession ? -1 : 1;
      const ca = parseTimestampMs(a.createdAt);
      const cb = parseTimestampMs(b.createdAt);
      if (ca !== null && cb !== null && ca !== cb) return ca - cb;
      if (ca !== null && cb === null) return -1;
      if (ca === null && cb !== null) return 1;
      return a.apiSessionId.localeCompare(b.apiSessionId);
    });
    const toDrop = ordered.slice(1).filter((s) => !s.isCurrentSession);
    return {
      steps: toDrop.map((s) => ({
        method: 'DELETE',
        path: `api-sessions/${encodeURIComponent(s.apiSessionId)}`,
        collection: 'api-sessions',
        targetId: s.apiSessionId,
        reason: `Terminate newer concurrent API session (${s.ipAddress || 'unknown IP'}) on ${identityName}`,
      })),
    };
  }

  if (action === 'terminate-all-sessions') {
    const droppable = allApiSessions.filter((s) => !s.isCurrentSession);
    return {
      steps: droppable.map((s) => ({
        method: 'DELETE',
        path: `api-sessions/${encodeURIComponent(s.id)}`,
        collection: 'api-sessions',
        targetId: s.id,
        reason: `Terminate API session (${s.ipAddress || 'unknown IP'}) on ${identityName}`,
      })),
    };
  }

  // revoke-authenticators: require at least one concrete authenticator ID; otherwise refuse so we
  // never drop sessions alone and falsely report that credentials were revoked.
  const authIds = authenticatorIdsForIdentity(identity, allApiSessions, authenticators);
  if (!authIds.length) {
    return {
      steps: [],
      error: `Cannot revoke credentials for ${identityName}: no revocable authenticator ID was found on the identity or its sessions.`,
    };
  }

  const authSteps: RemediationStep[] = authIds.map((authId) => ({
    method: 'DELETE',
    path: `authenticators/${encodeURIComponent(authId)}`,
    collection: 'authenticators',
    targetId: authId,
    reason: `Revoke authenticator ${authId} on ${identityName} to invalidate shared credentials`,
  }));
  const sessSteps: RemediationStep[] = allApiSessions
    .filter((s) => !s.isCurrentSession)
    .map((s) => ({
      method: 'DELETE',
      path: `api-sessions/${encodeURIComponent(s.id)}`,
      collection: 'api-sessions',
      targetId: s.id,
      reason: `Terminate API session (${s.ipAddress || 'unknown IP'}) on ${identityName}`,
    }));
  return { steps: [...authSteps, ...sessSteps] };
}

export function evaluateSessionMonitor(input: SessionMonitorInput): SessionMonitorReport {
  const policy = normalizeConcurrencyPolicy(input.policy);
  const nowMs =
    typeof input.now === 'number'
      ? input.now
      : typeof input.now === 'string'
        ? (parseTimestampMs(input.now) ?? Date.now())
        : Date.now();
  const evaluatedAt = new Date(nowMs).toISOString();
  const callerToken = input.currentSessionToken || null;

  const identityById = new Map<string, Identity>();
  for (const ident of input.identities) identityById.set(ident.id, ident);

  const servicesByApiSession = new Map<string, EnrichedServiceRef[]>();
  for (const sess of input.sessions) {
    const apiSessId = sess.apiSessionId || sess.apiSession?.id;
    if (!apiSessId) continue;
    const ref: EnrichedServiceRef = {
      sessionId: sess.id,
      serviceId: sess.serviceId || sess.service?.id || '',
      serviceName: sess.service?.name || sess.serviceId || 'unknown-service',
      type: sess.type === 'Bind' ? 'Bind' : 'Dial',
      routers: (sess.edgeRouters || []).map((r) => r.name).filter(Boolean),
      createdAt: sess.createdAt || null,
    };
    const list = servicesByApiSession.get(apiSessId) || [];
    list.push(ref);
    servicesByApiSession.set(apiSessId, list);
  }

  interface IntermediateApiSession {
    raw: ApiSession;
    identityId: string;
    ip: string | null;
    createdAt: string | null;
    activityIso: string | null;
    activityMs: number | null;
    ageSeconds: number | null;
    isActiveInWindow: boolean;
    isCurrentSession: boolean;
    services: EnrichedServiceRef[];
  }

  const byIdentRaw = new Map<string, IntermediateApiSession[]>();
  const allIntermediate: IntermediateApiSession[] = [];

  for (const raw of input.apiSessions) {
    const identityId = raw.identityId || raw.identity?.id || 'unknown-identity';
    const ip = normalizeIp(raw.ipAddress);
    const activityIso = sessionActivityIso(raw);
    const activityMs = parseTimestampMs(activityIso);
    const ageMs = activityMs === null ? null : Math.max(0, nowMs - activityMs);
    const ageSeconds = ageMs === null ? null : Math.round(ageMs / 1000);
    // Sessions lacking any parseable timestamp only count as live when age filtering is explicitly disabled (0).
    const isActiveInWindow =
      policy.activeWithinSeconds <= 0 ? true : ageMs !== null && ageMs <= policy.activeWithinSeconds * 1000;
    const isCurrentSession = Boolean(callerToken && raw.token && raw.token === callerToken);
    const item: IntermediateApiSession = {
      raw,
      identityId,
      ip,
      createdAt: raw.createdAt || null,
      activityIso,
      activityMs,
      ageSeconds,
      isActiveInWindow,
      isCurrentSession,
      services: servicesByApiSession.get(raw.id) || [],
    };
    allIntermediate.push(item);
    const group = byIdentRaw.get(identityId) || [];
    group.push(item);
    byIdentRaw.set(identityId, group);
  }

  const byIdentity = new Map<string, IdentitySessionSummary>();
  const findings: ConcurrencyFinding[] = [];
  const stateByApiSessionId = new Map<string, SessionConcurrencyState>();

  for (const [identityId, group] of byIdentRaw.entries()) {
    // Newest activity first, breaking ties by id.
    group.sort((a, b) => {
      if (a.activityMs !== null && b.activityMs !== null && a.activityMs !== b.activityMs) {
        return b.activityMs - a.activityMs;
      }
      if (a.activityMs !== null && b.activityMs === null) return -1;
      if (a.activityMs === null && b.activityMs !== null) return 1;
      return a.raw.id.localeCompare(b.raw.id);
    });

    const ident = identityById.get(identityId);
    const identityName = ident?.name || group[0]?.raw.identity?.name || identityId;
    const isAdmin = Boolean(ident?.isAdmin || ident?.isDefaultAdmin);
    const roleAttributes = ident?.roleAttributes || [];
    const authMethod = inferIdentityAuthMethod(ident, input.authenticators);
    const isExternalIdentity = Boolean(ident?.externalId) || authMethod === 'ext-jwt';

    const live = group.filter((s) => s.isActiveInWindow);

    // Cluster sessions within `maxActivitySkewSeconds` of the most recently active session so
    // `minConcurrentSessions` (including >= 3) and `distinctIps` exclude older handoff leftovers.
    const clustered =
      policy.maxActivitySkewSeconds === null || live.length === 0
        ? live
        : live.filter((s) => {
            const newestMs = live[0].activityMs;
            if (newestMs === null || s.activityMs === null) return false;
            return Math.abs(newestMs - s.activityMs) <= policy.maxActivitySkewSeconds! * 1000;
          });

    let skewMs: number | null = null;
    if (clustered.length >= 2) {
      const firstMs = clustered[0].activityMs;
      const lastMs = clustered[clustered.length - 1].activityMs;
      if (firstMs !== null && lastMs !== null) skewMs = Math.abs(firstMs - lastMs);
    }

    const distinctClusterIps = [...new Set(clustered.map((s) => s.ip).filter((x): x is string => !!x))];
    const distinctLiveIps = [...new Set(live.map((s) => s.ip).filter((x): x is string => !!x))];
    const allIps = [...new Set(group.map((s) => s.ip).filter((x): x is string => !!x))];

    const activeServiceIds = new Set<string>();
    const activeServiceNames = new Set<string>();
    for (const s of live) {
      for (const svc of s.services) {
        if (svc.serviceId) activeServiceIds.add(svc.serviceId);
        if (svc.serviceName) activeServiceNames.add(svc.serviceName);
      }
    }

    const meetsCount = clustered.length >= policy.minConcurrentSessions;
    const isMultiIp = distinctClusterIps.length >= 2;
    const meetsIpRule = !policy.requireDistinctIps || isMultiIp;

    const isExempt =
      (policy.exemptAdminIdentities && isAdmin) ||
      policy.exemptIdentityIds.includes(identityId) ||
      roleAttributes.some((a) => policy.exemptRoleAttributes.includes(a)) ||
      (policy.exemptExternalIdentities && isExternalIdentity);

    let concurrencyState: SessionConcurrencyState = 'single';
    let finding: ConcurrencyFinding | null = null;
    const clusteredIds = new Set(clustered.map((s) => s.raw.id));

    if (meetsCount && meetsIpRule) {
      if (isExempt) {
        concurrencyState = 'exempt-multi';
      } else {
        concurrencyState = isMultiIp ? 'concurrent-multi-ip' : 'concurrent-same-ip';
        const severity: ConcurrencySeverity = isMultiIp ? 'critical' : 'warning';
        const recommendedAction = isMultiIp ? policy.multiIpAction : policy.sameIpAction;
        const concurrentSessions: ConcurrentSessionSnapshot[] = clustered.map((s) => ({
          apiSessionId: s.raw.id,
          ipAddress: s.ip,
          createdAt: s.createdAt,
          activityAt: s.activityIso,
          ageSeconds: s.ageSeconds,
          services: [...new Set(s.services.map((svc) => svc.serviceName))],
          isCurrentSession: s.isCurrentSession,
        }));
        const plan = buildRemediationPlan({
          action: recommendedAction,
          identity: ident,
          identityName,
          allApiSessions: group.map((g) => ({
            id: g.raw.id,
            ipAddress: g.ip,
            createdAt: g.createdAt,
            authenticatorId: g.raw.authenticatorId,
            isCurrentSession: g.isCurrentSession,
          })),
          concurrentSessions,
          authenticators: input.authenticators,
        });
        const ipDetail = distinctClusterIps.length
          ? distinctClusterIps.length >= 2
            ? `across ${distinctClusterIps.length} IPs (${distinctClusterIps.join(', ')})`
            : `from ${distinctClusterIps[0]}`
          : 'with unknown client IP';
        finding = {
          identityId,
          identityName,
          roleAttributes,
          authMethod,
          severity,
          concurrentSessionCount: clustered.length,
          totalSessionCount: group.length,
          distinctIps: distinctClusterIps,
          concurrentSessions,
          activitySkewMs: skewMs,
          recommendedAction,
          remediationSteps: plan.steps,
          summary: `${clustered.length} active sessions ${ipDetail}`,
        };
        findings.push(finding);
      }
    } else if (live.length === 0 && group.length > 0) {
      concurrencyState = 'stale';
    }

    for (const s of group) {
      if (!s.isActiveInWindow) {
        stateByApiSessionId.set(s.raw.id, 'stale');
      } else if (
        (concurrencyState === 'concurrent-multi-ip' ||
          concurrencyState === 'concurrent-same-ip' ||
          concurrencyState === 'exempt-multi') &&
        clusteredIds.has(s.raw.id)
      ) {
        stateByApiSessionId.set(s.raw.id, concurrencyState);
      } else {
        stateByApiSessionId.set(s.raw.id, 'single');
      }
    }

    byIdentity.set(identityId, {
      identityId,
      identityName,
      isAdmin,
      roleAttributes,
      authMethod,
      isExternalIdentity,
      totalSessionCount: group.length,
      liveSessionCount: live.length,
      distinctLiveIps,
      allIps,
      activeServiceIds: [...activeServiceIds],
      activeServiceNames: [...activeServiceNames],
      concurrencyState,
      finding,
    });
  }

  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    if (b.concurrentSessionCount !== a.concurrentSessionCount) {
      return b.concurrentSessionCount - a.concurrentSessionCount;
    }
    return a.identityName.localeCompare(b.identityName);
  });

  const apiSessionById = new Map<string, EnrichedApiSession>();
  const apiSessions: EnrichedApiSession[] = allIntermediate.map((s) => {
    const ident = identityById.get(s.identityId);
    const summary = byIdentity.get(s.identityId);
    const enriched: EnrichedApiSession = {
      id: s.raw.id,
      identityId: s.identityId,
      identityName: summary?.identityName || ident?.name || s.raw.identity?.name || s.identityId,
      isAdmin: summary?.isAdmin || Boolean(ident?.isAdmin || ident?.isDefaultAdmin),
      roleAttributes: summary?.roleAttributes || ident?.roleAttributes || [],
      authMethod: summary?.authMethod || inferIdentityAuthMethod(ident, input.authenticators),
      isExternalIdentity: summary?.isExternalIdentity || false,
      authenticatorId: s.raw.authenticatorId || null,
      ipAddress: s.ip,
      rawIpAddress: s.raw.ipAddress || null,
      createdAt: s.createdAt,
      activityAt: s.activityIso,
      ageSeconds: s.ageSeconds,
      isActiveInWindow: s.isActiveInWindow,
      isCurrentSession: s.isCurrentSession,
      concurrencyState: stateByApiSessionId.get(s.raw.id) || 'single',
      services: s.services,
    };
    apiSessionById.set(enriched.id, enriched);
    return enriched;
  });

  const serviceFlows: ServiceFlowRow[] = input.sessions.map((sess) => {
    const apiSessId = sess.apiSessionId || sess.apiSession?.id || null;
    const parentApi = apiSessId ? apiSessionById.get(apiSessId) : undefined;
    const identityId = parentApi?.identityId || sess.identityId || 'unknown-identity';
    const ident = identityById.get(identityId);
    const identSummary = byIdentity.get(identityId);
    const activityAt = parentApi?.activityAt || sess.updatedAt || sess.createdAt || null;
    const activityMs = parseTimestampMs(activityAt);
    const ageSeconds = activityMs === null ? null : Math.round(Math.max(0, nowMs - activityMs) / 1000);
    const serviceId = sess.serviceId || sess.service?.id || '';
    const serviceName = sess.service?.name || sess.serviceId || 'unknown-service';

    if (identSummary && serviceId && !identSummary.activeServiceIds.includes(serviceId)) {
      identSummary.activeServiceIds.push(serviceId);
      identSummary.activeServiceNames.push(serviceName);
    } else if (!identSummary && ident) {
      byIdentity.set(identityId, {
        identityId,
        identityName: ident.name,
        isAdmin: Boolean(ident.isAdmin || ident.isDefaultAdmin),
        roleAttributes: ident.roleAttributes || [],
        authMethod: inferIdentityAuthMethod(ident, input.authenticators),
        isExternalIdentity: Boolean(ident.externalId),
        totalSessionCount: 0,
        liveSessionCount: 0,
        distinctLiveIps: [],
        allIps: [],
        activeServiceIds: serviceId ? [serviceId] : [],
        activeServiceNames: serviceName ? [serviceName] : [],
        concurrencyState: 'single',
        finding: null,
      });
    }

    return {
      id: sess.id,
      sessionId: sess.id,
      apiSessionId: apiSessId,
      identityId,
      identityName: parentApi?.identityName || ident?.name || identityId,
      roleAttributes: parentApi?.roleAttributes || ident?.roleAttributes || [],
      authMethod: parentApi?.authMethod || inferIdentityAuthMethod(ident, input.authenticators),
      ipAddress: parentApi?.ipAddress || null,
      serviceId,
      serviceName,
      type: sess.type === 'Bind' ? 'Bind' : 'Dial',
      routers: (sess.edgeRouters || []).map((r) => r.name).filter(Boolean),
      activityAt,
      ageSeconds,
      isCurrentSession: parentApi?.isCurrentSession || false,
      concurrencyState: parentApi?.concurrencyState || identSummary?.concurrencyState || 'single',
      findingSeverity: identSummary?.finding?.severity || null,
    };
  });

  return {
    evaluatedAt,
    nowMs,
    policy,
    apiSessions,
    serviceFlows,
    identities: [...byIdentity.values()],
    byIdentity,
    findings,
  };
}

// ------------------------------------------------------------------ traffic filtering

function matchesConcurrencyFilter(state: SessionConcurrencyState, mode: ConcurrencyFilterMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'concurrent-any') return state === 'concurrent-multi-ip' || state === 'concurrent-same-ip';
  if (mode === 'concurrent-multi-ip') return state === 'concurrent-multi-ip';
  return state === 'concurrent-same-ip';
}

export function filterServiceFlows(rows: ServiceFlowRow[], filter: TrafficFilter): ServiceFlowRow[] {
  const q = filter.search.trim().toLowerCase().replace(/^[#@]/, '');
  const attr = filter.roleAttribute.trim().replace(/^#/, '');
  return rows.filter((r) => {
    if (!matchesConcurrencyFilter(r.concurrencyState, filter.concurrency)) return false;
    if (filter.sessionType !== 'all' && r.type !== filter.sessionType) return false;
    if (filter.serviceId === '__idle__') return false;
    if (filter.serviceId && filter.serviceId !== 'all' && r.serviceId !== filter.serviceId) return false;
    if (attr && !r.roleAttributes.includes(attr)) return false;
    if (!matchesIpFilter(r.ipAddress, filter.ipFilter)) return false;
    if (q) {
      const hay = [
        r.sessionId,
        r.apiSessionId || '',
        r.identityName,
        r.ipAddress || '',
        r.serviceName,
        r.type,
        ...r.roleAttributes,
        ...r.routers,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function filterApiSessions(rows: EnrichedApiSession[], filter: TrafficFilter): EnrichedApiSession[] {
  const q = filter.search.trim().toLowerCase().replace(/^[#@]/, '');
  const attr = filter.roleAttribute.trim().replace(/^#/, '');
  return rows.filter((r) => {
    if (!matchesConcurrencyFilter(r.concurrencyState, filter.concurrency)) return false;
    if (filter.sessionType !== 'all' && !r.services.some((s) => s.type === filter.sessionType)) return false;
    if (filter.serviceId === '__idle__') {
      if (r.services.length > 0) return false;
    } else if (filter.serviceId && filter.serviceId !== 'all') {
      if (!r.services.some((s) => s.serviceId === filter.serviceId)) return false;
    }
    if (attr && !r.roleAttributes.includes(attr)) return false;
    if (!matchesIpFilter(r.ipAddress, filter.ipFilter)) return false;
    if (q) {
      const hay = [
        r.id,
        r.identityName,
        r.ipAddress || '',
        r.authMethod,
        ...r.roleAttributes,
        ...r.services.flatMap((s) => [s.serviceName, s.type, ...s.routers]),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
