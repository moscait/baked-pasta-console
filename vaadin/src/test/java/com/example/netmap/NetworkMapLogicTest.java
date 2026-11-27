package com.example.netmap;

import static com.example.netmap.NetworkMapLogic.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

import com.example.ziti.Json;

/** Port of the web console's network-map.logic and ip-geolocation specs. */
class NetworkMapLogicTest {

    @Test
    void geolocationTags() {
        assertEquals(new Point(39.04, -77.49), parseGeolocation("39.04,-77.49"));
        assertEquals(new Point(51.5, -0.12), parseGeolocation(" 51.5 , -0.12 "));
        for (Object bad : Arrays.asList(null, 42, "", "39.04", "1,2,3", "abc,def", "91,0", "0,181", "1e3,2", "0x10,0")) {
            assertNull(parseGeolocation(bad), String.valueOf(bad));
        }
        assertEquals("39.04376,-77.48744", formatGeolocation(new Point(39.043756, -77.487442)));
        assertEquals("10.00000,-170.00000", formatGeolocation(new Point(10, 190)));
        assertEquals("90.00000,-180.00000", formatGeolocation(new Point(95, -540)));
        Point p = new Point(-33.86882, 151.20929);
        assertEquals(p, parseGeolocation(formatGeolocation(p)));
    }

    @Test
    void circuitsPreferEdgeTagsThenFallBack() {
        MapCircuit c = normalizeCircuit(Json.map("id", "c1", "clientId", "conn-123", "service",
                Json.map("id", "s1", "name", "crm"), "tags", Json.map("clientId", "id-alice", "hostId", "id-crm-host"),
                "path", Json.map("nodes", List.of(Json.map("id", "r1"), "r2"), "links", List.of("l1"))));
        assertEquals("id-alice", c.clientId());
        assertEquals("id-crm-host", c.hostId());
        assertEquals("crm", c.serviceName());
        assertEquals(List.of("r1", "r2"), c.routerIds());
        assertEquals(List.of("l1"), c.linkIds());

        MapCircuit c2 = normalizeCircuit(Json.map("id", "c2", "serviceId", "s2", "terminatorId", "t1"),
                Map.of("t1", "id-host"), Map.of("s2", "devbox-ssh"));
        assertEquals("id-host", c2.hostId());
        assertEquals("devbox-ssh", c2.serviceName());
        assertNull(c2.clientId());
        assertEquals(List.of(), c2.routerIds());
    }

    @Test
    void links() {
        MapLink l = normalizeLink(Json.map("id", "l1", "sourceRouter", Json.map("id", "a"), "destRouter",
                Json.map("id", "b"), "state", "Connected", "sourceLatency", 12_340_000, "destLatency", 61_000_000));
        assertEquals(61.0, l.latencyMs());
        assertEquals("warn", l.level());
        assertTrue(l.up());
        assertEquals("bad", normalizeLink(Json.map("id", "l2", "sourceRouterId", "a", "destRouterId", "b", "down", true)).level());
        assertNull(normalizeLink(Json.map("id", "l3", "sourceRouterId", "a")));
        assertEquals("unknown", latencyLevel(null));
        assertEquals("good", latencyLevel(49.9));
        assertEquals("warn", latencyLevel(100.0));
        assertEquals("bad", latencyLevel(100.1));
    }

    private static MapNode node(String id, Point p) {
        return new MapNode(id, id.toUpperCase(), "edge-router", true, p, null, List.of(), Map.of());
    }

    @Test
    void circuitPathsAndLoad() {
        Map<String, MapNode> nodes = new HashMap<>();
        nodes.put("alice", node("alice", new Point(1, 1)));
        nodes.put("r1", node("r1", new Point(2, 2)));
        nodes.put("r2", node("r2", null));
        nodes.put("host", node("host", new Point(3, 3)));
        MapCircuit circuit = normalizeCircuit(Json.map("id", "c", "tags", Json.map("clientId", "alice", "hostId", "host"),
                "path", Json.map("nodes", List.of("r1", "r2"))));
        CircuitPath p = circuitPath(circuit, nodes);
        assertEquals(List.of(new Point(1, 1), new Point(2, 2), new Point(3, 3)), p.points());
        assertEquals(List.of(new Hop("r2", "R2")), p.missing());

        MapCircuit c2 = new MapCircuit("c2", circuit.serviceId(), circuit.serviceName(), "alice", "host",
                List.of("r1", "r1"), List.of(), null);
        Map<String, Integer> load = circuitLoad(List.of(circuit, c2));
        assertEquals(2, load.get("r1"));
        assertEquals(2, load.get("alice"));
        assertEquals(1, load.get("r2"));
    }

    private static MapCircuit c(String id, String client, String host, List<String> routers) {
        return new MapCircuit(id, "s", "s", client, host, routers, List.of(), null);
    }

    @Test
    void approximateLocations() {
        Map<String, String> via = circuitRouters(List.of(c("c1", "alice", "host", List.of("r-in", "r-core", "r-out"))));
        assertEquals("r-in", via.get("alice"));
        assertEquals("r-out", via.get("host"));
        via = circuitRouters(List.of(c("new", "alice", null, List.of("r-new")), c("old", "alice", null, List.of("r-old")),
                c("none", "bob", null, List.of())));
        assertEquals("r-new", via.get("alice"));
        assertFalse(via.containsKey("bob"));
    }

    @Test
    void spreading() {
        Point at = new Point(10, 20);
        assertEquals(List.of(0, 0), box(spreadOffsets(List.of(new SpreadItem("a", at, false))).get("a")));
        Map<String, int[]> off = spreadOffsets(List.of(new SpreadItem("i1", at, false),
                new SpreadItem("router", new Point(10.000001, 20), true), new SpreadItem("i2", at, false)));
        assertEquals(List.of(0, 0), box(off.get("router")));
        assertEquals(List.of(0, -SPREAD_PX), box(off.get("i1")));
        assertEquals(List.of(0, SPREAD_PX), box(off.get("i2")));
        off = spreadOffsets(List.of(new SpreadItem("a", at, false), new SpreadItem("b", at, false),
                new SpreadItem("far", new Point(-10, 20), false)));
        assertNotEquals(box(off.get("a")), box(off.get("b")));
        assertEquals(List.of(0, 0), box(off.get("far")));
        List<SpreadItem> many = IntStream.range(0, 20).mapToObj(i -> new SpreadItem("n" + i, at, false)).toList();
        Map<String, int[]> big = spreadOffsets(many);
        int[] a = big.get("n0");
        int[] b = big.get("n1");
        assertTrue(Math.hypot(b[0] - a[0], b[1] - a[1]) >= SPREAD_PX - 1);
    }

    private static List<Integer> box(int[] v) {
        return List.of(v[0], v[1]);
    }

    @Test
    void locationFilterAndTypedCoordinates() {
        List<String> attrs = List.of("nyc-office", "sales");
        assertTrue(matchesLocationQuery("Alice-MacBook", attrs, "macbook"));
        assertFalse(matchesLocationQuery("Alice-MacBook", attrs, "bob"));
        assertTrue(matchesLocationQuery("Alice-MacBook", attrs, "  "));
        assertTrue(matchesLocationQuery("Alice-MacBook", attrs, "#nyc"));
        assertFalse(matchesLocationQuery("Alice-MacBook", attrs, "#alice"));

        assertEquals(new Point(39.04, -77.48), parseCoordinates("39.04, -77.48"));
        assertEquals(new Point(39.04, -77.48), parseCoordinates("39.04 -77.48"));
        assertEquals(new Point(-33.87, 151.21), parseCoordinates("33.87°S 151.21°E"));
        assertEquals(new Point(39.04, -77.48), parseCoordinates("39.04N, 77.48W"));
        for (String t : List.of("Ashburn, VA", "Paris", "95, 10", "10, 200", "1,2,3", "")) {
            assertNull(parseCoordinates(t), t);
        }
    }

    @Test
    void circuitHistory() {
        MapCircuit x = c("x", "a", "b", List.of("r"));
        MapCircuit y = c("y", "a", "b", List.of("r"));
        Map<String, SeenCircuit> h = mergeCircuitHistory(Map.of(), List.of(x, y), 1000, RECENT_CIRCUIT_MS);
        h = mergeCircuitHistory(h, List.of(y), 6000, RECENT_CIRCUIT_MS);
        assertEquals(1000, h.get("x").lastSeen());
        assertEquals(6000L, h.get("x").endedBy());
        assertEquals(6000, h.get("y").lastSeen());
        assertNull(h.get("y").endedBy());

        h = mergeCircuitHistory(Map.of(), List.of(x), 0, 60000);
        h = mergeCircuitHistory(h, List.of(), 5000, 60000);
        h = mergeCircuitHistory(h, List.of(), 30000, 60000);
        assertEquals(5000L, h.get("x").endedBy());
        h = mergeCircuitHistory(h, List.of(), 65001, 60000);
        assertFalse(h.containsKey("x"));

        h = mergeCircuitHistory(Map.of(), List.of(x), 0, RECENT_CIRCUIT_MS);
        h = mergeCircuitHistory(h, List.of(), 5000, RECENT_CIRCUIT_MS);
        h = mergeCircuitHistory(h, List.of(x), 10000, RECENT_CIRCUIT_MS);
        assertEquals(10000, h.get("x").lastSeen());
        assertNull(h.get("x").endedBy());
    }

    @Test
    void ipTruncation() {
        for (String ip : List.of("81.2.69.142", "81.2.69.142:51234", "::ffff:81.2.69.142")) {
            assertEquals("81.2.69.0", GeoLookup.truncateIp(ip, false).prefix(), ip);
        }
        assertEquals("2a00:1450:4009::", GeoLookup.truncateIp("2a00:1450:4009:81f::200e", false).prefix());
        assertEquals("2a00:1450:4009::", GeoLookup.truncateIp("[2a00:1450:4009:81f::200e]:443", false).prefix());
        List<String> nonPublic = new ArrayList<>(List.of("10.1.2.3", "172.20.0.1", "192.168.1.9", "127.0.0.1",
                "100.72.0.5", "169.254.1.1", "0.0.0.0", "198.51.100.42", "203.0.113.9", "192.0.2.1", "::1",
                "fd12:3456::1", "fe80::1", "2001:db8::1"));
        for (String ip : nonPublic) {
            assertEquals("non-public", GeoLookup.truncateIp(ip, false).skip(), ip);
        }
        assertEquals("198.51.100.0", GeoLookup.truncateIp("198.51.100.42", true).prefix());
        assertEquals("non-public", GeoLookup.truncateIp("10.1.2.3", true).skip());
        for (String ip : List.of("", "localhost", "1.2.3", "256.1.1.1", "1:2:3", "1::2::3")) {
            assertEquals("invalid", GeoLookup.truncateIp(ip, false).skip(), ip);
        }
    }
}
