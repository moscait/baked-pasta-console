package com.example.ui;

import java.util.List;
import java.util.Set;

import com.example.ziti.ZitiService;
import com.vaadin.flow.component.AttachEvent;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.applayout.AppLayout;
import com.vaadin.flow.component.applayout.DrawerToggle;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H1;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.menubar.MenuBar;
import com.vaadin.flow.component.menubar.MenuBarVariant;
import com.vaadin.flow.component.contextmenu.MenuItem;
import com.vaadin.flow.component.contextmenu.SubMenu;
import com.vaadin.flow.component.orderedlayout.Scroller;
import com.vaadin.flow.component.page.ColorScheme;
import com.vaadin.flow.component.sidenav.SideNav;
import com.vaadin.flow.component.sidenav.SideNavItem;
import com.vaadin.flow.router.AfterNavigationEvent;
import com.vaadin.flow.router.AfterNavigationObserver;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.QueryParameters;
import com.vaadin.flow.shared.Registration;

/** The console shell: brand, Quick Add, grouped navigation with hints, and the controller footer. */
public class MainLayout extends AppLayout implements BeforeEnterObserver, AfterNavigationObserver {

    public record NavEntry(String label, String hint, String route, VaadinIcon icon, List<String> aliases) {
    }

    public record NavGroup(String label, List<NavEntry> items) {
    }

    public static final List<NavGroup> NAV = List.of(
            new NavGroup("Overview & Canvas", List.of(
                    new NavEntry("Access Canvas",
                            "Visual drag-and-drop policy board, 4-step guided service wizard, and reachability advisor.",
                            "access-canvas", VaadinIcon.CLUSTER, List.of("network-visualizer")),
                    new NavEntry("Dashboard", "Network health summary, entity counts, and quick actions.", "dashboard",
                            VaadinIcon.DASHBOARD, List.of()),
                    new NavEntry("Network Map",
                            "Routers and identities on a world map, link latency, and live circuits from client to host.",
                            "network-map", VaadinIcon.GLOBE, List.of("geolocate")))),
            new NavGroup("Core Components", List.of(
                    new NavEntry("Identities",
                            "Users, devices, and hosting servers with one-time JWT & QR enrollment tokens.",
                            "identities", VaadinIcon.USERS, List.of()),
                    new NavEntry("Services",
                            "Zero-trust services, intercept & host configurations, config types, and live terminators.",
                            "services", VaadinIcon.CUBES, List.of("configs", "config-types", "terminators")),
                    new NavEntry("Routers", "Edge and transit routers that carry encrypted overlay traffic.", "routers",
                            VaadinIcon.SERVER, List.of("transit-routers")))),
            new NavGroup("Access Rules", List.of(
                    new NavEntry("Policies",
                            "Dial & Bind service policies, edge router policies, and service router policies.",
                            "service-policies", VaadinIcon.KEY, List.of("router-policies", "service-router-policies")),
                    new NavEntry("Posture Checks",
                            "Client compliance checks (MFA, OS version, MAC address, domain) enforced on connect.",
                            "posture-checks", VaadinIcon.SHIELD, List.of()),
                    new NavEntry("Attributes",
                            "Every #attribute: who carries it, which policies select it, and policies that select nothing.",
                            "attributes", VaadinIcon.TAGS, List.of()))),
            new NavGroup("Management", List.of(
                    new NavEntry("Authentication",
                            "Certificate authorities, authentication policies, and external JWT/OIDC signers.",
                            "certificate-authorities", VaadinIcon.LOCK, List.of("auth-policies", "jwt-signers")),
                    new NavEntry("Sessions", "Live Dial/Bind overlay sessions and active Edge Management API sessions.",
                            "sessions", VaadinIcon.CONNECT, List.of("api-sessions")),
                    new NavEntry("Config Builder",
                            "Build or edit controller and router YAML config files with validation and a live preview.",
                            "config-builder", VaadinIcon.FILE_CODE, List.of()),
                    new NavEntry("Settings", "Controller connection settings, OIDC session status, and Demo Sandbox controls.",
                            "settings", VaadinIcon.COG, List.of()))));

    public record QuickAdd(String intent, String route, String label, String hint) {
    }

    public static final List<QuickAdd> QUICK_ADD = List.of(
            new QuickAdd("wizard", "services", "Set up a service (guided)",
                    "Configs, service, hosts, users and policies in one flow"),
            new QuickAdd("identity", "identities", "Identity", "A user device, server or workload"),
            new QuickAdd("service", "services", "Service", "A bare service; attach configs yourself"),
            new QuickAdd("service-policy", "service-policies", "Service policy", "Dial or Bind access by attribute"),
            new QuickAdd("edge-router", "routers", "Edge router", "Returns an enrollment JWT"),
            new QuickAdd("posture-check", "posture-checks", "Posture check", "MFA, OS, MAC or domain requirement"));

    private final ZitiService ziti;
    private final H1 viewTitle = new H1();
    private final Span hostLabel = new Span();
    private final Span versionLabel = new Span();
    private final Span dot = new Span();
    private final Button switchButton = new Button();
    private final Button logoutButton = new Button("Log out", VaadinIcon.SIGN_OUT.create());
    private final Span demoBadge = new Span("Demo Sandbox");
    private Registration sub;

    public MainLayout(ZitiService ziti) {
        this.ziti = ziti;
        setPrimarySection(Section.DRAWER);

        DrawerToggle toggle = new DrawerToggle();
        toggle.setAriaLabel("Menu toggle");
        viewTitle.addClassName("bp-navbar-title");
        demoBadge.addClassNames("bp-chip", "warn", "bp-demo-badge");
        demoBadge.setTitle("All data lives in this browser session; nothing reaches a real controller.");
        addToNavbar(toggle, viewTitle, demoBadge);

        Anchor brand = new Anchor("access-canvas");
        brand.addClassName("bp-brand");
        Div name = new Div();
        Div line = new Div(new Span("baked "), pasta());
        line.addClassName("bp-brand-name");
        Div sub = new Div("console v" + Brand.VERSION + " · openziti");
        sub.addClassName("bp-brand-sub");
        name.add(line, sub);
        brand.add(Brand.mark(38), name);

        Div drawer = new Div();
        drawer.getStyle().set("display", "flex").set("flex-direction", "column").set("height", "100%");
        Scroller scroller = new Scroller(navigation());
        scroller.getStyle().set("flex", "1");
        drawer.add(brand, quickAdd(), scroller, footer());
        addToDrawer(drawer);
    }

    private static Span pasta() {
        Span s = new Span("pasta");
        s.addClassName("pasta");
        return s;
    }

    private Component quickAdd() {
        MenuBar bar = new MenuBar();
        bar.addClassName("bp-quick-add");
        bar.addThemeVariants(MenuBarVariant.PRIMARY);
        MenuItem root = bar.addItem(new Span(VaadinIcon.PLUS.create(), new Span(" Quick add")));
        root.setAriaLabel("Quick add");
        SubMenu menu = root.getSubMenu();
        for (QuickAdd q : QUICK_ADD) {
            Div item = new Div();
            Div l = new Div(q.label());
            l.addClassName("bp-strong");
            Div h = new Div(q.hint());
            h.addClassNames("bp-xs", "bp-muted");
            item.add(l, h);
            menu.addItem(item, e -> UI.getCurrent().navigate(q.route(), QueryParameters.of("new", q.intent())));
        }
        return bar;
    }

    private Component navigation() {
        Div wrap = new Div();
        for (NavGroup g : NAV) {
            SideNav nav = new SideNav(g.label());
            nav.addClassName("bp-nav-group");
            nav.setCollapsible(true);
            for (NavEntry e : g.items()) {
                SideNavItem item = new SideNavItem(e.label(), e.route(), e.icon().create());
                if (!e.aliases().isEmpty()) {
                    item.setPathAliases(Set.copyOf(e.aliases()));
                }
                item.setMatchNested(true);
                item.setTooltipMarkdown("**" + e.label() + "**\n\n" + e.hint());
                nav.addItem(item);
            }
            wrap.add(nav);
        }
        wrap.getStyle().set("padding", "0 var(--vaadin-padding-s)").set("display", "flex").set("flex-direction", "column")
                .set("gap", "var(--vaadin-gap-m)");
        return wrap;
    }

    private Component footer() {
        Div f = new Div();
        f.addClassName("bp-drawer-footer");
        dot.addClassName("bp-status-dot");
        hostLabel.addClassName("bp-mono");
        hostLabel.getStyle().set("overflow", "hidden").set("text-overflow", "ellipsis").set("white-space", "nowrap")
                .set("flex", "1");
        versionLabel.addClassNames("bp-mono", "bp-muted", "bp-xs");
        Div status = new Div(dot, hostLabel, versionLabel);
        status.getStyle().set("display", "flex").set("align-items", "center").set("gap", "6px");

        switchButton.setIcon(VaadinIcon.SERVER.create());
        switchButton.addThemeVariants(ButtonVariant.SMALL);
        switchButton.addClickListener(e -> UI.getCurrent().navigate(LoginView.class));
        logoutButton.addThemeVariants(ButtonVariant.SMALL);
        logoutButton.addClickListener(e -> {
            ziti.logout();
            Toast.info("Signed out", "Your controller session was removed from this server session.");
            UI.getCurrent().navigate(LoginView.class);
        });
        Div buttons = new Div(switchButton, logoutButton);
        buttons.getStyle().set("display", "flex").set("gap", "6px");
        switchButton.getStyle().set("flex", "1");
        logoutButton.getStyle().set("flex", "1");
        f.add(status, buttons);
        return f;
    }

    private void refreshFooter() {
        boolean demo = ziti.isDemoMode();
        hostLabel.setText(demo ? "Demo Sandbox" : ziti.controllerHost());
        hostLabel.setTitle(ziti.controllerUrl());
        versionLabel.setText(ziti.controllerVersion);
        dot.setClassName("demo", demo);
        switchButton.setText(demo ? "Connect Controller" : "Switch Controller");
        logoutButton.setVisible(!demo);
        demoBadge.setVisible(demo);
    }

    @Override
    protected void onAttach(AttachEvent attachEvent) {
        super.onAttach(attachEvent);
        applyColorScheme(attachEvent.getUI(), ziti.colorScheme());
        refreshFooter();
        sub = ziti.subscribe(() -> {
            refreshFooter();
            if (!ziti.isAuthenticated()) {
                UI.getCurrent().navigate(LoginView.class);
            }
        });
    }

    @Override
    protected void onDetach(com.vaadin.flow.component.DetachEvent detachEvent) {
        if (sub != null) {
            sub.remove();
        }
        super.onDetach(detachEvent);
    }

    public static void applyColorScheme(UI ui, String scheme) {
        ColorScheme.Value v = switch (scheme == null ? "system" : scheme) {
            case "light" -> ColorScheme.Value.LIGHT;
            case "dark" -> ColorScheme.Value.DARK;
            default -> ColorScheme.Value.LIGHT_DARK;
        };
        ui.getPage().setColorScheme(v);
    }

    /**
     * On a session's first visit decide between the Demo Sandbox and sign-in: if the configured
     * controller answers, sign in to it; otherwise open the sandbox. Later, an unauthenticated
     * session (logout, expiry) always goes to sign-in.
     */
    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        if (ziti.isAuthenticated()) {
            return;
        }
        if (ziti.consumeFirstVisit() && !ziti.probeController(ziti.savedControllerUrl()).online()) {
            ziti.enableDemoMode();
            return;
        }
        event.forwardTo(LoginView.class);
    }

    @Override
    public void afterNavigation(AfterNavigationEvent event) {
        Component content = getContent();
        PageTitle t = content == null ? null : content.getClass().getAnnotation(PageTitle.class);
        viewTitle.setText(t == null ? "" : t.value());
        refreshFooter();
    }
}
