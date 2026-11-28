package io.moscait.bpc.canvas;

import static io.moscait.bpc.canvas.AccessLogic.dialFor;
import static io.moscait.bpc.canvas.AccessLogic.hostsFor;
import static io.moscait.bpc.canvas.AccessLogic.identityRouters;
import static io.moscait.bpc.canvas.AccessLogic.isHost;
import static io.moscait.bpc.canvas.AccessLogic.matches;
import static io.moscait.bpc.canvas.AccessLogic.serviceRouters;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import io.moscait.bpc.canvas.AcModel.AcEntity;
import io.moscait.bpc.canvas.AcModel.AcIdentity;
import io.moscait.bpc.canvas.AcModel.AcKind;
import io.moscait.bpc.canvas.AcModel.AcLayout;
import io.moscait.bpc.canvas.AcModel.AcNewIdentity;
import io.moscait.bpc.canvas.AcModel.AcNewService;
import io.moscait.bpc.canvas.AcModel.AcOp;
import io.moscait.bpc.canvas.AcModel.AcService;
import io.moscait.bpc.canvas.AcModel.AddAttr;
import io.moscait.bpc.canvas.AcModel.AddIdentityRole;
import io.moscait.bpc.canvas.AcModel.CreateErPolicy;
import io.moscait.bpc.canvas.AcModel.CreateIdentity;
import io.moscait.bpc.canvas.AcModel.CreatePolicy;
import io.moscait.bpc.canvas.AcModel.CreateSerp;
import io.moscait.bpc.canvas.AcModel.CreateService;
import io.moscait.bpc.canvas.AcModel.RemoveAttr;
import io.moscait.bpc.sessions.IpFilter;

/**
 * Logic for the free-form Access Canvas board: which boxes exist, how policies connect them,
 * where they sit, what is filtered out, what looks broken, and what a cut/copy/paste or drag
 * means as API changes.
 */
public final class BoardLogic {

    private BoardLogic() {
    }

    // ------------------------------------------------------------------ types

    public static final class BoardMember {
        public AcKind kind;
        public String id;
        public String name;
        public List<String> problems;
        public boolean pending;
        public boolean hit;
        public List<String> ips;
        public Integer liveSessions;
        public String concurrentSeverity;
    }

    public record PolicyInfo(String id, String name, String family, String semantic, List<String> posture,
            List<String> all) {
    }

    public static final class BoardNode {
        public String key;
        /** "group", "free" or "hub". */
        public String type;
        public AcKind kind;
        public String attr;
        public BoardMember entity;
        public PolicyInfo policy;
        public List<BoardMember> members = new ArrayList<>();
        public List<BoardMember> shown = new ArrayList<>();
        public int more;
        public int x;
        public int y;
        public int w;
        public int h;
        public List<String> problems = new ArrayList<>();
        public int problemCount;
        public boolean pending;
        public boolean hit;
        public boolean dim;
    }

    public record Anchor(String node, String member) {
        static Anchor of(String node) {
            return new Anchor(node, null);
        }
    }

    public record BoardEdge(String id, String family, String policy, Anchor from, Anchor to, boolean pending,
            boolean byName) {
    }

    public static final class BoardFilters {
        public Map<AcKind, Boolean> types = new LinkedHashMap<>(
                Map.of(AcKind.IDENTITY, true, AcKind.SERVICE, true, AcKind.ROUTER, true));
        public List<String> attrs = new ArrayList<>();
        public String search = "";
        public boolean problemsOnly;
        public String ipFilter = "";
        public boolean activeSessionsOnly;
        public boolean concurrentOnly;

        public static BoardFilters showEverything() {
            return new BoardFilters();
        }

        public boolean type(AcKind k) {
            return Boolean.TRUE.equals(types.get(k));
        }
    }

    public static final class BoardMarks {
        public Set<String> attrs = new HashSet<>();
        public Set<String> policies = new HashSet<>();
        public Set<String> roles = new HashSet<>();
        public Set<String> created = new HashSet<>();
    }

    public record Board(List<BoardNode> nodes, List<BoardEdge> edges) {
    }

    // ------------------------------------------------------------------ keys and geometry

    public static String groupKey(AcKind kind, String attr) {
        return "g:" + kind.one + ":" + attr;
    }

    public static String freeKey(AcKind kind, String id) {
        return "e:" + kind.one + ":" + id;
    }

    public static String hubKey(String family, String id) {
        return "p:" + family + ":" + id;
    }

    public static final int GROUP_W = 240;
    public static final int HEADER_H = 38;
    public static final int ROW_H = 26;
    public static final int PAD_B = 8;
    public static final int MORE_H = 26;
    public static final int MAX_ROWS = 8;
    public static final int FREE_W = 200;
    public static final int FREE_H = 40;
    public static final int HUB_H = 26;
    public static final int HUB_MIN_W = 80;
    public static final int HUB_MAX_W = 260;
    public static final int COL_GAP = 140;
    public static final int ROW_GAP = 28;

    public static int groupHeight(int shown, boolean more) {
        return HEADER_H + Math.max(1, shown) * ROW_H + (more ? MORE_H : 0) + PAD_B;
    }

    public static int hubWidth(String name) {
        return Math.max(HUB_MIN_W, Math.min(HUB_MAX_W, 34 + name.length() * 7));
    }

    // ------------------------------------------------------------------ problems

    public static List<String> entityProblems(AcModel m, AcKind kind, String id) {
        List<String> out = new ArrayList<>();
        switch (kind) {
            case IDENTITY -> {
                AcIdentity i = m.identities.stream().filter(x -> x.id.equals(id)).findFirst().orElse(null);
                if (i == null || i.isAdmin) {
                    return out;
                }
                if (!i.enrolled) {
                    out.add("Not enrolled");
                }
                boolean host = isHost(m, i);
                boolean dials = m.services.stream().anyMatch(s -> !dialFor(m, i, s).isEmpty());
                if ((host || dials) && identityRouters(m, i).isEmpty()) {
                    out.add("No edge router policy");
                }
                if (host && i.enrolled && !i.online) {
                    out.add("Hosting identity is offline");
                }
            }
            case SERVICE -> {
                AcService s = m.services.stream().filter(x -> x.id.equals(id)).findFirst().orElse(null);
                if (s == null) {
                    return out;
                }
                List<AcIdentity> hs = hostsFor(m, s);
                if (hs.isEmpty()) {
                    out.add("Not hosted");
                } else if (hs.stream().noneMatch(h -> h.enrolled)) {
                    out.add("Host not enrolled");
                }
                if (serviceRouters(m, s).isEmpty()) {
                    out.add("No service edge router policy");
                }
                if (m.identities.stream().noneMatch(i -> !i.isAdmin && !dialFor(m, i, s).isEmpty())) {
                    out.add("Nobody can use it");
                }
            }
            case ROUTER -> m.routers.stream().filter(x -> x.id.equals(id)).findFirst().ifPresent(r -> {
                if (!r.online) {
                    out.add("Offline");
                }
            });
        }
        return out;
    }

    // ------------------------------------------------------------------ roles

    static AcKind[] roleKinds(String family) {
        return switch (family) {
            case "dial", "bind" -> new AcKind[] { AcKind.IDENTITY, AcKind.SERVICE };
            case "erp" -> new AcKind[] { AcKind.IDENTITY, AcKind.ROUTER };
            default -> new AcKind[] { AcKind.SERVICE, AcKind.ROUTER };
        };
    }

    private record PolicyView(String id, String name, String family, String semantic, List<String> posture,
            List<String> left, List<String> right) {
    }

    private static List<PolicyView> policies(AcModel m) {
        List<PolicyView> out = new ArrayList<>();
        m.servicePolicies.forEach(p -> out.add(new PolicyView(p.id, p.name, p.isDial() ? "dial" : "bind", p.semantic,
                p.posture, p.identityRoles, p.serviceRoles)));
        m.erPolicies.forEach(p -> out.add(new PolicyView(p.id, p.name, "erp", p.semantic, List.of(), p.identityRoles,
                p.routerRoles)));
        m.serps.forEach(p -> out.add(new PolicyView(p.id, p.name, "serp", p.semantic, List.of(), p.serviceRoles,
                p.routerRoles)));
        return out;
    }

    private static List<? extends AcEntity> drawn(AcModel m, AcKind kind) {
        return kind == AcKind.IDENTITY ? m.identities.stream().filter(i -> !i.isAdmin).toList() : m.entitiesOf(kind);
    }

    // ------------------------------------------------------------------ build

    public static Board buildBoard(AcModel m, AcLayout layout, BoardFilters filters, BoardMarks marks,
            Set<String> expanded) {
        String q = filters.search.trim().toLowerCase().replaceFirst("^[#@]", "");
        Predicate<String> hitText = s -> !q.isEmpty() && s.toLowerCase().contains(q);
        Map<String, BoardNode> nodes = new LinkedHashMap<>();

        java.util.function.BiFunction<AcKind, AcEntity, BoardMember> memberFor = (kind, e) -> {
            BoardMember mb = new BoardMember();
            AcIdentity ident = kind == AcKind.IDENTITY && e instanceof AcIdentity ai ? ai : null;
            mb.kind = kind;
            mb.id = e.id;
            mb.name = e.name;
            mb.problems = entityProblems(m, kind, e.id);
            mb.ips = ident == null ? null : ident.sessionIps;
            mb.hit = hitText.test(e.name) || (mb.ips != null && mb.ips.stream().anyMatch(hitText));
            mb.liveSessions = ident == null ? null : ident.liveSessionCount;
            mb.concurrentSeverity = ident == null || ident.concurrency == null ? null : ident.concurrency.severity();
            return mb;
        };

        java.util.function.BiFunction<AcKind, String, BoardNode> ensureGroup = (kind, attr) -> nodes
                .computeIfAbsent(groupKey(kind, attr), key -> {
                    BoardNode n = new BoardNode();
                    n.key = key;
                    n.type = "group";
                    n.kind = kind;
                    n.attr = attr;
                    n.w = GROUP_W;
                    n.hit = hitText.test(attr);
                    return n;
                });

        for (AcKind kind : AcKind.values()) {
            for (AcEntity e : drawn(m, kind)) {
                if (e.attrs.isEmpty()) {
                    BoardMember ent = memberFor.apply(kind, e);
                    BoardNode n = new BoardNode();
                    n.key = freeKey(kind, e.id);
                    n.type = "free";
                    n.kind = kind;
                    n.entity = ent;
                    n.w = FREE_W;
                    n.h = FREE_H;
                    n.problems = ent.problems;
                    n.problemCount = ent.problems.size();
                    n.pending = marks.created.contains(e.id);
                    n.hit = ent.hit;
                    nodes.put(n.key, n);
                    continue;
                }
                for (String a : e.attrs) {
                    BoardMember mb = memberFor.apply(kind, e);
                    mb.pending = marks.attrs.contains(kind.one + ":" + e.id + ":" + a) || marks.created.contains(e.id);
                    ensureGroup.apply(kind, a).members.add(mb);
                }
            }
        }

        List<PolicyView> pols = policies(m);
        for (PolicyView p : pols) {
            AcKind[] rk = roleKinds(p.family);
            for (String r : p.left) {
                if (r.startsWith("#") && !r.equals("#all")) {
                    ensureGroup.apply(rk[0], r.substring(1));
                }
            }
            for (String r : p.right) {
                if (r.startsWith("#") && !r.equals("#all")) {
                    ensureGroup.apply(rk[1], r.substring(1));
                }
            }
        }
        for (String g : layout.groups) {
            int i = g.indexOf(':');
            if (i < 0) {
                continue;
            }
            String kindId = g.substring(0, i);
            if (List.of("identity", "service", "router").contains(kindId)) {
                ensureGroup.apply(AcKind.of(kindId), g.substring(i + 1));
            }
        }

        List<BoardEdge> edges = new ArrayList<>();
        for (PolicyView p : pols) {
            String key = hubKey(p.family, p.id);
            AcKind[] rk = roleKinds(p.family);
            List<String> all = new ArrayList<>();
            List<String> problems = new ArrayList<>();
            boolean pend = marks.policies.contains(p.id);
            for (int side = 0; side < 2; side++) {
                boolean left = side == 0;
                List<String> roles = left ? p.left : p.right;
                AcKind kind = rk[side];
                for (String r : roles) {
                    if (r.equals("#all")) {
                        all.add("all " + kind.many);
                        continue;
                    }
                    Anchor a = anchorFor(m, kind, r);
                    if (a == null) {
                        problems.add(r.startsWith("@") ? "Names a missing " + kind.one + ": " + r : "Role not understood: " + r);
                        continue;
                    }
                    edges.add(new BoardEdge(key + "|" + (left ? "L" : "R") + "|" + r, p.family, p.id,
                            left ? a : Anchor.of(key), left ? Anchor.of(key) : a,
                            pend || marks.roles.contains(p.id + ":" + r), r.startsWith("@")));
                }
                long sel = drawn(m, kind).stream().filter(x -> matches(x, roles, p.semantic)).count();
                if (!roles.isEmpty() && sel == 0) {
                    String want = String.join("AllOf".equals(p.semantic) ? " and " : " or ", roles);
                    problems.add("Selects no " + kind.many + ": none has " + want);
                }
            }
            BoardNode n = new BoardNode();
            n.key = key;
            n.type = "hub";
            n.policy = new PolicyInfo(p.id, p.name, p.family, p.semantic, p.posture, all);
            n.w = hubWidth(p.name);
            n.h = HUB_H;
            n.problems = new ArrayList<>(new LinkedHashSet<>(problems));
            n.problemCount = n.problems.size();
            n.pending = pend;
            n.hit = hitText.test(p.name);
            nodes.put(key, n);
        }

        String ipExpr = filters.ipFilter == null ? "" : filters.ipFilter.trim();
        String effIp = ipExpr.isEmpty() || IpFilter.isValid(ipExpr) ? ipExpr : "";
        boolean traffic = !effIp.isEmpty() || filters.concurrentOnly || filters.activeSessionsOnly;
        Predicate<BoardMember> memberMatchesTraffic = mb -> {
            if (mb.kind != AcKind.IDENTITY) {
                return false;
            }
            if (!effIp.isEmpty() && (mb.ips == null || mb.ips.stream().noneMatch(ip -> IpFilter.matches(ip, effIp)))) {
                return false;
            }
            if (filters.concurrentOnly && mb.concurrentSeverity == null) {
                return false;
            }
            if (filters.activeSessionsOnly && !(mb.liveSessions != null && mb.liveSessions > 0)) {
                return false;
            }
            return traffic;
        };

        for (BoardNode n : nodes.values()) {
            if (!n.type.equals("group")) {
                continue;
            }
            n.members.sort(Comparator.comparing(x -> x.name));
            boolean isExpanded = expanded.contains(n.key);
            boolean bySearch = !q.isEmpty() && !n.hit && !isExpanded && n.members.stream().anyMatch(x -> x.hit);
            boolean byTraffic = !bySearch && !isExpanded && traffic && n.members.stream().anyMatch(memberMatchesTraffic);
            n.shown = bySearch ? n.members.stream().filter(x -> x.hit).toList()
                    : byTraffic ? n.members.stream().filter(memberMatchesTraffic).toList()
                            : isExpanded ? n.members : n.members.subList(0, Math.min(MAX_ROWS, n.members.size()));
            n.shown = new ArrayList<>(n.shown);
            n.more = n.members.size() - n.shown.size();
            n.h = groupHeight(n.shown.size(), n.more > 0);
            long bad = n.members.stream().filter(x -> !x.problems.isEmpty()).count();
            n.problemCount = (int) bad;
            n.problems = bad > 0 ? List.of(bad + " of " + n.members.size() + " with problems") : List.of();
            n.pending = n.members.stream().anyMatch(x -> x.pending)
                    || (layout.groups.contains(n.kind.one + ":" + n.attr) && n.members.isEmpty());
            if (bySearch) {
                n.hit = true;
            }
        }

        List<BoardNode> allNodes = new ArrayList<>(nodes.values());
        placeNodes(m, allNodes, edges, layout);
        applyFilters(allNodes, edges, filters);
        return new Board(allNodes, edges);
    }

    private static Anchor anchorFor(AcModel m, AcKind kind, String role) {
        if (role.startsWith("#")) {
            return Anchor.of(groupKey(kind, role.substring(1)));
        }
        if (!role.startsWith("@")) {
            return null;
        }
        String ref = role.substring(1);
        AcEntity e = drawn(m, kind).stream().filter(x -> x.id.equals(ref) || x.name.equals(ref)).findFirst().orElse(null);
        if (e == null) {
            return null;
        }
        if (e.attrs.isEmpty()) {
            return Anchor.of(freeKey(kind, e.id));
        }
        return new Anchor(groupKey(kind, e.attrs.stream().sorted().findFirst().orElseThrow()), e.id);
    }

    // ------------------------------------------------------------------ filters

    public static void applyFilters(List<BoardNode> nodes, List<BoardEdge> edges, BoardFilters f) {
        Map<String, BoardNode> byKey = new HashMap<>();
        nodes.forEach(n -> byKey.put(n.key, n));
        Predicate<BoardNode> typeOk = n -> n.type.equals("hub")
                ? java.util.Arrays.stream(roleKinds(n.policy.family())).allMatch(f::type)
                : f.type(n.kind);
        Set<String> visible = nodes.stream().filter(typeOk).map(n -> n.key).collect(Collectors.toCollection(HashSet::new));

        java.util.function.Function<Set<String>, Set<String>> neighbours = keys -> {
            Set<String> out = new HashSet<>(keys);
            Set<String> hubs = new HashSet<>();
            for (BoardEdge e : edges) {
                List<String> ends = List.of(e.from().node(), e.to().node());
                if (ends.stream().anyMatch(keys::contains)) {
                    for (String x : ends) {
                        BoardNode bn = byKey.get(x);
                        if (bn != null && bn.type.equals("hub")) {
                            hubs.add(x);
                        }
                    }
                }
            }
            for (String k : keys) {
                BoardNode bn = byKey.get(k);
                if (bn != null && bn.type.equals("hub")) {
                    hubs.add(k);
                }
            }
            for (BoardEdge e : edges) {
                if (hubs.contains(e.from().node()) || hubs.contains(e.to().node())) {
                    out.add(e.from().node());
                    out.add(e.to().node());
                }
            }
            out.addAll(hubs);
            return out;
        };

        String raw = f.ipFilter == null ? "" : f.ipFilter.trim();
        String ipExpr = raw.isEmpty() || IpFilter.isValid(raw) ? raw : "";
        boolean hasTraffic = !ipExpr.isEmpty() || f.activeSessionsOnly || f.concurrentOnly;
        Predicate<BoardMember> trafficMatch = mb -> {
            if (mb.kind != AcKind.IDENTITY) {
                return false;
            }
            if (f.concurrentOnly && mb.concurrentSeverity == null) {
                return false;
            }
            if (f.activeSessionsOnly && !(mb.liveSessions != null && mb.liveSessions > 0)
                    && !(mb.ips != null && !mb.ips.isEmpty())) {
                return false;
            }
            return ipExpr.isEmpty() || (mb.ips != null && mb.ips.stream().anyMatch(ip -> IpFilter.matches(ip, ipExpr)));
        };

        Set<String> trafficSeed = null;
        if (hasTraffic) {
            trafficSeed = new HashSet<>();
            for (BoardNode n : nodes) {
                if (n.type.equals("group") && n.kind == AcKind.IDENTITY) {
                    boolean matched = false;
                    for (BoardMember mb : n.members) {
                        if (trafficMatch.test(mb)) {
                            mb.hit = true;
                            matched = true;
                        }
                    }
                    if (matched) {
                        trafficSeed.add(n.key);
                    }
                } else if (n.type.equals("free") && n.kind == AcKind.IDENTITY && n.entity != null
                        && trafficMatch.test(n.entity)) {
                    n.entity.hit = true;
                    n.hit = true;
                    trafficSeed.add(n.key);
                }
            }
        }
        Set<String> attrSeed = f.attrs.isEmpty() ? null
                : nodes.stream().filter(n -> n.type.equals("group") && f.attrs.contains(n.attr)).map(n -> n.key)
                        .collect(Collectors.toSet());
        Set<String> probSeed = f.problemsOnly
                ? nodes.stream().filter(n -> n.problemCount > 0).map(n -> n.key).collect(Collectors.toSet())
                : null;
        Set<String> nameSeed = f.search.trim().isEmpty() ? null
                : nodes.stream().filter(n -> n.hit).map(n -> n.key).collect(Collectors.toSet());
        List<Set<String>> seeds = new ArrayList<>();
        seeds.add(attrSeed);
        seeds.add(probSeed);
        seeds.add(nameSeed);
        seeds.add(trafficSeed);
        for (Set<String> seed : seeds) {
            if (seed == null) {
                continue;
            }
            Set<String> keep = neighbours.apply(seed);
            visible.retainAll(keep);
            for (BoardNode n : nodes) {
                if (keep.contains(n.key) && !seed.contains(n.key)) {
                    n.dim = true;
                }
            }
        }
        for (BoardNode n : nodes) {
            if (!n.type.equals("hub") || !visible.contains(n.key)) {
                continue;
            }
            boolean anySide = edges.stream().filter(e -> e.policy().equals(n.policy.id()))
                    .map(e -> e.to().node().equals(n.key) ? e.from().node() : e.to().node())
                    .anyMatch(visible::contains);
            if (!anySide && n.policy.all().isEmpty()) {
                visible.remove(n.key);
            }
        }
        nodes.removeIf(n -> !visible.contains(n.key));
        edges.removeIf(e -> !visible.contains(e.from().node()) || !visible.contains(e.to().node()));
    }

    // ------------------------------------------------------------------ placement

    public static void placeNodes(AcModel m, List<BoardNode> nodes, List<BoardEdge> edges, AcLayout layout) {
        Map<String, int[]> saved = layout.nodes;
        Map<String, BoardNode> byKey = new HashMap<>();
        nodes.forEach(n -> byKey.put(n.key, n));
        java.util.function.ToIntFunction<BoardNode> col = n -> {
            if (n.type.equals("hub")) {
                return switch (n.policy.family()) {
                    case "dial" -> 1;
                    case "bind" -> 3;
                    case "erp" -> 6;
                    default -> 7;
                };
            }
            if (n.kind == AcKind.SERVICE) {
                return 2;
            }
            if (n.kind == AcKind.ROUTER) {
                return 8;
            }
            List<String> ids = n.type.equals("group") ? n.members.stream().map(x -> x.id).toList() : List.of(n.entity.id);
            List<AcIdentity> list = ids.stream()
                    .map(id -> m.identities.stream().filter(i -> i.id.equals(id)).findFirst().orElse(null))
                    .filter(Objects::nonNull).toList();
            if (list.isEmpty() && n.type.equals("group")) {
                String role = "#" + n.attr;
                boolean bind = m.servicePolicies.stream().anyMatch(p -> !p.isDial() && p.identityRoles.contains(role));
                boolean dial = m.servicePolicies.stream().anyMatch(p -> p.isDial() && p.identityRoles.contains(role));
                return bind && !dial ? 4 : 0;
            }
            boolean hostOnly = !list.isEmpty() && list.stream()
                    .allMatch(i -> isHost(m, i) && m.services.stream().noneMatch(s -> !dialFor(m, i, s).isEmpty()));
            return hostOnly ? 4 : 0;
        };
        int step = GROUP_W + COL_GAP;
        Map<Integer, Integer> colX = Map.of(0, 0, 1, step, 2, step * 2, 3, step * 3, 4, step * 4);
        List<BoardNode> fixed = nodes.stream().filter(n -> saved.containsKey(n.key)).toList();
        for (BoardNode n : fixed) {
            n.x = saved.get(n.key)[0];
            n.y = saved.get(n.key)[1];
        }
        Comparator<BoardNode> sortKey = Comparator.comparing(n -> (n.type.equals("group") ? n.attr
                : n.type.equals("free") ? "~" + n.entity.name : n.policy.name()).toLowerCase());
        List<BoardNode> loose = nodes.stream().filter(n -> !saved.containsKey(n.key)).sorted(sortKey).toList();
        for (int c : new int[] { 0, 2, 4 }) {
            int x0 = colX.get(c);
            int x1 = x0 + GROUP_W;
            int nextY = fixed.stream().filter(n -> n.x < x1 && n.x + n.w > x0).mapToInt(n -> n.y + n.h + ROW_GAP)
                    .max().orElse(0);
            nextY = Math.max(0, nextY);
            for (BoardNode n : loose) {
                if (!n.type.equals("hub") && col.applyAsInt(n) == c) {
                    n.x = x0;
                    n.y = nextY;
                    nextY += n.h + ROW_GAP;
                }
            }
        }
        int placedBottom = Math.max(0, nodes.stream().filter(n -> !n.type.equals("hub") && col.applyAsInt(n) != 8)
                .mapToInt(n -> n.y + n.h).max().orElse(0));
        int routerBandY = placedBottom + 160;
        int rx = 0;
        for (BoardNode n : loose) {
            if (!n.type.equals("hub") && col.applyAsInt(n) == 8) {
                n.x = rx;
                n.y = routerBandY + 120;
                rx += n.w + COL_GAP / 2;
            }
        }
        Map<String, List<Double>> lanes = new HashMap<>();
        for (BoardNode n : loose) {
            if (!n.type.equals("hub")) {
                continue;
            }
            List<double[]> pts = new ArrayList<>();
            for (BoardEdge e : edges) {
                if (!e.policy().equals(n.policy.id())) {
                    continue;
                }
                Anchor other = e.from().node().equals(n.key) ? e.to() : e.from();
                BoardNode t = byKey.get(other.node());
                if (t != null) {
                    pts.add(new double[] { t.x + t.w / 2.0, t.y + Math.min(t.h / 2.0, 60) });
                }
            }
            String fam = n.policy.family();
            double x;
            double y;
            if (!pts.isEmpty()) {
                x = pts.stream().mapToDouble(p -> p[0]).average().orElse(0) - n.w / 2.0;
                y = pts.stream().mapToDouble(p -> p[1]).average().orElse(0) - n.h / 2.0;
            } else {
                x = colX.getOrDefault(col.applyAsInt(n), 0);
                y = fam.equals("erp") || fam.equals("serp") ? routerBandY : 0;
            }
            if (fam.equals("dial")) {
                x = colX.get(1) + (GROUP_W - n.w) / 2.0;
            }
            if (fam.equals("bind")) {
                x = colX.get(3) + (GROUP_W - n.w) / 2.0;
            }
            if (fam.equals("erp") || fam.equals("serp")) {
                y = routerBandY + (fam.equals("serp") ? 40 : 0);
            }
            String lane = fam + ":" + Math.round(x / 50);
            List<Double> taken = lanes.computeIfAbsent(lane, k -> new ArrayList<>());
            final double[] yy = { y };
            while (taken.stream().anyMatch(t -> Math.abs(t - yy[0]) < HUB_H + 8)) {
                yy[0] += HUB_H + 8;
            }
            taken.add(yy[0]);
            n.x = (int) Math.round(x);
            n.y = (int) Math.round(yy[0]);
        }
    }

    // ------------------------------------------------------------------ edge geometry

    public record Rect(double x, double y, double w, double h) {
    }

    public static Rect anchorRect(Map<String, BoardNode> nodes, Anchor a) {
        BoardNode n = nodes.get(a.node());
        if (n == null) {
            return null;
        }
        if (n.type.equals("group") && a.member() != null) {
            for (int i = 0; i < n.shown.size(); i++) {
                if (n.shown.get(i).id.equals(a.member())) {
                    return new Rect(n.x, n.y + HEADER_H + i * ROW_H, n.w, ROW_H);
                }
            }
        }
        if (n.type.equals("group")) {
            return new Rect(n.x, n.y, n.w, HEADER_H);
        }
        return new Rect(n.x, n.y, n.w, n.h);
    }

    public static String edgePath(Map<String, BoardNode> nodes, BoardEdge e) {
        Rect a = anchorRect(nodes, e.from());
        Rect b = anchorRect(nodes, e.to());
        if (a == null || b == null) {
            return "";
        }
        double ay = a.y() + a.h() / 2;
        double by = b.y() + b.h() / 2;
        double x1;
        double x2;
        if (a.x() + a.w() <= b.x()) {
            x1 = a.x() + a.w();
            x2 = b.x();
        } else if (b.x() + b.w() <= a.x()) {
            x1 = a.x();
            x2 = b.x() + b.w();
        } else {
            x1 = a.x() + a.w();
            x2 = b.x() + b.w();
        }
        double bend = Math.max(40, Math.abs(x2 - x1) / 2);
        double c1 = x1 + (x1 <= x2 || a.x() + a.w() == x1 ? bend : -bend);
        double c2 = x2 + (x1 <= x2 ? -bend : bend);
        return "M" + fmt(x1) + "," + fmt(ay) + " C" + fmt(c1) + "," + fmt(ay) + " " + fmt(c2) + "," + fmt(by) + " "
                + fmt(x2) + "," + fmt(by);
    }

    private static String fmt(double d) {
        return d == Math.rint(d) ? Long.toString((long) d) : String.format(java.util.Locale.ROOT, "%.1f", d);
    }

    // ------------------------------------------------------------------ clipboard and drag semantics

    public record ClipItem(AcKind kind, String id, String name, List<String> attrs, String fromAttr) {
    }

    public record Clip(String mode, List<ClipItem> items) {
        public boolean cut() {
            return "cut".equals(mode);
        }
    }

    /** A planned change set, or an error explaining why nothing can be done. */
    public record Intent(String title, String summary, List<AcOp> ops, String error,
            List<Map.Entry<AcKind, String>> created) {
        static Intent error(String e) {
            return new Intent(null, null, List.of(), e, List.of());
        }

        static Intent of(String title, String summary, List<AcOp> ops) {
            return new Intent(title, summary, ops, null, List.of());
        }

        public boolean ok() {
            return error == null;
        }
    }

    private static String plural(int n, AcKind kind) {
        return n + " " + (n == 1 ? kind.one : kind.many);
    }

    private static String names(List<String> xs) {
        return xs.size() <= 3 ? String.join(", ", xs)
                : String.join(", ", xs.subList(0, 2)) + " and " + (xs.size() - 2) + " more";
    }

    private static List<AcOp> cutOps(ClipItem it, List<String> keep) {
        List<String> from = it.fromAttr() != null ? List.of(it.fromAttr()) : it.attrs();
        return from.stream().filter(a -> !keep.contains(a)).map(a -> (AcOp) new RemoveAttr(it.kind(), it.id(), a)).toList();
    }

    public static Intent pasteIntoGroup(AcModel m, Clip clip, AcKind kind, String attr) {
        List<ClipItem> items = clip.items().stream().filter(i -> i.kind() == kind).toList();
        if (items.isEmpty()) {
            return Intent.error("Only " + kind.many + " can go into an " + kind.one + " group.");
        }
        List<AcOp> ops = new ArrayList<>();
        for (ClipItem it : items) {
            AcEntity cur = m.entitiesOf(kind).stream().filter(x -> x.id.equals(it.id())).findFirst().orElse(null);
            if (cur == null) {
                continue;
            }
            if (!cur.attrs.contains(attr)) {
                ops.add(new AddAttr(kind, it.id(), attr));
            }
            if (clip.cut()) {
                ops.addAll(cutOps(it, List.of(attr)));
            }
        }
        if (ops.isEmpty()) {
            return Intent.error("Already in #" + attr + ".");
        }
        String verb = clip.cut() ? "Move" : "Add";
        List<String> nm = items.stream().map(ClipItem::name).toList();
        return Intent.of(verb + " " + names(nm) + " " + (clip.cut() ? "to" : "to group") + " #" + attr,
                plural(items.size(), kind) + " " + (clip.cut() ? "moved into" : "added to") + " #" + attr
                        + "; they get whatever access #" + attr + " has.",
                ops);
    }

    public static Intent pasteOntoEntities(AcModel m, Clip clip, List<Map.Entry<AcKind, String>> targets) {
        AcKind kind = targets.isEmpty() ? null : targets.get(0).getKey();
        List<ClipItem> items = clip.items().stream().filter(i -> i.kind() == kind).toList();
        if (kind == null || items.isEmpty()) {
            return Intent.error(
                    "Paste access onto the same kind of thing you copied (identity onto identity, service onto service).");
        }
        List<String> attrs = items.stream().flatMap(i -> i.fromAttr() != null ? java.util.stream.Stream.of(i.fromAttr())
                : i.attrs().stream()).distinct().toList();
        List<String> itemNames = items.stream().map(ClipItem::name).toList();
        if (attrs.isEmpty()) {
            return Intent.error(names(itemNames) + " " + (items.size() == 1 ? "has" : "have") + " no attributes to copy.");
        }
        List<AcEntity> tgts = targets.stream()
                .map(t -> m.entitiesOf(t.getKey()).stream().filter(x -> x.id.equals(t.getValue())).findFirst().orElse(null))
                .filter(Objects::nonNull).map(x -> (AcEntity) x).toList();
        List<AcOp> ops = new ArrayList<>();
        for (AcEntity t : tgts) {
            for (String a : attrs) {
                if (!t.attrs.contains(a)) {
                    ops.add(new AddAttr(kind, t.id, a));
                }
            }
        }
        if (clip.cut()) {
            for (ClipItem it : items) {
                if (tgts.stream().noneMatch(t -> t.id.equals(it.id()))) {
                    ops.addAll(cutOps(it, List.of()));
                }
            }
        }
        List<String> tgtNames = tgts.stream().map(t -> t.name).toList();
        String attrText = attrs.stream().map(a -> "#" + a).collect(Collectors.joining(", "));
        if (ops.isEmpty()) {
            return Intent.error(names(tgtNames) + " already " + (tgts.size() == 1 ? "has" : "have") + " " + attrText + ".");
        }
        return Intent.of((clip.cut() ? "Move" : "Copy") + " access from " + names(itemNames) + " to " + names(tgtNames),
                names(tgtNames) + " gain" + (tgts.size() == 1 ? "s" : "") + " " + attrText
                        + (clip.cut() ? "; " + names(itemNames) + " lose" + (items.size() == 1 ? "s" : "") + " "
                                + (items.stream().anyMatch(i -> i.fromAttr() != null) ? "that group" : "them") + "."
                                : ".")
                        + " Policies that name an identity directly (@name) are not copied.",
                ops);
    }

    public static String uniqueName(String base, List<String> taken) {
        Set<String> set = taken.stream().map(String::toLowerCase).collect(Collectors.toSet());
        String n = base + "-copy";
        for (int i = 2; set.contains(n.toLowerCase()); i++) {
            n = base + "-copy-" + i;
        }
        return n;
    }

    public static Intent pasteAsNew(AcModel m, Clip clip, Supplier<String> newId) {
        if (clip.cut()) {
            return Intent.error("Cut items can only be pasted into a group or onto another item. Use Copy to make new ones.");
        }
        List<ClipItem> items = clip.items().stream().filter(i -> i.kind() != AcKind.ROUTER).toList();
        if (items.isEmpty()) {
            return Intent.error("Routers can't be created from the canvas; they enroll with their own JWT.");
        }
        List<AcOp> ops = new ArrayList<>();
        List<Map.Entry<AcKind, String>> created = new ArrayList<>();
        List<String> newNames = new ArrayList<>();
        List<String> taken = new ArrayList<>();
        m.identities.forEach(i -> taken.add(i.name));
        m.services.forEach(s -> taken.add(s.name));
        for (ClipItem it : items) {
            String name = uniqueName(it.name(), taken);
            taken.add(name);
            newNames.add(name);
            String id = newId.get();
            created.add(Map.entry(it.kind(), id));
            if (it.kind() == AcKind.IDENTITY) {
                ops.add(new CreateIdentity(new AcNewIdentity(id, name, new ArrayList<>(it.attrs()))));
            } else {
                AcService s = m.services.stream().filter(x -> x.id.equals(it.id())).findFirst().orElse(null);
                ops.add(new CreateService(new AcNewService(id, name, it.attrs(), s == null ? List.of() : s.configs,
                        s == null || s.encryptionRequired, s == null ? "smartrouting" : s.terminatorStrategy)));
            }
        }
        long ids = items.stream().filter(i -> i.kind() == AcKind.IDENTITY).count();
        String summary = "New " + (items.size() == 1 ? (items.get(0).kind() == AcKind.IDENTITY ? "identity" : "service")
                : "items") + " with the same attributes"
                + (items.stream().anyMatch(i -> i.kind() == AcKind.SERVICE) ? " and configs" : "") + "."
                + (ids > 0 ? " New identities need enrolling with their own JWT (on the identity page) within 3 hours." : "");
        return new Intent("Create " + names(newNames), summary, ops, null, created);
    }

    public static Intent moveMember(AcModel m, AcKind kind, String id, String name, String fromAttr, String toAttr,
            boolean copy) {
        AcEntity cur = m.entitiesOf(kind).stream().filter(x -> x.id.equals(id)).findFirst().orElse(null);
        if (cur == null) {
            return Intent.error("That item no longer exists.");
        }
        List<AcOp> ops = new ArrayList<>();
        if (toAttr != null && !cur.attrs.contains(toAttr)) {
            ops.add(new AddAttr(kind, id, toAttr));
        }
        if (!copy && fromAttr != null && !fromAttr.equals(toAttr)) {
            ops.add(new RemoveAttr(kind, id, fromAttr));
        }
        if (ops.isEmpty()) {
            return Intent.error(toAttr != null ? name + " is already in #" + toAttr + "." : "Nothing to change.");
        }
        if (toAttr == null) {
            return Intent.of("Remove " + name + " from #" + fromAttr,
                    name + " loses #" + fromAttr + " and any access that came with it.", ops);
        }
        boolean add = copy || fromAttr == null;
        return Intent.of((add ? "Add" : "Move") + " " + name + " " + (add ? "to" : "from #" + fromAttr + " to") + " #" + toAttr,
                add ? name + " gains #" + toAttr + " and keeps its other groups."
                        : name + " leaves #" + fromAttr + " and joins #" + toAttr + "; access changes with it.",
                ops);
    }

    public record GroupedItem(AcKind kind, String id, String name, String attr) {
    }

    public static Intent removeFromGroups(AcModel m, List<GroupedItem> items) {
        List<AcOp> ops = items.stream()
                .filter(i -> m.entitiesOf(i.kind()).stream().anyMatch(x -> x.id.equals(i.id()) && x.attrs.contains(i.attr())))
                .map(i -> (AcOp) new RemoveAttr(i.kind(), i.id(), i.attr())).toList();
        if (ops.isEmpty()) {
            return Intent.error(
                    "Select cards inside a group to take them out of it. Delete never removes the identity or service itself.");
        }
        return Intent.of(items.size() == 1 ? "Remove " + items.get(0).name() + " from #" + items.get(0).attr()
                : "Remove " + items.size() + " items from their groups",
                "They lose those attributes and any access that came with them. The identities and services themselves stay.",
                ops);
    }

    public static BoardMarks marksFor(List<List<AcOp>> opsList) {
        BoardMarks k = new BoardMarks();
        for (List<AcOp> ops : opsList) {
            for (AcOp op : ops) {
                switch (op) {
                    case AddAttr a -> k.attrs.add(a.kind().one + ":" + a.id() + ":" + a.attr());
                    case RemoveAttr a -> k.attrs.add(a.kind().one + ":" + a.id() + ":" + a.attr());
                    case AddIdentityRole r -> k.roles.add(r.policy() + ":" + r.role());
                    case CreatePolicy c -> k.policies.add(c.policy().id);
                    case CreateErPolicy c -> k.policies.add(c.policy().id);
                    case CreateSerp c -> k.policies.add(c.policy().id);
                    case CreateIdentity c -> k.created.add(c.identity().id());
                    case CreateService c -> k.created.add(c.service().id);
                    default -> {
                    }
                }
            }
        }
        return k;
    }

    public static AcLayout remapLayout(AcLayout layout, Map<String, String> ids) {
        if (ids.isEmpty()) {
            return layout;
        }
        AcLayout out = layout.copy();
        out.nodes = new LinkedHashMap<>();
        layout.nodes.forEach((k, v) -> {
            String[] parts = k.split(":");
            String last = parts[parts.length - 1];
            if (ids.containsKey(last)) {
                parts[parts.length - 1] = ids.get(last);
                out.nodes.put(String.join(":", parts), v);
            } else {
                out.nodes.put(k, v);
            }
        });
        return out;
    }
}
