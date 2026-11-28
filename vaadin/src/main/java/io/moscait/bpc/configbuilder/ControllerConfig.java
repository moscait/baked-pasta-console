package io.moscait.bpc.configbuilder;

import static io.moscait.bpc.configbuilder.YamlSupport.asList;
import static io.moscait.bpc.configbuilder.YamlSupport.asMap;
import static io.moscait.bpc.configbuilder.YamlSupport.get;
import static io.moscait.bpc.configbuilder.YamlSupport.isObj;
import static io.moscait.bpc.configbuilder.YamlSupport.map;
import static io.moscait.bpc.configbuilder.YamlSupport.str;
import static io.moscait.bpc.configbuilder.YamlSupport.truthy;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Model, defaults, validation and YAML emitter for an OpenZiti controller config ({@code v: 3}).
 * Ported in behaviour from the web console (itself from openziti/ziti-console 4.8.1, Apache-2.0).
 * Defaults and ranges mirror the controller source. Values equal to the controller default are
 * omitted from the output unless {@code verbose} is set.
 */
public final class ControllerConfig {

    // ------------------------------------------------------------------ model

    public static final class BindPointIdentity {
        /** "file" or "env". */
        public String source = "file";
        public String value = "";
        public String service = "";
        public String clientAuth = "";
        public boolean bindUsingEdgeIdentity;
        public Map<String, Object> raw;
    }

    public static final class BindPoint {
        public String iface = "";
        public String address = "";
        public String newAddress;
        public BindPointIdentity identity;
        public Map<String, Object> extra;

        public BindPoint() {
        }

        public BindPoint(String iface, String address) {
            this.iface = iface;
            this.address = address;
        }
    }

    public static final class WebListener {
        public String name = "";
        public List<BindPoint> bindPoints = new ArrayList<>();
        public Map<String, Boolean> apis = new LinkedHashMap<>();
        public String spaPath = "zac";
        public String spaLocation = "";
        public Map<String, Object> extra;
        public List<Object> extraApis;
        public Map<String, Object> apiOptions;
        public Map<String, Object> spaExtra;

        public boolean api(String id) {
            return Boolean.TRUE.equals(apis.get(id));
        }
    }

    public static final class EventLogger {
        public String name = "";
        public List<String> subscriptions = new ArrayList<>();
        /** "json" or "cs". */
        public String format = "json";
        public String path = "";
        public Map<String, Object> rawSubs;
        public Object handlerRaw;
    }

    public static final class Identity {
        public String cert;
        public String serverCert;
        public String key;
        public String ca;
    }

    public static final class Cluster {
        public String dataDir = "./data/cluster";
        public boolean preferredLeader;
        public String snapshotInterval = "2m";
        public double snapshotThreshold = 500;
        public String electionTimeout = "5s";
        public String heartbeatTimeout = "3s";
        public String logLevel = "info";
    }

    public static final class Ctrl {
        public String listener = "tls:0.0.0.0:6262";
        public String advertiseAddress = "";
        public double connectTimeoutMs = 1000;
        public double maxQueuedConnects = 1000;
    }

    public static final class Network {
        public double cycleSeconds = 60;
        public double routeTimeoutSeconds = 10;
        public double createCircuitRetries = 2;
        public double pendingLinkTimeoutSeconds = 10;
        public double minRouterCost = 10;
        public String routerConnectChurnLimit = "1m";
        public boolean smartReroute;
        public double rerouteFraction = 0.02;
        public double rerouteCap = 4;
    }

    public static final class Edge {
        public boolean enabled = true;
        public String apiAddress = "localhost:1280";
        public String sessionTimeout = "30m";
        public String signingCert = "./pki/signing/certs/signing.cert";
        public String signingKey = "./pki/signing/keys/signing.key";
        public String identityEnrollmentDuration = "180m";
        public String routerEnrollmentDuration = "180m";
        public String accessTokenDuration = "30m";
        public String refreshTokenDuration = "24h";
        public boolean authRateLimiter = true;
        public double authRateLimiterMax = 250;
        public String totpHostname = "";
    }

    /** Parsed source document when a file was ingested; unmanaged keys pass through from here. */
    public Map<String, Object> base;
    /** "standalone" or "ha". */
    public String mode = "standalone";
    public String trustDomain = "";
    public Identity identity = new Identity();
    public String db = "./data/ctrl.db";
    public Cluster cluster = new Cluster();
    public Ctrl ctrl = new Ctrl();
    public Network network = new Network();
    public Edge edge = new Edge();
    public List<WebListener> web = new ArrayList<>();
    public List<EventLogger> events = new ArrayList<>();
    public String healthCheckInterval = "30s";

    public record Api(String id, String label, String hint) {
    }

    public static final List<Api> API_BINDINGS = List.of(
            new Api("health-checks", "Health Checks", "Liveness endpoint for load balancers and probes."),
            new Api("fabric", "Fabric", "Fabric management API (routers, links, circuits)."),
            new Api("edge-management", "Edge Management", "The API this console and the CLI talk to."),
            new Api("edge-client", "Edge Client", "The API SDKs and tunnelers authenticate against."),
            new Api("edge-oidc", "Edge OIDC", "OIDC provider for token-based SDK authentication."),
            new Api("spa", "Console (SPA)", "Serve this console from the controller."));

    public static final List<String> CLIENT_AUTH_LABELS = List.of("default (verify if given)", "no client cert",
            "request client cert", "require any client cert", "verify client cert if given",
            "require and verify client cert");

    public static final List<String> EVENT_SUBSCRIPTIONS = List.of("apiSession", "authentication", "circuit", "connect",
            "sdk", "entityChange", "entityCount", "link", "metrics", "router", "session", "services", "terminator", "usage",
            "cluster");

    public static final List<String> LOG_LEVELS = List.of("trace", "debug", "info", "warn", "error");

    public static ControllerConfig defaults() {
        ControllerConfig c = new ControllerConfig();
        c.identity.cert = "./pki/ctrl-client/certs/ctrl-client.cert";
        c.identity.serverCert = "./pki/ctrl-server/certs/ctrl-server.chain.pem";
        c.identity.key = "./pki/ctrl-server/keys/ctrl-server.key";
        c.identity.ca = "./pki/cas.pem";
        WebListener w = new WebListener();
        w.name = "client-management";
        w.bindPoints.add(new BindPoint("0.0.0.0:1280", "localhost:1280"));
        w.apis.put("health-checks", true);
        w.apis.put("fabric", false);
        w.apis.put("edge-management", true);
        w.apis.put("edge-client", true);
        w.apis.put("edge-oidc", true);
        w.apis.put("spa", false);
        w.spaLocation = "/opt/openziti/share/console";
        c.web.add(w);
        return c;
    }

    /** An ingested event handler the form does not edit (not a file logger), passed through untouched. */
    static boolean isCustomHandler(Object h) {
        return truthy(h) && !(isObj(h) && "file".equals(asMap(h).get("type")));
    }

    // ------------------------------------------------------------------ validation

    private static final Pattern DURATION = Pattern.compile("^(\\d+(\\.\\d+)?(ns|us|µs|ms|s|m|h))+$");
    private static final Pattern DURATION_PART = Pattern.compile("(\\d+(?:\\.\\d+)?)(ns|us|µs|ms|s|m|h)");
    static final Pattern ENV_REF = Pattern.compile("\\$\\{[^}]+\\}");
    static final Pattern HOSTNAME = Pattern.compile("^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9])?$");
    private static final Pattern HOST = Pattern.compile("^(\\[[0-9A-Fa-f:.]+\\]|[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9])?)$");
    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]*$");
    private static final Pattern TRUST_DOMAIN = Pattern.compile("^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$");
    private static final List<String> SCHEMES = List.of("tls", "tcp", "udp", "ws", "wss", "transwarp");

    static boolean env(String v) {
        return ENV_REF.matcher(v).find();
    }

    /** Parse a Go-style duration ("1m30s", "250ms") to milliseconds. NaN when invalid. */
    public static double parseDuration(String value) {
        if (value == null || value.isEmpty() || !DURATION.matcher(value).matches()) {
            return Double.NaN;
        }
        double total = 0;
        Matcher m = DURATION_PART.matcher(value);
        while (m.find()) {
            double unit = switch (m.group(2)) {
                case "ns" -> 1e-6;
                case "us", "µs" -> 1e-3;
                case "ms" -> 1;
                case "s" -> 1e3;
                case "m" -> 6e4;
                default -> 3.6e6;
            };
            total += Double.parseDouble(m.group(1)) * unit;
        }
        return total;
    }

    /** A problem description, or "" when {@code v} is a valid host:port. ${ENV} values are not checked. */
    public static String checkHostPort(String v) {
        if (env(v)) {
            return "";
        }
        int i = v.lastIndexOf(':');
        if (i <= 0) {
            return "must be host:port";
        }
        String host = v.substring(0, i);
        String port = v.substring(i + 1);
        if (!HOST.matcher(host).matches()) {
            return "host contains invalid characters";
        }
        if (!port.matches("\\d+") || new java.math.BigInteger(port).compareTo(java.math.BigInteger.ONE) < 0
                || new java.math.BigInteger(port).compareTo(java.math.BigInteger.valueOf(65535)) > 0) {
            return "port must be 1 to 65535";
        }
        return "";
    }

    /** A problem description, or "" when {@code v} is scheme:host:port (e.g. tls:0.0.0.0:6262). */
    public static String checkEndpoint(String v) {
        if (env(v)) {
            return "";
        }
        int i = v.indexOf(':');
        if (i <= 0 || !SCHEMES.contains(v.substring(0, i))) {
            return "must start with one of " + String.join(", ", SCHEMES) + " followed by :host:port";
        }
        return checkHostPort(v.substring(i + 1));
    }

    /** Filesystem paths: no quotes, control characters or surrounding whitespace. */
    public static String checkPath(String v) {
        if (Pattern.compile("[\\x00-\\x1f\"]").matcher(v).find()) {
            return "contains quotes or control characters";
        }
        if (!v.equals(v.trim())) {
            return "has leading or trailing whitespace";
        }
        return "";
    }

    static boolean isWhole(double v) {
        return Double.isFinite(v) && v == Math.rint(v);
    }

    /** Collects issues; the shared helpers for both config kinds. */
    static final class Issues {
        final List<ValidationIssue> out = new ArrayList<>();

        void err(String section, String message, String field) {
            out.add(new ValidationIssue(section, "error", message, field));
        }

        void err(String section, String message) {
            err(section, message, null);
        }

        void warn(String section, String message, String field) {
            out.add(new ValidationIssue(section, "warn", message, field));
        }

        void path(String section, String label, String v, String field, boolean required) {
            if (v == null || v.isEmpty()) {
                if (required) {
                    err(section, label + " is required", field);
                }
                return;
            }
            String p = checkPath(v);
            if (!p.isEmpty()) {
                err(section, label + " " + p, field);
            }
        }

        void hostPort(String section, String label, String v, String field) {
            String p = checkHostPort(v);
            if (!p.isEmpty()) {
                err(section, label + " " + p, field);
            }
        }

        void integer(String section, String label, double v, long min, long max, String field) {
            if (!isWhole(v) || v < min || v > max) {
                err(section, label + " must be a whole number from " + min + " to " + max, field);
            }
        }

        void duration(String section, String label, String v, String field, double minMs) {
            double ms = parseDuration(v);
            if (Double.isNaN(ms)) {
                err(section, label + " is not a valid duration (try 30s, 5m, 24h)", field);
            } else if (ms < minMs) {
                err(section, label + " must be at least " + YamlSupport.number(minMs / 1000) + "s", field);
            }
        }

        void name(String section, String label, String v, String field) {
            if (v == null || v.isEmpty()) {
                err(section, label + " is required", field);
            } else if (!NAME.matcher(v).matches()) {
                err(section, label + " \"" + v + "\" may only use letters, digits, dot, dash and underscore", field);
            }
        }
    }

    public List<ValidationIssue> validate() {
        Issues is = new Issues();
        ControllerConfig c = this;
        if (!c.trustDomain.isEmpty() && !env(c.trustDomain) && !TRUST_DOMAIN.matcher(c.trustDomain).matches()) {
            is.err("identity", "trustDomain must be a DNS-style name (letters, digits, dots, dashes; no spaces or quotes)",
                    "trustDomain");
        }
        is.path("identity", "identity.cert", c.identity.cert, "identity.cert", true);
        is.path("identity", "identity.server_cert", c.identity.serverCert, "identity.serverCert", false);
        is.path("identity", "identity.key", c.identity.key, "identity.key", true);
        is.path("identity", "identity.ca", c.identity.ca, "identity.ca", true);

        if (c.mode.equals("standalone")) {
            is.path("storage", "db", c.db, "db", true);
        } else {
            is.path("storage", "cluster.dataDir", c.cluster.dataDir, "cluster.dataDir", true);
            is.duration("storage", "snapshotInterval", c.cluster.snapshotInterval, "cluster.snapshotInterval", 0);
            is.duration("storage", "electionTimeout", c.cluster.electionTimeout, "cluster.electionTimeout", 0);
            is.duration("storage", "heartbeatTimeout", c.cluster.heartbeatTimeout, "cluster.heartbeatTimeout", 0);
            is.integer("storage", "snapshotThreshold", c.cluster.snapshotThreshold, 1, 1000000, "cluster.snapshotThreshold");
            if (c.ctrl.advertiseAddress.isEmpty()) {
                is.err("ctrl", "advertise address is required in HA: peers and routers dial it (written as ctrl.options.advertiseAddress)",
                        "ctrl.advertiseAddress");
            }
            if (c.trustDomain.isEmpty()) {
                is.warn("identity", "HA nodes need a spiffe:// URI SAN on the server cert; set trustDomain to match it",
                        "trustDomain");
            }
        }

        if (c.ctrl.listener.isEmpty()) {
            is.err("ctrl", "ctrl.listener is required", "ctrl.listener");
        } else {
            String p = checkEndpoint(c.ctrl.listener);
            if (!p.isEmpty()) {
                is.err("ctrl", "ctrl.listener " + p, "ctrl.listener");
            }
        }
        if (!c.ctrl.advertiseAddress.isEmpty()) {
            String p = checkEndpoint(c.ctrl.advertiseAddress);
            if (!p.isEmpty()) {
                is.err("ctrl", "advertiseAddress " + p, "ctrl.advertiseAddress");
            }
        }
        is.integer("ctrl", "connectTimeoutMs", c.ctrl.connectTimeoutMs, 30, 60000, "ctrl.connectTimeoutMs");
        is.integer("ctrl", "maxQueuedConnects", c.ctrl.maxQueuedConnects, 1, 5000, "ctrl.maxQueuedConnects");

        Network n = c.network;
        is.integer("network", "cycleSeconds", n.cycleSeconds, 1, 86400, "network.cycleSeconds");
        is.integer("network", "routeTimeoutSeconds", n.routeTimeoutSeconds, 1, 3600, "network.routeTimeoutSeconds");
        is.integer("network", "createCircuitRetries", n.createCircuitRetries, 0, 100, "network.createCircuitRetries");
        is.integer("network", "pendingLinkTimeoutSeconds", n.pendingLinkTimeoutSeconds, 1, 3600,
                "network.pendingLinkTimeoutSeconds");
        is.integer("network", "minRouterCost", n.minRouterCost, 0, 65535, "network.minRouterCost");
        is.duration("network", "routerConnectChurnLimit", n.routerConnectChurnLimit, "network.routerConnectChurnLimit", 0);
        if (n.smartReroute) {
            if (Double.isNaN(n.rerouteFraction) || n.rerouteFraction <= 0 || n.rerouteFraction > 1) {
                is.err("network", "rerouteFraction must be greater than 0 and at most 1", "network.rerouteFraction");
            }
            is.integer("network", "rerouteCap", n.rerouteCap, 1, 10000, "network.rerouteCap");
        }

        Edge e = c.edge;
        if (e.enabled) {
            if (e.apiAddress.isEmpty()) {
                is.err("edge", "edge.api.address is required", "edge.apiAddress");
            } else {
                is.hostPort("edge", "edge.api.address", e.apiAddress, "edge.apiAddress");
            }
            is.duration("edge", "sessionTimeout", e.sessionTimeout, "edge.sessionTimeout", 60000);
            is.duration("edge", "identity enrollment duration", e.identityEnrollmentDuration,
                    "edge.identityEnrollmentDuration", 300000);
            is.duration("edge", "router enrollment duration", e.routerEnrollmentDuration, "edge.routerEnrollmentDuration",
                    300000);
            is.duration("edge", "accessTokenDuration", e.accessTokenDuration, "edge.accessTokenDuration", 0);
            is.duration("edge", "refreshTokenDuration", e.refreshTokenDuration, "edge.refreshTokenDuration", 0);
            double a = parseDuration(e.accessTokenDuration);
            double r = parseDuration(e.refreshTokenDuration);
            if (!Double.isNaN(a) && !Double.isNaN(r) && r < a + 60000) {
                is.err("edge", "refreshTokenDuration must be at least 1m longer than accessTokenDuration",
                        "edge.refreshTokenDuration");
            }
            is.path("edge", "signing certificate", e.signingCert, "edge.signingCert", true);
            is.path("edge", "signing key", e.signingKey, "edge.signingKey", true);
            if (e.authRateLimiter) {
                is.integer("edge", "auth rate limiter max size", e.authRateLimiterMax, 5, 1000, "edge.authRateLimiterMax");
            }
            if (!e.totpHostname.isEmpty() && !env(e.totpHostname) && !HOSTNAME.matcher(e.totpHostname).matches()) {
                is.err("edge", "TOTP hostname must be a hostname (no spaces, quotes or ports)", "edge.totpHostname");
            }
            if (c.web.stream().noneMatch(w -> w.api("edge-client") || w.api("edge-management"))) {
                is.warn("web", "edge is enabled but no web listener serves edge-client or edge-management", null);
            }
        }

        if (c.web.isEmpty()) {
            is.err("web", "at least one web listener is required");
        }
        Set<String> seenNames = new HashSet<>();
        Set<String> seenBinds = new HashSet<>();
        for (int i = 0; i < c.web.size(); i++) {
            WebListener w = c.web.get(i);
            String label = w.name.isEmpty() ? "listener " + (i + 1) : w.name;
            is.name("web", "listener " + (i + 1) + " name", w.name, null);
            if (!w.name.isEmpty()) {
                if (!seenNames.add(w.name)) {
                    is.err("web", "listener name \"" + w.name + "\" is used more than once");
                }
            }
            if (w.bindPoints.isEmpty()) {
                is.err("web", label + ": add at least one bind point");
            }
            for (int bi = 0; bi < w.bindPoints.size(); bi++) {
                BindPoint b = w.bindPoints.get(bi);
                String bp = label + " bind point " + (bi + 1);
                if (b.identity != null) {
                    BindPointIdentity id = b.identity;
                    if (id.value.isEmpty()) {
                        is.err("web", bp + ": " + (id.source.equals("file") ? "identity file" : "identity env variable")
                                + " is required");
                    } else if (id.source.equals("file")) {
                        String p = checkPath(id.value);
                        if (!p.isEmpty()) {
                            is.err("web", bp + ": identity file " + p);
                        }
                    } else if (!id.value.matches("^[A-Za-z_][A-Za-z0-9_]*$")) {
                        is.err("web", bp + ": env variable name may only use letters, digits and underscore");
                    }
                    if (id.service.isEmpty()) {
                        is.err("web", bp + ": the service to bind is required");
                    }
                    continue;
                }
                if (b.iface.isEmpty()) {
                    is.err("web", bp + ": interface is required");
                } else {
                    is.hostPort("web", bp + ": interface", b.iface, null);
                    if (!seenBinds.add(b.iface)) {
                        is.err("web", bp + ": " + b.iface + " is already bound by another listener");
                    }
                }
                if (b.address.isEmpty()) {
                    is.err("web", bp + ": address is required");
                } else {
                    is.hostPort("web", bp + ": address", b.address, null);
                }
            }
            if (w.apis.values().stream().noneMatch(Boolean.TRUE::equals)) {
                is.err("web", label + ": enable at least one API");
            }
            if (w.api("spa")) {
                if (w.spaLocation.isEmpty()) {
                    is.err("web", label + ": the SPA needs a location on disk");
                } else {
                    String p = checkPath(w.spaLocation);
                    if (!p.isEmpty()) {
                        is.err("web", label + ": SPA location " + p);
                    }
                }
                if (!w.spaPath.isEmpty() && !w.spaPath.matches("^[A-Za-z0-9._-]+$")) {
                    is.err("web", label + ": SPA URL path may only use letters, digits, dot, dash and underscore");
                }
            }
        }
        is.duration("web", "health check interval", c.healthCheckInterval, "healthCheckInterval", 0);

        Set<String> seenLoggers = new HashSet<>();
        for (int i = 0; i < c.events.size(); i++) {
            EventLogger ev = c.events.get(i);
            is.name("events", "event logger " + (i + 1) + " name", ev.name, null);
            if (!ev.name.isEmpty() && !seenLoggers.add(ev.name)) {
                is.err("events", "logger name \"" + ev.name + "\" is used more than once");
            }
            String label = ev.name.isEmpty() ? "logger " + (i + 1) : ev.name;
            if (ev.subscriptions.isEmpty()) {
                is.warn("events", label + ": no subscriptions selected", null);
            }
            if (!isCustomHandler(ev.handlerRaw)) {
                is.path("events", label + " file path", ev.path, "", true);
            }
        }
        return is.out;
    }

    // ------------------------------------------------------------------ document building

    /** Add {@code key: value} when it differs from the default, or when verbose is on. */
    private static void put(Map<String, Object> target, String key, Object value, Object def, boolean verbose) {
        if (verbose || !Objects.equals(value, def)) {
            target.put(key, value);
        }
    }

    private static Map<String, Object> identityBindPoint(BindPoint b, BindPointIdentity id) {
        Map<String, Object> out = id.raw != null ? YamlSupport.deepCopy(id.raw) : new LinkedHashMap<>();
        out.remove("file");
        out.remove("env");
        out.put(id.source, id.value);
        out.put("service", id.service);
        if (!id.clientAuth.isEmpty()) {
            out.put("tlsClientAuthenticationPolicy", id.clientAuth);
        } else {
            out.remove("tlsClientAuthenticationPolicy");
        }
        Map<String, Object> opts = isObj(out.get("listenOptions")) ? asMap(out.get("listenOptions")) : new LinkedHashMap<>();
        if (id.bindUsingEdgeIdentity) {
            opts.put("bindUsingEdgeIdentity", true);
        } else {
            opts.remove("bindUsingEdgeIdentity");
        }
        if (!opts.isEmpty()) {
            out.put("listenOptions", opts);
        } else {
            out.remove("listenOptions");
        }
        Map<String, Object> bp = new LinkedHashMap<>(b.extra == null ? Map.of() : b.extra);
        bp.put("identity", out);
        return bp;
    }

    private static BindPoint parseIdentityBindPoint(Map<String, Object> b, Map<String, Object> identity) {
        Map<String, Object> extra = new LinkedHashMap<>(b);
        extra.remove("identity");
        String source = identity.get("env") instanceof String && !(identity.get("file") instanceof String) ? "env" : "file";
        BindPoint bp = new BindPoint();
        BindPointIdentity id = new BindPointIdentity();
        id.source = source;
        id.value = identity.get(source) == null ? "" : YamlSupport.jsString(identity.get(source));
        id.service = identity.get("service") == null ? "" : YamlSupport.jsString(identity.get("service"));
        id.clientAuth = identity.get("tlsClientAuthenticationPolicy") == null ? ""
                : YamlSupport.jsString(identity.get("tlsClientAuthenticationPolicy"));
        id.bindUsingEdgeIdentity = Boolean.TRUE.equals(get(identity, "listenOptions", "bindUsingEdgeIdentity"));
        id.raw = identity;
        bp.identity = id;
        bp.extra = extra;
        return bp;
    }

    public Map<String, Object> buildDocument(boolean verbose) {
        ControllerConfig c = this;
        Map<String, Object> doc = map("v", 3);
        ControllerConfig d = defaults();

        Map<String, Object> identity = map("cert", c.identity.cert, "key", c.identity.key, "ca", c.identity.ca);
        if (!c.identity.serverCert.isEmpty()) {
            identity.put("server_cert", c.identity.serverCert);
        }
        doc.put("identity", identity);
        if (!c.trustDomain.isEmpty()) {
            doc.put("trustDomain", c.trustDomain);
        }

        if (c.mode.equals("standalone")) {
            doc.put("db", c.db);
        } else {
            Map<String, Object> cl = map("dataDir", c.cluster.dataDir);
            put(cl, "preferredLeader", c.cluster.preferredLeader, d.cluster.preferredLeader, verbose);
            put(cl, "snapshotInterval", c.cluster.snapshotInterval, d.cluster.snapshotInterval, verbose);
            put(cl, "snapshotThreshold", c.cluster.snapshotThreshold, d.cluster.snapshotThreshold, verbose);
            put(cl, "electionTimeout", c.cluster.electionTimeout, d.cluster.electionTimeout, verbose);
            put(cl, "heartbeatTimeout", c.cluster.heartbeatTimeout, d.cluster.heartbeatTimeout, verbose);
            put(cl, "logLevel", c.cluster.logLevel, d.cluster.logLevel, verbose);
            doc.put("cluster", cl);
        }

        Map<String, Object> options = new LinkedHashMap<>();
        if (!c.ctrl.advertiseAddress.isEmpty()) {
            options.put("advertiseAddress", c.ctrl.advertiseAddress);
        }
        put(options, "connectTimeoutMs", c.ctrl.connectTimeoutMs, d.ctrl.connectTimeoutMs, verbose);
        put(options, "maxQueuedConnects", c.ctrl.maxQueuedConnects, d.ctrl.maxQueuedConnects, verbose);
        Map<String, Object> ctrlMap = map("listener", c.ctrl.listener);
        if (!options.isEmpty()) {
            ctrlMap.put("options", options);
        }
        doc.put("ctrl", ctrlMap);

        Network n = c.network;
        Network dn = d.network;
        Map<String, Object> net = new LinkedHashMap<>();
        put(net, "cycleSeconds", n.cycleSeconds, dn.cycleSeconds, verbose);
        put(net, "routeTimeoutSeconds", n.routeTimeoutSeconds, dn.routeTimeoutSeconds, verbose);
        put(net, "createCircuitRetries", n.createCircuitRetries, dn.createCircuitRetries, verbose);
        put(net, "pendingLinkTimeoutSeconds", n.pendingLinkTimeoutSeconds, dn.pendingLinkTimeoutSeconds, verbose);
        put(net, "minRouterCost", n.minRouterCost, dn.minRouterCost, verbose);
        put(net, "routerConnectChurnLimit", n.routerConnectChurnLimit, dn.routerConnectChurnLimit, verbose);
        if (n.smartReroute) {
            net.put("smart", map("rerouteFraction", n.rerouteFraction, "rerouteCap", n.rerouteCap));
        }
        if (!net.isEmpty()) {
            doc.put("network", net);
        }

        Map<String, Object> hc = new LinkedHashMap<>();
        put(hc, "interval", c.healthCheckInterval, d.healthCheckInterval, verbose);
        if (!hc.isEmpty()) {
            doc.put("healthChecks", map("boltCheck", hc));
        }

        if (c.edge.enabled) {
            Edge e = c.edge;
            Map<String, Object> api = map("address", e.apiAddress);
            put(api, "sessionTimeout", e.sessionTimeout, d.edge.sessionTimeout, verbose);
            Map<String, Object> enrollment = map("signingCert", map("cert", e.signingCert, "key", e.signingKey));
            if (verbose || !e.identityEnrollmentDuration.equals(d.edge.identityEnrollmentDuration)) {
                enrollment.put("edgeIdentity", map("duration", e.identityEnrollmentDuration));
            }
            if (verbose || !e.routerEnrollmentDuration.equals(d.edge.routerEnrollmentDuration)) {
                enrollment.put("edgeRouter", map("duration", e.routerEnrollmentDuration));
            }
            Map<String, Object> edgeMap = map("api", api, "enrollment", enrollment);
            Map<String, Object> oidc = new LinkedHashMap<>();
            put(oidc, "accessTokenDuration", e.accessTokenDuration, d.edge.accessTokenDuration, verbose);
            put(oidc, "refreshTokenDuration", e.refreshTokenDuration, d.edge.refreshTokenDuration, verbose);
            if (!oidc.isEmpty()) {
                edgeMap.put("oidc", oidc);
            }
            if (!e.totpHostname.isEmpty()) {
                edgeMap.put("totp", map("hostname", e.totpHostname));
            }
            if (!e.authRateLimiter) {
                edgeMap.put("authRateLimiter", map("enabled", false));
            } else if (verbose || e.authRateLimiterMax != d.edge.authRateLimiterMax) {
                edgeMap.put("authRateLimiter", map("enabled", true, "maxSize", e.authRateLimiterMax));
            }
            doc.put("edge", edgeMap);
        }

        List<Object> webList = new ArrayList<>();
        for (WebListener w : c.web) {
            List<Object> apis = new ArrayList<>();
            for (Api b : API_BINDINGS) {
                if (!w.api(b.id())) {
                    continue;
                }
                if (b.id().equals("spa")) {
                    Map<String, Object> o = new LinkedHashMap<>(w.spaExtra == null ? Map.of() : w.spaExtra);
                    o.put("path", w.spaPath.isEmpty() ? "zac" : w.spaPath);
                    o.put("location", w.spaLocation);
                    apis.add(map("binding", "spa", "options", o));
                } else if (w.apiOptions != null && truthy(w.apiOptions.get(b.id()))) {
                    apis.add(map("binding", b.id(), "options", w.apiOptions.get(b.id())));
                } else {
                    apis.add(map("binding", b.id()));
                }
            }
            if (w.extraApis != null) {
                apis.addAll(w.extraApis);
            }
            List<Object> bps = new ArrayList<>();
            for (BindPoint b : w.bindPoints) {
                if (b.identity != null) {
                    bps.add(identityBindPoint(b, b.identity));
                } else {
                    Map<String, Object> m = map("interface", b.iface, "address", b.address);
                    if (b.newAddress != null && !b.newAddress.isEmpty()) {
                        m.put("newAddress", b.newAddress);
                    }
                    bps.add(m);
                }
            }
            Map<String, Object> entry = map("name", w.name, "bindPoints", bps);
            if (w.extra != null) {
                entry.putAll(w.extra);
            }
            entry.put("apis", apis);
            webList.add(entry);
        }
        doc.put("web", webList);

        if (!c.events.isEmpty()) {
            Map<String, Object> events = new LinkedHashMap<>();
            for (EventLogger e : c.events) {
                if (e.name.isEmpty()) {
                    continue;
                }
                Object h = e.handlerRaw;
                List<Object> subs = new ArrayList<>();
                for (String type : e.subscriptions) {
                    Object raw = e.rawSubs == null ? null : e.rawSubs.get(type);
                    subs.add(raw != null ? raw : map("type", type));
                }
                Object handler;
                if (isCustomHandler(h)) {
                    handler = h;
                } else {
                    Map<String, Object> hm = new LinkedHashMap<>(asMap(h));
                    hm.put("type", "file");
                    hm.put("format", e.format);
                    hm.put("path", e.path);
                    handler = hm;
                }
                events.put(e.name, map("subscriptions", subs, "handler", handler));
            }
            doc.put("events", events);
        }
        return doc;
    }

    /**
     * Keep a leaf when the source file had it or when it differs from the default, so a value the
     * user set back to its default still overwrites the stale one in the source.
     */
    private static Map<String, Object> prune(Map<String, Object> full, Map<String, Object> minimal, Map<String, Object> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : full.entrySet()) {
            String k = e.getKey();
            Object f = e.getValue();
            if (isObj(f)) {
                Map<String, Object> sub = prune(asMap(f), asMap(minimal.get(k)), asMap(raw.get(k)));
                if (!sub.isEmpty() || raw.containsKey(k) || minimal.containsKey(k)) {
                    out.put(k, sub);
                }
            } else if (raw.containsKey(k) || minimal.containsKey(k)) {
                out.put(k, f);
            }
        }
        return out;
    }

    private static Map<String, Object> merge(Map<String, Object> base, Map<String, Object> over) {
        Map<String, Object> out = new LinkedHashMap<>(base);
        for (Map.Entry<String, Object> e : over.entrySet()) {
            String k = e.getKey();
            if (k.equals("__proto__")) {
                continue;
            }
            Object o = e.getValue();
            Object b = base.get(k);
            out.put(k, isObj(o) && isObj(b) ? merge(asMap(b), asMap(o)) : o);
        }
        return out;
    }

    private static final List<String> MANAGED = List.of("v", "identity", "trustDomain", "db", "cluster", "ctrl", "network",
            "healthChecks", "edge", "web", "events");

    /** Document to emit: ingested source with the form's values applied on top. */
    public Map<String, Object> composeDocument(boolean verbose) {
        Map<String, Object> minimal = buildDocument(verbose);
        if (base == null) {
            return minimal;
        }
        Map<String, Object> b = new LinkedHashMap<>(base);
        if (isObj(b.get("identity")) && identity.serverCert.isEmpty()) {
            Map<String, Object> id = new LinkedHashMap<>(asMap(b.get("identity")));
            id.remove("server_cert");
            b.put("identity", id);
        }
        // switching HA <-> standalone must drop the other storage key
        b.remove(mode.equals("ha") ? "db" : "cluster");
        if (!edge.enabled) {
            b.remove("edge");
        }
        // nested keys the form owns outright: cleared or toggled off means gone, not "keep the source value"
        dropNested(b, "network", "smart", truthy(get(minimal, "network", "smart")));
        dropNested(b, "edge", "totp", truthy(get(minimal, "edge", "totp")));
        Object baseCtrl = b.get("ctrl");
        if (isObj(baseCtrl) && isObj(asMap(baseCtrl).get("options")) && ctrl.advertiseAddress.isEmpty()) {
            Map<String, Object> opts = new LinkedHashMap<>(asMap(asMap(baseCtrl).get("options")));
            opts.remove("advertiseAddress");
            Map<String, Object> ctrlCopy = new LinkedHashMap<>(asMap(baseCtrl));
            ctrlCopy.put("options", opts);
            if (opts.isEmpty()) {
                ctrlCopy.remove("options");
            }
            b.put("ctrl", ctrlCopy);
        }
        Map<String, Object> kept = prune(buildDocument(true), minimal, b);
        // managed keys the form no longer produces (e.g. emptied trustDomain) must not linger
        for (String k : MANAGED) {
            if (!minimal.containsKey(k) && !kept.containsKey(k)) {
                b.remove(k);
            }
        }
        kept.put("web", minimal.get("web"));
        if (minimal.containsKey("events")) {
            kept.put("events", minimal.get("events"));
        } else {
            // as in the web console: the key stays, undefined (see YamlSupport.UNDEFINED)
            kept.put("events", YamlSupport.UNDEFINED);
            b.remove("events");
        }
        return merge(b, kept);
    }

    private static void dropNested(Map<String, Object> b, String parent, String key, boolean emitted) {
        Object section = b.get(parent);
        if (!emitted && isObj(section) && asMap(section).containsKey(key)) {
            Map<String, Object> copy = new LinkedHashMap<>(asMap(section));
            copy.remove(key);
            b.put(parent, copy);
        }
    }

    public record Loaded(ControllerConfig cfg, List<String> warnings) {
    }

    private static double num(Object v, double def) {
        return v instanceof Number n ? n.doubleValue() : def;
    }

    /** Parse controller YAML into the form model. Unknown content is retained for round-tripping. */
    public static Loaded fromYaml(String text) {
        return fromDocument(YamlSupport.parseMap(text));
    }

    public static Loaded fromDocument(Map<String, Object> doc) {
        List<String> warnings = new ArrayList<>();
        Object v = doc.get("v");
        if (!(v instanceof Number nv && nv.doubleValue() == 3)) {
            warnings.add("config version is " + (v == null ? "missing" : YamlSupport.jsString(v)) + "; this builder writes v: 3");
        }
        ControllerConfig c = defaults();
        c.base = doc;
        c.trustDomain = str(doc.get("trustDomain"), "");
        Map<String, Object> id = asMap(doc.get("identity"));
        c.identity.cert = str(id.get("cert"));
        c.identity.serverCert = str(id.get("server_cert"));
        c.identity.key = str(id.get("key"));
        c.identity.ca = str(id.get("ca"));

        if (truthy(doc.get("cluster"))) {
            c.mode = "ha";
            Map<String, Object> cl = asMap(doc.get("cluster"));
            Cluster dc = c.cluster;
            Cluster nc = new Cluster();
            nc.dataDir = str(cl.get("dataDir"));
            nc.preferredLeader = Boolean.TRUE.equals(cl.get("preferredLeader"));
            nc.snapshotInterval = str(cl.get("snapshotInterval"), dc.snapshotInterval);
            nc.snapshotThreshold = num(cl.get("snapshotThreshold"), dc.snapshotThreshold);
            nc.electionTimeout = str(cl.get("electionTimeout"), dc.electionTimeout);
            nc.heartbeatTimeout = str(cl.get("heartbeatTimeout"), dc.heartbeatTimeout);
            nc.logLevel = str(cl.get("logLevel"), dc.logLevel);
            c.cluster = nc;
        } else {
            c.db = str(doc.get("db"));
        }

        Map<String, Object> ctrl = asMap(doc.get("ctrl"));
        Map<String, Object> opts = asMap(ctrl.get("options"));
        Ctrl nctrl = new Ctrl();
        nctrl.listener = str(ctrl.get("listener"));
        nctrl.advertiseAddress = str(opts.get("advertiseAddress"));
        nctrl.connectTimeoutMs = num(opts.get("connectTimeoutMs"), c.ctrl.connectTimeoutMs);
        nctrl.maxQueuedConnects = num(opts.get("maxQueuedConnects"), c.ctrl.maxQueuedConnects);
        c.ctrl = nctrl;

        Map<String, Object> net = asMap(doc.get("network"));
        Network dn = c.network;
        Network nn = new Network();
        nn.cycleSeconds = num(net.get("cycleSeconds"), dn.cycleSeconds);
        nn.routeTimeoutSeconds = num(net.get("routeTimeoutSeconds"), dn.routeTimeoutSeconds);
        nn.createCircuitRetries = num(net.get("createCircuitRetries"), dn.createCircuitRetries);
        nn.pendingLinkTimeoutSeconds = num(net.get("pendingLinkTimeoutSeconds"), dn.pendingLinkTimeoutSeconds);
        nn.minRouterCost = num(net.get("minRouterCost"), dn.minRouterCost);
        nn.routerConnectChurnLimit = str(net.get("routerConnectChurnLimit"), dn.routerConnectChurnLimit);
        nn.smartReroute = isObj(net.get("smart"));
        nn.rerouteFraction = num(get(net, "smart", "rerouteFraction"), dn.rerouteFraction);
        nn.rerouteCap = num(get(net, "smart", "rerouteCap"), dn.rerouteCap);
        c.network = nn;

        c.healthCheckInterval = str(get(doc, "healthChecks", "boltCheck", "interval"), c.healthCheckInterval);

        // the builder always manages the edge block; a fabric-only file gains one with the defaults below
        Map<String, Object> e = asMap(doc.get("edge"));
        Edge de = c.edge;
        Edge ne = new Edge();
        ne.enabled = true;
        ne.apiAddress = str(get(e, "api", "address"));
        ne.sessionTimeout = str(get(e, "api", "sessionTimeout"), de.sessionTimeout);
        ne.signingCert = str(get(e, "enrollment", "signingCert", "cert"));
        ne.signingKey = str(get(e, "enrollment", "signingCert", "key"));
        ne.identityEnrollmentDuration = str(get(e, "enrollment", "edgeIdentity", "duration"), de.identityEnrollmentDuration);
        ne.routerEnrollmentDuration = str(get(e, "enrollment", "edgeRouter", "duration"), de.routerEnrollmentDuration);
        ne.accessTokenDuration = str(get(e, "oidc", "accessTokenDuration"), de.accessTokenDuration);
        ne.refreshTokenDuration = str(get(e, "oidc", "refreshTokenDuration"), de.refreshTokenDuration);
        ne.authRateLimiter = !Boolean.FALSE.equals(get(e, "authRateLimiter", "enabled"));
        ne.authRateLimiterMax = num(get(e, "authRateLimiter", "maxSize"), de.authRateLimiterMax);
        ne.totpHostname = str(get(e, "totp", "hostname"));
        c.edge = ne;

        List<String> known = API_BINDINGS.stream().map(Api::id).toList();
        c.web = new ArrayList<>();
        for (Object wo : asList(doc.get("web"))) {
            Map<String, Object> wm = asMap(wo);
            Map<String, Object> extra = new LinkedHashMap<>(wm);
            extra.remove("name");
            extra.remove("bindPoints");
            extra.remove("apis");
            WebListener l = new WebListener();
            l.name = str(wm.get("name"));
            for (Object bo : asList(wm.get("bindPoints"))) {
                Map<String, Object> bp = asMap(bo);
                if (isObj(bp.get("identity"))) {
                    l.bindPoints.add(parseIdentityBindPoint(bp, asMap(bp.get("identity"))));
                } else {
                    BindPoint p = new BindPoint(str(bp.get("interface")), str(bp.get("address")));
                    if (truthy(bp.get("newAddress"))) {
                        p.newAddress = YamlSupport.jsString(bp.get("newAddress"));
                    }
                    l.bindPoints.add(p);
                }
            }
            l.spaPath = "zac";
            l.spaLocation = "";
            l.extra = extra;
            List<Object> extraApis = new ArrayList<>();
            Map<String, Object> apiOptions = new LinkedHashMap<>();
            for (Object a : asList(wm.get("apis"))) {
                Object binding = get(a, "binding");
                Object options = get(a, "options");
                if (binding instanceof String bs && known.contains(bs)) {
                    l.apis.put(bs, true);
                    if (bs.equals("spa")) {
                        Map<String, Object> rest = new LinkedHashMap<>(asMap(options));
                        Object path = rest.remove("path");
                        Object location = rest.remove("location");
                        l.spaPath = str(path, "zac");
                        l.spaLocation = str(location);
                        l.spaExtra = rest;
                    } else if (truthy(options)) {
                        apiOptions.put(bs, options);
                    }
                } else {
                    extraApis.add(a);
                    warnings.add("kept unrecognized API binding \"" + (binding == null ? "undefined" : YamlSupport.jsString(binding))
                            + "\" as-is");
                }
            }
            l.extraApis = extraApis;
            l.apiOptions = apiOptions;
            c.web.add(l);
        }

        Object events = doc.get("events");
        c.events = new ArrayList<>();
        if (isObj(events)) {
            for (Map.Entry<String, Object> en : asMap(events).entrySet()) {
                Map<String, Object> ev = asMap(en.getValue());
                List<Object> subs = asList(ev.get("subscriptions"));
                Map<String, Object> rawSubs = new LinkedHashMap<>();
                EventLogger lg = new EventLogger();
                lg.name = en.getKey();
                for (Object x : subs) {
                    String type = typeOf(x);
                    rawSubs.put(type, x);
                    lg.subscriptions.add(type);
                }
                lg.format = "cs".equals(get(ev, "handler", "format")) ? "cs" : "json";
                lg.path = str(get(ev, "handler", "path"));
                lg.rawSubs = rawSubs;
                lg.handlerRaw = ev.get("handler");
                c.events.add(lg);
            }
        }

        List<String> unmanaged = doc.keySet().stream().filter(k -> !MANAGED.contains(k)).toList();
        if (!unmanaged.isEmpty()) {
            warnings.add("passing through untouched: " + String.join(", ", unmanaged));
        }
        return new Loaded(c, warnings);
    }

    /** {@code String(get(x, 'type'))}, including JavaScript's "undefined" for a missing key. */
    static String typeOf(Object x) {
        if (x instanceof Map<?, ?> m && m.containsKey("type")) {
            return YamlSupport.jsString(m.get("type"));
        }
        return "undefined";
    }

    public String toYaml(boolean verbose) {
        return YamlSupport.dumpDocument(composeDocument(verbose), List.of("# OpenZiti controller configuration",
                "# Generated by Baked Pasta Console Config Builder. Review before use; ${ENV_VARS} are expanded by the controller."));
    }
}
