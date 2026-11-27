package com.example.ziti;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Helpers for service configs: known types, grouping, templates and endpoint description. */
public final class ServiceConfigs {

    private ServiceConfigs() {
    }

    public record KnownType(String name, String purpose, Object template) {
    }

    public static final List<KnownType> KNOWN = List.of(
            new KnownType("intercept.v1", "What clients dial: the address and ports a tunneler intercepts.",
                    Json.map("protocols", List.of("tcp"), "addresses", List.of("app.ziti"), "portRanges",
                            List.of(Json.map("low", 443, "high", 443)))),
            new KnownType("host.v1", "Where the hosting tunneler forwards traffic.",
                    Json.map("protocol", "tcp", "address", "127.0.0.1", "port", 8080)),
            new KnownType("host.v2", "Hosting with one or more terminators.",
                    Json.map("terminators", List.of(Json.map("protocol", "tcp", "address", "127.0.0.1", "port", 8080)))),
            new KnownType("ziti-tunneler-client.v1", "Legacy client intercept (older tunnelers).", null),
            new KnownType("ziti-tunneler-server.v1", "Legacy hosting (older tunnelers).", null));

    private static int knownIndex(String name) {
        for (int i = 0; i < KNOWN.size(); i++) {
            if (KNOWN.get(i).name().equals(name)) {
                return i;
            }
        }
        return -1;
    }

    public static String configTypeName(Map<String, Object> config, List<Map<String, Object>> types) {
        String n = Json.str(config, "configType.name");
        if (n != null && !n.isEmpty()) {
            return n;
        }
        String typeId = Json.str(config, "configTypeId");
        return types.stream().filter(t -> typeId != null && typeId.equals(t.get("id"))).map(t -> Json.str(t, "name"))
                .findFirst().orElse(typeId);
    }

    public record TypeGroup(String typeId, String typeName, boolean known, String purpose,
            List<Map<String, Object>> configs) {
    }

    public static List<TypeGroup> groupByType(List<Map<String, Object>> configs, List<Map<String, Object>> types) {
        Map<String, TypeGroup> byType = new LinkedHashMap<>();
        for (Map<String, Object> c : configs) {
            String typeId = Json.strOr(c, "configTypeId", Json.strOr(c, "configType.id", ""));
            TypeGroup g = byType.get(typeId);
            if (g == null) {
                String name = configTypeName(c, types);
                int idx = knownIndex(name);
                g = new TypeGroup(typeId, name, idx >= 0, idx >= 0 ? KNOWN.get(idx).purpose() : null, new ArrayList<>());
                byType.put(typeId, g);
            }
            g.configs().add(c);
        }
        for (TypeGroup g : byType.values()) {
            g.configs().sort(Comparator.comparing(c -> Json.strOr(c, "name", "")));
        }
        List<TypeGroup> out = new ArrayList<>(byType.values());
        out.sort(Comparator.<TypeGroup>comparingInt(g -> g.known() ? knownIndex(g.typeName()) : KNOWN.size())
                .thenComparing(g -> String.valueOf(g.typeName())));
        return out;
    }

    /** Selects configId for its type, replacing another config of the same type; null clears the type. */
    public static List<String> selectForType(List<String> selected, String typeId, String configId,
            List<Map<String, Object>> configs) {
        Map<String, String> typeOf = new HashMap<>();
        configs.forEach(c -> typeOf.put(Json.str(c, "id"), Json.str(c, "configTypeId")));
        List<String> kept = new ArrayList<>(selected.stream().filter(id -> !typeId.equals(typeOf.get(id))).toList());
        if (configId != null) {
            kept.add(configId);
        }
        return kept;
    }

    public static List<String> duplicateTypes(List<String> selected, List<Map<String, Object>> configs,
            List<Map<String, Object>> types) {
        Map<String, Integer> count = new LinkedHashMap<>();
        Map<String, String> name = new HashMap<>();
        for (String id : selected) {
            Map<String, Object> c = configs.stream().filter(x -> id.equals(x.get("id"))).findFirst().orElse(null);
            if (c == null) {
                continue;
            }
            String t = Json.str(c, "configTypeId");
            count.merge(t, 1, Integer::sum);
            name.put(t, configTypeName(c, types));
        }
        return count.entrySet().stream().filter(e -> e.getValue() > 1).map(e -> name.get(e.getKey())).toList();
    }

    public static Map<String, List<Map<String, Object>>> servicesByConfig(List<Map<String, Object>> services) {
        Map<String, List<Map<String, Object>>> out = new HashMap<>();
        for (Map<String, Object> s : services) {
            for (String id : Json.strings(s, "configs")) {
                out.computeIfAbsent(id, k -> new ArrayList<>()).add(s);
            }
        }
        return out;
    }

    public static String template(String typeName) {
        int i = knownIndex(typeName);
        Object t = i >= 0 ? KNOWN.get(i).template() : null;
        return Json.pretty(t == null ? Map.of() : t);
    }

    public record EndpointInfo(String interceptDisplay, String hostDisplay, String url, String protocol) {
    }

    private static final Set<Integer> HTTPS_PORTS = Set.of(443, 8443, 6443);
    private static final Set<Integer> HTTP_PORTS = Set.of(80, 3000, 5000, 8000, 8080, 8888, 9000, 11434);
    private static final Pattern HTTP_NAME = Pattern.compile("\\b(http|ollama|grafana|jenkins|api|web)\\b",
            Pattern.CASE_INSENSITIVE);

    private static boolean looksLikeIntercept(String type, Map<String, Object> d) {
        if ("intercept.v1".equals(type) || "ziti-tunneler-client.v1".equals(type)) {
            return true;
        }
        if (type != null) {
            return false;
        }
        return d.get("addresses") instanceof List || d.get("portRanges") instanceof List
                || (d.get("hostname") instanceof String && !d.containsKey("protocol"));
    }

    private static boolean looksLikeHost(String type, Map<String, Object> d) {
        if ("host.v1".equals(type) || "host.v2".equals(type) || "ziti-tunneler-server.v1".equals(type)) {
            return true;
        }
        if (type != null) {
            return false;
        }
        return d.get("terminators") instanceof List || d.containsKey("address")
                || (d.containsKey("hostname") && d.containsKey("protocol"));
    }

    /**
     * @param configs id → config with keys "type" (type name, may be null) and "data".
     */
    @SuppressWarnings("unchecked")
    public static EndpointInfo describe(String serviceName, List<String> configIds,
            Map<String, Map<String, Object>> configs) {
        String interceptAddress = null;
        String protocol = "tcp";
        Integer singlePort = null;
        String interceptDisplay = null;
        String hostDisplay = null;
        for (String id : configIds == null ? List.<String>of() : configIds) {
            Map<String, Object> cfg = configs.get(id);
            if (cfg == null || !(cfg.get("data") instanceof Map<?, ?>)) {
                continue;
            }
            Map<String, Object> d = (Map<String, Object>) cfg.get("data");
            String type = (String) cfg.get("type");
            if (interceptDisplay == null && looksLikeIntercept(type, d)) {
                List<?> addrs = d.get("addresses") instanceof List<?> l ? l : List.of();
                String primary = !addrs.isEmpty() && addrs.getFirst() instanceof String s ? s
                        : d.get("hostname") instanceof String h ? h : null;
                List<?> protos = d.get("protocols") instanceof List<?> l ? l : List.of();
                String proto = !protos.isEmpty() && protos.getFirst() instanceof String s ? s
                        : d.get("protocol") instanceof String p ? p : "tcp";
                protocol = proto.toLowerCase();
                List<?> ranges = d.get("portRanges") instanceof List<?> l ? l : List.of();
                Map<String, Object> first = !ranges.isEmpty() && ranges.getFirst() instanceof Map<?, ?> m
                        ? (Map<String, Object>) m
                        : null;
                if (primary != null) {
                    interceptAddress = primary;
                    if (first != null && first.get("low") instanceof Number lo && first.get("high") instanceof Number hi) {
                        if (lo.intValue() == hi.intValue()) {
                            singlePort = lo.intValue();
                            interceptDisplay = primary + ":" + lo.intValue();
                        } else {
                            interceptDisplay = primary + ":" + lo.intValue() + "-" + hi.intValue();
                        }
                    } else if (d.get("port") instanceof Number p) {
                        singlePort = p.intValue();
                        interceptDisplay = primary + ":" + p.intValue();
                    } else {
                        interceptDisplay = primary;
                    }
                }
                continue;
            }
            if (hostDisplay == null && looksLikeHost(type, d)) {
                List<?> terms = d.get("terminators") instanceof List<?> l ? l : List.of();
                Map<String, Object> h = !terms.isEmpty() && terms.getFirst() instanceof Map<?, ?> m
                        ? (Map<String, Object>) m
                        : d;
                String addr = h.get("address") instanceof String a ? a : h.get("hostname") instanceof String n ? n : null;
                Object port = h.get("port") instanceof Number p ? p.intValue() : null;
                if (addr != null) {
                    hostDisplay = port != null ? addr + ":" + port : addr;
                }
            }
        }
        String url = null;
        if (interceptAddress != null && singlePort != null && protocol.equals("tcp") && !interceptAddress.contains("*")
                && !interceptAddress.contains("/")) {
            String lower = serviceName.toLowerCase();
            boolean https = HTTPS_PORTS.contains(singlePort) || lower.contains("https") || lower.contains("k8s-api");
            boolean http = HTTP_PORTS.contains(singlePort) || HTTP_NAME.matcher(serviceName).find();
            if (https) {
                url = "https://" + interceptAddress + ":" + singlePort;
            } else if (http) {
                url = "http://" + interceptAddress + ":" + singlePort;
            }
        }
        return new EndpointInfo(interceptDisplay, hostDisplay, url, interceptDisplay != null ? protocol : null);
    }

    /** Index of controller config rows for {@link #describe}. */
    public static Map<String, Map<String, Object>> index(List<Map<String, Object>> configs) {
        Map<String, Map<String, Object>> out = new HashMap<>();
        for (Map<String, Object> c : configs) {
            Map<String, Object> e = new HashMap<>();
            e.put("type", Json.str(c, "configType.name"));
            e.put("data", c.get("data"));
            out.put(Json.str(c, "id"), e);
        }
        return out;
    }

    /** Parses config data typed by the user; it must be a JSON object. */
    public static Map<String, Object> parseData(String text) {
        Object v;
        try {
            v = Json.parse(text);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Not valid JSON: " + ZitiException.text(e));
        }
        if (!(v instanceof Map<?, ?>)) {
            throw new IllegalArgumentException("Config data must be a JSON object, e.g. { \"port\": 443 }.");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) v;
        return m;
    }
}
