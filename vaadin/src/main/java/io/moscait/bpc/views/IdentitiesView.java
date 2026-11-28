package io.moscait.bpc.views;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.sessions.SessionMonitor;
import io.moscait.bpc.sessions.SessionMonitor.IdentitySummary;
import io.moscait.bpc.sessions.SessionMonitor.Report;
import io.moscait.bpc.ui.CreateIntent;
import io.moscait.bpc.ui.EntityGrid;
import io.moscait.bpc.ui.FormDialog;
import io.moscait.bpc.ui.JwtPanel;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ui.ZitiView;
import io.moscait.bpc.ziti.FormValues;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiException;
import io.moscait.bpc.ziti.ZitiService;
import io.moscait.bpc.ziti.ZitiService.ConfigOverride;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.datetimepicker.DateTimePicker;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.QueryParameters;
import com.vaadin.flow.router.Route;

@Route(value = "identities", layout = MainLayout.class)
@PageTitle("Identities")
public class IdentitiesView extends ZitiView implements BeforeEnterObserver {

    private static final List<String[]> ENROLLMENT = List.of(new String[] { "ott", "One-time token (JWT)" },
            new String[] { "ottca", "One-time token + third-party CA" },
            new String[] { "updb", "Username / password" }, new String[] { "none", "None (enroll later)" });
    private static final List<String> PRECEDENCES = List.of("default", "required", "failed");

    private final EntityGrid grid = new EntityGrid("Identities");
    private Report report;
    private String pendingIntent;

    public IdentitiesView(ZitiService ziti) {
        super(ziti);
        grid.component("Identity Name", r -> Json.str(r, "name"), r -> {
            Span n = Ui.mono(Json.str(r, "name"));
            n.addClassName("bp-strong");
            Div d = new Div(n);
            d.getStyle().set("display", "flex").set("gap", "6px").set("align-items", "center");
            if (Json.bool(r, "isAdmin")) {
                d.add(Ui.chip("Admin", "dial"));
            }
            return d;
        }).setFlexGrow(1);
        grid.attributes("Role Attributes", "roleAttributes");
        grid.component("Enrollment Status", r -> enrolled(r) ? "Enrolled" : "Pending JWT", r -> {
            if (enrolled(r)) {
                return Ui.chip("● Enrolled", "ok");
            }
            Button b = new Button("Pending Token (Enroll)", VaadinIcon.QRCODE.create(), e -> openToken(Json.str(r, "id")));
            b.addThemeVariants(ButtonVariant.SMALL, ButtonVariant.WARNING);
            return b;
        });
        grid.component("Connection & Client IPs", this::connectionText, this::connectionCell);
        grid.text("Tunneler / SDK", r -> {
            String app = Json.strOr(r, "sdkInfo.appId", Json.str(r, "sdkInfo.type"));
            return app == null ? "—" : app + " " + Json.strOr(r, "sdkInfo.version", "");
        });
        grid.onCreate("New Identity", () -> openForm(null));
        grid.onEdit(this::openForm);
        grid.onDelete(r -> {
            ziti.remove("identities", Json.str(r, "id"));
            Toast.info("Identity deleted", Json.str(r, "name"));
        });
        grid.extraActions(r -> {
            List<Component> out = new ArrayList<>();
            if (jwtOf(r) != null) {
                Button qr = Ui.iconButton(VaadinIcon.QRCODE, "Enrollment JWT & QR Code", () -> openToken(Json.str(r, "id")));
                out.add(qr);
            }
            out.add(Ui.iconButton(VaadinIcon.SLIDERS, "Service config overrides for " + Json.str(r, "name"),
                    () -> openOverrides(r)));
            if (!Json.bool(r, "isDefaultAdmin")) {
                out.add(Ui.iconButton(VaadinIcon.KEY, "Credentials: reset enrollment, reissue token, reset MFA",
                        () -> openCredentials(r)));
            }
            return out;
        });

        add(Ui.page(Ui.pageHeader("Identities",
                "Devices, users, servers, and workloads with cryptographic certificates on the OpenZiti overlay."), grid));
    }

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        pendingIntent = CreateIntent.consume(event);
        String q = CreateIntent.param(event, "q");
        if (q != null) {
            grid.setSearch(q);
        }
    }

    @Override
    protected void reload() {
        List<Map<String, Object>> rows = ziti.list("identities");
        List<Map<String, Object>> apiSessions;
        try {
            apiSessions = ziti.list("api-sessions");
        } catch (RuntimeException e) {
            apiSessions = List.of();
        }
        report = SessionMonitor.evaluate(rows, apiSessions, List.of(), List.of(), ziti.getConcurrencyPolicy(),
                ziti.currentSessionToken(), System.currentTimeMillis());
        grid.setRows(rows);
        if ("identity".equals(pendingIntent)) {
            pendingIntent = null;
            openForm(null);
        }
    }

    // ------------------------------------------------------------------ cells

    static String jwtOf(Map<String, Object> r) {
        for (String k : List.of("ott", "updb", "ca")) {
            String j = Json.str(r, "enrollment." + k + ".jwt");
            if (j != null) {
                return j;
            }
        }
        return null;
    }

    static String jwtExpiry(Map<String, Object> r) {
        for (String k : List.of("ott", "updb", "ca")) {
            String j = Json.str(r, "enrollment." + k + ".expiresAt");
            if (j != null) {
                return j;
            }
        }
        return null;
    }

    static boolean enrolled(Map<String, Object> r) {
        return !Json.isEmptyObj(r.get("authenticators")) || Json.isEmptyObj(r.get("enrollment"));
    }

    private IdentitySummary summary(Map<String, Object> r) {
        return report == null ? null : report.byIdentity().get(Json.str(r, "id"));
    }

    private Object connectionText(Map<String, Object> r) {
        IdentitySummary s = summary(r);
        if (s != null && s.finding != null) {
            return "Concurrent (" + String.join(", ", s.distinctLiveIps) + ")";
        }
        return Json.bool(r, "hasEdgeRouterConnection")
                ? "Online " + (s == null ? "" : String.join(", ", s.distinctLiveIps))
                : "Offline";
    }

    private Component connectionCell(Map<String, Object> r) {
        boolean online = Json.bool(r, "hasEdgeRouterConnection");
        IdentitySummary s = summary(r);
        List<String> ips = s == null ? List.of() : s.distinctLiveIps;
        Div d = new Div();
        d.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("gap", "6px").set("align-items", "center");
        Span state = new Span(online ? "● Connected" : "○ Offline");
        state.addClassName(online ? "bp-ok" : "bp-muted");
        state.addClassName("bp-small");
        d.add(state);
        if (s != null && s.finding != null) {
            Button b = new Button(ips.size() >= 2 ? ips.size() + " IPs" : s.liveSessionCount + " sessions",
                    VaadinIcon.WARNING.create(), e -> UI.getCurrent().navigate("sessions",
                            QueryParameters.of("q", Json.str(r, "name"))));
            b.addThemeVariants(ButtonVariant.SMALL, ButtonVariant.ERROR);
            b.setTooltipText(s.finding.summary() + " — click to inspect in Traffic & Sessions");
            d.add(b);
        } else if (!ips.isEmpty()) {
            Button b = new Button(String.join(", ", ips),
                    e -> UI.getCurrent().navigate("sessions", QueryParameters.of("ip", ips.getFirst())));
            b.addThemeVariants(ButtonVariant.SMALL, ButtonVariant.TERTIARY);
            b.addClassName("bp-mono");
            b.setTooltipText("Filter Traffic & Sessions by this IP");
            d.add(b);
        }
        return d;
    }

    // ------------------------------------------------------------------ create / edit

    private void openForm(Map<String, Object> editing) {
        boolean isNew = editing == null;
        List<Map<String, Object>> cas = List.of();
        List<Map<String, Object>> policies = List.of();
        String lookupError = null;
        try {
            cas = ziti.list("cas");
            policies = ziti.list("auth-policies");
        } catch (RuntimeException e) {
            lookupError = "Couldn't load CAs and auth policies: " + ZitiException.text(e);
        }
        TextField name = FormDialog.text("Identity name", isNew ? "" : Json.str(editing, "name"),
                "e.g. jdoe-laptop or billing-db-host", null);
        TextField roles = FormDialog.text("Role attributes",
                isNew ? "" : String.join(", ", Json.strings(editing, "roleAttributes")), "e.g. sales, employees, ssh-users",
                "Policies grant Dial or Bind access by these, e.g. #sales.");
        Checkbox admin = FormDialog.check("Admin", !isNew && Json.bool(editing, "isAdmin"),
                "Full Edge Management API privileges.");
        admin.setEnabled(isNew || !Json.bool(editing, "isDefaultAdmin"));

        Select<String> method = FormDialog.select("Method", ENROLLMENT.stream().map(x -> x[0]).toList(), "ott",
                v -> ENROLLMENT.stream().filter(x -> x[0].equals(v)).map(x -> x[1]).findFirst().orElse(v));
        Select<String> ca = FormDialog.entitySelect("Certificate authority", cas, "", "Choose a CA…");
        TextField upUser = FormDialog.text("Username", "", null, null);
        ca.setVisible(false);
        upUser.setVisible(false);
        method.addValueChangeListener(e -> {
            ca.setVisible("ottca".equals(e.getValue()));
            upUser.setVisible("updb".equals(e.getValue()));
        });

        String currentPolicy = isNew ? null : Json.strOr(editing, "authPolicyId", Json.str(editing, "authPolicy.id"));
        Select<String> policy = FormDialog.entitySelect("Auth policy", policies, currentPolicy == null ? "" : currentPolicy,
                currentPolicy == null ? "Controller default" : null);
        TextField externalId = FormDialog.text("External ID", isNew ? "" : Json.str(editing, "externalId"), null,
                "Matched by JWT signers and CAs that map users by external ID.");
        TextField cost = FormDialog.text("Default hosting cost",
                isNew ? "0" : String.valueOf(Json.num(editing, "defaultHostingCost") == null ? 0
                        : Json.num(editing, "defaultHostingCost").intValue()),
                null, "0–65535, applied to services this identity hosts.");
        Select<String> precedence = FormDialog.select("Default hosting precedence", PRECEDENCES,
                isNew ? "default" : Json.strOr(editing, "defaultHostingPrecedence", "default"), null);
        TextArea appData = FormDialog.area("App data", isNew ? "" : FormValues.formatJsonObject(Json.obj(editing, "appData")),
                "Free-form JSON that SDK applications can read about themselves.", true);

        String preError = lookupError;
        FormDialog d = new FormDialog(isNew ? "Create Identity" : "Edit Identity: " + Json.str(editing, "name"),
                isNew ? "Create identity" : "Save changes", true, errors -> {
                    if (name.getValue().isBlank()) {
                        errors.add("Name is required.");
                    }
                    if (isNew && "ottca".equals(method.getValue()) && (ca.getValue() == null || ca.getValue().isEmpty())) {
                        errors.add("Choose the CA the identity will enroll with.");
                    }
                    if (isNew && "updb".equals(method.getValue()) && upUser.getValue().isBlank()) {
                        errors.add("Enter the username to enroll.");
                    }
                    int c = 0;
                    try {
                        c = FormValues.parseWholeNumber(cost.getValue(), "Default hosting cost", 0, 65535, 0);
                    } catch (IllegalArgumentException e) {
                        errors.add(e.getMessage());
                    }
                    Map<String, Object> app = null;
                    try {
                        app = FormValues.parseJsonObject(appData.getValue());
                    } catch (IllegalArgumentException e) {
                        errors.add("App data: " + e.getMessage());
                    }
                    if (!errors.isEmpty()) {
                        return;
                    }
                    Map<String, Object> body = Json.map("name", name.getValue().trim(), "isAdmin", admin.getValue(),
                            "roleAttributes", FormValues.splitList(roles.getValue()), "externalId",
                            externalId.getValue().isBlank() ? null : externalId.getValue().trim(), "defaultHostingCost", c,
                            "defaultHostingPrecedence", precedence.getValue(), "appData", app);
                    if (policy.getValue() != null && !policy.getValue().isEmpty()) {
                        body.put("authPolicyId", policy.getValue());
                    }
                    if (isNew) {
                        body.put("type", "Default");
                        body.put("enrollment", switch (method.getValue()) {
                            case "ottca" -> Json.map("ottca", ca.getValue());
                            case "updb" -> Json.map("updb", upUser.getValue().trim());
                            case "none" -> Json.map();
                            default -> Json.map("ott", true);
                        });
                        String id = ziti.create("identities", body);
                        Toast.success("Identity created", "none".equals(method.getValue()) ? Json.str(body, "name")
                                : Json.str(body, "name") + " is ready for enrollment.");
                        if (!"none".equals(method.getValue()) && id != null) {
                            UI.getCurrent().access(() -> openToken(id));
                        }
                    } else {
                        ziti.patch("identities", Json.str(editing, "id"), body);
                        Toast.success("Identity updated", Json.str(body, "name"));
                    }
                });
        d.fields(FormDialog.grid(name, roles), admin);
        if (isNew) {
            d.fields(FormDialog.section("Enrollment", FormDialog.grid(method, ca, upUser)));
        }
        d.fields(FormDialog.section("Authentication", FormDialog.grid(policy, externalId)),
                FormDialog.section("Hosting defaults", FormDialog.grid(cost, precedence)), appData);
        if (preError != null) {
            d.showErrors(List.of(preError));
        }
        d.open();
        name.focus();
    }

    // ------------------------------------------------------------------ token dialog

    private void openToken(String id) {
        Map<String, Object> row = ziti.list("identities").stream().filter(r -> id.equals(r.get("id"))).findFirst()
                .orElse(null);
        if (row == null) {
            return;
        }
        String name = Json.str(row, "name");
        String jwt = jwtOf(row);
        Dialog d = new Dialog();
        d.setHeaderTitle("Enroll Identity: " + name);
        d.setWidth("min(680px, 96vw)");
        d.getHeader().add(Ui.iconButton(VaadinIcon.CLOSE, "Close", d::close));
        Paragraph p = new Paragraph();
        p.addClassNames("bp-small", "bp-muted");
        p.add(new Span("Scan this QR code with Ziti Mobile Edge (iOS / Android), download the "), new Code(".jwt"),
                new Span(" file for Ziti Desktop Edge, or run the Linux tunneler command below."));
        d.add(p);
        if (jwt == null) {
            d.add(Ui.callout(null, "This identity has no pending enrollment token."));
        } else {
            Div side = new Div();
            side.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "10px").set("flex", "1")
                    .set("min-width", "0");
            side.add(Ui.strong(name + ".jwt"), JwtPanel.actions(jwt, name, jwtExpiry(row)));
            if (ziti.isDemoMode()) {
                Button sim = new Button("Simulate Tunneler Enrollment Now", VaadinIcon.USER_CHECK.create(), e -> {
                    ziti.simulateEnrollDemoIdentity(id);
                    Toast.success("Enrolled!", name + " is now enrolled and online.");
                    d.close();
                });
                sim.addThemeVariants(ButtonVariant.SUCCESS);
                side.add(sim);
            }
            Div box = Ui.callout(null, JwtPanel.qr(jwt, 150), side);
            box.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("gap", "20px").set("align-items", "center");
            d.add(box);
        }
        Div cmd = new Div(Ui.strong("Linux Server / CLI Enrollment Command"),
                Ui.pre("sudo ziti-edge-tunnel enroll --jwt " + name + ".jwt --identity /opt/openziti/etc/identities/"
                        + name + ".json"));
        cmd.getStyle().set("margin-top", "14px").set("display", "flex").set("flex-direction", "column").set("gap", "6px");
        d.add(cmd);
        d.open();
    }

    // ------------------------------------------------------------------ credentials

    private void openCredentials(Map<String, Object> row) {
        String name = Json.str(row, "name");
        boolean hasAuth = Json.str(row, "authenticators.cert.id") != null || Json.str(row, "authenticators.updb.id") != null;
        boolean pending = jwtOf(row) != null || Json.str(row, "enrollment.ottca.id") != null;
        Dialog d = new Dialog();
        d.setHeaderTitle("Credentials: " + name);
        d.setWidth("min(560px, 96vw)");
        d.getHeader().add(Ui.iconButton(VaadinIcon.CLOSE, "Close", d::close));
        Div err = new Div();
        DateTimePicker expiry = new DateTimePicker("New token expires");
        expiry.setValue(LocalDateTime.now().plusDays(2).withSecond(0).withNano(0));
        expiry.setMin(LocalDateTime.now().plusMinutes(1));
        expiry.setWidthFull();

        Div body = new Div();
        body.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "12px");
        if (hasAuth || pending) {
            body.add(expiry);
        }
        java.util.function.Function<String, Boolean> run = kind -> {
            Instant at = expiry.getValue() == null ? null : expiry.getValue().atZone(ZoneId.systemDefault()).toInstant();
            if (!kind.equals("mfa") && (at == null || at.isBefore(Instant.now().plusSeconds(60)))) {
                err.removeAll();
                err.add(Ui.errors(List.of("Pick an expiry at least a minute in the future.")));
                return false;
            }
            try {
                switch (kind) {
                    case "reset" -> ziti.resetEnrollment(row, at);
                    case "reissue" -> ziti.reissueEnrollment(row, at);
                    default -> ziti.resetMfa(row);
                }
            } catch (RuntimeException e) {
                err.removeAll();
                err.add(Ui.errors(List.of(ZitiException.text(e))));
                return false;
            }
            d.close();
            if (kind.equals("mfa")) {
                Toast.success("MFA reset", name + " must set up MFA again at next sign-in.");
            } else {
                Toast.success(kind.equals("reset") ? "Enrollment reset" : "Enrollment token reissued",
                        name + ": new token expires " + Ui.dateTime(at.toString()) + ".");
                openToken(Json.str(row, "id"));
            }
            return true;
        };
        if (pending) {
            Button b = Ui.primary("Reissue token", VaadinIcon.ROTATE_LEFT, () -> run.apply("reissue"));
            body.add(Ui.callout(null, new Div(Ui.strong("Reissue enrollment token")),
                    new Paragraph("Replaces the pending one-time token. The current JWT and QR code stop working."), b));
        }
        if (hasAuth) {
            String what = Json.path(row, "authenticators.cert") != null ? "certificate" : "password";
            Button reset = new Button("Reset enrollment…", VaadinIcon.ROTATE_LEFT.create());
            reset.addThemeVariants(ButtonVariant.ERROR);
            reset.addClickListener(e -> Ui.confirm("Reset " + name + "?",
                    "The device disconnects and cannot reconnect until it enrolls again with the new token.",
                    "Yes, reset " + name, true, () -> run.apply("reset")));
            body.add(Ui.callout("error", new Div(Ui.strong("Reset enrollment")),
                    new Paragraph("Revokes the " + what + " this identity uses now and issues a new one-time token. "
                            + "The device disconnects and cannot reconnect until it enrolls again."),
                    reset));
        }
        boolean mfaOff = Boolean.FALSE.equals(Json.boolOrNull(row, "isMfaEnabled"));
        Button mfa = Ui.button("Reset MFA", VaadinIcon.SHIELD, () -> run.apply("mfa"));
        mfa.setEnabled(!mfaOff);
        body.add(Ui.callout(null, new Div(Ui.strong("Reset MFA")), new Paragraph(mfaOff
                ? "MFA is not set up for this identity."
                : "Removes the identity's TOTP enrollment so the user can set up MFA again (e.g. after losing a phone)."),
                mfa));
        body.add(err);
        d.add(body);
        d.open();
    }

    // ------------------------------------------------------------------ config overrides

    private void openOverrides(Map<String, Object> identity) {
        String identityId = Json.str(identity, "id");
        String name = Json.str(identity, "name");
        Dialog d = new Dialog();
        d.setHeaderTitle("Config overrides: " + name);
        d.setWidth("min(760px, 96vw)");
        d.getHeader().add(Ui.iconButton(VaadinIcon.CLOSE, "Close", d::close));
        List<Map<String, Object>> services;
        List<Map<String, Object>> configs;
        try {
            services = ziti.list("services");
            configs = ziti.list("configs");
        } catch (RuntimeException e) {
            Toast.error("Failed to load services and configs", ZitiException.text(e));
            return;
        }
        Paragraph lead = new Paragraph("When this identity uses a service, an override replaces the service's config of the "
                + "same type, e.g. a different intercept address or host for just this device.");
        lead.addClassNames("bp-small", "bp-muted");
        Grid<ConfigOverride> table = new Grid<>();
        table.setAllRowsVisible(true);
        table.setEmptyStateText("No overrides.");
        table.addColumn(ConfigOverride::serviceName).setHeader("Service");
        table.addColumn(o -> configLabel(configs, o.configId(), o.configName())).setHeader("Config");
        Div err = new Div();
        Runnable[] refresh = new Runnable[1];
        table.addComponentColumn(o -> {
            Button rm = Ui.iconButton(VaadinIcon.TRASH, "Remove override for " + o.serviceName(), () -> {
                try {
                    ziti.removeServiceConfigOverride(identityId, o.serviceId(), o.configId());
                    Toast.success("Override removed", name + " → " + o.serviceName());
                    refresh[0].run();
                } catch (RuntimeException e) {
                    err.removeAll();
                    err.add(Ui.errors(List.of(ZitiException.text(e))));
                }
            });
            rm.addThemeVariants(ButtonVariant.ERROR);
            return rm;
        }).setFlexGrow(0).setAutoWidth(true);
        refresh[0] = () -> {
            try {
                table.setItems(ziti.listServiceConfigOverrides(identityId));
            } catch (RuntimeException e) {
                err.removeAll();
                err.add(Ui.errors(List.of(ZitiException.text(e))));
            }
        };
        refresh[0].run();
        Select<String> svc = FormDialog.entitySelect("Service", services, "", "Choose a service…");
        Select<String> cfg = new Select<>();
        cfg.setLabel("Config");
        List<String> ids = new ArrayList<>(List.of(""));
        configs.forEach(c -> ids.add(Json.str(c, "id")));
        cfg.setItems(ids);
        cfg.setItemLabelGenerator(id -> id == null || id.isEmpty() ? "Choose a config…" : configLabel(configs, id, id));
        cfg.setValue("");
        Button add = Ui.primary("Add override", VaadinIcon.PLUS, () -> {
            if (svc.getValue() == null || svc.getValue().isEmpty() || cfg.getValue() == null || cfg.getValue().isEmpty()) {
                return;
            }
            try {
                ziti.addServiceConfigOverride(identityId, svc.getValue(), cfg.getValue());
                String sname = services.stream().filter(s -> svc.getValue().equals(s.get("id")))
                        .map(s -> Json.str(s, "name")).findFirst().orElse(svc.getValue());
                Toast.success("Override added", name + " → " + sname);
                cfg.setValue("");
                refresh[0].run();
            } catch (RuntimeException e) {
                err.removeAll();
                err.add(Ui.errors(List.of(ZitiException.text(e))));
            }
        });
        Div form = new Div(svc, cfg, add);
        form.getStyle().set("display", "grid").set("grid-template-columns", "1fr 1fr auto").set("gap", "12px")
                .set("align-items", "end");
        d.add(lead, table, form, err);
        d.open();
    }

    private static String configLabel(List<Map<String, Object>> configs, String id, String fallback) {
        return configs.stream().filter(c -> id.equals(c.get("id")))
                .map(c -> Json.str(c, "name") + " (" + Json.strOr(c, "configType.name", Json.str(c, "configTypeId")) + ")")
                .findFirst().orElse(fallback);
    }
}
