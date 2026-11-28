package io.moscait.bpc.sessions;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/**
 * Client-IP traffic filtering: exact IPs, anchored prefixes, IPv4/IPv6 CIDRs
 * ({@code 10.0.0.0/8}, {@code 2001:db8::/32}), comma/space lists, and {@code !} exclusions.
 */
public final class IpFilter {

    private static final Pattern OCTET = Pattern.compile("^\\d{1,3}$");
    private static final Pattern HEXTET = Pattern.compile("^[0-9a-f]{1,4}$");
    private static final Pattern PREFIX_CHARS = Pattern.compile("^[0-9a-fA-F:.]+$");
    private static final Pattern SPLIT = Pattern.compile("[,\\s]+");

    private IpFilter() {
    }

    /**
     * Strips port suffixes ({@code 1.2.3.4:54321}, {@code [2001:db8::1]:443}) and unwraps
     * IPv4-mapped IPv6 ({@code ::ffff:1.2.3.4}) so addresses compare consistently.
     */
    public static String normalizeIp(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.trim();
        if (s.isEmpty()) {
            return null;
        }
        if (s.startsWith("[")) {
            int close = s.indexOf(']');
            if (close > 1) {
                s = s.substring(1, close);
            }
        } else {
            int first = s.indexOf(':');
            int last = s.lastIndexOf(':');
            if (first > 0 && first == last) {
                String maybe = s.substring(0, first);
                if (parseIpv4(maybe) != null) {
                    s = maybe;
                }
            }
        }
        String mapped = "::ffff:";
        if (s.toLowerCase().startsWith(mapped)) {
            String tail = s.substring(mapped.length());
            if (parseIpv4(tail) != null) {
                return tail;
            }
        }
        return s;
    }

    public static Long parseIpv4(String ip) {
        String[] parts = ip.split("\\.", -1);
        if (parts.length != 4) {
            return null;
        }
        long out = 0;
        for (String part : parts) {
            if (!OCTET.matcher(part).matches() || (part.length() > 1 && part.startsWith("0"))) {
                return null;
            }
            int n = Integer.parseInt(part);
            if (n > 255) {
                return null;
            }
            out = (out << 8) | n;
        }
        return out;
    }

    public static BigInteger parseIpv6(String ip) {
        int zone = ip.indexOf('%');
        String clean = (zone >= 0 ? ip.substring(0, zone) : ip).trim().toLowerCase();
        if (clean.isEmpty() || !clean.contains(":")) {
            return null;
        }
        String working = clean;
        int lastColon = working.lastIndexOf(':');
        String tail = working.substring(lastColon + 1);
        if (tail.contains(".")) {
            Long v4 = parseIpv4(tail);
            if (v4 == null) {
                return null;
            }
            working = working.substring(0, lastColon + 1) + Long.toHexString((v4 >>> 16) & 0xffff) + ":"
                    + Long.toHexString(v4 & 0xffff);
        }
        String[] dbl = working.split("::", -1);
        if (dbl.length > 2) {
            return null;
        }
        List<Integer> hextets;
        if (dbl.length == 2) {
            List<Integer> left = parseSide(dbl[0]);
            List<Integer> right = parseSide(dbl[1]);
            if (left == null || right == null || left.size() + right.size() >= 8) {
                return null;
            }
            hextets = new ArrayList<>(left);
            for (int i = 0; i < 8 - left.size() - right.size(); i++) {
                hextets.add(0);
            }
            hextets.addAll(right);
        } else {
            hextets = parseSide(working);
            if (hextets == null || hextets.size() != 8) {
                return null;
            }
        }
        BigInteger out = BigInteger.ZERO;
        for (int h : hextets) {
            out = out.shiftLeft(16).or(BigInteger.valueOf(h));
        }
        return out;
    }

    private static List<Integer> parseSide(String side) {
        if (side.isEmpty()) {
            return new ArrayList<>();
        }
        List<Integer> nums = new ArrayList<>();
        for (String g : side.split(":", -1)) {
            if (!HEXTET.matcher(g).matches()) {
                return null;
            }
            nums.add(Integer.parseInt(g, 16));
        }
        return nums;
    }

    private record Rule(boolean negated, Predicate<String> match) {
    }

    /** A compiled token, or an error message. */
    private record Compiled(Rule rule, String error) {
    }

    private static Compiled compile(String rawToken) {
        boolean negated = rawToken.startsWith("!");
        String token = (negated ? rawToken.substring(1) : rawToken).trim();
        if (token.isEmpty()) {
            return new Compiled(null, "Incomplete IP filter token");
        }
        int slash = token.indexOf('/');
        if (slash >= 0) {
            String addr = token.substring(0, slash);
            String prefixStr = token.substring(slash + 1);
            if (!OCTET.matcher(prefixStr).matches()) {
                return new Compiled(null, "Invalid CIDR prefix in \"" + rawToken + "\"");
            }
            int prefix = Integer.parseInt(prefixStr);
            Long v4 = parseIpv4(addr);
            if (v4 != null) {
                if (prefix > 32) {
                    return new Compiled(null, "IPv4 CIDR prefix out of range (0-32) in \"" + rawToken + "\"");
                }
                long mask = prefix == 0 ? 0 : (0xffffffffL << (32 - prefix)) & 0xffffffffL;
                long net = v4 & mask;
                return new Compiled(new Rule(negated, ip -> {
                    Long cand = parseIpv4(ip);
                    return cand != null && (cand & mask) == net;
                }), null);
            }
            BigInteger v6 = parseIpv6(addr);
            if (v6 != null) {
                if (prefix > 128) {
                    return new Compiled(null, "IPv6 CIDR prefix out of range (0-128) in \"" + rawToken + "\"");
                }
                int shift = 128 - prefix;
                BigInteger net = shift == 128 ? BigInteger.ZERO : v6.shiftRight(shift).shiftLeft(shift);
                return new Compiled(new Rule(negated, ip -> {
                    BigInteger cand = parseIpv6(ip);
                    if (cand == null) {
                        return false;
                    }
                    BigInteger masked = shift == 128 ? BigInteger.ZERO : cand.shiftRight(shift).shiftLeft(shift);
                    return masked.equals(net);
                }), null);
            }
            return new Compiled(null, "Invalid IP address in CIDR \"" + rawToken + "\"");
        }
        Long exact4 = parseIpv4(token);
        if (exact4 != null) {
            return new Compiled(new Rule(negated, ip -> exact4.equals(parseIpv4(ip))), null);
        }
        BigInteger exact6 = parseIpv6(token);
        if (exact6 != null) {
            return new Compiled(new Rule(negated, ip -> exact6.equals(parseIpv6(ip))), null);
        }
        // Partial tokens match from the start of the address (so "!10." never excludes "110.x").
        if (!PREFIX_CHARS.matcher(token).matches()) {
            return new Compiled(null, "Invalid IP prefix \"" + rawToken + "\"");
        }
        String needle = token.toLowerCase();
        return new Compiled(new Rule(negated, ip -> ip.toLowerCase().startsWith(needle)), null);
    }

    private static List<String> tokens(String expr) {
        return Arrays.stream(SPLIT.split(expr.trim())).map(String::trim).filter(t -> !t.isEmpty()).toList();
    }

    /** Null when the expression is valid, otherwise the first error. */
    public static String validate(String expr) {
        if (expr == null) {
            return null;
        }
        for (String t : tokens(expr)) {
            Compiled c = compile(t);
            if (c.error != null) {
                return c.error;
            }
        }
        return null;
    }

    public static boolean isValid(String expr) {
        return validate(expr) == null;
    }

    /**
     * Whether {@code ipAddress} passes the filter. An empty or invalid expression (e.g.
     * {@code 10.0.0.0/} while typing) passes everything rather than blanking the UI.
     */
    public static boolean matches(String ipAddress, String expr) {
        if (expr == null || expr.trim().isEmpty()) {
            return true;
        }
        List<String> toks = tokens(expr);
        if (toks.isEmpty()) {
            return true;
        }
        List<Rule> positives = new ArrayList<>();
        List<Rule> negatives = new ArrayList<>();
        for (String t : toks) {
            Compiled c = compile(t);
            if (c.error != null) {
                return true;
            }
            (c.rule.negated ? negatives : positives).add(c.rule);
        }
        String ip = normalizeIp(ipAddress);
        if (ip == null) {
            return false;
        }
        if (negatives.stream().anyMatch(r -> r.match.test(ip))) {
            return false;
        }
        return positives.isEmpty() || positives.stream().anyMatch(r -> r.match.test(ip));
    }
}
