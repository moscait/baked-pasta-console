package com.example.ui;

import java.util.List;

import com.vaadin.flow.component.UI;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.Location;

/**
 * Quick Add opens a page with {@code ?new=<intent>}. The page reads it once and the parameter is
 * dropped from the address bar so a reload or Back does not reopen the dialog.
 */
public final class CreateIntent {

    private CreateIntent() {
    }

    public static String consume(BeforeEnterEvent event) {
        Location loc = event.getLocation();
        List<String> v = loc.getQueryParameters().getParameters().get("new");
        if (v == null || v.isEmpty()) {
            return null;
        }
        UI ui = event.getUI();
        ui.getPage().getHistory().replaceState(null, loc.getPath());
        return v.getFirst();
    }

    /** Other one-shot query values (q, ip, …) used to pre-filter a page. */
    public static String param(BeforeEnterEvent event, String name) {
        List<String> v = event.getLocation().getQueryParameters().getParameters().get(name);
        return v == null || v.isEmpty() ? null : v.getFirst();
    }
}
