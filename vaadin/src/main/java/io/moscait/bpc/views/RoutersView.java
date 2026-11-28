package io.moscait.bpc.views;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.ui.CreateIntent;
import io.moscait.bpc.ui.EntityGrid;
import io.moscait.bpc.ui.FormDialog;
import io.moscait.bpc.ui.JwtPanel;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.TabSwitch;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ui.ZitiView;
import io.moscait.bpc.ziti.FormValues;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiService;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;

@Route(value = "routers", layout = MainLayout.class)
@RouteAlias(value = "transit-routers", layout = MainLayout.class)
@PageTitle("Routers")
public class RoutersView extends ZitiView implements BeforeEnterObserver {

    private final TabSwitch tabs = new TabSwitch();
    private final EntityGrid edge = new EntityGrid("OpenZiti Edge Routers");
    private final EntityGrid transit = new EntityGrid("OpenZiti Transit Routers");
    private String pendingIntent;

    public RoutersView(ZitiService ziti) {
        super(ziti);
        edge.name("Edge Router Name");
        edge.attributes("Role Attributes", "roleAttributes");
        edge.component("Status", RoutersView::statusOf, RoutersView::statusChip);
        edge.text("Tunneler", r -> Json.bool(r, "isTunnelerEnabled") ? "Enabled" : "Off");
        edge.number("Cost", r -> Json.num(r, "cost") == null ? 0 : Json.num(r, "cost"));
        edge.text("Version", r -> Json.strOr(r, "versionInfo.version", "—"));
        configure(edge, "edge-routers", "New Edge Router");

        transit.name("Transit Router Name");
        transit.component("Status", RoutersView::statusOf, RoutersView::statusChip);
        transit.number("Cost", r -> Json.num(r, "cost") == null ? 0 : Json.num(r, "cost"));
        transit.text("Traversal", r -> Json.bool(r, "noTraversal") ? "No traversal" : "Allowed");
        configure(transit, "transit-routers", "New Transit Router");

        tabs.add("routers", "Edge Routers", edge).add("transit-routers", "Transit Routers", transit);

        add(Ui.page(Ui.pageHeader("Edge & Fabric Routers",
                "Mesh overlay routers that transport and terminate encrypted zero-trust traffic."), tabs.tabs(),
                tabs.content()));
    }

    private void configure(EntityGrid g, String kind, String createLabel) {
        g.onCreate(createLabel, () -> openForm(kind, null));
        g.onEdit(r -> openForm(kind, r));
        g.onDelete(r -> {
            ziti.remove(kind, Json.str(r, "id"));
            Toast.info(kind.equals("edge-routers") ? "Edge Router deleted" : "Transit Router deleted", Json.str(r, "name"));
        });
        g.extraActions(r -> {
            List<Component> out = new ArrayList<>();
            if (Json.str(r, "enrollmentJwt") != null) {
                out.add(Ui.iconButton(VaadinIcon.QRCODE, "Enrollment JWT for " + Json.str(r, "name"), () -> openJwt(kind, Json.str(r, "id"))));
            }
            out.add(Ui.iconButton(VaadinIcon.ROTATE_LEFT, "Re-enroll: revoke the router's certificate and issue a new enrollment JWT",
                    () -> Ui.confirm("Re-enroll " + Json.str(r, "name") + "?",
                            "The router's certificate is revoked now. If it is connected it disconnects, and it stays "
                                    + "offline until it enrolls again with the new JWT.",
                            "Re-enroll", true, () -> Ui.attempt("Re-enroll failed", () -> {
                                ziti.reEnrollRouter(kind, r);
                                Toast.success("Router re-enrolled", Json.str(r, "name") + " has a new enrollment JWT.");
                                openJwt(kind, Json.str(r, "id"));
                            }))));
            return out;
        });
    }

    static boolean awaitingEnrollment(Map<String, Object> r) {
        return Json.str(r, "enrollmentJwt") != null && !Json.bool(r, "isVerified");
    }

    static String statusOf(Map<String, Object> r) {
        return Json.bool(r, "isOnline") ? "Online" : awaitingEnrollment(r) ? "Awaiting enrollment" : "Offline";
    }

    static Component statusChip(Map<String, Object> r) {
        String s = statusOf(r);
        return Ui.chip("● " + s, s.equals("Online") ? "ok" : s.equals("Offline") ? "bad" : "warn");
    }

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        tabs.select(TabSwitch.firstSegment(event));
        pendingIntent = CreateIntent.consume(event);
    }

    @Override
    protected void reload() {
        List<Map<String, Object>> ers = ziti.list("edge-routers");
        List<Map<String, Object>> trs = ziti.list("transit-routers");
        edge.setRows(ers);
        transit.setRows(trs);
        tabs.count("routers", ers.size());
        tabs.count("transit-routers", trs.size());
        if ("edge-router".equals(pendingIntent)) {
            pendingIntent = null;
            tabs.select("routers");
            openForm("edge-routers", null);
        }
    }

    private void openForm(String kind, Map<String, Object> editing) {
        boolean isNew = editing == null;
        boolean isEdge = kind.equals("edge-routers");
        String label = isEdge ? "Edge Router" : "Transit Router";
        TextField name = FormDialog.text("Name", isNew ? "" : Json.str(editing, "name"), "e.g. us-west-edge-01", null);
        TextField roles = FormDialog.text("Role attributes",
                isNew ? "public" : String.join(", ", Json.strings(editing, "roleAttributes")), null,
                "Edge router policies select routers by these, e.g. #public.");
        TextField cost = FormDialog.text("Cost",
                isNew || Json.num(editing, "cost") == null ? "0" : String.valueOf(Json.num(editing, "cost").intValue()),
                null, "0–65535. Higher-cost routers are avoided when a cheaper path exists.");
        Checkbox noTraversal = FormDialog.check("No traversal", !isNew && Json.bool(editing, "noTraversal"),
                "Circuits may start or end here but never pass through this router.");
        Checkbox tunneler = FormDialog.check("Tunneler enabled", !isNew && Json.bool(editing, "isTunnelerEnabled"),
                "Runs a built-in tunneler with its own identity so the router can host or intercept services.");
        TextArea appData = FormDialog.area("App data", isNew ? "" : FormValues.formatJsonObject(Json.obj(editing, "appData")),
                null, true);
        FormDialog d = new FormDialog(isNew ? "Create " + label : "Edit " + label + ": " + Json.str(editing, "name"),
                isNew ? "Create " + label : "Save changes", false, errors -> {
                    if (name.getValue().isBlank()) {
                        errors.add("Name is required.");
                    }
                    int c = 0;
                    try {
                        c = FormValues.parseWholeNumber(cost.getValue(), "Cost", 0, 65535, 0);
                    } catch (IllegalArgumentException e) {
                        errors.add(e.getMessage());
                    }
                    Map<String, Object> app = null;
                    if (isEdge) {
                        try {
                            app = FormValues.parseJsonObject(appData.getValue());
                        } catch (IllegalArgumentException e) {
                            errors.add("App data: " + e.getMessage());
                        }
                    }
                    if (!errors.isEmpty()) {
                        return;
                    }
                    Map<String, Object> body = Json.map("name", name.getValue().trim(), "cost", c, "noTraversal",
                            noTraversal.getValue());
                    if (isEdge) {
                        body.put("roleAttributes", FormValues.splitList(roles.getValue()));
                        body.put("isTunnelerEnabled", tunneler.getValue());
                        body.put("appData", app);
                    }
                    if (isNew) {
                        String id = ziti.create(kind, body);
                        Toast.success(label + " created", Json.str(body, "name"));
                        if (id != null) {
                            openJwt(kind, id);
                        }
                    } else {
                        ziti.patch(kind, Json.str(editing, "id"), body);
                        Toast.success(label + " updated", Json.str(body, "name"));
                    }
                });
        d.fields(name);
        if (isEdge) {
            d.fields(roles);
        }
        d.fields(cost, noTraversal);
        if (isEdge) {
            d.fields(tunneler, appData);
        }
        d.open();
        name.focus();
    }

    private void openJwt(String kind, String id) {
        Map<String, Object> r = ziti.list(kind).stream().filter(x -> id.equals(x.get("id"))).findFirst().orElse(null);
        if (r == null) {
            return;
        }
        String name = Json.str(r, "name");
        Dialog d = new Dialog();
        d.setHeaderTitle("Enroll Router: " + name);
        d.setWidth("min(640px, 96vw)");
        d.getHeader().add(Ui.iconButton(VaadinIcon.CLOSE, "Close", d::close));
        Paragraph p = new Paragraph("Copy this one-time token to the router host and enroll it. The router stays offline until it does.");
        p.addClassNames("bp-small", "bp-muted");
        d.add(p);
        String jwt = Json.str(r, "enrollmentJwt");
        d.add(jwt == null ? Ui.callout(null, "This router has no outstanding enrollment token.")
                : new JwtPanel(jwt, name, Json.str(r, "enrollmentExpiresAt")));
        d.add(Ui.pre("ziti router enroll config.yml --jwt " + name + ".jwt"));
        d.open();
    }
}
