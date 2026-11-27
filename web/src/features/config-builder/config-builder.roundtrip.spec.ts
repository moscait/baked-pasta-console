// Characterization tests: what the builder emits for real-world-shaped files, including content the
// form does not manage. The snapshots pin byte-for-byte output so refactors can't change it unseen.

import { describe, expect, it } from 'vitest';
import { defaultConfig, fromYaml, toYaml } from './controller-config.model';
import { defaultRouterConfig, detectKind, parseConfigText, routerFromDocument, routerToYaml } from './router-config.model';

const HA_CONTROLLER = `v: 3
trustDomain: example.ziti
identity:
  cert: ./pki/ctrl-client.cert
  server_cert: ./pki/ctrl-server.chain.pem
  key: ./pki/ctrl-server.key
  ca: ./pki/cas.pem
  alt_server_certs:
    - server_cert: ./pki/alt.cert
      server_key: ./pki/alt.key
cluster:
  dataDir: /var/lib/ziti/cluster
  preferredLeader: true
  electionTimeout: 7s
ctrl:
  listener: tls:0.0.0.0:6262
  options:
    advertiseAddress: tls:ctrl1.example.com:6262
    maxQueuedConnects: 2000
    newListener: tls:0.0.0.0:6263
network:
  cycleSeconds: 30
  smart:
    rerouteFraction: 0.05
    rerouteCap: 8
healthChecks:
  boltCheck:
    interval: 45s
    timeout: 20s
edge:
  api:
    address: ctrl1.example.com:1280
    sessionTimeout: 1h
  enrollment:
    signingCert:
      cert: ./pki/signing.cert
      key: ./pki/signing.key
    edgeIdentity:
      duration: 5h
  oidc:
    refreshTokenDuration: 48h
  totp:
    hostname: totp.example.com
  authRateLimiter:
    enabled: true
    maxSize: 500
web:
  - name: public
    bindPoints:
      - interface: 0.0.0.0:1280
        address: ctrl1.example.com:1280
        newAddress: ctrl.example.com:1280
      - identity:
          file: /etc/ziti/overlay.json
          service: mgmt-api
          tlsClientAuthenticationPolicy: requireandverifyclientcert
          listenOptions:
            bindUsingEdgeIdentity: true
            connectTimeout: 5s
        note: overlay
    identity:
      cert: ./pki/web.cert
    options:
      idleTimeout: 5000ms
    apis:
      - binding: health-checks
      - binding: edge-management
        options:
          pageSize: 100
      - binding: edge-client
      - binding: spa
        options:
          path: console
          location: /opt/console
          indexFile: index.html
      - binding: custom-thing
        options:
          x: 1
events:
  jsonLogger:
    subscriptions:
      - type: circuit
        include:
          - created
      - type: metrics
        sourceFilter: .*
      - type: entityChange
    handler:
      type: file
      format: json
      path: /var/log/ziti-events.log
      maxsizemb: 100
  amqp:
    subscriptions:
      - type: session
    handler:
      type: amqp
      url: amqp://localhost
customPlugin:
  enabled: true
  list: [1, "two", null, true]
`;

const EDGE_ROUTER = `v: 3
identity:
  cert: /etc/ziti/router.cert
  server_cert: /etc/ziti/router.server.cert
  key: /etc/ziti/router.key
  ca: /etc/ziti/ca.pem
  altServerCerts: []
ctrl:
  endpoints:
    - tls:ctrl1.example.com:6262
    - tls:ctrl2.example.com:6262
  endpointsFile: /var/lib/ziti/endpoints.yml
link:
  dialers:
    - binding: transport
      groups: [east]
      options:
        connectTimeout: 3s
    - binding: custom
  listeners:
    - binding: transport
      bind: tls:0.0.0.0:10080
      advertise: tls:er1.example.com:10080
      groups: [east, core]
      options:
        outQueueSize: 64
listeners:
  - binding: edge
    address: tls:0.0.0.0:3022
    options:
      advertise: er1.example.com:3022
      connectTimeoutMs: 5000
  - binding: tunnel
    options:
      mode: tproxy
      resolver: udp://127.0.0.1:53
      lanIf: eth0
  - binding: edge_wss
    address: wss:0.0.0.0:3023
edge:
  csr:
    country: CA
    locality: Toronto
    organization: Example
    sans:
      dns: [localhost, er1.example.com]
      ip: [127.0.0.1]
forwarder:
  latencyProbeInterval: 10
  xgressDialQueueLength: 1000
metrics:
  reportInterval: 30s
healthChecks:
  ctrlPingCheck:
    interval: 30s
    timeout: 15s
  linkCheck:
    minLinks: 1
plugins:
  - name: example
`;

const FABRIC_ROUTER = `v: 3
identity:
  cert: r.cert
  key: r.key
  ca: ca.pem
ctrl:
  endpoint: tls:ctrl.example.com:6262
link:
  dialers:
    - binding: transport
csr:
  country: US
  sans:
    dns: [fabric.example.com]
`;

describe('controller round-trip', () => {
  it('keeps an HA config with unmanaged content', () => {
    const { cfg, warnings } = fromYaml(HA_CONTROLLER);
    expect(warnings).toMatchSnapshot('warnings');
    expect(toYaml(cfg)).toMatchSnapshot('minimal');
    expect(toYaml(cfg, true)).toMatchSnapshot('verbose');
  });

  it('applies form edits on top of the source', () => {
    const { cfg } = fromYaml(HA_CONTROLLER);
    cfg.trustDomain = '';
    cfg.identity.serverCert = '';
    cfg.ctrl.advertiseAddress = '';
    cfg.network.smartReroute = false;
    cfg.edge.totpHostname = '';
    cfg.edge.authRateLimiter = false;
    cfg.web[0].apis['spa'] = false;
    cfg.web[0].apis['fabric'] = true;
    cfg.events = cfg.events.filter((e) => e.name !== 'amqp');
    cfg.events[0].subscriptions = ['circuit', 'router'];
    expect(toYaml(cfg)).toMatchSnapshot();
  });

  it('switches HA to standalone', () => {
    const { cfg } = fromYaml(HA_CONTROLLER);
    cfg.mode = 'standalone';
    cfg.db = '/var/lib/ziti/ctrl.db';
    cfg.events = [];
    expect(toYaml(cfg)).toMatchSnapshot();
  });

  it('emits a fresh config, minimal and verbose', () => {
    expect(toYaml(defaultConfig())).toMatchSnapshot('minimal');
    expect(toYaml(defaultConfig(), true)).toMatchSnapshot('verbose');
  });

  it('quotes strings a YAML parser would misread', () => {
    const cfg = defaultConfig();
    cfg.trustDomain = 'yes';
    cfg.edge.totpHostname = '0x1F';
    cfg.db = 'a: b # c';
    expect(toYaml(cfg)).toMatchSnapshot();
  });
});

describe('router round-trip', () => {
  it('keeps an edge router with unmanaged content', () => {
    const doc = parseConfigText(EDGE_ROUTER);
    expect(detectKind(doc)).toBe('router');
    const { cfg, warnings } = routerFromDocument(doc);
    expect(warnings).toMatchSnapshot('warnings');
    expect(routerToYaml(cfg)).toMatchSnapshot('unchanged');
  });

  it('applies form edits in place', () => {
    const { cfg } = routerFromDocument(parseConfigText(EDGE_ROUTER));
    cfg.ctrl.endpoints = ['tls:ctrl1.example.com:6262'];
    cfg.link.dial = false;
    cfg.link.listenGroups = [];
    cfg.link.outQueueSize = null;
    cfg.tunnel.mode = 'host';
    cfg.edge.connectTimeoutMs = null;
    cfg.csr.ip = [];
    cfg.forwarder.xgressDialQueueLength = null;
    cfg.health.minLinks = null;
    expect(routerToYaml(cfg)).toMatchSnapshot();
  });

  it('drops edge and tunnel listeners when turned off', () => {
    const { cfg } = routerFromDocument(parseConfigText(EDGE_ROUTER));
    cfg.edge.enabled = false;
    cfg.tunnel.enabled = false;
    expect(routerToYaml(cfg)).toMatchSnapshot();
  });

  it('keeps a fabric-only router’s top-level CSR', () => {
    const { cfg, warnings } = routerFromDocument(parseConfigText(FABRIC_ROUTER));
    expect(cfg.csrTop).toBe(true);
    expect(warnings).toEqual([]);
    cfg.tunnel.enabled = true;
    expect(routerToYaml(cfg)).toMatchSnapshot();
  });

  it('emits a fresh router config in section order', () => {
    expect(routerToYaml(defaultRouterConfig())).toMatchSnapshot();
  });
});
