package io.moscait.bpc.views;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.canvas.ui.AccessWizard;
import io.moscait.bpc.ui.ConfigPicker;
import io.moscait.bpc.ui.CreateIntent;
import io.moscait.bpc.ui.EntityGrid;
import io.moscait.bpc.ui.FormDialog;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.TabSwitch;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ui.ZitiView;
import io.moscait.bpc.ziti.FormValues;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ServiceConfigs;
import io.moscait.bpc.ziti.ServiceConfigs.EndpointInfo;
import io.moscait.bpc.ziti.ZitiService;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.AnchorTarget;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;

@Route(value = "services", layout = MainLayout.class)
@RouteAlias(value = "configs", layout = MainLayout.class)
@RouteAlias(value = "config-types", layout = MainLayout.class)
@RouteAlias(value = "terminators", layout = MainLayout.class)
@PageTitle("Services")
public class ServicesView extends ZitiView implements BeforeEnterObserver {

    private final TabSwitch tabs = new TabSwitch();
    private final EntityGrid svcGrid = new EntityGrid("OpenZiti Services");
    private final EntityGrid cfgGrid = new EntityGrid("OpenZiti Configurations");
    private final EntityGrid typeGrid = new EntityGrid("Config Types");
    private final EntityGrid termGrid = new EntityGrid("Terminators");
    private List<Map<String, Object>> services = List.of();
    private List<Map<String, Object>> configs = List.of();
    private List<Map<String, Object>> configTypes = List.of();
    private Map<String, Map<String, Object>> configIndex = Map.of();
    private Map<String, List<Map<String, Object>>> usedBy = Map.of();
    private String pendingIntent;

    public ServicesView(ZitiService ziti) {
        super(ziti);
        svcGrid.name("Service Name");
        svcGrid.component("Access Endpoint", r -> {
            EndpointInfo ep = endpoint(r);
            return ep.url() != null ? ep.url() : ep.interceptDisplay() == null ? "" : ep.interceptDisplay();
        }, this::endpointCell);
        svcGrid.attributes("Role Attributes", "roleAttributes");
        svcGrid.component("Attached Configs", r -> Json.strings(r, "configs").stream().map(this::configName).toList(), r -> {
            Div d = new Div();
            d.addClassName("bp-chips");
            Json.strings(r, "configs").forEach(id -> d.add(Ui.chip(configName(id), "bind")));
            return d;
        });
        svcGrid.component("Encryption", r -> Boolean.FALSE.equals(r.get("encryptionRequired")) ? "Optional" : "E2E Required",
                r -> Boolean.FALSE.equals(r.get("encryptionRequired")) ? Ui.chip("Optional", "warn")
                        : Ui.chip("🔒 E2E Required", "ok"));
        svcGrid.onCreate("New Service", () -> openService(null));
        svcGrid.onEdit(this::openService);
        svcGrid.onDelete(r -> {
            ziti.remove("services", Json.str(r, "id"));
            Toast.info("Service deleted", Json.str(r, "name"));
        });

        cfgGrid.name("Config Name");
        cfgGrid.component("Type", r -> ServiceConfigs.configTypeName(r, configTypes),
                r -> Ui.chip(ServiceConfigs.configTypeName(r, configTypes), null));
        cfgGrid.text("Used By", r -> {
            List<Map<String, Object>> u = usedBy.getOrDefault(Json.str(r, "id"), List.of());
            return u.isEmpty() ? "No services" : String.join(", ", u.stream().map(s -> Json.str(s, "name")).toList());
        });
        cfgGrid.component("Endpoint / JSON Summary", r -> Json.write(r.get("data")), r -> {
            String data = Json.write(r.get("data"));
            Span s = Ui.mono(data.length() > 120 ? data.substring(0, 119) + "…" : data);
            s.addClassNames("bp-muted", "bp-xs");
            s.setTitle(data);
            return s;
        });
        cfgGrid.onCreate("New Config", () -> openConfig(null));
        cfgGrid.onEdit(this::openConfig);
        cfgGrid.onDelete(r -> {
            ziti.remove("configs", Json.str(r, "id"));
            Toast.info("Config deleted", Json.str(r, "name"));
        });

        typeGrid.name("Schema Type Name");
        typeGrid.text("ID", r -> Json.str(r, "id"));
        typeGrid.text("Purpose", r -> ServiceConfigs.KNOWN.stream().filter(k -> k.name().equals(Json.str(r, "name")))
                .map(ServiceConfigs.KnownType::purpose).findFirst().orElse("—"));

        termGrid.text("Service", r -> Json.strOr(r, "service.name", Json.str(r, "serviceId")));
        termGrid.text("Edge Router", r -> Json.strOr(r, "router.name", Json.str(r, "routerId")));
        termGrid.component("Binding Address", r -> Json.str(r, "address"), r -> Ui.mono(Json.str(r, "address")));
        termGrid.text("Precedence / Cost", r -> Json.strOr(r, "precedence", "default") + " (cost "
                + (Json.num(r, "cost") == null ? 0 : Json.num(r, "cost")) + ")");
        termGrid.onDelete(r -> {
            ziti.remove("terminators", Json.str(r, "id"));
            Toast.info("Terminator deleted", Json.str(r, "id"));
        });

        tabs.add("services", "Services", svcGrid).add("configs", "Configs", cfgGrid)
                .add("config-types", "Config Types", typeGrid).add("terminators", "Terminators", termGrid);

        Button wizard = new Button("Guided Service Wizard", VaadinIcon.MAGIC.create(), e -> openWizard());
        wizard.addClassName("aura-accent-orange");
        wizard.addThemeVariants(com.vaadin.flow.component.button.ButtonVariant.PRIMARY);
        Div header = new Div(Ui.pageHeader("Services & Configurations",
                "Zero-trust applications, intercept/host configurations, and live service terminators."), wizard);
        header.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("justify-content", "space-between")
                .set("align-items", "center").set("gap", "12px");
        add(Ui.page(header, tabs.tabs(), tabs.content()));
    }

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        tabs.select(TabSwitch.firstSegment(event));
        pendingIntent = CreateIntent.consume(event);
    }

    @Override
    protected void reload() {
        services = ziti.list("services");
        configs = ziti.list("configs");
        configTypes = ziti.list("config-types");
        List<Map<String, Object>> terms = ziti.list("terminators");
        configIndex = ServiceConfigs.index(configs);
        usedBy = ServiceConfigs.servicesByConfig(services);
        svcGrid.setRows(services);
        cfgGrid.setRows(configs);
        typeGrid.setRows(configTypes);
        termGrid.setRows(terms);
        tabs.count("services", services.size());
        tabs.count("configs", configs.size());
        tabs.count("config-types", configTypes.size());
        tabs.count("terminators", terms.size());
        if (pendingIntent != null) {
            String intent = pendingIntent;
            pendingIntent = null;
            if (intent.equals("service")) {
                tabs.select("services");
                openService(null);
            } else if (intent.equals("wizard")) {
                openWizard();
            }
        }
    }

    private String configName(String id) {
        return configs.stream().filter(c -> id.equals(c.get("id"))).map(c -> Json.str(c, "name")).findFirst().orElse(id);
    }

    private EndpointInfo endpoint(Map<String, Object> r) {
        return ServiceConfigs.describe(Json.strOr(r, "name", ""), Json.strings(r, "configs"), configIndex);
    }

    private Component endpointCell(Map<String, Object> r) {
        EndpointInfo ep = endpoint(r);
        if (ep.interceptDisplay() == null && ep.hostDisplay() == null) {
            Span s = Ui.muted("No intercept config");
            s.addClassName("bp-small");
            return s;
        }
        Div d = new Div();
        if (ep.url() != null) {
            Anchor a = new Anchor(ep.url(), ep.url() + " ↗");
            a.setTarget(AnchorTarget.BLANK);
            a.getElement().setAttribute("rel", "noopener noreferrer");
            a.addClassNames("bp-mono", "bp-strong");
            a.getStyle().set("color", "var(--ac-dial)");
            d.add(new Div(a));
        } else if (ep.interceptDisplay() != null) {
            Span s = Ui.mono(ep.interceptDisplay());
            s.addClassName("bp-strong");
            d.add(new Div(s));
        }
        if (ep.hostDisplay() != null) {
            Div h = new Div("→ " + ep.hostDisplay());
            h.addClassNames("bp-mono", "bp-muted", "bp-xs");
            d.add(h);
        }
        return d;
    }

    // ------------------------------------------------------------------ dialogs

    private void openService(Map<String, Object> editing) {
        boolean isNew = editing == null;
        TextField name = FormDialog.text("Service Name", isNew ? "" : Json.str(editing, "name"), "e.g. crm-https", null);
        name.addClassName("mono");
        TextField attrs = FormDialog.text("Role Attributes",
                isNew ? "" : String.join(", ", Json.strings(editing, "roleAttributes")), "e.g. web, crm-https", null);
        attrs.addClassName("mono");
        List<String> selected = new ArrayList<>(isNew ? List.of() : Json.strings(editing, "configs"));
        ConfigPicker picker = new ConfigPicker(configs, configTypes, services, isNew ? null : Json.str(editing, "id"),
                selected, next -> {
                    selected.clear();
                    selected.addAll(next);
                });
        Div pickerLabel = new Div(Ui.strong("Attached Configurations"));
        Div pickerHint = new Div("At most one config of each type. Configs are shared: edit their contents on the Configs tab.");
        pickerHint.addClassNames("bp-muted", "bp-small");
        FormDialog d = new FormDialog(isNew ? "Create Service" : "Edit Service: " + Json.str(editing, "name"),
                "Save Service", true, errors -> {
                    if (name.getValue().isBlank()) {
                        errors.add("Service name is required.");
                        return;
                    }
                    List<String> dupes = ServiceConfigs.duplicateTypes(selected, configs, configTypes);
                    if (!dupes.isEmpty()) {
                        errors.add("One config per type: choose a single " + String.join(", ", dupes) + " config before saving.");
                        return;
                    }
                    Map<String, Object> body = Json.map("name", name.getValue().trim(), "roleAttributes",
                            FormValues.splitList(attrs.getValue()), "configs", List.copyOf(selected));
                    if (isNew) {
                        body.put("encryptionRequired", true);
                        body.put("terminatorStrategy", "smartrouting");
                        ziti.create("services", body);
                        Toast.success("Service created", Json.str(body, "name"));
                    } else {
                        ziti.patch("services", Json.str(editing, "id"), body);
                        Toast.success("Service updated", Json.str(body, "name"));
                    }
                });
        d.fields(FormDialog.grid(name, attrs), pickerLabel, pickerHint, picker);
        d.open();
        name.focus();
    }

    private void openConfig(Map<String, Object> editing) {
        boolean isNew = editing == null;
        List<Map<String, Object>> typeOptions = new ArrayList<>(configTypes);
        typeOptions.sort(Comparator.<Map<String, Object>>comparingInt(t -> {
            for (int i = 0; i < ServiceConfigs.KNOWN.size(); i++) {
                if (ServiceConfigs.KNOWN.get(i).name().equals(Json.str(t, "name"))) {
                    return i;
                }
            }
            return ServiceConfigs.KNOWN.size();
        }).thenComparing(t -> Json.strOr(t, "name", "")));
        TextField name = FormDialog.text("Configuration Name", isNew ? "" : Json.str(editing, "name"), "e.g. app.intercept.v1",
                null);
        name.addClassName("mono");
        String firstType = typeOptions.isEmpty() ? null : Json.str(typeOptions.getFirst(), "id");
        Select<String> type = FormDialog.entitySelect("Config Type", typeOptions, firstType, null);
        TextArea data = FormDialog.area("Data (JSON object)", isNew
                ? ServiceConfigs.template(typeOptions.isEmpty() ? "" : Json.str(typeOptions.getFirst(), "name"))
                : Json.pretty(editing.get("data") == null ? Map.of() : editing.get("data")), null, true);
        data.setMinRows(10);
        type.addValueChangeListener(e -> typeOptions.stream().filter(t -> e.getValue() != null && e.getValue().equals(t.get("id")))
                .findFirst().ifPresent(t -> data.setValue(ServiceConfigs.template(Json.str(t, "name")))));
        FormDialog d = new FormDialog(isNew ? "Create Configuration" : "Edit Configuration: " + Json.str(editing, "name"),
                isNew ? "Create Config" : "Save Config", true, errors -> {
                    if (name.getValue().isBlank()) {
                        errors.add("Configuration name is required.");
                    }
                    Map<String, Object> parsed = null;
                    try {
                        parsed = ServiceConfigs.parseData(data.getValue());
                    } catch (IllegalArgumentException e) {
                        errors.add(e.getMessage());
                    }
                    if (!errors.isEmpty()) {
                        return;
                    }
                    if (isNew) {
                        if (type.getValue() == null) {
                            errors.add("Choose a config type. The controller reported none.");
                            return;
                        }
                        ziti.create("configs", Json.map("name", name.getValue().trim(), "configTypeId", type.getValue(),
                                "data", parsed));
                        Toast.success("Configuration created", name.getValue().trim());
                    } else {
                        // The type of an existing config cannot change; only its name and data.
                        ziti.patch("configs", Json.str(editing, "id"), Json.map("name", name.getValue().trim(), "data", parsed));
                        Toast.success("Configuration updated", name.getValue().trim());
                    }
                });
        d.fields(name);
        if (isNew) {
            d.fields(type);
        } else {
            TextField fixed = FormDialog.text("Config Type", ServiceConfigs.configTypeName(editing, configTypes) + " (cannot be changed)",
                    null, null);
            fixed.setReadOnly(true);
            d.fields(fixed);
            List<Map<String, Object>> users = usedBy.getOrDefault(Json.str(editing, "id"), List.of());
            if (!users.isEmpty()) {
                d.fields(Ui.callout("warn", "Used by " + String.join(", ", users.stream().map(s -> Json.str(s, "name")).toList())
                        + ". Changes apply to every one of them."));
            }
        }
        d.fields(data);
        d.open();
        name.focus();
    }

    private void openWizard() {
        new AccessWizard(ziti, ziti.loadCanvasModel(), null).open();
    }
}
