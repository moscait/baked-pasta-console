package io.moscait.bpc.views;

import java.util.List;
import java.util.Map;

import io.moscait.bpc.ui.CreateIntent;
import io.moscait.bpc.ui.EntityGrid;
import io.moscait.bpc.ui.FormDialog;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ui.ZitiView;
import io.moscait.bpc.ziti.FormValues;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiService;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;

@Route(value = "posture-checks", layout = MainLayout.class)
@PageTitle("Posture Checks")
public class PostureChecksView extends ZitiView implements BeforeEnterObserver {

    private static final Map<String, String> TYPES = Map.of("MFA", "MFA (TOTP)", "OS", "Operating System Version",
            "PROCESS", "Running Process Hash", "DOMAIN", "Windows Domain", "MAC", "MAC Address");

    private final EntityGrid grid = new EntityGrid("Posture Checks");
    private String pendingIntent;

    public PostureChecksView(ZitiService ziti) {
        super(ziti);
        grid.name("Posture Check Name");
        grid.component("Check Type", r -> Json.str(r, "typeId"), r -> Ui.chip(Json.strOr(r, "typeId", "?"), "dial"));
        grid.attributes("Role Attributes", "roleAttributes");
        grid.text("Details", PostureChecksView::details);
        grid.onCreate("New Posture Check", this::openCreate);
        grid.onDelete(r -> {
            ziti.remove("posture-checks", Json.str(r, "id"));
            Toast.info("Posture check deleted", Json.str(r, "name"));
        });
        add(Ui.page(Ui.pageHeader("Posture Checks",
                "Continuous device posture verification (MFA, OS version, MAC address, running processes, domain membership)."),
                grid));
    }

    private static String details(Map<String, Object> r) {
        return switch (Json.strOr(r, "typeId", "")) {
            case "MFA" -> {
                Number t = Json.num(r, "timeoutSeconds");
                yield t == null || t.intValue() < 0 ? "No re-prompt timeout" : "Re-prompt after " + t + "s";
            }
            case "DOMAIN" -> String.join(", ", Json.strings(r, "domains"));
            case "MAC" -> String.join(", ", Json.strings(r, "macAddresses"));
            case "OS" -> String.join(", ", Json.objects(r, "operatingSystems").stream()
                    .map(o -> Json.strOr(o, "type", "?") + " " + String.join("/", Json.strings(o, "versions"))).toList());
            case "PROCESS" -> Json.strOr(r, "process.path", "");
            default -> "";
        };
    }

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        pendingIntent = CreateIntent.consume(event);
    }

    @Override
    protected void reload() {
        grid.setRows(ziti.list("posture-checks"));
        if ("posture-check".equals(pendingIntent)) {
            pendingIntent = null;
            openCreate();
        }
    }

    private void openCreate() {
        TextField name = FormDialog.text("Name", "", "e.g. Require TOTP MFA", null);
        Select<String> type = FormDialog.select("Posture Check Type", List.of("MFA", "OS", "PROCESS", "DOMAIN", "MAC"),
                "MFA", TYPES::get);
        TextField attrs = FormDialog.text("Role Attributes", "mfa-required", null,
                "Service policies require this check with #attribute in their Posture Check Roles.");
        attrs.addClassName("mono");
        TextField values = FormDialog.text("Values", "", null, null);
        values.setVisible(false);
        type.addValueChangeListener(e -> {
            String t = e.getValue();
            values.setVisible(!t.equals("MFA"));
            values.setLabel(switch (t) {
                case "DOMAIN" -> "Domains";
                case "MAC" -> "MAC addresses";
                case "OS" -> "Operating systems (e.g. Windows:10.0.19041, macOS:14.0)";
                default -> "Process path (e.g. C:\\Program Files\\agent\\agent.exe)";
            });
        });
        FormDialog d = new FormDialog("Create Posture Check", "Create Check", false, errors -> {
            if (name.getValue().isBlank()) {
                errors.add("Name is required.");
                return;
            }
            Map<String, Object> body = Json.map("name", name.getValue().trim(), "typeId", type.getValue(), "roleAttributes",
                    FormValues.splitList(attrs.getValue()));
            List<String> vals = FormValues.splitList(values.getValue());
            switch (type.getValue()) {
                case "DOMAIN" -> body.put("domains", vals);
                case "MAC" -> body.put("macAddresses", vals);
                case "OS" -> body.put("operatingSystems", vals.stream().map(v -> {
                    String[] p = v.split(":", 2);
                    return (Object) Json.map("type", p[0], "versions", p.length > 1 ? List.of(p[1]) : List.of());
                }).toList());
                case "PROCESS" -> body.put("process", Json.map("osType", "Windows", "path", values.getValue().trim()));
                default -> {
                }
            }
            ziti.create("posture-checks", body);
            Toast.success("Posture check created", name.getValue().trim());
        });
        d.fields(name, type, values, attrs);
        d.open();
        name.focus();
    }
}
