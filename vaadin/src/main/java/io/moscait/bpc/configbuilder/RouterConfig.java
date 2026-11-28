package io.moscait.bpc.configbuilder;

import static io.moscait.bpc.configbuilder.ControllerConfig.checkEndpoint;
import static io.moscait.bpc.configbuilder.ControllerConfig.checkHostPort;
import static io.moscait.bpc.configbuilder.ControllerConfig.env;
import static io.moscait.bpc.configbuilder.ControllerConfig.isWhole;
import static io.moscait.bpc.configbuilder.ControllerConfig.parseDuration;
import static io.moscait.bpc.configbuilder.YamlSupport.asList;
import static io.moscait.bpc.configbuilder.YamlSupport.asMap;
import static io.moscait.bpc.configbuilder.YamlSupport.get;
import static io.moscait.bpc.configbuilder.YamlSupport.isObj;
import static io.moscait.bpc.configbuilder.YamlSupport.str;
import static io.moscait.bpc.configbuilder.YamlSupport.truthy;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Model, validation and YAML emitter for an OpenZiti router config ({@code v: 3}). Key names
 * follow router/env/config.go. Unlike the controller model, an ingested document is edited in
 * place, so anything the form does not manage survives a save untouched.
 */
public final class RouterConfig {

    public static final class Identity {
        public String cert = "./pki/router/certs/client.cert";
        public String serverCert = "./pki/router/certs/server.cert";
        public String key = "./pki/router/keys/server.key";
        public String ca = "./pki/router/cas.cert";
    }

    public static final class Ctrl {
        public List<String> endpoints = new ArrayList<>(List.of("tls:ctrl.example.com:6262"));
        public String endpointsFile = "./endpoints.yml";
    }

    public static final class Link {
        public boolean dial = true;
        public boolean listen = true;
        public String bind = "tls:0.0.0.0:10080";
        public String advertise = "tls:router.example.com:10080";
        public Double outQueueSize;
        public List<String> dialGroups = new ArrayList<>();
        public List<String> listenGroups = new ArrayList<>();
    }

    public static final class Edge {
        public boolean enabled = true;
        public String address = "tls:0.0.0.0:3022";
        public String advertise = "router.example.com:3022";
        public Double connectTimeoutMs;
        public Double getSessionTimeout;
    }

    public static final class Tunnel {
        public boolean enabled;
        /** "tproxy", "host" or "proxy". */
        public String mode = "host";
        public String resolver = "";
        public String lanIf = "";
        public String dnsSvcIpRange = "";
    }

    public static final class Csr {
        public String country = "US";
        public String province = "NC";
        public String locality = "Charlotte";
        public String organization = "NetFoundry";
        public String organizationalUnit = "Ziti";
        public List<String> dns = new ArrayList<>(List.of("localhost", "router.example.com"));
        public List<String> ip = new ArrayList<>(List.of("127.0.0.1", "::1"));
    }

    public static final class Forwarder {
        public Double xgressDialQueueLength;
        public Double xgressDialWorkerCount;
        public Double linkDialQueueLength;
        public Double linkDialWorkerCount;
    }

    public static final class Metrics {
        public String reportInterval = "";
        public Double messageQueueSize;
    }

    public static final class Health {
        public String ctrlPingInterval = "";
        public String ctrlPingTimeout = "";
        public String ctrlPingInitialDelay = "";
        public Double minLinks;
    }

    public Map<String, Object> base;
    /** The source listed controllers under ctrl.endpoints rather than the single ctrl.endpoint. */
    public boolean ctrlList;
    /** The source kept its CSR at top level (fabric-only template) instead of under edge. */
    public boolean csrTop;
    public Identity identity = new Identity();
    public Ctrl ctrl = new Ctrl();
    public Link link = new Link();
    public Edge edge = new Edge();
    /** Bindings of listeners the form does not model (e.g. edge_wss, proxy). Kept as-is on save. */
    public List<String> otherListeners = new ArrayList<>();
    public Tunnel tunnel = new Tunnel();
    public Csr csr = new Csr();
    public Forwarder forwarder = new Forwarder();
    public Metrics metrics = new Metrics();
    public Health health = new Health();

    public record TunnelMode(String id, String label, String hint) {
    }

    public static final List<TunnelMode> TUNNEL_MODES = List.of(
            new TunnelMode("tproxy", "tproxy", "Intercept traffic for services on this host (Linux). Needs root or CAP_NET_ADMIN."),
            new TunnelMode("host", "host", "Host services: dial out to servers reachable from this router."),
            new TunnelMode("proxy", "proxy", "Listen on explicit local ports for services."));

    public static RouterConfig defaults() {
        return new RouterConfig();
    }

    // ------------------------------------------------------------------ detection

    /** "controller", "router" or "unknown", by keys only one of them has. */
    public static String detectKind(Object doc) {
        if (!isObj(doc)) {
            return "unknown";
        }
        Map<String, Object> d = asMap(doc);
        Map<String, Object> edge = asMap(d.get("edge"));
        Map<String, Object> ctrl = asMap(d.get("ctrl"));
        int controller = 0;
        int router = 0;
        for (String k : List.of("db", "cluster", "web", "network", "events", "trustDomain", "healthChecks")) {
            if (d.containsKey(k)) {
                controller++;
            }
        }
        if (truthy(edge.get("api")) || truthy(edge.get("enrollment"))) {
            controller += 2;
        }
        if (truthy(ctrl.get("listener"))) {
            controller += 2;
        }
        for (String k : List.of("link", "listeners", "forwarder", "csr", "dialers")) {
            if (d.containsKey(k)) {
                router++;
            }
        }
        if (truthy(edge.get("csr"))) {
            router += 2;
        }
        if (truthy(ctrl.get("endpoint")) || truthy(ctrl.get("endpoints")) || truthy(ctrl.get("endpointsFile"))) {
            router += 2;
        }
        if (controller == router) {
            return "unknown";
        }
        return controller > router ? "controller" : "router";
    }

    // ------------------------------------------------------------------ validation

    private static final Pattern IP = Pattern.compile("^(\\d{1,3}(\\.\\d{1,3}){3}|[0-9A-Fa-f:]+:[0-9A-Fa-f:.]*)$");
    private static final Pattern CIDR = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}/\\d{1,2}$");

    private static void optInt(ControllerConfig.Issues is, String section, String label, Double v, long min, long max,
            String field) {
        if (v == null) {
            return;
        }
        if (!isWhole(v) || v < min || v > max) {
            is.err(section, label + " must be a whole number from " + min + " to " + max, field);
        }
    }

    private static void optDuration(ControllerConfig.Issues is, String section, String label, String v, String field) {
        if (!v.isEmpty() && Double.isNaN(parseDuration(v))) {
            is.err(section, label + " is not a valid duration (try 30s, 5m)", field);
        }
    }

    public List<ValidationIssue> validate() {
        ControllerConfig.Issues is = new ControllerConfig.Issues();
        RouterConfig c = this;
        is.path("r-identity", "identity.cert", c.identity.cert, "identity.cert", true);
        is.path("r-identity", "identity.server_cert", c.identity.serverCert, "identity.serverCert", false);
        is.path("r-identity", "identity.key", c.identity.key, "identity.key", true);
        is.path("r-identity", "identity.ca", c.identity.ca, "identity.ca", true);

        List<String> eps = c.ctrl.endpoints.stream().filter(e -> !e.isEmpty()).toList();
        if (eps.isEmpty() && c.ctrl.endpointsFile.isEmpty()) {
            is.err("r-ctrl", "give at least one controller endpoint or an endpoints file");
        }
        for (int i = 0; i < c.ctrl.endpoints.size(); i++) {
            String e = c.ctrl.endpoints.get(i);
            if (e.isEmpty()) {
                is.err("r-ctrl", "controller endpoint " + (i + 1) + " is empty");
                continue;
            }
            String p = checkEndpoint(e);
            if (!p.isEmpty()) {
                is.err("r-ctrl", "controller endpoint " + (i + 1) + " " + p);
            } else if (!env(e) && !e.startsWith("tls:")) {
                is.warn("r-ctrl", "controller endpoint " + (i + 1) + ": controllers normally listen on tls:", null);
            }
        }
        if (new HashSet<>(eps).size() != eps.size()) {
            is.err("r-ctrl", "the same controller endpoint is listed twice");
        }
        is.path("r-ctrl", "endpoints file", c.ctrl.endpointsFile, "ctrl.endpointsFile", false);

        if (c.link.listen) {
            String b = checkEndpoint(c.link.bind);
            if (c.link.bind.isEmpty()) {
                is.err("r-link", "link listener bind address is required", "link.bind");
            } else if (!b.isEmpty()) {
                is.err("r-link", "link listener bind " + b, "link.bind");
            }
            if (c.link.advertise.isEmpty()) {
                is.err("r-link", "link listener advertise address is required: other routers dial it", "link.advertise");
            } else {
                String a = checkEndpoint(c.link.advertise);
                if (!a.isEmpty()) {
                    is.err("r-link", "link listener advertise " + a, "link.advertise");
                }
            }
            optInt(is, "r-link", "outQueueSize", c.link.outQueueSize, 1, 1000000, "link.outQueueSize");
        }
        if (!c.link.listen && !c.link.dial) {
            is.warn("r-link", "with neither a link dialer nor a link listener this router cannot form links", null);
        }

        if (c.edge.enabled) {
            if (c.edge.address.isEmpty()) {
                is.err("r-edge", "edge listener address is required", "edge.address");
            } else if (!env(c.edge.address)) {
                String scheme = c.edge.address.split(":", -1)[0];
                if (!scheme.equals("tls") && !scheme.equals("wss")) {
                    is.err("r-edge", "edge listener address must start with tls: or wss:", "edge.address");
                } else {
                    String p = checkEndpoint(c.edge.address);
                    if (!p.isEmpty()) {
                        is.err("r-edge", "edge listener address " + p, "edge.address");
                    }
                }
            }
            if (c.edge.advertise.isEmpty()) {
                is.err("r-edge", "edge advertise is required: SDKs connect to it", "edge.advertise");
            } else {
                String p = checkHostPort(c.edge.advertise);
                if (!p.isEmpty()) {
                    is.err("r-edge", "edge advertise " + p, "edge.advertise");
                }
            }
            optInt(is, "r-edge", "connectTimeoutMs", c.edge.connectTimeoutMs, 1, 600000, "edge.connectTimeoutMs");
            optInt(is, "r-edge", "getSessionTimeout", c.edge.getSessionTimeout, 1, 3600, "edge.getSessionTimeout");
        }
        if (c.tunnel.enabled) {
            if (c.tunnel.mode.equals("tproxy") && !c.tunnel.resolver.isEmpty() && !env(c.tunnel.resolver)
                    && !c.tunnel.resolver.matches("^(udp|tcp)://.+:\\d+$")) {
                is.err("r-edge", "resolver must look like udp://100.64.0.1:53", "tunnel.resolver");
            }
            if (!c.tunnel.dnsSvcIpRange.isEmpty() && !env(c.tunnel.dnsSvcIpRange)
                    && !CIDR.matcher(c.tunnel.dnsSvcIpRange).matches()) {
                is.err("r-edge", "dnsSvcIpRange must be a CIDR such as 100.64.0.1/10", "tunnel.dnsSvcIpRange");
            }
            if (!c.tunnel.lanIf.isEmpty() && !c.tunnel.lanIf.matches("^[A-Za-z0-9_.:-]+$")) {
                is.err("r-edge", "lanIf must be an interface name", "tunnel.lanIf");
            }
        }
        if (!c.edge.enabled && !c.tunnel.enabled && c.otherListeners.stream().noneMatch(b -> b.matches("^(edge|tunnel).*"))) {
            is.warn("r-edge", "no edge or tunnel listener: SDKs and tunnelers cannot use this as an edge router", null);
        }

        if (c.edge.enabled || c.tunnel.enabled) {
            if (!c.csr.country.isEmpty() && !c.csr.country.matches("^[A-Za-z]{2}$")) {
                is.err("r-csr", "country must be a two-letter code", "csr.country");
            }
            for (int i = 0; i < c.csr.dns.size(); i++) {
                String d = c.csr.dns.get(i);
                if (d.isEmpty() || (!env(d) && !ControllerConfig.HOSTNAME.matcher(d).matches())) {
                    is.err("r-csr", "DNS SAN " + (i + 1) + " is not a valid hostname");
                }
            }
            for (int i = 0; i < c.csr.ip.size(); i++) {
                String ip = c.csr.ip.get(i);
                boolean ok = !ip.isEmpty() && (env(ip) || (IP.matcher(ip).matches() && List.of(ip.split("\\.", -1)).stream()
                        .allMatch(p -> !p.matches("\\d+") || Long.parseLong(p) <= 255)));
                if (!ok) {
                    is.err("r-csr", "IP SAN " + (i + 1) + " is not a valid address");
                }
            }
            if (c.csr.dns.isEmpty() && c.csr.ip.isEmpty()) {
                is.warn("r-csr", "no SANs: clients cannot verify this router by name or address", null);
            }
        }

        Forwarder f = c.forwarder;
        optInt(is, "r-tuning", "xgressDialQueueLength", f.xgressDialQueueLength, 1, 1000000, "forwarder.xgressDialQueueLength");
        optInt(is, "r-tuning", "xgressDialWorkerCount", f.xgressDialWorkerCount, 1, 100000, "forwarder.xgressDialWorkerCount");
        optInt(is, "r-tuning", "linkDialQueueLength", f.linkDialQueueLength, 1, 1000000, "forwarder.linkDialQueueLength");
        optInt(is, "r-tuning", "linkDialWorkerCount", f.linkDialWorkerCount, 1, 100000, "forwarder.linkDialWorkerCount");
        optDuration(is, "r-tuning", "metrics reportInterval", c.metrics.reportInterval, "metrics.reportInterval");
        optInt(is, "r-tuning", "metrics messageQueueSize", c.metrics.messageQueueSize, 1, 1000000, "metrics.messageQueueSize");
        optDuration(is, "r-tuning", "ctrlPingCheck interval", c.health.ctrlPingInterval, "health.ctrlPingInterval");
        optDuration(is, "r-tuning", "ctrlPingCheck timeout", c.health.ctrlPingTimeout, "health.ctrlPingTimeout");
        optDuration(is, "r-tuning", "ctrlPingCheck initialDelay", c.health.ctrlPingInitialDelay, "health.ctrlPingInitialDelay");
        optInt(is, "r-tuning", "linkCheck minLinks", c.health.minLinks, 0, 1000, "health.minLinks");
        return is.out;
    }

    // ------------------------------------------------------------------ document building

    /** Set obj[key], or remove it when the value is empty. */
    private static void setOrDel(Map<String, Object> obj, String key, Object value) {
        if (value == null || "".equals(value)) {
            obj.remove(key);
        } else {
            obj.put(key, value);
        }
    }

    /** Trimmed, non-empty entries, or null when none are left. */
    private static List<Object> cleanList(List<String> list) {
        List<Object> out = new ArrayList<>(list.stream().map(String::trim).filter(x -> !x.isEmpty()).toList());
        return out.isEmpty() ? null : out;
    }

    /** Find the entry with {@code binding} in a list, or add one, and return it; disabled removes it. */
    private static Map<String, Object> upsertBinding(List<Object> list, String binding, boolean enabled) {
        int i = -1;
        for (int k = 0; k < list.size(); k++) {
            if (isObj(list.get(k)) && binding.equals(asMap(list.get(k)).get("binding"))) {
                i = k;
                break;
            }
        }
        if (!enabled) {
            if (i >= 0) {
                list.remove(i);
            }
            return null;
        }
        if (i >= 0) {
            return asMap(list.get(i));
        }
        Map<String, Object> entry = YamlSupport.map("binding", binding);
        list.add(entry);
        return entry;
    }

    /** Drop obj[key] when it is an empty map or list. */
    private static void prune(Map<String, Object> obj, String key) {
        Object v = obj.get(key);
        if ((v instanceof Map<?, ?> m && m.isEmpty()) || (v instanceof List<?> l && l.isEmpty())) {
            obj.remove(key);
        }
    }

    /** parent[key] as a map, replacing anything else there with an empty one. */
    private static Map<String, Object> mapIn(Map<String, Object> parent, String key) {
        Map<String, Object> m = asMap(parent.get(key));
        parent.put(key, m);
        return m;
    }

    public Map<String, Object> buildDocument() {
        RouterConfig c = this;
        Map<String, Object> doc = c.base != null ? YamlSupport.deepCopy(c.base) : new LinkedHashMap<>();
        if (!doc.containsKey("v")) {
            doc.put("v", 3);
        }

        Map<String, Object> id = mapIn(doc, "identity");
        id.put("cert", c.identity.cert);
        setOrDel(id, "server_cert", c.identity.serverCert);
        id.put("key", c.identity.key);
        id.put("ca", c.identity.ca);

        // one controller reads naturally as `endpoint`, several need `endpoints`
        Map<String, Object> ctrlMap = mapIn(doc, "ctrl");
        List<String> eps = c.ctrl.endpoints.stream().filter(e -> !e.isEmpty()).toList();
        ctrlMap.remove("endpoint");
        ctrlMap.remove("endpoints");
        if (eps.size() == 1 && !c.ctrlList) {
            ctrlMap.put("endpoint", eps.getFirst());
        } else if (!eps.isEmpty()) {
            ctrlMap.put("endpoints", new ArrayList<Object>(eps));
        }
        setOrDel(ctrlMap, "endpointsFile", c.ctrl.endpointsFile);

        Map<String, Object> linkMap = asMap(doc.get("link"));
        List<Object> dialers = asList(linkMap.get("dialers"));
        List<Object> lListeners = asList(linkMap.get("listeners"));
        Map<String, Object> dl = upsertBinding(dialers, "transport", c.link.dial);
        if (dl != null) {
            setOrDel(dl, "groups", cleanList(c.link.dialGroups));
        }
        Map<String, Object> ll = upsertBinding(lListeners, "transport", c.link.listen);
        if (ll != null) {
            setOrDel(ll, "groups", cleanList(c.link.listenGroups));
            ll.put("bind", c.link.bind);
            ll.put("advertise", c.link.advertise);
            setOrDel(mapIn(ll, "options"), "outQueueSize", c.link.outQueueSize);
            prune(ll, "options");
        }
        linkMap.put("dialers", dialers);
        linkMap.put("listeners", lListeners);
        prune(linkMap, "dialers");
        prune(linkMap, "listeners");
        doc.put("link", linkMap);
        prune(doc, "link");

        List<Object> listeners = asList(doc.get("listeners"));
        Map<String, Object> el = upsertBinding(listeners, "edge", c.edge.enabled);
        if (el != null) {
            el.put("address", c.edge.address);
            Map<String, Object> options = mapIn(el, "options");
            options.put("advertise", c.edge.advertise);
            setOrDel(options, "connectTimeoutMs", c.edge.connectTimeoutMs);
            setOrDel(options, "getSessionTimeout", c.edge.getSessionTimeout);
        }
        Map<String, Object> tl = upsertBinding(listeners, "tunnel", c.tunnel.enabled);
        if (tl != null) {
            Map<String, Object> options = mapIn(tl, "options");
            options.put("mode", c.tunnel.mode);
            boolean tproxy = c.tunnel.mode.equals("tproxy");
            setOrDel(options, "resolver", tproxy ? c.tunnel.resolver : "");
            setOrDel(options, "lanIf", tproxy ? c.tunnel.lanIf : "");
            setOrDel(options, "dnsSvcIpRange", tproxy ? c.tunnel.dnsSvcIpRange : "");
        }
        doc.put("listeners", listeners);
        prune(doc, "listeners");

        // CSR lives under `edge` (the fabric-only template keeps it at top level)
        boolean wantCsr = c.edge.enabled || c.tunnel.enabled;
        Map<String, Object> holder = c.csrTop ? doc : mapIn(doc, "edge");
        if (wantCsr) {
            Map<String, Object> csrMap = asMap(holder.get("csr"));
            setOrDel(csrMap, "country", c.csr.country);
            setOrDel(csrMap, "province", c.csr.province);
            setOrDel(csrMap, "locality", c.csr.locality);
            setOrDel(csrMap, "organization", c.csr.organization);
            setOrDel(csrMap, "organizationalUnit", c.csr.organizationalUnit);
            Map<String, Object> sans = mapIn(csrMap, "sans");
            setOrDel(sans, "dns", c.csr.dns.isEmpty() ? null : new ArrayList<Object>(c.csr.dns));
            setOrDel(sans, "ip", c.csr.ip.isEmpty() ? null : new ArrayList<Object>(c.csr.ip));
            prune(csrMap, "sans");
            holder.put("csr", csrMap);
        }
        // with no form-managed listener, any CSR in the source belongs to a listener the form does not model: keep it
        if (!c.csrTop) {
            prune(doc, "edge");
        }

        Map<String, Object> fwd = asMap(doc.get("forwarder"));
        setOrDel(fwd, "xgressDialQueueLength", c.forwarder.xgressDialQueueLength);
        setOrDel(fwd, "xgressDialWorkerCount", c.forwarder.xgressDialWorkerCount);
        setOrDel(fwd, "linkDialQueueLength", c.forwarder.linkDialQueueLength);
        setOrDel(fwd, "linkDialWorkerCount", c.forwarder.linkDialWorkerCount);
        doc.put("forwarder", fwd);
        prune(doc, "forwarder");

        Map<String, Object> met = asMap(doc.get("metrics"));
        setOrDel(met, "reportInterval", c.metrics.reportInterval);
        setOrDel(met, "messageQueueSize", c.metrics.messageQueueSize);
        doc.put("metrics", met);
        prune(doc, "metrics");

        Map<String, Object> hc = asMap(doc.get("healthChecks"));
        Map<String, Object> ping = asMap(hc.get("ctrlPingCheck"));
        setOrDel(ping, "interval", c.health.ctrlPingInterval);
        setOrDel(ping, "timeout", c.health.ctrlPingTimeout);
        setOrDel(ping, "initialDelay", c.health.ctrlPingInitialDelay);
        hc.put("ctrlPingCheck", ping);
        prune(hc, "ctrlPingCheck");
        Map<String, Object> lc = asMap(hc.get("linkCheck"));
        setOrDel(lc, "minLinks", c.health.minLinks);
        hc.put("linkCheck", lc);
        prune(hc, "linkCheck");
        doc.put("healthChecks", hc);
        prune(doc, "healthChecks");

        // fresh documents keep a readable section order
        if (c.base == null) {
            Map<String, Object> sorted = new LinkedHashMap<>();
            for (String k : List.of("v", "identity", "ctrl", "link", "listeners", "edge", "csr", "forwarder", "metrics",
                    "healthChecks")) {
                if (doc.containsKey(k)) {
                    sorted.put(k, doc.get(k));
                }
            }
            doc.forEach(sorted::putIfAbsent);
            return sorted;
        }
        return doc;
    }

    public String toYaml() {
        return YamlSupport.dumpDocument(buildDocument(), List.of("# OpenZiti router configuration",
                "# Generated by Baked Pasta Console Config Builder. Review before use; ${ENV_VARS} are expanded by the router."));
    }

    // ------------------------------------------------------------------ ingest

    public record Loaded(RouterConfig cfg, List<String> warnings) {
    }

    private static Double n(Object v) {
        return v instanceof Number num ? num.doubleValue() : null;
    }

    private static List<String> strs(Object v) {
        return new ArrayList<>(asList(v).stream().map(x -> x == null ? "null" : YamlSupport.jsString(x)).toList());
    }

    private static Map<String, Object> find(Object list, String binding) {
        for (Object x : asList(list)) {
            if (isObj(x) && binding.equals(asMap(x).get("binding"))) {
                return asMap(x);
            }
        }
        return null;
    }

    public static Loaded fromDocument(Map<String, Object> doc) {
        List<String> warnings = new ArrayList<>();
        Object v = doc.get("v");
        if (!(v instanceof Number nv && nv.doubleValue() == 3)) {
            warnings.add("config version is " + (v == null ? "missing" : YamlSupport.jsString(v)) + "; routers expect v: 3");
        }
        RouterConfig c = defaults();
        c.base = doc;

        Map<String, Object> id = asMap(doc.get("identity"));
        c.identity.cert = str(id.get("cert"));
        c.identity.serverCert = str(id.get("server_cert"));
        c.identity.key = str(id.get("key"));
        c.identity.ca = str(id.get("ca"));

        Map<String, Object> ctrlMap = asMap(doc.get("ctrl"));
        c.ctrlList = ctrlMap.get("endpoints") instanceof List;
        c.ctrl.endpoints = c.ctrlList ? strs(ctrlMap.get("endpoints"))
                : truthy(ctrlMap.get("endpoint")) ? new ArrayList<>(List.of(str(ctrlMap.get("endpoint")))) : new ArrayList<>();
        c.ctrl.endpointsFile = str(ctrlMap.get("endpointsFile"));

        Map<String, Object> linkMap = asMap(doc.get("link"));
        Map<String, Object> ll = find(linkMap.get("listeners"), "transport");
        Map<String, Object> dl = find(linkMap.get("dialers"), "transport");
        c.link.dial = dl != null;
        c.link.dialGroups = strs(dl == null ? null : dl.get("groups"));
        c.link.listenGroups = strs(ll == null ? null : ll.get("groups"));
        c.link.listen = ll != null;
        c.link.bind = str(ll == null ? null : ll.get("bind"));
        c.link.advertise = str(ll == null ? null : ll.get("advertise"));
        c.link.outQueueSize = n(get(ll, "options", "outQueueSize"));
        if (asList(linkMap.get("dialers")).stream().anyMatch(d -> !"transport".equals(get(d, "binding")))) {
            warnings.add("kept non-transport link dialers as-is");
        }

        Map<String, Object> el = find(doc.get("listeners"), "edge");
        Map<String, Object> eo = asMap(el == null ? null : el.get("options"));
        c.edge.enabled = el != null;
        c.edge.address = str(el == null ? null : el.get("address"));
        c.edge.advertise = str(eo.get("advertise"));
        c.edge.connectTimeoutMs = n(eo.get("connectTimeoutMs"));
        c.edge.getSessionTimeout = n(eo.get("getSessionTimeout"));

        Map<String, Object> tl = find(doc.get("listeners"), "tunnel");
        Map<String, Object> to = asMap(tl == null ? null : tl.get("options"));
        c.tunnel.enabled = tl != null;
        Object mode = to.get("mode");
        c.tunnel.mode = TUNNEL_MODES.stream().anyMatch(m -> m.id().equals(mode)) ? (String) mode : "tproxy";
        c.tunnel.resolver = str(to.get("resolver"));
        c.tunnel.lanIf = str(to.get("lanIf"));
        c.tunnel.dnsSvcIpRange = str(to.get("dnsSvcIpRange"));

        List<String> others = new ArrayList<>();
        for (Object x : asList(doc.get("listeners"))) {
            Object b = x instanceof Map<?, ?> m && m.containsKey("binding") ? m.get("binding") : null;
            boolean present = x instanceof Map<?, ?> m2 && m2.containsKey("binding");
            if (!"edge".equals(b) && !"tunnel".equals(b)) {
                others.add(present ? YamlSupport.jsString(b) : "undefined");
            }
        }
        c.otherListeners = others;
        if (!others.isEmpty()) {
            warnings.add("kept other listeners as-is: " + String.join(", ", others));
        }

        c.csrTop = !isObj(get(doc, "edge", "csr")) && isObj(doc.get("csr"));
        Map<String, Object> csrMap = asMap(c.csrTop ? doc.get("csr") : get(doc, "edge", "csr"));
        c.csr.country = str(csrMap.get("country"));
        c.csr.province = str(csrMap.get("province"));
        c.csr.locality = str(csrMap.get("locality"));
        c.csr.organization = str(csrMap.get("organization"));
        c.csr.organizationalUnit = str(csrMap.get("organizationalUnit"));
        c.csr.dns = strs(get(csrMap, "sans", "dns"));
        c.csr.ip = strs(get(csrMap, "sans", "ip"));

        Map<String, Object> f = asMap(doc.get("forwarder"));
        c.forwarder.xgressDialQueueLength = n(f.get("xgressDialQueueLength"));
        c.forwarder.xgressDialWorkerCount = n(f.get("xgressDialWorkerCount"));
        c.forwarder.linkDialQueueLength = n(f.get("linkDialQueueLength"));
        c.forwarder.linkDialWorkerCount = n(f.get("linkDialWorkerCount"));
        c.metrics.reportInterval = str(get(doc, "metrics", "reportInterval"));
        c.metrics.messageQueueSize = n(get(doc, "metrics", "messageQueueSize"));
        c.health.ctrlPingInterval = str(get(doc, "healthChecks", "ctrlPingCheck", "interval"));
        c.health.ctrlPingTimeout = str(get(doc, "healthChecks", "ctrlPingCheck", "timeout"));
        c.health.ctrlPingInitialDelay = str(get(doc, "healthChecks", "ctrlPingCheck", "initialDelay"));
        c.health.minLinks = n(get(doc, "healthChecks", "linkCheck", "minLinks"));

        List<String> managed = List.of("v", "identity", "ctrl", "link", "listeners", "edge", "csr", "forwarder", "metrics",
                "healthChecks");
        List<String> extra = doc.keySet().stream().filter(k -> !managed.contains(k)).toList();
        if (!extra.isEmpty()) {
            warnings.add("passing through untouched: " + String.join(", ", extra));
        }
        return new Loaded(c, warnings);
    }
}
