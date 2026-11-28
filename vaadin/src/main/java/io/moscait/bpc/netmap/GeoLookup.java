package io.moscait.bpc.netmap;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.Function;
import java.util.function.IntConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import io.moscait.bpc.ziti.Json;

/**
 * Outbound lookups for the Network Map, made from this server: place search via OpenStreetMap's
 * Nominatim (only on submit, per its usage policy) and opt-in IP geolocation via
 * ipgeolocation.io. Only a truncated address is ever sent (IPv4 /24, IPv6 /48); private,
 * loopback, link-local, CGNAT and documentation addresses never are.
 */
public final class GeoLookup {

    public static final String GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
    public static final String IPGEO_URL = "https://api.ipgeolocation.io/v3/ipgeo";
    private static final String USER_AGENT = "baked-pasta-console (OpenZiti admin console)";

    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL).build();

    private GeoLookup() {
    }

    public record Place(String name, double lat, double lng) {
    }

    /** A located prefix; label is "City, Country". */
    public record IpPlace(double lat, double lng, String label) {
    }

    /** {@code fatal}: the service refused the request (bad key, quota), so further lookups would too. */
    public static final class IpLookupException extends RuntimeException {
        private final boolean fatal;

        public IpLookupException(String message, boolean fatal) {
            super(message);
            this.fatal = fatal;
        }

        public boolean fatal() {
            return fatal;
        }
    }

    private static String get(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
                .header("Accept", "application/json").header("User-Agent", USER_AGENT).GET().build();
        HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) {
            throw new HttpStatus(res.statusCode(), res.body());
        }
        return res.body();
    }

    private static final class HttpStatus extends Exception {
        final int status;
        final String body;

        HttpStatus(int status, String body) {
            super("HTTP " + status);
            this.status = status;
            this.body = body;
        }
    }

    public static List<Place> searchPlaces(String query) {
        String url = GEOCODER_URL + "?format=jsonv2&limit=5&q=" + URLEncoder.encode(query.trim(), StandardCharsets.UTF_8);
        try {
            Object rows = Json.parse(get(url));
            List<Place> out = new ArrayList<>();
            if (rows instanceof List<?> l) {
                for (Object r : l) {
                    String name = Json.str(r, "display_name");
                    double lat = parseDouble(Json.str(r, "lat"));
                    double lng = parseDouble(Json.str(r, "lon"));
                    if (name != null && !name.isEmpty() && Double.isFinite(lat) && Double.isFinite(lng)) {
                        out.add(new Place(name, lat, lng));
                    }
                }
            }
            return out;
        } catch (HttpStatus e) {
            throw new IllegalStateException("Place search failed (HTTP " + e.status + ")");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Place search interrupted");
        } catch (Exception e) {
            throw new IllegalStateException("Place search failed: " + e.getMessage());
        }
    }

    private static double parseDouble(String s) {
        try {
            return s == null ? Double.NaN : Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return Double.NaN;
        }
    }

    // ------------------------------------------------------------------ IP truncation

    /** Either {@code prefix} is set, or {@code skip} is "non-public" / "invalid". */
    public record Truncated(String prefix, String skip) {
    }

    private static int[] v4(String ip) {
        String[] parts = ip.split("\\.", -1);
        if (parts.length != 4) {
            return null;
        }
        int[] n = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("\\d{1,3}")) {
                return null;
            }
            n[i] = Integer.parseInt(parts[i]);
            if (n[i] > 255) {
                return null;
            }
        }
        return n;
    }

    private static boolean nonPublicV4(int[] n) {
        int a = n[0], b = n[1], c = n[2];
        return a == 0 || a == 10 || a == 127 || a >= 224 || (a == 100 && b >= 64 && b <= 127)
                || (a == 169 && b == 254) || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168)
                || (a == 192 && b == 0 && c == 2) || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113) || (a == 198 && (b == 18 || b == 19));
    }

    private static int[] v6Groups(String ip) {
        if (!ip.matches("(?i)[0-9a-f:]+") || ip.split("::", -1).length > 2) {
            return null;
        }
        boolean dbl = ip.contains("::");
        String head = dbl ? ip.substring(0, ip.indexOf("::")) : ip;
        String tail = dbl ? ip.substring(ip.indexOf("::") + 2) : null;
        String[] h = head.isEmpty() ? new String[0] : head.split(":", -1);
        String[] t = tail == null || tail.isEmpty() ? new String[0] : tail.split(":", -1);
        int missing = 8 - h.length - t.length;
        if ((tail == null && missing != 0) || missing < 0) {
            return null;
        }
        List<String> groups = new ArrayList<>(List.of(h));
        for (int i = 0; i < (tail == null ? 0 : missing); i++) {
            groups.add("0");
        }
        groups.addAll(List.of(t));
        if (groups.size() != 8) {
            return null;
        }
        int[] out = new int[8];
        for (int i = 0; i < 8; i++) {
            if (!groups.get(i).matches("(?i)[0-9a-f]{1,4}")) {
                return null;
            }
            out[i] = Integer.parseInt(groups.get(i), 16);
        }
        return out;
    }

    private static final Pattern BRACKETED = Pattern.compile("^\\[([^\\]]+)\\](?::\\d+)?$");

    /**
     * Reduces a client address to the prefix sent for lookup: a.b.c.0 for IPv4, x:y:z:: for IPv6.
     * {@code allowDocumentation} lets the demo sandbox use documentation-range addresses.
     */
    public static Truncated truncateIp(String raw, boolean allowDocumentation) {
        String ip = raw.trim();
        Matcher br = BRACKETED.matcher(ip);
        if (br.matches()) {
            ip = br.group(1);
        } else if (ip.matches("[\\d.]+:\\d+")) {
            ip = ip.substring(0, ip.lastIndexOf(':'));
        }
        ip = ip.replaceFirst("(?i)^::ffff:(?=\\d+\\.\\d+\\.\\d+\\.\\d+$)", "");
        int[] four = v4(ip);
        if (four != null) {
            boolean doc = ip.matches("^(192\\.0\\.2|198\\.51\\.100|203\\.0\\.113)\\..*");
            if (nonPublicV4(four) && !(allowDocumentation && doc)) {
                return new Truncated(null, "non-public");
            }
            return new Truncated(four[0] + "." + four[1] + "." + four[2] + ".0", null);
        }
        int[] six = v6Groups(ip);
        if (six != null) {
            int first = six[0];
            boolean loop = true;
            for (int i = 0; i < 8; i++) {
                if (i < 7 ? six[i] != 0 : six[i] > 1) {
                    loop = false;
                }
            }
            boolean nonPublic = loop || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
                    || (first & 0xff00) == 0xff00 || (first == 0x2001 && six[1] == 0x0db8);
            if (nonPublic) {
                return new Truncated(null, "non-public");
            }
            return new Truncated(Integer.toHexString(six[0]) + ":" + Integer.toHexString(six[1]) + ":"
                    + Integer.toHexString(six[2]) + "::", null);
        }
        return new Truncated(null, "invalid");
    }

    // ------------------------------------------------------------------ IP lookup

    /** What a batch of prefix lookups found, plus "prefix: reason" for the ones that failed. */
    public record Batch(Map<String, IpPlace> found, List<String> problems) {
    }

    /** Looks up each prefix in turn via ipgeolocation.io; see {@link #lookupPrefixes(List, Function, BooleanSupplier, IntConsumer)}. */
    public static Batch lookupPrefixes(List<String> prefixes, String apiKey, BooleanSupplier cancelled,
            IntConsumer progress) {
        return lookupPrefixes(prefixes, p -> lookupPrefix(p, apiKey), cancelled, progress);
    }

    /**
     * One lookup per prefix, one at a time, so identities on one network share a single request. Stops early
     * when {@code cancelled} turns true or a lookup fails fatally (bad key, quota): further requests would
     * fail the same way. {@code progress} gets the number of prefixes done after each one.
     */
    static Batch lookupPrefixes(List<String> prefixes, Function<String, IpPlace> lookup, BooleanSupplier cancelled,
            IntConsumer progress) {
        Map<String, IpPlace> found = new HashMap<>();
        List<String> problems = new ArrayList<>();
        for (int i = 0; i < prefixes.size() && !cancelled.getAsBoolean(); i++) {
            String p = prefixes.get(i);
            try {
                found.put(p, lookup.apply(p));
            } catch (IpLookupException e) {
                problems.add(p + ": " + e.getMessage());
                if (e.fatal()) {
                    break;
                }
            }
            progress.accept(i + 1);
        }
        return new Batch(found, problems);
    }

    public static IpPlace lookupPrefix(String prefix, String apiKey) {
        String url = IPGEO_URL + "?apiKey=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8) + "&ip="
                + URLEncoder.encode(prefix, StandardCharsets.UTF_8) + "&fields=location";
        Map<String, Object> body;
        try {
            body = Json.parseObject(get(url));
        } catch (HttpStatus e) {
            String msg = null;
            try {
                msg = Json.str(Json.parseObject(e.body), "message");
            } catch (RuntimeException ignored) {
                // not JSON
            }
            throw new IpLookupException(msg != null ? msg : "IP lookup failed (HTTP " + e.status + ")", true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IpLookupException("IP lookup interrupted", true);
        } catch (Exception e) {
            throw new IpLookupException("IP lookup failed: " + e.getMessage(), true);
        }
        double lat = parseDouble(Json.str(body, "location.latitude"));
        double lng = parseDouble(Json.str(body, "location.longitude"));
        if (Json.obj(body, "location") == null || !Double.isFinite(lat) || !Double.isFinite(lng)
                || (lat == 0 && lng == 0)) {
            String msg = Json.str(body, "message");
            throw new IpLookupException(msg != null ? msg : "No location for " + prefix, false);
        }
        String city = Json.str(body, "location.city");
        String country = Json.str(body, "location.country_name");
        String label = String.join(", ", java.util.stream.Stream.of(city, country)
                .filter(s -> s != null && !s.isEmpty()).toList());
        return new IpPlace(lat, lng, label.isEmpty() ? prefix : label);
    }

    private static final Map<String, IpPlace> DEMO_PLACES = Map.of(
            "198.51.100.0", new IpPlace(40.6782, -73.9442, "Brooklyn, United States"),
            "203.0.113.0", new IpPlace(51.5072, -0.1276, "London, United Kingdom"),
            "192.0.2.0", new IpPlace(41.8781, -87.6298, "Chicago, United States"));

    /** Demo sandbox stand-in: documentation ranges resolve to fixed cities, with no network call. */
    public static IpPlace demoLookupPrefix(String prefix) {
        IpPlace p = DEMO_PLACES.get(prefix);
        if (p == null) {
            throw new IpLookupException("No location for " + prefix, false);
        }
        return p;
    }
}
