package com.example.ziti;

import static com.example.ziti.Json.map;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side stand-in for the controller's data, used by the Interactive Demo Sandbox. Each
 * Vaadin session gets its own copy, so visitors never see each other's edits.
 */
public final class DemoStore {

    private DemoStore() {
    }

    /** The demo rows for every management collection, shaped like controller responses. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> createInitial() {
        try (InputStream in = DemoStore.class.getResourceAsStream("/demo/demo-store.json")) {
            if (in == null) {
                throw new IllegalStateException("demo/demo-store.json is missing from the classpath");
            }
            String text = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            long now = System.currentTimeMillis();
            Map<String, Object> raw = (Map<String, Object>) Json.parse(text);
            Map<String, Object> store = (Map<String, Object>) resolveTimes(raw, now);
            store.put("serviceConfigOverrides", new LinkedHashMap<String, Object>());
            return store;
        } catch (IOException e) {
            throw new IllegalStateException("Could not read the demo store", e);
        }
    }

    /** Replaces "$now", "$ago:SECONDS" and "$in:SECONDS" placeholders with ISO timestamps. */
    private static Object resolveTimes(Object node, long now) {
        if (node instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, v) -> out.put(String.valueOf(k), resolveTimes(v, now)));
            return out;
        }
        if (node instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            for (Object v : l) {
                out.add(resolveTimes(v, now));
            }
            return out;
        }
        if (node instanceof String s && s.startsWith("$")) {
            if (s.equals("$now")) {
                return Instant.ofEpochMilli(now).toString();
            }
            if (s.startsWith("$ago:")) {
                return Instant.ofEpochMilli(now - Long.parseLong(s.substring(5)) * 1000).toString();
            }
            if (s.startsWith("$in:")) {
                return Instant.ofEpochMilli(now + Long.parseLong(s.substring(4)) * 1000).toString();
            }
        }
        return node;
    }

    // ------------------------------------------------------------------ demo fabric

    private record DemoLink(String a, String b, long src, long dst, boolean down) {
    }

    /** Demo links between router pairs, with per-direction latency in nanoseconds. */
    private static final List<DemoLink> DEMO_LINKS = List.of(
            new DemoLink("er-us-east", "tr-core-01", 38_000_000, 41_000_000, false),
            new DemoLink("er-eu-west", "tr-core-01", 9_000_000, 11_000_000, false),
            new DemoLink("er-us-east", "er-eu-west", 72_000_000, 76_000_000, false),
            new DemoLink("er-lab", "tr-core-01", 0, 0, true));

    private static String linkId(String a, String b) {
        String[] pair = { a, b };
        Arrays.sort(pair);
        return "link-" + pair[0] + "--" + pair[1];
    }

    /**
     * Fabric API stand-in derived from the current demo store so it follows edits: routers with
     * their online state, a few links with latencies, and one circuit per Dial session.
     */
    public static Map<String, List<Map<String, Object>>> fabric(Map<String, Object> store) {
        List<Map<String, Object>> routers = new ArrayList<>();
        for (String coll : List.of("edge-routers", "transit-routers")) {
            for (Map<String, Object> r : Json.objects(store, coll)) {
                routers.add(map("id", r.get("id"), "name", r.get("name"), "connected", Json.bool(r, "isOnline"),
                        "cost", r.get("cost"), "tags", r.get("tags")));
            }
        }
        java.util.function.Function<String, String> routerName = id -> routers.stream()
                .filter(r -> id.equals(r.get("id"))).map(r -> (String) r.get("name")).findFirst().orElse(null);

        List<Map<String, Object>> links = new ArrayList<>();
        for (DemoLink l : DEMO_LINKS) {
            if (routerName.apply(l.a) == null || routerName.apply(l.b) == null) {
                continue;
            }
            links.add(map("id", linkId(l.a, l.b),
                    "sourceRouter", map("id", l.a, "name", routerName.apply(l.a)),
                    "destRouter", map("id", l.b, "name", routerName.apply(l.b)),
                    "state", l.down ? "Failed" : "Connected", "down", l.down, "protocol", "tls", "cost", 1,
                    "sourceLatency", l.src, "destLatency", l.dst));
        }
        java.util.function.BiPredicate<String, String> hasLink = (a, b) -> links.stream()
                .anyMatch(l -> l.get("id").equals(linkId(a, b)) && !Json.bool(l, "down"));

        List<Map<String, Object>> circuits = new ArrayList<>();
        for (Map<String, Object> s : Json.objects(store, "sessions")) {
            String serviceId = Json.str(s, "serviceId");
            if ("Bind".equals(s.get("type")) || serviceId == null) {
                continue;
            }
            Map<String, Object> term = Json.objects(store, "terminators").stream()
                    .filter(t -> serviceId.equals(t.get("serviceId"))).findFirst().orElse(null);
            if (term == null) {
                continue;
            }
            String address = Json.strOr(term, "address", "");
            String hostId = address.startsWith("hosted:") ? address.substring("hosted:".length()) : null;
            // Clients in Europe (east of 30°W) enter via eu-west, everyone else via us-east.
            String identityId = Json.str(s, "identityId");
            Map<String, Object> ident = Json.objects(store, "identities").stream()
                    .filter(i -> i.get("id").equals(identityId)).findFirst().orElse(null);
            double[] p = Geo.parse(Json.path(ident, "tags.geolocation"));
            String ingress = p != null && p[1] > -30 ? "er-eu-west" : "er-us-east";
            if (routerName.apply(ingress) == null) {
                continue;
            }
            String egress = Json.str(term, "routerId");
            List<String> nodes = new ArrayList<>(List.of(ingress));
            if (!ingress.equals(egress)) {
                nodes = hasLink.test(ingress, "tr-core-01") && hasLink.test("tr-core-01", egress)
                        ? List.of(ingress, "tr-core-01", egress)
                        : List.of(ingress, egress);
            }
            List<Object> pathNodes = new ArrayList<>();
            List<Object> pathLinks = new ArrayList<>();
            for (int i = 0; i < nodes.size(); i++) {
                pathNodes.add(map("id", nodes.get(i), "name", routerName.apply(nodes.get(i))));
                if (i > 0) {
                    pathLinks.add(linkId(nodes.get(i - 1), nodes.get(i)));
                }
            }
            Map<String, Object> tags = map("clientId", identityId);
            if (hostId != null) {
                tags.put("hostId", hostId);
            }
            circuits.add(map("id", "circ-" + s.get("id"),
                    "service", map("id", serviceId, "name", Json.str(s, "service.name")),
                    "terminator", map("id", term.get("id")),
                    "path", map("nodes", pathNodes, "links", pathLinks),
                    "tags", tags, "createdAt", s.get("createdAt")));
        }
        Map<String, List<Map<String, Object>>> out = new LinkedHashMap<>();
        out.put("routers", routers);
        out.put("links", links);
        out.put("circuits", circuits);
        return out;
    }
}
