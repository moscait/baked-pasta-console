import type { ApiEntities, Collection } from './api-types';
import type { FabricCircuit, FabricEntities, FabricLink, FabricRouter } from '../features/network-map/network-map.logic';
import { parseGeolocation } from '../features/network-map/network-map.logic';

/** In-browser stand-in for the controller's data, used by the Interactive Demo Sandbox. */
export type RawDemoStore = { [K in Collection]: ApiEntities[K][] };

export function createInitialDemoStore(): RawDemoStore {
  const now = new Date().toISOString();
  return {
    'config-types': [
      {
        id: 'ct-intercept-v1',
        name: 'intercept.v1',
        createdAt: now,
        schema: {
          type: 'object',
          properties: {
            protocols: { type: 'array' },
            addresses: { type: 'array' },
            portRanges: { type: 'array' },
          },
        },
      },
      {
        id: 'ct-host-v1',
        name: 'host.v1',
        createdAt: now,
        schema: {
          type: 'object',
          properties: {
            protocol: { type: 'string' },
            address: { type: 'string' },
            port: { type: 'integer' },
          },
        },
      },
    ],
    configs: [
      {
        id: 'cfg-crm-intercept',
        name: 'crm-https.intercept.v1',
        configTypeId: 'ct-intercept-v1',
        configType: { name: 'intercept.v1' },
        data: { protocols: ['tcp'], addresses: ['crm.ziti'], portRanges: [{ low: 443, high: 443 }] },
        createdAt: now,
      },
      {
        id: 'cfg-crm-host',
        name: 'crm-https.host.v1',
        configTypeId: 'ct-host-v1',
        configType: { name: 'host.v1' },
        data: { protocol: 'tcp', address: '127.0.0.1', port: 8443 },
        createdAt: now,
      },
      {
        id: 'cfg-ssh-intercept',
        name: 'devbox-ssh.intercept.v1',
        configTypeId: 'ct-intercept-v1',
        configType: { name: 'intercept.v1' },
        data: { protocols: ['tcp'], addresses: ['devbox.ziti'], portRanges: [{ low: 22, high: 22 }] },
        createdAt: now,
      },
      {
        id: 'cfg-ssh-host',
        name: 'devbox-ssh.host.v1',
        configTypeId: 'ct-host-v1',
        configType: { name: 'host.v1' },
        data: { protocol: 'tcp', address: '127.0.0.1', port: 22 },
        createdAt: now,
      },
      {
        id: 'cfg-pg-intercept',
        name: 'billing-db-postgres.intercept.v1',
        configTypeId: 'ct-intercept-v1',
        configType: { name: 'intercept.v1' },
        data: { protocols: ['tcp'], addresses: ['billing-db.ziti'], portRanges: [{ low: 5432, high: 5432 }] },
        createdAt: now,
      },
      {
        id: 'cfg-pg-host',
        name: 'billing-db-postgres.host.v1',
        configTypeId: 'ct-host-v1',
        configType: { name: 'host.v1' },
        data: { protocol: 'tcp', address: '127.0.0.1', port: 5432 },
        createdAt: now,
      },
    ],
    identities: [
      {
        id: 'id-admin',
        name: 'Default Admin',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: true,
        roleAttributes: [],
        authenticators: { updb: { id: 'auth-1' } },
        enrollment: {},
        hasEdgeRouterConnection: true,
        sdkInfo: { type: 'ziti-Browser', version: '1.0.0' },
        createdAt: now,
      },
      {
        id: 'id-alice',
        tags: { geolocation: '40.71280,-74.00600' },
        name: 'alice-macbook',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: ['sales', 'employees'],
        authenticators: { cert: { id: 'auth-2' } },
        enrollment: {},
        hasEdgeRouterConnection: true,
        sdkInfo: { appId: 'Ziti Desktop Edge', version: '2.4.1' },
        createdAt: now,
      },
      {
        id: 'id-bob',
        tags: { geolocation: '51.50740,-0.12780' },
        name: 'bob-thinkpad',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: ['developers', 'employees', 'ssh-users'],
        authenticators: { cert: { id: 'auth-3' } },
        enrollment: {},
        hasEdgeRouterConnection: true,
        sdkInfo: { appId: 'ziti-edge-tunnel', version: '1.3.2' },
        createdAt: now,
      },
      {
        id: 'id-carla',
        tags: { geolocation: '52.52000,13.40500' },
        name: 'carla-linux',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: ['sre', 'dbas', 'ssh-users'],
        authenticators: { cert: { id: 'auth-4' } },
        enrollment: {},
        hasEdgeRouterConnection: true,
        sdkInfo: { appId: 'ziti-edge-tunnel', version: '1.3.2' },
        createdAt: now,
      },
      {
        id: 'id-dave',
        name: 'dave-tablet',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: ['sales'],
        authenticators: {},
        enrollment: {
          ott: {
            id: 'enr-dave',
            jwt: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJpZC1kYXZlIiwiaXNzIjoiaHR0cHM6Ly96aXRpLmJha2VkcGFzdGEubG9jYWw6MTI4MCIsImV4cCI6MTk5OTk5OTk5OX0.demo-signature-dave',
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        },
        hasEdgeRouterConnection: false,
        createdAt: now,
      },
      {
        id: 'id-crm-host',
        tags: { geolocation: '39.04380,-77.48740' },
        name: 'crm-prod-01',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: ['crm-https-hosts'],
        authenticators: { cert: { id: 'auth-5' } },
        enrollment: {},
        hasEdgeRouterConnection: true,
        sdkInfo: { appId: 'ziti-edge-tunnel', version: '1.3.2' },
        createdAt: now,
      },
      {
        id: 'id-devbox-host',
        tags: { geolocation: '41.87810,-87.62980' },
        name: 'devbox',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: ['devbox-ssh-hosts'],
        authenticators: { cert: { id: 'auth-6' } },
        enrollment: {},
        hasEdgeRouterConnection: true,
        sdkInfo: { appId: 'ziti-edge-tunnel', version: '1.3.2' },
        createdAt: now,
      },
      {
        id: 'id-billing-host',
        tags: { geolocation: '50.11090,8.68210' },
        name: 'billing-db',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: ['billing-db-postgres-hosts'],
        authenticators: { cert: { id: 'auth-7' } },
        enrollment: {},
        hasEdgeRouterConnection: true,
        sdkInfo: { appId: 'ziti-edge-tunnel', version: '1.3.2' },
        createdAt: now,
      },
      {
        id: 'id-unassigned',
        name: 'contractor-laptop',
        typeId: 'Default',
        type: { name: 'Default' },
        isAdmin: false,
        roleAttributes: [],
        authenticators: {},
        enrollment: {
          ott: {
            id: 'enr-contractor',
            jwt: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJpZC11bmFzc2lnbmVkIiwiaXNzIjoiaHR0cHM6Ly96aXRpLmJha2VkcGFzdGEubG9jYWw6MTI4MCIsImV4cCI6MTk5OTk5OTk5OX0.demo-signature-contractor',
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        },
        hasEdgeRouterConnection: false,
        createdAt: now,
      },
    ],
    services: [
      {
        id: 'svc-crm',
        name: 'crm-https',
        roleAttributes: ['crm-https', 'https', 'web'],
        configs: ['cfg-crm-intercept', 'cfg-crm-host'],
        encryptionRequired: true,
        terminatorStrategy: 'smartrouting',
        createdAt: now,
      },
      {
        id: 'svc-ssh',
        name: 'devbox-ssh',
        roleAttributes: ['devbox-ssh', 'ssh'],
        configs: ['cfg-ssh-intercept', 'cfg-ssh-host'],
        encryptionRequired: true,
        terminatorStrategy: 'smartrouting',
        createdAt: now,
      },
      {
        id: 'svc-pg',
        name: 'billing-db-postgres',
        roleAttributes: ['billing-db-postgres', 'postgres'],
        configs: ['cfg-pg-intercept', 'cfg-pg-host'],
        encryptionRequired: true,
        terminatorStrategy: 'smartrouting',
        createdAt: now,
      },
      {
        id: 'svc-staging',
        name: 'staging-api',
        roleAttributes: ['staging'],
        configs: [],
        encryptionRequired: true,
        terminatorStrategy: 'smartrouting',
        createdAt: now,
      },
    ],
    'edge-routers': [
      {
        id: 'er-us-east',
        tags: { geolocation: '38.94450,-77.45580' },
        name: 'us-east-edge-01',
        roleAttributes: ['public', 'us-east'],
        isOnline: true,
        isVerified: true,
        cost: 10,
        noTraversal: false,
        versionInfo: { version: 'v1.3.2' },
        createdAt: now,
      },
      {
        id: 'er-eu-west',
        tags: { geolocation: '53.34980,-6.26030' },
        name: 'eu-west-edge-01',
        roleAttributes: ['public', 'eu-west'],
        isOnline: true,
        isVerified: true,
        cost: 20,
        noTraversal: false,
        versionInfo: { version: 'v1.3.2' },
        createdAt: now,
      },
      {
        id: 'er-lab',
        name: 'dc-private-router',
        roleAttributes: ['datacenter'],
        isOnline: false,
        isVerified: true,
        cost: 5,
        noTraversal: false,
        versionInfo: { version: 'v1.3.1' },
        createdAt: now,
      },
    ],
    'transit-routers': [
      {
        id: 'tr-core-01',
        tags: { geolocation: '52.36760,4.90410' },
        name: 'core-fabric-transit-01',
        isOnline: true,
        isVerified: true,
        cost: 0,
        createdAt: now,
      },
    ],
    'service-policies': [
      {
        id: 'sp-crm-dial',
        name: 'crm-https-dial',
        type: 'Dial',
        semantic: 'AnyOf',
        identityRoles: ['#employees', '#sales'],
        serviceRoles: ['#crm-https', '#web'],
        postureCheckRoles: [],
        createdAt: now,
      },
      {
        id: 'sp-crm-bind',
        name: 'crm-https-bind',
        type: 'Bind',
        semantic: 'AnyOf',
        identityRoles: ['#crm-https-hosts'],
        serviceRoles: ['#crm-https'],
        postureCheckRoles: [],
        createdAt: now,
      },
      {
        id: 'sp-ssh-dial',
        name: 'devbox-ssh-dial',
        type: 'Dial',
        semantic: 'AnyOf',
        identityRoles: ['#ssh-users', '#sre'],
        serviceRoles: ['#devbox-ssh'],
        postureCheckRoles: ['#mfa-required'],
        postureCheckRolesDisplay: [{ name: 'MFA Required', role: '#mfa-required' }],
        createdAt: now,
      },
      {
        id: 'sp-ssh-bind',
        name: 'devbox-ssh-bind',
        type: 'Bind',
        semantic: 'AnyOf',
        identityRoles: ['#devbox-ssh-hosts'],
        serviceRoles: ['#devbox-ssh'],
        postureCheckRoles: [],
        createdAt: now,
      },
      {
        id: 'sp-pg-dial',
        name: 'billing-db-postgres-dial',
        type: 'Dial',
        semantic: 'AnyOf',
        identityRoles: ['#dbas', '#developers'],
        serviceRoles: ['#billing-db-postgres'],
        postureCheckRoles: [],
        createdAt: now,
      },
      {
        id: 'sp-pg-bind',
        name: 'billing-db-postgres-bind',
        type: 'Bind',
        semantic: 'AnyOf',
        identityRoles: ['#billing-db-postgres-hosts'],
        serviceRoles: ['#billing-db-postgres'],
        postureCheckRoles: [],
        createdAt: now,
      },
    ],
    'edge-router-policies': [
      {
        id: 'erp-all-public',
        name: 'all-identities-public-routers',
        semantic: 'AnyOf',
        identityRoles: ['#all'],
        edgeRouterRoles: ['#public'],
        createdAt: now,
      },
    ],
    'service-edge-router-policies': [
      {
        id: 'serp-all-services',
        name: 'all-services-public-routers',
        semantic: 'AnyOf',
        serviceRoles: ['#all'],
        edgeRouterRoles: ['#public'],
        createdAt: now,
      },
    ],
    'posture-checks': [
      {
        id: 'pc-mfa',
        name: 'MFA Required',
        typeId: 'MFA',
        roleAttributes: ['mfa-required'],
        timeoutSeconds: 3600,
        promptOnWake: true,
        promptOnUnlock: false,
        createdAt: now,
      },
      {
        id: 'pc-mac-os',
        name: 'macOS 14+ Minimum',
        typeId: 'OS',
        roleAttributes: ['os-check'],
        operatingSystems: [{ type: 'macOS', versions: ['>=14.0.0'] }],
        createdAt: now,
      },
    ],
    cas: [
      {
        id: 'ca-corp',
        name: 'Corporate Hardware PKI CA',
        isVerified: true,
        isAutoCaEnrollmentEnabled: true,
        isOttCaEnrollmentEnabled: false,
         isAuthEnabled: true,
        identityRoles: ['#employees'],
        createdAt: now,
      },
    ],
    'auth-policies': [
      {
        id: 'ap-default',
        name: 'Default Auth Policy',
        primary: {
          cert: { allowed: true, allowExpiredCerts: false },
          updb: { allowed: true, minPasswordLength: 8, requireMixedCase: true },
          extJwt: { allowed: true, allowedSigners: [] },
        },
        secondary: { requireTotp: false },
        createdAt: now,
      },
    ],
    'external-jwt-signers': [
      {
        id: 'ejs-okta',
        name: 'Okta Workforce OIDC',
        issuer: 'https://login.bakedpasta.example.com/oauth2/default',
        audience: 'openziti-edge',
        jwksEndpoint: 'https://login.bakedpasta.example.com/oauth2/default/v1/keys',
        enabled: true,
        claimsProperty: 'email',
        useExternalId: true,
        createdAt: now,
      },
    ],
    terminators: [
      {
        id: 'term-crm-1',
        serviceId: 'svc-crm',
        service: { name: 'crm-https' },
        routerId: 'er-us-east',
        router: { name: 'us-east-edge-01' },
        binding: 'edge',
        address: 'hosted:id-crm-host',
        cost: 0,
        precedence: 'default',
        createdAt: now,
      },
      {
        id: 'term-ssh-1',
        serviceId: 'svc-ssh',
        service: { name: 'devbox-ssh' },
        routerId: 'er-us-east',
        router: { name: 'us-east-edge-01' },
        binding: 'edge',
        address: 'hosted:id-devbox-host',
        cost: 0,
        precedence: 'default',
        createdAt: now,
      },
      {
        id: 'term-pg-1',
        serviceId: 'svc-pg',
        service: { name: 'billing-db-postgres' },
        routerId: 'er-eu-west',
        router: { name: 'eu-west-edge-01' },
        binding: 'edge',
        address: 'hosted:id-billing-host',
        cost: 0,
        precedence: 'default',
        createdAt: now,
      },
    ],
    sessions: [
      {
        id: 'sess-01',
        serviceId: 'svc-crm',
        service: { name: 'crm-https' },
        identityId: 'id-alice',
        type: 'Dial',
        createdAt: now,
      },
      {
        id: 'sess-02',
        serviceId: 'svc-ssh',
        service: { name: 'devbox-ssh' },
        identityId: 'id-bob',
        type: 'Dial',
        createdAt: now,
      },
    ],
    'api-sessions': [
      {
        id: 'apisess-01',
        identityId: 'id-admin',
        identity: { name: 'Default Admin' },
        ipAddress: '127.0.0.1',
        authQueries: [],
        lastActivityAt: now,
        createdAt: now,
      },
      {
        id: 'apisess-02',
        identityId: 'id-alice',
        identity: { name: 'alice-macbook' },
        ipAddress: '198.51.100.42',
        authQueries: [],
        lastActivityAt: now,
        createdAt: now,
      },
    ],
  };
}

/** Demo links between router pairs, with per-direction latency in nanoseconds. */
const DEMO_LINKS: { a: string; b: string; src: number; dst: number; down?: boolean }[] = [
  { a: 'er-us-east', b: 'tr-core-01', src: 38_000_000, dst: 41_000_000 },
  { a: 'er-eu-west', b: 'tr-core-01', src: 9_000_000, dst: 11_000_000 },
  { a: 'er-us-east', b: 'er-eu-west', src: 72_000_000, dst: 76_000_000 },
  { a: 'er-lab', b: 'tr-core-01', src: 0, dst: 0, down: true },
];

/**
 * Fabric API stand-in for the Demo Sandbox, derived from the current demo store so it follows
 * edits: routers with their online state, a few links with latencies, and one circuit per
 * Dial session, routed client-side edge router -> (core) -> the hosting terminator's router.
 */
export function demoFabric(store: RawDemoStore): { [K in keyof FabricEntities]: FabricEntities[K][] } {
  const edge = store['edge-routers'] || [];
  const transit = store['transit-routers'] || [];
  const routers: FabricRouter[] = [
    ...edge.map((r) => ({ id: r.id, name: r.name, connected: !!r.isOnline, cost: r.cost, tags: r.tags })),
    ...transit.map((r) => ({ id: r.id, name: r.name, connected: !!r.isOnline, cost: r.cost, tags: r.tags })),
  ];
  const routerName = (id: string) => routers.find((r) => r.id === id)?.name;
  const linkId = (a: string, b: string) => `link-${[a, b].sort().join('--')}`;
  const links: FabricLink[] = DEMO_LINKS.filter((l) => routerName(l.a) && routerName(l.b)).map((l) => ({
    id: linkId(l.a, l.b),
    sourceRouter: { id: l.a, name: routerName(l.a) },
    destRouter: { id: l.b, name: routerName(l.b) },
    state: l.down ? 'Failed' : 'Connected',
    down: !!l.down,
    protocol: 'tls',
    cost: 1,
    sourceLatency: l.src,
    destLatency: l.dst,
  }));
  const hasLink = (a: string, b: string) => links.some((l) => l.id === linkId(a, b) && !l.down);

  // Clients in Europe (east of 30°W) enter via eu-west, everyone else via us-east.
  const ingressFor = (identityId: string | undefined) => {
    const ident = store.identities.find((i) => i.id === identityId);
    const p = parseGeolocation(ident?.tags?.geolocation);
    return p && p.lng > -30 ? 'er-eu-west' : 'er-us-east';
  };

  const circuits: FabricCircuit[] = [];
  for (const s of store.sessions || []) {
    if (s.type === 'Bind' || !s.serviceId) continue;
    const term = (store.terminators || []).find((t) => t.serviceId === s.serviceId);
    if (!term) continue;
    const hostId = term.address?.startsWith('hosted:') ? term.address.slice('hosted:'.length) : undefined;
    const ingress = ingressFor(s.identityId);
    if (!routerName(ingress)) continue;
    const egress = term.routerId;
    let nodes = [ingress];
    if (egress !== ingress) {
      nodes =
        hasLink(ingress, 'tr-core-01') && hasLink('tr-core-01', egress)
          ? [ingress, 'tr-core-01', egress]
          : [ingress, egress];
    }
    circuits.push({
      id: `circ-${s.id}`,
      service: { id: s.serviceId, name: s.service?.name },
      terminator: { id: term.id },
      path: {
        nodes: nodes.map((id) => ({ id, name: routerName(id) })),
        links: nodes.slice(1).map((n, i) => linkId(nodes[i], n)),
      },
      tags: { clientId: s.identityId, ...(hostId ? { hostId } : {}) },
      createdAt: s.createdAt,
    });
  }
  return { routers, links, circuits };
}
