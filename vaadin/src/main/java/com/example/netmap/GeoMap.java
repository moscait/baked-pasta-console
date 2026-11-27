package com.example.netmap;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.example.netmap.NetworkMapLogic.Point;
import com.example.ziti.Json;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.ComponentEvent;
import com.vaadin.flow.component.ComponentEventListener;
import com.vaadin.flow.component.DomEvent;
import com.vaadin.flow.component.EventData;
import com.vaadin.flow.component.HasSize;
import com.vaadin.flow.component.Tag;
import com.vaadin.flow.component.dependency.CssImport;
import com.vaadin.flow.component.dependency.JsModule;
import com.vaadin.flow.component.dependency.NpmPackage;
import com.vaadin.flow.shared.Registration;

/**
 * Server side of {@code <bp-geo-map>} (frontend/bp-geo-map.ts), a Leaflet map. Features are
 * plain records sent as JSON; clicks, marker drags and zoom changes come back as events.
 */
@Tag("bp-geo-map")
@NpmPackage(value = "leaflet", version = "1.9.4")
@NpmPackage(value = "@types/leaflet", version = "1.9.23")
@JsModule("./bp-geo-map.ts")
@CssImport("leaflet/dist/leaflet.css")
public class GeoMap extends Component implements HasSize {

    /**
     * A polyline; width in pixels, color any CSS color. dash is an SVG dash pattern ("4 6") or null
     * for solid; cssClass is added to the path (e.g. to animate it); tip is hover text, one entry
     * per line. A line that is not interactive ignores the pointer.
     */
    public record Line(String id, List<Point> points, String color, double width, String dash, String cssClass,
            boolean interactive, List<String> tip) {

        public Line(String id, List<Point> points, String color, double width) {
            this(id, points, color, width, null, null, true, List.of());
        }
    }

    /** An image marker; (anchorX, anchorY) is the pixel of the square icon that sits on the point. */
    public record Marker(String id, Point point, String iconUrl, int size, double anchorX, double anchorY,
            boolean draggable, List<String> tip) {
    }

    public abstract static class GeoEvent extends ComponentEvent<GeoMap> {
        private final Map<String, Object> payload;

        protected GeoEvent(GeoMap source, boolean fromClient, String json) {
            super(source, fromClient);
            this.payload = Json.parseObject(json == null || json.isEmpty() ? "{}" : json);
        }

        protected double num(String key) {
            return payload.get(key) instanceof Number n ? n.doubleValue() : 0;
        }

        protected String str(String key) {
            return payload.get(key) == null ? null : String.valueOf(payload.get(key));
        }
    }

    @DomEvent("bp-map-click")
    public static class MapClickEvent extends GeoEvent {
        public MapClickEvent(GeoMap source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }

        public Point point() {
            return new Point(num("lat"), num("lng"));
        }
    }

    @DomEvent("bp-feature-click")
    public static class FeatureClickEvent extends GeoEvent {
        public FeatureClickEvent(GeoMap source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }

        public String featureId() {
            return str("id");
        }
    }

    @DomEvent("bp-marker-drop")
    public static class MarkerDropEvent extends GeoEvent {
        public MarkerDropEvent(GeoMap source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }

        public String featureId() {
            return str("id");
        }

        public double deltaLat() {
            return num("dLat");
        }

        public double deltaLng() {
            return num("dLng");
        }
    }

    @DomEvent("bp-map-view")
    public static class ViewEvent extends GeoEvent {
        public ViewEvent(GeoMap source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }

        public double zoom() {
            return num("zoom");
        }
    }

    private List<Line> lines = List.of();
    private List<Marker> markers = List.of();
    private String lastJson = "";
    private double zoom = 2;

    public GeoMap() {
        addListener(ViewEvent.class, e -> zoom = e.zoom());
    }

    public void setTiles(String urlTemplate, String attributionHtml) {
        getElement().setProperty("attribution", attributionHtml);
        getElement().setProperty("tiles", urlTemplate);
    }

    /** Replaces every feature. Sends nothing when the set is unchanged. */
    public void setFeatures(List<Line> lines, List<Marker> markers) {
        this.lines = List.copyOf(lines);
        this.markers = List.copyOf(markers);
        List<Object> ls = new ArrayList<>();
        for (Line l : lines) {
            ls.add(Json.map("id", l.id(), "pts", l.points().stream().map(GeoMap::pair).toList(), "color", l.color(),
                    "width", l.width(), "dash", l.dash(), "cls", l.cssClass(), "interactive", l.interactive(), "tip",
                    l.tip()));
        }
        List<Object> ms = new ArrayList<>();
        for (Marker m : markers) {
            ms.add(Json.map("id", m.id(), "lat", m.point().lat(), "lng", m.point().lng(), "icon", m.iconUrl(), "size",
                    m.size(), "ax", m.anchorX(), "ay", m.anchorY(), "draggable", m.draggable(), "tip", m.tip()));
        }
        String json = Json.write(Json.map("lines", ls, "markers", ms));
        if (!json.equals(lastJson)) {
            lastJson = json;
            getElement().setProperty("data", json);
        }
    }

    public List<Line> lines() {
        return lines;
    }

    public List<Marker> markers() {
        return markers;
    }

    public double getZoom() {
        return zoom;
    }

    public void setView(Point center, double zoom) {
        this.zoom = zoom;
        getElement().callJsFunction("setView", center.lat(), center.lng(), zoom);
    }

    /** Fits the view to the points; duration in ms (0 jumps). */
    public void fitTo(List<Point> points, int padding, int durationMs) {
        if (!points.isEmpty()) {
            getElement().callJsFunction("fitTo", Json.write(points.stream().map(GeoMap::pair).toList()), padding,
                    durationMs);
        }
    }

    private static List<Double> pair(Point p) {
        return List.of(p.lat(), p.lng());
    }

    public Registration addMapClickListener(ComponentEventListener<MapClickEvent> l) {
        return addListener(MapClickEvent.class, l);
    }

    public Registration addFeatureClickListener(ComponentEventListener<FeatureClickEvent> l) {
        return addListener(FeatureClickEvent.class, l);
    }

    public Registration addMarkerDropListener(ComponentEventListener<MarkerDropEvent> l) {
        return addListener(MarkerDropEvent.class, l);
    }
}
