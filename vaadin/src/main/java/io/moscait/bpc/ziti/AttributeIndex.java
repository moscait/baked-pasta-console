package io.moscait.bpc.ziti;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Role-attribute index: which entities carry each {@code #attribute}, which policies select it,
 * and where the two disagree (a policy selecting an attribute nothing has, or an attribute no
 * policy uses).
 *
 * <p>Rows are plain maps so the generic grid can sort, search and export them:
 * {@code id, name, members{identity,service,router,posture: [{id,name}]}, refs, dangling, unused}.
 */
public final class AttributeIndex {

    private AttributeIndex() {
    }

    public static final List<String> KINDS = List.of("identity", "service", "router", "posture");
    public static final Map<String, String> KIND_LABEL = Map.of("identity", "identities", "service", "services",
            "router", "edge routers", "posture", "posture checks");

    public record Input(List<Map<String, Object>> identities, List<Map<String, Object>> services,
            List<Map<String, Object>> edgeRouters, List<Map<String, Object>> postureChecks,
            List<Map<String, Object>> servicePolicies, List<Map<String, Object>> edgeRouterPolicies,
            List<Map<String, Object>> serviceEdgeRouterPolicies) {
    }

    /** {@code #name} role entries; {@code @id} entries and the {@code #all} wildcard select no attribute. */
    static List<String> attrRoles(List<String> roles) {
        return new ArrayList<>(new LinkedHashSet<>(roles.stream().filter(r -> r.startsWith("#") && !r.equals("#all"))
                .map(r -> r.substring(1)).filter(s -> !s.isEmpty()).toList()));
    }

    private static Map<String, Object> row(Map<String, Map<String, Object>> rows, String name) {
        return rows.computeIfAbsent(name, n -> {
            Map<String, Object> members = new LinkedHashMap<>();
            KINDS.forEach(k -> members.put(k, new ArrayList<Map<String, Object>>()));
            return Json.map("id", n, "name", n, "members", members, "refs", new ArrayList<Map<String, Object>>(),
                    "dangling", new ArrayList<Map<String, Object>>(), "unused", false);
        });
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> build(Input in) {
        Map<String, Map<String, Object>> rows = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        Map<String, List<Map<String, Object>>> sources = new LinkedHashMap<>();
        sources.put("identity", in.identities());
        sources.put("service", in.services());
        sources.put("router", in.edgeRouters());
        sources.put("posture", in.postureChecks());
        sources.forEach((kind, list) -> {
            for (Map<String, Object> e : list) {
                for (String a : new LinkedHashSet<>(Json.strings(e, "roleAttributes"))) {
                    Map<String, Object> members = (Map<String, Object>) row(rows, a).get("members");
                    ((List<Map<String, Object>>) members.get(kind))
                            .add(Json.map("id", Json.str(e, "id"), "name", Json.strOr(e, "name", "")));
                }
            }
        });
        for (Map<String, Object> p : in.servicePolicies()) {
            String t = Json.strOr(p, "type", "") + " service policy";
            refs(rows, p, t, "identity", Json.strings(p, "identityRoles"));
            refs(rows, p, t, "service", Json.strings(p, "serviceRoles"));
            refs(rows, p, t, "posture", Json.strings(p, "postureCheckRoles"));
        }
        for (Map<String, Object> p : in.edgeRouterPolicies()) {
            if (Json.bool(p, "isSystem")) {
                continue;
            }
            refs(rows, p, "Edge router policy", "identity", Json.strings(p, "identityRoles"));
            refs(rows, p, "Edge router policy", "router", Json.strings(p, "edgeRouterRoles"));
        }
        for (Map<String, Object> p : in.serviceEdgeRouterPolicies()) {
            if (Json.bool(p, "isSystem")) {
                continue;
            }
            refs(rows, p, "Service edge router policy", "service", Json.strings(p, "serviceRoles"));
            refs(rows, p, "Service edge router policy", "router", Json.strings(p, "edgeRouterRoles"));
        }
        for (Map<String, Object> r : rows.values()) {
            Map<String, Object> members = (Map<String, Object>) r.get("members");
            List<Map<String, Object>> refs = (List<Map<String, Object>>) r.get("refs");
            List<Map<String, Object>> dangling = (List<Map<String, Object>>) r.get("dangling");
            refs.stream().filter(ref -> ((List<?>) members.get(ref.get("selects"))).isEmpty()).forEach(dangling::add);
            r.put("unused", refs.isEmpty());
            for (String k : KINDS) {
                ((List<Map<String, Object>>) members.get(k))
                        .sort((a, b) -> String.valueOf(a.get("name")).compareToIgnoreCase(String.valueOf(b.get("name"))));
            }
        }
        return new ArrayList<>(rows.values());
    }

    @SuppressWarnings("unchecked")
    private static void refs(Map<String, Map<String, Object>> rows, Map<String, Object> policy, String type, String selects,
            List<String> roles) {
        for (String a : attrRoles(roles)) {
            ((List<Map<String, Object>>) row(rows, a).get("refs")).add(Json.map("policyId", Json.str(policy, "id"),
                    "policyName", Json.strOr(policy, "name", ""), "policyType", type, "selects", selects));
        }
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> members(Map<String, Object> row, String kind) {
        return (List<Map<String, Object>>) ((Map<String, Object>) row.get("members")).get(kind);
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> refs(Map<String, Object> row) {
        return (List<Map<String, Object>>) row.get("refs");
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> dangling(Map<String, Object> row) {
        return (List<Map<String, Object>>) row.get("dangling");
    }

    public static String status(Map<String, Object> row) {
        return !dangling(row).isEmpty() ? "Selects nothing" : Json.bool(row, "unused") ? "Not used by any policy" : "OK";
    }
}
