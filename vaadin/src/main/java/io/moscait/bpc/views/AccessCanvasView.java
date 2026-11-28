package io.moscait.bpc.views;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import io.moscait.bpc.canvas.AccessLogic;
import io.moscait.bpc.canvas.LayoutFile;
import io.moscait.bpc.canvas.AccessLogic.AcEndpoint;
import io.moscait.bpc.canvas.AccessLogic.AcStep;
import io.moscait.bpc.canvas.AcModel;
import io.moscait.bpc.canvas.AcModel.AcConcurrency;
import io.moscait.bpc.canvas.AcModel.AcEntity;
import io.moscait.bpc.canvas.AcModel.AcIdentity;
import io.moscait.bpc.canvas.AcModel.AcKind;
import io.moscait.bpc.canvas.AcModel.AcLayout;
import io.moscait.bpc.canvas.AcModel.AcOp;
import io.moscait.bpc.canvas.AcModel.AcService;
import io.moscait.bpc.canvas.AcModel.CreateIdentity;
import io.moscait.bpc.canvas.AcModel.CreateService;
import io.moscait.bpc.canvas.BoardLogic;
import io.moscait.bpc.canvas.BoardLogic.Board;
import io.moscait.bpc.canvas.BoardLogic.BoardFilters;
import io.moscait.bpc.canvas.BoardLogic.BoardNode;
import io.moscait.bpc.canvas.BoardLogic.Clip;
import io.moscait.bpc.canvas.BoardLogic.ClipItem;
import io.moscait.bpc.canvas.BoardLogic.GroupedItem;
import io.moscait.bpc.canvas.BoardLogic.Intent;
import io.moscait.bpc.canvas.Problems;
import io.moscait.bpc.canvas.WizardLogic.Plan;
import io.moscait.bpc.canvas.ui.AcBoard;
import io.moscait.bpc.canvas.ui.AccessWizard;
import io.moscait.bpc.canvas.ui.GrantAccessDialog;
import io.moscait.bpc.canvas.ui.ProblemsDialog;
import io.moscait.bpc.sessions.IpFilter;
import io.moscait.bpc.sessions.SessionMonitor;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ui.ZitiView;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiException;
import io.moscait.bpc.ziti.ZitiService;
import io.moscait.bpc.ziti.ZitiService.AcRevert;
import io.moscait.bpc.ziti.ZitiService.CanvasApplyError;
import io.moscait.bpc.ziti.ZitiService.RevertFailure;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.Key;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H3;
import com.vaadin.flow.component.html.ListItem;
import com.vaadin.flow.component.html.NativeButton;
import com.vaadin.flow.component.html.OrderedList;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Pre;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.html.UnorderedList;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.popover.Popover;
import com.vaadin.flow.component.popover.PopoverPosition;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;
import com.vaadin.flow.component.tabs.TabsVariant;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.component.upload.Upload;
import com.vaadin.flow.data.value.ValueChangeMode;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;
import com.vaadin.flow.router.RouterLink;
import com.vaadin.flow.server.streams.DownloadHandler;
import com.vaadin.flow.server.streams.DownloadResponse;
import com.vaadin.flow.server.streams.UploadHandler;

/**
 * The Access Canvas: the network as groups, cards and policy lines. Edits are staged as change
 * sets and only reach the controller on Apply; the last applied set can be undone.
 */
@Route(value = "access-canvas", layout = MainLayout.class)
@RouteAlias(value = "network-visualizer", layout = MainLayout.class)
@PageTitle("Access Canvas")
public class AccessCanvasView extends ZitiView {

    /** A change set queued on the canvas, not yet sent to the controller. */
    public record Pending(String id, String title, String summary, List<AcOp> ops, List<String> calls, List<String> next) {
    }

    record Applied(String title, List<AcRevert> reverts) {
    }

    record FollowUp(String title, List<String> steps) {
    }


    // ------------------------------------------------------------------ state
    private AcModel committed;
    private String loadError;
    private List<Map<String, Object>> apiSessions = List.of();
    private final List<Pending> pending = new ArrayList<>();
    private final List<Applied> history = new ArrayList<>();
    private final List<FollowUp> followUps = new ArrayList<>();
    private boolean busy;
    private AcLayout layout = new AcLayout();
    private BoardFilters filters = BoardFilters.showEverything();
    private final Set<String> expanded = new HashSet<>();
    private Clip clip;
    private String drawer;
    private String advisorI = "";
    private String advisorS = "";
    private int seq = 1;

    // derived
    private AcModel draft;
    private Board board = new Board(List.of(), List.of());
    private Problems.Result problems = new Problems.Result(List.of(), 0);

    // ------------------------------------------------------------------ components
    private final AcBoard boardEl = new AcBoard();
    private final Div status = new Div();
    private final Div body = new Div();
    private final TextField search = new TextField();
    private final Span matches = new Span();
    private final Button filtersButton = new Button("Filters", VaadinIcon.FILTER.create());
    private final Div filterPanel = new Div();
    private final Button problemsButton = new Button();
    private final Button clearFilters = new Button("Clear filters");
    private final Span clipChip = new Span();
    private final Div dock = new Div();
    private final Div drawerEl = new Div();
    private final Div setupCard = new Div();
    private final Button setupButton = Ui.primary("Set up a service", VaadinIcon.MAGIC, this::openWizard);
    private final Tab boardTab = new Tab("Board");
    private final Tab graphTab = new Tab("Flow Graph");

    public AccessCanvasView(ZitiService ziti) {
        super(ziti);
        addClassName("ac-page");
        layout = ziti.loadLayout();

        add(header(), toolbar(), status, body);
        status.setVisible(false);

        Div boardWrap = new Div(boardEl, dock, setupCard);
        boardWrap.addClassName("ac-board-wrap");
        dock.addClassName("ac-dock");
        setupCard.addClassName("ac-setup");
        drawerEl.addClassNames("bp-card", "ac-drawer");
        Div legend = legend();
        Div main = new Div(boardWrap, legend);
        main.addClassName("ac-main");
        body.add(main, drawerEl);
        body.addClassName("ac-body");

        boardEl.addMovedListener(e -> onMoved(e.payload()));
        boardEl.addMemberDropListener(e -> onMemberDrop(e.payload()));
        boardEl.addNodeDropListener(e -> onNodeDrop(e.payload()));
        boardEl.addCommandListener(e -> onCommand(e.payload()));
    }

    // ------------------------------------------------------------------ chrome

    private Component header() {
        Div title = Ui.pageHeader("Access Canvas", "Drag cards between groups, or drag an identity onto a service. "
                + "Lines are policies. Nothing changes until you apply.");
        Tabs engine = new Tabs(boardTab, graphTab);
        engine.addThemeVariants(TabsVariant.AURA_FILLED);
        engine.getElement().setAttribute("aria-label", "Canvas engine");
        boardTab.setTooltipText("Free-form board: drag members between groups, marquee select, clipboard");
        graphTab.setTooltipText("Flow graph: drag from an identity's connector onto a service to grant access; minimap");
        engine.addSelectedChangeListener(e -> boardEl.setMode(e.getSelectedTab() == graphTab ? "graph" : "board"));

        Button help = Ui.iconButton(VaadinIcon.QUESTION_CIRCLE_O, "How to use the canvas", null);
        Popover helpPop = new Popover();
        helpPop.setTarget(help);
        helpPop.setPosition(PopoverPosition.BOTTOM_END);
        helpPop.setWidth("26rem");
        helpPop.setAriaLabel("How to use the canvas");
        helpPop.add(helpContent());

        Div right = new Div(engine, setupButton, help, helpPop);
        right.addClassName("ac-head-actions");
        Div h = new Div(title, Ui.spacer(), right);
        h.addClassName("ac-head");
        return h;
    }

    private Component helpContent() {
        Div d = new Div();
        d.addClassName("ac-help");
        d.add(Ui.strong("Using the Access Canvas"));
        UnorderedList ul = new UnorderedList();
        String[][] tips = {
                { "Zoom & Pan:", " mouse wheel, pinch, ⌘/Ctrl+scroll, or + / −. Press 0 to fit." },
                { "Group membership:", " drag a card into another group to move it (hold Alt/Option to copy), or onto "
                        + "empty space to remove it from the group." },
                { "Grant Access:", " drag an identity (or an entire identity group) onto a service or service group." },
                { "Copy Access:", " ⌘/Ctrl+C a card, select another card or group, ⌘/Ctrl+V. Paste on empty space to clone." },
                { "Advisor:", " double-click any card or press Enter to diagnose its end-to-end connectivity path." } };
        for (String[] t : tips) {
            ul.add(new ListItem(Ui.strong(t[0]), new Span(t[1])));
        }
        d.add(ul, Ui.strong("OpenZiti Concepts"));
        for (String c : List.of("identities", "services", "dial", "bind", "routers")) {
            Paragraph p = new Paragraph(AccessLogic.CONCEPTS.get(c));
            p.addClassNames("bp-small", "bp-muted");
            d.add(p);
        }
        return d;
    }

    private Component toolbar() {
        search.setPlaceholder("Filter by name, e.g. devbox or crm");
        search.setPrefixComponent(VaadinIcon.SEARCH.create());
        search.setClearButtonVisible(true);
        search.setValueChangeMode(ValueChangeMode.LAZY);
        search.setAriaLabel("Filter by name");
        search.setWidth("18rem");
        search.addValueChangeListener(e -> {
            filters.search = e.getValue();
            render();
        });
        search.addKeyDownListener(Key.ENTER, e -> board.nodes().stream().filter(n -> n.hit).findFirst()
                .ifPresent(n -> boardEl.reveal(n.key, null)));
        matches.addClassNames("bp-muted", "bp-xs");

        Popover filterPop = new Popover(filterPanel);
        filterPop.setTarget(filtersButton);
        filterPop.setPosition(PopoverPosition.BOTTOM_START);
        filterPop.setWidth("22rem");
        filterPop.setAriaLabel("Filters");
        filterPop.addOpenedChangeListener(e -> {
            if (e.isOpened()) {
                renderFilterPanel();
            }
        });
        filterPanel.addClassName("ac-filters");

        problemsButton.setIcon(VaadinIcon.WARNING.create());
        problemsButton.addClickListener(e -> openProblems());
        problemsButton.addClassName("ac-problems");
        clearFilters.addThemeVariants(ButtonVariant.TERTIARY);
        clearFilters.addClickListener(e -> {
            filters = BoardFilters.showEverything();
            search.clear();
            render();
        });
        clipChip.addClassName("bp-chip");

        Button layoutButton = new Button("Layout", VaadinIcon.GRID_BIG_O.create());
        Popover layoutPop = new Popover(layoutMenu());
        layoutPop.setTarget(layoutButton);
        layoutPop.setPosition(PopoverPosition.BOTTOM_END);
        layoutPop.setWidth("18rem");

        Button refresh = new Button("Refresh", VaadinIcon.REFRESH.create(), e -> {
            safeReload();
            boardEl.fit();
        });
        Div bar = new Div(search, matches, filtersButton, filterPop, problemsButton, clearFilters, clipChip,
                Ui.spacer(), layoutButton, layoutPop, refresh);
        bar.addClassName("ac-toolbar");
        return bar;
    }

    private Component layoutMenu() {
        Paragraph p = new Paragraph("Card positions are saved per controller for this session and never alter "
                + "access policies.");
        p.addClassNames("bp-xs", "bp-muted");
        p.getStyle().set("margin", "0");
        Button arrange = new Button("Arrange automatically", e -> autoArrange());
        arrange.setWidthFull();
        Anchor export = new Anchor(DownloadHandler.fromInputStream(ev -> {
            byte[] b = exportLayout().getBytes(StandardCharsets.UTF_8);
            return new DownloadResponse(new ByteArrayInputStream(b), LayoutFile.fileName(ziti.controllerUrl()), "application/json", b.length);
        }), "");
        Button exportButton = new Button("Export layout (.json)…");
        exportButton.setWidthFull();
        export.add(exportButton);
        export.getStyle().set("display", "block");
        Upload upload = new Upload(UploadHandler.inMemory((meta, bytes) -> {
            String text = new String(bytes, StandardCharsets.UTF_8);
            String name = meta.fileName();
            getUI().ifPresent(ui -> ui.access(() -> importLayout(name, text)));
        }));
        upload.setMaxFiles(1);
        upload.setDropAllowed(false);
        upload.getElement().setAttribute("accept", "application/json,.json");
        Button importButton = new Button("Import layout…");
        importButton.setWidthFull();
        upload.setUploadButton(importButton);
        upload.addAllFinishedListener(e -> upload.clearFileList());
        upload.addClassName("bp-upload-inline");
        Div d = new Div(p, arrange, export, upload);
        d.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "6px");
        return d;
    }

    private Div legend() {
        Div d = new Div();
        d.addClassName("ac-legend");
        d.getElement().setAttribute("aria-label", "Legend");
        String[][] lines = { { "Dial (use)", "var(--ac-dial)", "" }, { "Bind (host)", "var(--ac-bind)", "" },
                { "Routers", "var(--ac-router)", "" }, { "By name (@)", "var(--ac-dial)", "dotted" },
                { "Pending", "var(--ac-pending)", "dashed" } };
        for (String[] l : lines) {
            Span sw = new Span();
            sw.addClassName("sw");
            if (l[2].isEmpty()) {
                sw.getStyle().set("background", l[1]);
            } else {
                sw.getStyle().set("background", "transparent").set("border-top", "2px " + l[2] + " " + l[1])
                        .set("height", "0");
            }
            d.add(new Span(sw, new Span(l[0])));
        }
        return d;
    }

    // ------------------------------------------------------------------ loading

    /** Set while applying change sets: each write notifies, but one reload at the end is enough. */
    private boolean deferReload;

    @Override
    protected void reload() {
        if (deferReload) {
            return;
        }
        try {
            committed = ziti.loadCanvasModel();
            loadError = null;
        } catch (RuntimeException e) {
            loadError = ZitiException.text(e);
        }
        try {
            // Live session overlay only; a failure leaves it empty.
            apiSessions = ziti.list("api-sessions");
        } catch (RuntimeException e) {
            apiSessions = List.of();
        }
        render();
    }

    // ------------------------------------------------------------------ derived model

    private void derive() {
        if (committed == null) {
            draft = null;
            return;
        }
        AcModel d = committed.copy();
        for (Pending p : pending) {
            AccessLogic.applyOps(d, p.ops());
        }
        overlaySessions(d);
        draft = d;
        List<List<AcOp>> ops = pending.stream().map(Pending::ops).toList();
        board = BoardLogic.buildBoard(draft, layout, filters, BoardLogic.marksFor(ops), expanded);
        problems = Problems.collect(draft, layout);
    }

    /** Live session IPs and concurrency badges, in memory only; not part of staged edits. */
    private void overlaySessions(AcModel d) {
        if (apiSessions.isEmpty()) {
            return;
        }
        List<Map<String, Object>> ids = new ArrayList<>();
        for (AcIdentity i : d.identities) {
            ids.add(Json.map("id", i.id, "name", i.name, "isAdmin", i.isAdmin, "roleAttributes", i.attrs));
        }
        SessionMonitor.Report r = SessionMonitor.evaluate(ids, apiSessions, List.of(), List.of(),
                ziti.getConcurrencyPolicy(), ziti.currentSessionToken(), System.currentTimeMillis());
        for (AcIdentity i : d.identities) {
            SessionMonitor.IdentitySummary s = r.byIdentity().get(i.id);
            if (s == null) {
                continue;
            }
            i.sessionIps = s.distinctLiveIps;
            i.liveSessionCount = s.liveSessionCount;
            i.concurrency = s.finding == null ? null
                    : new AcConcurrency(s.finding.severity(), s.finding.concurrentSessionCount(), s.finding.distinctIps(),
                            s.finding.summary());
        }
    }

    // ------------------------------------------------------------------ rendering

    void render() {
        derive();
        status.removeAll();
        boolean ok = committed != null;
        status.setVisible(!ok);
        body.setVisible(ok);
        setupButton.setVisible(ok);
        if (!ok) {
            status.setClassName("bp-callout" + (loadError != null ? " error" : ""));
            if (loadError != null) {
                status.add(new Span("Couldn't load the network: " + loadError + " "),
                        Ui.small("Try again", VaadinIcon.REFRESH, this::safeReload));
            } else {
                status.add(new Span("Loading identities, services, routers and policies…"));
            }
            return;
        }
        boardEl.setBoard(board);
        boardEl.setHasClip(clip != null);
        renderToolbarState();
        renderDock();
        renderDrawer();
        setupCard.removeAll();
        setupCard.setVisible(draft.services.isEmpty() && pending.isEmpty());
        if (setupCard.isVisible()) {
            Paragraph p = new Paragraph("Set up your first OpenZiti service: the service configs, the hosting identity, "
                    + "who may dial it, and the policies between them.");
            p.addClassName("bp-small");
            setupCard.add(p, Ui.primary("Set up a service", VaadinIcon.PLUS, this::openWizard));
        }
    }

    private boolean filtersActive() {
        BoardFilters f = filters;
        return !f.type(AcKind.IDENTITY) || !f.type(AcKind.SERVICE) || !f.type(AcKind.ROUTER) || !f.attrs.isEmpty()
                || !f.search.trim().isEmpty() || f.problemsOnly || !f.ipFilter.trim().isEmpty() || f.activeSessionsOnly
                || f.concurrentOnly;
    }

    private void renderToolbarState() {
        int hits = 0;
        for (BoardNode x : board.nodes()) {
            if (x.type.equals("group")) {
                long mh = x.members.stream().filter(mb -> mb.hit).count();
                hits += (int) mh + (x.hit && mh == 0 ? 1 : 0);
            } else if (x.hit) {
                hits++;
            }
        }
        matches.setVisible(!filters.search.trim().isEmpty());
        matches.setText(plural(hits, "match", "matches"));
        int narrow = (int) java.util.Arrays.stream(AcKind.values()).filter(k -> !filters.type(k)).count()
                + filters.attrs.size() + (filters.ipFilter.trim().isEmpty() ? 0 : 1) + (filters.concurrentOnly ? 1 : 0)
                + (filters.activeSessionsOnly ? 1 : 0);
        filtersButton.setText(narrow > 0 ? "Filters · " + narrow : "Filters");
        filtersButton.setClassName("ac-active", narrow > 0);
        problemsButton.setVisible(problems.total() > 0 || filters.problemsOnly);
        problemsButton.setText((problems.total() == 1 ? "1 item needs attention" : problems.total() + " items need attention")
                + (filters.problemsOnly ? " · showing only these" : ""));
        problemsButton.setClassName("on", filters.problemsOnly);
        clearFilters.setVisible(filtersActive());
        clipChip.removeAll();
        clipChip.setVisible(clip != null);
        if (clip != null) {
            Button x = Ui.iconButton(VaadinIcon.CLOSE_SMALL, "Clear clipboard", () -> {
                clip = null;
                render();
            });
            clipChip.add(new Span((clip.cut() ? "Cut: " : "Copied: ")
                    + (clip.items().size() == 1 ? clip.items().getFirst().name() : clip.items().size() + " items")), x);
        }
    }

    private void renderFilterPanel() {
        filterPanel.removeAll();
        filterPanel.add(Ui.strong("Show"));
        Div kinds = new Div();
        kinds.addClassName("ac-pills");
        for (AcKind k : AcKind.values()) {
            NativeButton b = new NativeButton(k.title().equals("Identity") ? "Identities"
                    : k.title().equals("Service") ? "Services" : "Routers", e -> {
                        filters.types.put(k, !filters.type(k));
                        render();
                        renderFilterPanel();
                    });
            b.getElement().setAttribute("aria-pressed", String.valueOf(filters.type(k)));
            kinds.add(b);
        }
        filterPanel.add(kinds);

        RouterLink sessions = new RouterLink("Sessions & policy →", SessionsView.class);
        sessions.addClassName("bp-xs");
        Div trafficHead = new Div(Ui.strong("Traffic & client IP"), sessions);
        trafficHead.addClassName("ac-row-between");
        TextField ip = new TextField();
        ip.setPlaceholder("Client IP or CIDR (e.g. 203.0.113.0/24, !10.0.0.0/8)");
        ip.setAriaLabel("Client IP or CIDR");
        ip.setValue(filters.ipFilter);
        ip.setWidthFull();
        ip.setValueChangeMode(ValueChangeMode.LAZY);
        ip.addValueChangeListener(e -> {
            filters.ipFilter = e.getValue();
            String err = e.getValue().isBlank() ? null : IpFilter.validate(e.getValue());
            ip.setInvalid(err != null);
            ip.setErrorMessage(err);
            render();
        });
        List<AcIdentity> nonAdmin = draft == null ? List.of() : draft.identities.stream().filter(i -> !i.isAdmin).toList();
        long active = nonAdmin.stream().filter(i -> i.liveSessionCount != null && i.liveSessionCount > 0).count();
        long concurrent = nonAdmin.stream().filter(i -> i.concurrency != null).count();
        Div traffic = new Div();
        traffic.addClassName("ac-pills");
        NativeButton act = new NativeButton("Active sessions (" + active + ")", e -> {
            filters.activeSessionsOnly = !filters.activeSessionsOnly;
            render();
            renderFilterPanel();
        });
        act.getElement().setAttribute("aria-pressed", String.valueOf(filters.activeSessionsOnly));
        NativeButton conc = new NativeButton("Concurrent / Multi-IP (" + concurrent + ")", e -> {
            filters.concurrentOnly = !filters.concurrentOnly;
            render();
            renderFilterPanel();
        });
        conc.getElement().setAttribute("aria-pressed", String.valueOf(filters.concurrentOnly));
        conc.addClassName("bad");
        traffic.add(act, conc);
        filterPanel.add(trafficHead, ip, traffic);

        filterPanel.add(Ui.strong("Role attributes"));
        TextField attrQ = new TextField();
        attrQ.setPlaceholder("Find an attribute…");
        attrQ.setAriaLabel("Find an attribute");
        attrQ.setWidthFull();
        attrQ.setClearButtonVisible(true);
        Div attrList = new Div();
        attrList.addClassName("ac-attr-list");
        Runnable fill = () -> {
            attrList.removeAll();
            for (Map.Entry<String, int[]> a : attributeIndex(attrQ.getValue()).entrySet()) {
                boolean on = filters.attrs.contains(a.getKey());
                NativeButton b = new NativeButton();
                Span box = new Span(on ? "✓" : "");
                box.addClassName("ac-check");
                Span label = new Span(new Span(box, new Span("#" + a.getKey())));
                Span meta = new Span(a.getValue()[0] + " · " + kindsLabel(a.getValue()[1]));
                meta.addClassNames("bp-xs", "bp-muted");
                b.add(label, meta);
                b.getElement().setAttribute("aria-pressed", String.valueOf(on));
                b.addClickListener(e -> {
                    if (on) {
                        filters.attrs.remove(a.getKey());
                    } else {
                        filters.attrs.add(a.getKey());
                    }
                    render();
                    renderFilterPanel();
                });
                attrList.add(b);
            }
        };
        attrQ.setValueChangeMode(ValueChangeMode.EAGER);
        attrQ.addValueChangeListener(e -> fill.run());
        fill.run();
        filterPanel.add(attrQ, attrList);
        if (filtersActive()) {
            Button clear = new Button("Clear all filters", e -> {
                filters = BoardFilters.showEverything();
                search.clear();
                render();
                renderFilterPanel();
            });
            clear.addThemeVariants(ButtonVariant.TERTIARY, ButtonVariant.SMALL);
            filterPanel.add(clear);
        }
    }

    /** attr → {count, bitmask of kinds}. */
    private Map<String, int[]> attributeIndex(String query) {
        Map<String, int[]> map = new TreeMap<>();
        if (draft == null) {
            return map;
        }
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT).replaceFirst("^#", "");
        for (AcKind k : AcKind.values()) {
            for (AcEntity e : draft.entitiesOf(k)) {
                for (String a : e.attrs) {
                    if (!q.isEmpty() && !a.toLowerCase(Locale.ROOT).contains(q)) {
                        continue;
                    }
                    int[] v = map.computeIfAbsent(a, x -> new int[2]);
                    v[0]++;
                    v[1] |= 1 << k.ordinal();
                }
            }
        }
        return map;
    }

    private static String kindsLabel(int mask) {
        List<String> out = new ArrayList<>();
        for (AcKind k : AcKind.values()) {
            if ((mask & (1 << k.ordinal())) != 0) {
                out.add(k.many);
            }
        }
        return String.join(", ", out);
    }

    private void renderDock() {
        dock.removeAll();
        Boolean advisorOk = advisorState().ok();
        Button check = new Button("Check access");
        if (advisorOk != null) {
            Span dot = new Span();
            dot.addClassNames("ac-dot", advisorOk ? "ok" : "bad");
            check.setPrefixComponent(dot);
        }
        check.setClassName("on", "advisor".equals(drawer));
        check.addClickListener(e -> toggleDrawer("advisor"));
        Button pend = new Button(pending.isEmpty() ? "No pending changes"
                : plural(pending.size(), "pending change", "pending changes") + " · Review");
        pend.setClassName("pending", !pending.isEmpty());
        pend.setClassName("on", "pending".equals(drawer));
        pend.addClickListener(e -> toggleDrawer("pending"));
        dock.add(check, pend);
        if (!pending.isEmpty()) {
            Button apply = Ui.primary(busy ? "Applying…" : "Apply", VaadinIcon.CHECK, this::applyAll);
            apply.setEnabled(!busy);
            dock.add(apply);
        }
    }

    private void toggleDrawer(String d) {
        drawer = d.equals(drawer) ? null : d;
        render();
    }

    private void renderDrawer() {
        drawerEl.removeAll();
        drawerEl.setVisible(drawer != null);
        if (drawer == null) {
            return;
        }
        H3 h = new H3(drawer.equals("pending") ? "Pending changes" : "Check access");
        h.getStyle().set("margin", "0").set("font-size", "var(--aura-font-size-m)");
        Button close = Ui.iconButton(VaadinIcon.CLOSE_SMALL, "Close", () -> {
            drawer = null;
            render();
        });
        Div head = new Div(h, Ui.spacer(), close);
        head.addClassName("ac-row-between");
        drawerEl.add(head);
        drawerEl.getElement().setAttribute("aria-label", h.getText());
        drawerEl.getElement().setAttribute("role", "complementary");
        if (drawer.equals("pending")) {
            pendingPanel();
        } else {
            advisorPanel();
        }
    }

    // ------------------------------------------------------------------ advisor

    private record AdvisorState(AcIdentity identity, AcService service, List<AcStep> steps) {
        AcStep failure() {
            return steps.stream().filter(s -> s.st().equals("bad")).findFirst().orElse(null);
        }

        Boolean ok() {
            return identity == null || service == null ? null : failure() == null;
        }
    }

    private AdvisorState advisorState() {
        if (draft == null) {
            return new AdvisorState(null, null, List.of());
        }
        List<AcIdentity> cl = AccessLogic.clients(draft);
        AcIdentity i = cl.stream().filter(x -> x.id.equals(advisorI)).findFirst().orElse(cl.isEmpty() ? null : cl.getFirst());
        AcService s = draft.services.stream().filter(x -> x.id.equals(advisorS)).findFirst()
                .orElse(draft.services.isEmpty() ? null : draft.services.getFirst());
        return new AdvisorState(i, s, i == null || s == null ? List.of() : AccessLogic.advise(draft, i, s));
    }

    private void advisorPanel() {
        Paragraph lead = new Paragraph("Checks every requirement OpenZiti needs for an identity to reach a service. "
                + "Double-click any card on the canvas to inspect it here.");
        lead.addClassNames("bp-xs", "bp-muted");
        lead.getStyle().set("margin", "0");
        drawerEl.add(lead);
        AdvisorState a = advisorState();
        if (a.identity() == null || a.service() == null) {
            drawerEl.add(Ui.callout(null, "Add at least one identity and one service to test the path between them."));
            return;
        }
        List<Map.Entry<String, List<AcIdentity>>> groups = AccessLogic.groups(AccessLogic.clients(draft));
        Map<String, String> groupOf = new HashMap<>();
        List<AcIdentity> ordered = new ArrayList<>();
        for (Map.Entry<String, List<AcIdentity>> g : groups) {
            for (AcIdentity i : g.getValue()) {
                if (!groupOf.containsKey(i.id)) {
                    groupOf.put(i.id, g.getKey());
                    ordered.add(i);
                }
            }
        }
        Select<AcIdentity> idSel = new Select<>();
        idSel.setLabel("Identity");
        idSel.setItems(ordered);
        idSel.setItemLabelGenerator(i -> i.name);
        idSel.setRenderer(new com.vaadin.flow.data.renderer.ComponentRenderer<>(i -> {
            String g = groupOf.get(i.id);
            Span m = new Span(g == null || g.isEmpty() ? "no attributes" : "#" + g);
            m.addClassNames("bp-xs", "bp-muted");
            Div d = new Div(new Span(i.name), m);
            d.getStyle().set("display", "flex").set("justify-content", "space-between").set("gap", "12px");
            return d;
        }));
        idSel.setValue(a.identity());
        idSel.setWidthFull();
        idSel.addValueChangeListener(e -> {
            if (e.isFromClient() && e.getValue() != null) {
                advisorI = e.getValue().id;
                render();
            }
        });
        Select<AcService> svcSel = new Select<>();
        svcSel.setLabel("Service");
        svcSel.setItems(draft.services);
        svcSel.setItemLabelGenerator(s -> s.name);
        svcSel.setValue(a.service());
        svcSel.setWidthFull();
        svcSel.addValueChangeListener(e -> {
            if (e.isFromClient() && e.getValue() != null) {
                advisorS = e.getValue().id;
                render();
            }
        });
        Div pick = new Div(idSel, svcSel);
        pick.addClassName("ac-advisor-pick");
        AcStep fail = a.failure();
        boolean posture = a.steps().stream().anyMatch(x -> x.st().equals("info"));
        Div verdict = Ui.callout(fail != null ? "error" : "ok", fail != null
                ? "✕ " + a.identity().name + " can't reach " + a.service().name + ": " + fail.t().toLowerCase(Locale.ROOT)
                : "✓ " + a.identity().name + " can reach " + a.service().name + (posture ? " (after posture check)" : ""));
        OrderedList steps = new OrderedList();
        steps.addClassName("bp-steps");
        for (AcStep x : a.steps()) {
            Span mark = new Span(x.st().equals("ok") ? "✓" : x.st().equals("bad") ? "✕" : "!");
            mark.addClassNames("bp-step-mark", x.st());
            Div text = new Div(Ui.strong(x.t()));
            if (x.d() != null && !x.d().isEmpty()) {
                Div d = new Div(x.d());
                d.addClassNames("bp-xs", "bp-muted");
                text.add(d);
            }
            if (x.fix() != null && !x.fix().isEmpty()) {
                Div f = new Div("Fix: " + x.fix());
                f.addClassNames("bp-xs", "fix");
                text.add(f);
            }
            ListItem li = new ListItem(mark, text);
            li.addClassNames("bp-step", x.st());
            steps.add(li);
        }
        drawerEl.add(pick, verdict, steps);
    }

    // ------------------------------------------------------------------ pending changes

    private void pendingPanel() {
        for (int idx = 0; idx < followUps.size(); idx++) {
            FollowUp f = followUps.get(idx);
            int i = idx;
            OrderedList ol = new OrderedList();
            f.steps().forEach(s -> ol.add(new ListItem(s)));
            Button done = Ui.small("Done", VaadinIcon.CHECK, () -> {
                followUps.remove(i);
                render();
            });
            Div head = new Div(Ui.strong("To finish: " + f.title()), Ui.spacer(), done);
            head.addClassName("ac-row-between");
            Div card = new Div(head, ol);
            card.addClassNames("bp-callout", "ok");
            drawerEl.add(card);
        }
        Paragraph lead = new Paragraph("Nothing is sent to the controller until you click Apply. Changes execute in order.");
        lead.addClassNames("bp-xs", "bp-muted");
        lead.getStyle().set("margin", "0");
        drawerEl.add(lead);
        if (pending.isEmpty()) {
            drawerEl.add(Ui.callout(null, "No pending changes. Drag an identity onto a service, move a card to another "
                    + "group, or run the Set up a service wizard."));
        }
        for (Pending c : pending) {
            Div text = new Div(Ui.strong(c.title()));
            Div sum = new Div(c.summary());
            sum.addClassNames("bp-xs", "bp-muted");
            text.add(sum);
            Button discard = Ui.small("Discard", null, () -> {
                pending.remove(c);
                render();
            });
            discard.setEnabled(!busy);
            Div head = new Div(text, discard);
            head.addClassName("ac-row-between");
            com.vaadin.flow.component.details.Details calls = new com.vaadin.flow.component.details.Details(
                    plural(c.calls().size(), "API call", "API calls"), new Pre(String.join("\n\n", c.calls())));
            calls.addClassName("bp-small");
            Div card = new Div(head, calls);
            card.addClassName("ac-pending-card");
            drawerEl.add(card);
        }
        Button apply = Ui.primary(busy ? "Working…" : pending.isEmpty() ? "Apply changes"
                : "Apply " + plural(pending.size(), "change", "changes"), VaadinIcon.CHECK, this::applyAll);
        apply.setEnabled(!pending.isEmpty() && !busy);
        Button discardAll = new Button("Discard all", e -> {
            pending.clear();
            render();
        });
        discardAll.setEnabled(!pending.isEmpty() && !busy);
        Button undo = new Button("Undo last apply", VaadinIcon.ROTATE_LEFT.create(), e -> undoLast());
        undo.setEnabled(!history.isEmpty() && !busy);
        Div actions = new Div(apply, discardAll, undo);
        actions.addClassName("ac-pills");
        drawerEl.add(actions);
    }

    String newId() {
        return "new-" + seq++;
    }

    void queueChange(String title, String summary, List<AcOp> ops, List<String> next) {
        if (draft == null) {
            return;
        }
        pending.add(new Pending("c" + seq++, title, summary, ops, AccessLogic.describeCalls(draft, ops),
                next == null ? List.of() : next));
        render();
        dock.addClassName("pulse");
        getElement().executeJs("setTimeout(() => $0.classList.remove('pulse'), 1500)", dock.getElement());
    }

    boolean queueIntent(Intent r) {
        if (!r.ok()) {
            Toast.warning("Not changed", r.error());
            return false;
        }
        queueChange(r.title(), r.summary(), r.ops(), null);
        return true;
    }

    /** Applies every pending change set in order; a failed set is rolled back and stops the run. */
    void applyAll() {
        if (draft == null || pending.isEmpty() || busy) {
            return;
        }
        busy = true;
        deferReload = true;
        Map<String, String> idMap = new HashMap<>();
        int done = 0;
        try {
            for (Pending c : new ArrayList<>(pending)) {
                try {
                    List<AcRevert> reverts = ziti.applyCanvasOps(c.ops(), idMap);
                    history.add(new Applied(c.title(), reverts));
                    if (!c.next().isEmpty()) {
                        followUps.add(new FollowUp(c.title(), c.next()));
                    }
                    pending.remove(c);
                    done++;
                } catch (RuntimeException err) {
                    List<AcRevert> reverts = err instanceof CanvasApplyError ce ? ce.reverts() : List.of();
                    List<RevertFailure> failures = ziti.revertCanvasOps(reverts);
                    if (!failures.isEmpty()) {
                        Toast.error("Change partly applied", c.title() + ": " + ZitiException.text(err)
                                + ". Rolling back also failed, so these steps remain on the controller: "
                                + ZitiService.describeRevertFailures(failures));
                    } else {
                        Toast.error("Change not applied",
                                c.title() + ": " + ZitiException.text(err) + ". Nothing from this change set was kept.");
                    }
                    break;
                }
            }
            if (!idMap.isEmpty()) {
                // New entities got server ids; move their saved card positions to the new ids.
                saveLayout(BoardLogic.remapLayout(layout, idMap));
            }
            if (done > 0) {
                Toast.success("Applied", plural(done, "change set", "change sets") + " sent to the controller.");
            }
            if (!followUps.isEmpty()) {
                drawer = "pending";
            }
        } finally {
            busy = false;
            deferReload = false;
            safeReload();
        }
    }

    void undoLast() {
        if (history.isEmpty() || busy) {
            return;
        }
        Applied last = history.getLast();
        busy = true;
        deferReload = true;
        try {
            List<RevertFailure> failures = ziti.revertCanvasOps(last.reverts());
            history.removeLast();
            if (!failures.isEmpty()) {
                // Keep only the steps that still need undoing, so Undo can be retried.
                history.add(new Applied(last.title(), failures.stream().map(RevertFailure::revert).toList()));
                Toast.error("Undo incomplete", ZitiService.describeRevertFailures(failures));
            } else {
                Toast.success("Undone", last.title());
            }
        } finally {
            busy = false;
            deferReload = false;
            safeReload();
        }
    }

    private void undoLastPending() {
        if (pending.isEmpty()) {
            return;
        }
        Pending last = pending.removeLast();
        Toast.info("Pending change removed", last.title());
        render();
    }

    // ------------------------------------------------------------------ layout

    private void saveLayout(AcLayout next) {
        layout = next;
        ziti.saveLayout(next);
    }

    /** The saved layout plus the auto-placed position of every node that has none yet. */
    private AcLayout positionsNow() {
        AcLayout out = layout.copy();
        if (draft == null) {
            return out;
        }
        Board all = BoardLogic.buildBoard(draft, layout, BoardFilters.showEverything(), BoardLogic.marksFor(List.of()),
                expanded);
        for (BoardNode n : all.nodes()) {
            out.nodes.putIfAbsent(n.key, new int[] { n.x, n.y });
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private void onMoved(Map<String, Object> payload) {
        if (committed == null) {
            return;
        }
        List<Object> moves = (List<Object>) payload.getOrDefault("moves", List.of());
        AcLayout next = layout.copy();
        boolean unknown = moves.stream().anyMatch(m -> !next.nodes.containsKey(Json.str(m, "key")));
        AcLayout base = next.nodes.isEmpty() || unknown ? positionsNow() : next;
        for (Object m : moves) {
            base.nodes.put(Json.str(m, "key"), new int[] { Json.num(m, "x").intValue(), Json.num(m, "y").intValue() });
        }
        saveLayout(base);
        render();
    }

    private void autoArrange() {
        AcLayout next = new AcLayout();
        next.groups = new ArrayList<>(layout.groups);
        saveLayout(next);
        render();
        boardEl.fit();
    }

    String exportLayout() {
        return LayoutFile.encode(positionsNow(), ziti.controllerUrl(), Instant.now());
    }

    void importLayout(String fileName, String text) {
        AcLayout parsed = LayoutFile.parse(text);
        if (parsed == null) {
            Toast.warning("Not imported", "That file isn't an Access Canvas layout. Use a file made with Export layout.");
            return;
        }
        Set<String> known = positionsNow().nodes.keySet();
        long matched = parsed.nodes.keySet().stream().filter(known::contains).count();
        saveLayout(parsed);
        render();
        boardEl.fit();
        Toast.success("Layout imported", plural((int) matched, "item", "items") + " placed from " + fileName + ".");
    }

    // ------------------------------------------------------------------ board gestures

    private record Sel(String type, String node, AcKind kind, String id, String name, String attr, String policy) {
        static Sel of(Object o) {
            String k = Json.str(o, "kind");
            return new Sel(Json.str(o, "type"), Json.str(o, "node"), k == null ? null : AcKind.of(k), Json.str(o, "id"),
                    Json.strOr(o, "name", ""), Json.str(o, "attr"), Json.str(o, "policy"));
        }
    }

    private record Target(String type, String node, AcKind kind, String id, String attr, double x, double y) {
        static Target of(Object o) {
            String k = Json.str(o, "kind");
            Number x = Json.num(o, "at.x");
            Number y = Json.num(o, "at.y");
            return new Target(Json.str(o, "type"), Json.str(o, "node"), k == null ? null : AcKind.of(k), Json.str(o, "id"),
                    Json.str(o, "attr"), x == null ? 0 : x.doubleValue(), y == null ? 0 : y.doubleValue());
        }
    }

    private static List<Sel> items(Map<String, Object> payload) {
        Object raw = payload.get("items");
        if (!(raw instanceof List<?> l)) {
            return List.of();
        }
        return l.stream().filter(x -> x != null).map(Sel::of).toList();
    }

    void onMemberDrop(Map<String, Object> payload) {
        if (draft == null) {
            return;
        }
        Sel it = Sel.of(payload.get("item"));
        Target t = Target.of(payload.get("target"));
        boolean copy = Boolean.TRUE.equals(payload.get("copy"));
        if (t.type().equals("empty")) {
            if (it.type().equals("member")) {
                queueIntent(BoardLogic.moveMember(draft, it.kind(), it.id(), it.name(), it.attr(), null, false));
            }
            return;
        }
        if (it.kind() == AcKind.IDENTITY && t.kind() == AcKind.SERVICE) {
            openGrant(AcEndpoint.identity(it.id()),
                    t.type().equals("group") ? AcEndpoint.group(t.attr()) : AcEndpoint.service(t.id()));
            return;
        }
        if (t.kind() != it.kind()) {
            Toast.warning("Can't drop there", "Drop " + it.kind().many + " into an " + it.kind().one + " group"
                    + (it.kind() == AcKind.IDENTITY ? ", or onto a service to give access" : "") + ".");
            return;
        }
        if (t.type().equals("group") || t.type().equals("member")) {
            queueIntent(BoardLogic.moveMember(draft, it.kind(), it.id(), it.name(),
                    it.type().equals("member") ? it.attr() : null, t.attr(), copy));
        } else {
            Toast.info("Drop into a group", "To give it the same access, copy it (⌘C), select the other card and paste (⌘V).");
        }
    }

    void onNodeDrop(Map<String, Object> payload) {
        Sel it = Sel.of(payload.get("item"));
        Target t = Target.of(payload.get("target"));
        if (t.type().equals("empty") || it.kind() != AcKind.IDENTITY || t.kind() != AcKind.SERVICE) {
            return;
        }
        AcEndpoint src = it.type().equals("group") ? AcEndpoint.group(it.attr()) : AcEndpoint.identity(it.id());
        AcEndpoint tgt = t.type().equals("group") ? AcEndpoint.group(t.attr()) : AcEndpoint.service(t.id());
        openGrant(src, tgt);
    }

    void onCommand(Map<String, Object> payload) {
        if (draft == null) {
            return;
        }
        String cmd = Json.strOr(payload, "cmd", "");
        List<Sel> items = items(payload);
        switch (cmd) {
            case "copy", "cut" -> {
                List<ClipItem> ci = clipItems(items);
                if (ci.isEmpty()) {
                    Toast.info("Nothing to " + cmd, "Select identities, services or routers (or a group) first.");
                    return;
                }
                clip = new Clip(cmd, ci);
                Toast.info((cmd.equals("cut") ? "Cut " : "Copied ") + (ci.size() == 1 ? ci.getFirst().name() : ci.size() + " items"),
                        "Paste into a group, onto another card (same access), or on empty canvas (a new copy).");
                render();
            }
            case "paste" -> {
                Number x = Json.num(payload, "at.x");
                Number y = Json.num(payload, "at.y");
                paste(items, x == null ? 200 : x.doubleValue(), y == null ? 200 : y.doubleValue());
            }
            case "delete" -> removeSelected(items);
            case "give" -> items.stream().filter(i -> i.kind() == AcKind.IDENTITY).findFirst()
                    .ifPresent(i -> openGrant(i.type().equals("group") ? AcEndpoint.group(i.attr()) : AcEndpoint.identity(i.id()),
                            null));
            case "advise" -> {
                Sel it = items.isEmpty() ? null : items.getFirst();
                if (it == null || it.id() == null) {
                    return;
                }
                if (it.kind() == AcKind.IDENTITY) {
                    advisorI = it.id();
                } else if (it.kind() == AcKind.SERVICE) {
                    advisorS = it.id();
                }
                drawer = "advisor";
                render();
            }
            case "open" -> {
                Sel it = items.isEmpty() ? null : items.getFirst();
                if (it == null) {
                    return;
                }
                if ((it.id() != null && it.id().startsWith("new-")) || (it.policy() != null && it.policy().startsWith("new-"))) {
                    Toast.info("Not created yet", "Apply pending changes first.");
                    return;
                }
                if (it.type().equals("hub")) {
                    String[] parts = it.node().split(":");
                    navigate(Problems.POLICY_ROUTE.getOrDefault(parts.length > 1 ? parts[1] : "", "service-policies"));
                } else if (it.kind() != null) {
                    navigate(Problems.ENTITY_ROUTE.get(it.kind()));
                }
            }
            case "undo" -> undoLastPending();
            case "arrange" -> autoArrange();
            case "newGroup" -> {
                Number x = Json.num(payload, "at.x");
                Number y = Json.num(payload, "at.y");
                openNewGroup(x == null ? 200 : x.doubleValue(), y == null ? 200 : y.doubleValue());
            }
            case "expand" -> {
                String node = Json.str(payload, "node");
                if (node != null && !expanded.remove(node)) {
                    expanded.add(node);
                }
                render();
            }
            default -> {
                // unknown command: ignore
            }
        }
    }

    private void navigate(String route) {
        UI.getCurrent().navigate(route);
    }

    private List<ClipItem> clipItems(List<Sel> items) {
        List<ClipItem> out = new ArrayList<>();
        java.util.function.BiConsumer<Sel, String[]> add = (s, idAttr) -> {
            AcEntity e = draft.entitiesOf(s.kind()).stream().filter(x -> x.id.equals(idAttr[0])).findFirst().orElse(null);
            if (e != null && out.stream().noneMatch(o -> o.kind() == s.kind() && o.id().equals(idAttr[0])
                    && java.util.Objects.equals(o.fromAttr(), idAttr[1]))) {
                out.add(new ClipItem(s.kind(), e.id, e.name, new ArrayList<>(e.attrs), idAttr[1]));
            }
        };
        for (Sel it : items) {
            switch (it.type()) {
                case "member" -> add.accept(it, new String[] { it.id(), it.attr() });
                case "free" -> add.accept(it, new String[] { it.id(), null });
                case "group" -> board.nodes().stream().filter(n -> n.key.equals(it.node())).findFirst()
                        .ifPresent(n -> n.members.forEach(m -> add.accept(it, new String[] { m.id, it.attr() })));
                default -> {
                }
            }
        }
        return out;
    }

    private void paste(List<Sel> items, double atX, double atY) {
        if (clip == null) {
            Toast.info("Clipboard is empty", "Copy (⌘C) or cut (⌘X) something first.");
            return;
        }
        List<Sel> groupsSel = items.stream().filter(t -> t.type().equals("group")).toList();
        List<Sel> entities = items.stream().filter(t -> t.type().equals("member") || t.type().equals("free")).toList();
        AcLayout nextLayout = layout.copy();
        Intent res;
        if (!groupsSel.isEmpty()) {
            List<AcOp> ops = new ArrayList<>();
            Intent first = null;
            for (Sel g : groupsSel) {
                Intent r = BoardLogic.pasteIntoGroup(draft, clip, g.kind(), g.attr());
                if (!r.ok()) {
                    first = first == null ? r : first;
                    continue;
                }
                first = first != null && first.ok() ? first : r;
                ops.addAll(r.ops());
            }
            res = !ops.isEmpty() && first != null && first.ok()
                    ? new Intent(first.title(), first.summary(), ops, null, first.created())
                    : first != null ? first : new Intent(null, null, List.of(), "Nothing to paste.", List.of());
        } else if (!entities.isEmpty()) {
            res = BoardLogic.pasteOntoEntities(draft, clip,
                    entities.stream().map(e -> (Map.Entry<AcKind, String>) new AbstractMap.SimpleEntry<>(e.kind(), e.id()))
                            .toList());
        } else {
            Intent r = BoardLogic.pasteAsNew(draft, clip, this::newId);
            if (r.ok()) {
                // New cards without attributes are free cards; stack them where the paste happened.
                int dy = 0;
                for (Map.Entry<AcKind, String> cr : r.created()) {
                    List<String> attrs = List.of();
                    for (AcOp op : r.ops()) {
                        if (op instanceof CreateIdentity ci && ci.identity().id().equals(cr.getValue())) {
                            attrs = ci.identity().attrs();
                        } else if (op instanceof CreateService cs && cs.service().id.equals(cr.getValue())) {
                            attrs = cs.service().attrs;
                        }
                    }
                    if (attrs == null || attrs.isEmpty()) {
                        nextLayout.nodes.put(BoardLogic.freeKey(cr.getKey(), cr.getValue()),
                                new int[] { (int) Math.round(atX), (int) Math.round(atY + dy) });
                        dy += 50;
                    }
                }
            }
            res = r;
        }
        saveLayout(nextLayout);
        if (queueIntent(res) && clip.cut()) {
            clip = null;
            render();
        }
    }

    private void removeSelected(List<Sel> items) {
        List<GroupedItem> members = items.stream().filter(i -> i.type().equals("member"))
                .map(i -> new GroupedItem(i.kind(), i.id(), i.name(), i.attr())).toList();
        if (!members.isEmpty()) {
            queueIntent(BoardLogic.removeFromGroups(draft, members));
            return;
        }
        // Empty groups that exist only in the canvas layout can simply be dropped.
        List<Sel> emptyNew = items.stream().filter(i -> i.type().equals("group")
                && layout.groups.contains(i.kind().one + ":" + i.attr())
                && board.nodes().stream().filter(n -> n.key.equals(i.node())).findFirst().map(n -> n.members.isEmpty())
                        .orElse(true))
                .toList();
        if (!emptyNew.isEmpty()) {
            AcLayout next = layout.copy();
            for (Sel i : emptyNew) {
                next.groups.remove(i.kind().one + ":" + i.attr());
                next.nodes.remove(i.node());
            }
            saveLayout(next);
            render();
            return;
        }
        Toast.info("Nothing removed",
                "Delete takes selected cards out of their group. Identities and services are never deleted here.");
    }

    // ------------------------------------------------------------------ dialogs

    void openGrant(AcEndpoint src, AcEndpoint tgt) {
        if (draft == null) {
            return;
        }
        new GrantAccessDialog(draft, src, tgt, this::newId, (title, summary, ops) -> queueChange(title, summary, ops, null))
                .open();
    }

    private void openNewGroup(double x, double y) {
        Dialog d = new Dialog();
        d.setHeaderTitle("New role attribute group");
        Paragraph p = new Paragraph("A group is a role attribute. It starts empty in the canvas layout until you drag "
                + "or paste cards into it.");
        p.addClassNames("bp-small", "bp-muted");
        Select<AcKind> kind = new Select<>();
        kind.setLabel("Holds");
        kind.setItems(AcKind.values());
        kind.setItemLabelGenerator(k -> Character.toUpperCase(k.many.charAt(0)) + k.many.substring(1));
        kind.setValue(AcKind.IDENTITY);
        TextField attr = new TextField("Attribute name");
        attr.setPlaceholder("e.g. sales or db-servers");
        attr.setWidthFull();
        attr.setAutofocus(true);
        Button add = Ui.primary("Add group", null, () -> {
            if (addGroup(kind.getValue(), attr.getValue(), x, y)) {
                d.close();
            }
        });
        add.setEnabled(false);
        attr.setValueChangeMode(ValueChangeMode.EAGER);
        attr.addValueChangeListener(e -> add.setEnabled(!e.getValue().isBlank()));
        attr.addKeyDownListener(Key.ENTER, e -> add.click());
        Div content = new Div(p, kind, attr);
        content.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "8px").set("width", "min(26rem, 80vw)");
        d.add(content);
        d.getFooter().add(new Button("Cancel", e -> d.close()), add);
        d.open();
    }

    boolean addGroup(AcKind kind, String raw, double x, double y) {
        String attr = raw.trim().replaceFirst("^#", "");
        if (attr.isEmpty() || attr.matches(".*\\s.*")) {
            Toast.warning("Invalid name", "Use a single word without spaces, such as sales or web-servers.");
            return false;
        }
        String id = kind.one + ":" + attr;
        String key = BoardLogic.groupKey(kind, attr);
        if (board.nodes().stream().anyMatch(n -> n.key.equals(key)) || layout.groups.contains(id)) {
            Toast.info("Already exists", "#" + attr + " is already on the canvas.");
        } else {
            AcLayout next = layout.copy();
            next.groups.add(id);
            next.nodes.put(key, new int[] { (int) Math.round(x), (int) Math.round(y) });
            saveLayout(next);
            render();
        }
        return true;
    }

    private void openProblems() {
        new ProblemsDialog(problems.rows(), problems.total(), filters.problemsOnly, r -> {
            String nodeKey = r.node().startsWith("m|") ? r.node().split("\\|")[1] : r.node();
            if (board.nodes().stream().noneMatch(n -> n.key.equals(nodeKey))) {
                filters = BoardFilters.showEverything();
                search.clear();
                render();
            }
            boardEl.reveal(nodeKey, r.node().startsWith("m|") ? r.node() : null);
        }, r -> navigate(r.route()), () -> {
            filters.problemsOnly = !filters.problemsOnly;
            render();
            boardEl.fit();
        }).open();
    }

    private void openWizard() {
        if (draft == null) {
            return;
        }
        new AccessWizard(ziti, draft, (Plan p) -> {
            queueChange(p.title(), p.summary(), p.ops(), p.next());
            drawer = "pending";
            render();
        }).open();
    }

    private static String plural(int n, String one, String many) {
        return n + " " + (n == 1 ? one : many);
    }

    // ------------------------------------------------------------------ test hooks

    AcBoard board() {
        return boardEl;
    }

    List<Pending> pendingSets() {
        return pending;
    }

    AcModel draft() {
        return draft;
    }

    Board currentBoard() {
        return board;
    }

    Clip clip() {
        return clip;
    }

    Set<String> layoutKeys() {
        return new LinkedHashSet<>(layout.nodes.keySet());
    }
}
