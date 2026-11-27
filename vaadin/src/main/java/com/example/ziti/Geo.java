package com.example.ziti;

import java.util.Locale;
import java.util.regex.Pattern;

/** Entity geolocation as the upstream console stores it: {@code tags.geolocation = "lat,lng"}. */
public final class Geo {

    private static final Pattern NUMBER = Pattern.compile("^-?\\d+(\\.\\d+)?$");

    private Geo() {
    }

    /** Parses a "lat,lng" tag into {lat, lng}; null for anything that is not a valid pair. */
    public static double[] parse(Object tag) {
        if (!(tag instanceof String s)) {
            return null;
        }
        String[] parts = s.split(",");
        if (parts.length != 2) {
            return null;
        }
        String lat = parts[0].trim();
        String lng = parts[1].trim();
        if (!NUMBER.matcher(lat).matches() || !NUMBER.matcher(lng).matches()) {
            return null;
        }
        double la = Double.parseDouble(lat);
        double ln = Double.parseDouble(lng);
        if (la < -90 || la > 90 || ln < -180 || ln > 180) {
            return null;
        }
        return new double[] { la, ln };
    }

    /** Formats a point the way the tag is stored (five decimals). */
    public static String format(double lat, double lng) {
        return String.format(Locale.ROOT, "%.5f,%.5f", lat, lng);
    }
}
