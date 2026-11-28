package io.moscait.bpc.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.ziti.Json;

/**
 * Controllers remembered on the sign-in page. Kept in the browser's localStorage (per viewer,
 * never on this server), and never holding a password or token: only what to pre-fill.
 */
public final class SavedControllers {

    public static final String STORAGE_KEY = "bp.savedControllers";
    public static final int MAX = 12;

    /** method is "password", "cert" or "ext-jwt"; username only applies to "password". */
    public record Saved(String url, boolean trustAll, String method, String username, long lastUsed) {

        /** host:port for display. */
        public String host() {
            String s = url.replaceFirst("^[a-zA-Z]+://", "");
            int slash = s.indexOf('/');
            return slash < 0 ? s : s.substring(0, slash);
        }
    }

    private SavedControllers() {
    }

    /** Parses stored JSON, skipping anything malformed. Most recently used first. */
    public static List<Saved> parse(String json) {
        List<Saved> out = new ArrayList<>();
        if (json == null || json.isBlank()) {
            return out;
        }
        Object root;
        try {
            root = Json.parse(json);
        } catch (RuntimeException e) {
            return out;
        }
        if (!(root instanceof List<?> list)) {
            return out;
        }
        for (Object o : list) {
            if (!(o instanceof Map<?, ?>)) {
                continue;
            }
            String url = Json.str(o, "url");
            if (url == null || !url.matches("(?i)https?://\\S+")) {
                continue;
            }
            String method = Json.str(o, "method");
            if (!List.of("password", "cert", "ext-jwt").contains(method)) {
                method = "password";
            }
            Object trust = Json.path(o, "trustAll");
            Object used = Json.path(o, "lastUsed");
            String user = Json.str(o, "username");
            out.add(new Saved(normalize(url), Boolean.TRUE.equals(trust), method, user == null ? "" : user,
                    used instanceof Number n ? n.longValue() : 0));
        }
        out.sort((a, b) -> Long.compare(b.lastUsed(), a.lastUsed()));
        return dedupe(out);
    }

    public static String write(List<Saved> saved) {
        List<Object> list = new ArrayList<>();
        for (Saved s : saved) {
            list.add(Json.map("url", s.url(), "trustAll", s.trustAll(), "method", s.method(), "username",
                    "password".equals(s.method()) ? s.username() : "", "lastUsed", s.lastUsed()));
        }
        return Json.write(list);
    }

    /** Adds or refreshes an entry (matched by URL), moving it to the front; keeps at most {@link #MAX}. */
    public static List<Saved> remember(List<Saved> saved, Saved entry) {
        Saved e = new Saved(normalize(entry.url()), entry.trustAll(), entry.method(),
                "password".equals(entry.method()) ? entry.username() : "", entry.lastUsed());
        List<Saved> out = new ArrayList<>();
        out.add(e);
        saved.stream().filter(s -> !same(s.url(), e.url())).limit(MAX - 1).forEach(out::add);
        return out;
    }

    public static List<Saved> forget(List<Saved> saved, String url) {
        return saved.stream().filter(s -> !same(s.url(), url)).toList();
    }

    public static String normalize(String url) {
        String u = url.trim();
        while (u.endsWith("/")) {
            u = u.substring(0, u.length() - 1);
        }
        return u;
    }

    private static boolean same(String a, String b) {
        return normalize(a).equalsIgnoreCase(normalize(b));
    }

    private static List<Saved> dedupe(List<Saved> in) {
        List<Saved> out = new ArrayList<>();
        for (Saved s : in) {
            if (out.stream().noneMatch(o -> same(o.url(), s.url())) && out.size() < MAX) {
                out.add(s);
            }
        }
        return out;
    }
}
