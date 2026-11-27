package com.example.views;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;

import com.example.sessions.IpFilter;
import com.example.sessions.SessionMonitor;
import com.example.sessions.SessionMonitor.ConcurrencyFinding;
import com.example.sessions.SessionMonitor.ConcurrencyPolicy;
import com.example.sessions.SessionMonitor.EnrichedApiSession;
import com.example.sessions.SessionMonitor.RemediationAction;
import com.example.sessions.SessionMonitor.RemediationPlan;
import com.example.sessions.SessionMonitor.Report;
import com.example.sessions.SessionMonitor.ServiceFlowRow;
import com.example.sessions.SessionMonitor.TrafficFilter;
import com.example.ui.FormDialog;
import com.example.ui.MainLayout;
import com.example.ui.TabSwitch;
import com.example.ui.Toast;
import com.example.ui.Ui;
import com.example.ui.ZitiView;
import com.example.ziti.FormValues;
import com.example.ziti.Json;
import com.example.ziti.ZitiException;
import com.example.ziti.ZitiService;
import com.example.ziti.ZitiService.RemediationResult;
import com.vaadin.flow.component.AttachEvent;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.DetachEvent;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.grid.GridVariant;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.data.value.ValueChangeMode;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;
import com.vaadin.flow.server.streams.DownloadHandler;
import com.vaadin.flow.server.streams.DownloadResponse;
import com.vaadin.flow.shared.Registration;

/** Correlated service sessions, client IPs/CIDRs and concurrent-identity detection with remediation. */
@Route(value = "sessions", layout = MainLayout.class)
@RouteAlias(value = "api-sessions", layout = MainLayout.class)
@PageTitle("Sessions")
public class SessionsView extends ZitiView implements BeforeEnterObserver {

    private static final Set<String> CONC_MODES = Set.of("all", "concurrent-any", "concurrent-multi-ip",
            "concurrent-same-ip");

    private final TabSwitch tabs = new TabSwitch();
    private final Grid<ServiceFlowRow> flowGrid = new Grid<>();
    private final Grid<EnrichedApiSession> apiGrid = new Grid<>();
    private final Div findingsBox = new Div();
    private final Button policyButton = new Button();
    private final TextField search = new TextField();
    private final TextField ipField = new TextField("Client IP / CIDR (supports lists & !cidr exclusion)");
    private final Select<String> serviceSelect = new Select<>();
    private final Select<String> roleSelect = new Select<>();
    private final Select<String> typeSelect = new Select<>();
    private final Select<String> concSelect = new Select<>();
    private final Button clearFilters = new Button("Clear all filters");
    private final Span oidcNote = new Span();

    private TrafficFilter filter = new TrafficFilter();
    private List<Map<String, Object>> identities = List.of();
    private List<Map<String, Object>> services = List.of();
    private Report report;
    private boolean syncing;
    private Registration policySub;

    public SessionsView(ZitiService ziti) {
        super(ziti);
        policyButton.setIcon(VaadinIcon.SLIDERS.create());
        policyButton.addClickListener(e -> openPolicy());
        Button refresh = Ui.button("Refresh", VaadinIcon.REFRESH, this::safeReload);

        Div header = Ui.pageHeader("Sessions & Traffic Monitor",
                "Correlated service sessions, client source IPs/CIDRs, and configurable concurrent-identity detection.");
        header.add(oidcNote);
        oidcNote.addClassNames("bp-muted", "bp-small");
        Div top = new Div(header, Ui.spacer(), Ui.toolbar(policyButton, refresh));
        top.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("align-items", "flex-start").set("gap", "12px");

        findingsBox.setVisible(false);

        buildFlowGrid();
        buildApiGrid();
        tabs.add("sessions", "Service Traffic", wrap(flowGrid, "Correlated Service Traffic", this::flowCsv))
                .add("api-sessions", "API Sessions", wrap(apiGrid, "API Sessions", this::apiCsv));

        search.setPlaceholder("Search identity, service, router, or IP…");
        search.setPrefixComponent(VaadinIcon.SEARCH.create());
        search.setClearButtonVisible(true);
        search.setValueChangeMode(ValueChangeMode.LAZY);
        search.setAriaLabel("Search sessions");
        search.setMinWidth("18rem");
        search.addValueChangeListener(e -> {
            if (!syncing) {
                filter.search = e.getValue();
                show();
            }
        });

        add(Ui.page(top, findingsBox, filterPanel(), Ui.toolbar(tabs.tabs(), Ui.spacer(), search), tabs.content()));
    }

    // ------------------------------------------------------------------ layout pieces

    private Div wrap(Grid<?> grid, String caption, java.util.function.Supplier<String> csv) {
        grid.addThemeVariants(GridVariant.ROW_STRIPES, GridVariant.WRAP_CELL_CONTENT);
        grid.setHeight("min(64vh, 720px)");
        grid.setEmptyStateText("No sessions match your filter.");
        grid.setAriaLabel(caption);
        grid.addClassName("bp-grid");
        Anchor export = new Anchor(DownloadHandler.fromInputStream(ev -> {
            byte[] b = csv.get().getBytes(StandardCharsets.UTF_8);
            return new DownloadResponse(new ByteArrayInputStream(b), FormValues.csvFileName(caption), "text/csv", b.length);
        }), "");
        Button exportButton = new Button("Export CSV", VaadinIcon.DOWNLOAD_ALT.create());
        exportButton.setTooltipText("Download the shown rows as CSV");
        export.add(exportButton);
        Div tools = Ui.toolbar(Ui.strong(caption), Ui.spacer(), export);
        Div d = new Div(tools, grid);
        d.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "8px");
        return d;
    }

    private Component filterPanel() {
        ipField.setPlaceholder("e.g. 198.51.100.0/24, 203.0.113.194, or !10.0.0.0/8");
        ipField.addClassName("mono");
        ipField.setValueChangeMode(ValueChangeMode.LAZY);
        ipField.setClearButtonVisible(true);
        ipField.addValueChangeListener(e -> {
            if (!syncing) {
                filter.ipFilter = e.getValue();
                show();
            }
        });
        serviceSelect.setLabel("Service");
        roleSelect.setLabel("Role attribute");
        roleSelect.setAriaLabel("Filter by role attribute");
        typeSelect.setLabel("Direction");
        typeSelect.setItems("all", "Dial", "Bind");
        typeSelect.setItemLabelGenerator(v -> v.equals("all") ? "All" : v);
        typeSelect.setAriaLabel("Filter by Dial or Bind");
        concSelect.setLabel("Concurrency");
        concSelect.setItems("all", "concurrent-any", "concurrent-multi-ip", "concurrent-same-ip");
        concSelect.setItemLabelGenerator(v -> switch (v) {
            case "concurrent-any" -> "Concurrent (2+ sessions)";
            case "concurrent-multi-ip" -> "Multi-IP (2+ distinct IPs)";
            case "concurrent-same-ip" -> "Same-IP concurrent";
            default -> "All sessions";
        });
        serviceSelect.addValueChangeListener(e -> onSelect(() -> filter.serviceId = e.getValue()));
        roleSelect.addValueChangeListener(e -> onSelect(() -> filter.roleAttribute = e.getValue()));
        typeSelect.addValueChangeListener(e -> onSelect(() -> filter.sessionType = e.getValue()));
        concSelect.addValueChangeListener(e -> onSelect(() -> filter.concurrency = e.getValue()));
        clearFilters.addThemeVariants(ButtonVariant.TERTIARY, ButtonVariant.SMALL);
        clearFilters.addClickListener(e -> {
            filter = new TrafficFilter();
            getUI().ifPresent(ui -> ui.getPage().getHistory().replaceState(null, tabs.selected()));
            show();
        });

        Div title = new Div(Ui.icon(VaadinIcon.FILTER, null), Ui.strong("Traffic & Client IP Filter"), Ui.spacer(),
                clearFilters);
        title.getStyle().set("display", "flex").set("align-items", "center").set("gap", "8px");
        Div grid = new Div(ipField, serviceSelect, roleSelect, typeSelect, concSelect);
        grid.getStyle().set("display", "grid").set("grid-template-columns", "repeat(auto-fit, minmax(170px, 1fr))")
                .set("gap", "12px");
        ipField.getStyle().set("grid-column", "span 2");
        ipField.setWidthFull();
        Div card = Ui.card(title, grid);
        card.getElement().setAttribute("aria-label", "Traffic filtering controls");
        return card;
    }

    private void onSelect(Runnable set) {
        if (!syncing) {
            set.run();
            show();
        }
    }

    private void buildFlowGrid() {
        flowGrid.addComponentColumn(r -> identityCell(r.identityName(), r.concurrencyState(), r.roleAttributes(), null, false))
                .setHeader("Identity").setAutoWidth(true).setResizable(true)
                .setComparator((a, b) -> a.identityName().compareToIgnoreCase(b.identityName()));
        flowGrid.addComponentColumn(r -> ipCell(r.ipAddress(), null)).setHeader("Client IP").setAutoWidth(true)
                .setComparator((a, b) -> String.valueOf(a.ipAddress()).compareTo(String.valueOf(b.ipAddress())));
        flowGrid.addColumn(ServiceFlowRow::serviceName).setHeader("Service").setAutoWidth(true).setSortable(true);
        flowGrid.addComponentColumn(r -> Ui.chip(r.type(), "Bind".equals(r.type()) ? "bind" : "dial")).setHeader("Direction")
                .setAutoWidth(true).setComparator((a, b) -> a.type().compareTo(b.type()));
        flowGrid.addComponentColumn(r -> r.routers().isEmpty() ? Ui.muted("—") : Ui.chips(r.routers(), "router", ""))
                .setHeader("Edge Routers").setAutoWidth(true);
        flowGrid.addColumn(r -> formatAge(r.ageSeconds(), r.activityAt())).setHeader("Last Activity").setAutoWidth(true)
                .setComparator((a, b) -> Long.compare(age(a.ageSeconds()), age(b.ageSeconds())));
        flowGrid.addComponentColumn(r -> {
            Div d = new Div();
            d.addClassName("bp-actions");
            if (r.apiSessionId() != null && !r.isCurrentSession()) {
                d.add(Ui.iconButton(VaadinIcon.UNLINK,
                        "Revoke underlying API session (" + (r.ipAddress() != null ? r.ipAddress() : r.apiSessionId()) + ")",
                        () -> confirmDropApiSession(r.apiSessionId(), r.identityName(), r.ipAddress())));
            }
            Button del = Ui.iconButton(VaadinIcon.TRASH, "Terminate service session", () -> Ui.confirm(
                    "Terminate service session?", r.identityName() + " → " + r.serviceName() + " is disconnected now.",
                    "Terminate", true, () -> Ui.attempt("Terminate failed", () -> {
                        ziti.remove("sessions", r.sessionId());
                        Toast.info("Service session terminated", r.identityName() + " → " + r.serviceName());
                    })));
            del.addThemeVariants(ButtonVariant.ERROR);
            d.add(del);
            return d;
        }).setHeader("Actions").setAutoWidth(true).setFlexGrow(0).setFrozenToEnd(true);
    }

    private void buildApiGrid() {
        apiGrid.addComponentColumn(r -> identityCell(r.identityName(), null, List.of(), r.authMethod(), r.isCurrentSession()))
                .setHeader("Identity").setAutoWidth(true).setResizable(true)
                .setComparator((a, b) -> a.identityName().compareToIgnoreCase(b.identityName()));
        apiGrid.addComponentColumn(r -> ipCell(r.ipAddress(), r.concurrencyState())).setHeader("Client IP & Status")
                .setAutoWidth(true)
                .setComparator((a, b) -> String.valueOf(a.ipAddress()).compareTo(String.valueOf(b.ipAddress())));
        apiGrid.addComponentColumn(r -> {
            if (r.services().isEmpty()) {
                return Ui.muted("Idle");
            }
            Div d = new Div();
            d.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("gap", "4px");
            r.services().forEach(s -> d.add(Ui.chip(s.type() + " · " + s.serviceName(), "Bind".equals(s.type()) ? "bind" : "dial")));
            return d;
        }).setHeader("Active Service Sessions").setAutoWidth(true);
        apiGrid.addComponentColumn(r -> {
            Span dot = new Span();
            dot.addClassName("bp-status-dot");
            dot.getStyle().set("background", r.isActiveInWindow() ? "var(--ac-ok)" : "var(--ac-line)");
            Span s = new Span(dot, new Span(" " + formatAge(r.ageSeconds(), r.activityAt())));
            s.addClassName("bp-small");
            return s;
        }).setHeader("Last Activity").setAutoWidth(true)
                .setComparator((a, b) -> Long.compare(age(a.ageSeconds()), age(b.ageSeconds())));
        apiGrid.addComponentColumn(r -> Ui.mono(r.id())).setHeader("API Session ID").setAutoWidth(true);
        apiGrid.addComponentColumn(r -> {
            Button del = Ui.iconButton(VaadinIcon.TRASH, "Revoke API session", () -> {
                if (r.isCurrentSession()) {
                    Toast.error("Can't revoke this session",
                            "Cannot revoke the API session currently used by this browser console. Use Log out instead.");
                    return;
                }
                confirmDropApiSession(r.id(), r.identityName(), r.ipAddress());
            });
            del.addThemeVariants(ButtonVariant.ERROR);
            del.setEnabled(!r.isCurrentSession());
            Div d = new Div(del);
            d.addClassName("bp-actions");
            return d;
        }).setHeader("Actions").setAutoWidth(true).setFlexGrow(0).setFrozenToEnd(true);
    }

    private Component identityCell(String name, String state, List<String> attrs, String authMethod, boolean current) {
        Div top = new Div(Ui.strong(name));
        top.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("align-items", "center").set("gap", "6px");
        if (authMethod != null) {
            top.add(Ui.chip(authMethod, null));
        }
        if (current) {
            top.add(Ui.chip("This console", "dial"));
        }
        Component badge = state == null ? null : concurrencyBadge(state);
        if (badge != null) {
            top.add(badge);
        }
        Div d = new Div(top);
        if (!attrs.isEmpty()) {
            d.add(Ui.attrChips(attrs));
        }
        return d;
    }

    private Component ipCell(String ip, String state) {
        Div d = new Div();
        d.getStyle().set("display", "flex").set("align-items", "center").set("gap", "6px");
        if (ip != null) {
            Button b = new Button(ip, e -> {
                filter.ipFilter = ip;
                show();
            });
            b.addThemeVariants(ButtonVariant.TERTIARY, ButtonVariant.SMALL);
            b.addClassName("bp-mono");
            b.setTooltipText("Click to filter traffic by this IP");
            d.add(b);
        } else {
            d.add(Ui.muted("—" + (ziti.oidcEnabled ? " (OIDC)" : "")));
        }
        Component badge = state == null ? null : concurrencyBadge(state);
        if (badge != null) {
            d.add(badge);
        }
        return d;
    }

    private static Component concurrencyBadge(String state) {
        return switch (state) {
            case "concurrent-multi-ip" -> Ui.chip("⚠ Multi-IP", "bad");
            case "concurrent-same-ip" -> Ui.chip("Concurrent", "warn");
            case "exempt-multi" -> Ui.chip("Exempt", null);
            case "stale" -> Ui.chip("Idle", null);
            default -> null;
        };
    }

    private static long age(Long a) {
        return a == null ? Long.MAX_VALUE : a;
    }

    static String formatAge(Long ageSeconds, String fallbackIso) {
        if (ageSeconds == null) {
            return fallbackIso == null ? "—" : fallbackIso;
        }
        long s = ageSeconds;
        if (s < 60) {
            return s + "s ago";
        }
        if (s < 3600) {
            return s / 60 + "m " + s % 60 + "s ago";
        }
        return s / 3600 + "h " + (s % 3600) / 60 + "m ago";
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        tabs.select(TabSwitch.firstSegment(event));
        var params = event.getLocation().getQueryParameters();
        String q = params.getSingleParameter("q").orElse(null);
        String ip = params.getSingleParameter("ip").orElse(null);
        String conc = params.getSingleParameter("concurrency").orElse(null);
        if (q != null || ip != null || conc != null) {
            filter = new TrafficFilter();
            if (q != null) {
                filter.search = q;
            }
            if (ip != null) {
                filter.ipFilter = ip;
            }
            if (conc != null && CONC_MODES.contains(conc)) {
                filter.concurrency = conc;
            }
        }
    }

    @Override
    protected void onAttach(AttachEvent attachEvent) {
        super.onAttach(attachEvent);
        policySub = ziti.subscribePolicy(this::evaluateAndShow);
    }

    @Override
    protected void onDetach(DetachEvent detachEvent) {
        if (policySub != null) {
            policySub.remove();
        }
        super.onDetach(detachEvent);
    }

    private List<Map<String, Object>> sessionsRaw = List.of();
    private List<Map<String, Object>> apiRaw = List.of();

    @Override
    protected void reload() {
        identities = ziti.list("identities");
        services = ziti.list("services");
        sessionsRaw = ziti.list("sessions");
        apiRaw = ziti.list("api-sessions");
        evaluateAndShow();
    }

    private void evaluateAndShow() {
        report = SessionMonitor.evaluate(identities, apiRaw, sessionsRaw, List.of(), ziti.getConcurrencyPolicy(),
                ziti.currentSessionToken(), System.currentTimeMillis());
        ConcurrencyPolicy p = report.policy();
        policyButton.setText("Concurrency Policy (" + p.activeWithinSeconds + "s window"
                + (p.maxActivitySkewSeconds != null ? " · " + p.maxActivitySkewSeconds + "s skew" : "") + ")");
        oidcNote.setText(ziti.oidcEnabled ? " Stateless OIDC JWT clients do not populate client IPs in legacy api-sessions." : "");
        show();
    }

    private void show() {
        if (report == null) {
            return;
        }
        syncing = true;
        try {
            search.setValue(filter.search);
            ipField.setValue(filter.ipFilter);
            String ipErr = IpFilter.validate(filter.ipFilter);
            ipField.setInvalid(ipErr != null);
            ipField.setErrorMessage(ipErr == null ? null : ipErr + " (showing unfiltered rows until complete)");

            List<String> svcIds = new ArrayList<>(List.of("all", "__idle__"));
            services.forEach(s -> svcIds.add(Json.str(s, "id")));
            serviceSelect.setItems(svcIds);
            serviceSelect.setItemLabelGenerator(id -> switch (id) {
                case "all" -> "All services";
                case "__idle__" -> "Idle (no active service)";
                default -> services.stream().filter(s -> id.equals(s.get("id"))).map(s -> Json.strOr(s, "name", id))
                        .findFirst().orElse(id);
            });
            serviceSelect.setValue(svcIds.contains(filter.serviceId) ? filter.serviceId : "all");

            Set<String> attrs = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
            identities.forEach(i -> attrs.addAll(Json.strings(i, "roleAttributes")));
            List<String> roleItems = new ArrayList<>(List.of(""));
            roleItems.addAll(attrs);
            roleSelect.setItems(roleItems);
            roleSelect.setItemLabelGenerator(a -> a.isEmpty() ? "All #roles" : "#" + a);
            roleSelect.setValue(roleItems.contains(filter.roleAttribute) ? filter.roleAttribute : "");
            typeSelect.setValue(filter.sessionType);
            concSelect.setValue(filter.concurrency);
        } finally {
            syncing = false;
        }
        boolean active = !filter.search.isBlank() || !filter.ipFilter.isBlank() || !filter.serviceId.equals("all")
                || !filter.roleAttribute.isEmpty() || !filter.sessionType.equals("all") || !filter.concurrency.equals("all");
        clearFilters.setVisible(active);

        List<ServiceFlowRow> flows = SessionMonitor.filterServiceFlows(report.serviceFlows(), filter);
        List<EnrichedApiSession> apis = SessionMonitor.filterApiSessions(report.apiSessions(), filter);
        flowGrid.setItems(flows);
        apiGrid.setItems(apis);
        tabs.count("sessions", flows.size());
        tabs.count("api-sessions", apis.size());
        renderFindings();
    }

    // ------------------------------------------------------------------ findings & remediation

    private void renderFindings() {
        findingsBox.removeAll();
        List<ConcurrencyFinding> findings = report.findings();
        findingsBox.setVisible(!findings.isEmpty());
        if (findings.isEmpty()) {
            return;
        }
        findingsBox.setClassName("bp-callout");
        findingsBox.addClassName("error");
        findingsBox.getElement().setAttribute("aria-label", "Concurrent identity warnings");
        H2 h = new H2(findings.size() == 1 ? "1 identity has concurrent active sessions"
                : findings.size() + " identities have concurrent active sessions");
        h.getStyle().set("font-size", "var(--aura-font-size-m)").set("margin", "0");
        Button toggle = Ui.small(filter.concurrency.equals("concurrent-any") ? "Show all sessions" : "Filter table to concurrent only",
                VaadinIcon.FILTER, () -> {
                    filter.concurrency = filter.concurrency.equals("concurrent-any") ? "all" : "concurrent-any";
                    show();
                });
        Div head = new Div(Ui.icon(VaadinIcon.WARNING, "var(--ac-bad)"), h, Ui.spacer(), toggle);
        head.getStyle().set("display", "flex").set("align-items", "center").set("gap", "8px");
        findingsBox.add(head);
        for (ConcurrencyFinding f : findings) {
            findingsBox.add(findingCard(f));
        }
    }

    private Component findingCard(ConcurrencyFinding f) {
        Div badges = new Div(Ui.chip("critical".equals(f.severity()) ? "Critical · Multi-IP" : "Warning · Same IP",
                "critical".equals(f.severity()) ? "bad" : "warn"), Ui.strong(f.identityName()), Ui.chip(f.authMethod(), null));
        if (f.activitySkewMs() != null) {
            badges.add(Ui.muted("(" + Math.round(f.activitySkewMs() / 1000.0) + "s skew)"));
        }
        badges.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("align-items", "center").set("gap", "6px");
        Set<String> dialed = new LinkedHashSet<>();
        f.concurrentSessions().forEach(cs -> dialed.addAll(cs.services()));
        Div summary = new Div(new Span(f.summary()));
        summary.addClassName("bp-small");
        if (!dialed.isEmpty()) {
            summary.add(Ui.muted(" Using: " + String.join(", ", dialed)));
        }
        Div drops = new Div();
        drops.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("gap", "6px");
        f.concurrentSessions().forEach(cs -> {
            Button b = Ui.small("Drop " + (cs.ipAddress() != null ? cs.ipAddress() : cs.apiSessionId()), VaadinIcon.UNLINK,
                    () -> confirmDropApiSession(cs.apiSessionId(), f.identityName(), cs.ipAddress()));
            b.setEnabled(!cs.isCurrentSession());
            b.setTooltipText(cs.isCurrentSession() ? "Protected: active browser console session"
                    : "Disconnect session " + cs.apiSessionId());
            drops.add(b);
        });
        Div left = new Div(badges, summary, drops);
        left.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "6px").set("flex", "1");
        Button all = Ui.small("Drop all (" + f.totalSessionCount() + ")…", null,
                () -> confirmRemediation(f, RemediationAction.TERMINATE_ALL));
        all.addThemeVariants(ButtonVariant.ERROR);
        Div right = new Div(all);
        if (!"ext-jwt".equals(f.authMethod())) {
            Button revoke = Ui.small("Revoke credential…", null, () -> confirmRemediation(f, RemediationAction.REVOKE));
            revoke.addThemeVariants(ButtonVariant.ERROR, ButtonVariant.PRIMARY);
            right.add(revoke);
        }
        right.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "6px");
        Div card = new Div(left, right);
        card.addClassName("bp-card");
        card.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("gap", "12px").set("padding", "10px 12px");
        return card;
    }

    private void confirmDropApiSession(String apiSessionId, String identityName, String ip) {
        Ui.confirm("Revoke API session for " + identityName + "?",
                "Immediately disconnects API session " + apiSessionId + (ip != null ? " (" + ip + ")" : "")
                        + " and closes any service sessions using it.",
                "Revoke API Session", true, () -> Ui.attempt("Revoke failed", () -> {
                    ziti.remove("api-sessions", apiSessionId);
                    Toast.info("API session revoked", identityName + (ip != null ? " (" + ip + ")" : ""));
                }));
    }

    private void confirmRemediation(ConcurrencyFinding f, RemediationAction action) {
        boolean revoke = action == RemediationAction.REVOKE;
        String title = revoke ? "Revoke credentials for " + f.identityName() + "?"
                : action == RemediationAction.TERMINATE_NEWER ? "Drop newer session(s) for " + f.identityName() + "?"
                        : "Drop all sessions for " + f.identityName() + "?";
        String text = revoke
                ? "Deletes the authenticator(s) for " + f.identityName()
                        + " so shared certificates or passwords can no longer reconnect, then terminates its active API sessions."
                : action == RemediationAction.TERMINATE_NEWER
                        ? "Keeps the earliest-established session on " + f.identityName()
                                + " and terminates newer concurrent API session(s). Note: a device with a cloned certificate can reconnect unless its credential is revoked."
                        : "Immediately terminates all " + f.totalSessionCount() + " API session(s) for " + f.identityName()
                                + " (" + (f.distinctIps().isEmpty() ? "active sessions" : String.join(", ", f.distinctIps())) + ").";
        Ui.confirm(title, text, revoke ? "Revoke & Terminate" : "Terminate Sessions", true, () -> {
            try {
                Map<String, Object> ident = identities.stream().filter(i -> f.identityId().equals(i.get("id"))).findFirst()
                        .orElse(null);
                // Fetch authenticators on demand when revoking so missing summary IDs never cause silent skips.
                List<Map<String, Object>> auths = revoke ? ziti.listIdentityAuthenticators(f.identityId()) : null;
                RemediationPlan plan = SessionMonitor.planFor(action, f, report, ident, auths);
                if (plan.error() != null) {
                    throw new IllegalStateException(plan.error());
                }
                if (plan.steps().isEmpty()) {
                    throw new IllegalStateException("No eligible sessions to terminate (the active console session is protected).");
                }
                RemediationResult res = ziti.executeRemediationSteps(plan.steps());
                if (!res.failures().isEmpty()) {
                    throw new IllegalStateException(String.join("; ", res.failures()));
                }
                Toast.success(revoke ? "Credentials revoked & sessions dropped" : "Sessions terminated",
                        f.identityName() + ": completed " + res.executed() + " operation" + (res.executed() == 1 ? "" : "s") + ".");
            } catch (RuntimeException e) {
                Toast.error("Remediation failed", ZitiException.text(e));
            }
        });
    }

    // ------------------------------------------------------------------ policy dialog

    private void openPolicy() {
        ConcurrencyPolicy cur = ziti.getConcurrencyPolicy();
        TextField window = FormDialog.text("Active window (seconds)", String.valueOf(cur.activeWithinSeconds), null,
                "Sessions idle longer than this are treated as stale (0 = never expire).");
        TextField skew = FormDialog.text("Max activity skew (seconds)",
                cur.maxActivitySkewSeconds == null ? "" : String.valueOf(cur.maxActivitySkewSeconds), "Disabled",
                "Max gap from the newest session to join the concurrent cluster. Blank disables.");
        TextField min = FormDialog.text("Minimum concurrent sessions", String.valueOf(cur.minConcurrentSessions), null,
                "Clustered live sessions required before raising a warning (2 or higher).");
        Checkbox admin = FormDialog.check("Exempt admin identities", cur.exemptAdminIdentities,
                "Recommended so using both this console and the CLI never flags your admin account.");
        Checkbox ext = FormDialog.check("Exempt external identities", cur.exemptExternalIdentities,
                "Identities with an externalId are expected to connect across devices.");
        Checkbox distinct = FormDialog.check("Require distinct IPs", cur.requireDistinctIps,
                "Ignore concurrent sessions on one identity when they share the same IP.");
        TextField exemptAttrs = FormDialog.text("Exempt role attributes", String.join(", ", cur.exemptRoleAttributes),
                "e.g. multi-device, ha-hosts", null);
        exemptAttrs.addClassName("mono");

        FormDialog d = new FormDialog("Concurrency Detection Policy", "Save policy", true, errors -> {
            ConcurrencyPolicy next = cur.copy();
            try {
                next.activeWithinSeconds = FormValues.parseWholeNumber(window.getValue(), "Active window", 0, Integer.MAX_VALUE, null);
            } catch (IllegalArgumentException e) {
                errors.add(e.getMessage());
            }
            try {
                next.maxActivitySkewSeconds = skew.getValue().isBlank() ? null
                        : FormValues.parseWholeNumber(skew.getValue(), "Activity skew", 0, Integer.MAX_VALUE, null);
            } catch (IllegalArgumentException e) {
                errors.add(e.getMessage());
            }
            try {
                next.minConcurrentSessions = FormValues.parseWholeNumber(min.getValue(), "Minimum concurrent sessions", 2,
                        Integer.MAX_VALUE, null);
            } catch (IllegalArgumentException e) {
                errors.add(e.getMessage());
            }
            if (!errors.isEmpty()) {
                return;
            }
            next.requireDistinctIps = distinct.getValue();
            next.exemptAdminIdentities = admin.getValue();
            next.exemptExternalIdentities = ext.getValue();
            next.exemptRoleAttributes = new ArrayList<>(List.of(exemptAttrs.getValue().split("[,\\s]+")).stream()
                    .map(s -> s.trim().replaceFirst("^#", "")).filter(s -> !s.isEmpty()).toList());
            ziti.saveConcurrencyPolicy(next);
            Toast.success("Concurrency policy updated", "Applied in memory without reloading controller state.");
        });
        Span lead = new Span("Configure when multiple API sessions for the same OpenZiti identity count as concurrent "
                + "(shared firewall IPs across different identities are normal and never flagged).");
        lead.addClassNames("bp-muted", "bp-small");
        Button reset = new Button("Reset to defaults", e -> {
            ziti.resetConcurrencyPolicy();
            Toast.info("Reset to defaults", "Restored default concurrency detection policy.");
            d.close();
        });
        reset.addThemeVariants(ButtonVariant.TERTIARY);
        d.getFooter().addComponentAsFirst(reset);
        reset.getStyle().set("margin-inline-end", "auto");
        d.fields(lead, FormDialog.grid(window, skew, min), admin, ext, distinct, exemptAttrs);
        d.open();
    }

    // ------------------------------------------------------------------ CSV

    private String flowCsv() {
        List<ServiceFlowRow> rows = SessionMonitor.filterServiceFlows(report.serviceFlows(), filter);
        return csv(List.of("Identity", "Client IP", "Service", "Direction", "Edge Routers", "Last Activity"), rows,
                r -> List.of(r.identityName(), nz(r.ipAddress()), r.serviceName(), r.type(), String.join(", ", r.routers()),
                        formatAge(r.ageSeconds(), r.activityAt())));
    }

    private String apiCsv() {
        List<EnrichedApiSession> rows = SessionMonitor.filterApiSessions(report.apiSessions(), filter);
        return csv(List.of("Identity", "Auth Method", "Client IP", "Active Service Sessions", "Last Activity", "API Session ID"),
                rows, r -> List.of(r.identityName(), r.authMethod(), nz(r.ipAddress()),
                        String.join(", ", r.services().stream().map(s -> s.serviceName()).toList()),
                        formatAge(r.ageSeconds(), r.activityAt()), r.id()));
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static <T> String csv(List<String> headers, List<T> rows, Function<T, List<Object>> cells) {
        return FormValues.toCsv(headers, rows.stream().map(cells).toList());
    }
}
