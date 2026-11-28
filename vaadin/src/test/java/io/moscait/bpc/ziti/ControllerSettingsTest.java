package io.moscait.bpc.ziti;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.Test;

/** The controller allowlist is required and strict: a bad value stops the application from starting. */
class ControllerSettingsTest {

    @Test
    void parsesCommaOrWhitespaceSeparatedUrls() {
        assertEquals(List.of("https://a.example:1280", "http://10.0.0.5:1280"),
                ControllerSettings.parse(" https://a.example:1280/ ,\n http://10.0.0.5:1280  https://A.example:1280"));
    }

    @Test
    void anEmptyListIsRefused() {
        for (String raw : new String[] { null, "", "  ", " , " }) {
            IllegalStateException e = assertThrows(IllegalStateException.class, () -> ControllerSettings.parse(raw));
            assertTrue(e.getMessage().contains("ZITI_CONTROLLERS"), e.getMessage());
        }
    }

    @Test
    void entriesMustBePlainHttpOrigins() {
        for (String bad : new String[] { "ctrl.example:1280", "ftp://ctrl.example", "https://", "https://u:p@ctrl.example",
                "https://ctrl.example:1280/edge", "https://ctrl.example?x=1", "https://ctrl.example#f" }) {
            assertThrows(IllegalStateException.class, () -> ControllerSettings.parse(bad), bad);
        }
    }

    @Test
    void theApplicationCannotBeConstructedWithoutControllers() {
        assertThrows(IllegalStateException.class, () -> new ControllerSettings("", false, ""));
    }

    @Test
    void matchesOnlyListedControllers() {
        var s = new ControllerSettings("https://a.example:1280,https://b.example:1280", false, "");
        assertEquals(Optional.of("https://b.example:1280"), s.match("HTTPS://B.example:1280/"));
        assertEquals(Optional.empty(), s.match("https://c.example:1280"));
        assertEquals(Optional.empty(), s.match("https://a.example:1281"));
        assertEquals(Optional.empty(), s.match(null));
        assertEquals("https://a.example:1280", s.defaultController());
    }
}
