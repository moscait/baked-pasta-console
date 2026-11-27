package com.example.netmap;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.example.ziti.Json;

/**
 * Network map model: fabric circuits and links normalised across controller versions, entity
 * geolocation ({@code tags.geolocation = "lat,lng"}), circuit paths, marker spreading and the
 * recent-circuit history. Pure, so it is tested without a map component.
 */
public final class NetworkMapLogic {

    private NetworkMapLogic() {
    }

    public record Point(double lat, double lng) {
    }

    public record MapCircuit(String id, String serviceId, String serviceName, String clientId, String hostId,
            List<String> routerIds, List<String> linkIds, String createdAt) {
        /** Client, routers and host, in travel order, without blanks. */
        public List<String> hops() {
            List<String> out = new ArrayList<>();
            if (clientId != null) {
                out.add(clientId);
            }
            out.addAll(routerIds);
            if (hostId != null) {
                out.add(hostId);
            }
            return out;
        }
    }

    /** Latency in ms of the slower direction (null when not reported); level good/warn/bad/unknown. */
    public record MapLink(String id, String a, String b, boolean up, Double latencyMs, String level, Double cost,
            String protocol) {
    }

    /** kind: edge-router, transit-router or identity. approxVia: router an unlocated identity is drawn at. */
    public record MapNode(String id, String name, String kind, Boolean online, Point point, String approxVia,
            List<String> attributes, Map<String, Object> tags) {
    }

    public record Hop(String id, String name) {
    }

    public record CircuitPath(String circuitId, List<Point> points, List<Hop> missing) {
    }

    /** endedBy: set once a refresh no longer lists it (ms since epoch). */
    public record SeenCircuit(MapCircuit circuit, long lastSeen, Long endedBy) {
    }

    /** How long an ended circuit stays on the map as "recent". */
    public static final long RECENT_CIRCUIT_MS = 10 * 60 * 1000;

    /** Spacing between markers spread around a shared point, in screen pixels. */
    public static final int SPREAD_PX = 26;

    // ------------------------------------------------------------------ geolocation

    private static final Pattern NUM = Pattern.compile("^-?\\d+(\\.\\d+)?$");

    public static Point parseGeolocation(Object tag) {
        if (!(tag instanceof String s)) {
            return null;
        }
        String[] parts = s.split(",", -1);
        if (parts.length != 2) {
            return null;
        }
        String la = parts[0].trim();
        String ln = parts[1].trim();
        if (!NUM.matcher(la).matches() || !NUM.matcher(ln).matches()) {
            return null;
        }
        double lat = Double.parseDouble(la);
        double lng = Double.parseDouble(ln);
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return null;
        }
        return new Point(lat, lng);
    }

    /** Rounded to ~1 m, longitude wrapped into [-180, 180], latitude clamped. */
    public static String formatGeolocation(Point p) {
        double lng = ((((p.lng() + 180) % 360) + 360) % 360) - 180;
        double lat = Math.max(-90, Math.min(90, p.lat()));
        return String.format(Locale.ROOT, "%.5f,%.5f", lat, lng);
    }

    // ------------------------------------------------------------------ circuits & links

    private static String idOf(Object v) {
        if (v instanceof String s) {
            return s.isEmpty() ? null : s;
        }
        String id = v instanceof Map<?, ?> ? Json.str(v, "id") : null;
        return id == null || id.isEmpty() ? null : id;
    }

    private static String first(String... values) {
        for (String v : values) {
            if (v != null && !v.isEmpty()) {
                return v;
            }
        }
        return null;
    }

    private static String tagString(Map<String, Object> c, String key) {
        Object v = Json.path(c, "tags." + key);
        return v instanceof String s && !s.isBlank() ? s.trim() : null;
    }

    public static MapCircuit normalizeCircuit(Map<String, Object> c) {
        return normalizeCircuit(c, Map.of(), Map.of());
    }

    /**
     * Client and host identities come from the edge's circuit tags first, then the other shapes
     * controller versions have used, then the terminator's host.
     */
    public static MapCircuit normalizeCircuit(Map<String, Object> c, Map<String, String> terminatorHosts,
            Map<String, String> serviceNames) {
        String serviceId = first(Json.str(c, "service.id"), Json.str(c, "serviceId"));
        serviceId = serviceId == null ? "" : serviceId;
        String terminatorId = first(Json.str(c, "terminator.id"), Json.str(c, "terminatorId"));
        Object termIdentity = Json.path(c, "terminator.identity");
        String hostId = first(tagString(c, "hostId"), Json.str(c, "host.id"), Json.str(c, "hostId"),
                Json.str(c, "terminator.hostId"), Json.str(c, "terminator.identityId"),
                termIdentity instanceof String s ? s : termIdentity != null ? Json.str(termIdentity, "id") : null,
                terminatorId != null ? terminatorHosts.get(terminatorId) : null);
        String clientId = first(tagString(c, "clientId"), Json.str(c, "client.id"), Json.str(c, "initiator.id"),
                Json.str(c, "sourceId"), Json.str(c, "clientId"));
        String serviceName = first(Json.str(c, "service.name"), serviceNames.get(serviceId), serviceId,
                "unknown service");
        List<String> routers = new ArrayList<>();
        for (Object n : orEmpty(Json.list(c, "path.nodes"))) {
            String id = idOf(n);
            if (id != null) {
                routers.add(id);
            }
        }
        List<String> links = new ArrayList<>();
        for (Object n : orEmpty(Json.list(c, "path.links"))) {
            String id = idOf(n);
            if (id != null) {
                links.add(id);
            }
        }
        return new MapCircuit(Json.str(c, "id"), serviceId, serviceName, clientId, hostId, routers, links,
                first(Json.str(c, "createdAt")));
    }

    private static List<Object> orEmpty(List<Object> l) {
        return l == null ? List.of() : l;
    }

    /** Under 50 ms good, up to 100 ms elevated, above that poor. */
    public static String latencyLevel(Double ms) {
        if (ms == null || !Double.isFinite(ms)) {
            return "unknown";
        }
        if (ms < 50) {
            return "good";
        }
        return ms <= 100 ? "warn" : "bad";
    }

    public static MapLink normalizeLink(Map<String, Object> l) {
        String a = first(Json.str(l, "sourceRouter.id"), Json.str(l, "sourceRouterId"), Json.str(l, "src.id"));
        String b = first(Json.str(l, "destRouter.id"), Json.str(l, "destRouterId"), Json.str(l, "dst.id"));
        if (a == null || b == null) {
            return null;
        }
        double max = -1;
        for (String k : List.of("sourceLatency", "destLatency")) {
            if (l.get(k) instanceof Number n && n.doubleValue() >= 0) {
                max = Math.max(max, n.doubleValue());
            }
        }
        Double latencyMs = max < 0 ? null : Math.round(max / 1e5) / 10.0;
        String state = Json.str(l, "state");
        boolean up = !Json.bool(l, "down") && (state == null || state.isEmpty() || state.equalsIgnoreCase("connected"));
        Double cost = l.get("cost") instanceof Number n ? n.doubleValue()
                : l.get("staticCost") instanceof Number n2 ? n2.doubleValue() : null;
        return new MapLink(Json.str(l, "id"), a, b, up, latencyMs, up ? latencyLevel(latencyMs) : "bad", cost,
                first(Json.str(l, "protocol")));
    }

    // ------------------------------------------------------------------ map assembly

    public static CircuitPath circuitPath(MapCircuit c, Map<String, MapNode> nodes) {
        List<Point> points = new ArrayList<>();
        List<Hop> missing = new ArrayList<>();
        for (String id : c.hops()) {
            MapNode n = nodes.get(id);
            if (n != null && n.point() != null) {
                points.add(n.point());
            } else {
                missing.add(new Hop(id, n != null ? n.name() : id));
            }
        }
        return new CircuitPath(c.id(), points, missing);
    }

    /** Circuit counts per node (as client, router hop or host). */
    public static Map<String, Integer> circuitLoad(List<MapCircuit> circuits) {
        Map<String, Integer> load = new HashMap<>();
        for (MapCircuit c : circuits) {
            for (String id : new LinkedHashSet<>(c.hops())) {
                load.merge(id, 1, Integer::sum);
            }
        }
        return load;
    }

    /**
     * The router each identity reaches the fabric through: the first hop for a dialing client, the
     * last for a hosting identity. The first circuit seen for an identity wins.
     */
    public static Map<String, String> circuitRouters(List<MapCircuit> circuits) {
        Map<String, String> via = new HashMap<>();
        for (MapCircuit c : circuits) {
            if (c.routerIds().isEmpty()) {
                continue;
            }
            if (c.clientId() != null) {
                via.putIfAbsent(c.clientId(), c.routerIds().getFirst());
            }
            if (c.hostId() != null) {
                via.putIfAbsent(c.hostId(), c.routerIds().getLast());
            }
        }
        return via;
    }

    public record SpreadItem(String id, Point point, boolean center) {
    }

    /**
     * Screen-pixel offsets that fan out markers drawn at the same point. In a group the first
     * {@code center} item stays on the point and the rest ring around it from 12 o'clock.
     */
    public static Map<String, int[]> spreadOffsets(List<SpreadItem> items) {
        Map<String, List<SpreadItem>> groups = new LinkedHashMap<>();
        for (SpreadItem it : items) {
            String key = String.format(Locale.ROOT, "%.5f,%.5f", it.point().lat(), it.point().lng());
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(it);
        }
        Map<String, int[]> out = new HashMap<>();
        for (List<SpreadItem> g : groups.values()) {
            SpreadItem hub = g.stream().filter(SpreadItem::center).findFirst().orElse(null);
            if (hub != null) {
                out.put(hub.id(), new int[] { 0, 0 });
            }
            List<SpreadItem> ring = g.stream().filter(it -> it != hub).toList();
            if (hub == null && ring.size() == 1) {
                out.put(ring.getFirst().id(), new int[] { 0, 0 });
                continue;
            }
            double radius = Math.max(SPREAD_PX, (ring.size() * SPREAD_PX) / (2 * Math.PI));
            for (int i = 0; i < ring.size(); i++) {
                double angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.size();
                out.put(ring.get(i).id(), new int[] { (int) Math.round(radius * Math.cos(angle)),
                        (int) Math.round(radius * Math.sin(angle)) });
            }
        }
        return out;
    }

    /** {@code #text} matches role attributes, anything else the name. */
    public static boolean matchesLocationQuery(String name, List<String> attributes, String query) {
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) {
            return true;
        }
        if (q.startsWith("#")) {
            String attr = q.substring(1);
            return attributes.stream().anyMatch(a -> a.toLowerCase(Locale.ROOT).contains(attr));
        }
        return name.toLowerCase(Locale.ROOT).contains(q);
    }

    private static final Pattern COORDS = Pattern
            .compile("^(-?\\d+(?:\\.\\d+)?)\\s*°?\\s*([NS])?\\s*[,;\\s]\\s*(-?\\d+(?:\\.\\d+)?)\\s*°?\\s*([EW])?$");

    /** "39.04, -77.48", "39.04 -77.48" or "39.04°N 77.48°W"; null when not a coordinate pair. */
    public static Point parseCoordinates(String text) {
        Matcher m = COORDS.matcher(text.trim().toUpperCase(Locale.ROOT));
        if (!m.matches()) {
            return null;
        }
        double lat = Double.parseDouble(m.group(1));
        double lng = Double.parseDouble(m.group(3));
        if ("S".equals(m.group(2))) {
            lat = -Math.abs(lat);
        }
        if ("W".equals(m.group(4))) {
            lng = -Math.abs(lng);
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return null;
        }
        return new Point(lat, lng);
    }

    /**
     * Folds one fabric refresh into the circuit history: active circuits are live, vanished ones are
     * marked ended, and ended ones older than {@code windowMs} are dropped.
     */
    public static Map<String, SeenCircuit> mergeCircuitHistory(Map<String, SeenCircuit> prev,
            List<MapCircuit> active, long now, long windowMs) {
        Map<String, SeenCircuit> next = new LinkedHashMap<>();
        for (MapCircuit c : active) {
            next.put(c.id(), new SeenCircuit(c, now, null));
        }
        for (Map.Entry<String, SeenCircuit> e : prev.entrySet()) {
            if (next.containsKey(e.getKey())) {
                continue;
            }
            long ended = e.getValue().endedBy() != null ? e.getValue().endedBy() : now;
            if (now - ended <= windowMs) {
                next.put(e.getKey(), new SeenCircuit(e.getValue().circuit(), e.getValue().lastSeen(), ended));
            }
        }
        return next;
    }

    /** "12s", "5m", "2h 3m", "4d"; empty when unknown. */
    public static String age(long fromMs, long nowMs) {
        long s = Math.max(0, Math.round((nowMs - fromMs) / 1000.0));
        if (s < 60) {
            return s + "s";
        }
        if (s < 3600) {
            return (s / 60) + "m";
        }
        if (s < 86400) {
            return (s / 3600) + "h " + ((s % 3600) / 60) + "m";
        }
        return (s / 86400) + "d";
    }

    public static Set<String> idSet(MapCircuit c) {
        return c == null ? Set.of() : new LinkedHashSet<>(c.hops());
    }
}
