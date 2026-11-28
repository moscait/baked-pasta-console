package io.moscait.bpc.netmap;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;

import io.moscait.bpc.netmap.NetworkMapLogic.MapNode;

/**
 * How map features look. The map draws on a canvas, where CSS custom properties do not resolve, so these
 * are literal colours.
 */
public final class MapIcons {

    public static final Map<String, String> KIND_LETTER = Map.of("identity", "I", "edge-router", "E",
            "transit-router", "T");
    static final Map<String, String> KIND_COLOR = Map.of("identity", "#2563eb", "edge-router", "#0f766e",
            "transit-router", "#7c3aed");
    public static final String CIRCUIT_COLOR = "#2563eb";

    private MapIcons() {
    }

    /** {@code #rrggbb} with an alpha, as {@code rgba(...)}. */
    public static String alpha(String hex, double a) {
        int r = Integer.parseInt(hex.substring(1, 3), 16);
        int g = Integer.parseInt(hex.substring(3, 5), 16);
        int b = Integer.parseInt(hex.substring(5, 7), 16);
        return String.format(Locale.ROOT, "rgba(%d,%d,%d,%.2f)", r, g, b, a);
    }

    /** A lettered pin (E/T/I) with an optional circuit-count badge, as an SVG data URI. */
    public static String pinIcon(MapNode n, int count, boolean highlighted, boolean edited) {
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
}
