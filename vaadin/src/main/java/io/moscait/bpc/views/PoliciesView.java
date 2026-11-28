package io.moscait.bpc.views;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.ui.CreateIntent;
import io.moscait.bpc.ui.EntityGrid;
import io.moscait.bpc.ui.FormDialog;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.TabSwitch;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ui.ZitiView;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiService;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;

@Route(value = "service-policies", layout = MainLayout.class)
@RouteAlias(value = "router-policies", layout = MainLayout.class)
@RouteAlias(value = "service-router-policies", layout = MainLayout.class)
@PageTitle("Policies")
public class PoliciesView extends ZitiView implements BeforeEnterObserver {

    /** Tab id (route) → API collection. */
    private static final Map<String, String> API = Map.of("service-policies", "service-policies", "router-policies",
            "edge-router-policies", "service-router-policies", "service-edge-router-policies");

    private final TabSwitch tabs = new TabSwitch();
    private final EntityGrid sp = new EntityGrid("Service Policies");
    private final EntityGrid erp = new EntityGrid("Edge Router Policies");
    private final EntityGrid serp = new EntityGrid("Service Edge Router Policies");
    private String pendingIntent;

    public PoliciesView(ZitiService ziti) {
        super(ziti);
        sp.name("Policy Name");
        sp.component("Type", r -> Json.str(r, "type"),
                r -> Ui.chip(Json.str(r, "type"), "Dial".equals(Json.str(r, "type")) ? "dial" : "bind"));
        sp.component("Identity Roles", r -> Json.strings(r, "identityRoles"), r -> Ui.roleChips(Json.strings(r, "identityRoles")));
        sp.component("Service Roles", r -> Json.strings(r, "serviceRoles"), r -> Ui.roleChips(Json.strings(r, "serviceRoles")));
        sp.component("Posture Checks", r -> Json.strings(r, "postureCheckRoles"),
                r -> Ui.roleChips(Json.strings(r, "postureCheckRoles")));
        sp.text("Semantic", r -> Json.strOr(r, "semantic", "AnyOf"));
        wire(sp, "service-policies", "New Service Policy", "Service policy deleted");

        erp.name("Router Policy Name");
        erp.component("Identity Roles", r -> Json.strings(r, "identityRoles"), r -> Ui.roleChips(Json.strings(r, "identityRoles")));
        erp.component("Edge Router Roles", r -> Json.strings(r, "edgeRouterRoles"),
                r -> Ui.roleChips(Json.strings(r, "edgeRouterRoles")));
        erp.text("Semantic", r -> Json.strOr(r, "semantic", "AnyOf"));
        wire(erp, "router-policies", "New Router Policy", "Router policy deleted");

        serp.name("Service Router Policy Name");
        serp.component("Service Roles", r -> Json.strings(r, "serviceRoles"), r -> Ui.roleChips(Json.strings(r, "serviceRoles")));
        serp.component("Edge Router Roles", r -> Json.strings(r, "edgeRouterRoles"),
                r -> Ui.roleChips(Json.strings(r, "edgeRouterRoles")));
        serp.text("Semantic", r -> Json.strOr(r, "semantic", "AnyOf"));
        wire(serp, "service-router-policies", "New Service Router Policy", "Service router policy deleted");

        tabs.add("service-policies", "Service Policies", sp).add("router-policies", "Router Policies", erp)
                .add("service-router-policies", "Service Router Policies", serp);
        add(Ui.page(Ui.pageHeader("Access & Routing Policies",
                "Attribute-based Dial, Bind, Edge Router, and Service Edge Router policies."), tabs.tabs(), tabs.content()));
    }

    private void wire(EntityGrid g, String tab, String createLabel, String deleted) {
        g.onCreate(createLabel, () -> openForm(tab, null));
        g.onEdit(r -> openForm(tab, r));
        g.onDelete(r -> {
            ziti.remove(API.get(tab), Json.str(r, "id"));
            Toast.info(deleted, Json.str(r, "name"));
        });
    }

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        tabs.select(TabSwitch.firstSegment(event));
        pendingIntent = CreateIntent.consume(event);
    }

    @Override
    protected void reload() {
        List<Map<String, Object>> a = ziti.list("service-policies");
        List<Map<String, Object>> b = ziti.list("edge-router-policies");
        List<Map<String, Object>> c = ziti.list("service-edge-router-policies");
        sp.setRows(a);
        erp.setRows(b);
        serp.setRows(c);
        tabs.count("service-policies", a.size());
        tabs.count("router-policies", b.size());
        tabs.count("service-router-policies", c.size());
        if ("service-policy".equals(pendingIntent)) {
            pendingIntent = null;
            tabs.select("service-policies");
            openForm("service-policies", null);
        }
    }

    /** "#a, b @c" → ["#a", "#b", "@c"]. */
    static List<String> normalizeRoles(String raw) {
        List<String> out = new ArrayList<>();
        for (String s : raw.split("[,\\s]+")) {
            String t = s.trim();
            if (!t.isEmpty()) {
                String v = t.startsWith("#") || t.startsWith("@") ? t : "#" + t;
                if (!out.contains(v)) {
                    out.add(v);
                }
            }
        }
        return out;
    }

    private void openForm(String tab, Map<String, Object> editing) {
        boolean isNew = editing == null;
        boolean isSp = tab.equals("service-policies");
        boolean isSerp = tab.equals("service-router-policies");
        String leftField = isSerp ? "serviceRoles" : "identityRoles";
        String rightField = isSp ? "serviceRoles" : "edgeRouterRoles";
        String title = isSp ? "Service Policy" : isSerp ? "Service Edge Router Policy" : "Edge Router Policy";

        TextField name = FormDialog.text("Policy Name", isNew ? "" : Json.str(editing, "name"), "e.g. developers-dial-api",
                null);
        name.addClassName("mono");
        Select<String> type = FormDialog.select("Type", List.of("Dial", "Bind"),
                isNew ? "Dial" : Json.strOr(editing, "type", "Dial"),
                v -> v.equals("Dial") ? "Dial (Client Use)" : "Bind (Server Host)");
        Select<String> semantic = FormDialog.select("Role Matching Semantic", List.of("AnyOf", "AllOf"),
                isNew ? "AnyOf" : Json.strOr(editing, "semantic", "AnyOf"),
                v -> v.equals("AnyOf") ? "AnyOf (OR)" : "AllOf (AND)");
        String leftDefault = isSp ? "#employees" : "#all";
        String rightDefault = isSp ? "#web" : "#public";
        TextField left = FormDialog.text(isSerp ? "Service Roles" : "Identity Roles",
                isNew ? leftDefault : String.join(", ", Json.strings(editing, leftField)), "#employees, #sales or #all",
                "#attribute selects by role attribute, @name selects one entity, #all selects everything.");
        TextField right = FormDialog.text(isSp ? "Service Roles" : "Edge Router Roles",
                isNew ? rightDefault : String.join(", ", Json.strings(editing, rightField)),
                isSp ? "#web, #crm-https" : "#public or #all", null);
        TextField posture = FormDialog.text("Posture Check Roles",
                isNew ? "" : String.join(", ", Json.strings(editing, "postureCheckRoles")), "#mfa-required",
                "Clients must pass these posture checks to dial.");
        left.addClassName("mono");
        right.addClassName("mono");
        posture.addClassName("mono");
        type.addValueChangeListener(e -> posture.setVisible("Dial".equals(e.getValue())));
        posture.setVisible(isSp && "Dial".equals(type.getValue()));

        FormDialog d = new FormDialog(isNew ? "Create " + title : "Edit " + title + ": " + Json.str(editing, "name"),
                isNew ? "Create Policy" : "Save changes", false, errors -> {
                    if (name.getValue().isBlank()) {
                        errors.add("Name is required.");
                        return;
                    }
                    Map<String, Object> body = Json.map("name", name.getValue().trim(), "semantic", semantic.getValue(),
                            leftField, normalizeRoles(left.getValue()), rightField, normalizeRoles(right.getValue()));
                    if (isSp) {
                        body.put("type", type.getValue());
                        body.put("postureCheckRoles",
                                "Dial".equals(type.getValue()) ? normalizeRoles(posture.getValue()) : List.of());
                    }
                    if (isNew) {
                        ziti.create(API.get(tab), body);
                        Toast.success("Policy created", Json.str(body, "name"));
                    } else {
                        ziti.patch(API.get(tab), Json.str(editing, "id"), body);
                        Toast.success("Policy updated", Json.str(body, "name"));
                    }
                });
        d.fields(name);
        d.fields(isSp ? FormDialog.grid(type, semantic) : semantic);
        d.fields(left, right);
        if (isSp) {
            d.fields(posture);
        }
        d.open();
        name.focus();
    }
}
