package com.example.views;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.example.canvas.AcModel;
import com.example.canvas.AcModel.AcIdentity;
import com.example.canvas.AcModel.AcLayout;
import com.example.canvas.AcModel.AcService;
import com.example.canvas.AccessLogic;
import com.example.canvas.Problems;
import com.example.ui.MainLayout;
import com.example.ui.Ui;
import com.example.ui.ZitiView;
import com.example.ziti.ServiceConfigs;
import com.example.ziti.ServiceConfigs.EndpointInfo;
import com.example.ziti.ZitiService;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.AnchorTarget;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H1;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;

@Route(value = "dashboard", layout = MainLayout.class)
@PageTitle("Dashboard")
public class DashboardView extends ZitiView {

    private final Div page = Ui.page();
    private final Div kpis = new Div();
    private final Div services = new Div();
    private final Div reach = new Div();
    private final Button problems = new Button();

    public DashboardView(ZitiService ziti) {
        super(ziti);
        kpis.addClassName("bp-kpis");

        Div hero = new Div();
        hero.addClassName("bp-hero");
        Span eyebrow = new Span(VaadinIcon.MAGIC.create(), new Span("Baked Pasta Console · Plug-Compatible OpenZiti ZAC"));
        eyebrow.addClassName("bp-eyebrow");
        eyebrow.getChildren().findFirst().ifPresent(i -> i.getElement().getStyle().set("width", "14px"));
        Div text = new Div(eyebrow, new H1("Zero-Trust Overlay Network Overview"), new Paragraph(
                "Manage identities, services, configurations, and policies visually on the Access Canvas or via guided end-to-end wizards."));
        Button open = Ui.primary("Open Access Canvas", VaadinIcon.CLUSTER, () -> go("access-canvas"));
        open.setSuffixComponent(VaadinIcon.ARROW_RIGHT.create());
        problems.setIcon(VaadinIcon.WARNING.create());
        problems.addThemeVariants(ButtonVariant.ERROR);
        problems.addClickListener(e -> go("access-canvas"));
        hero.add(text, Ui.toolbar(open, problems));

        Div two = new Div(panel("Published Zero-Trust Services", VaadinIcon.GLOBE, "var(--ac-bind)", "View all →",
                "services", services),
                panel("Live Path Reachability Check", VaadinIcon.LINE_CHART, "var(--ac-ok)", "Open Advisor →",
                        "access-canvas", reach));
        two.addClassName("bp-two-col");

        page.add(hero, kpis, two);
        add(page);
    }

    private static void go(String route) {
        UI.getCurrent().navigate(route);
    }

    private Component panel(String title, VaadinIcon icon, String color, String link, String route, Div body) {
        H2 h = new H2();
        h.add(Ui.icon(icon, color), new Span(title));
        Button more = new Button(link, e -> go(route));
        more.addThemeVariants(ButtonVariant.TERTIARY, ButtonVariant.SMALL);
        Div head = new Div(h, more);
        head.getStyle().set("display", "flex").set("justify-content", "space-between").set("align-items", "center");
        body.getStyle().set("margin-top", "8px");
        return Ui.card(head, body);
    }

    private Component kpi(String label, int value, String sub, VaadinIcon icon, String color, String route) {
        Div left = new Div();
        Div l = new Div(label);
        l.addClassName("label");
        Div v = new Div(String.valueOf(value));
        v.addClassName("value");
        Div s = new Div(sub);
        s.addClassName("sub");
        left.add(l, v, s);
        Div ic = new Div(Ui.icon(icon, color));
        ic.addClassName("icon");
        Div card = Ui.card(left, ic);
        card.addClassName("bp-kpi");
        card.getElement().setAttribute("role", "link");
        card.getElement().setAttribute("tabindex", "0");
        card.addClickListener(e -> go(route));
        return card;
    }

    @Override
    protected void reload() {
        AcModel m = ziti.loadCanvasModel();
        List<Map<String, Object>> cfgs = ziti.list("configs");
        int sessions = ziti.list("sessions").size();
        int probCount = Problems.collect(m, new AcLayout()).total();

        kpis.removeAll();
        kpis.add(kpi("Identities", m.identities.size(),
                m.identities.stream().filter(i -> i.online).count() + " connected", VaadinIcon.USERS, "var(--ac-dial)",
                "identities"),
                kpi("Services", m.services.size(), cfgs.size() + " configurations", VaadinIcon.CUBES, "var(--ac-bind)",
                        "services"),
                kpi("Edge Routers", m.routers.size(), m.routers.stream().filter(r -> r.online).count() + " online",
                        VaadinIcon.SERVER, "var(--ac-router)", "routers"),
                kpi("Service Policies", m.servicePolicies.size(), AccessLogic.accessSet(m).size() + " active dial pairs",
                        VaadinIcon.SHIELD, "var(--ac-ok)", "service-policies"),
                kpi("Live Sessions", sessions, "Dial & Bind overlay sessions", VaadinIcon.CONNECT, "var(--ac-pending)",
                        "sessions"));

        problems.setVisible(probCount > 0);
        problems.setText(probCount == 1 ? "1 item needs attention" : probCount + " items need attention");

        var index = ServiceConfigs.index(cfgs);
        services.removeAll();
        if (m.services.isEmpty()) {
            services.add(Ui.muted("No services yet."));
        }
        for (AcService s : m.services.stream().limit(5).toList()) {
            EndpointInfo ep = ServiceConfigs.describe(s.name, s.configs, index);
            Div info = new Div();
            info.getStyle().set("min-width", "0");
            Div name = new Div(s.name);
            name.addClassNames("bp-strong", "bp-mono");
            info.add(name);
            if (ep.url() != null) {
                Anchor a = new Anchor(ep.url(), ep.url());
                a.setTarget(AnchorTarget.BLANK);
                a.getElement().setAttribute("rel", "noopener noreferrer");
                a.addClassName("bp-mono");
                a.getStyle().set("color", "var(--ac-dial)");
                Div line = new Div(a);
                if (ep.hostDisplay() != null) {
                    Span h = Ui.mono("  → " + ep.hostDisplay());
                    h.addClassName("bp-muted");
                    line.add(h);
                }
                info.add(line);
            } else if (ep.interceptDisplay() != null) {
                Span h = Ui.mono(ep.interceptDisplay() + (ep.hostDisplay() != null ? "  → " + ep.hostDisplay() : ""));
                h.addClassName("bp-muted");
                info.add(new Div(h));
            }
            Div attrs = new Div(s.attrs.isEmpty() ? "no attributes"
                    : String.join(", ", s.attrs.stream().map(a -> "#" + a).toList()));
            attrs.addClassName("bp-muted");
            info.add(attrs);
            Div row = new Div(info, Ui.chip(s.encryptionRequired ? "E2E Encrypted" : "Unencrypted",
                    s.encryptionRequired ? "ok" : "warn"));
            row.addClassName("bp-list-row");
            services.add(row);
        }

        reach.removeAll();
        List<Component> rows = new ArrayList<>();
        for (AcIdentity i : AccessLogic.clients(m).stream().limit(4).toList()) {
            for (AcService s : m.services.stream().limit(2).toList()) {
                boolean ok = AccessLogic.advise(m, i, s).stream().noneMatch(st -> st.st().equals("bad"));
                Div pair = new Div(Ui.mono(i.name), Ui.muted("  →  "), Ui.mono(s.name));
                Span status = ok ? new Span(Ui.icon(VaadinIcon.CHECK_CIRCLE, "var(--ac-ok)"), new Span(" Dial & Route OK"))
                        : new Span(Ui.icon(VaadinIcon.KEY, "var(--ac-muted)"), new Span(" No policy / route"));
                status.addClassName(ok ? "bp-ok" : "bp-muted");
                status.getStyle().set("display", "inline-flex").set("align-items", "center").set("gap", "4px");
                Div row = new Div(pair, status);
                row.addClassName("bp-list-row");
                rows.add(row);
            }
        }
        if (rows.isEmpty()) {
            reach.add(Ui.muted("No client identities yet."));
        }
        rows.stream().limit(6).forEach(reach::add);
    }
}
