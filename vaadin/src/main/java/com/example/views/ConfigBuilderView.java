package com.example.views;

import java.io.ByteArrayInputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import com.example.configbuilder.ControllerConfig;
import com.example.configbuilder.ControllerConfig.BindPoint;
import com.example.configbuilder.ControllerConfig.EventLogger;
import com.example.configbuilder.ControllerConfig.WebListener;
import com.example.configbuilder.RouterConfig;
import com.example.configbuilder.ValidationIssue;
import com.example.configbuilder.YamlSupport;
import com.example.ui.MainLayout;
import com.example.ui.Toast;
import com.example.ui.Ui;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.HasValidation;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.NativeButton;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Pre;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;
import com.vaadin.flow.component.tabs.TabsVariant;
import com.vaadin.flow.component.textfield.NumberField;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.component.upload.Upload;
import com.vaadin.flow.data.value.ValueChangeMode;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.server.streams.DownloadHandler;
import com.vaadin.flow.server.streams.DownloadResponse;
import com.vaadin.flow.server.streams.UploadHandler;

/**
 * Config Builder: create or edit an OpenZiti controller ({@code ctrl.yml}) or router
 * ({@code router.yml}) config with validation and a live YAML preview. An opened file keeps every
 * key the form does not manage. Nothing is sent to the controller; the result is downloaded or
 * copied. Works without a controller connection.
 */
@Route(value = "config-builder", layout = MainLayout.class)
@PageTitle("Config Builder")
public class ConfigBuilderView extends Div {

    // ------------------------------------------------------------------ field specs

    private enum Type {
        TEXT, NUMBER, NULLABLE_NUMBER, BOOL, SELECT, LIST
    }

    private record Opt(String id, String label) {
    }

    private record FieldSpec(String path, String label, Type type, List<Opt> options, String hint, String placeholder,
            Predicate<ControllerConfig> when) {
        FieldSpec hint(String h) {
            return new FieldSpec(path, label, type, options, h, placeholder, when);
        }

        FieldSpec placeholder(String p) {
            return new FieldSpec(path, label, type, options, hint, p, when);
        }

        FieldSpec when(Predicate<ControllerConfig> w) {
            return new FieldSpec(path, label, type, options, hint, placeholder, w);
        }
    }

    private record SectionSpec(String id, String label, String blurb, List<FieldSpec> fields) {
    }

    private static FieldSpec f(String path, String label) {
        return new FieldSpec(path, label, Type.TEXT, null, null, null, null);
    }

    private static FieldSpec f(String path, String label, Type type) {
        return new FieldSpec(path, label, type, null, null, null, null);
    }

    private static FieldSpec sel(String path, String label, List<Opt> options) {
        return new FieldSpec(path, label, Type.SELECT, options, null, null, null);
    }

    private static List<Opt> opts(List<String> ids) {
        return ids.stream().map(i -> new Opt(i, i)).toList();
    }

    private static final Predicate<ControllerConfig> STANDALONE = c -> c.mode.equals("standalone");
    private static final Predicate<ControllerConfig> HA = c -> c.mode.equals("ha");

    private static final List<SectionSpec> CONTROLLER_SECTIONS = List.of(
            new SectionSpec("identity", "Identity & PKI",
                    "The certificate and key this controller presents, and the CA bundle it trusts.", List.of(
                            sel("mode", "Deployment", List.of(new Opt("standalone", "Standalone"), new Opt("ha", "HA cluster"))),
                            f("trustDomain", "Trust domain").placeholder("e.g. example.ziti")
                                    .hint("SPIFFE trust domain. Required in HA clusters."),
                            f("identity.cert", "Client certificate"), f("identity.serverCert", "Server certificate chain"),
                            f("identity.key", "Private key"), f("identity.ca", "CA bundle"),
                            f("db", "Database path").when(STANDALONE), f("cluster.dataDir", "Data directory").when(HA),
                            f("cluster.snapshotInterval", "Snapshot interval").when(HA),
                            f("cluster.snapshotThreshold", "Snapshot threshold", Type.NUMBER).when(HA),
                            f("cluster.electionTimeout", "Election timeout").when(HA),
                            f("cluster.heartbeatTimeout", "Heartbeat timeout").when(HA),
                            sel("cluster.logLevel", "Raft log level", opts(ControllerConfig.LOG_LEVELS)).when(HA),
                            f("cluster.preferredLeader", "Preferred leader", Type.BOOL).when(HA))),
            new SectionSpec("ctrl", "Router listener",
                    "The listener routers dial to reach the controller, and the address it advertises.", List.of(
                            f("ctrl.listener", "Listener").placeholder("tls:0.0.0.0:6262"),
                            f("ctrl.advertiseAddress", "Advertise address").placeholder("tls:ctrl.example.com:6262")
                                    .hint("Must be reachable by every router."),
                            f("ctrl.connectTimeoutMs", "Connect timeout (ms)", Type.NUMBER),
                            f("ctrl.maxQueuedConnects", "Max queued connects", Type.NUMBER))),
            new SectionSpec("network", "Circuits", "Route timeouts, retries, smart rerouting and router cost limits.",
                    List.of(f("network.cycleSeconds", "Cycle (s)", Type.NUMBER),
                            f("network.routeTimeoutSeconds", "Route timeout (s)", Type.NUMBER),
                            f("network.createCircuitRetries", "Circuit retries", Type.NUMBER),
                            f("network.pendingLinkTimeoutSeconds", "Pending link timeout (s)", Type.NUMBER),
                            f("network.minRouterCost", "Min router cost", Type.NUMBER),
                            f("network.routerConnectChurnLimit", "Router connect churn limit"),
                            f("network.smartReroute", "Smart reroute", Type.BOOL),
                            f("network.rerouteFraction", "Reroute fraction", Type.NUMBER),
                            f("network.rerouteCap", "Reroute cap", Type.NUMBER))),
            new SectionSpec("edge", "Edge", "The edge API address, sessions, enrollment and token lifetimes.", List.of(
                    f("edge.enabled", "Edge enabled", Type.BOOL),
                    f("edge.apiAddress", "API address").placeholder("ctrl.example.com:1280"),
                    f("edge.sessionTimeout", "Session timeout"), f("edge.totpHostname", "TOTP hostname"),
                    f("edge.signingCert", "Signing certificate"), f("edge.signingKey", "Signing key"),
                    f("edge.identityEnrollmentDuration", "Identity enrollment duration"),
                    f("edge.routerEnrollmentDuration", "Router enrollment duration"),
                    f("edge.accessTokenDuration", "Access token duration"),
                    f("edge.refreshTokenDuration", "Refresh token duration"),
                    f("edge.authRateLimiter", "Auth rate limiter", Type.BOOL),
                    f("edge.authRateLimiterMax", "Rate limiter max size", Type.NUMBER))),
            new SectionSpec("web", "Web listeners", "Which APIs (and this console) are served on which addresses.",
                    List.of()),
            new SectionSpec("events", "Events & health",
                    "Write controller events to a file, and how often health checks run.",
                    List.of(f("healthCheckInterval", "Health check interval"))));

    private static final List<SectionSpec> ROUTER_SECTIONS = List.of(
            new SectionSpec("r-identity", "Identity & PKI",
                    "The certificate and key this router presents, and the CA bundle it uses to verify the controller.",
                    List.of(f("identity.cert", "Client certificate"), f("identity.serverCert", "Server certificate chain"),
                            f("identity.key", "Private key"), f("identity.ca", "CA bundle"))),
            new SectionSpec("r-ctrl", "Controllers",
                    "The controller endpoints this router dials (tls:host:port). List every controller in an HA cluster.",
                    List.of(f("ctrl.endpoints", "Controller endpoints (one per line)", Type.LIST),
                            f("ctrl.endpointsFile", "Endpoints file"))),
            new SectionSpec("r-link", "Links",
                    "How this router connects to other routers. A dialer connects out; a listener accepts connections in.",
                    List.of(f("link.dial", "Dial links", Type.BOOL), f("link.listen", "Listen for links", Type.BOOL),
                            f("link.bind", "Bind").placeholder("tls:0.0.0.0:10080"),
                            f("link.advertise", "Advertise").placeholder("tls:router.example.com:10080"),
                            f("link.outQueueSize", "Out queue size", Type.NULLABLE_NUMBER),
                            f("link.listenGroups", "Listener groups (one per line)", Type.LIST),
                            f("link.dialGroups", "Dialer groups (one per line)", Type.LIST))),
            new SectionSpec("r-edge", "Edge & tunnel",
                    "Where SDKs and tunnelers connect, and whether this router also tunnels.", List.of(
                            f("edge.enabled", "Edge listener", Type.BOOL),
                            f("edge.address", "Address").placeholder("tls:0.0.0.0:3022"),
                            f("edge.advertise", "Advertise").placeholder("router.example.com:3022"),
                            f("edge.connectTimeoutMs", "Connect timeout (ms)", Type.NULLABLE_NUMBER),
                            f("edge.getSessionTimeout", "Get session timeout (s)", Type.NULLABLE_NUMBER),
                            f("tunnel.enabled", "Tunnel", Type.BOOL),
                            sel("tunnel.mode", "Mode", RouterConfig.TUNNEL_MODES.stream()
                                    .map(m -> new Opt(m.id(), m.label() + ": " + m.hint())).toList()),
                            f("tunnel.resolver", "Resolver").placeholder("udp://127.0.0.1:53"),
                            f("tunnel.dnsSvcIpRange", "DNS service IP range").placeholder("100.64.0.1/10"),
                            f("tunnel.lanIf", "LAN interface"))),
            new SectionSpec("r-csr", "Certificate request",
                    "Subject and SANs for the router’s certificate. Clients verify the router by these names and addresses.",
                    List.of(f("csr.country", "Country"), f("csr.province", "Province"), f("csr.locality", "Locality"),
                            f("csr.organization", "Organization"), f("csr.organizationalUnit", "Organizational unit"),
                            f("csr.dns", "DNS SANs (one per line)", Type.LIST),
                            f("csr.ip", "IP SANs (one per line)", Type.LIST))),
            new SectionSpec("r-tuning", "Tuning",
                    "Forwarder queues, metrics and controller health pings. Leave blank to use the router default.",
                    List.of(f("forwarder.xgressDialQueueLength", "Xgress dial queue length", Type.NULLABLE_NUMBER),
                            f("forwarder.xgressDialWorkerCount", "Xgress dial workers", Type.NULLABLE_NUMBER),
                            f("forwarder.linkDialQueueLength", "Link dial queue length", Type.NULLABLE_NUMBER),
                            f("forwarder.linkDialWorkerCount", "Link dial workers", Type.NULLABLE_NUMBER),
                            f("metrics.reportInterval", "Metrics report interval"),
                            f("metrics.messageQueueSize", "Metrics queue size", Type.NULLABLE_NUMBER),
                            f("health.ctrlPingInterval", "Controller ping interval"),
                            f("health.ctrlPingTimeout", "Controller ping timeout"),
                            f("health.ctrlPingInitialDelay", "Controller ping initial delay"),
                            f("health.minLinks", "Min links for healthy", Type.NULLABLE_NUMBER))));

    // ------------------------------------------------------------------ state

    private String kind = "controller";
    private ControllerConfig cfg = ControllerConfig.defaults();
    private RouterConfig rcfg = RouterConfig.defaults();
    private String active = "identity";
    private boolean verbose;
    private String fileName;
    private String loadError;
    private List<String> loadWarnings = List.of();
    private List<ValidationIssue> issues = List.of();
    private String yamlText = "";

    private final Tabs kindTabs = new Tabs();
    private final Tab controllerTab = new Tab("Controller");
    private final Tab routerTab = new Tab("Router");
    private final Div status = new Div();
    private final Div nav = new Div();
    private final Div form = new Div();
    private final Div sectionIssues = new Div();
    private final Div fields = new Div();
    private final Span outName = new Span();
    private final Span validity = new Span();
    private final Pre preview = new Pre();
    private final Checkbox verboseBox = new Checkbox("Include defaults");
    private final Map<String, Component> fieldByPath = new LinkedHashMap<>();

    public ConfigBuilderView() {
        addClassName("bp-page");

        kindTabs.add(controllerTab, routerTab);
        kindTabs.addThemeVariants(TabsVariant.AURA_FILLED);
        kindTabs.getElement().setAttribute("aria-label", "Config kind");
        kindTabs.addSelectedChangeListener(e -> {
            if (e.isFromClient()) {
                switchKind(e.getSelectedTab() == routerTab ? "router" : "controller");
            }
        });

        Upload upload = new Upload(UploadHandler.inMemory((meta, bytes) -> {
            String text = new String(bytes, StandardCharsets.UTF_8);
            String name = meta.fileName();
            getUI().ifPresent(ui -> ui.access(() -> openFile(name, text)));
        }));
        upload.setMaxFiles(1);
        upload.setMaxFileSize(2 * 1024 * 1024);
        upload.setDropAllowed(false);
        upload.setUploadButton(Ui.button("Open file…", VaadinIcon.UPLOAD, null));
        upload.getElement().setAttribute("accept", ".yml,.yaml,.json,text/yaml,application/json");
        upload.addClassName("bp-upload-inline");
        upload.addAllFinishedListener(e -> upload.clearFileList());
        Button reset = Ui.button("Start over", VaadinIcon.ROTATE_LEFT, this::reset);

        Div header = Ui.pageHeader("Config Builder", "Build or edit a controller or router config file with validation. "
                + "Nothing is sent to the controller; download the file and deploy it yourself.");
        Div tools = Ui.toolbar(kindTabs, upload, reset);
        Div top = new Div(header, Ui.spacer(), tools);
        top.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("align-items", "flex-end").set("gap", "12px");

        status.getElement().setAttribute("role", "status");

        nav.addClassName("bp-cb-nav");
        nav.getElement().setAttribute("aria-label", "Sections");
        nav.getElement().setAttribute("role", "navigation");

        form.addClassName("bp-card");
        form.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "12px");
        sectionIssues.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "6px");
        fields.addClassName("bp-cb-fields");

        verboseBox.setTooltipText("Also write values that equal the controller default");
        verboseBox.addValueChangeListener(e -> {
            verbose = e.getValue();
            refresh();
        });
        Button copy = Ui.small("Copy", VaadinIcon.COPY, () -> {
            getElement().executeJs("return navigator.clipboard.writeText($0)", yamlText);
            Toast.success("Copied", outFileName() + " is on the clipboard.");
        });
        Anchor download = new Anchor(DownloadHandler.fromInputStream(ev -> {
            byte[] b = yamlText.getBytes(StandardCharsets.UTF_8);
            return new DownloadResponse(new ByteArrayInputStream(b), outFileName(), "application/yaml;charset=utf-8", b.length);
        }), "");
        Button dl = Ui.small("Download", VaadinIcon.DOWNLOAD_ALT, null);
        dl.addThemeVariants(ButtonVariant.PRIMARY);
        download.add(dl);
        outName.addClassNames("bp-mono", "bp-strong");
        Div left = new Div(outName, validity);
        left.getStyle().set("display", "flex").set("align-items", "center").set("gap", "8px");
        Div right = new Div(verboseBox, copy, download);
        right.getStyle().set("display", "flex").set("align-items", "center").set("gap", "6px");
        Div head = new Div(left, right);
        head.addClassName("bp-cb-preview-head");
        preview.addClassName("bp-pre");
        preview.getElement().setAttribute("aria-label", "Generated YAML");
        Div previewCard = new Div(head, preview);
        previewCard.addClassNames("bp-card", "bp-cb-preview");

        Div grid = new Div(nav, form, previewCard);
        grid.addClassName("bp-cb");
        add(top, status, grid);
        renderAll();
    }

    // ------------------------------------------------------------------ model access

    private Object model() {
        return kind.equals("router") ? rcfg : cfg;
    }

    private List<SectionSpec> sections() {
        return kind.equals("router") ? ROUTER_SECTIONS : CONTROLLER_SECTIONS;
    }

    private SectionSpec section() {
        return sections().stream().filter(s -> s.id().equals(active)).findFirst().orElse(sections().getFirst());
    }

    private static Field field(Class<?> c, String name) {
        try {
            return c.getField(name);
        } catch (NoSuchFieldException e) {
            throw new IllegalStateException("No field " + name + " on " + c.getSimpleName(), e);
        }
    }

    private static Object getAt(Object root, String path) {
        Object cur = root;
        try {
            for (String k : path.split("\\.")) {
                cur = field(cur.getClass(), k).get(cur);
            }
            return cur;
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void setAt(Object root, String path, Object value) {
        String[] parts = path.split("\\.");
        Object cur = root;
        try {
            for (int i = 0; i < parts.length - 1; i++) {
                cur = field(cur.getClass(), parts[i]).get(cur);
            }
            field(cur.getClass(), parts[parts.length - 1]).set(cur, value);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    private String outFileName() {
        return fileName != null ? fileName : kind.equals("router") ? "router.yml" : "ctrl.yml";
    }

    // ------------------------------------------------------------------ actions

    private void switchKind(String k) {
        kind = k;
        active = sections().getFirst().id();
        kindTabs.setSelectedTab(k.equals("router") ? routerTab : controllerTab);
        renderAll();
    }

    void openFile(String name, String text) {
        try {
            Map<String, Object> doc = YamlSupport.parseMap(text);
            String detected = RouterConfig.detectKind(doc);
            String k = detected.equals("unknown") ? kind : detected;
            List<String> warnings = new ArrayList<>();
            if (detected.equals("unknown")) {
                warnings.add("Could not tell if this is a controller or router config; opened it as a " + k + " config.");
            }
            if (k.equals("router")) {
                RouterConfig.Loaded r = RouterConfig.fromDocument(doc);
                rcfg = r.cfg();
                warnings.addAll(r.warnings());
            } else {
                ControllerConfig.Loaded r = ControllerConfig.fromDocument(doc);
                cfg = r.cfg();
                warnings.addAll(r.warnings());
            }
            fileName = name;
            loadError = null;
            loadWarnings = warnings;
            switchKind(k);
        } catch (RuntimeException e) {
            loadError = "Could not read " + name + ": " + e.getMessage();
            loadWarnings = List.of();
            renderStatus();
        }
    }

    private void reset() {
        if (kind.equals("router")) {
            rcfg = RouterConfig.defaults();
        } else {
            cfg = ControllerConfig.defaults();
        }
        fileName = null;
        loadError = null;
        loadWarnings = List.of();
        renderAll();
    }

    /** A value edit: recompute issues and the preview without rebuilding the form (keeps focus). */
    private void update(String path, Object value, boolean structural) {
        setAt(model(), path, value);
        if (structural) {
            renderForm();
        }
        refresh();
    }

    // ------------------------------------------------------------------ rendering

    private void renderAll() {
        renderStatus();
        renderForm();
        refresh();
    }

    private void renderStatus() {
        status.removeAll();
        status.setVisible(loadError != null || !loadWarnings.isEmpty() || fileName != null);
        status.setClassName("bp-callout");
        if (loadError != null) {
            status.addClassName("error");
            status.add(new Div(loadError));
        } else if (fileName != null) {
            status.add(new Div(new Span("Editing "), Ui.mono(fileName),
                    new Span(". Keys this form does not manage are kept as they are.")));
        }
        for (String w : loadWarnings) {
            Div d = new Div(w);
            d.getStyle().set("color", "var(--ac-pending)");
            status.add(d);
        }
    }

    private void renderForm() {
        form.removeAll();
        fieldByPath.clear();
        fields.removeAll();
        SectionSpec s = section();
        H2 h = new H2(s.label());
        h.getStyle().set("font-size", "var(--aura-font-size-m)").set("margin", "0");
        Paragraph blurb = new Paragraph(s.blurb());
        blurb.addClassNames("bp-muted", "bp-small");
        blurb.getStyle().set("margin", "0");
        form.add(new Div(h, blurb), sectionIssues, fields);
        for (FieldSpec spec : s.fields()) {
            if (spec.when() != null && !(kind.equals("controller") && spec.when().test(cfg))) {
                continue;
            }
            Component c = fieldFor(spec);
            fieldByPath.put(spec.path(), c);
            if (spec.type() == Type.LIST || spec.type() == Type.BOOL) {
                c.getElement().getClassList().add("wide");
            }
            fields.add(c);
        }
        if (kind.equals("controller") && s.id().equals("web")) {
            form.add(webEditor());
        }
        if (kind.equals("controller") && s.id().equals("events")) {
            form.add(eventsEditor());
        }
    }

    private Component fieldFor(FieldSpec spec) {
        Object value = getAt(model(), spec.path());
        // a select or checkbox can change which fields are shown (deployment mode)
        boolean structural = spec.path().equals("mode");
        switch (spec.type()) {
            case BOOL -> {
                Checkbox cb = new Checkbox(spec.label(), Boolean.TRUE.equals(value));
                if (spec.hint() != null) {
                    cb.setHelperText(spec.hint());
                }
                cb.addValueChangeListener(e -> update(spec.path(), e.getValue(), structural));
                return cb;
            }
            case SELECT -> {
                Select<String> s = new Select<>();
                s.setLabel(spec.label());
                s.setItems(spec.options().stream().map(Opt::id).toList());
                s.setItemLabelGenerator(id -> spec.options().stream().filter(o -> o.id().equals(id)).map(Opt::label)
                        .findFirst().orElse(id));
                s.setValue(String.valueOf(value));
                if (spec.hint() != null) {
                    s.setHelperText(spec.hint());
                }
                s.addValueChangeListener(e -> {
                    if (e.isFromClient()) {
                        update(spec.path(), e.getValue(), structural);
                    }
                });
                return s;
            }
            case LIST -> {
                TextArea a = new TextArea(spec.label());
                @SuppressWarnings("unchecked")
                List<String> list = (List<String>) value;
                a.setValue(String.join("\n", list));
                a.setMinRows(3);
                a.addClassName("mono");
                a.setValueChangeMode(ValueChangeMode.LAZY);
                a.addValueChangeListener(e -> {
                    if (e.isFromClient()) {
                        update(spec.path(), new ArrayList<>(e.getValue().lines().map(String::trim)
                                .filter(x -> !x.isEmpty()).toList()), false);
                    }
                });
                return a;
            }
            case NUMBER, NULLABLE_NUMBER -> {
                NumberField n = new NumberField(spec.label());
                n.setValue(value == null ? null : ((Number) value).doubleValue());
                n.setPlaceholder(spec.placeholder() != null ? spec.placeholder()
                        : spec.type() == Type.NULLABLE_NUMBER ? "default" : null);
                n.addClassName("mono");
                n.setValueChangeMode(ValueChangeMode.LAZY);
                if (spec.hint() != null) {
                    n.setHelperText(spec.hint());
                }
                boolean nullable = spec.type() == Type.NULLABLE_NUMBER;
                n.addValueChangeListener(e -> {
                    if (!e.isFromClient()) {
                        return;
                    }
                    Double v = e.getValue();
                    if (nullable) {
                        update(spec.path(), v, false);
                    } else {
                        update(spec.path(), v == null ? 0d : v, false);
                    }
                });
                return n;
            }
            default -> {
                TextField t = new TextField(spec.label());
                t.setValue(value == null ? "" : String.valueOf(value));
                t.addClassName("mono");
                t.setValueChangeMode(ValueChangeMode.LAZY);
                if (spec.placeholder() != null) {
                    t.setPlaceholder(spec.placeholder());
                }
                if (spec.hint() != null) {
                    t.setHelperText(spec.hint());
                }
                t.addValueChangeListener(e -> {
                    if (e.isFromClient()) {
                        update(spec.path(), e.getValue(), false);
                    }
                });
                return t;
            }
        }
    }

    /** Recompute validation and YAML; update badges, field errors and the preview in place. */
    private void refresh() {
        issues = kind.equals("router") ? rcfg.validate() : cfg.validate();
        String text;
        try {
            text = kind.equals("router") ? rcfg.toYaml() : cfg.toYaml(verbose);
        } catch (RuntimeException e) {
            text = "# Could not generate YAML: " + e.getMessage();
        }
        yamlText = text;
        preview.setText(yamlText);
        outName.setText(outFileName());
        verboseBox.setVisible(kind.equals("controller"));
        long errors = issues.stream().filter(ValidationIssue::isError).count();
        validity.removeAll();
        validity.add(errors > 0 ? Ui.chip(errors + " error" + (errors == 1 ? "" : "s"), "bad") : Ui.chip("Valid", "ok"));

        nav.removeAll();
        for (SectionSpec s : sections()) {
            long n = issues.stream().filter(i -> inSection(i, s.id()) && i.isError()).count();
            long w = issues.stream().filter(i -> inSection(i, s.id()) && !i.isError()).count();
            NativeButton b = new NativeButton();
            b.add(new Span(s.label()));
            if (n > 0) {
                Span c = new Span(String.valueOf(n));
                c.addClassName("bp-cb-count");
                c.getElement().setAttribute("aria-label", n + " error" + (n == 1 ? "" : "s"));
                b.add(c);
            } else if (w > 0) {
                Span c = new Span(String.valueOf(w));
                c.addClassNames("bp-cb-count", "warn");
                c.getElement().setAttribute("aria-label", w + " warning" + (w == 1 ? "" : "s"));
                b.add(c);
            }
            b.getElement().setAttribute("aria-current", String.valueOf(s.id().equals(section().id())));
            b.addClickListener(e -> {
                active = s.id();
                renderForm();
                refresh();
            });
            nav.add(b);
        }

        // Storage problems are reported on Identity & PKI, where the storage fields live.
        String sid = section().id();
        sectionIssues.removeAll();
        issues.stream()
                .filter(i -> inSection(i, sid)
                        && (i.field() == null || i.field().isEmpty() || !fieldByPath.containsKey(i.field())))
                .forEach(i -> {
                    Div d = Ui.callout(i.isError() ? "error" : "warn",
                            new Span(Ui.icon(VaadinIcon.WARNING, null), new Span(" " + i.message())));
                    d.getStyle().set("padding", "6px 10px");
                    sectionIssues.add(d);
                });
        fieldByPath.forEach((path, c) -> {
            ValidationIssue issue = issues.stream().filter(i -> path.equals(i.field())).findFirst().orElse(null);
            if (c instanceof HasValidation v) {
                v.setInvalid(issue != null);
                v.setErrorMessage(issue == null ? null : issue.message());
            }
        });
    }

    /** Storage settings live on the Identity & PKI section, so their issues count there. */
    private static boolean inSection(ValidationIssue i, String sectionId) {
        return i.section().equals(sectionId) || (sectionId.equals("identity") && i.section().equals("storage"));
    }

    // ------------------------------------------------------------------ list editors (controller)

    private Component webEditor() {
        Div wrap = new Div();
        wrap.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "12px");
        for (int i = 0; i < cfg.web.size(); i++) {
            WebListener w = cfg.web.get(i);
            TextField name = cbText("Listener name", w.name, v -> w.name = v);
            name.setWidthFull();
            Button remove = Ui.iconButton(VaadinIcon.TRASH, "Remove listener " + w.name, () -> {
                cfg.web.remove(w);
                renderForm();
                refresh();
            });
            remove.addThemeVariants(ButtonVariant.ERROR);
            Div nameRow = new Div(name, remove);
            nameRow.getStyle().set("display", "flex").set("align-items", "flex-end").set("gap", "8px");

            Div bps = new Div(Ui.strong("Bind points"));
            bps.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "6px");
            for (BindPoint bp : w.bindPoints) {
                if (bp.identity != null) {
                    Div d = new Div(new Span("Overlay bind point (service "),
                            new Code(bp.identity.service.isEmpty() ? "?" : bp.identity.service),
                            new Span(") — kept as in the file."));
                    d.addClassNames("bp-muted", "bp-small");
                    bps.add(d);
                    continue;
                }
                TextField iface = cbText(null, bp.iface, v -> bp.iface = v);
                iface.setPlaceholder("interface 0.0.0.0:1280");
                iface.setAriaLabel("Interface");
                TextField addr = cbText(null, bp.address, v -> bp.address = v);
                addr.setPlaceholder("address ctrl.example.com:1280");
                addr.setAriaLabel("Address");
                Button rm = Ui.iconButton(VaadinIcon.TRASH, "Remove bind point", () -> {
                    w.bindPoints.remove(bp);
                    renderForm();
                    refresh();
                });
                Div row = new Div(iface, addr, rm);
                row.getStyle().set("display", "grid").set("grid-template-columns", "1fr 1fr auto").set("gap", "6px");
                bps.add(row);
            }
            bps.add(Ui.small("Bind point", VaadinIcon.PLUS, () -> {
                w.bindPoints.add(new BindPoint("0.0.0.0:443", ""));
                renderForm();
                refresh();
            }));

            Div apis = new Div();
            apis.addClassName("bp-cb-checks");
            for (ControllerConfig.Api a : ControllerConfig.API_BINDINGS) {
                Checkbox cb = new Checkbox(a.label(), w.api(a.id()));
                cb.setTooltipText(a.hint());
                cb.addValueChangeListener(e -> {
                    w.apis.put(a.id(), e.getValue());
                    if (a.id().equals("spa")) {
                        renderForm();
                    }
                    refresh();
                });
                apis.add(cb);
            }
            Div card = new Div(nameRow, bps, Ui.strong("APIs"), apis);
            card.addClassName("bp-cb-sub");
            if (w.api("spa")) {
                card.add(FormGrid.of(cbText("Console URL path", w.spaPath, v -> w.spaPath = v),
                        cbText("Console files on disk", w.spaLocation, v -> w.spaLocation = v)));
            }
            wrap.add(card);
        }
        wrap.add(Ui.small("Web listener", VaadinIcon.PLUS, () -> {
            WebListener w = new WebListener();
            w.name = "listener-" + (cfg.web.size() + 1);
            w.bindPoints.add(new BindPoint("0.0.0.0:8443", ""));
            w.apis.put("health-checks", true);
            cfg.web.add(w);
            renderForm();
            refresh();
        }));
        Paragraph p = new Paragraph("Client certificate policies for overlay bind points: "
                + String.join(", ", ControllerConfig.CLIENT_AUTH_LABELS) + ". Edit those in the file.");
        p.addClassNames("bp-muted", "bp-xs");
        p.getStyle().set("margin", "0");
        wrap.add(p);
        return wrap;
    }

    private Component eventsEditor() {
        Div wrap = new Div(Ui.strong("Event loggers"));
        wrap.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "12px");
        if (cfg.events.isEmpty()) {
            wrap.add(Ui.muted("No event loggers. Events are not written anywhere."));
        }
        for (EventLogger ev : cfg.events) {
            TextField name = cbText("Name", ev.name, v -> ev.name = v);
            Select<String> format = new Select<>();
            format.setLabel("Format");
            format.setItems("json", "cs");
            format.setValue(ev.format);
            format.setWidth("7rem");
            format.addValueChangeListener(e -> {
                ev.format = e.getValue();
                refresh();
            });
            TextField path = cbText("File path", ev.path, v -> ev.path = v);
            Button rm = Ui.iconButton(VaadinIcon.TRASH, "Remove logger " + ev.name, () -> {
                cfg.events.remove(ev);
                renderForm();
                refresh();
            });
            rm.addThemeVariants(ButtonVariant.ERROR);
            Div row = new Div(name, format, path, rm);
            row.getStyle().set("display", "grid").set("grid-template-columns", "minmax(0,1fr) 7rem minmax(0,2fr) auto")
                    .set("gap", "8px").set("align-items", "end");
            Div subs = new Div();
            subs.addClassName("bp-cb-checks");
            for (String s : ControllerConfig.EVENT_SUBSCRIPTIONS) {
                Checkbox cb = new Checkbox(s, ev.subscriptions.contains(s));
                cb.addClassName("bp-mono");
                cb.addValueChangeListener(e -> {
                    if (e.getValue()) {
                        ev.subscriptions.add(s);
                    } else {
                        ev.subscriptions.remove(s);
                    }
                    refresh();
                });
                subs.add(cb);
            }
            Div card = new Div(row, subs);
            card.addClassName("bp-cb-sub");
            wrap.add(card);
        }
        wrap.add(Ui.small("Event logger", VaadinIcon.PLUS, () -> {
            EventLogger ev = new EventLogger();
            ev.name = cfg.events.isEmpty() ? "jsonLogger" : "logger-" + (cfg.events.size() + 1);
            ev.subscriptions = new ArrayList<>(List.of("circuit", "session"));
            ev.path = "/var/log/ziti/events.json";
            cfg.events.add(ev);
            renderForm();
            refresh();
        }));
        return wrap;
    }

    private TextField cbText(String label, String value, java.util.function.Consumer<String> set) {
        TextField t = label == null ? new TextField() : new TextField(label);
        t.setValue(value == null ? "" : value);
        t.addClassName("mono");
        t.setValueChangeMode(ValueChangeMode.LAZY);
        t.addValueChangeListener(e -> {
            if (e.isFromClient()) {
                set.accept(e.getValue());
                refresh();
            }
        });
        return t;
    }

    /** Two-column responsive grid. */
    private static final class FormGrid {
        static Div of(Component... c) {
            Div d = new Div(c);
            d.addClassName("bp-cb-fields");
            return d;
        }
    }

    // test hooks
    String yaml() {
        return yamlText;
    }

    List<ValidationIssue> issues() {
        return issues;
    }
}
