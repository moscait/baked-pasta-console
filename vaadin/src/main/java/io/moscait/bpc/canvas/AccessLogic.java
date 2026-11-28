package io.moscait.bpc.canvas;

import static io.moscait.bpc.ziti.Json.map;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import io.moscait.bpc.canvas.AcModel.AcEntity;
import io.moscait.bpc.canvas.AcModel.AcErPolicy;
import io.moscait.bpc.canvas.AcModel.AcIdentity;
import io.moscait.bpc.canvas.AcModel.AcKind;
import io.moscait.bpc.canvas.AcModel.AcNewIdentity;
import io.moscait.bpc.canvas.AcModel.AcNewService;
import io.moscait.bpc.canvas.AcModel.AcOp;
import io.moscait.bpc.canvas.AcModel.AcRouter;
import io.moscait.bpc.canvas.AcModel.AcSerp;
import io.moscait.bpc.canvas.AcModel.AcService;
import io.moscait.bpc.canvas.AcModel.AcServicePolicy;
import io.moscait.bpc.canvas.AcModel.AddAttr;
import io.moscait.bpc.canvas.AcModel.AddIdentityRole;
import io.moscait.bpc.canvas.AcModel.CreateConfig;
import io.moscait.bpc.canvas.AcModel.CreateErPolicy;
import io.moscait.bpc.canvas.AcModel.CreateIdentity;
import io.moscait.bpc.canvas.AcModel.CreatePolicy;
import io.moscait.bpc.canvas.AcModel.CreateSerp;
import io.moscait.bpc.canvas.AcModel.CreateService;
import io.moscait.bpc.canvas.AcModel.RemoveAttr;
import io.moscait.bpc.ziti.Json;

/**
 * Framework-free logic for the Access Canvas: role matching, effective access, grant options
 * with impact preview, and the "why can't X reach Y" advisor.
 */
public final class AccessLogic {

    public static final String MGMT = "/edge/management/v1";

    private AccessLogic() {
    }

    // ------------------------------------------------------------------ matching

    public static boolean matchRole(AcEntity e, String r) {
        if (r.isEmpty()) {
            return false;
        }
        if (r.equals("#all")) {
            return true;
        }
        if (r.charAt(0) == '#') {
            return e.attrs.contains(r.substring(1));
        }
        if (r.charAt(0) == '@') {
            String ref = r.substring(1);
            return e.id.equals(ref) || e.name.equals(ref);
        }
        return false;
    }

    public static boolean matches(AcEntity e, List<String> roles, String semantic) {
        if (roles == null || roles.isEmpty()) {
            return false;
        }
        return "AllOf".equals(semantic)
                ? roles.stream().allMatch(r -> matchRole(e, r))
                : roles.stream().anyMatch(r -> matchRole(e, r));
    }

    public static List<AcServicePolicy> dialFor(AcModel m, AcIdentity i, AcService s) {
        return m.servicePolicies.stream()
                .filter(p -> p.isDial() && matches(i, p.identityRoles, p.semantic) && matches(s, p.serviceRoles, p.semantic))
                .toList();
    }

    public static List<AcServicePolicy> bindsFor(AcModel m, AcService s) {
        return m.servicePolicies.stream().filter(p -> !p.isDial() && matches(s, p.serviceRoles, p.semantic)).toList();
    }

    public static boolean isHost(AcModel m, AcIdentity i) {
        return m.servicePolicies.stream().anyMatch(p -> !p.isDial() && matches(i, p.identityRoles, p.semantic));
    }

    static boolean isDialer(AcModel m, AcIdentity i) {
        return m.servicePolicies.stream().anyMatch(p -> p.isDial() && matches(i, p.identityRoles, p.semantic));
    }

    /** Identities that use services: everything except admins and pure hosts. */
    public static List<AcIdentity> clients(AcModel m) {
        return m.identities.stream().filter(i -> !i.isAdmin && (!isHost(m, i) || isDialer(m, i))).toList();
    }

    public static List<AcIdentity> hosts(AcModel m) {
        return m.identities.stream().filter(i -> isHost(m, i)).toList();
    }

    public static List<AcIdentity> hostsFor(AcModel m, AcService s) {
        List<AcServicePolicy> binds = bindsFor(m, s);
        return m.identities.stream()
                .filter(h -> binds.stream().anyMatch(p -> matches(h, p.identityRoles, p.semantic))).toList();
    }

    public static List<AcRouter> identityRouters(AcModel m, AcIdentity i) {
        return m.routers.stream().filter(r -> m.erPolicies.stream()
                .anyMatch(p -> matches(i, p.identityRoles, p.semantic) && matches(r, p.routerRoles, p.semantic))).toList();
    }

    public static List<AcRouter> serviceRouters(AcModel m, AcService s) {
        return m.routers.stream().filter(r -> m.serps.stream()
                .anyMatch(p -> matches(s, p.serviceRoles, p.semantic) && matches(r, p.routerRoles, p.semantic))).toList();
    }

    /** Every client|service pair granted by some Dial policy. Walks policies, not all pairs. */
    public static Set<String> accessSet(AcModel m) {
        Set<String> set = new HashSet<>();
        List<AcIdentity> clientList = clients(m);
        for (AcServicePolicy p : m.servicePolicies) {
            if (!p.isDial()) {
                continue;
            }
            List<AcIdentity> ids = clientList.stream().filter(i -> matches(i, p.identityRoles, p.semantic)).toList();
            if (ids.isEmpty()) {
                continue;
            }
            List<AcService> svcs = m.services.stream().filter(s -> matches(s, p.serviceRoles, p.semantic)).toList();
            for (AcIdentity i : ids) {
                for (AcService s : svcs) {
                    set.add(i.id + "|" + s.id);
                }
            }
        }
        return set;
    }

    public static boolean canRoute(AcModel m, AcIdentity i, AcService s) {
        Set<String> sr = serviceRouters(m, s).stream().map(r -> r.id).collect(Collectors.toSet());
        boolean ir = identityRouters(m, i).stream().anyMatch(r -> sr.contains(r.id));
        boolean hr = hostsFor(m, s).stream().anyMatch(h -> identityRouters(m, h).stream().anyMatch(r -> sr.contains(r.id)));
        return ir && hr;
    }

    // ------------------------------------------------------------------ display helpers

    public static String roleLabel(AcModel m, String r) {
        if (r.isEmpty() || r.charAt(0) != '@') {
            return r;
        }
        String id = r.substring(1);
        for (List<? extends AcEntity> l : List.of(m.identities, m.services, m.routers)) {
            for (AcEntity e : l) {
                if (e.id.equals(id)) {
                    return "@" + e.name;
                }
            }
        }
        return r;
    }

    /** Entities grouped by attribute (entities without attributes under ""), sorted, "" last. */
    public static <T extends AcEntity> List<Map.Entry<String, List<T>>> groups(List<T> list) {
        Map<String, List<T>> map = new LinkedHashMap<>();
        for (T e : list) {
            List<String> keys = e.attrs.isEmpty() ? List.of("") : e.attrs;
            for (String a : keys) {
                map.computeIfAbsent(a, k -> new ArrayList<>()).add(e);
            }
        }
        List<Map.Entry<String, List<T>>> out = new ArrayList<>(map.entrySet());
        out.sort(Comparator.<Map.Entry<String, List<T>>>comparingInt(e -> e.getKey().isEmpty() ? 1 : 0)
                .thenComparing(Map.Entry::getKey));
        return out;
    }

    // ------------------------------------------------------------------ changes

    public static AcModel applyOps(AcModel m, List<AcOp> ops) {
        for (AcOp op : ops) {
            switch (op) {
                case AddAttr a -> m.entitiesOf(a.kind()).stream().filter(x -> x.id.equals(a.id())).findFirst()
                        .ifPresent(e -> {
                            if (!e.attrs.contains(a.attr())) {
                                e.attrs.add(a.attr());
                            }
                        });
                case RemoveAttr a -> m.entitiesOf(a.kind()).stream().filter(x -> x.id.equals(a.id())).findFirst()
                        .ifPresent(e -> e.attrs.remove(a.attr()));
                case CreateIdentity c -> {
                    AcIdentity i = new AcIdentity(c.identity().id(), c.identity().name(), c.identity().attrs());
                    m.identities.add(i);
                }
                case CreateService c -> {
                    AcNewService s = c.service();
                    AcService existing = s.existingId == null ? null
                            : m.services.stream().filter(x -> x.id.equals(s.existingId)).findFirst().orElse(null);
                    AcService target = existing != null ? existing : new AcService(s.id, s.name, s.attrs);
                    target.name = s.name;
                    target.attrs = new ArrayList<>(s.attrs);
                    target.configs = new ArrayList<>(s.configs);
                    target.encryptionRequired = s.encryptionRequired;
                    target.terminatorStrategy = s.terminatorStrategy;
                    if (existing == null) {
                        m.services.add(target);
                    }
                }
                case AddIdentityRole r -> m.servicePolicies.stream().filter(x -> x.id.equals(r.policy())).findFirst()
                        .ifPresent(p -> {
                            if (!p.identityRoles.contains(r.role())) {
                                p.identityRoles.add(r.role());
                            }
                        });
                case CreatePolicy c -> replaceOrAdd(m.servicePolicies, c.policy().copy(), c.policy().existingId,
                        (p, id) -> p.id = id, p -> p.id);
                case CreateErPolicy c -> replaceOrAdd(m.erPolicies, c.policy().copy(), c.policy().existingId,
                        (p, id) -> p.id = id, p -> p.id);
                case CreateSerp c -> replaceOrAdd(m.serps, c.policy().copy(), c.policy().existingId,
                        (p, id) -> p.id = id, p -> p.id);
                case CreateConfig c -> {
                    var cfg = c.config();
                    String id = cfg.existingId != null ? cfg.existingId : cfg.id;
                    var row = new AcModel.AcConfig(id, cfg.name, cfg.type, cfg.data);
                    int idx = indexOf(m.configs, x -> x.id.equals(cfg.existingId));
                    if (cfg.existingId != null && idx >= 0) {
                        m.configs.set(idx, row);
                    } else {
                        m.configs.add(row);
                    }
                }
            }
        }
        return m;
    }

    private static <T> int indexOf(List<T> list, java.util.function.Predicate<T> p) {
        for (int i = 0; i < list.size(); i++) {
            if (p.test(list.get(i))) {
                return i;
            }
        }
        return -1;
    }

    private static <T> void replaceOrAdd(List<T> list, T item, String existingId,
            java.util.function.BiConsumer<T, String> setId, java.util.function.Function<T, String> getId) {
        int idx = existingId == null ? -1 : indexOf(list, x -> getId.apply(x).equals(existingId));
        if (idx >= 0) {
            setId.accept(item, existingId);
            list.set(idx, item);
        } else {
            list.add(item);
        }
    }

    /** The request each op becomes, shown before anything is sent. */
    public static List<String> describeCalls(AcModel base, List<AcOp> ops) {
        AcModel m = base.copy();
        List<String> out = new ArrayList<>();
        for (AcOp op : ops) {
            applyOps(m, List.of(op));
            switch (op) {
                case AddAttr a -> attrCall(m, a.kind(), a.id(), out);
                case RemoveAttr a -> attrCall(m, a.kind(), a.id(), out);
                case CreateIdentity c -> out.add("POST " + MGMT + "/identities\n" + Json.pretty(identityBody(c.identity())));
                case CreateService c -> out.add((c.service().existingId != null
                        ? "PATCH " + MGMT + "/services/" + c.service().existingId
                        : "POST " + MGMT + "/services") + "\n" + Json.pretty(serviceBody(c.service())));
                case AddIdentityRole r -> m.servicePolicies.stream().filter(x -> x.id.equals(r.policy())).findFirst()
                        .ifPresent(p -> out.add("PATCH " + MGMT + "/service-policies/" + p.id + "\n{ \"identityRoles\": "
                                + Json.write(p.identityRoles) + " }"));
                case CreatePolicy c -> out.add(writeCall("service-policies", c.policy().existingId) + "\n"
                        + Json.pretty(policyBody(c.policy())));
                case CreateErPolicy c -> out.add(writeCall("edge-router-policies", c.policy().existingId) + "\n"
                        + Json.pretty(erPolicyBody(c.policy())));
                case CreateSerp c -> out.add(writeCall("service-edge-router-policies", c.policy().existingId) + "\n"
                        + Json.pretty(serpBody(c.policy())));
                case CreateConfig c -> out.add(writeCall("configs", c.config().existingId) + "   (config type "
                        + c.config().type + ")\n" + Json.pretty(map("name", c.config().name, "data", c.config().data)));
            }
        }
        return out;
    }

    private static String writeCall(String coll, String existingId) {
        return existingId != null ? "PATCH " + MGMT + "/" + coll + "/" + existingId : "POST " + MGMT + "/" + coll;
    }

    private static void attrCall(AcModel m, AcKind kind, String id, List<String> out) {
        m.entitiesOf(kind).stream().filter(x -> x.id.equals(id)).findFirst().ifPresent(e -> out.add(
                "PATCH " + MGMT + "/" + kind.api + "/" + e.id + "\n{ \"roleAttributes\": " + Json.write(e.attrs) + " }"));
    }

    public static Map<String, Object> policyBody(AcServicePolicy p) {
        return map("name", p.name, "type", p.type, "semantic", p.semantic, "identityRoles", p.identityRoles,
                "serviceRoles", p.serviceRoles, "postureCheckRoles", List.of());
    }

    public static Map<String, Object> erPolicyBody(AcErPolicy p) {
        return map("name", p.name, "semantic", p.semantic, "identityRoles", p.identityRoles, "edgeRouterRoles",
                p.routerRoles);
    }

    public static Map<String, Object> serpBody(AcSerp p) {
        return map("name", p.name, "semantic", p.semantic, "serviceRoles", p.serviceRoles, "edgeRouterRoles",
                p.routerRoles);
    }

    public static Map<String, Object> identityBody(AcNewIdentity i) {
        return map("name", i.name(), "type", "Default", "isAdmin", false, "roleAttributes", i.attrs(), "enrollment",
                map("ott", true));
    }

    public static Map<String, Object> serviceBody(AcNewService s) {
        return map("name", s.name, "roleAttributes", s.attrs, "configs", s.configs, "encryptionRequired",
                s.encryptionRequired, "terminatorStrategy", s.terminatorStrategy);
    }

    // ------------------------------------------------------------------ grant options

    public record AcImpact(int pairs, int identities, int services, List<String> outside, int noRoute) {
    }

    public static final class AcOption {
        public final String kind;
        public final String title;
        public final String why;
        public final List<AcOp> ops;
        public final AcImpact impact;
        public List<String> calls = List.of();
        public final boolean exception;
        public boolean recommended;
        public double score;

        AcOption(String kind, double score, String title, String why, List<AcOp> ops, boolean exception, AcImpact impact) {
            this.kind = kind;
            this.score = score;
            this.title = title;
            this.why = why;
            this.ops = ops;
            this.exception = exception;
            this.impact = impact;
        }
    }

    public record AcGrantResult(List<AcOption> opts, boolean already, List<String> allowedBy, String srcLabel,
            String tgtLabel, int srcCount, int tgtCount, List<String> unhosted) {
    }

    /** A grant endpoint: a group ("group" + attr), or one identity/service ("identity"/"service" + id). */
    public record AcEndpoint(String kind, String attr, String id) {
        public static AcEndpoint group(String attr) {
            return new AcEndpoint("group", attr, null);
        }

        public static AcEndpoint identity(String id) {
            return new AcEndpoint("identity", null, id);
        }

        public static AcEndpoint service(String id) {
            return new AcEndpoint("service", null, id);
        }
    }

    public static AcImpact impact(AcModel base, List<AcOp> ops, List<String> tgtServiceIds) {
        AcModel after = applyOps(base.copy(), ops);
        Set<String> a = accessSet(base);
        Set<String> b = accessSet(after);
        List<String[]> added = b.stream().filter(k -> !a.contains(k)).map(k -> k.split("\\|")).toList();
        Set<String> svcAdded = added.stream().map(x -> x[1]).collect(Collectors.toCollection(LinkedHashSet::new));
        Set<String> identAdded = added.stream().map(x -> x[0]).collect(Collectors.toSet());
        List<String> outside = svcAdded.stream().filter(s -> !tgtServiceIds.contains(s))
                .map(s -> after.services.stream().filter(x -> x.id.equals(s)).findFirst().map(x -> x.name).orElse(s))
                .toList();
        Set<String> noRoute = new HashSet<>();
        for (String[] pair : added) {
            AcIdentity i = after.identities.stream().filter(x -> x.id.equals(pair[0])).findFirst().orElse(null);
            AcService s = after.services.stream().filter(x -> x.id.equals(pair[1])).findFirst().orElse(null);
            if (i != null && s != null && !canRoute(after, i, s)) {
                noRoute.add(pair[0]);
            }
        }
        return new AcImpact(added.size(), identAdded.size(), svcAdded.size(), outside, noRoute.size());
    }

    public static String slug(String s) {
        return s.replaceFirst("^[#@]", "").toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
    }

    /** Ways to grant {@code src} Dial access to {@code tgt}, the best first-class choice marked recommended. */
    public static AcGrantResult buildOptions(AcModel m, AcEndpoint src, AcEndpoint tgt, Supplier<String> newId) {
        boolean srcGroup = "group".equals(src.kind());
        boolean tgtGroup = "group".equals(tgt.kind());
        List<AcIdentity> srcIds = srcGroup
                ? clients(m).stream().filter(i -> i.attrs.contains(src.attr())).toList()
                : m.identities.stream().filter(i -> i.id.equals(src.id())).toList();
        List<AcService> tgtSvcs = tgtGroup
                ? m.services.stream().filter(s -> s.attrs.contains(tgt.attr())).toList()
                : m.services.stream().filter(s -> s.id.equals(tgt.id())).toList();
        if ((!srcGroup && srcIds.isEmpty()) || (!tgtGroup && tgtSvcs.isEmpty())) {
            return new AcGrantResult(List.of(), false, List.of(), "", "", 0, 0, List.of());
        }
        String srcRole = srcGroup ? "#" + src.attr() : "@" + srcIds.get(0).id;
        String tgtRole = tgtGroup ? "#" + tgt.attr() : "@" + tgtSvcs.get(0).id;
        String srcLabel = srcGroup ? "#" + src.attr() : srcIds.get(0).name;
        String tgtLabel = tgtGroup ? "#" + tgt.attr() : tgtSvcs.get(0).name;
        String tgtSlug = tgtGroup ? slug(tgt.attr()) : slug(tgtSvcs.get(0).name);
        List<String> tgtIds = tgtSvcs.stream().map(s -> s.id).toList();
        boolean already = !srcIds.isEmpty()
                && srcIds.stream().allMatch(i -> tgtSvcs.stream().allMatch(s -> !dialFor(m, i, s).isEmpty()));
        Set<String> allowedBy = new LinkedHashSet<>();
        for (AcIdentity i : srcIds) {
            for (AcService s : tgtSvcs) {
                dialFor(m, i, s).forEach(p -> allowedBy.add(p.name));
            }
        }
        List<AcServicePolicy> candidates = m.servicePolicies.stream()
                .filter(p -> p.isDial() && tgtSvcs.stream().allMatch(s -> matches(s, p.serviceRoles, p.semantic)))
                .toList();
        java.util.function.Function<List<String>, String> rl = roles -> roles.stream().map(r -> roleLabel(m, r))
                .collect(Collectors.joining(", "));
        List<AcOption> opts = new ArrayList<>();
        interface Adder {
            void add(String kind, double score, String title, String why, List<AcOp> ops, boolean exception);
        }
        Adder base = (kind, score, title, why, ops, exception) -> opts
                .add(new AcOption(kind, score, title, why, ops, exception, impact(m, ops, tgtIds)));

        if (!srcGroup) {
            AcIdentity i = srcIds.get(0);
            Set<String> seen = new HashSet<>();
            for (AcServicePolicy p : candidates) {
                for (String r : p.identityRoles) {
                    if (r.isEmpty() || r.charAt(0) != '#' || r.equals("#all") || i.attrs.contains(r.substring(1))
                            || seen.contains(r)) {
                        continue;
                    }
                    seen.add(r);
                    base.add("attr", 0, "Add " + r + " to " + i.name,
                            i.name + " joins the " + r + " group. " + p.name + " already lets that group dial "
                                    + rl.apply(p.serviceRoles) + ".",
                            List.of(new AddAttr(AcKind.IDENTITY, i.id, r.substring(1))), false);
                }
            }
            String newAttr = tgtSlug + "-users";
            base.add("newattr", 1, "Create group #" + newAttr + " for " + tgtLabel,
                    "Gives " + i.name + " #" + newAttr
                            + " and creates a Dial policy for that group, so the next person needs only the attribute.",
                    List.of(new AddAttr(AcKind.IDENTITY, i.id, newAttr),
                            new CreatePolicy(new AcServicePolicy(newId.get(), newAttr + "-dial", "Dial", "AnyOf",
                                    List.of("#" + newAttr), List.of(tgtRole), List.of()))),
                    false);
            base.add("oneoff", 3, "One-off policy for " + i.name,
                    "A Dial policy naming " + i.name
                            + " directly. Fine for a one-time exception, but it doesn't scale and hides intent.",
                    List.of(new CreatePolicy(new AcServicePolicy(newId.get(), slug(i.name) + "-" + tgtSlug + "-dial",
                            "Dial", "AnyOf", List.of(srcRole), List.of(tgtRole), List.of()))),
                    true);
        } else {
            for (AcServicePolicy p : candidates) {
                if (!p.identityRoles.contains(srcRole)) {
                    base.add("extend", 0, "Add " + srcRole + " to policy " + p.name,
                            p.name + " already grants " + rl.apply(p.serviceRoles)
                                    + (p.posture.isEmpty() ? "" : " with posture checks (" + String.join(", ", p.posture) + ")")
                                    + ". One role added, no new policy.",
                            List.of(new AddIdentityRole(p.id, srcRole)), false);
                }
            }
            base.add("create", 1, "Create Dial policy " + slug(srcRole) + "-" + tgtSlug + "-dial",
                    "A new policy: " + srcLabel + " may dial " + tgtLabel
                            + ". Clear and separate, at the cost of one more policy.",
                    List.of(new CreatePolicy(new AcServicePolicy(newId.get(), slug(srcRole) + "-" + tgtSlug + "-dial",
                            "Dial", "AnyOf", List.of(srcRole), List.of(tgtRole), List.of()))),
                    false);
        }
        for (AcOption o : opts) {
            o.calls = describeCalls(m, o.ops);
            o.score += (o.impact.outside().isEmpty() ? 0 : 2.5) + (o.exception ? 1 : 0);
        }
        opts.stream().min(Comparator.comparingDouble(o -> o.score)).ifPresent(o -> o.recommended = true);
        return new AcGrantResult(opts, already, new ArrayList<>(allowedBy), srcLabel, tgtLabel, srcIds.size(),
                tgtSvcs.size(), tgtSvcs.stream().filter(s -> hostsFor(m, s).isEmpty()).map(s -> s.name).toList());
    }

    // ------------------------------------------------------------------ advisor

    /** One advisor step: st is "ok", "bad" or "info". */
    public record AcStep(String st, String t, String d, String fix) {
        static AcStep ok(String t, String d) {
            return new AcStep("ok", t, d, null);
        }

        static AcStep bad(String t, String d, String fix) {
            return new AcStep("bad", t, d, fix);
        }
    }

    private static String attrList(List<String> a) {
        return a.isEmpty() ? "no attributes" : a.stream().map(x -> "#" + x).collect(Collectors.joining(", "));
    }

    public static List<AcStep> advise(AcModel m, AcIdentity i, AcService s) {
        List<AcStep> steps = new ArrayList<>();
        if (!i.enrolled) {
            steps.add(AcStep.bad("Identity isn't enrolled", "It has no certificate yet, so it cannot sign in to the network.",
                    "Open the identity and enroll it with its JWT or QR code in a Ziti tunneler."));
        }
        List<AcServicePolicy> dial = dialFor(m, i, s);
        steps.add(!dial.isEmpty()
                ? AcStep.ok("Dial allowed", "by " + dial.stream().map(p -> p.name).collect(Collectors.joining(", ")))
                : AcStep.bad("No Dial policy matches both",
                        i.name + " has " + attrList(i.attrs) + "; " + s.name + " has " + attrList(s.attrs) + ".",
                        "Drag " + i.name + " (or its group) onto " + s.name + " to choose how to grant it."));
        if (!dial.isEmpty()) {
            boolean free = dial.stream().anyMatch(p -> p.posture.isEmpty());
            steps.add(free ? AcStep.ok("No posture checks required", null)
                    : new AcStep("info", "Posture checks: " + dial.stream().flatMap(p -> p.posture.stream()).distinct()
                            .collect(Collectors.joining(", ")), "The device must pass them when it connects.", null));
        }
        List<AcIdentity> hsAll = hostsFor(m, s);
        List<AcIdentity> hs = hsAll.stream().filter(h -> h.enrolled).toList();
        if (hsAll.isEmpty()) {
            steps.add(AcStep.bad("Nothing hosts this service",
                    "No Bind policy gives any identity this service, so there is no far end.",
                    "Use Set up a service or add a Bind policy."));
        } else if (hs.isEmpty()) {
            steps.add(AcStep.bad("Its hosts aren't enrolled", hsAll.stream().map(h -> h.name).collect(Collectors.joining(", ")),
                    "Enroll the hosting identity on the server that runs the service."));
        } else {
            steps.add(AcStep.ok("Service is hosted", "by " + hs.stream().map(h -> h.name).collect(Collectors.joining(", "))
                    + " (" + bindsFor(m, s).stream().map(p -> p.name).collect(Collectors.joining(", ")) + ")"));
        }
        List<AcRouter> ir = identityRouters(m, i);
        steps.add(!ir.isEmpty()
                ? AcStep.ok("Identity can use edge routers", ir.stream().map(r -> r.name).collect(Collectors.joining(", ")))
                : AcStep.bad("Identity has no edge routers",
                        "No edge router policy includes " + i.name + " (" + attrList(i.attrs) + ").",
                        "Add " + (i.attrs.isEmpty() ? i.name : "#" + i.attrs.get(0)) + " to an edge router policy."));
        List<AcRouter> sr = serviceRouters(m, s);
        if (!ir.isEmpty()) {
            List<AcRouter> common = ir.stream().filter(r -> sr.stream().anyMatch(x -> x.id.equals(r.id))).toList();
            List<AcRouter> online = common.stream().filter(r -> r.online).toList();
            String label = common.stream().map(r -> r.name + (r.online ? "" : " (offline)")).collect(Collectors.joining(", "));
            if (common.isEmpty()) {
                steps.add(AcStep.bad("No shared router carries the service", i.name + "'s routers don't serve " + s.name + ".",
                        "Widen the service edge router policy."));
            } else if (!online.isEmpty()) {
                steps.add(AcStep.ok("A shared router is online", label));
            } else {
                steps.add(AcStep.bad("Every shared router is offline", label,
                        "Bring a router back online, or allow this identity on another router."));
            }
        }
        if (!hs.isEmpty()) {
            boolean ok = hs.stream().anyMatch(
                    h -> identityRouters(m, h).stream().anyMatch(r -> sr.stream().anyMatch(x -> x.id.equals(r.id))));
            steps.add(ok ? AcStep.ok("A host can reach a router that carries it", null)
                    : AcStep.bad("Hosts can't reach a router that carries it", null,
                            "Add the hosts' attribute to an edge router policy."));
        }
        return steps;
    }

    public static final Map<String, String> CONCEPTS = Map.of(
            "identities",
            "An identity is a person, device or app with its own certificate. Policies select identities by role attribute (#sales), not one by one. @name picks a single identity; keep it for exceptions.",
            "dial",
            "A Dial policy lets identities use (connect to) services. Both sides are chosen by attribute. AnyOf means matching any listed role is enough; AllOf means all of them.",
            "services",
            "A service is something you publish on the overlay: an app, an API, an SSH port. Clients reach it through an intercept address, and it needs no open port on the internet.",
            "bind",
            "A Bind policy says which identities host a service. They run a tunneler or SDK next to the real server and receive its traffic.",
            "hosts",
            "Hosting identities sit next to the real server and forward overlay traffic to it. A service without an enrolled host has nowhere to go.",
            "routers",
            "Edge routers carry the traffic. An identity needs an edge router policy that allows it on a router, and the service needs a service edge router policy for that same router.");
}
