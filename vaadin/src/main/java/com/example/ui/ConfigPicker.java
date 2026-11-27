package com.example.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import com.example.ziti.Json;
import com.example.ziti.ServiceConfigs;
import com.example.ziti.ServiceConfigs.TypeGroup;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.details.Details;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.radiobutton.RadioButtonGroup;
import com.vaadin.flow.data.renderer.ComponentRenderer;

/**
 * Chooses the configs attached to a service: one radio group per config type (at most one config
 * per type, the controller's rule), each option showing its data and other services using it.
 */
public class ConfigPicker extends Div {

    private static final String NONE = "";

    private final List<Map<String, Object>> configs;
    private final List<Map<String, Object>> types;
    private final Map<String, List<Map<String, Object>>> usedBy;
    private final String serviceId;
    private final Consumer<List<String>> onChange;
    private List<String> selected;

    public ConfigPicker(List<Map<String, Object>> configs, List<Map<String, Object>> types,
            List<Map<String, Object>> services, String serviceId, List<String> selected, Consumer<List<String>> onChange) {
        this.configs = configs;
        this.types = types;
        this.usedBy = ServiceConfigs.servicesByConfig(services);
        this.serviceId = serviceId;
        this.selected = new ArrayList<>(selected);
        this.onChange = onChange;
        getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "8px").set("max-height", "22rem")
                .set("overflow", "auto").set("padding", "2px");
        render();
    }

    public List<String> selected() {
        return selected;
    }

    private void render() {
        removeAll();
        if (configs.isEmpty()) {
            add(Ui.muted("No configs exist yet. Create them on the Configs tab."));
        }
        List<TypeGroup> groups = ServiceConfigs.groupByType(configs, types);
        groups.stream().filter(TypeGroup::known).forEach(g -> add(group(g)));
        List<TypeGroup> other = groups.stream().filter(g -> !g.known()).toList();
        if (!other.isEmpty()) {
            Div inner = new Div();
            inner.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "8px");
            other.forEach(g -> inner.add(group(g)));
            Details d = new Details("Other config types (" + String.join(", ", other.stream().map(TypeGroup::typeName).toList())
                    + "): not standard service configuration", inner);
            d.setOpened(other.stream().anyMatch(g -> g.configs().stream().anyMatch(c -> selected.contains(Json.str(c, "id")))));
            add(d);
        }
        List<String> missing = selected.stream()
                .filter(id -> configs.stream().noneMatch(c -> id.equals(c.get("id")))).toList();
        if (!missing.isEmpty()) {
            Div box = Ui.callout("warn", new Div(new Span("Attached config ids that no longer exist:")));
            for (String id : missing) {
                Button rm = new Button("Remove", e -> {
                    selected.remove(id);
                    changed();
                });
                rm.addThemeVariants(ButtonVariant.SMALL);
                Div row = new Div(Ui.mono(id), rm);
                row.getStyle().set("display", "flex").set("justify-content", "space-between").set("align-items", "center");
                box.add(row);
            }
            add(box);
        }
    }

    private void changed() {
        onChange.accept(List.copyOf(selected));
        render();
    }

    private Div group(TypeGroup g) {
        List<String> ids = new ArrayList<>(List.of(NONE));
        g.configs().forEach(c -> ids.add(Json.str(c, "id")));
        List<String> current = g.configs().stream().map(c -> Json.str(c, "id")).filter(selected::contains).toList();

        RadioButtonGroup<String> radios = new RadioButtonGroup<>();
        radios.setItems(ids);
        radios.getStyle().set("display", "flex").set("flex-direction", "column");
        radios.setRenderer(new ComponentRenderer<>(id -> {
            if (NONE.equals(id)) {
                return Ui.muted("None");
            }
            Map<String, Object> c = g.configs().stream().filter(x -> id.equals(x.get("id"))).findFirst().orElseThrow();
            boolean on = selected.contains(id);
            Div box = new Div();
            Div top = new Div(Ui.mono(Json.str(c, "name")));
            if (on) {
                top.add(new Span(" "), Ui.chip("ATTACHED", "dial"));
            }
            String data = Json.write(c.get("data") == null ? Map.of() : c.get("data"));
            Div summary = new Div(data.length() > 90 ? data.substring(0, 89) + "…" : data);
            summary.addClassNames("bp-mono", "bp-muted", "bp-xs");
            List<String> others = usedBy.getOrDefault(id, List.of()).stream().filter(s -> !s.get("id").equals(serviceId))
                    .map(s -> Json.str(s, "name")).toList();
            Div users = new Div(others.isEmpty() ? "Not used by any other service" : "Also used by " + String.join(", ", others));
            users.addClassNames("bp-muted", "bp-xs");
            box.add(top, summary, users);
            return box;
        }));
        radios.setValue(current.size() == 1 ? current.getFirst() : current.isEmpty() ? NONE : null);
        radios.addValueChangeListener(e -> {
            if (!e.isFromClient()) {
                return;
            }
            String v = e.getValue();
            selected = ServiceConfigs.selectForType(selected, g.typeId(), NONE.equals(v) ? null : v, configs);
            changed();
        });

        Div fs = new Div();
        fs.getStyle().set("border", "1px solid var(--ac-line)").set("border-radius", "var(--vaadin-radius-m)")
                .set("padding", "8px 10px");
        Div legend = new Div(Ui.mono(g.typeName()));
        legend.getChildren().findFirst().ifPresent(x -> x.getElement().getClassList().add("bp-strong"));
        if (g.purpose() != null) {
            legend.add(Ui.muted(" · " + g.purpose()));
        }
        legend.addClassName("bp-small");
        fs.add(legend);
        if (current.size() > 1) {
            Div warn = new Div(current.size() + " configs of this type are attached; a service can use only one. Choose one to keep.");
            warn.addClassNames("bp-warn", "bp-small");
            fs.add(warn);
        }
        fs.add(radios);
        return fs;
    }
}
