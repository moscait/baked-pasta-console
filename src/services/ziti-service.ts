import {
  AcErPolicy,
  AcIdentity,
  AcModel,
  AcOp,
  AcRouter,
  AcSerp,
  AcService,
  AcServicePolicy,
  KIND_API,
  clone,
  erPolicyBody,
  identityBody,
  policyBody,
  serpBody,
  serviceBody,
} from '../features/access-canvas/access-canvas.logic';
import { BrowserLayoutStore, LayoutStore, layoutStorageKey } from '../features/access-canvas/canvas-layout.store';
import type { ApiEntities, ApiEnvelope, ApiWriteBody, Collection, ConfigType, Identity } from './api-types';
import { RawDemoStore, createInitialDemoStore, demoFabric } from './demo-store';
import type { FabricEntities } from '../features/network-map/network-map.logic';

export type { RawDemoStore } from './demo-store';
export { createInitialDemoStore } from './demo-store';

export interface ZitiSettings {
  selectedEdgeController: string;
  edgeControllers: { name: string; url: string; default?: boolean }[];
  session: {
    id?: string;
    controllerDomain?: string;
    authMode?: 'oidc' | 'legacy' | 'cert' | 'demo';
    /** ISO time the access token / API session expires. */
    expiresAt?: string;
    /** OIDC refresh token (rotated on every refresh). */
    refreshToken?: string;
    /** Epoch ms after which the refresh token is no longer usable, when the controller says. */
    refreshExpiresAt?: number;
    oidcClientId?: string;
    /** Absolute OIDC token endpoint, kept so a reloaded page can refresh without re-probing. */
    oidcTokenEndpoint?: string;
  };
  jwtToken?: string | null;
  demoMode?: boolean;
}

export interface AcRevert {
  label: string;
  run: () => Promise<unknown>;
}

export interface AcRevertFailure {
  revert: AcRevert;
  error: string;
}

type RoleListField = 'roleAttributes' | 'identityRoles';

/**
 * Thrown by `applyCanvasOps` when an operation fails part-way. `reverts` undoes the steps that
 * did succeed (most recent first); the caller decides whether to run them.
 */
export class CanvasApplyError extends Error {
  constructor(
    readonly cause: unknown,
    readonly reverts: AcRevert[],
  ) {
    super(cause instanceof Error ? cause.message : messageOf(cause) || 'Change failed');
    this.name = 'CanvasApplyError';
  }
}

/** The steps to undo after a failed apply; empty for any other error. */
export function revertsOf(err: unknown): AcRevert[] {
  return err instanceof CanvasApplyError ? err.reverts : [];
}

const SETTINGS_KEY = 'ziti.settings';
const DEMO_STORE_KEY = 'bpc.demo.store.v1';

const DEFAULT_SETTINGS: ZitiSettings = {
  selectedEdgeController: typeof window !== 'undefined' ? window.location.origin : 'https://localhost:1280',
  edgeControllers: [],
  session: {},
  jwtToken: null,
  demoMode: false,
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlSafeString(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const decoded = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/** Thrown when the controller cannot start an OIDC auth request, so legacy auth may be tried instead. */
class OidcUnavailableError extends Error {}

const isEmptyObj = (o: unknown) => !o || (typeof o === 'object' && Object.keys(o).length === 0);

/** Refresh this long before the access token expires, to absorb clock skew and slow requests. */
const REFRESH_LEEWAY_MS = 60_000;

interface OidcTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshExpiresAt?: number;
}

/** Raw OAuth token endpoint response. */
interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
}

function tokensFromResponse(body: OAuthTokenResponse, previousRefresh?: string): OidcTokens {
  const accessToken = body.access_token!;
  const now = Date.now();
  let expiresAt: string | undefined;
  if (typeof body.expires_in === 'number') {
    expiresAt = new Date(now + body.expires_in * 1000).toISOString();
  } else {
    const exp = decodeJwtPayload(accessToken)?.exp;
    if (typeof exp === 'number') expiresAt = new Date(exp * 1000).toISOString();
  }
  return {
    accessToken,
    // Servers that do not rotate refresh tokens omit it; keep using the previous one.
    refreshToken: body.refresh_token || previousRefresh,
    expiresAt,
    refreshExpiresAt: typeof body.refresh_expires_in === 'number' ? now + body.refresh_expires_in * 1000 : undefined,
  };
}

/** Best-effort extraction of a human-readable message from an API error body or thrown value. */
function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (!err || typeof err !== 'object') return '';
  const o = err as { error?: unknown; cause?: { reason?: string; message?: string }; message?: string; code?: string };
  if (o.error && typeof o.error === 'object') {
    const inner = messageOf((o.error as { error?: unknown }).error ?? o.error);
    if (inner) return inner;
  }
  return o.cause?.reason || o.cause?.message || o.message || o.code || '';
}

class ZitiServiceImpl {
  private settings: ZitiSettings;
  private listeners = new Set<() => void>();
  public controllerVersion = 'v1.3.2';
  public oidcEnabled = false;
  public edgeOidcPath = '/oidc';

  private refreshInFlight: Promise<boolean> | null = null;

  constructor() {
    this.settings = this.loadSettings();
    // Keep tabs in sync: another tab may log out, switch controller, or rotate the OIDC
    // refresh token (making ours single-use and stale).
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key !== SETTINGS_KEY) return;
        const before = this.authFingerprint();
        this.settings = this.loadSettings();
        // Silent token rotations should not make every page refetch.
        if (this.authFingerprint() !== before) this.notify();
      });
    }
  }

  /** Changes when the user signs in/out or switches controller, but not on token refresh. */
  private authFingerprint(): string {
    return `${this.isAuthenticated()}|${this.settings.demoMode}|${this.controllerUrl()}`;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** True when this browser had no saved settings at startup, i.e. a first visit. */
  public readonly firstVisit: boolean = (() => {
    try {
      return localStorage.getItem(SETTINGS_KEY) === null;
    } catch {
      return true;
    }
  })();

  loadSettings(): ZitiSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_SETTINGS };
  }

  /** Persists settings. `silent` skips notifying subscribers (used for token refresh). */
  saveSettings(next: Partial<ZitiSettings>, opts: { silent?: boolean } = {}): void {
    this.settings = { ...this.settings, ...next };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
    if (!opts.silent) this.notify();
  }

  getSettings(): ZitiSettings {
    return this.settings;
  }

  isAuthenticated(): boolean {
    return !!this.settings.demoMode || !!this.settings.session?.id || !!this.settings.jwtToken;
  }

  isDemoMode(): boolean {
    return !!this.settings.demoMode;
  }

  /** Host shown in the UI; never throws on a malformed saved URL. */
  controllerHost(): string {
    try {
      return new URL(this.controllerUrl()).host;
    } catch {
      return this.controllerUrl() || 'unknown controller';
    }
  }

  controllerUrl(): string {
    if (this.settings.demoMode) return 'https://demo.openziti.local:1280';
    return (this.settings.selectedEdgeController || window.location.origin).replace(/\/+$/, '');
  }

  layoutStore(): LayoutStore {
    return new BrowserLayoutStore(layoutStorageKey(this.controllerUrl()));
  }

  enableDemoMode(): void {
    if (!localStorage.getItem(DEMO_STORE_KEY)) {
      localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(createInitialDemoStore()));
    }
    this.saveSettings({
      demoMode: true,
      jwtToken: null,
      selectedEdgeController: 'https://demo.openziti.local:1280',
      session: {
        id: 'demo-session-token',
        controllerDomain: 'https://demo.openziti.local:1280',
        authMode: 'demo',
      },
    });
  }

  resetDemoStore(): void {
    localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(createInitialDemoStore()));
    this.layoutStore().save({ v: 1, nodes: {}, groups: [] });
    this.notify();
  }

  private getDemoStore(): RawDemoStore {
    try {
      const raw = localStorage.getItem(DEMO_STORE_KEY);
      if (raw) return JSON.parse(raw) as RawDemoStore;
    } catch {
      // ignore
    }
    const fresh = createInitialDemoStore();
    try {
      localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore
    }
    return fresh;
  }

  private saveDemoStore(store: RawDemoStore): void {
    try {
      localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
    } catch {
      // ignore
    }
    this.notify();
  }

  /** Probes an Controller URL (or same-origin when hosted at /zac/). */
  async probeController(url?: string): Promise<{ online: boolean; version?: string; oidc?: boolean }> {
    const base = (url || this.controllerUrl()).replace(/\/+$/, '');
    try {
      const resp = await fetch(`${base}/edge/management/v1/version`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return { online: false };
      const body = await resp.json();
      const ver = body?.data?.version;
      if (!ver && !body?.data?.apiVersions) return { online: false };
      this.controllerVersion = ver || 'v1.x';
      const caps: string[] = body?.data?.capabilities || [];
      const oidcPath = body?.data?.apiVersions?.['edge-oidc']?.v1?.path;
      this.oidcEnabled = caps.includes('OIDC_AUTH') && !!oidcPath;
      if (oidcPath) this.edgeOidcPath = oidcPath;
      return { online: true, version: this.controllerVersion, oidc: this.oidcEnabled };
    } catch {
      return { online: false };
    }
  }

  /** Sign in to an Edge Controller using OIDC PKCE (v2.0+ / HA) or standard /authenticate. */
  async login(params: {
    controllerUrl: string;
    username?: string;
    password?: string;
    method?: 'password' | 'cert' | 'ext-jwt';
    extJwt?: string;
  }): Promise<void> {
    const base = params.controllerUrl.trim().replace(/\/+$/, '');
    const probe = await this.probeController(base);
    if (!probe.online) {
      throw new Error(`Unable to reach Edge Controller at ${base}/edge/management/v1/version`);
    }

    // Add to known controllers list
    const existing = this.settings.edgeControllers || [];
    if (!existing.some((c) => c.url === base)) {
      existing.push({ name: new URL(base).host, url: base, default: existing.length === 0 });
    }

    // Try OIDC PKCE first if advertised by controller
    if (probe.oidc) {
      try {
        const { tokens, clientId, tokenEndpoint } = await this.loginOidc(base, params);
        this.saveSettings({
          demoMode: false,
          selectedEdgeController: base,
          edgeControllers: existing,
          jwtToken: tokens.accessToken,
          session: {
            id: tokens.accessToken,
            controllerDomain: base,
            authMode: 'oidc',
            expiresAt: tokens.expiresAt,
            refreshToken: tokens.refreshToken,
            refreshExpiresAt: tokens.refreshExpiresAt,
            oidcClientId: clientId,
            oidcTokenEndpoint: tokenEndpoint,
          },
        });
        return;
      } catch (err) {
        // Only fall back to /edge/management/v1/authenticate when OIDC could not even start.
        // Once credentials were submitted, surface the OIDC error rather than re-sending the
        // password to a second endpoint.
        if (!(err instanceof OidcUnavailableError)) throw err;
      }
    }

    const method = params.method || (params.username && params.password ? 'password' : 'cert');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (method === 'ext-jwt' && params.extJwt) {
      headers['Authorization'] = `Bearer ${params.extJwt}`;
    }
    const body = method === 'password' ? JSON.stringify({ username: params.username, password: params.password }) : undefined;
    const resp = await fetch(`${base}/edge/management/v1/authenticate?method=${method}`, {
      method: 'POST',
      headers,
      body,
    });
    const json = (await resp.json().catch(() => null)) as ApiEnvelope<{ token?: string; expiresAt?: string }> | null;
    const token = json?.data?.token;
    if (!resp.ok || !json || !token) {
      throw new Error(messageOf(json) || `Login failed (HTTP ${resp.status})`);
    }
    const isJwt = token.split('.').length === 3;
    this.saveSettings({
      demoMode: false,
      selectedEdgeController: base,
      edgeControllers: existing,
      jwtToken: isJwt ? token : null,
      session: {
        id: token,
        controllerDomain: base,
        authMode: method === 'cert' ? 'cert' : 'legacy',
        expiresAt: json.data.expiresAt,
      },
    });
  }

  private async loginOidc(
    base: string,
    params: { username?: string; password?: string; method?: string; extJwt?: string },
  ): Promise<{ tokens: OidcTokens; clientId: string; tokenEndpoint: string }> {
    const oidcBase = `${base}${this.edgeOidcPath}`;
    const tokenEndpoint = `${oidcBase}/oauth/token`;
    const redirectUri = `${window.location.origin}/auth/callback`;
    const state = randomUrlSafeString();
    const nonce = randomUrlSafeString();
    const codeVerifier = randomUrlSafeString(48);
    const codeChallenge = await pkceChallengeS256(codeVerifier);

    let authRequestId = '';
    let activeClientId = 'openziti';
    for (const clientId of ['openziti', 'native']) {
      const q = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'openid offline_access',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
      });
      const resp = await fetch(`${oidcBase}/authorize?${q.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const finalUrl = new URL(resp.url);
      const id = finalUrl.searchParams.get('authRequestID') || finalUrl.searchParams.get('id') || resp.headers.get('auth-request-id');
      if (id) {
        authRequestId = id;
        activeClientId = clientId;
        break;
      }
    }
    if (!authRequestId) throw new OidcUnavailableError('Could not start OIDC auth request');

    const loginPath =
      params.method === 'ext-jwt'
        ? `${oidcBase}/login/ext-jwt`
        : params.method === 'cert'
          ? `${oidcBase}/login/cert`
          : `${oidcBase}/login/username`;
    const formFields: Record<string, string> = { id: authRequestId };
    if (params.username) formFields.username = params.username;
    if (params.password) formFields.password = params.password;

    const loginResp = await fetch(loginPath, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(params.extJwt ? { Authorization: `Bearer ${params.extJwt}` } : {}),
      },
      body: new URLSearchParams(formFields),
    });

    const finalLoginUrl = new URL(loginResp.url);
    const code = finalLoginUrl.searchParams.get('code');
    if (!code) {
      const detail = await loginResp.json().catch(() => null);
      throw new Error(messageOf(detail) || `OIDC sign-in was rejected (HTTP ${loginResp.status})`);
    }
    if (finalLoginUrl.searchParams.get('state') !== state) {
      throw new Error('OIDC state mismatch: the authorization response does not belong to this sign-in');
    }

    const tokenResp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: activeClientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    const tokenBody = (await tokenResp.json().catch(() => null)) as OAuthTokenResponse | null;
    if (!tokenResp.ok || !tokenBody?.access_token) {
      throw new Error('OIDC token exchange failed');
    }
    if (tokenBody.id_token && decodeJwtPayload(tokenBody.id_token)?.nonce !== nonce) {
      throw new Error('OIDC nonce mismatch: the ID token was not issued for this sign-in');
    }
    return { tokens: tokensFromResponse(tokenBody), clientId: activeClientId, tokenEndpoint };
  }

  /** True when this OIDC session can be refreshed without asking the user to sign in. */
  private canRefresh(): boolean {
    const s = this.settings.session;
    if (this.settings.demoMode || s.authMode !== 'oidc' || !s.refreshToken || !s.oidcTokenEndpoint) return false;
    return !s.refreshExpiresAt || s.refreshExpiresAt > Date.now();
  }

  private accessTokenExpiringSoon(): boolean {
    const at = this.settings.session.expiresAt;
    return !!at && Date.parse(at) - Date.now() < REFRESH_LEEWAY_MS;
  }

  /**
   * Exchanges the refresh token for a new access token. Concurrent callers share one request,
   * and a token already rotated by another tab is adopted instead of reusing a stale one.
   * Resolves false when the session could not be refreshed.
   */
  refreshSession(): Promise<boolean> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<boolean> {
    // Another tab may have refreshed already; its storage event can lag behind this call.
    const stored = this.loadSettings();
    if (stored.jwtToken && stored.jwtToken !== this.settings.jwtToken && stored.session.refreshToken) {
      this.settings = stored;
      if (!this.accessTokenExpiringSoon()) return true;
    }
    if (!this.canRefresh()) return false;
    const { refreshToken, oidcClientId, oidcTokenEndpoint } = this.settings.session;
    try {
      const resp = await fetch(oidcTokenEndpoint!, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken!,
          client_id: oidcClientId || 'openziti',
        }),
      });
      const body = (await resp.json().catch(() => null)) as OAuthTokenResponse | null;
      if (!resp.ok || !body?.access_token) return false;
      const tokens = tokensFromResponse(body, refreshToken);
      this.saveSettings(
        {
          jwtToken: tokens.accessToken,
          session: {
            ...this.settings.session,
            id: tokens.accessToken,
            expiresAt: tokens.expiresAt,
            refreshToken: tokens.refreshToken,
            refreshExpiresAt: tokens.refreshExpiresAt ?? this.settings.session.refreshExpiresAt,
          },
        },
        { silent: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  logout(): void {
    this.saveSettings({
      demoMode: false,
      jwtToken: null,
      session: {},
    });
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    };
    const jwt = this.settings.jwtToken;
    const sess = this.settings.session?.id;
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`;
    } else if (sess) {
      headers['zt-session'] = sess;
    }
    return headers;
  }

  /**
   * Single entry point for Edge Management API calls. Refuses to send anything without a
   * session, and on 401 clears the session exactly once, so pages that reload on `notify()`
   * cannot fall into a 401 -> logout -> notify -> reload -> 401 loop.
   */
  private async request<T>(
    method: string,
    path: string,
    failure: string,
    body?: ApiWriteBody,
    api: 'edge/management/v1' | 'fabric/v1' = 'edge/management/v1',
  ): Promise<T> {
    if (!this.isAuthenticated()) throw new Error('Not signed in to a controller.');
    if (this.canRefresh() && this.accessTokenExpiringSoon()) await this.refreshSession();

    const send = () =>
      fetch(`${this.controllerUrl()}/${api}/${path}`, {
        method,
        headers: this.authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let resp = await send();
    // One refresh-and-retry for OIDC sessions; the access token may have been revoked or
    // expired early. Only if that fails is the session cleared.
    if (resp.status === 401 && this.canRefresh() && (await this.refreshSession())) resp = await send();
    if (resp.status === 401) {
      if (this.isAuthenticated()) this.logout();
      throw new Error('Session expired. Please sign in again.');
    }
    // The response body is trusted to match the management API schema for this path.
    const json = (await resp.json().catch(() => null)) as T;
    if (!resp.ok) throw new Error(messageOf(json) || `${failure} (HTTP ${resp.status})`);
    return json;
  }

  // ------------------------------------------------------------------ CRUD operations
  async list<K extends Collection>(collection: K): Promise<ApiEntities[K][]> {
    if (this.settings.demoMode) {
      const store = this.getDemoStore();
      return clone(store[collection] || []);
    }
    const out: ApiEntities[K][] = [];
    const limit = 500;
    // Page until the controller's totalCount is reached. The page cap only guards against a
    // misbehaving server; hitting it is an error, never a silent truncation.
    const maxPages = 1000;
    for (let page = 0; ; page++) {
      if (page >= maxPages) {
        throw new Error(`Stopped loading ${collection} after ${maxPages * limit} rows; pagination did not terminate.`);
      }
      const json = await this.request<ApiEnvelope<ApiEntities[K][]> | null>(
        'GET',
        `${collection}?limit=${limit}&offset=${page * limit}`,
        `Failed to load ${collection}`,
      );
      const rows = json?.data || [];
      out.push(...rows);
      const total = json?.meta?.pagination?.totalCount;
      if (rows.length < limit || (typeof total === 'number' && out.length >= total)) break;
    }
    return out;
  }

  async create(collection: Collection, body: ApiWriteBody): Promise<ApiEnvelope<{ id: string }>> {
    if (this.settings.demoMode) {
      const store = this.getDemoStore();
      const id = `${collection.slice(0, 3)}-${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date().toISOString();
      const name = (body as { name?: string }).name;
      // Demo rows are shaped like controller responses; the body supplies the entity fields.
      const created: Record<string, unknown> = {
        id,
        ...clone(body),
        createdAt: now,
      };
      if (collection === 'identities') {
        created.authenticators = {};
        created.enrollment = { ott: this.demoOttToken(id, name || id, new Date(Date.now() + 86400000)) };
        created.hasEdgeRouterConnection = false;
      }
      if (collection === 'edge-routers') {
        created.isOnline = false;
        created.isVerified = false;
        created.enrollmentJwt = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(
          JSON.stringify({ sub: id, name, router: true }),
        )}.router-jwt`;
      }
      (store[collection] as unknown[]) = [...(store[collection] || []), created];
      this.saveDemoStore(store);
      return { data: { id } };
    }

    return this.request('POST', collection, `POST ${collection} failed`, body);
  }

  async patch(collection: Collection, id: string, body: ApiWriteBody): Promise<unknown> {
    if (this.settings.demoMode) {
      const store = this.getDemoStore();
      const list: { id: string }[] = store[collection] || [];
      const idx = list.findIndex((x) => x.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...clone(body) };
        this.saveDemoStore(store);
      }
      return { data: { id } };
    }

    return this.request('PATCH', `${collection}/${encodeURIComponent(id)}`, `PATCH ${collection}/${id} failed`, body);
  }

  async put(collection: Collection, id: string, body: ApiWriteBody): Promise<unknown> {
    if (this.settings.demoMode) {
      return this.patch(collection, id, body);
    }
    return this.request('PUT', `${collection}/${encodeURIComponent(id)}`, `PUT ${collection}/${id} failed`, body);
  }

  async remove(collection: Collection, id: string): Promise<void> {
    if (this.settings.demoMode) {
      const store = this.getDemoStore();
      (store[collection] as { id: string }[]) = (store[collection] || []).filter((x: { id: string }) => x.id !== id);
      this.saveDemoStore(store);
      return;
    }

    await this.request('DELETE', `${collection}/${encodeURIComponent(id)}`, `DELETE ${collection}/${id} failed`);
  }

  // ------------------------------------------------------------------ fabric API (circuits, links, routers)

  /**
   * Lists a fabric management collection (`/fabric/v1/<collection>`), paging like `list`.
   * The fabric API is served by the same controller with the same session; it can be
   * disabled or restricted, so callers should treat a failure as "live data unavailable".
   */
  async listFabric<K extends keyof FabricEntities>(collection: K): Promise<FabricEntities[K][]> {
    if (this.settings.demoMode) return clone(demoFabric(this.getDemoStore())[collection]) as FabricEntities[K][];
    const out: FabricEntities[K][] = [];
    const limit = 500;
    for (let page = 0; page < 200; page++) {
      const json = await this.request<ApiEnvelope<FabricEntities[K][]> | null>(
        'GET',
        `${collection}?limit=${limit}&offset=${page * limit}`,
        `Failed to load fabric ${collection}`,
        undefined,
        'fabric/v1',
      );
      const rows = json?.data || [];
      out.push(...rows);
      const total = json?.meta?.pagination?.totalCount;
      if (rows.length < limit || (typeof total === 'number' && out.length >= total)) return out;
    }
    throw new Error(`Stopped loading fabric ${collection}; pagination did not terminate.`);
  }

  /**
   * Sets or clears an identity's or router's `geolocation` tag ("lat,lng"), the same tag the
   * upstream console's Geolocate map reads. Tags are replaced as a whole map, so the entity's
   * other tags are sent back unchanged.
   */
  async saveGeolocation(
    collection: 'identities' | 'edge-routers' | 'transit-routers',
    entity: { id: string; tags?: Record<string, unknown> },
    geolocation: string | null,
  ): Promise<void> {
    const tags: Record<string, unknown> = { ...(entity.tags || {}) };
    if (geolocation) tags.geolocation = geolocation;
    else delete tags.geolocation;
    // An empty tags object is ignored by the controller's PATCH, which would leave the old
    // location in place; the upstream console sends a placeholder tag for the same reason.
    if (!Object.keys(tags).length) tags.temp = 'empty';
    await this.patch(collection, entity.id, { tags });
  }

  // ------------------------------------------------------------------ enrollment lifecycle

  private demoOttToken(identityId: string, name: string, expiresAt: Date) {
    const nonce = Math.random().toString(36).slice(2, 9);
    return {
      id: `enr-${identityId}-${nonce}`,
      jwt: `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(
        JSON.stringify({ sub: identityId, name, iss: this.controllerUrl(), jti: nonce, exp: Math.floor(expiresAt.getTime() / 1000) }),
      )}.demo-jwt-sig`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Revokes an enrolled identity's authenticator and issues a new one-time enrollment token
   * (`POST authenticators/{id}/re-enroll`). The device's current certificate or password stops
   * working; it must enroll again with the new token before `expiresAt`.
   */
  async resetEnrollment(identity: Identity, expiresAt: Date): Promise<void> {
    const authId = identity.authenticators?.cert?.id || identity.authenticators?.updb?.id;
    if (!authId) throw new Error(`${identity.name} has no authenticator to reset.`);
    if (this.settings.demoMode) {
      const store = this.getDemoStore();
      const ident = store.identities.find((i) => i.id === identity.id);
      if (ident) {
        ident.authenticators = {};
        ident.enrollment = { ott: this.demoOttToken(ident.id, ident.name, expiresAt) };
        ident.hasEdgeRouterConnection = false;
        this.saveDemoStore(store);
      }
      return;
    }
    await this.request('POST', `authenticators/${encodeURIComponent(authId)}/re-enroll`, 'Reset enrollment failed', {
      expiresAt: expiresAt.toISOString(),
    });
    this.notify();
  }

  /**
   * Replaces a pending (not yet used) enrollment token with a new one that expires at
   * `expiresAt` (`POST enrollments/{id}/refresh`). The old JWT stops working.
   */
  async reissueEnrollment(identity: Identity, expiresAt: Date): Promise<void> {
    const e = identity.enrollment;
    const enrollmentId = e?.ott?.id || e?.ottca?.id || e?.updb?.id || e?.ca?.id;
    if (!enrollmentId) throw new Error(`${identity.name} has no pending enrollment to reissue.`);
    if (this.settings.demoMode) {
      const store = this.getDemoStore();
      const ident = store.identities.find((i) => i.id === identity.id);
      if (ident) {
        ident.enrollment = { ott: this.demoOttToken(ident.id, ident.name, expiresAt) };
        this.saveDemoStore(store);
      }
      return;
    }
    await this.request('POST', `enrollments/${encodeURIComponent(enrollmentId)}/refresh`, 'Reissue enrollment failed', {
      expiresAt: expiresAt.toISOString(),
    });
    this.notify();
  }

  /** Removes an identity's MFA (TOTP) enrollment so the user can set it up again (`DELETE identities/{id}/mfa`). */
  async resetMfa(identity: Identity): Promise<void> {
    if (this.settings.demoMode) {
      const store = this.getDemoStore();
      const ident = store.identities.find((i) => i.id === identity.id);
      if (ident) {
        ident.isMfaEnabled = false;
        this.saveDemoStore(store);
      }
      return;
    }
    await this.request('DELETE', `identities/${encodeURIComponent(identity.id)}/mfa`, 'Reset MFA failed');
    this.notify();
  }

  /** Simulates enrolling an identity in Demo Mode so the user can see live status updates! */
  async simulateEnrollDemoIdentity(id: string): Promise<void> {
    if (!this.settings.demoMode) return;
    const store = this.getDemoStore();
    const ident = store.identities.find((i) => i.id === id);
    if (ident) {
      ident.authenticators = { cert: { id: `auth-${id}` } };
      ident.enrollment = {};
      ident.hasEdgeRouterConnection = true;
      this.saveDemoStore(store);
    }
  }

  // ------------------------------------------------------------------ Access Canvas Model Loader & Applier
  async loadCanvasModel(): Promise<AcModel> {
    const [ids, svcs, ers, sps, erps, serps, cfgs] = await Promise.all([
      this.list('identities'),
      this.list('services'),
      this.list('edge-routers'),
      this.list('service-policies'),
      this.list('edge-router-policies'),
      this.list('service-edge-router-policies'),
      this.list('configs'),
    ]);
    const own = (p: { isSystem?: boolean }) => !p.isSystem;
    const identities: AcIdentity[] = ids
      .filter((i) => (i.typeId || i.type?.name || i.type?.id) !== 'Router')
      .map((i) => ({
        id: i.id,
        name: i.name,
        attrs: i.roleAttributes || [],
        enrolled: !isEmptyObj(i.authenticators) || isEmptyObj(i.enrollment),
        online: !!i.hasEdgeRouterConnection,
        isAdmin:
          !!i.isDefaultAdmin ||
          (!!i.isAdmin && !i.roleAttributes?.length && !i.authenticators?.cert && !i.enrollment?.ott),
      }));
    const services: AcService[] = svcs.map((s) => ({
      id: s.id,
      name: s.name,
      attrs: s.roleAttributes || [],
      configs: s.configs || [],
      encryptionRequired: s.encryptionRequired !== false,
      terminatorStrategy: s.terminatorStrategy || 'smartrouting',
    }));
    const routers: AcRouter[] = ers.map((r) => ({
      id: r.id,
      name: r.name,
      attrs: r.roleAttributes || [],
      online: !!r.isOnline,
    }));
    const servicePolicies: AcServicePolicy[] = sps.filter(own).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      semantic: p.semantic || 'AnyOf',
      identityRoles: p.identityRoles || [],
      serviceRoles: p.serviceRoles || [],
      posture: p.postureCheckRolesDisplay?.length
        ? p.postureCheckRolesDisplay.map((x) => x.name || x.role)
        : p.postureCheckRoles || [],
    }));
    const erPolicies: AcErPolicy[] = erps.filter(own).map((p) => ({
      id: p.id,
      name: p.name,
      semantic: p.semantic || 'AnyOf',
      identityRoles: p.identityRoles || [],
      routerRoles: p.edgeRouterRoles || [],
    }));
    const serpsOut: AcSerp[] = serps.filter(own).map((p) => ({
      id: p.id,
      name: p.name,
      semantic: p.semantic || 'AnyOf',
      serviceRoles: p.serviceRoles || [],
      routerRoles: p.edgeRouterRoles || [],
    }));
    const configs = cfgs.map((c) => ({
      id: c.id,
      name: c.name,
      data: c.data,
    }));
    return { identities, services, routers, servicePolicies, erPolicies, serps: serpsOut, configs };
  }

  /** Reads the controller's current value of a role list, so writes are deltas, not snapshots. */
  private async currentRoleList(api: Collection, id: string, field: RoleListField): Promise<string[]> {
    type Row = { id: string } & Partial<Record<RoleListField, string[]>>;
    if (this.settings.demoMode) {
      const row = (this.getDemoStore()[api] as Row[]).find((x) => x.id === id);
      return [...(row?.[field] || [])];
    }
    const json = await this.request<ApiEnvelope<Row> | null>(
      'GET',
      `${api}/${encodeURIComponent(id)}`,
      `GET ${api}/${id} failed`,
    );
    return [...(json?.data?.[field] || [])];
  }

  /**
   * Adds/removes entries in a role list relative to its current server value, leaving any
   * concurrent edits by other admins intact. Returns false when nothing needed to change.
   */
  private async patchRoleList(
    api: Collection,
    id: string,
    field: RoleListField,
    add: string[],
    remove: string[],
  ): Promise<boolean> {
    const current = await this.currentRoleList(api, id, field);
    const next = [...current.filter((a) => !remove.includes(a)), ...add.filter((a) => !current.includes(a))];
    if (next.length === current.length && next.every((a, i) => a === current[i])) return false;
    await this.patch(api, id, { [field]: next });
    return true;
  }

  async applyCanvasOps(ops: AcOp[], idMap: Map<string, string> = new Map()): Promise<AcRevert[]> {
    const reverts: AcRevert[] = [];
    let configTypes: ConfigType[] | null = null;
    const created = async (api: Collection, body: ApiWriteBody, localId: string, label: string) => {
      const res = await this.create(api, body);
      const id = res?.data?.id;
      if (id) {
        idMap.set(localId, id);
        reverts.unshift({ label: `delete ${label}`, run: () => this.remove(api, id) });
      }
    };
    try {
      for (const op of ops) {
        if (op.op === 'addAttr' || op.op === 'removeAttr') {
          const id = idMap.get(op.id) || op.id;
          const api = KIND_API[op.kind];
          const adding = op.op === 'addAttr';
          const add = adding ? [op.attr] : [];
          const remove = adding ? [] : [op.attr];
          if (await this.patchRoleList(api, id, 'roleAttributes', add, remove)) {
            reverts.unshift({
              label: `${adding ? 'remove' : 're-add'} #${op.attr} on ${op.kind} ${id}`,
              run: () => this.patchRoleList(api, id, 'roleAttributes', remove, add),
            });
          }
        } else if (op.op === 'addIdentityRole') {
          const policy = idMap.get(op.policy) || op.policy;
          if (await this.patchRoleList('service-policies', policy, 'identityRoles', [op.role], [])) {
            reverts.unshift({
              label: `remove ${op.role} from policy ${policy}`,
              run: () => this.patchRoleList('service-policies', policy, 'identityRoles', [], [op.role]),
            });
          }
        } else if (op.op === 'createIdentity') {
          await created('identities', identityBody(op.identity), op.identity.id, `identity ${op.identity.name}`);
        } else if (op.op === 'createConfig') {
          if (op.config.existingId) {
            await this.patch('configs', op.config.existingId, { name: op.config.name, data: op.config.data });
            idMap.set(op.config.id, op.config.existingId);
          } else {
            configTypes ??= await this.list('config-types');
            const type = configTypes.find((t) => t.name === op.config.type);
            if (!type) throw new Error(`Config type ${op.config.type} not found on the controller`);
            await created(
              'configs',
              { name: op.config.name, configTypeId: type.id, data: op.config.data },
              op.config.id,
              `config ${op.config.name}`,
            );
          }
        } else if (op.op === 'createSerp') {
          if (op.policy.existingId) {
            await this.patch('service-edge-router-policies', op.policy.existingId, serpBody(op.policy));
            idMap.set(op.policy.id, op.policy.existingId);
          } else {
            await created(
              'service-edge-router-policies',
              serpBody(op.policy),
              op.policy.id,
              `service router policy ${op.policy.name}`,
            );
          }
        } else if (op.op === 'createService') {
          const body = { ...serviceBody(op.service), configs: op.service.configs.map((c) => idMap.get(c) || c) };
          if (op.service.existingId) {
            await this.patch('services', op.service.existingId, body);
            idMap.set(op.service.id, op.service.existingId);
          } else {
            await created('services', body, op.service.id, `service ${op.service.name}`);
          }
        } else if (op.op === 'createPolicy') {
          if (op.policy.existingId) {
            await this.patch('service-policies', op.policy.existingId, policyBody(op.policy));
            idMap.set(op.policy.id, op.policy.existingId);
          } else {
            await created('service-policies', policyBody(op.policy), op.policy.id, `service policy ${op.policy.name}`);
          }
        } else if (op.op === 'createErPolicy') {
          if (op.policy.existingId) {
            await this.patch('edge-router-policies', op.policy.existingId, erPolicyBody(op.policy));
            idMap.set(op.policy.id, op.policy.existingId);
          } else {
            await created(
              'edge-router-policies',
              erPolicyBody(op.policy),
              op.policy.id,
              `edge router policy ${op.policy.name}`,
            );
          }
        }
      }
    } catch (err) {
      throw new CanvasApplyError(err, reverts);
    }
    return reverts;
  }

  /**
   * Runs every revert even if some fail, and returns a description of each failure so the
   * UI never claims a rollback succeeded when it did not.
   */
  async revertCanvasOps(reverts: AcRevert[]): Promise<AcRevertFailure[]> {
    const failures: AcRevertFailure[] = [];
    for (const revert of reverts) {
      try {
        await revert.run();
      } catch (err) {
        failures.push({ revert, error: this.errorText(err) });
      }
    }
    return failures;
  }

  /** One line per failed revert, for toasts. */
  describeRevertFailures(failures: AcRevertFailure[]): string {
    return failures.map((f) => `${f.revert.label} (${f.error})`).join('; ');
  }

  errorText(err: unknown): string {
    if (err instanceof Error) return err.message;
    const text = messageOf(err);
    if (text) return text;
    const status = (err as { status?: number; statusText?: string } | null)?.status;
    if (status) return `HTTP ${status} ${(err as { statusText?: string }).statusText || ''}`.trim();
    try {
      return 'Unexpected error: ' + JSON.stringify(err).slice(0, 200);
    } catch {
      return 'Unexpected error';
    }
  }
}

export const zitiService = new ZitiServiceImpl();
