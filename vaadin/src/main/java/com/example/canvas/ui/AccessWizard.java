package com.example.canvas.ui;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import com.example.canvas.AcModel;
import com.example.canvas.AcModel.AcIdentity;
import com.example.canvas.WizardLogic;
import com.example.canvas.WizardLogic.Check;
import com.example.canvas.WizardLogic.Conflict;
import com.example.canvas.WizardLogic.Input;
import com.example.canvas.WizardLogic.Plan;
import com.example.canvas.WizardLogic.Template;
import com.example.ui.Toast;
import com.example.ui.Ui;
import com.example.ziti.ZitiException;
import com.example.ziti.ZitiService;
import com.example.ziti.ZitiService.CanvasApplyError;
import com.example.ziti.ZitiService.RevertFailure;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.ListItem;
import com.vaadin.flow.component.html.OrderedList;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.IntegerField;
import com.vaadin.flow.component.textfield.TextField;

/** "Set up a service" in four steps: service, server (host), users, review. */
public class AccessWizard extends Dialog {

    private static final String[] STEPS = { "Service", "Server", "Users", "Review" };
    private static final List<List<String>> STEP_FIELDS = List.of(
            List.of("system", "serviceName", "interceptHost", "interceptPort"),
            List.of("hostId", "hostName", "hostsAttr", "hostAddress", "hostPort"),
            List.of("usersAttr", "newUserName", "userIds"), List.of());
    private static final AtomicInteger IDS = new AtomicInteger();

    private final ZitiService ziti;
    private final AcModel model;
    private final Consumer<Plan> onStage;
    private final Input w = WizardLogic.blank("ssh", "");
    private final Set<String> edited = new HashSet<>();
    private final Div stepper = new Div();
    private final Div body = new Div();
    private final Div footer = new Div();
    private int step;
    private boolean showErrors;
    private String applyError;
    private final List<AcIdentity> people;

    /**
     * @param onStage when set, offers "Stage in Pending Changes" (the canvas) next to "Create &amp; Apply Now".
     */
    public AccessWizard(ZitiService ziti, AcModel model, Consumer<Plan> onStage) {
        this.ziti = ziti;
        this.model = model;
        this.onStage = onStage;
        this.people = model.identities.stream().filter(i -> !i.isAdmin).sorted((a, b) -> a.name.compareToIgnoreCase(b.name))
                .toList();
        setHeaderTitle("Set up a service (End-to-End Wizard)");
        setWidth("min(1000px, 96vw)");
        setCloseOnOutsideClick(false);
        getHeader().add(Ui.iconButton(VaadinIcon.CLOSE, "Close", this::close));
        stepper.addClassName("bp-wizard-steps");
        body.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "14px").set("margin-top", "14px");
        add(stepper, body);
        getFooter().add(footer);
        footer.getStyle().set("display", "flex").set("gap", "8px").set("width", "100%");
        render();
    }

    private static String newId() {
        return "new-w" + IDS.incrementAndGet();
    }

    // ------------------------------------------------------------------ state helpers

    private List<Check> checks() {
        return WizardLogic.validate(model, w);
    }

    private List<Check> stepErrors(int s) {
        return checks().stream().filter(c -> STEP_FIELDS.get(s).contains(c.field())).toList();
    }

    private String errorFor(String field) {
        String msg = checks().stream().filter(c -> c.field().equals(field)).map(Check::message).findFirst().orElse(null);
        if (msg == null) {
            return null;
        }
        boolean conflict = WizardLogic.detectConflicts(model, w).stream().anyMatch(c -> c.field().equals(field));
        return showErrors || conflict ? msg : null;
    }

    private void resuggest(String templateId, String system) {
        Input s = WizardLogic.blank(templateId, system);
        w.templateId = templateId;
        w.system = system;
        if (!edited.contains("serviceName")) {
            w.serviceName = s.serviceName;
        }
        if (!edited.contains("interceptHost")) {
            w.interceptHost = s.interceptHost;
        }
        if (!edited.contains("interceptPort")) {
            w.interceptPort = s.interceptPort;
        }
        if (!edited.contains("hostAddress")) {
            w.hostAddress = s.hostAddress;
        }
        if (!edited.contains("hostPort")) {
            w.hostPort = s.hostPort;
        }
        if (!edited.contains("protocols")) {
            w.protocols = s.protocols;
        }
        if (!edited.contains("hostName")) {
            w.hostName = s.hostName;
        }
        if (!edited.contains("usersAttr")) {
            w.usersAttr = s.usersAttr;
        }
        if (!edited.contains("hostsAttr")) {
            w.hostsAttr = w.serviceName + "-hosts";
        }
        w.reuseExisting = false;
        if (!edited.contains("hostMode")) {
            String sys = WizardLogic.slugify(system);
            AcIdentity existing = sys.isEmpty() ? null
                    : people.stream().filter(i -> i.name.equalsIgnoreCase(sys)).findFirst().orElse(null);
            w.hostMode = existing != null ? "existing" : "new";
            w.hostId = existing != null ? existing.id : "";
        }
        applyError = null;
    }

    private void touch(String field) {
        edited.add(field);
        applyError = null;
    }

    private void setServiceName(String v) {
        touch("serviceName");
        w.serviceName = v;
        w.reuseExisting = false;
        if (!edited.contains("hostsAttr")) {
            w.hostsAttr = v + "-hosts";
        }
    }

    // ------------------------------------------------------------------ rendering

    private void render() {
        stepper.removeAll();
        for (int i = 0; i < STEPS.length; i++) {
            int idx = i;
            Span n = new Span(i < step ? "✓" : String.valueOf(i + 1));
            n.addClassName("n");
            Div s = new Div(n, new Span(STEPS[i]));
            s.addClassName("bp-wizard-step");
            if (i == step) {
                s.addClassName("active");
                s.getElement().setAttribute("aria-current", "step");
            } else if (i < step) {
                s.addClassName("done");
            }
            s.getStyle().set("cursor", "pointer");
            s.addClickListener(e -> goTo(idx));
            stepper.add(s);
        }
        body.removeAll();
        List<Check> errs = stepErrors(step);
        if (showErrors && !errs.isEmpty()) {
            body.add(Ui.errors(errs.stream().map(Check::message).toList()));
        }
        switch (step) {
            case 0 -> renderService();
            case 1 -> renderServer();
            case 2 -> renderUsers();
            default -> renderReview();
        }
        renderFooter();
    }

    private TextField text(String label, String value, String helper, String errField, Consumer<String> set) {
        TextField f = new TextField(label);
        f.setValue(value == null ? "" : value);
        f.setWidthFull();
        if (helper != null) {
            f.setHelperText(helper);
        }
        String err = errField == null ? null : errorFor(errField);
        f.setInvalid(err != null);
        f.setErrorMessage(err);
        f.addValueChangeListener(e -> {
            if (e.isFromClient()) {
                set.accept(e.getValue());
                render();
            }
        });
        return f;
    }

    private IntegerField port(String label, int value, String errField, Consumer<Integer> set) {
        IntegerField f = new IntegerField(label);
        f.setMin(1);
        f.setMax(65535);
        f.setValue(value);
        f.setWidthFull();
        String err = errorFor(errField);
        f.setInvalid(err != null);
        f.setErrorMessage(err);
        f.addValueChangeListener(e -> {
            if (e.isFromClient()) {
                set.accept(e.getValue() == null ? 0 : e.getValue());
                render();
            }
        });
        return f;
    }

    private Div choice(String label, String hint, boolean on, Runnable click) {
        Div c = new Div(new Span(label));
        c.addClassName("bp-choice");
        c.getStyle().set("justify-content", "space-between");
        if (hint != null) {
            Span h = new Span(hint);
            h.addClassNames("bp-mono", "bp-xs", "bp-muted");
            c.add(h);
        }
        c.getElement().setAttribute("role", "radio");
        c.getElement().setAttribute("aria-checked", String.valueOf(on));
        c.getElement().setAttribute("tabindex", "0");
        c.addClickListener(e -> {
            click.run();
            render();
        });
        return c;
    }

    private static Div grid2(Component... c) {
        Div d = new Div(c);
        d.addClassName("bp-form-grid");
        d.getStyle().set("grid-template-columns", "repeat(auto-fit, minmax(260px, 1fr))");
        return d;
    }

    private static Paragraph lead(Component... c) {
        Paragraph p = new Paragraph(c);
        p.addClassNames("bp-muted", "bp-small");
        p.getStyle().set("margin", "0");
        return p;
    }

    private void renderService() {
        body.add(lead(new Span("What do people need to reach? Pick the closest template; you can customize any name, hostname, or port.")));
        Div groups = new Div();
        groups.getStyle().set("display", "grid").set("grid-template-columns", "repeat(auto-fit, minmax(210px, 1fr))")
                .set("gap", "12px");
        groups.getElement().setAttribute("role", "radiogroup");
        groups.getElement().setAttribute("aria-label", "Kind of service");
        for (String g : new LinkedHashSet<>(WizardLogic.TEMPLATES.stream().map(Template::group).toList())) {
            Div col = new Div();
            col.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "6px");
            Div h = new Div(g);
            h.addClassNames("bp-xs", "bp-muted", "bp-strong");
            h.getStyle().set("text-transform", "uppercase").set("letter-spacing", "0.05em");
            col.add(h);
            for (Template t : WizardLogic.TEMPLATES.stream().filter(t -> t.group().equals(g)).toList()) {
                Div c = choice(t.label(), t.id().equals("custom") ? "TCP" : ":" + t.port(), w.templateId.equals(t.id()),
                        () -> resuggest(t.id(), w.system));
                c.getStyle().set("padding", "8px 10px");
                col.add(c);
            }
            groups.add(col);
        }
        body.add(groups);
        Template t = WizardLogic.template(w.templateId);
        if (t.note() != null) {
            body.add(Ui.callout(null, t.note()));
        }
        TextField system = text("System or server name", w.system,
                "Names below are built from this, e.g. " + (w.system.isEmpty() ? "crm-" + t.slug() : w.serviceName) + ".",
                "system", v -> resuggest(w.templateId, v));
        system.setPlaceholder("e.g. devbox, billing, crm-prod");
        TextField svc = text("Service name", w.serviceName, null, "serviceName", v -> setServiceName(WizardLogic.slugify(v)));
        svc.addClassName("mono");
        TextField ih = text("Users connect to (intercept address)", w.interceptHost,
                "A private Ziti intercept DNS name like " + (w.interceptHost.isEmpty() ? "crm.ziti" : w.interceptHost) + ".",
                "interceptHost", v -> {
                    touch("interceptHost");
                    w.interceptHost = v;
                });
        ih.addClassName("mono");
        body.add(grid2(system, svc, ih, port("Intercept Port", w.interceptPort, "interceptPort", v -> {
            touch("interceptPort");
            w.interceptPort = v;
        })));
        if (step == 0) {
            system.focus();
        }

        List<Conflict> conflicts = WizardLogic.detectConflicts(model, w).stream().filter(c -> c.field().equals("serviceName"))
                .toList();
        if (!conflicts.isEmpty() && !w.reuseExisting) {
            String next = WizardLogic.suggestAvailableServiceName(model, w.serviceName);
            var ul = new com.vaadin.flow.component.html.UnorderedList();
            conflicts.forEach(c -> ul.add(new ListItem(new Span(c.label() + ": "), new Code(c.name()))));
            Button use = Ui.primary("Use available name (" + next + ")", null, () -> {
                setServiceName(next);
                render();
            });
            Button reuse = Ui.button("Update existing " + w.serviceName + " resources", null, () -> {
                w.reuseExisting = true;
                applyError = null;
                render();
            });
            body.add(Ui.callout("warn", new Div(Ui.strong("Existing resources on the controller conflict with "),
                    new Code(w.serviceName)), ul, Ui.toolbar(use, reuse)));
        } else if (!conflicts.isEmpty()) {
            Button back = Ui.small("Use a new name instead", null, () -> {
                w.reuseExisting = false;
                render();
            });
            body.add(Ui.callout("ok", new Span("Updating the existing resources ("
                    + String.join(", ", conflicts.stream().map(Conflict::label).toList())
                    + ") and adding any missing ones. "), back));
        }
    }

    private void renderServer() {
        body.add(lead(new Span("An identity on (or next to) the server receives the traffic and forwards it to the target "
                + "application. It runs a tunneler such as "), new Code("ziti-edge-tunnel"), new Span(".")));
        Div modes = new Div(choice("New hosting identity", null, w.hostMode.equals("new"), () -> setHostMode("new")),
                choice("Existing identity", null, w.hostMode.equals("existing"), () -> setHostMode("existing")));
        modes.addClassName("bp-choice-group");
        body.add(modes);
        Component hostField;
        if (w.hostMode.equals("new")) {
            TextField hn = text("Hosting identity name", w.hostName,
                    "Usually the server machine's hostname. You'll enroll it on that server.", "hostName", v -> {
                        touch("hostName");
                        w.hostName = WizardLogic.slugify(v);
                    });
            hn.addClassName("mono");
            Conflict hc = WizardLogic.detectConflicts(model, w).stream().filter(c -> c.field().equals("hostName")).findFirst()
                    .orElse(null);
            if (hc != null) {
                Button use = Ui.small("Use existing identity “" + hc.name() + "”", null, () -> {
                    touch("hostMode");
                    w.hostMode = "existing";
                    w.hostId = hc.id();
                    render();
                });
                hostField = new Div(hn, use);
            } else {
                hostField = hn;
            }
        } else {
            Select<String> sel = new Select<>();
            sel.setLabel("Select existing hosting identity");
            List<String> ids = new ArrayList<>(List.of(""));
            people.forEach(i -> ids.add(i.id));
            sel.setItems(ids);
            sel.setItemLabelGenerator(id -> id.isEmpty() ? "Choose…"
                    : people.stream().filter(i -> i.id.equals(id)).findFirst()
                            .map(i -> i.name + (i.attrs.isEmpty() ? "" : " (#" + String.join(", #", i.attrs) + ")")
                                    + (i.enrolled ? "" : " · not enrolled"))
                            .orElse(id));
            sel.setValue(w.hostId == null ? "" : w.hostId);
            sel.setWidthFull();
            String err = errorFor("hostId");
            sel.setInvalid(err != null);
            sel.setErrorMessage(err);
            sel.addValueChangeListener(e -> {
                w.hostId = e.getValue();
                render();
            });
            hostField = sel;
        }
        TextField ha = text("Role attribute for hosts", w.hostsAttr,
                "The Bind policy selects hosts by #" + w.hostsAttr + " for easy HA scaling later.", "hostsAttr", v -> {
                    touch("hostsAttr");
                    w.hostsAttr = WizardLogic.slugify(v);
                });
        ha.addClassName("mono");
        TextField addr = text("Target server address (from hosting identity)", w.hostAddress,
                "127.0.0.1 when the tunneler runs on the server itself; or LAN IP/DNS.", "hostAddress", v -> {
                    touch("hostAddress");
                    w.hostAddress = v;
                });
        addr.addClassName("mono");
        body.add(grid2(hostField, ha, addr, port("Target server port", w.hostPort, "hostPort", v -> {
            touch("hostPort");
            w.hostPort = v;
        })));
    }

    private void setHostMode(String m) {
        touch("hostMode");
        String sys = WizardLogic.slugify(w.system);
        String def = people.stream().filter(i -> i.name.equalsIgnoreCase(sys)).map(i -> i.id).findFirst().orElse(w.hostId);
        w.hostMode = m;
        if (m.equals("existing")) {
            w.hostId = def;
        }
    }

    private void renderUsers() {
        body.add(lead(new Span("Who may dial "), new Code(w.serviceName), new Span(
                "? Access is granted to a role attribute group so onboarding future users only requires tagging their identity.")));
        Template t = WizardLogic.template(w.templateId);
        record G(String attr, String label, long count) {
        }
        List<G> groups = new ArrayList<>();
        WizardLogic.USER_GROUPS.forEach(g -> groups.add(new G(g.attr(), g.label(),
                model.identities.stream().filter(i -> i.attrs.contains(g.attr())).count())));
        people.stream().flatMap(i -> i.attrs.stream()).distinct()
                .filter(a -> WizardLogic.USER_GROUPS.stream().noneMatch(g -> g.attr().equals(a))).sorted()
                .forEach(a -> groups.add(new G(a, "#" + a, model.identities.stream().filter(i -> i.attrs.contains(a)).count())));
        groups.sort((a, b) -> {
            int ra = t.users().indexOf(a.attr()) >= 0 ? t.users().indexOf(a.attr()) : a.count() > 0 ? 10 : 20;
            int rb = t.users().indexOf(b.attr()) >= 0 ? t.users().indexOf(b.attr()) : b.count() > 0 ? 10 : 20;
            return ra != rb ? Integer.compare(ra, rb) : a.label().compareToIgnoreCase(b.label());
        });
        Div gs = new Div();
        gs.addClassName("bp-choice-group");
        gs.getStyle().set("grid-template-columns", "repeat(auto-fit, minmax(180px, 1fr))");
        for (G g : groups) {
            String hint = (t.users().contains(g.attr()) ? "suggested · " : "") + g.count();
            gs.add(choice(g.label(), hint, w.usersAttr.equals(g.attr()), () -> {
                touch("usersAttr");
                w.usersAttr = g.attr();
            }));
        }
        body.add(gs);
        TextField ua = text("Role attribute name", w.usersAttr, null, "usersAttr", v -> {
            touch("usersAttr");
            w.usersAttr = WizardLogic.slugify(v);
        });
        ua.addClassName("mono");
        body.add(ua);
        Div modes = new Div(choice("New user device", null, w.userMode.equals("new"), () -> w.userMode = "new"),
                choice("Existing identities", null, w.userMode.equals("existing"), () -> w.userMode = "existing"));
        modes.addClassName("bp-choice-group");
        body.add(modes);
        if (w.userMode.equals("new")) {
            TextField nu = text("Device identity name", w.newUserName,
                    "One identity per device. It gets #" + w.usersAttr + " and a one-time JWT enrollment token.",
                    "newUserName", v -> {
                        applyError = null;
                        w.newUserName = WizardLogic.slugify(v);
                    });
            nu.setPlaceholder("e.g. jdoe-laptop");
            nu.addClassName("mono");
            body.add(nu);
            WizardLogic.detectConflicts(model, w).stream().filter(c -> c.field().equals("newUserName")).findFirst()
                    .ifPresent(uc -> body.add(Ui.small("Use existing identity “" + uc.name() + "”", null, () -> {
                        w.userMode = "existing";
                        if (!w.userIds.contains(uc.id())) {
                            w.userIds.add(uc.id());
                        }
                        render();
                    })));
        } else {
            List<AcIdentity> inGroup = people.stream().filter(i -> i.attrs.contains(w.usersAttr)).toList();
            if (!inGroup.isEmpty()) {
                body.add(lead(new Span("Already in "), new Code("#" + w.usersAttr), new Span(": "
                        + String.join(", ", inGroup.stream().map(i -> i.name).toList()) + ". Pick more to add them:")));
            }
            Div picks = new Div();
            picks.addClassName("bp-choice-group");
            for (AcIdentity i : people.stream().filter(i -> !i.attrs.contains(w.usersAttr)).toList()) {
                boolean picked = w.userIds.contains(i.id);
                picks.add(choice(i.name, picked ? "✓" : i.attrs.isEmpty() ? null : "#" + i.attrs.getFirst(), picked, () -> {
                    if (!w.userIds.remove(i.id)) {
                        w.userIds.add(i.id);
                    }
                }));
            }
            body.add(picks);
            String err = errorFor("userIds");
            if (err != null) {
                body.add(Ui.callout("error", err));
            }
        }
    }

    private void renderReview() {
        Plan p = WizardLogic.plan(model, w, AccessWizard::newId);
        if (applyError != null) {
            body.add(Ui.callout("error", new Div(Ui.strong("Controller rejected wizard apply")), new Div(new Span(applyError))));
        }
        body.add(Ui.callout("ok", new Div(Ui.strong(p.title())), new Div(new Span(p.summary())),
                new Div(Ui.muted(onStage != null
                        ? "Click Create & Apply Now to provision everything immediately, or Stage in Pending Changes to inspect the API calls on the canvas first."
                        : "Everything below will be created and applied to the controller immediately."))));
        Grid<WizardLogic.Item> g = new Grid<>();
        g.setAllRowsVisible(true);
        g.addColumn(WizardLogic.Item::what).setHeader("Creates / Updates").setAutoWidth(true);
        g.addComponentColumn(it -> {
            Div d = new Div(Ui.mono(it.name()));
            if (it.existing()) {
                d.add(new Span(" "), Ui.chip("existing", "warn"));
            }
            return d;
        }).setHeader("Name").setAutoWidth(true);
        g.addColumn(WizardLogic.Item::detail).setHeader("Details").setFlexGrow(1);
        g.setItems(p.items());
        body.add(g);
        OrderedList next = new OrderedList();
        p.next().forEach(n -> next.add(new ListItem(n)));
        next.addClassName("bp-small");
        body.add(new Div(Ui.strong("Next steps")), next);
    }

    private void renderFooter() {
        footer.removeAll();
        if (step > 0) {
            footer.add(new Button("Back", e -> {
                step--;
                showErrors = false;
                applyError = null;
                render();
            }));
        }
        footer.add(Ui.spacer(), new Button("Cancel", e -> close()));
        if (step < 3) {
            Button next = Ui.primary("Next", VaadinIcon.ARROW_RIGHT, () -> {
                if (!stepErrors(step).isEmpty()) {
                    showErrors = true;
                } else {
                    showErrors = false;
                    applyError = null;
                    step++;
                }
                render();
            });
            footer.add(next);
        } else {
            if (onStage != null) {
                footer.add(Ui.button("Stage in Pending Changes", VaadinIcon.LIST, () -> {
                    if (validOrShow()) {
                        onStage.accept(WizardLogic.plan(model, w, AccessWizard::newId));
                        close();
                    }
                }));
            }
            Button apply = Ui.primary("Create & Apply Now", VaadinIcon.CHECK, this::applyNow);
            apply.addThemeVariants(ButtonVariant.SUCCESS);
            footer.add(apply);
        }
    }

    private boolean validOrShow() {
        if (!checks().isEmpty()) {
            showErrors = true;
            for (int s = 0; s < 3; s++) {
                if (!stepErrors(s).isEmpty()) {
                    step = s;
                    break;
                }
            }
            render();
            return false;
        }
        return true;
    }

    private void goTo(int target) {
        for (int s = 0; s < target; s++) {
            if (!stepErrors(s).isEmpty()) {
                step = s;
                showErrors = true;
                render();
                return;
            }
        }
        applyError = null;
        step = target;
        render();
    }

    private void applyNow() {
        if (!validOrShow()) {
            return;
        }
        Plan p = WizardLogic.plan(model, w, AccessWizard::newId);
        try {
            ziti.applyCanvasOps(p.ops(), new HashMap<>());
            Toast.success("Service set up end-to-end!", p.summary());
            close();
        } catch (CanvasApplyError e) {
            // Roll back what was created so a failed setup does not leave half a service behind.
            List<RevertFailure> failures = ziti.revertCanvasOps(e.reverts());
            applyError = failures.isEmpty() ? ZitiException.text(e) + ". Nothing was kept."
                    : ZitiException.text(e) + ". Rolling back also failed: " + ZitiService.describeRevertFailures(failures);
            Toast.error("Failed to apply wizard", applyError);
            render();
        } catch (RuntimeException e) {
            applyError = ZitiException.text(e);
            render();
        }
    }
}
