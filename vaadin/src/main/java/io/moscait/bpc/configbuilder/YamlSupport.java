package io.moscait.bpc.configbuilder;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.AbstractConstruct;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.ScalarNode;
import org.yaml.snakeyaml.nodes.Tag;
import org.yaml.snakeyaml.representer.Representer;
import org.yaml.snakeyaml.resolver.Resolver;

/**
 * Parsed-YAML helpers and the emitter. Documents are {@code LinkedHashMap<String, Object>} /
 * {@code ArrayList<Object>} trees of String, Number, Boolean and null, read with the YAML 1.2
 * core schema (no timestamps, no merge keys, no yes/no booleans) so values match what the web
 * console's parser produces. A missing key plays the part of JavaScript's {@code undefined}.
 */
public final class YamlSupport {

    private YamlSupport() {
    }

    // ------------------------------------------------------------------ parsing

    /** Resolves plain scalars by the YAML 1.2 core schema. */
    private static final class CoreResolver extends Resolver {
        @Override
        protected void addImplicitResolvers() {
            addImplicitResolver(Tag.BOOL, Pattern.compile("^(?:true|True|TRUE|false|False|FALSE)$"), "tTfF");
            addImplicitResolver(Tag.INT, Pattern.compile("^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$"), "-+0123456789");
            addImplicitResolver(Tag.FLOAT, Pattern.compile(
                    "^(?:[-+]?(?:\\.[0-9]+|[0-9]+(?:\\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"),
                    "-+0123456789.");
            addImplicitResolver(Tag.NULL, Pattern.compile("^(?:~|null|Null|NULL)$"), "~nN");
            addImplicitResolver(Tag.NULL, Pattern.compile("^$"), null);
        }
    }

    private static final class CoreConstructor extends SafeConstructor {
        CoreConstructor(LoaderOptions o) {
            super(o);
            yamlConstructors.put(Tag.INT, new AbstractConstruct() {
                @Override
                public Object construct(Node node) {
                    String v = ((ScalarNode) node).getValue();
                    BigInteger b;
                    if (v.startsWith("0o")) {
                        b = new BigInteger(v.substring(2), 8);
                    } else if (v.startsWith("0x")) {
                        b = new BigInteger(v.substring(2), 16);
                    } else {
                        b = new BigInteger(v.startsWith("+") ? v.substring(1) : v);
                    }
                    if (b.bitLength() < 32) {
                        return b.intValue();
                    }
                    return b.bitLength() < 64 ? (Object) b.longValue() : b;
                }
            });
            yamlConstructors.put(Tag.FLOAT, new AbstractConstruct() {
                @Override
                public Object construct(Node node) {
                    String v = ((ScalarNode) node).getValue();
                    String l = v.toLowerCase();
                    if (l.endsWith(".inf")) {
                        return l.startsWith("-") ? Double.NEGATIVE_INFINITY : Double.POSITIVE_INFINITY;
                    }
                    if (l.equals(".nan")) {
                        return Double.NaN;
                    }
                    return Double.valueOf(v);
                }
            });
        }
    }

    /** Parses YAML text (JSON is YAML too); throws IllegalArgumentException on a syntax error. */
    public static Object parse(String text) {
        LoaderOptions lo = new LoaderOptions();
        lo.setAllowDuplicateKeys(false);
        lo.setMaxAliasesForCollections(100);
        DumperOptions dumper = new DumperOptions();
        Yaml yaml = new Yaml(new CoreConstructor(lo), new Representer(dumper), dumper, lo, new CoreResolver());
        try {
            return normalize(yaml.load(text));
        } catch (RuntimeException e) {
            String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            throw new IllegalArgumentException(m.lines().findFirst().orElse(m), e);
        }
    }

    /** Parses a document that must be a mapping. */
    public static Map<String, Object> parseMap(String text) {
        Object doc = parse(text);
        if (!isObj(doc)) {
            throw new IllegalArgumentException("The file is not a YAML mapping");
        }
        return asMap(doc);
    }

    /** String keys, mutable containers. */
    private static Object normalize(Object v) {
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, x) -> out.put(jsString(k), normalize(x)));
            return out;
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            l.forEach(x -> out.add(normalize(x)));
            return out;
        }
        return v;
    }

    // ------------------------------------------------------------------ narrowing helpers

    public static boolean isObj(Object v) {
        return v instanceof Map;
    }

    /** The value when it is a mapping (the same instance), otherwise a new empty one. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> asMap(Object v) {
        return v instanceof Map ? (Map<String, Object>) v : new LinkedHashMap<>();
    }

    /** The value when it is a list (the same instance), otherwise a new empty one. */
    @SuppressWarnings("unchecked")
    public static List<Object> asList(Object v) {
        return v instanceof List ? (List<Object>) v : new ArrayList<>();
    }

    /** Follows {@code path} through nested mappings; null as soon as a step is not a mapping. */
    public static Object get(Object v, String... path) {
        Object cur = v;
        for (String k : path) {
            if (!(cur instanceof Map<?, ?> m)) {
                return null;
            }
            cur = m.get(k);
        }
        return cur;
    }

    public static String str(Object v, String def) {
        return v == null ? def : jsString(v);
    }

    public static String str(Object v) {
        return str(v, "");
    }

    /** JavaScript {@code String(v)} for parsed values. */
    public static String jsString(Object v) {
        if (v == null) {
            return "null";
        }
        if (v instanceof Number n) {
            return number(n);
        }
        if (v instanceof List<?> l) {
            return String.join(",", l.stream().map(x -> x == null ? "" : jsString(x)).toList());
        }
        if (v instanceof Map) {
            return "[object Object]";
        }
        return String.valueOf(v);
    }

    /** JavaScript truthiness. */
    public static boolean truthy(Object v) {
        if (v == null || Boolean.FALSE.equals(v)) {
            return false;
        }
        if (v instanceof Number n) {
            double d = n.doubleValue();
            return d != 0 && !Double.isNaN(d);
        }
        return !(v instanceof String s) || !s.isEmpty();
    }

    /** Numbers as JavaScript prints them: whole values without a fraction. */
    public static String number(Number n) {
        if (n instanceof Double || n instanceof Float) {
            double d = n.doubleValue();
            if (Double.isNaN(d)) {
                return "NaN";
            }
            if (Double.isInfinite(d)) {
                return d > 0 ? "Infinity" : "-Infinity";
            }
            if (d == Math.rint(d) && Math.abs(d) < 1e21) {
                return new BigDecimal(d).toBigInteger().toString();
            }
            return new BigDecimal(Double.toString(d)).stripTrailingZeros().toPlainString();
        }
        return n.toString();
    }

    @SuppressWarnings("unchecked")
    public static <T> T deepCopy(T v) {
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, x) -> out.put((String) k, deepCopy(x)));
            return (T) out;
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            l.forEach(x -> out.add(deepCopy(x)));
            return (T) out;
        }
        return v;
    }

    /** Ordered map literal. */
    public static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    // ------------------------------------------------------------------ emitter

    /**
     * JavaScript's {@code undefined} as a map value: the key exists but the emitter writes nothing
     * for it. Only {@link #dumpDocument} sees it, where it still costs a blank separator line, as
     * in the web console.
     */
    public static final Object UNDEFINED = new Object() {
        @Override
        public String toString() {
            return "undefined";
        }
    };

    // Includes the Unicode line breaks (NEL, LS, PS) and the BOM, which YAML treats specially.
    private static final Pattern PLAIN_UNSAFE = Pattern.compile(
            "^[\\s\\-?:,\\[\\]{}#&*!|>'\"%@`]|:\\s|\\s#|:\\z|\\s\\z|^\\z|[\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029\\ufeff]",
            Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern RESERVED = Pattern.compile("(true|false|null|yes|no|on|off|y|n|~|=|<<"
            + "|[-+]?\\.(inf|nan)"
            + "|[-+]?(\\d[\\d_]*)(\\.\\d*)?([eE][-+]?\\d+)?"
            + "|0x[0-9a-f_]+|0o[0-7_]+|0b[01_]+"
            + "|[-+]?\\d[\\d_]*(:[0-5]?\\d)+(\\.\\d*)?"
            + "|\\d{4}-\\d\\d?-\\d\\d?.*)", Pattern.CASE_INSENSITIVE);

    /** Quote a string when a YAML parser could read it as anything other than the same plain string. */
    static String text(String s) {
        if (PLAIN_UNSAFE.matcher(s).find() || RESERVED.matcher(s).matches()) {
            return jsonString(s);
        }
        return s;
    }

    /** JSON.stringify for a string, plus \\u escapes for C1 controls, LS, PS and BOM. */
    static String jsonString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\b' -> b.append("\\b");
                case '\f' -> b.append("\\f");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c == ' ' || c == ' ' || c == '﻿'
                            || Character.isSurrogate(c) && !validSurrogate(s, i)) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
                }
            }
        }
        return b.append('"').toString();
    }

    private static boolean validSurrogate(String s, int i) {
        char c = s.charAt(i);
        if (Character.isHighSurrogate(c)) {
            return i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1));
        }
        return i > 0 && Character.isHighSurrogate(s.charAt(i - 1));
    }

    static String scalar(Object v) {
        if (v == null) {
            return "null";
        }
        if (v instanceof Number n) {
            double d = n.doubleValue();
            if ((n instanceof Double || n instanceof Float) && !Double.isFinite(d)) {
                return jsonString(number(n));
            }
            return number(n);
        }
        if (v instanceof Boolean) {
            return v.toString();
        }
        return text(String.valueOf(v));
    }

    @SuppressWarnings("unchecked")
    static void dump(Object value, int indent, List<String> lines) {
        String pad = " ".repeat(indent);
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map) {
                    List<String> sub = new ArrayList<>();
                    dump(item, indent + 2, sub);
                    if (sub.isEmpty()) {
                        lines.add(pad + "- {}");
                        continue;
                    }
                    // fold the first key onto the dash line
                    sub.set(0, pad + "- " + sub.getFirst().stripLeading());
                    lines.addAll(sub);
                } else if (item instanceof List<?> inner) {
                    // nested lists are not produced by config files; emit inline for completeness
                    lines.add(pad + "- " + (inner.isEmpty() ? "[]" : "[" + String.join(", ",
                            inner.stream().map(YamlSupport::scalar).toList()) + "]"));
                } else {
                    lines.add(pad + "- " + scalar(item));
                }
            }
            return;
        }
        for (Map.Entry<String, Object> e : ((Map<String, Object>) value).entrySet()) {
            String key = text(e.getKey());
            Object v = e.getValue();
            if (v == UNDEFINED) {
                continue;
            }
            if (v instanceof List<?> l) {
                if (l.isEmpty()) {
                    lines.add(pad + key + ": []");
                } else {
                    lines.add(pad + key + ":");
                    dump(l, indent + 2, lines);
                }
            } else if (v instanceof Map<?, ?> m) {
                if (m.isEmpty()) {
                    lines.add(pad + key + ": {}");
                } else {
                    lines.add(pad + key + ":");
                    dump(m, indent + 2, lines);
                }
            } else {
                lines.add(pad + key + ": " + scalar(v));
            }
        }
    }

    /** Emit a document with a comment header and a blank line between top-level sections. */
    public static String dumpDocument(Map<String, Object> doc, List<String> header) {
        List<String> lines = new ArrayList<>(header);
        lines.add("");
        int i = 0;
        for (Map.Entry<String, Object> e : doc.entrySet()) {
            if (i++ > 0) {
                lines.add("");
            }
            dump(map(e.getKey(), e.getValue()), 0, lines);
        }
        return String.join("\n", lines) + "\n";
    }
}
