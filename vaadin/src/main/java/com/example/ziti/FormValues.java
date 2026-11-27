package com.example.ziti;

import java.net.URI;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Parsing helpers shared by the entity forms, and CSV export for list tables. */
public final class FormValues {

    private static final Pattern PEM = Pattern.compile("-----BEGIN CERTIFICATE-----[\\s\\S]+?-----END CERTIFICATE-----");
    private static final Pattern WHOLE = Pattern.compile("^\\d+$");
    private static final Pattern FORMULA_START = Pattern.compile("^[=+\\-@\\t\\r]");

    private FormValues() {
    }

    /** Splits "a, #b  c" into [a, b, c]: commas or whitespace, leading # dropped, duplicates removed. */
    public static List<String> splitList(String text) {
        List<String> out = new ArrayList<>();
        if (text == null) {
            return out;
        }
        for (String raw : text.split("[,\\s]+")) {
            String item = raw.trim().replaceFirst("^#", "");
            if (!item.isEmpty() && !out.contains(item)) {
                out.add(item);
            }
        }
        return out;
    }

    /** Parses free-form JSON map text (appData, tags). Blank is an empty map. */
    public static Map<String, Object> parseJsonObject(String text) {
        if (text == null || text.isBlank()) {
            return new java.util.LinkedHashMap<>();
        }
        Object parsed;
        try {
            parsed = Json.parse(text);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Not valid JSON: " + ZitiException.text(e));
        }
        if (!(parsed instanceof Map<?, ?>)) {
            throw new IllegalArgumentException("Must be a JSON object, e.g. { \"key\": \"value\" }.");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) parsed;
        return m;
    }

    /** Pretty-prints a map for editing; an empty or missing map becomes blank text. */
    public static String formatJsonObject(Map<String, Object> value) {
        return value == null || value.isEmpty() ? "" : Json.pretty(value);
    }

    /** Parses a whole number in [min, max]; blank gives fallback (null fallback means required). */
    public static int parseWholeNumber(String text, String label, int min, int max, Integer fallback) {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty() && fallback != null) {
            return fallback;
        }
        if (!WHOLE.matcher(t).matches()) {
            throw new IllegalArgumentException(label + " must be a whole number.");
        }
        long n = Long.parseLong(t);
        if (n < min || n > max) {
            throw new IllegalArgumentException(label + " must be between " + min + " and " + max + ".");
        }
        return (int) n;
    }

    public static boolean looksLikePemCertificate(String text) {
        return text != null && PEM.matcher(text).find();
    }

    public static boolean isHttpUrl(String text) {
        try {
            URI u = new URI(text.trim());
            return ("https".equals(u.getScheme()) || "http".equals(u.getScheme())) && u.getHost() != null;
        } catch (Exception e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ CSV

    /**
     * One CSV cell (RFC 4180 quoting). Cells starting with a formula character get a leading
     * quote, so a crafted entity name such as {@code =HYPERLINK(...)} stays inert in a spreadsheet.
     */
    public static String csvCell(Object value) {
        String s;
        if (value == null) {
            s = "";
        } else if (value instanceof List<?> l) {
            List<String> parts = new ArrayList<>();
            for (Object v : l) {
                parts.add(v instanceof Map<?, ?> || v instanceof List<?> ? Json.write(v) : String.valueOf(v));
            }
            s = String.join("; ", parts);
        } else if (value instanceof Map<?, ?>) {
            s = Json.write(value);
        } else {
            s = String.valueOf(value);
        }
        if (FORMULA_START.matcher(s).find()) {
            s = "'" + s;
        }
        return s.matches("(?s).*[\",\\r\\n].*") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }

    public static String toCsv(List<String> headers, List<List<Object>> rows) {
        StringBuilder sb = new StringBuilder();
        sb.append(String.join(",", headers.stream().map(FormValues::csvCell).toList())).append("\r\n");
        for (List<Object> r : rows) {
            sb.append(String.join(",", r.stream().map(FormValues::csvCell).toList())).append("\r\n");
        }
        return sb.toString();
    }

    /** File name for an export: {@code <caption>-<yyyy-mm-dd>.csv}. */
    public static String csvFileName(String caption) {
        String slug = caption.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        return (slug.isEmpty() ? "export" : slug) + "-" + LocalDate.now() + ".csv";
    }
}
