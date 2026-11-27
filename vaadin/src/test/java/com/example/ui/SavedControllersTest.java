package com.example.ui;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.example.ui.SavedControllers.Saved;

class SavedControllersTest {

    @Test
    void roundTripsMostRecentFirstWithoutDuplicates() {
        List<Saved> list = List.of();
        list = SavedControllers.remember(list, new Saved("https://a.ziti:1281/", true, "password", "admin", 1));
        list = SavedControllers.remember(list, new Saved("https://b:1280", false, "cert", "ignored", 2));
        list = SavedControllers.remember(list, new Saved("https://A.ZITI:1281", true, "password", "carl", 3));
        assertEquals(2, list.size());
        assertEquals("https://A.ZITI:1281", list.getFirst().url());
        assertEquals("carl", list.getFirst().username());
        assertEquals("", list.get(1).username(), "a username is only kept for password sign-in");

        List<Saved> back = SavedControllers.parse(SavedControllers.write(list));
        assertEquals(list, back);
        assertEquals("b:1280", back.get(1).host());
    }

    @Test
    void neverStoresMoreThanTheLimitAndForgets() {
        List<Saved> list = List.of();
        for (int i = 0; i < 20; i++) {
            list = SavedControllers.remember(list, new Saved("https://c" + i + ":1280", false, "password", "", i));
        }
        assertEquals(SavedControllers.MAX, list.size());
        assertEquals("https://c19:1280", list.getFirst().url());
        list = SavedControllers.forget(list, "https://c19:1280/");
        assertTrue(list.stream().noneMatch(s -> s.url().equals("https://c19:1280")));
    }

    @Test
    void ignoresMalformedStorage() {
        assertTrue(SavedControllers.parse(null).isEmpty());
        assertTrue(SavedControllers.parse("not json").isEmpty());
        assertTrue(SavedControllers.parse("{\"url\":\"https://x\"}").isEmpty());
        List<Saved> l = SavedControllers.parse(
                "[{\"url\":\"javascript:alert(1)\"},{\"url\":\"https://ok:1280\",\"method\":\"weird\",\"trustAll\":\"yes\"}]");
        assertEquals(1, l.size());
        assertEquals("password", l.getFirst().method());
        assertFalse(l.getFirst().trustAll());
    }
}
