package io.moscait.bpc.netmap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;

import io.moscait.bpc.netmap.GeoLookup.IpLookupException;
import io.moscait.bpc.netmap.GeoLookup.IpPlace;

class GeoLookupBatchTest {

    private static final IpPlace HERE = new IpPlace(35.7, -82.0, "Marion, US");

    @Test
    void looksUpEachPrefixAndReportsProgress() {
        List<String> asked = new ArrayList<>();
        List<Integer> progress = new ArrayList<>();
        var r = GeoLookup.lookupPrefixes(List.of("203.0.113.0", "198.51.100.0"), p -> {
            asked.add(p);
            return HERE;
        }, () -> false, progress::add);
        assertEquals(List.of("203.0.113.0", "198.51.100.0"), asked);
        assertEquals(List.of(1, 2), progress);
        assertEquals(2, r.found().size());
        assertTrue(r.problems().isEmpty());
    }

    @Test
    void aFatalErrorStopsFurtherRequests() {
        List<String> asked = new ArrayList<>();
        var r = GeoLookup.lookupPrefixes(List.of("a", "b", "c"), p -> {
            asked.add(p);
            throw new IpLookupException("invalid API key", true);
        }, () -> false, n -> { });
        assertEquals(List.of("a"), asked);
        assertEquals(List.of("a: invalid API key"), r.problems());
    }

    @Test
    void aNonFatalErrorSkipsOnlyThatPrefix() {
        var r = GeoLookup.lookupPrefixes(List.of("a", "b"), p -> {
            if (p.equals("a")) {
                throw new IpLookupException("no location", false);
            }
            return HERE;
        }, () -> false, n -> { });
        assertEquals(List.of("b"), List.copyOf(r.found().keySet()));
        assertEquals(1, r.problems().size());
    }

    @Test
    void cancellingStopsBeforeTheNextRequest() {
        AtomicBoolean cancel = new AtomicBoolean();
        List<String> asked = new ArrayList<>();
        GeoLookup.lookupPrefixes(List.of("a", "b", "c"), p -> {
            asked.add(p);
            cancel.set(true);
            return HERE;
        }, cancel::get, n -> { });
        assertEquals(List.of("a"), asked);
    }
}
