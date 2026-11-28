package io.moscait.bpc.views;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.ui.EntityGrid;
import io.moscait.bpc.ui.FormDialog;
import io.moscait.bpc.ui.JwtPanel;
import io.moscait.bpc.ui.MainLayout;
import io.moscait.bpc.ui.TabSwitch;
import io.moscait.bpc.ui.Toast;
import io.moscait.bpc.ui.Ui;
import io.moscait.bpc.ui.ZitiView;
import io.moscait.bpc.ziti.FormValues;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiException;
import io.moscait.bpc.ziti.ZitiService;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.checkbox.CheckboxGroup;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.radiobutton.RadioButtonGroup;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.component.upload.Upload;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.router.RouteAlias;
import com.vaadin.flow.server.streams.UploadHandler;

/** Certificate authorities, authentication policies and external JWT signers. */
@Route(value = "certificate-authorities", layout = MainLayout.class)
@RouteAlias(value = "auth-policies", layout = MainLayout.class)
@RouteAlias(value = "jwt-signers", layout = MainLayout.class)
@PageTitle("Authentication")
public class AuthenticationView extends ZitiView implements BeforeEnterObserver {

    /** The controller rejects passwords shorter than this regardless of policy. */
    static final int MIN_PASSWORD_LENGTH = 5;
    static final String DEFAULT_IDENTITY_NAME_FORMAT = "[caName]-[commonName]";

    private final TabSwitch tabs = new TabSwitch();
    private final EntityGrid caGrid = new EntityGrid("Certificate Authorities");
    private final EntityGrid policyGrid = new EntityGrid("Authentication Policies");
    private final EntityGrid signerGrid = new EntityGrid("External JWT Signers");
    private List<Map<String, Object>> policies = List.of();
    private List<Map<String, Object>> signers = List.of();

    public AuthenticationView(ZitiService ziti) {
        super(ziti);
        caGrid.name("Certificate Authority");
        caGrid.component("Verified", r -> Json.bool(r, "isVerified") ? "Verified" : "Unverified",
                r -> Json.bool(r, "isVerified") ? Ui.chip("Verified", "ok") : Ui.chip("Unverified", "warn"));
        caGrid.text("Auto-Enrollment", r -> Json.bool(r, "isAutoCaEnrollmentEnabled") ? "Enabled" : "Disabled");
        caGrid.onCreate("New CA", () -> openCa(null));
        caGrid.onEdit(this::openCa);
        caGrid.onDelete(r -> remove("cas", "Certificate authority", r));
        caGrid.extraActions(r -> {
            List<Component> out = new ArrayList<>();
            if (!Json.bool(r, "isVerified")) {
                out.add(Ui.iconButton(VaadinIcon.CHECK_CIRCLE, "Verify: prove possession of the CA's private key",
                        () -> openVerify(r)));
            }
            out.add(Ui.iconButton(VaadinIcon.KEY, "Enrollment JWT for devices with certificates from this CA",
                    () -> openCaJwt(r)));
            return out;
        });

        policyGrid.name("Auth Policy Name");
        policyGrid.text("Client Cert", r -> allowed(r, "primary.cert.allowed"));
        policyGrid.text("Password (UPDB)", r -> allowed(r, "primary.updb.allowed"));
        policyGrid.text("External JWT / OIDC", r -> allowed(r, "primary.extJwt.allowed"));
        policyGrid.onCreate("New Auth Policy", () -> openPolicy(null));
        policyGrid.onEdit(this::openPolicy);
        policyGrid.onDelete(r -> remove("auth-policies", "Auth policy", r));

        signerGrid.name("JWT Signer Name");
        signerGrid.component("OIDC Issuer", r -> Json.str(r, "issuer"), r -> Ui.mono(Json.strOr(r, "issuer", "")));
        signerGrid.component("Audience", r -> Json.str(r, "audience"), r -> Ui.mono(Json.strOr(r, "audience", "")));
        signerGrid.component("Status", r -> enabled(r) ? "Enabled" : "Disabled",
                r -> enabled(r) ? Ui.chip("Enabled", "ok") : Ui.chip("Disabled", null));
        signerGrid.onCreate("New JWT Signer", () -> openSigner(null));
        signerGrid.onEdit(this::openSigner);
        signerGrid.onDelete(r -> remove("external-jwt-signers", "JWT signer", r));

        tabs.add("certificate-authorities", "Certificate Authorities", caGrid)
                .add("auth-policies", "Auth Policies", policyGrid).add("jwt-signers", "External JWT Signers", signerGrid);
        add(Ui.page(Ui.pageHeader("Authentication & PKI",
                "Third-party Certificate Authorities, Authentication Policies, and External OIDC / JWT Signers."),
                tabs.tabs(), tabs.content()));
    }

    private static String allowed(Map<String, Object> r, String path) {
        return Json.bool(r, path) ? "Allowed" : "Disabled";
    }

    private static boolean enabled(Map<String, Object> r) {
        return !Boolean.FALSE.equals(Json.boolOrNull(r, "enabled"));
    }

    private void remove(String collection, String label, Map<String, Object> r) {
        ziti.remove(collection, Json.str(r, "id"));
        Toast.info(label + " deleted", Json.str(r, "name"));
    }

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        tabs.select(TabSwitch.firstSegment(event));
    }

    @Override
    protected void reload() {
        List<Map<String, Object>> cas = ziti.list("cas");
        policies = ziti.list("auth-policies");
        signers = ziti.list("external-jwt-signers");
        caGrid.setRows(cas);
        policyGrid.setRows(policies);
        signerGrid.setRows(signers);
        tabs.count("certificate-authorities", cas.size());
        tabs.count("auth-policies", policies.size());
        tabs.count("jwt-signers", signers.size());
    }

    private static boolean def(Map<String, Object> r, String path, boolean fallback) {
        Boolean b = r == null ? null : Json.boolOrNull(r, path);
        return b == null ? fallback : b;
    }

    private static String val(Map<String, Object> r, String path, String fallback) {
        if (r == null) {
            return fallback;
        }
        Object v = Json.path(r, path);
        if (v instanceof Number n) {
            return String.valueOf(n.longValue());
        }
        return v == null || String.valueOf(v).isEmpty() ? fallback : String.valueOf(v);
    }

    private static int whole(TextField f, String label, int min, int max, Integer fallback, List<String> errors) {
        try {
            return FormValues.parseWholeNumber(f.getValue(), label, min, max, fallback);
        } catch (IllegalArgumentException e) {
            errors.add(e.getMessage());
            return fallback == null ? min : fallback;
        }
    }

    private static String optional(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }

    // ------------------------------------------------------------------ certificate authorities

    private void openCa(Map<String, Object> editing) {
        boolean isNew = editing == null;
        Map<String, Object> claim = isNew ? null : Json.obj(editing, "externalIdClaim");
        if (claim != null && claim.isEmpty()) {
            claim = null;
        }
        TextField name = FormDialog.text("Name", val(editing, "name", ""), null, null);
        TextArea pem = FormDialog.area("CA certificate (PEM)", "",
                "After creating it, verify the CA to prove you hold its private key.", true);
        pem.setPlaceholder("-----BEGIN CERTIFICATE-----");
        Checkbox auth = FormDialog.check("Authentication enabled", def(editing, "isAuthEnabled", true),
                "Certificates signed by this CA may authenticate.");
        Checkbox auto = FormDialog.check("Auto CA enrollment", def(editing, "isAutoCaEnrollmentEnabled", true),
                "A device with a certificate from this CA creates its own identity on first contact.");
        Checkbox ott = FormDialog.check("One-time token CA enrollment", def(editing, "isOttCaEnrollmentEnabled", true),
                "Pre-created identities may enroll with a one-time token plus a certificate from this CA.");
        TextField roles = FormDialog.text("Identity roles",
                isNew ? "" : String.join(", ", Json.strings(editing, "identityRoles")), null,
                "Role attributes given to identities that auto-enroll.");
        TextField nameFormat = FormDialog.text("Identity name format",
                val(editing, "identityNameFormat", DEFAULT_IDENTITY_NAME_FORMAT), null,
                "Placeholders: [caName], [caId], [commonName], [identityId], [requestedName].");
        nameFormat.addClassName("mono");

        Checkbox useClaim = FormDialog.check("Read an external ID from the certificate", claim != null,
                "Matches the identity whose external ID equals the extracted value.");
        Select<String> location = FormDialog.select("Location", List.of("COMMON_NAME", "SAN_URI", "SAN_EMAIL"),
                val(claim, "location", "COMMON_NAME"), null);
        Select<String> matcher = FormDialog.select("Matcher", List.of("ALL", "PREFIX", "SUFFIX", "SCHEME"),
                val(claim, "matcher", "ALL"), null);
        TextField matchCriteria = FormDialog.text("Match criteria", val(claim, "matcherCriteria", ""), null, null);
        Select<String> parser = FormDialog.select("Parser", List.of("NONE", "SPLIT"), val(claim, "parser", "NONE"), null);
        TextField separator = FormDialog.text("Separator", val(claim, "parserCriteria", ""), null, null);
        TextField index = FormDialog.text("Index", val(claim, "index", "0"), null, null);
        var claimGrid = FormDialog.grid(location, matcher, matchCriteria, parser, separator, index);
        Runnable sync = () -> {
            claimGrid.setVisible(useClaim.getValue());
            matchCriteria.setEnabled(!"ALL".equals(matcher.getValue()));
            separator.setEnabled("SPLIT".equals(parser.getValue()));
        };
        useClaim.addValueChangeListener(e -> sync.run());
        matcher.addValueChangeListener(e -> sync.run());
        parser.addValueChangeListener(e -> sync.run());
        sync.run();

        FormDialog d = new FormDialog(isNew ? "Create Certificate Authority" : "Edit CA: " + Json.str(editing, "name"),
                isNew ? "Create CA" : "Save changes", true, errors -> {
                    if (name.getValue().isBlank()) {
                        errors.add("Name is required.");
                    }
                    if (isNew && !FormValues.looksLikePemCertificate(pem.getValue())) {
                        errors.add("Paste the CA certificate in PEM format.");
                    }
                    if (nameFormat.getValue().isBlank()) {
                        errors.add("Identity name format is required.");
                    }
                    Map<String, Object> claimBody = null;
                    if (useClaim.getValue()) {
                        if (!"ALL".equals(matcher.getValue()) && matchCriteria.getValue().isBlank()) {
                            errors.add("Matcher " + matcher.getValue() + " needs match criteria.");
                        }
                        if ("SPLIT".equals(parser.getValue()) && separator.getValue().isEmpty()) {
                            errors.add("The SPLIT parser needs a separator.");
                        }
                        int idx = whole(index, "Claim index", 0, Integer.MAX_VALUE, 0, errors);
                        claimBody = Json.map("location", location.getValue(), "matcher", matcher.getValue(),
                                "matcherCriteria", "ALL".equals(matcher.getValue()) ? "" : matchCriteria.getValue().trim(),
                                "parser", parser.getValue(), "parserCriteria",
                                "SPLIT".equals(parser.getValue()) ? separator.getValue() : "", "index", idx);
                    }
                    if (!errors.isEmpty()) {
                        return;
                    }
                    Map<String, Object> body = Json.map("name", name.getValue().trim());
                    if (isNew) {
                        body.put("certPem", pem.getValue().trim());
                    }
                    body.put("identityRoles", FormValues.splitList(roles.getValue()));
                    body.put("identityNameFormat", nameFormat.getValue().trim());
                    body.put("isAutoCaEnrollmentEnabled", auto.getValue());
                    body.put("isOttCaEnrollmentEnabled", ott.getValue());
                    body.put("isAuthEnabled", auth.getValue());
                    body.put("externalIdClaim", claimBody);
                    if (isNew) {
                        ziti.create("cas", body);
                    } else {
                        ziti.patch("cas", Json.str(editing, "id"), body);
                    }
                    Toast.success(isNew ? "Certificate authority created" : "Certificate authority updated",
                            name.getValue().trim());
                });
        Component certField = isNew ? pem
                : Ui.callout(null, "The certificate can't be changed. Delete and recreate the CA to use a different one.");
        d.fields(name, certField,
                FormDialog.section("Identities from this CA", auth, auto, ott, roles, nameFormat),
                FormDialog.section("External ID claim", useClaim, claimGrid));
        d.open();
        name.focus();
    }

    static String verifyInstructions(Map<String, Object> ca) {
        String token = Json.strOr(ca, "verificationToken", "<verificationToken>");
        return String.join("\n",
                "# Sign a certificate whose common name is the CA's verification token, using the CA's own key:",
                "openssl req -new -newkey rsa:2048 -nodes -keyout verify.key -subj \"/CN=" + token + "\" -out verify.csr",
                "openssl x509 -req -in verify.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 1 -out verify.pem");
    }

    private void openVerify(Map<String, Object> ca) {
        TextArea pem = FormDialog.area("Verification certificate (PEM)", "", null, true);
        pem.setPlaceholder("-----BEGIN CERTIFICATE-----");
        pem.setWidthFull();
        Upload upload = new Upload(UploadHandler.inMemory((meta, bytes) -> {
            String text = new String(bytes, StandardCharsets.UTF_8);
            pem.getUI().ifPresent(ui -> ui.access(() -> pem.setValue(text)));
        }));
        upload.setDropLabel(new Span("…or drop a .pem / .crt file"));
        upload.setMaxFiles(1);
        FormDialog d = new FormDialog("Verify CA: " + Json.str(ca, "name"), "Verify", true, errors -> {
            ziti.verifyCa(ca, pem.getValue());
            Toast.success("Certificate authority verified", Json.str(ca, "name"));
        });
        Paragraph lead = new Paragraph(new Span("Sign a certificate with this CA's private key, using the verification token "),
                new Code(Json.strOr(ca, "verificationToken", "?")), new Span(" as its common name, then upload it."));
        lead.addClassNames("bp-muted", "bp-small");
        d.fields(lead, Ui.pre(verifyInstructions(ca)), pem, upload);
        d.open();
        pem.focus();
    }

    private void openCaJwt(Map<String, Object> ca) {
        Dialog d = new Dialog();
        d.setHeaderTitle("CA enrollment JWT: " + Json.str(ca, "name"));
        d.setWidth("min(640px, 96vw)");
        d.getHeader().add(Ui.iconButton(VaadinIcon.CLOSE, "Close", d::close));
        Paragraph lead = new Paragraph("Devices holding a certificate from this CA enroll with this token.");
        lead.addClassNames("bp-muted", "bp-small");
        d.add(lead);
        try {
            String jwt = ziti.caEnrollmentJwt(ca);
            d.add(new JwtPanel(jwt, Json.str(ca, "name") + ".jwt", null));
        } catch (RuntimeException e) {
            d.add(Ui.callout("error", ZitiException.text(e)));
        }
        d.open();
    }

    // ------------------------------------------------------------------ auth policies

    private void openPolicy(Map<String, Object> editing) {
        boolean isNew = editing == null;
        TextField name = FormDialog.text("Name", val(editing, "name", ""), null, null);

        Checkbox certAllowed = FormDialog.check("Allowed", def(editing, "primary.cert.allowed", true), null);
        Checkbox certExpired = FormDialog.check("Allow expired certificates",
                def(editing, "primary.cert.allowExpiredCerts", true),
                "Lets a device with an expired certificate sign in to extend it.");

        Checkbox updb = FormDialog.check("Allowed", def(editing, "primary.updb.allowed", true), null);
        TextField minLen = FormDialog.text("Minimum length",
                val(editing, "primary.updb.minPasswordLength", String.valueOf(MIN_PASSWORD_LENGTH)), null, null);
        Checkbox mixed = FormDialog.check("Require mixed case", def(editing, "primary.updb.requireMixedCase", false), null);
        Checkbox number = FormDialog.check("Require a number", def(editing, "primary.updb.requireNumberChar", false), null);
        Checkbox symbol = FormDialog.check("Require a symbol", def(editing, "primary.updb.requireSpecialChar", false), null);
        TextField attempts = FormDialog.text("Max attempts", val(editing, "primary.updb.maxAttempts", "0"), null,
                "0 = unlimited.");
        TextField lockout = FormDialog.text("Lockout (minutes)", val(editing, "primary.updb.lockoutDurationMinutes", "0"),
                null, "How long an identity is locked out after too many failures.");

        Checkbox extJwt = FormDialog.check("Allowed", def(editing, "primary.extJwt.allowed", true), null);
        CheckboxGroup<String> allowedSigners = new CheckboxGroup<>("Allowed signers");
        allowedSigners.setItems(signers.stream().map(s -> Json.str(s, "id")).toList());
        allowedSigners.setItemLabelGenerator(this::signerName);
        allowedSigners.setValue(new java.util.HashSet<>(isNew ? List.of() : Json.strings(editing, "primary.extJwt.allowedSigners")));
        if (signers.isEmpty()) {
            allowedSigners.setHelperText("No external JWT signers exist yet.");
        }

        Checkbox totp = FormDialog.check("Require TOTP (MFA)", def(editing, "secondary.requireTotp", false), null);
        Select<String> requireJwt = FormDialog.entitySelect("Require a JWT from", signers,
                val(editing, "secondary.requireExtJwtSigner", ""), "No additional JWT");

        Runnable sync = () -> {
            certExpired.setEnabled(certAllowed.getValue());
            for (Component c : List.of(minLen, mixed, number, symbol, attempts, lockout)) {
                ((com.vaadin.flow.component.HasEnabled) c).setEnabled(updb.getValue());
            }
            allowedSigners.setEnabled(extJwt.getValue());
        };
        certAllowed.addValueChangeListener(e -> sync.run());
        updb.addValueChangeListener(e -> sync.run());
        extJwt.addValueChangeListener(e -> sync.run());
        sync.run();

        FormDialog d = new FormDialog(isNew ? "Create Auth Policy" : "Edit Auth Policy: " + Json.str(editing, "name"),
                isNew ? "Create policy" : "Save changes", true, errors -> {
                    if (name.getValue().isBlank()) {
                        errors.add("Name is required.");
                    }
                    if (!certAllowed.getValue() && !updb.getValue() && !extJwt.getValue()) {
                        errors.add("Allow at least one primary sign-in method, or identities on this policy can never sign in.");
                    }
                    int min = whole(minLen, "Minimum password length", MIN_PASSWORD_LENGTH, 1024, null, errors);
                    int max = whole(attempts, "Max attempts", 0, Integer.MAX_VALUE, 0, errors);
                    int lock = whole(lockout, "Lockout duration", 0, Integer.MAX_VALUE, 0, errors);
                    if (!errors.isEmpty()) {
                        return;
                    }
                    List<String> signerIds = extJwt.getValue()
                            ? signers.stream().map(s -> Json.str(s, "id")).filter(allowedSigners.getValue()::contains).toList()
                            : List.of();
                    Map<String, Object> body = Json.map("name", name.getValue().trim(), "primary", Json.map(
                            "cert", Json.map("allowed", certAllowed.getValue(), "allowExpiredCerts", certExpired.getValue()),
                            "updb", Json.map("allowed", updb.getValue(), "minPasswordLength", min, "requireMixedCase",
                                    mixed.getValue(), "requireNumberChar", number.getValue(), "requireSpecialChar",
                                    symbol.getValue(), "maxAttempts", max, "lockoutDurationMinutes", lock),
                            "extJwt", Json.map("allowed", extJwt.getValue(), "allowedSigners", new ArrayList<>(signerIds))),
                            "secondary", Json.map("requireTotp", totp.getValue(), "requireExtJwtSigner",
                                    optional(requireJwt.getValue())));
                    if (isNew) {
                        ziti.create("auth-policies", body);
                    } else {
                        ziti.patch("auth-policies", Json.str(editing, "id"), body);
                    }
                    Toast.success(isNew ? "Auth policy created" : "Auth policy updated", name.getValue().trim());
                });
        d.fields(name,
                FormDialog.grid(FormDialog.section("Certificate", certAllowed, certExpired),
                        FormDialog.section("Username / password", updb, minLen, mixed, number, symbol, attempts, lockout),
                        FormDialog.section("External JWT", extJwt, allowedSigners)),
                FormDialog.section("Secondary (second factor)", totp, requireJwt));
        d.open();
        name.focus();
    }

    private String signerName(String id) {
        return signers.stream().filter(s -> id.equals(s.get("id"))).map(s -> Json.strOr(s, "name", id)).findFirst().orElse(id);
    }

    // ------------------------------------------------------------------ external JWT signers

    private void openSigner(Map<String, Object> editing) {
        boolean isNew = editing == null;
        TextField name = FormDialog.text("Name", val(editing, "name", ""), null, null);
        Checkbox enabled = FormDialog.check("Enabled", def(editing, "enabled", true), null);
        TextField issuer = FormDialog.text("Issuer", val(editing, "issuer", ""), null, "Must equal the token's iss claim.");
        TextField audience = FormDialog.text("Audience", val(editing, "audience", ""), null,
                "Must appear in the token's aud claim.");
        issuer.addClassName("mono");
        audience.addClassName("mono");

        boolean certSource = !isNew && Json.str(editing, "certPem") != null && Json.str(editing, "jwksEndpoint") == null;
        RadioButtonGroup<String> keySource = new RadioButtonGroup<>();
        keySource.setItems("jwks", "cert");
        keySource.setItemLabelGenerator(s -> s.equals("jwks") ? "Fetch keys from a JWKS URL" : "Use a fixed certificate");
        keySource.setValue(certSource ? "cert" : "jwks");
        TextField jwks = FormDialog.text("JWKS endpoint", val(editing, "jwksEndpoint", ""),
                "https://idp.example.com/.well-known/jwks.json", null);
        jwks.addClassName("mono");
        TextArea certPem = FormDialog.area("Certificate (PEM)", val(editing, "certPem", ""), null, true);
        TextField kid = FormDialog.text("Key ID (kid)", val(editing, "kid", ""), null,
                "Optional; matched against the token header.");
        Runnable syncKey = () -> {
            boolean j = "jwks".equals(keySource.getValue());
            jwks.setVisible(j);
            certPem.setVisible(!j);
            kid.setVisible(!j);
        };
        keySource.addValueChangeListener(e -> syncKey.run());
        syncKey.run();

        TextField claims = FormDialog.text("Claims property", val(editing, "claimsProperty", "sub"), null,
                "The claim that names the identity, usually sub or email.");
        Checkbox useExternalId = FormDialog.check("Match external ID", def(editing, "useExternalId", false),
                "Off: the claim is an identity ID.");

        TextField clientId = FormDialog.text("Client ID", val(editing, "clientId", ""), null, null);
        TextField scopes = FormDialog.text("Scopes", isNew ? "" : String.join(" ", Json.strings(editing, "scopes")), null,
                "Space or comma separated.");
        TextField authUrl = FormDialog.text("External auth URL", val(editing, "externalAuthUrl", ""), null,
                "Where clients send the user to sign in.");
        Select<String> target = FormDialog.select("Target token", List.of("ACCESS", "ID"),
                val(editing, "targetToken", "ACCESS"), t -> t.equals("ACCESS") ? "Access token" : "ID token");

        Checkbox toCert = FormDialog.check("Enroll to certificate", def(editing, "enrollToCertEnabled", false),
                "A valid token can create an identity that then receives a certificate.");
        Checkbox toToken = FormDialog.check("Enroll to token", def(editing, "enrollToTokenEnabled", false),
                "A valid token can create an identity that keeps signing in with tokens.");
        TextField nameSel = FormDialog.text("Name claim selector", val(editing, "enrollNameClaimsSelector", ""), null,
                "The claim that names the new identity.");
        TextField attrSel = FormDialog.text("Attribute claim selector", val(editing, "enrollAttributeClaimsSelector", ""),
                null, "The claim that lists its role attributes.");
        Select<String> enrollPolicy = FormDialog.entitySelect("Auth policy for new identities", policies,
                val(editing, "enrollAuthPolicyId", ""), "Controller default");
        var enrollGrid = FormDialog.grid(nameSel, attrSel, enrollPolicy);
        Runnable syncEnroll = () -> enrollGrid.setVisible(toCert.getValue() || toToken.getValue());
        toCert.addValueChangeListener(e -> syncEnroll.run());
        toToken.addValueChangeListener(e -> syncEnroll.run());
        syncEnroll.run();

        FormDialog d = new FormDialog(isNew ? "Create External JWT Signer" : "Edit JWT Signer: " + Json.str(editing, "name"),
                isNew ? "Create signer" : "Save changes", true, errors -> {
                    boolean j = "jwks".equals(keySource.getValue());
                    if (name.getValue().isBlank()) {
                        errors.add("Name is required.");
                    }
                    if (issuer.getValue().isBlank()) {
                        errors.add("Issuer is required.");
                    }
                    if (audience.getValue().isBlank()) {
                        errors.add("Audience is required.");
                    }
                    if (j && !FormValues.isHttpUrl(jwks.getValue())) {
                        errors.add("JWKS endpoint must be an http(s) URL.");
                    }
                    if (!j && !FormValues.looksLikePemCertificate(certPem.getValue())) {
                        errors.add("Paste the signing certificate in PEM format.");
                    }
                    if (!authUrl.getValue().isBlank() && !FormValues.isHttpUrl(authUrl.getValue())) {
                        errors.add("External auth URL must be an http(s) URL.");
                    }
                    if (claims.getValue().isBlank()) {
                        errors.add("Claims property is required (usually \"sub\").");
                    }
                    if (!errors.isEmpty()) {
                        return;
                    }
                    // Unset optional fields are sent as null so that clearing one in an edit really clears it.
                    Map<String, Object> body = Json.map("name", name.getValue().trim(), "issuer", issuer.getValue().trim(),
                            "audience", audience.getValue().trim(), "enabled", enabled.getValue(), "jwksEndpoint",
                            j ? jwks.getValue().trim() : null, "certPem", j ? null : certPem.getValue().trim(), "kid",
                            j ? null : optional(kid.getValue()), "claimsProperty", claims.getValue().trim(),
                            "useExternalId", useExternalId.getValue(), "clientId", optional(clientId.getValue()),
                            "scopes", new ArrayList<>(List.of(scopes.getValue().trim().split("[,\\s]+")).stream()
                                    .filter(s -> !s.isEmpty()).toList()),
                            "externalAuthUrl", optional(authUrl.getValue()), "targetToken", target.getValue(),
                            "enrollToCertEnabled", toCert.getValue(), "enrollToTokenEnabled", toToken.getValue(),
                            "enrollNameClaimsSelector", nameSel.getValue().trim(), "enrollAttributeClaimsSelector",
                            attrSel.getValue().trim(), "enrollAuthPolicyId",
                            enrollPolicy.getValue() == null ? "" : enrollPolicy.getValue());
                    if (isNew) {
                        ziti.create("external-jwt-signers", body);
                    } else {
                        ziti.patch("external-jwt-signers", Json.str(editing, "id"), body);
                    }
                    Toast.success(isNew ? "JWT signer created" : "JWT signer updated", name.getValue().trim());
                });
        d.fields(FormDialog.grid(name, enabled), FormDialog.grid(issuer, audience),
                FormDialog.section("Signing key", keySource, jwks, certPem, kid),
                FormDialog.section("Identity mapping", FormDialog.grid(claims, useExternalId)),
                FormDialog.section("Browser sign-in (OIDC)", FormDialog.grid(clientId, scopes, authUrl, target)),
                FormDialog.section("Enrollment from this signer", toCert, toToken, enrollGrid));
        d.open();
        name.focus();
    }
}
