package com.example.ui;

import java.util.ArrayList;
import java.util.List;

import com.example.ui.SavedControllers.Saved;
import com.example.ziti.ZitiException;
import com.example.ziti.ZitiService;
import com.vaadin.flow.component.AttachEvent;
import com.vaadin.flow.component.Key;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H1;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.page.WebStorage;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;
import com.vaadin.flow.component.tabs.TabsVariant;
import com.vaadin.flow.component.textfield.PasswordField;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.component.upload.Upload;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.server.streams.UploadHandler;

@Route("login")
@PageTitle("Sign in · Baked Pasta Console")
public class LoginView extends Div implements BeforeEnterObserver {

    private final ZitiService ziti;
    private final TextField url = new TextField("Edge Controller URL");
    private final Span detected = new Span();
    private final Tabs method = new Tabs();
    private final Tab passwordTab = new Tab("UPDB Password");
    private final Tab certTab = new Tab("Client Cert");
    private final Tab jwtTab = new Tab("External JWT");
    private final TextField username = new TextField("Username");
    private final PasswordField password = new PasswordField("Password");
    private final TextArea extJwt = new TextArea("Bearer JWT Token");
    private final PasswordField p12Password = new PasswordField("Certificate password");
    private final Div passwordFields = new Div();
    private final Div certFields = new Div();
    private final Checkbox trustAll = new Checkbox("Accept self-signed controller certificate");
    private final Button signIn = new Button("Sign In to Controller", VaadinIcon.LOCK.create());
    private final Checkbox remember = new Checkbox("Remember this controller in this browser", true);
    private final Div savedList = new Div();
    private List<Saved> saved = new ArrayList<>();
    private byte[] p12;

    public LoginView(ZitiService ziti) {
        this.ziti = ziti;
        addClassName("bp-login-wrap");

        Div card = new Div();
        card.addClassName("bp-login");

        Div head = new Div();
        head.addClassName("bp-login-head");
        Div tag = new Div("Everything ziti needs, layered and baked");
        tag.addClassName("tag");
        H1 title = new H1();
        Span pasta = new Span("pasta ");
        pasta.getStyle().set("color", "var(--ac-bind)");
        title.add(new Span("baked "), pasta, new Span("console"));
        Div titleRow = new Div(Brand.mark(48), new Div(tag, title));
        titleRow.getStyle().set("display", "flex").set("gap", "12px").set("align-items", "center");
        Paragraph intro = new Paragraph();
        intro.add(new Span("The server-side edition: every controller call is made by this server, so no controller "
                + "token ever reaches the browser. Plug-compatible with "), new Code("openziti/ziti-console"),
                new Span(", with the Access Canvas & Guided Service Wizard."));
        intro.addClassNames("bp-small", "bp-muted");
        intro.getStyle().set("margin", "10px 0 0");
        head.add(titleRow, intro);

        Div body = new Div();
        body.addClassName("bp-login-body");

        url.setWidthFull();
        url.setPlaceholder("https://localhost:1280");
        url.setPrefixComponent(VaadinIcon.SERVER.create());
        url.setRequired(true);
        url.addClassName("mono");
        detected.addClassNames("bp-xs", "bp-ok");
        detected.setVisible(false);

        method.add(passwordTab, certTab, jwtTab);
        method.addThemeVariants(TabsVariant.AURA_FILLED);
        method.setWidthFull();
        method.getElement().setAttribute("aria-label", "Authentication method");

        username.setWidthFull();
        username.setValue("admin");
        username.setAutocomplete(com.vaadin.flow.component.textfield.Autocomplete.USERNAME);
        password.setWidthFull();
        password.setAutocomplete(com.vaadin.flow.component.textfield.Autocomplete.CURRENT_PASSWORD);
        passwordFields.add(username, password);

        Upload upload = new Upload(UploadHandler.inMemory((meta, data) -> {
            p12 = data;
        }));
        upload.setMaxFiles(1);
        upload.setDropLabel(new Span("Drop a PKCS#12 (.p12/.pfx) client certificate"));
        upload.addFileRemovedListener(e -> p12 = null);
        upload.setWidthFull();
        p12Password.setWidthFull();
        Div certNote = Ui.callout(null, new Span("This server presents the uploaded certificate to "),
                new Code("/edge/management/v1/authenticate?method=cert"), new Span(" (or OIDC "),
                new Code("/oidc/login/cert"), new Span(") over mutual TLS. It is held only in this session's memory."));
        certFields.add(certNote, upload, p12Password);
        certFields.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "8px");

        extJwt.setWidthFull();
        extJwt.setPlaceholder("eyJhbGciOi...");
        extJwt.addClassName("mono");
        extJwt.setMinRows(3);

        trustAll.setValue(ziti.isTrustAllCertificates());
        trustAll.setTooltipText("Needed for a controller using its own PKI that this server's JVM does not trust.");
        trustAll.addValueChangeListener(e -> ziti.setTrustAllCertificates(e.getValue()));

        method.addSelectedChangeListener(e -> showMethod());

        signIn.addThemeVariants(ButtonVariant.PRIMARY, ButtonVariant.LARGE);
        signIn.addClassName("wide");
        signIn.addClickShortcut(Key.ENTER);
        signIn.addClickListener(e -> login());

        Div divider = new Div("or");
        divider.addClassName("bp-divider");

        Button demo = new Button("Launch Interactive Demo Sandbox (No Controller Required)", VaadinIcon.PLAY.create());
        demo.addClassName("bp-demo-button");
        demo.addClickListener(e -> {
            ziti.enableDemoMode();
            Toast.info("Interactive Demo Sandbox Enabled",
                    "Explore the Access Canvas, drag & drop cards, and test the end-to-end Service Wizard.");
            UI.getCurrent().navigate("access-canvas");
        });

        remember.setTooltipText("Saves the URL, certificate setting, method and username in this browser. "
                + "Passwords, certificates and tokens are never saved.");
        savedList.addClassName("bp-saved-ctrls");
        savedList.setVisible(false);
        url.addValueChangeListener(e -> {
            if (e.isFromClient()) {
                detected.setVisible(false);
            }
            renderSaved();
        });
        url.addBlurListener(e -> probe(url.getValue()));

        Div urlRow = new Div(url, detected);
        Div checks = new Div(trustAll, remember);
        checks.addClassName("bp-login-checks");
        body.add(savedList, urlRow, method, passwordFields, certFields, extJwt, checks, signIn, divider, demo);

        Div foot = new Div("Baked Pasta Console v" + Brand.VERSION + " · Vaadin edition");
        foot.addClassNames("bp-xs", "bp-muted", "bp-mono");
        foot.getStyle().set("text-align", "center").set("padding", "0 24px 16px");

        card.add(head, body, foot);
        add(card);
        showMethod();
    }

    private void showMethod() {
        Tab t = method.getSelectedTab();
        passwordFields.setVisible(t == passwordTab);
        certFields.setVisible(t == certTab);
        extJwt.setVisible(t == jwtTab);
    }

    private String methodId() {
        Tab t = method.getSelectedTab();
        return t == certTab ? "cert" : t == jwtTab ? "ext-jwt" : "password";
    }

    private void login() {
        String target = url.getValue().trim();
        if (target.isEmpty()) {
            url.setInvalid(true);
            url.setErrorMessage("Enter the controller URL");
            return;
        }
        String m = methodId();
        try {
            if (m.equals("cert")) {
                if (p12 == null) {
                    Toast.warning("Choose a client certificate", "Upload a PKCS#12 (.p12/.pfx) file first.");
                    return;
                }
                ziti.loadClientCertificate(p12, p12Password.getValue().toCharArray());
            } else {
                ziti.clearClientCertificate();
            }
            ziti.login(target, m, username.getValue(), password.getValue(), extJwt.getValue());
            password.clear();
            if (remember.getValue()) {
                store(SavedControllers.remember(saved, new Saved(target, trustAll.getValue(), m, username.getValue(),
                        System.currentTimeMillis())));
            }
            Toast.success("Connected to Controller", target);
            UI.getCurrent().navigate("access-canvas");
        } catch (RuntimeException e) {
            Toast.error("Authentication failed", ZitiException.text(e));
        }
    }

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        String current = ziti.savedControllerUrl();
        url.setValue(current == null ? "" : current);
        ziti.consumeFirstVisit();
        probe(current);
    }

    @Override
    protected void onAttach(AttachEvent event) {
        super.onAttach(event);
        WebStorage.getItem(SavedControllers.STORAGE_KEY, value -> {
            saved = SavedControllers.parse(value);
            // Without a controller already chosen this session, start from the most recent one.
            if (!saved.isEmpty() && !ziti.isAuthenticated() && saved.stream()
                    .noneMatch(s -> s.url().equalsIgnoreCase(SavedControllers.normalize(url.getValue())))) {
                use(saved.getFirst());
            } else {
                renderSaved();
            }
        });
    }

    /** Fills the form from a saved controller (never a password). */
    void use(Saved s) {
        url.setValue(s.url());
        trustAll.setValue(s.trustAll());
        method.setSelectedTab(s.method().equals("cert") ? certTab : s.method().equals("ext-jwt") ? jwtTab : passwordTab);
        if (s.method().equals("password") && !s.username().isEmpty()) {
            username.setValue(s.username());
        }
        password.clear();
        renderSaved();
        probe(s.url());
        (s.method().equals("password") ? password : s.method().equals("ext-jwt") ? extJwt : p12Password).focus();
    }

    private void store(List<Saved> next) {
        saved = next;
        WebStorage.setItem(SavedControllers.STORAGE_KEY, SavedControllers.write(next));
        renderSaved();
    }

    private void renderSaved() {
        savedList.removeAll();
        savedList.setVisible(!saved.isEmpty());
        if (saved.isEmpty()) {
            return;
        }
        Span label = new Span("Saved controllers");
        label.addClassNames("bp-xs", "bp-muted");
        savedList.add(label);
        String current = SavedControllers.normalize(url.getValue());
        Div chips = new Div();
        chips.addClassName("bp-saved-chips");
        for (Saved s : saved) {
            Button pick = new Button(s.host());
            pick.addClassName("bp-saved-chip");
            pick.addThemeVariants(ButtonVariant.SMALL);
            String how = switch (s.method()) {
                case "cert" -> "client certificate";
                case "ext-jwt" -> "external JWT";
                default -> s.username().isEmpty() ? "password" : s.username();
            };
            pick.setTooltipText(s.url() + " · " + how + (s.trustAll() ? " · self-signed accepted" : ""));
            if (s.url().equalsIgnoreCase(current)) {
                pick.addThemeVariants(ButtonVariant.PRIMARY);
            }
            pick.addClickListener(e -> use(s));
            Button forget = new Button(VaadinIcon.CLOSE_SMALL.create());
            forget.addThemeVariants(ButtonVariant.SMALL, ButtonVariant.TERTIARY);
            forget.addClassName("bp-saved-forget");
            forget.setAriaLabel("Forget " + s.url());
            forget.setTooltipText("Forget " + s.host());
            forget.addClickListener(e -> store(SavedControllers.forget(saved, s.url())));
            Div chip = new Div(pick, forget);
            chip.addClassName("bp-saved-item");
            chips.add(chip);
        }
        savedList.add(chips);
    }

    /** Checks the controller in the background so a slow or absent one never blocks the page. */
    private void probe(String target) {
        String t = target == null ? "" : target.trim();
        detected.setVisible(false);
        if (t.isEmpty()) {
            return;
        }
        UI ui = UI.getCurrent();
        if (ui == null) {
            show(t, ziti.probeController(t));
            return;
        }
        Thread.startVirtualThread(() -> {
            ZitiService.Probe p = ziti.probeController(t);
            ui.access(() -> show(t, p));
        });
    }

    private void show(String target, ZitiService.Probe p) {
        if (!SavedControllers.normalize(target).equalsIgnoreCase(SavedControllers.normalize(url.getValue()))) {
            return; // the URL changed while probing
        }
        detected.setVisible(true);
        detected.removeClassNames("bp-ok", "bp-bad");
        if (p.online()) {
            detected.addClassName("bp-ok");
            detected.setText("● Controller detected (" + p.version() + (p.oidc() ? ", OIDC" : "") + ")");
        } else {
            detected.addClassName("bp-bad");
            detected.setText("● Not reachable: " + p.error());
        }
    }

    List<Saved> saved() {
        return saved;
    }
}
