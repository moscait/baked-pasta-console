package io.moscait.bpc.configbuilder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Byte-for-byte parity with the web console's Config Builder: the same fixtures and the vitest
 * snapshots copied from web/src/features/config-builder/__snapshots__.
 */
public class ConfigBuilderRoundTripTest {

    static final String HA_CONTROLLER = """
            v: 3
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
            """;

    public static final String EDGE_ROUTER = """
            v: 3
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
            """;

    static final String FABRIC_ROUTER = """
            v: 3
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
            """;

    static final Map<String, String> SNAPSHOTS = new LinkedHashMap<>();

    @BeforeAll
    static void loadSnapshots() throws IOException {
        String text;
        try (InputStream in = ConfigBuilderRoundTripTest.class.getResourceAsStream("/config-builder/roundtrip.snap")) {
            text = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher m = Pattern.compile("exports\\[`(.+?)`\\] = `\\n(.*?)\\n`;", Pattern.DOTALL).matcher(text);
        while (m.find()) {
            String body = m.group(2).replace("\\`", "`").replace("\\${", "${");
            SNAPSHOTS.put(m.group(1), body);
        }
        assertEquals(14, SNAPSHOTS.size());
    }

    static void assertSnapshot(String name, String actual) {
        String snap = SNAPSHOTS.get(name);
        assertTrue(snap != null, "missing snapshot " + name);
        assertEquals(snap.substring(1, snap.length() - 1), actual, name);
    }

    static void assertWarnings(String name, List<String> warnings) {
        StringBuilder b = new StringBuilder("[\n");
        warnings.forEach(w -> b.append("  \"").append(w).append("\",\n"));
        assertEquals(SNAPSHOTS.get(name), b.append("]").toString(), name);
    }

    @Test
    void controllerKeepsHaConfigWithUnmanagedContent() {
        var loaded = ControllerConfig.fromYaml(HA_CONTROLLER);
        assertWarnings("controller round-trip > keeps an HA config with unmanaged content > warnings 1", loaded.warnings());
        assertSnapshot("controller round-trip > keeps an HA config with unmanaged content > minimal 1",
                loaded.cfg().toYaml(false));
        assertSnapshot("controller round-trip > keeps an HA config with unmanaged content > verbose 1",
                loaded.cfg().toYaml(true));
    }

    @Test
    void controllerAppliesFormEditsOnTopOfSource() {
        ControllerConfig cfg = ControllerConfig.fromYaml(HA_CONTROLLER).cfg();
        cfg.trustDomain = "";
        cfg.identity.serverCert = "";
        cfg.ctrl.advertiseAddress = "";
        cfg.network.smartReroute = false;
        cfg.edge.totpHostname = "";
        cfg.edge.authRateLimiter = false;
        cfg.web.getFirst().apis.put("spa", false);
        cfg.web.getFirst().apis.put("fabric", true);
        cfg.events.removeIf(e -> e.name.equals("amqp"));
        cfg.events.getFirst().subscriptions = new java.util.ArrayList<>(List.of("circuit", "router"));
        assertSnapshot("controller round-trip > applies form edits on top of the source 1", cfg.toYaml(false));
    }

    @Test
    void controllerSwitchesHaToStandalone() {
        ControllerConfig cfg = ControllerConfig.fromYaml(HA_CONTROLLER).cfg();
        cfg.mode = "standalone";
        cfg.db = "/var/lib/ziti/ctrl.db";
        cfg.events.clear();
        assertSnapshot("controller round-trip > switches HA to standalone 1", cfg.toYaml(false));
    }

    @Test
    void controllerFreshMinimalAndVerbose() {
        assertSnapshot("controller round-trip > emits a fresh config, minimal and verbose > minimal 1",
                ControllerConfig.defaults().toYaml(false));
        assertSnapshot("controller round-trip > emits a fresh config, minimal and verbose > verbose 1",
                ControllerConfig.defaults().toYaml(true));
    }

    @Test
    void controllerQuotesAmbiguousStrings() {
        ControllerConfig cfg = ControllerConfig.defaults();
        cfg.trustDomain = "yes";
        cfg.edge.totpHostname = "0x1F";
        cfg.db = "a: b # c";
        assertSnapshot("controller round-trip > quotes strings a YAML parser would misread 1", cfg.toYaml(false));
    }

    @Test
    void routerKeepsEdgeRouterWithUnmanagedContent() {
        Map<String, Object> doc = YamlSupport.parseMap(EDGE_ROUTER);
        assertEquals("router", RouterConfig.detectKind(doc));
        var loaded = RouterConfig.fromDocument(doc);
        assertWarnings("router round-trip > keeps an edge router with unmanaged content > warnings 1", loaded.warnings());
        assertSnapshot("router round-trip > keeps an edge router with unmanaged content > unchanged 1", loaded.cfg().toYaml());
    }

    @Test
    void routerAppliesFormEditsInPlace() {
        RouterConfig cfg = RouterConfig.fromDocument(YamlSupport.parseMap(EDGE_ROUTER)).cfg();
        cfg.ctrl.endpoints = new java.util.ArrayList<>(List.of("tls:ctrl1.example.com:6262"));
        cfg.link.dial = false;
        cfg.link.listenGroups = new java.util.ArrayList<>();
        cfg.link.outQueueSize = null;
        cfg.tunnel.mode = "host";
        cfg.edge.connectTimeoutMs = null;
        cfg.csr.ip = new java.util.ArrayList<>();
        cfg.forwarder.xgressDialQueueLength = null;
        cfg.health.minLinks = null;
        assertSnapshot("router round-trip > applies form edits in place 1", cfg.toYaml());
    }

    @Test
    void routerDropsEdgeAndTunnelWhenOff() {
        RouterConfig cfg = RouterConfig.fromDocument(YamlSupport.parseMap(EDGE_ROUTER)).cfg();
        cfg.edge.enabled = false;
        cfg.tunnel.enabled = false;
        assertSnapshot("router round-trip > drops edge and tunnel listeners when turned off 1", cfg.toYaml());
    }

    @Test
    void routerKeepsFabricOnlyTopLevelCsr() {
        var loaded = RouterConfig.fromDocument(YamlSupport.parseMap(FABRIC_ROUTER));
        assertTrue(loaded.cfg().csrTop);
        assertEquals(List.of(), loaded.warnings());
        loaded.cfg().tunnel.enabled = true;
        assertSnapshot("router round-trip > keeps a fabric-only router’s top-level CSR 1", loaded.cfg().toYaml());
    }

    @Test
    void routerFreshInSectionOrder() {
        assertSnapshot("router round-trip > emits a fresh router config in section order 1", RouterConfig.defaults().toYaml());
    }

    // ------------------------------------------------------------------ config-builder.spec.ts

    @Test
    void defaultsValidateAndDetect() {
        assertTrue(ControllerConfig.defaults().validate().stream().noneMatch(ValidationIssue::isError));
        assertTrue(RouterConfig.defaults().validate().stream().noneMatch(ValidationIssue::isError));
        Map<String, Object> doc = YamlSupport.parseMap(ControllerConfig.defaults().toYaml(false));
        assertEquals(3, doc.get("v"));
        assertEquals("controller", RouterConfig.detectKind(doc));
        assertEquals("unknown", RouterConfig.detectKind(Map.of("v", 3)));
        assertEquals("unknown", RouterConfig.detectKind("text"));
    }

    @Test
    void controllerRoundTripsAndKeepsUnmanagedKeys() {
        ControllerConfig cfg = ControllerConfig.defaults();
        cfg.ctrl.advertiseAddress = "tls:ctrl.example.com:6262";
        cfg.edge.apiAddress = "ctrl.example.com:1280";
        ControllerConfig back = ControllerConfig.fromYaml(cfg.toYaml(false)).cfg();
        assertEquals("tls:ctrl.example.com:6262", back.ctrl.advertiseAddress);
        assertEquals("ctrl.example.com:1280", back.edge.apiAddress);
        assertTrue(back.web.getFirst().api("edge-management"));
        String text = ControllerConfig.defaults().toYaml(false) + "\ncustomPlugin:\n  enabled: true\n";
        Map<String, Object> out = YamlSupport.parseMap(ControllerConfig.fromYaml(text).cfg().toYaml(false));
        assertEquals(Map.of("enabled", true), out.get("customPlugin"));
        ControllerConfig bad = ControllerConfig.defaults();
        bad.ctrl.listener = "not-an-endpoint";
        assertTrue(bad.validate().stream().anyMatch(i -> i.isError() && i.section().equals("ctrl")));
    }
}
