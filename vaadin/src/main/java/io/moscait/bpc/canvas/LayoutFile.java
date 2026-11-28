package io.moscait.bpc.canvas;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.canvas.AcModel.AcLayout;
import io.moscait.bpc.ziti.Json;

/** The Access Canvas layout export file: node positions and empty groups, as JSON. */
public final class LayoutFile {

    public static final String KIND = "ziti-access-canvas-layout";

    private LayoutFile() {
    }

    public static String encode(AcLayout l, String controllerUrl, Instant exportedAt) {
        Map<String, Object> nodes = new LinkedHashMap<>();
        l.nodes.forEach((k, v) -> nodes.put(k, Json.map("x", v[0], "y", v[1])));
        return Json.pretty(Json.map("kind", KIND, "v", 1, "controller", controllerUrl, "exportedAt",
                exportedAt.toString(), "nodes", nodes, "groups", l.groups));
    }

    /** {@code access-canvas-layout-<controller host>.json}, safe as a file name. */
    public static String fileName(String controllerUrl) {
        String c = controllerUrl == null ? "" : controllerUrl;
        String host = c.replaceFirst("^https?://", "").split("[/:]")[0];
        host = (host.isEmpty() ? "controller" : host).replaceAll("[^A-Za-z0-9.-]", "_");
        return "access-canvas-layout-" + host + ".json";
    }

    /** Parses an exported layout file; null when it is not one. Non-finite or non-numeric positions are dropped. */
    public static AcLayout parse(String text) {
        Object data;
        try {
            data = Json.parse(text);
        } catch (RuntimeException e) {
            return null;
        }
        if (!(data instanceof Map<?, ?> d)) {
            return null;
        }
        if (d.get("kind") != null && !KIND.equals(d.get("kind"))) {
            return null;
        }
        if (!(d.get("nodes") instanceof Map<?, ?> nodes)) {
            return null;
        }
        AcLayout out = new AcLayout();
        nodes.forEach((k, v) -> {
            if (v instanceof Map<?, ?> p && p.get("x") instanceof Number x && p.get("y") instanceof Number y
                    && Double.isFinite(x.doubleValue()) && Double.isFinite(y.doubleValue())) {
                out.nodes.put(String.valueOf(k),
                        new int[] { (int) Math.round(x.doubleValue()), (int) Math.round(y.doubleValue()) });
            }
        });
        if (d.get("groups") instanceof List<?> g) {
            g.stream().filter(x -> x instanceof String).forEach(x -> out.groups.add((String) x));
        }
        return out;
    }
}
