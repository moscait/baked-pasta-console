package com.example.ziti;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * JSON helpers over plain {@code Map<String, Object>} / {@code List<Object>} trees, which is how
 * management API entities are held (the same shape the browser console works with).
 */
public final class Json {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final JsonMapper PRETTY = JsonMapper.builder().enable(SerializationFeature.INDENT_OUTPUT).build();

    private Json() {
    }

    // ------------------------------------------------------------------ parse / write

    public static Object parse(String text) {
        return MAPPER.readValue(text, Object.class);
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String text) {
        Object o = parse(text);
        if (o instanceof Map<?, ?> m) {
            return (Map<String, Object>) m;
        }
        throw new IllegalArgumentException("Must be a JSON object, e.g. { \"key\": \"value\" }.");
    }

    public static String write(Object value) {
        return MAPPER.writeValueAsString(value);
    }

    /** Pretty-printed with two-space indentation, close to JSON.stringify(v, null, 2). */
    public static String pretty(Object value) {
        return PRETTY.writeValueAsString(value).replace("\" : ", "\": ");
    }

    // ------------------------------------------------------------------ copying

    @SuppressWarnings("unchecked")
    public static <T> T copy(T value) {
        if (value instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, v) -> out.put(String.valueOf(k), copy(v)));
            return (T) out;
        }
        if (value instanceof Collection<?> c) {
            List<Object> out = new ArrayList<>(c.size());
            for (Object v : c) {
                out.add(copy(v));
            }
            return (T) out;
        }
        return value;
    }

    // ------------------------------------------------------------------ path reads

    /** Reads a dotted path ("authenticators.cert.id"); null when any step is missing. */
    public static Object path(Object root, String dotted) {
        Object cur = root;
        for (String part : dotted.split("\\.")) {
            if (!(cur instanceof Map<?, ?> m)) {
                return null;
            }
            cur = m.get(part);
        }
        return cur;
    }

    public static String str(Object root, String path) {
        Object v = path(root, path);
        if (v == null) {
            return null;
        }
        return v instanceof String s ? s : (v instanceof Number || v instanceof Boolean ? String.valueOf(v) : null);
    }

    public static String strOr(Object root, String path, String fallback) {
        String s = str(root, path);
        return s == null || s.isEmpty() ? fallback : s;
    }

    public static boolean bool(Object root, String path) {
        return Boolean.TRUE.equals(path(root, path));
    }

    public static Boolean boolOrNull(Object root, String path) {
        return path(root, path) instanceof Boolean b ? b : null;
    }

    public static Number num(Object root, String path) {
        return path(root, path) instanceof Number n ? n : null;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> list(Object root, String path) {
        return path(root, path) instanceof List<?> l ? (List<Object>) l : List.of();
    }

    public static List<String> strings(Object root, String path) {
        List<String> out = new ArrayList<>();
        for (Object o : list(root, path)) {
            if (o != null) {
                out.add(String.valueOf(o));
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object root, String path) {
        return path(root, path) instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> objects(Object root, String path) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : list(root, path)) {
            if (o instanceof Map<?, ?> m) {
                out.add((Map<String, Object>) m);
            }
        }
        return out;
    }

    public static boolean isEmptyObj(Object o) {
        return o == null || (o instanceof Map<?, ?> m && m.isEmpty());
    }

    // ------------------------------------------------------------------ building

    /** An ordered map from alternating keys and values; null values are kept. */
    public static Map<String, Object> map(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            out.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return out;
    }

    /** A mutable list (List.of is immutable and would break in-place demo edits). */
    @SafeVarargs
    public static <T> List<T> arr(T... items) {
        return new ArrayList<>(List.of(items));
    }
}
