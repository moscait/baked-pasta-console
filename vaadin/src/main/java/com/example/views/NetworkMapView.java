package com.example.views;

import java.io.ByteArrayInputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import com.example.netmap.GeoLookup;
import com.example.netmap.GeoMap;
import com.example.netmap.GeoLookup.IpLookupException;
import com.example.netmap.GeoLookup.IpPlace;
import com.example.netmap.GeoLookup.Place;
import com.example.netmap.NetworkMapLogic;
import com.example.netmap.NetworkMapLogic.CircuitPath;
import com.example.netmap.NetworkMapLogic.MapCircuit;
import com.example.netmap.NetworkMapLogic.MapLink;
import com.example.netmap.NetworkMapLogic.MapNode;
import com.example.netmap.NetworkMapLogic.Point;
import com.example.netmap.NetworkMapLogic.SeenCircuit;
import com.example.netmap.NetworkMapLogic.SpreadItem;
import com.example.ui.MainLayout;
import com.example.ui.Toast;
import com.example.ui.Ui;
import com.example.ui.ZitiView;
import com.example.ziti.FormValues;
import com.example.ziti.Json;
import com.example.ziti.ZitiException;
import com.example.ziti.ZitiService;
import com.vaadin.flow.component.AttachEvent;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.DetachEvent;
import com.vaadin.flow.component.Key;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Emphasis;
import com.vaadin.flow.component.html.NativeButton;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.component.textfield.TextFieldVariant;
import com.vaadin.flow.data.value.ValueChangeMode;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;
import com.vaadin.flow.router.RouterLink;
import com.vaadin.flow.server.VaadinSession;
import com.vaadin.flow.server.streams.DownloadHandler;
import com.vaadin.flow.server.streams.DownloadResponse;
import com.vaadin.flow.shared.Registration;

/**
 * Network Map: routers and identities placed by their {@code geolocation} tag, fabric links
 * coloured by latency, and live and recent circuits drawn client → routers → host. Locations can
 * be placed (map click, place search, coordinates, or suggested from IP) or dragged, and saved
 * back to the controller as tags.
 */
@Route(value = "network-map", layout = MainLayout.class)
@RouteAlias(value = "geolocate", layout = MainLayout.class)
@PageTitle("Network Map")
public class NetworkMapView extends ZitiView {

    /** Circuits last as long as one connection, so poll often while the page is open. */
    static final int LIVE_REFRESH_MS = 5000;
    private static final int LOCATION_CAP = 300;
    private static final String TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";

    private static final Map<String, String> KIND_COLLECTION = Map.of("identity", "identities", "edge-router",
            "edge-routers", "transit-router", "transit-routers");
    private static final Map<String, String> KIND_LETTER = Map.of("identity", "I", "edge-router", "E",
            "transit-router", "T");
    // The map draws on a canvas, where CSS custom properties do not resolve: literal colours.
    private static final Map<String, String> LEVEL_COLOR = Map.of("good", "#16a34a", "warn", "#d97706", "bad",
            "#dc2626", "unknown", "#94a3b8");
    private static final Map<String, String> KIND_COLOR = Map.of("identity", "#2563eb", "edge-router", "#0f766e",
            "transit-router", "#7c3aed");
    private static final String CIRCUIT_COLOR = "#2563eb";

    /** Circuit history outlives the page but belongs to one controller session. */
    private record History(String key, Map<String, SeenCircuit> seen) {
    }

    // ------------------------------------------------------------------ data
    private List<Map<String, Object>> identities = List.of();
    private List<Map<String, Object>> edgeRouters = List.of();
    private List<Map<String, Object>> transitRouters = List.of();
    private List<Map<String, Object>> apiSessions = List.of();
    private List<Map<String, Object>> fabricRouters;
    private List<Map<String, Object>> fabricLinks;
    private List<Map<String, Object>> fabricCircuits;
    private String fabricError = "";
    private Map<String, SeenCircuit> history = new LinkedHashMap<>();
    private LocalTime loadedAt;

    // ------------------------------------------------------------------ view state
    private boolean live = true;
    private boolean showRecent = true;
    private boolean showLinks = true;
    private boolean showIdleIdentities = true;
    private boolean unplacedOnly;
    private boolean editMode;
    private String tab = "circuits";
    private String selectedCircuit;
    private String query = "";
    private List<MapNode> placing = new ArrayList<>();
    private final Set<String> checked = new LinkedHashSet<>();
    /** Unsaved edits: id → new point, or null to clear the location. */
    private final Map<String, Point> pending = new LinkedHashMap<>();
    private final Map<String, String[]> ipSuggested = new HashMap<>();
    private volatile boolean ipCancel;
    private String ipBusy;
    private boolean fitted;

    // ------------------------------------------------------------------ derived (rebuilt by derive())
    private List<MapCircuit> circuits = List.of();
    private Map<String, MapNode> nodes = new LinkedHashMap<>();
    private List<MapLink> links = List.of();
    private Map<String, Integer> load = Map.of();
    private List<SeenCircuit> recent = List.of();
    private Map<String, SeenCircuit> recentById = Map.of();
    private Map<String, String> ipOf = Map.of();

    // ------------------------------------------------------------------ components
    private final GeoMap map = new GeoMap();
    private final Div stats = new Div();
    private final Div fabricBanner = new Div();
    private final Div placingBanner = new Div();
    private final Div placeResults = new Div();
    private final Div info = new Div();
    private final Tabs tabs = new Tabs();
    private final Tab circuitsTab = new Tab("Circuits");
    private final Tab locationsTab = new Tab("Locations");
    private final TextField filter = new TextField();
    private final Div tabTools = new Div();
    private final Div pendingBar = new Div();
    private final Div list = new Div();
    private final Button liveButton = new Button();
    private final Button refresh = new Button("Refresh", VaadinIcon.REFRESH.create());
    private Registration poll;

    public NetworkMapView(ZitiService ziti) {
        super(ziti);
        addClassName("bp-page");

        map.setTiles(TILE_URL, "Tiles © <a href=\"https://www.esri.com/\">Esri</a>");
        map.addMapClickListener(e -> {
            if (!placing.isEmpty()) {
                placeAt(e.point());
            }
        });
        map.addFeatureClickListener(e -> onFeatureClick(e.featureId()));
        map.addMarkerDropListener(e -> {
            String fid = e.featureId();
            if (fid == null || !fid.startsWith("n:")) {
                return;
            }
            MapNode n = nodes.get(fid.substring(2));
            if (n == null || n.point() == null) {
                return;
            }
            // Apply the drag delta to the stored point: the marker may be drawn offset from it.
            pending.put(n.id(), new Point(Math.max(-90, Math.min(90, n.point().lat() + e.deltaLat())),
                    n.point().lng() + e.deltaLng()));
            render();
        });
        liveButton.addClickListener(e -> {
            live = !live;
            schedulePolling();
            renderHeader();
        });
        refresh.addClickListener(e -> {
            safeReload();
        });

        Div header = new Div(Ui.pageHeader("Network Map", null), Ui.spacer(), stats, liveButton, refresh);
        header.addClassName("bp-nm-head");
        Paragraph sub = new Paragraph();
        sub.add(new Span("Routers and identities placed by their "), new Code("geolocation"),
                new Span(" tag, fabric links by latency, and live and recent circuits from client to host."));
        sub.addClassNames("bp-muted", "bp-small");
        sub.getStyle().set("margin", "0");

        fabricBanner.setVisible(false);

        Div mapCard = new Div(mapToolbar(), placingBanner, mapWrap());
        mapCard.addClassNames("bp-card", "bp-nm-mapcard");

        tabs.add(circuitsTab, locationsTab);
        tabs.addSelectedChangeListener(e -> {
            tab = e.getSelectedTab() == locationsTab ? "locations" : "circuits";
            filter.setPlaceholder(tab.equals("circuits") ? "Filter by service, identity or router…"
                    : "Filter by name or #attribute…");
            renderSide();
        });
        filter.setPlaceholder("Filter by service, identity or router…");
        filter.setPrefixComponent(VaadinIcon.SEARCH.create());
        filter.setClearButtonVisible(true);
        filter.setValueChangeMode(ValueChangeMode.LAZY);
        filter.setWidthFull();
        filter.setAriaLabel("Filter");
        filter.addValueChangeListener(e -> {
            query = e.getValue();
            renderSide();
        });
        tabTools.addClassName("bp-nm-tools");
        pendingBar.addClassName("bp-nm-pending");
        list.addClassName("bp-nm-list");
        Div aside = new Div(tabs, filter, tabTools, pendingBar, list);
        aside.addClassNames("bp-card", "bp-nm-aside");
        aside.getElement().setAttribute("role", "complementary");

        Div body = new Div(mapCard, aside);
        body.addClassName("bp-nm");
        add(header, sub, fabricBanner, body);
    }

    // ------------------------------------------------------------------ layout pieces

    private Component mapToolbar() {
        Checkbox linksBox = new Checkbox("Links", showLinks);
        linksBox.addValueChangeListener(e -> {
            showLinks = e.getValue();
            drawMap();
        });
        Checkbox idleBox = new Checkbox("Idle identities", showIdleIdentities);
        idleBox.setTooltipText("Placed identities that are not in an active circuit");
        idleBox.addValueChangeListener(e -> {
            showIdleIdentities = e.getValue();
            drawMap();
        });
        Div legend = new Div();
        legend.addClassName("bp-nm-legend");
        for (String[] l : new String[][] { { "good", "< 50 ms" }, { "warn", "50–100 ms" }, { "bad", "> 100 ms / down" } }) {
            Span sw = new Span();
            sw.addClassName("bp-legend-line");
            sw.getStyle().set("background", LEVEL_COLOR.get(l[0]));
            legend.add(new Span(sw, new Span(l[1])));
        }
        Span circ = new Span();
        circ.addClassNames("bp-legend-line", "dashed");
        circ.getStyle().set("--bp-legend-color", CIRCUIT_COLOR);
        legend.add(new Span(circ, new Span("live circuit")));
        Span ended = new Span();
        ended.addClassNames("bp-legend-line", "dotted");
        ended.getStyle().set("--bp-legend-color", "#64748b");
        legend.add(new Span(ended, new Span("ended (recent)")));
        for (String k : List.of("edge-router", "transit-router", "identity")) {
            Span pin = new Span(KIND_LETTER.get(k));
            pin.addClassNames("bp-nm-pin", k);
            legend.add(new Span(pin, new Span(k.replace('-', ' '))));
        }

        TextField place = new TextField();
        place.setPlaceholder("Go to: city, address or lat,lng");
        place.setAriaLabel("Find a place or coordinates");
        place.setPrefixComponent(VaadinIcon.MAP_MARKER.create());
        place.setClearButtonVisible(true);
        place.addThemeVariants(TextFieldVariant.SMALL);
        place.setWidth("18rem");
        place.addKeyDownListener(Key.ENTER, e -> searchPlace(place.getValue()));
        place.addValueChangeListener(e -> {
            if (e.getValue().isEmpty()) {
                placeResults.removeAll();
                placeResults.setVisible(false);
            }
        });
        placeField = place;
        Button go = Ui.iconButton(VaadinIcon.SEARCH, "Search", () -> searchPlace(place.getValue()));
        Div search = new Div(place, go);
        search.addClassName("bp-nm-search");
        placeResults.addClassName("bp-nm-results");
        placeResults.setVisible(false);
        Div searchWrap = new Div(search, placeResults);
        searchWrap.getStyle().set("position", "relative");

        Div bar = new Div(linksBox, idleBox, legend, Ui.spacer(), searchWrap);
        bar.addClassName("bp-nm-mapbar");
        return bar;
    }

    private TextField placeField;

    private Component mapWrap() {
        map.setSizeFull();
        info.addClassName("bp-nm-info");
        info.setVisible(false);
        Div wrap = new Div(map, info);
        wrap.addClassName("bp-map-wrap");
        return wrap;
    }

    // ------------------------------------------------------------------ lifecycle & loading

    @Override
    protected void onAttach(AttachEvent attachEvent) {
        Object h = VaadinSession.getCurrent() == null ? null : VaadinSession.getCurrent().getAttribute(History.class);
        if (h instanceof History hist && hist.key().equals(historyKey())) {
            history = new LinkedHashMap<>(hist.seen());
        }
        super.onAttach(attachEvent);
        schedulePolling();
    }

    @Override
    protected void onDetach(DetachEvent detachEvent) {
        ipCancel = true;
        stopPolling(detachEvent.getUI());
        super.onDetach(detachEvent);
    }

    private void schedulePolling() {
        getUI().ifPresent(ui -> {
            stopPolling(ui);
            if (live) {
                ui.setPollInterval(LIVE_REFRESH_MS);
                poll = ui.addPollListener(e -> {
                    if (ipBusy == null) {
                        loadFabric();
                        render();
                    }
                });
            }
        });
    }

    private void stopPolling(UI ui) {
        if (poll != null) {
            poll.remove();
            poll = null;
            ui.setPollInterval(-1);
        }
    }

    private String historyKey() {
        return ziti.isAuthenticated() + "|" + ziti.isDemoMode() + "|" + ziti.controllerUrl();
    }

    @Override
    protected void reload() {
        identities = ziti.list("identities");
        edgeRouters = ziti.list("edge-routers");
        transitRouters = quiet(() -> ziti.list("transit-routers"));
        // Only for client IPs and IP-based suggestions; the map works without them.
        apiSessions = quiet(() -> ziti.list("api-sessions"));
        loadFabric();
        render();
    }

    private static List<Map<String, Object>> quiet(java.util.function.Supplier<List<Map<String, Object>>> s) {
        try {
            return s.get();
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    /** Fabric state (links, circuits) changes without service events: loaded on show and on the timer. */
    private void loadFabric() {
        try {
            fabricRouters = ziti.listFabric("routers");
            fabricLinks = ziti.listFabric("links");
            fabricCircuits = ziti.listFabric("circuits");
            history = NetworkMapLogic.mergeCircuitHistory(history,
                    fabricCircuits.stream().map(NetworkMapLogic::normalizeCircuit).toList(),
                    System.currentTimeMillis(), NetworkMapLogic.RECENT_CIRCUIT_MS);
            if (VaadinSession.getCurrent() != null) {
                VaadinSession.getCurrent().setAttribute(History.class, new History(historyKey(), history));
            }
            fabricError = "";
        } catch (RuntimeException e) {
            fabricRouters = null;
            fabricLinks = null;
            fabricCircuits = null;
            fabricError = ZitiException.text(e);
        }
        loadedAt = LocalTime.now();
    }

    // ------------------------------------------------------------------ derived model

    private void derive() {
        circuits = (fabricCircuits == null ? List.<Map<String, Object>>of() : fabricCircuits).stream()
                .map(NetworkMapLogic::normalizeCircuit)
                .sorted(Comparator.comparing((MapCircuit c) -> c.createdAt() == null ? "" : c.createdAt()).reversed())
                .toList();
        Map<String, String> via = NetworkMapLogic.circuitRouters(circuits);
        Map<String, Map<String, Object>> fabricRouter = new HashMap<>();
        if (fabricRouters != null) {
            fabricRouters.forEach(r -> fabricRouter.put(Json.str(r, "id"), r));
        }
        Map<String, MapNode> m = new LinkedHashMap<>();
        for (Map<String, Object> r : transitRouters) {
            m.put(Json.str(r, "id"), routerNode(r, "transit-router", fabricRouter, List.of()));
        }
        for (Map<String, Object> r : edgeRouters) {
            m.put(Json.str(r, "id"), routerNode(r, "edge-router", fabricRouter, strings(r)));
        }
        for (Map<String, Object> i : identities) {
            String id = Json.str(i, "id");
            if (m.containsKey(id)) {
                continue; // a router's own identity shares its id
            }
            Point own = pointOf(id, i);
            String viaId = own == null && !pending.containsKey(id) ? via.get(id) : null;
            Point viaPoint = viaId != null && m.get(viaId) != null ? m.get(viaId).point() : null;
            m.put(id, new MapNode(id, Json.strOr(i, "name", id), "identity", Json.boolOrNull(i, "hasEdgeRouterConnection"),
                    own != null ? own : viaPoint, viaPoint != null ? viaId : null, strings(i), tags(i)));
        }
        nodes = m;
        links = fabricLinks == null ? List.of()
                : fabricLinks.stream().map(NetworkMapLogic::normalizeLink).filter(l -> l != null).toList();
        load = NetworkMapLogic.circuitLoad(circuits);
        recent = history.values().stream().filter(h -> h.endedBy() != null)
                .sorted(Comparator.comparingLong(SeenCircuit::lastSeen).reversed()).toList();
        Map<String, SeenCircuit> rb = new HashMap<>();
        recent.forEach(h -> rb.put(h.circuit().id(), h));
        recentById = rb;

        Map<String, String[]> latest = new HashMap<>();
        for (Map<String, Object> s : apiSessions) {
            String id = Json.strOr(s, "identityId", Json.str(s, "identity.id"));
            String ip = Json.str(s, "ipAddress");
            if (id == null || ip == null || ip.isEmpty()) {
                continue;
            }
            String at = Json.strOr(s, "lastActivityAt", Json.strOr(s, "updatedAt", Json.strOr(s, "createdAt", "")));
            String[] prev = latest.get(id);
            if (prev == null || at.compareTo(prev[1]) > 0) {
                latest.put(id, new String[] { ip, at });
            }
        }
        Map<String, String> ips = new HashMap<>();
        latest.forEach((k, v) -> ips.put(k, v[0]));
        ipOf = ips;
    }

    private MapNode routerNode(Map<String, Object> r, String kind, Map<String, Map<String, Object>> fabricRouter,
            List<String> attrs) {
        String id = Json.str(r, "id");
        Map<String, Object> f = fabricRouter.get(id);
        Boolean online = f != null ? Boolean.valueOf(Json.bool(f, "connected")) : Json.boolOrNull(r, "isOnline");
        return new MapNode(id, Json.strOr(r, "name", id), kind, online, pointOf(id, r), null, attrs, tags(r));
    }

    private Point pointOf(String id, Map<String, Object> entity) {
        return pending.containsKey(id) ? pending.get(id) : NetworkMapLogic.parseGeolocation(Json.path(entity, "tags.geolocation"));
    }

    private static List<String> strings(Map<String, Object> e) {
        List<String> l = Json.strings(e, "roleAttributes");
        return l == null ? List.of() : l;
    }

    private static Map<String, Object> tags(Map<String, Object> e) {
        Map<String, Object> t = Json.obj(e, "tags");
        return t == null ? Map.of() : t;
    }

    private String nameOf(String id) {
        if (id == null) {
            return "—";
        }
        MapNode n = nodes.get(id);
        return n != null ? n.name() : id;
    }

    private MapCircuit selected() {
        if (selectedCircuit == null) {
            return null;
        }
        return circuits.stream().filter(c -> c.id().equals(selectedCircuit)).findFirst()
                .orElseGet(() -> recentById.containsKey(selectedCircuit) ? recentById.get(selectedCircuit).circuit() : null);
    }

    // ------------------------------------------------------------------ rendering

    void render() {
        derive();
        renderHeader();
        drawMap();
        renderSide();
    }

    private void renderHeader() {
        stats.removeAll();
        stats.addClassName("bp-nm-stats");
        List<MapNode> routers = nodes.values().stream().filter(n -> !n.kind().equals("identity")).toList();
        long online = routers.stream().filter(n -> Boolean.TRUE.equals(n.online())).count();
        stats.add(stat("Routers", online + "", "/" + routers.size() + " online"));
        if (fabricCircuits != null) {
            stats.add(stat("Links", links.stream().filter(MapLink::up).count() + "", "/" + links.size() + " up"));
            stats.add(stat("Circuits", circuits.size() + "", ""));
        }
        liveButton.setText(live ? "Live" : "Paused");
        liveButton.setIcon(live ? VaadinIcon.PAUSE.create() : VaadinIcon.PLAY.create());
        liveButton.setTooltipText(live ? "Refreshing circuits every " + (LIVE_REFRESH_MS / 1000) + "s" : "Live refresh paused");
        liveButton.getElement().setAttribute("aria-pressed", String.valueOf(live));
        liveButton.setClassName("bp-nm-live", live);
        if (loadedAt != null) {
            refresh.setTooltipText("Last loaded " + loadedAt.format(DateTimeFormatter.ofPattern("HH:mm:ss")));
        }

        fabricBanner.removeAll();
        fabricBanner.setVisible(!fabricError.isEmpty());
        if (!fabricError.isEmpty()) {
            fabricBanner.setClassName("bp-callout warn");
            fabricBanner.add(new Span("Live circuits and links are unavailable (the controller's "), new Code("/fabric/v1"),
                    new Span(" API did not answer: " + fabricError
                            + "). Router and identity locations can still be viewed and edited."));
        }

        placingBanner.removeAll();
        placingBanner.setVisible(!placing.isEmpty());
        map.setClassName("bp-map-placing", !placing.isEmpty());
        if (!placing.isEmpty()) {
            placingBanner.setClassName("bp-callout info bp-nm-placing");
            placingBanner.add(Ui.icon(VaadinIcon.CROSSHAIRS, null), new Span(" Click the map or search to place "),
                    Ui.strong(placing.size() == 1 ? placing.getFirst().name() : placing.size() + " selected"),
                    Ui.spacer(), Ui.small("Cancel", VaadinIcon.CLOSE_SMALL, () -> {
                        placing = new ArrayList<>();
                        render();
                    }));
            if (placeField != null) {
                placeField.setPlaceholder("Place at: city, address or lat,lng");
            }
        } else if (placeField != null) {
            placeField.setPlaceholder("Go to: city, address or lat,lng");
        }
    }

    private static Span stat(String label, String strong, String rest) {
        Span s = new Span(new Span(label + " "), Ui.strong(strong), new Span(rest));
        s.addClassName("bp-chip");
        return s;
    }

    private final List<GeoMap.Line> drawnLines = new ArrayList<>();
    private final List<GeoMap.Marker> drawnMarkers = new ArrayList<>();

    private void drawMap() {
        drawnLines.clear();
        drawnMarkers.clear();
        MapCircuit sel = selected();
        if (showLinks) {
            for (MapLink l : links) {
                MapNode a = nodes.get(l.a());
                MapNode b = nodes.get(l.b());
                if (a == null || b == null || a.point() == null || b.point() == null) {
                    continue;
                }
                String color = l.up() ? LEVEL_COLOR.get(l.level()) : "#dc2626";
                // A down link is dashed, as in the web console.
                add(new GeoMap.Line("l:" + l.id(), List.of(a.point(), b.point()),
                        alpha(color, sel != null ? 0.35 : l.up() ? 0.85 : 0.5), l.up() ? 3 : 2, l.up() ? null : "4 6",
                        null, true, List.of(a.name() + " ↔ " + b.name(), l.up()
                                ? (l.latencyMs() != null ? l.latencyMs() + " ms" : "latency not reported")
                                : "link down")));
            }
        }
        if (sel != null) {
            drawCircuit(sel, true);
        } else {
            if (showRecent) {
                recent.forEach(h -> drawCircuit(h.circuit(), false));
            }
            circuits.forEach(c -> drawCircuit(c, false));
        }
        Set<String> inSelected = NetworkMapLogic.idSet(sel);
        List<MapNode> visible = nodes.values().stream()
                .filter(n -> n.point() != null && (!n.kind().equals("identity") || showIdleIdentities
                        || load.containsKey(n.id()) || pending.containsKey(n.id())))
                .toList();
        Map<String, int[]> offsets = NetworkMapLogic.spreadOffsets(
                visible.stream().map(n -> new SpreadItem(n.id(), n.point(), !n.kind().equals("identity"))).toList());
        for (MapNode n : visible) {
            int[] off = offsets.getOrDefault(n.id(), new int[] { 0, 0 });
            int count = load.getOrDefault(n.id(), 0);
            // Anchor in pixels of the 34px icon; an offset fans out markers that share a point.
            drawnMarkers.add(new GeoMap.Marker("n:" + n.id(), n.point(),
                    pinIcon(n, count, inSelected.contains(n.id()), pending.containsKey(n.id())), 34, 15.0 - off[0],
                    19.0 - off[1], editMode, markerTip(n, count)));
        }
        map.setFeatures(drawnLines, drawnMarkers);
        if (!fitted) {
            List<Point> routerPins = drawnMarkers.stream()
                    .filter(m -> !"identity".equals(nodes.get(m.id().substring(2)).kind())).map(GeoMap.Marker::point)
                    .toList();
            if (routerPins.size() == 1) {
                map.setView(routerPins.getFirst(), 5);
                fitted = true;
            } else if (routerPins.size() > 1) {
                map.fitTo(routerPins, 40, 0);
                fitted = true;
            }
        }
    }

    private void add(GeoMap.Line l) {
        drawnLines.add(l);
    }

    private void drawCircuit(MapCircuit c, boolean emphasis) {
        CircuitPath p = NetworkMapLogic.circuitPath(c, nodes);
        if (p.points().size() < 2) {
            return;
        }
        String title = c.serviceName() + ": " + nameOf(c.clientId()) + " → " + nameOf(c.hostId());
        SeenCircuit ended = recentById.get(c.id());
        if (ended != null) {
            // Ended: a faint dotted line under the live ones.
            add(new GeoMap.Line("c:" + c.id(), p.points(), emphasis ? "rgba(100,116,139,0.9)" : "rgba(100,116,139,0.55)",
                    emphasis ? 4 : 2.5, "2 6", null, true, List.of(title,
                            "ended, last seen " + NetworkMapLogic.age(ended.lastSeen(), System.currentTimeMillis())
                                    + " ago")));
            return;
        }
        // A light casing under the line keeps circuits distinct from healthy (green) links.
        add(new GeoMap.Line("h:" + c.id(), p.points(), "rgba(255,255,255,0.9)", emphasis ? 10 : 6, null, null, false,
                List.of()));
        // Live: a dash that moves from client toward host, so the circuit's direction shows.
        add(new GeoMap.Line("c:" + c.id(), p.points(), alpha(CIRCUIT_COLOR, emphasis ? 1 : 0.8), emphasis ? 5 : 3,
                emphasis ? "10 6" : "6 8", "bp-circuit-flow", true, List.of(title)));
    }

    private List<String> markerTip(MapNode n, int count) {
        List<String> t = new ArrayList<>();
        t.add(n.name());
        t.add(n.kind().replace('-', ' ') + " · " + (Boolean.TRUE.equals(n.online()) ? "online"
                : Boolean.FALSE.equals(n.online()) ? "offline" : "status unknown"));
        if (ipOf.containsKey(n.id())) {
            t.add("IP " + ipOf.get(n.id()));
        }
        if (count > 0) {
            t.add(count + " circuit" + (count == 1 ? "" : "s"));
        }
        if (n.approxVia() != null) {
            t.add("Approximate: no location set, shown at " + nameOf(n.approxVia()));
        }
        return t;
    }

    private static String alpha(String hex, double a) {
        int r = Integer.parseInt(hex.substring(1, 3), 16);
        int g = Integer.parseInt(hex.substring(3, 5), 16);
        int b = Integer.parseInt(hex.substring(5, 7), 16);
        return String.format(Locale.ROOT, "rgba(%d,%d,%d,%.2f)", r, g, b, a);
    }

    /** A lettered pin (E/T/I) with an optional circuit-count badge, as an SVG data URI. */
    private static String pinIcon(MapNode n, int count, boolean highlighted, boolean edited) {
        String fill = Boolean.FALSE.equals(n.online()) ? "#94a3b8" : KIND_COLOR.get(n.kind());
        String ring = highlighted ? "#f59e0b" : edited ? "#ea580c" : "#ffffff";
        double opacity = n.approxVia() != null ? 0.65 : 1;
        StringBuilder svg = new StringBuilder("<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'>");
        svg.append(String.format(Locale.ROOT,
                "<circle cx='15' cy='19' r='10.5' fill='%s' fill-opacity='%.2f' stroke='%s' stroke-width='%s'%s/>", fill,
                opacity, ring, highlighted || edited ? "3" : "2",
                n.approxVia() != null ? " stroke-dasharray='3 2'" : ""));
        svg.append("<text x='15' y='23' text-anchor='middle' font-family='system-ui,sans-serif' font-size='11' "
                + "font-weight='700' fill='#ffffff'>").append(KIND_LETTER.get(n.kind())).append("</text>");
        if (count > 0) {
            String label = count > 99 ? "99+" : String.valueOf(count);
            svg.append("<circle cx='26' cy='8' r='7.5' fill='#1e293b' stroke='#ffffff' stroke-width='1.5'/>")
                    .append("<text x='26' y='11' text-anchor='middle' font-family='system-ui,sans-serif' font-size='")
                    .append(label.length() > 2 ? "6" : "8").append("' font-weight='700' fill='#ffffff'>").append(label)
                    .append("</text>");
        }
        svg.append("</svg>");
        return "data:image/svg+xml;charset=utf-8,"
                + URLEncoder.encode(svg.toString(), StandardCharsets.UTF_8).replace("+", "%20");
    }

    // ------------------------------------------------------------------ map interaction

    private void onFeatureClick(String id) {
        if (id == null) {
            return;
        }
        if (id.startsWith("c:")) {
            String cid = id.substring(2);
            selectCircuit(cid.equals(selectedCircuit) ? null : cid);
        } else if (id.startsWith("n:") && nodes.containsKey(id.substring(2))) {
            showNodeInfo(nodes.get(id.substring(2)));
        } else if (id.startsWith("l:")) {
            links.stream().filter(l -> l.id().equals(id.substring(2))).findFirst().ifPresent(this::showLinkInfo);
        }
    }

    private void showInfo(Component... content) {
        info.removeAll();
        Button close = Ui.iconButton(VaadinIcon.CLOSE_SMALL, "Close", () -> info.setVisible(false));
        close.addClassName("bp-nm-info-close");
        info.add(close);
        info.add(content);
        info.setVisible(true);
    }

    private void showNodeInfo(MapNode n) {
        int count = load.getOrDefault(n.id(), 0);
        List<Component> c = new ArrayList<>();
        c.add(Ui.strong(n.name()));
        c.add(Ui.muted(n.kind().replace('-', ' ') + " · " + (Boolean.TRUE.equals(n.online()) ? "online"
                : Boolean.FALSE.equals(n.online()) ? "offline" : "status unknown")));
        if (ipOf.containsKey(n.id())) {
            c.add(new Div(new Span("IP "), Ui.mono(ipOf.get(n.id()))));
        }
        if (count > 0) {
            c.add(new Div(count + " circuit" + (count == 1 ? "" : "s")));
        }
        if (n.approxVia() != null) {
            c.add(new Div(new Emphasis("Approximate: no location set, shown at " + nameOf(n.approxVia()))));
        } else if (n.point() != null) {
            c.add(Ui.mono(NetworkMapLogic.formatGeolocation(n.point())));
        }
        showInfo(c.toArray(Component[]::new));
    }

    private void showLinkInfo(MapLink l) {
        List<Component> c = new ArrayList<>();
        c.add(Ui.strong(nameOf(l.a()) + " ↔ " + nameOf(l.b())));
        c.add(new Div(l.up() ? (l.latencyMs() != null ? l.latencyMs() + " ms" : "latency not reported") : "link down"));
        if (l.cost() != null) {
            c.add(Ui.muted("cost " + Math.round(l.cost()) + (l.protocol() != null ? " · " + l.protocol() : "")));
        }
        showInfo(c.toArray(Component[]::new));
    }

    private void selectCircuit(String id) {
        selectedCircuit = id;
        render();
        MapCircuit sel = selected();
        if (sel != null) {
            drawnLines.stream().filter(l -> ("c:" + sel.id()).equals(l.id())).findFirst()
                    .ifPresent(l -> map.fitTo(l.points(), 60, 300));
        }
    }

    /** Gives every node waiting to be placed this location. False when nothing is being placed. */
    private boolean placeAt(Point p) {
        if (placing.isEmpty()) {
            return false;
        }
        for (MapNode t : placing) {
            pending.put(t.id(), p);
        }
        placing = new ArrayList<>();
        checked.clear();
        render();
        return true;
    }

    private void goTo(Point p) {
        placeAt(p);
        placeResults.removeAll();
        placeResults.setVisible(false);
        map.setView(p, Math.max(map.getZoom(), 9));
    }

    void searchPlace(String text) {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) {
            return;
        }
        placeResults.removeAll();
        Point coords = NetworkMapLogic.parseCoordinates(t);
        if (coords != null) {
            goTo(coords);
            return;
        }
        try {
            List<Place> found = GeoLookup.searchPlaces(t);
            for (Place r : found) {
                NativeButton b = new NativeButton(r.name(), e -> goTo(new Point(r.lat(), r.lng())));
                placeResults.add(b);
            }
            if (found.isEmpty()) {
                placeResults.add(Ui.muted("No places found for \"" + t + "\"."));
            } else {
                Span attr = new Span("Search © OpenStreetMap contributors");
                attr.addClassNames("bp-muted", "bp-xs");
                placeResults.add(attr);
            }
        } catch (RuntimeException e) {
            Span err = new Span(e.getMessage());
            err.getStyle().set("color", "var(--ac-bad)");
            placeResults.add(err);
        }
        placeResults.setVisible(true);
    }

    private void startPlacing(List<MapNode> targets) {
        placing = new ArrayList<>(targets);
        editMode = true;
        render();
    }

    // ------------------------------------------------------------------ side panel

    private boolean matchesCircuit(MapCircuit c, String q) {
        if (q.isEmpty()) {
            return true;
        }
        List<String> parts = new ArrayList<>(List.of(c.serviceName(), nameOf(c.clientId()), nameOf(c.hostId())));
        c.routerIds().forEach(r -> parts.add(nameOf(r)));
        return String.join(" ", parts).toLowerCase(Locale.ROOT).contains(q);
    }

    private void renderSide() {
        String q = query.trim().toLowerCase(Locale.ROOT);
        circuitsTab.setLabel("Circuits (" + circuits.size() + (recent.isEmpty() ? "" : " + " + recent.size() + " recent") + ")");
        locationsTab.setLabel("Locations" + (pending.isEmpty() ? "" : " · " + pending.size() + " unsaved"));
        tabTools.removeAll();
        list.removeAll();
        renderPendingBar();
        if (tab.equals("circuits")) {
            renderCircuitTools();
            List<MapCircuit> rows = circuits.stream().filter(c -> matchesCircuit(c, q)).toList();
            List<SeenCircuit> recentRows = showRecent ? recent.stream().filter(h -> matchesCircuit(h.circuit(), q)).toList()
                    : List.of();
            if (rows.isEmpty() && recentRows.isEmpty()) {
                Paragraph p = new Paragraph(fabricCircuits == null ? "Circuits need the fabric API."
                        : !q.isEmpty() ? "No circuits match."
                                : "No active circuits. A circuit exists only while a connection is open (one per "
                                        + "connection), so traffic shows up here as it happens and stays listed for "
                                        + NetworkMapLogic.RECENT_CIRCUIT_MS / 60000
                                        + " minutes after it ends, while this console is open.");
                p.addClassNames("bp-muted", "bp-small");
                list.add(p);
                return;
            }
            rows.forEach(c -> list.add(circuitRow(c, null)));
            if (!recentRows.isEmpty()) {
                Div h = new Div("Recent · ended in the last " + NetworkMapLogic.RECENT_CIRCUIT_MS / 60000 + " min");
                h.addClassName("bp-nm-sep");
                list.add(h);
                recentRows.forEach(s -> list.add(circuitRow(s.circuit(), s)));
            }
        } else {
            renderLocations(q);
        }
    }

    private void renderCircuitTools() {
        Checkbox rec = new Checkbox("Recent (" + NetworkMapLogic.RECENT_CIRCUIT_MS / 60000 + " min)", showRecent);
        rec.setTooltipText("Circuits that ended in the last " + NetworkMapLogic.RECENT_CIRCUIT_MS / 60000
                + " minutes while this console was open");
        rec.addValueChangeListener(e -> {
            showRecent = e.getValue();
            drawMap();
            renderSide();
        });
        Anchor export = new Anchor(DownloadHandler.fromInputStream(ev -> {
            byte[] b = circuitsCsv().getBytes(StandardCharsets.UTF_8);
            return new DownloadResponse(new ByteArrayInputStream(b), FormValues.csvFileName("circuits"), "text/csv", b.length);
        }), "");
        Button eb = Ui.small("Export CSV", VaadinIcon.DOWNLOAD_ALT, null);
        eb.setTooltipText("Active and recent circuits as CSV");
        eb.setEnabled(!circuits.isEmpty() || !recent.isEmpty());
        export.add(eb);
        export.setEnabled(eb.isEnabled());
        tabTools.add(rec, Ui.spacer(), export);
    }

    String circuitsCsv() {
        long now = System.currentTimeMillis();
        List<List<Object>> rows = new ArrayList<>();
        for (MapCircuit c : circuits) {
            SeenCircuit h = history.get(c.id());
            rows.add(csvRow(c, "active", h != null ? h.lastSeen() : now, null));
        }
        for (SeenCircuit h : recent) {
            rows.add(csvRow(h.circuit(), "ended", h.lastSeen(), h.endedBy()));
        }
        return FormValues.toCsv(List.of("Status", "Service", "Client", "Host", "Path", "Started", "Last seen", "Ended by",
                "Circuit ID"), rows);
    }

    private List<Object> csvRow(MapCircuit c, String status, Long lastSeen, Long endedBy) {
        return List.of(status, c.serviceName(), nameOf(c.clientId()), nameOf(c.hostId()),
                String.join(" > ", c.routerIds().stream().map(this::nameOf).toList()),
                c.createdAt() == null ? "" : c.createdAt(), iso(lastSeen), iso(endedBy), c.id());
    }

    private static String iso(Long ms) {
        return ms == null ? "" : Instant.ofEpochMilli(ms).toString();
    }

    private Component circuitRow(MapCircuit c, SeenCircuit ended) {
        boolean isSel = c.id().equals(selectedCircuit);
        long now = System.currentTimeMillis();
        String when;
        if (ended != null) {
            when = "ended · seen " + NetworkMapLogic.age(ended.lastSeen(), now) + " ago";
        } else {
            when = ageOf(c.createdAt(), now);
        }
        Span title = Ui.strong(c.serviceName());
        Span age = new Span(when);
        age.addClassNames("bp-muted", "bp-xs");
        Div top = new Div(title, age);
        top.addClassName("bp-nm-row-top");
        Div ends = new Div(new Span(nameOf(c.clientId())), arrow(), new Span(nameOf(c.hostId())));
        ends.addClassName("bp-small");
        Div via = new Div("via " + (c.routerIds().isEmpty() ? "unknown routers"
                : String.join(" › ", c.routerIds().stream().map(this::nameOf).toList())));
        via.addClassNames("bp-muted", "bp-xs");
        NativeButton b = new NativeButton();
        b.add(top, ends, via);
        if (isSel) {
            CircuitPath path = NetworkMapLogic.circuitPath(c, nodes);
            if (!path.missing().isEmpty()) {
                Div miss = new Div("Not on the map: " + String.join(", ", path.missing().stream().map(m -> m.name()).toList())
                        + ". Place them under Locations.");
                miss.addClassNames("bp-xs");
                miss.getStyle().set("color", "var(--ac-pending)");
                b.add(miss);
            }
        }
        b.addClassName("bp-nm-item");
        b.setClassName("ended", ended != null);
        b.getElement().setAttribute("aria-pressed", String.valueOf(isSel));
        b.addClickListener(e -> selectCircuit(isSel ? null : c.id()));
        return b;
    }

    private static Span arrow() {
        Span a = new Span(" → ");
        a.addClassName("bp-muted");
        return a;
    }

    private static String ageOf(String iso, long now) {
        if (iso == null) {
            return "";
        }
        try {
            return NetworkMapLogic.age(Instant.parse(iso).toEpochMilli(), now);
        } catch (RuntimeException e) {
            return "";
        }
    }

    private void renderPendingBar() {
        pendingBar.removeAll();
        pendingBar.setVisible(!pending.isEmpty());
        if (pending.isEmpty()) {
            return;
        }
        Button save = Ui.primary("Save " + pending.size() + " location" + (pending.size() == 1 ? "" : "s"),
                VaadinIcon.CHECK, this::saveLocations);
        save.addThemeVariants(ButtonVariant.SMALL);
        Button discard = Ui.small("Discard", VaadinIcon.ARROW_BACKWARD, () -> {
            pending.clear();
            ipSuggested.clear();
            render();
        });
        pendingBar.add(save, discard);
    }

    private void renderLocations(String q) {
        Checkbox unplaced = new Checkbox("Unplaced only", unplacedOnly);
        unplaced.addValueChangeListener(e -> {
            unplacedOnly = e.getValue();
            renderSide();
        });
        Checkbox drag = new Checkbox("Drag markers to move", editMode);
        drag.addValueChangeListener(e -> {
            editMode = e.getValue();
            if (!editMode) {
                placing = new ArrayList<>();
            }
            render();
        });
        Div row1 = new Div(unplaced, drag);
        row1.addClassName("bp-nm-tools-row");

        List<MapNode> rows = nodes.values().stream()
                .filter(n -> (!unplacedOnly || n.point() == null || n.approxVia() != null)
                        && NetworkMapLogic.matchesLocationQuery(n.name(), n.attributes(), q))
                .sorted(Comparator.comparing((MapNode n) -> n.kind().equals("identity") ? 1 : 0)
                        .thenComparing(MapNode::kind).thenComparing(MapNode::name, String.CASE_INSENSITIVE_ORDER))
                .toList();
        List<MapNode> shown = rows.subList(0, Math.min(rows.size(), LOCATION_CAP));
        boolean allChecked = !shown.isEmpty() && shown.stream().allMatch(n -> checked.contains(n.id()));
        Checkbox all = new Checkbox("Select all shown (" + shown.size() + ")", allChecked);
        all.setEnabled(!shown.isEmpty());
        all.addValueChangeListener(e -> {
            for (MapNode n : shown) {
                if (allChecked) {
                    checked.remove(n.id());
                } else {
                    checked.add(n.id());
                }
            }
            renderSide();
        });
        Div row2 = new Div(all);
        row2.addClassName("bp-nm-tools-row");
        if (!checked.isEmpty()) {
            row2.add(Ui.spacer(), Ui.small("Place " + checked.size() + " selected", VaadinIcon.MAP_MARKER,
                    () -> startPlacing(checked.stream().map(nodes::get).filter(n -> n != null).toList())),
                    Ui.small("Clear", null, () -> {
                        checked.clear();
                        renderSide();
                    }));
        }
        tabTools.add(row1, row2);
        Component ip = ipSuggestionBar();
        if (ip != null) {
            tabTools.add(ip);
        }

        for (MapNode n : shown) {
            list.add(locationRow(n));
        }
        if (rows.size() > LOCATION_CAP) {
            Div more = new Div("Showing " + LOCATION_CAP + " of " + rows.size() + ". Filter by name to find others.");
            more.addClassNames("bp-muted", "bp-xs");
            list.add(more);
        }
        if (rows.isEmpty()) {
            list.add(Ui.muted(q.isEmpty() ? "Nothing to place." : "No matches."));
        }
    }

    private Component locationRow(MapNode n) {
        Checkbox cb = new Checkbox(checked.contains(n.id()));
        cb.setAriaLabel("Select " + n.name());
        cb.addValueChangeListener(e -> {
            if (e.getValue()) {
                checked.add(n.id());
            } else {
                checked.remove(n.id());
            }
            renderSide();
        });
        Span pin = new Span(KIND_LETTER.get(n.kind()));
        pin.addClassNames("bp-nm-pin", n.kind());
        pin.setClassName("off", Boolean.FALSE.equals(n.online()));
        pin.setClassName("edited", pending.containsKey(n.id()));
        pin.setClassName("approx", n.approxVia() != null);
        Span name = Ui.strong(n.name());
        Div where = new Div();
        where.addClassNames("bp-xs", "bp-muted");
        if (n.approxVia() != null) {
            where.add(new Emphasis("≈ at " + nameOf(n.approxVia()) + " (not saved)"));
        } else if (n.point() != null) {
            where.add(Ui.mono(NetworkMapLogic.formatGeolocation(n.point())));
        } else {
            where.setText("Not placed");
        }
        Div text = new Div(new Div(pin, name), where);
        text.addClassName("bp-nm-loc-text");
        if (ipOf.containsKey(n.id())) {
            Div ipLine = new Div("IP " + ipOf.get(n.id()));
            ipLine.addClassNames("bp-xs", "bp-muted", "bp-mono");
            String[] sug = ipSuggested.get(n.id());
            if (sug != null) {
                ipLine.add(new Span(" · sent " + sug[0] + " → " + sug[1]));
            }
            text.add(ipLine);
        }
        boolean placed = n.point() != null && n.approxVia() == null;
        Button place = Ui.small(placed ? "Move" : "Place", VaadinIcon.CROSSHAIRS, () -> startPlacing(List.of(n)));
        place.setTooltipText("Click the map to set this location");
        Div actions = new Div(place);
        actions.addClassName("bp-nm-loc-actions");
        if (placed) {
            Button rm = Ui.iconButton(VaadinIcon.CLOSE_SMALL, "Remove location of " + n.name(), () -> {
                pending.put(n.id(), null);
                render();
            });
            actions.add(rm);
        }
        Div row = new Div(cb, text, actions);
        row.addClassName("bp-nm-loc");
        return row;
    }

    // ------------------------------------------------------------------ IP suggestions

    private record IpCandidate(MapNode node, String ip, String prefix) {
    }

    private List<IpCandidate> ipCandidates() {
        List<IpCandidate> out = new ArrayList<>();
        for (MapNode n : nodes.values()) {
            if (!n.kind().equals("identity") || (n.point() != null && n.approxVia() == null) || pending.containsKey(n.id())) {
                continue;
            }
            String ip = ipOf.get(n.id());
            if (ip == null) {
                continue;
            }
            out.add(new IpCandidate(n, ip, GeoLookup.truncateIp(ip, ziti.isDemoMode()).prefix()));
        }
        return out;
    }

    private Component ipSuggestionBar() {
        List<IpCandidate> cands = ipCandidates();
        if (cands.isEmpty()) {
            return null;
        }
        boolean demo = ziti.isDemoMode();
        String key = ziti.ipGeoKey();
        Div bar = new Div();
        bar.addClassNames("bp-nm-tools-row", "bp-nm-ip");
        if (key == null && !demo) {
            bar.add(new Span(cands.size() + " unplaced with an IP. Add an ipgeolocation.io key in "),
                    new RouterLink("Settings", SettingsView.class), new Span(" to suggest locations from IP."));
            bar.addClassNames("bp-xs", "bp-muted");
            return bar;
        }
        List<IpCandidate> lookupable = cands.stream().filter(c -> c.prefix() != null).toList();
        long prefixes = lookupable.stream().map(IpCandidate::prefix).distinct().count();
        Span label = new Span(ipBusy != null ? ipBusy
                : prefixes > 0 ? cands.size() + " unplaced with an IP · " + prefixes + " lookup" + (prefixes == 1 ? "" : "s")
                        + (demo ? " (simulated)" : "")
                        : cands.size() + " unplaced, private IP only (can't be looked up)");
        label.addClassNames("bp-xs", "bp-muted");
        bar.add(label, Ui.spacer());
        if (prefixes > 0) {
            if (ipBusy != null) {
                bar.add(Ui.small("Stop", VaadinIcon.STOP, () -> ipCancel = true));
            } else {
                Button b = Ui.small("Suggest from IP", VaadinIcon.LOCATION_ARROW, () -> suggestFromIp(cands, lookupable));
                b.setTooltipText("Sends only the first three octets (IPv4) or 48 bits (IPv6) of each address to ipgeolocation.io");
                bar.add(b);
            }
        }
        return bar;
    }

    /** One lookup per prefix, one at a time, off the UI thread; identities on one network share a result. */
    private void suggestFromIp(List<IpCandidate> cands, List<IpCandidate> lookupable) {
        UI ui = UI.getCurrent();
        boolean demo = ziti.isDemoMode();
        String key = ziti.ipGeoKey();
        List<String> prefixes = lookupable.stream().map(IpCandidate::prefix).distinct().toList();
        ipCancel = false;
        ipBusy = "Looking up 0/" + prefixes.size() + "…";
        renderSide();
        Consumer<Map<String, IpPlace>> finish = found -> {
            List<String> problems = foundProblems;
            ipBusy = null;
            List<IpCandidate> applied = lookupable.stream().filter(c -> found.containsKey(c.prefix())).toList();
            for (IpCandidate c : applied) {
                IpPlace p = found.get(c.prefix());
                pending.put(c.node().id(), new Point(p.lat(), p.lng()));
                ipSuggested.put(c.node().id(), new String[] { c.prefix(), p.label() });
            }
            int skipped = cands.size() - lookupable.size();
            List<String> detail = new ArrayList<>();
            if (!applied.isEmpty()) {
                detail.add(applied.size() + " unsaved location" + (applied.size() == 1 ? "" : "s") + " to review.");
            }
            if (skipped > 0) {
                detail.add(skipped + " skipped (private or non-public IP, never sent).");
            }
            if (!problems.isEmpty()) {
                detail.add("Not found: " + String.join("; ", problems));
            }
            String d = String.join(" ", detail);
            if (applied.isEmpty()) {
                Toast.error("No IP suggestions", d);
            } else if (problems.isEmpty()) {
                Toast.success("Suggested from IP", d);
            } else {
                Toast.warning("Suggested from IP", d);
            }
            render();
        };
        foundProblems = new ArrayList<>();
        if (demo) {
            // Simulated: no network call, so resolve inline.
            Map<String, IpPlace> found = new HashMap<>();
            for (String p : prefixes) {
                try {
                    found.put(p, GeoLookup.demoLookupPrefix(p));
                } catch (IpLookupException e) {
                    foundProblems.add(p + ": " + e.getMessage());
                }
            }
            finish.accept(found);
            return;
        }
        Thread.ofVirtual().start(() -> {
            Map<String, IpPlace> found = new HashMap<>();
            List<String> problems = new ArrayList<>();
            for (int i = 0; i < prefixes.size() && !ipCancel; i++) {
                String p = prefixes.get(i);
                try {
                    found.put(p, GeoLookup.lookupPrefix(p, key));
                } catch (IpLookupException e) {
                    problems.add(p + ": " + e.getMessage());
                    if (e.fatal()) {
                        break; // bad key or quota: stop spending requests
                    }
                }
                int done = i + 1;
                ui.access(() -> {
                    ipBusy = "Looking up " + done + "/" + prefixes.size() + "…";
                    renderSide();
                });
            }
            ui.access(() -> {
                foundProblems = problems;
                finish.accept(found);
            });
        });
    }

    private List<String> foundProblems = new ArrayList<>();

    // ------------------------------------------------------------------ saving

    void saveLocations() {
        List<String> failures = new ArrayList<>();
        Set<String> done = new LinkedHashSet<>();
        int total = pending.size();
        int i = 0;
        for (Map.Entry<String, Point> e : new ArrayList<>(pending.entrySet())) {
            i++;
            MapNode n = nodes.get(e.getKey());
            if (n == null) {
                done.add(e.getKey());
                continue;
            }
            Map<String, Object> entity = entityOf(n);
            try {
                ziti.saveGeolocation(KIND_COLLECTION.get(n.kind()), entity,
                        e.getValue() == null ? null : NetworkMapLogic.formatGeolocation(e.getValue()), i == total);
                done.add(e.getKey());
            } catch (RuntimeException ex) {
                failures.add(n.name() + ": " + ZitiException.text(ex));
            }
        }
        // Keep only the edits that failed, so they can be retried.
        done.forEach(id -> {
            pending.remove(id);
            ipSuggested.remove(id);
        });
        if (!failures.isEmpty()) {
            Toast.error("Saved " + done.size() + ", " + failures.size() + " failed", String.join("; ", failures));
        } else {
            Toast.success("Locations saved",
                    done.size() + " location" + (done.size() == 1 ? "" : "s") + " written to the controller as tags.");
        }
        safeReload();
    }

    private Map<String, Object> entityOf(MapNode n) {
        List<Map<String, Object>> src = switch (n.kind()) {
            case "edge-router" -> edgeRouters;
            case "transit-router" -> transitRouters;
            default -> identities;
        };
        return src.stream().filter(e -> n.id().equals(Json.str(e, "id"))).findFirst()
                .orElseGet(() -> Json.map("id", n.id(), "tags", n.tags()));
    }

    // ------------------------------------------------------------------ test hooks

    Map<String, MapNode> nodes() {
        return nodes;
    }

    List<MapCircuit> circuits() {
        return circuits;
    }

    Map<String, Point> pending() {
        return pending;
    }

    void placeNodes(List<String> ids, Point p) {
        startPlacing(ids.stream().map(nodes::get).toList());
        placeAt(p);
    }

    void suggestFromIpNow() {
        List<IpCandidate> c = ipCandidates();
        suggestFromIp(c, c.stream().filter(x -> x.prefix() != null).toList());
    }
}
