package io.moscait.bpc.ui;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;

/**
 * Page-level tabs whose ids are also routes (e.g. "routers" / "transit-routers"): switching a
 * tab updates the address bar without re-navigating, so each tab can be linked to directly.
 */
public class TabSwitch extends Div {

    private final Tabs tabs = new Tabs();
    private final Map<String, Tab> byId = new LinkedHashMap<>();
    private final Map<String, Component> panes = new LinkedHashMap<>();
    private final Map<String, String> baseLabels = new LinkedHashMap<>();
    private final List<Consumer<String>> listeners = new ArrayList<>();
    private final Div content = new Div();
    private boolean updateUrl = true;

    public TabSwitch() {
        content.setWidthFull();
        tabs.addSelectedChangeListener(e -> {
            String id = idOf(e.getSelectedTab());
            panes.forEach((k, v) -> v.setVisible(k.equals(id)));
            if (updateUrl && e.isFromClient()) {
                UI.getCurrent().getPage().getHistory().replaceState(null, id);
            }
            listeners.forEach(l -> l.accept(id));
        });
    }

    public Tabs tabs() {
        return tabs;
    }

    public Div content() {
        return content;
    }

    public TabSwitch noUrl() {
        updateUrl = false;
        return this;
    }

    public TabSwitch add(String id, String label, Component pane) {
        Tab t = new Tab(label);
        byId.put(id, t);
        baseLabels.put(id, label);
        panes.put(id, pane);
        tabs.add(t);
        content.add(pane);
        pane.setVisible(byId.size() == 1);
        return this;
    }

    public void count(String id, int n) {
        Tab t = byId.get(id);
        if (t != null) {
            t.setLabel(baseLabels.get(id) + " (" + n + ")");
        }
    }

    public void select(String id) {
        Tab t = byId.get(id);
        if (t != null) {
            tabs.setSelectedTab(t);
            panes.forEach((k, v) -> v.setVisible(k.equals(id)));
        }
    }

    public String selected() {
        return idOf(tabs.getSelectedTab());
    }

    public void onChange(Consumer<String> l) {
        listeners.add(l);
    }

    private String idOf(Tab t) {
        return byId.entrySet().stream().filter(e -> e.getValue() == t).map(Map.Entry::getKey).findFirst().orElse(null);
    }

    /** The first path segment of the current navigation, for choosing the initial tab. */
    public static String firstSegment(com.vaadin.flow.router.BeforeEnterEvent event) {
        String p = event.getLocation().getPath();
        int i = p.indexOf('/');
        return i < 0 ? p : p.substring(0, i);
    }
}
