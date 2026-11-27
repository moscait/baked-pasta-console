import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONTROLLER = 'https://ctrl.example.test:1280';

async function freshService(settings?: object) {
  localStorage.clear();
  if (settings) localStorage.setItem('ziti.settings', JSON.stringify(settings));
  vi.resetModules();
  return (await import('./ziti-service')).zitiService;
}

const signedIn = {
  selectedEdgeController: CONTROLLER,
  edgeControllers: [],
  session: { id: 'sess-token', controllerDomain: CONTROLLER, authMode: 'legacy' },
  jwtToken: null,
  demoMode: false,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('zitiService session handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not loop when subscribers reload after a 401', async () => {
    const svc = await freshService(signedIn);
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: { code: 'UNAUTHORIZED' } }));

    // Mirrors what every page does: reload on each service notification.
    const reloads: Promise<unknown>[] = [];
    svc.subscribe(() => reloads.push(svc.list('identities').catch(() => undefined)));

    await expect(svc.list('identities')).rejects.toThrow(/Session expired/);
    await Promise.all(reloads);
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('refuses to call the controller when signed out', async () => {
    const svc = await freshService({ ...signedIn, session: {} });
    await expect(svc.remove('identities', 'x')).rejects.toThrow(/Not signed in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the 401 session on mutating calls too', async () => {
    const svc = await freshService(signedIn);
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    await expect(svc.patch('identities', 'id-1', { name: 'x' })).rejects.toThrow(/Session expired/);
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('treats a 200 that is not API JSON as an error, not an empty list', async () => {
    const svc = await freshService(signedIn);
    // What a controller without the fabric binding returns: the console's index.html.
    fetchMock.mockImplementation(async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(svc.listFabric('circuits')).rejects.toThrow(/does not serve the fabric API at this address/);
    await expect(svc.list('identities')).rejects.toThrow(/did not return API data/);
    expect(svc.isAuthenticated()).toBe(true);
  });

  it('still reads an empty list as empty', async () => {
    const svc = await freshService(signedIn);
    fetchMock.mockImplementation(async () => jsonResponse(200, { data: [], meta: { pagination: { totalCount: 0 } } }));
    await expect(svc.listFabric('circuits')).resolves.toEqual([]);
  });

  it('encodes entity ids in request paths', async () => {
    const svc = await freshService(signedIn);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await svc.remove('identities', '../config-types/abc');
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${CONTROLLER}/edge/management/v1/identities/..%2Fconfig-types%2Fabc`,
    );
  });

  it('logout removes the stored token', async () => {
    const svc = await freshService({ ...signedIn, jwtToken: 'a.b.c' });
    svc.logout();
    const stored = JSON.parse(localStorage.getItem('ziti.settings')!);
    expect(stored.jwtToken).toBeNull();
    expect(stored.session).toEqual({});
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('applies attribute changes as deltas, keeping concurrent edits on undo', async () => {
    const svc = await freshService(signedIn);
    let serverAttrs = ['sales'];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return jsonResponse(200, { data: { id: 'id-1', roleAttributes: serverAttrs } });
      serverAttrs = JSON.parse(String(init.body)).roleAttributes;
      return jsonResponse(200, { data: { id: 'id-1' } });
    });

    const reverts = await svc.applyCanvasOps([{ op: 'addAttr', kind: 'identity', id: 'id-1', attr: 'ssh' }]);
    expect(serverAttrs).toEqual(['sales', 'ssh']);

    serverAttrs = [...serverAttrs, 'added-by-another-admin'];
    expect(await svc.revertCanvasOps(reverts)).toEqual([]);
    expect(serverAttrs).toEqual(['sales', 'added-by-another-admin']);
  });

  it('records no revert for an attribute that was already present', async () => {
    const svc = await freshService(signedIn);
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: 'id-1', roleAttributes: ['ssh'] } }));
    const reverts = await svc.applyCanvasOps([{ op: 'addAttr', kind: 'identity', id: 'id-1', attr: 'ssh' }]);
    expect(reverts).toEqual([]);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('runs every revert and reports the ones that failed', async () => {
    const svc = await freshService(signedIn);
    const ran: string[] = [];
    const failures = await svc.revertCanvasOps([
      { label: 'first', run: async () => ran.push('first') },
      { label: 'second', run: async () => Promise.reject(new Error('boom')) },
      { label: 'third', run: async () => ran.push('third') },
    ]);
    expect(ran).toEqual(['first', 'third']);
    expect(failures.map((f) => f.revert.label)).toEqual(['second']);
    expect(svc.describeRevertFailures(failures)).toBe('second (boom)');
  });

  describe('OIDC refresh tokens', () => {
    const TOKEN_URL = `${CONTROLLER}/oidc/oauth/token`;
    const oidcSession = (expiresInMs: number, refreshToken = 'refresh-1') => ({
      ...signedIn,
      jwtToken: 'access-1',
      session: {
        id: 'access-1',
        controllerDomain: CONTROLLER,
        authMode: 'oidc',
        expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
        refreshToken,
        oidcClientId: 'openziti',
        oidcTokenEndpoint: TOKEN_URL,
      },
    });
    const tokenResponse = (n: number) =>
      jsonResponse(200, { access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 600 });
    const bearer = (init?: RequestInit) => (init?.headers as Record<string, string>)?.Authorization;

    it('refreshes an access token that is about to expire before calling the API', async () => {
      const svc = await freshService(oidcSession(10_000));
      const notified = vi.fn();
      svc.subscribe(notified);
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === TOKEN_URL) {
          const form = init!.body as URLSearchParams;
          expect(form.get('grant_type')).toBe('refresh_token');
          expect(form.get('refresh_token')).toBe('refresh-1');
          return tokenResponse(2);
        }
        return jsonResponse(200, { data: [] });
      });

      await svc.list('identities');

      expect(fetchMock.mock.calls.map(([u]) => u)[0]).toBe(TOKEN_URL);
      expect(bearer(fetchMock.mock.calls[1][1])).toBe('Bearer access-2');
      const stored = JSON.parse(localStorage.getItem('ziti.settings')!);
      expect(stored.jwtToken).toBe('access-2');
      expect(stored.session.refreshToken).toBe('refresh-2');
      expect(notified).not.toHaveBeenCalled();
    });

    it('refreshes and retries once on 401, keeping the session', async () => {
      const svc = await freshService(oidcSession(600_000));
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === TOKEN_URL) return tokenResponse(2);
        return bearer(init) === 'Bearer access-2' ? jsonResponse(200, { data: [] }) : jsonResponse(401, {});
      });

      await expect(svc.list('identities')).resolves.toEqual([]);
      expect(svc.isAuthenticated()).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('signs out when the refresh token is rejected', async () => {
      const svc = await freshService(oidcSession(600_000));
      fetchMock.mockImplementation(async (url: string) =>
        url === TOKEN_URL ? jsonResponse(400, { error: 'invalid_grant' }) : jsonResponse(401, {}),
      );

      await expect(svc.list('identities')).rejects.toThrow(/Session expired/);
      expect(svc.isAuthenticated()).toBe(false);
    });

    it('shares one refresh between concurrent requests', async () => {
      const svc = await freshService(oidcSession(10_000));
      fetchMock.mockImplementation(async (url: string) =>
        url === TOKEN_URL ? tokenResponse(2) : jsonResponse(200, { data: [] }),
      );

      await Promise.all([svc.list('identities'), svc.list('services'), svc.list('edge-routers')]);
      expect(fetchMock.mock.calls.filter(([u]) => u === TOKEN_URL)).toHaveLength(1);
    });

    it('adopts a token another tab already rotated instead of reusing the stale refresh token', async () => {
      const svc = await freshService(oidcSession(10_000));
      // Another tab refreshed: refresh-1 is now spent.
      const other = oidcSession(600_000, 'refresh-2');
      other.jwtToken = 'access-2';
      other.session.id = 'access-2';
      localStorage.setItem('ziti.settings', JSON.stringify(other));
      fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

      await svc.list('identities');
      expect(fetchMock.mock.calls.some(([u]) => u === TOKEN_URL)).toBe(false);
      expect(bearer(fetchMock.mock.calls[0][1])).toBe('Bearer access-2');
    });

    it('stores the refresh token from an OIDC sign-in, and checks state and nonce', async () => {
      const svc = await freshService();
      const redirectTo = (url: string, resp: Response) => {
        Object.defineProperty(resp, 'url', { value: url });
        return resp;
      };
      const flow = (opts: { badState?: boolean; badNonce?: boolean } = {}) =>
        fetchMock.mockImplementation(async (url: string) => {
          if (url.endsWith('/edge/management/v1/version')) {
            return jsonResponse(200, {
              data: { version: 'v1.6.0', capabilities: ['OIDC_AUTH'], apiVersions: { 'edge-oidc': { v1: { path: '/oidc' } } } },
            });
          }
          if (url.includes('/oidc/authorize?')) {
            const q = new URL(url).searchParams;
            sessionState = q.get('state')!;
            sessionNonce = q.get('nonce')!;
            return redirectTo(`${CONTROLLER}/oidc/login/username?authRequestID=req-1`, new Response('{}'));
          }
          if (url.endsWith('/oidc/login/username')) {
            const state = opts.badState ? 'forged' : sessionState;
            return redirectTo(`${CONTROLLER}/auth/callback?code=c-1&state=${state}`, new Response('{}'));
          }
          if (url === TOKEN_URL) {
            const nonce = opts.badNonce ? 'other' : sessionNonce;
            const idToken = `h.${btoa(JSON.stringify({ nonce }))}.s`;
            return jsonResponse(200, { access_token: 'access-9', refresh_token: 'refresh-9', id_token: idToken, expires_in: 900 });
          }
          throw new Error(`unexpected fetch ${url}`);
        });
      let sessionState = '';
      let sessionNonce = '';
      const login = () => svc.login({ controllerUrl: CONTROLLER, username: 'admin', password: 'pw', method: 'password' });

      flow({ badState: true });
      await expect(login()).rejects.toThrow(/state mismatch/);
      flow({ badNonce: true });
      await expect(login()).rejects.toThrow(/nonce mismatch/);
      expect(svc.isAuthenticated()).toBe(false);
      // A rejected OIDC sign-in must not fall back to sending the password to /authenticate.
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/authenticate'))).toBe(false);

      flow();
      await login();
      const s = svc.getSettings().session;
      expect(s.authMode).toBe('oidc');
      expect(svc.getSettings().jwtToken).toBe('access-9');
      expect(s.refreshToken).toBe('refresh-9');
      expect(s.oidcTokenEndpoint).toBe(TOKEN_URL);
      expect(Date.parse(s.expiresAt!)).toBeGreaterThan(Date.now() + 800_000);
    });
  });

  it('treats only a browser with no saved settings as a first visit', async () => {
    expect((await freshService()).firstVisit).toBe(true);
    expect((await freshService({ ...signedIn, session: {} })).firstVisit).toBe(false);
  });

  it('aborts remediation before dropping sessions when an authenticator revocation fails', async () => {
    const svc = await freshService(signedIn);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/authenticators/')) {
        return jsonResponse(403, { error: { message: 'Forbidden' } });
      }
      return new Response(null, { status: 200 });
    });

    const res = await svc.executeRemediationSteps([
      { method: 'DELETE', path: 'authenticators/a-1', collection: 'authenticators', targetId: 'a-1', reason: 'revoke' },
      { method: 'DELETE', path: 'api-sessions/s-1', collection: 'api-sessions', targetId: 's-1', reason: 'drop' },
    ]);

    expect(res.executed).toBe(0);
    expect(res.failures).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('notifies only policy listeners when concurrency policy changes, avoiding full data reloads', async () => {
    const svc = await freshService(signedIn);
    const dataSubscriber = vi.fn();
    const policySubscriber = vi.fn();
    svc.subscribe(dataSubscriber);
    svc.subscribePolicy(policySubscriber);

    svc.saveConcurrencyPolicy({ activeWithinSeconds: 180 });
    expect(dataSubscriber).not.toHaveBeenCalled();
    expect(policySubscriber).toHaveBeenCalledTimes(1);
    expect(svc.getConcurrencyPolicy().activeWithinSeconds).toBe(180);
  });
});
