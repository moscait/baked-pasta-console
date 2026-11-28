package io.moscait.bpc.views;

import java.util.ArrayList;
import java.util.List;

import io.moscait.bpc.ziti.ZitiException;
import io.moscait.bpc.ziti.ControllerSettings;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ziti.ZitiService;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.AnchorTarget;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.textfield.PasswordField;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;

@Route(value = "settings", layout = MainLayout.class)
@RouteAlias(value = "servers", layout = MainLayout.class)
@RouteAlias(value = "profile", layout = MainLayout.class)
@PageTitle("Settings")
public class SettingsView extends Div {

    private final ZitiService ziti;
    private final List<Div> schemeChoices = new ArrayList<>();
    private final Div session = new Div();
    private final Div ipKey = new Div();

    public SettingsView(ZitiService ziti) {
        this.ziti = ziti;
        Div page = Ui.page(Ui.pageHeader("Console & Controller Settings",
                "Configure your OpenZiti Edge Controller connection, theme preference, and Demo Sandbox."));
        page.addClassName("narrow");
        page.add(appearance(), controller(), ipGeo(), zacReference());
        add(page);
    }

    private Component appearance() {
        Div group = new Div();
        group.addClassName("bp-choice-group");
        group.getElement().setAttribute("role", "radiogroup");
        group.getElement().setAttribute("aria-label", "Color scheme");
        String[][] opts = { { "system", "System Default" }, { "light", "Light Mode" }, { "dark", "Dark Mode" } };
        VaadinIcon[] icons = { VaadinIcon.DESKTOP, VaadinIcon.SUN_O, VaadinIcon.MOON_O };
        for (int i = 0; i < opts.length; i++) {
            String id = opts[i][0];
            Div c = new Div(icons[i].create(), new Span(opts[i][1]));
            c.addClassName("bp-choice");
            c.getElement().setAttribute("role", "radio");
            c.getElement().setAttribute("tabindex", "0");
            c.getElement().setAttribute("data-id", id);
            c.addClickListener(e -> {
                ziti.setColorScheme(id);
                MainLayout.applyColorScheme(UI.getCurrent(), id);
                markScheme();
            });
            schemeChoices.add(c);
            group.add(c);
        }
        markScheme();
        return Ui.card("Appearance & Color Scheme",
                "Follow your operating system's light/dark preference automatically or pin an explicit scheme.", group);
    }

    private void markScheme() {
        for (Div c : schemeChoices) {
            c.getElement().setAttribute("aria-checked",
                    String.valueOf(c.getElement().getAttribute("data-id").equals(ziti.colorScheme())));
        }
    }

    private Component controller() {
        Select<String> url = new Select<>();
        url.setItems(ziti.controllers());
        url.setValue(ziti.savedControllerUrl());
        url.setEmptySelectionAllowed(false);
        url.addClassName("mono");
        url.getStyle().set("flex", "1").set("min-width", "16rem");
        url.setAriaLabel("Controller");
        Button save = Ui.primary("Use This Controller", null, () -> {
            try {
                ziti.saveControllerUrl(url.getValue());
                Toast.success("Controller selected", url.getValue() + (ziti.isDemoMode() ? " (used on next sign-in)" : ""));
            } catch (ZitiException e) {
                Toast.error("Not a configured controller", e.getMessage());
            }
        });
        if (ziti.controllers().size() == 1) {
            url.setReadOnly(true);
            save.setVisible(false);
        }
        Div policy = new Div(Ui.muted("Only the controllers set in " + ControllerSettings.PROPERTY
                + " on this server can be used. Certificates: " + ziti.certificatePolicy()));
        policy.addClassName("bp-small");

        Div body = new Div(Ui.toolbar(url, save), policy, session);
        body.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "var(--vaadin-gap-m)");
        refreshSession();
        return Ui.card("OpenZiti Edge Controller",
                "This server signs in to the controller for you and keeps the session token in server memory; "
                        + "the browser only holds the Vaadin session cookie.",
                body);
    }

    private void refreshSession() {
        session.removeAll();
        if (ziti.isDemoMode()) {
            Div text = new Div(Ui.strong("Interactive Demo Sandbox Active"), new Div(Ui.muted(
                    "Reset the sample zero-trust network (Identities, Services, Routers, Policies, and Canvas Layout) back to defaults.")));
            Button reset = Ui.button("Reset Demo Data", VaadinIcon.ROTATE_LEFT, () -> {
                ziti.resetDemoStore();
                Toast.success("Demo Sandbox Reset", "Restored initial OpenZiti sample entities.");
            });
            Div box = Ui.callout(null, text, reset);
            box.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("justify-content", "space-between")
                    .set("align-items", "center").set("gap", "12px");
            session.add(box);
        } else {
            String mode = switch (String.valueOf(ziti.authMode())) {
                case "oidc" -> "OIDC (access token with refresh)";
                case "cert" -> "Client certificate (" + ziti.clientCertSubject() + ")";
                default -> "Legacy zt-session token";
            };
            Div box = Ui.callout("ok", new Div(Ui.strong("Signed in to " + ziti.controllerHost())),
                    new Div(new Span("Controller " + ziti.controllerVersion + " · " + mode)),
                    new Div(new Span("Session expires: " + (ziti.expiresAt() == null ? "not reported"
                            : Ui.dateTime(ziti.expiresAt()) + " (" + Ui.relative(ziti.expiresAt()) + ")"))));
            session.add(box);
        }
    }

    private Component ipGeo() {
        Paragraph p1 = new Paragraph();
        Anchor link = new Anchor("https://ipgeolocation.io/", "ipgeolocation.io");
        link.setTarget(AnchorTarget.BLANK);
        p1.add(new Span("With an "), link, new Span(" API key, the Network Map can suggest where unplaced identities are "
                + "from the IP of their latest API session. Only the first three octets (IPv4) or 48 bits (IPv6) are sent; "
                + "private addresses are never sent. Suggestions stay unsaved until you review and save them."));
        p1.addClassNames("bp-small", "bp-muted");
        Paragraph p2 = new Paragraph("The key is kept in this server session only (not on the controller), so each admin "
                + "uses their own. This server sends it to ipgeolocation.io with each lookup.");
        p2.addClassNames("bp-small", "bp-muted");
        refreshIpKey();
        return Ui.card("Network Map: suggest locations from IP (optional)", null, p1, p2, ipKey);
    }

    private void refreshIpKey() {
        ipKey.removeAll();
        if (ziti.ipGeoKey() != null) {
            Span saved = Ui.chip("Key saved for this session ••••••••", null);
            Button remove = Ui.button("Remove key", VaadinIcon.TRASH, () -> {
                ziti.setIpGeoKey(null);
                Toast.info("IP geolocation key removed", "Removed from this session.");
                refreshIpKey();
            });
            ipKey.add(Ui.toolbar(saved, remove));
        } else {
            PasswordField f = new PasswordField();
            f.setPlaceholder("ipgeolocation.io API key");
            f.setAriaLabel("ipgeolocation.io API key");
            f.getStyle().set("flex", "1").set("min-width", "16rem");
            Button save = Ui.primary("Save key", null, () -> {
                if (f.getValue().isBlank()) {
                    return;
                }
                ziti.setIpGeoKey(f.getValue());
                Toast.success("IP geolocation key saved", "Use \"Suggest from IP\" in the Network Map's Locations tab.");
                refreshIpKey();
            });
            ipKey.add(Ui.toolbar(f, save));
        }
    }

    private Component zacReference() {
        Paragraph p = new Paragraph();
        p.addClassNames("bp-small", "bp-muted");
        p.add(new Span("This Vaadin edition runs as its own server. The browser build of the console can still be served "
                + "by the controller itself: build it with "), new Code("./build.sh /zac/"),
                new Span(" and point the controller's "), new Code("zac"), new Span(" binding at the generated assets:"));
        return Ui.card("Hosting the web build from an OpenZiti Controller (zac binding)", null, p, Ui.pre("""
                web:
                  - name: client-management
                    bindPoints:
                      - interface: 0.0.0.0:1280
                        address: 0.0.0.0:1280
                    apis:
                      - binding: edge-management
                        options: {}
                      - binding: edge-client
                        options: {}
                      - binding: zac
                        options:
                          location: /opt/openziti/share/console
                          indexFile: index.html"""));
    }
}
