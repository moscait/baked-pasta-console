package io.moscait.bpc.canvas;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import io.moscait.bpc.canvas.AcModel.AcKind;
import io.moscait.bpc.canvas.AcModel.AcLayout;
import io.moscait.bpc.canvas.BoardLogic.Board;
import io.moscait.bpc.canvas.BoardLogic.BoardFilters;
import io.moscait.bpc.canvas.BoardLogic.BoardMarks;
import io.moscait.bpc.canvas.BoardLogic.BoardNode;

/** The network audit shown in the Problems dialog and counted on the dashboard. */
public final class Problems {

    private Problems() {
    }

    public static final Map<AcKind, String> ENTITY_ROUTE = Map.of(AcKind.IDENTITY, "identities", AcKind.SERVICE,
            "services", AcKind.ROUTER, "routers");

    public static final Map<String, String> POLICY_ROUTE = Map.of("dial", "service-policies", "bind",
            "service-policies", "erp", "router-policies", "serp", "service-router-policies");

    private static final Map<String, String> POLICY_LABEL = Map.of("dial", "Dial policy", "bind", "Bind policy", "erp",
            "Router Policy", "serp", "Service Router Policy");

    private static final Map<String, String> HINTS = Map.ofEntries(
            Map.entry("Not enrolled",
                    "Enroll it with its one-time token (JWT), shown in the Token column on the Identities page. The token expires; create a new one if it has."),
            Map.entry("No edge router policy",
                    "Add a Router Policy whose Identity Attributes include this identity (for example #all on #all)."),
            Map.entry("Hosting identity is offline",
                    "Start the tunneler on the machine that hosts its services, or check its network."),
            Map.entry("Not hosted",
                    "Add a Bind service policy whose Service Attributes select this service and whose Identity Attributes select the identity running next to the server."),
            Map.entry("Host not enrolled", "Enroll the identity that hosts it (see its Token on the Identities page)."),
            Map.entry("No service edge router policy",
                    "Add a Service Router Policy whose Service Attributes include this service (for example #all on #all)."),
            Map.entry("Nobody can use it",
                    "Add a Dial service policy that selects this service, or give the service a role attribute an existing Dial policy already selects."),
            Map.entry("Offline", "Check that the router process is running and can reach the controller."),
            Map.entry("Selects no identities",
                    "Give the intended identities this role attribute (Roles on the Identities page), or change the policy's Identity Attributes."),
            Map.entry("Selects no services",
                    "Give the intended services this role attribute (Roles on the Services page), or change the policy's Service Attributes."),
            Map.entry("Selects no routers",
                    "Give the intended routers this role attribute, or change the policy's Router Attributes."),
            Map.entry("Names a missing identity", "The @name it refers to no longer exists. Edit the policy."),
            Map.entry("Names a missing service", "The @name it refers to no longer exists. Edit the policy."),
            Map.entry("Names a missing router", "The @name it refers to no longer exists. Edit the policy."));

    /** kind is "identity", "service", "router" or "policy". */
    public record ProblemRow(String id, String kind, String typeLabel, String name, String problem, String detail,
            String hint, String node, String route) {
    }

    public record Result(List<ProblemRow> rows, int total) {
    }

    /** Every problem on the (draft) network, ignoring the board's current filters. */
    public static Result collect(AcModel draft, AcLayout layout) {
        Board all = BoardLogic.buildBoard(draft, layout, BoardFilters.showEverything(), new BoardMarks(), Set.of());
        List<ProblemRow> rows = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (BoardNode n : all.nodes()) {
            if (n.type.equals("group")) {
                for (var mb : n.members) {
                    entity(rows, seen, mb.kind, mb.id, mb.name, "m|" + n.key + "|" + mb.id, mb.problems);
                }
            } else if (n.type.equals("free")) {
                entity(rows, seen, n.kind, n.entity.id, n.entity.name, n.key, n.problems);
            } else if (!n.problems.isEmpty()) {
                push(rows, "policy", POLICY_LABEL.get(n.policy.family()), n.policy.name(), n.key,
                        POLICY_ROUTE.get(n.policy.family()), n.problems);
            }
        }
        Set<String> distinct = new HashSet<>();
        for (ProblemRow r : rows) {
            distinct.add(r.node().startsWith("m|") ? r.route() + "/" + r.name() : r.node());
        }
        return new Result(rows, distinct.size());
    }

    private static void entity(List<ProblemRow> rows, Set<String> seen, AcKind kind, String id, String name, String node,
            List<String> problems) {
        if (problems.isEmpty() || !seen.add(kind.one + ":" + id)) {
            return;
        }
        push(rows, kind.one, kind.title(), name, node, ENTITY_ROUTE.get(kind), problems);
    }

    private static void push(List<ProblemRow> rows, String kind, String typeLabel, String name, String node, String route,
            List<String> problems) {
        for (String text : problems) {
            int i = text.indexOf(": ");
            String problem = i > 0 ? text.substring(0, i) : text;
            String detail = i > 0 ? text.substring(i + 2) : "";
            rows.add(new ProblemRow(node + "|" + text, kind, typeLabel, name, problem, detail,
                    HINTS.getOrDefault(problem, ""), node, route));
        }
    }
}
