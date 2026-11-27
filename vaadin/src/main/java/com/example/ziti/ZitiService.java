package com.example.ziti;

import static com.example.ziti.Json.map;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.CookieManager;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509ExtendedTrustManager;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;

import com.example.canvas.AcModel;
import com.example.canvas.AcModel.AcErPolicy;
import com.example.canvas.AcModel.AcIdentity;
import com.example.canvas.AcModel.AcLayout;
import com.example.canvas.AcModel.AcOp;
import com.example.canvas.AcModel.AcRouter;
import com.example.canvas.AcModel.AcSerp;
import com.example.canvas.AcModel.AcService;
import com.example.canvas.AcModel.AcServicePolicy;
import com.example.canvas.AcModel.AddAttr;
import com.example.canvas.AcModel.AddIdentityRole;
import com.example.canvas.AcModel.CreateConfig;
import com.example.canvas.AcModel.CreateErPolicy;
import com.example.canvas.AcModel.CreateIdentity;
import com.example.canvas.AcModel.CreatePolicy;
import com.example.canvas.AcModel.CreateSerp;
import com.example.canvas.AcModel.CreateService;
import com.example.canvas.AcModel.RemoveAttr;
import com.example.canvas.AccessLogic;
import com.example.sessions.SessionMonitor.ConcurrencyPolicy;
import com.example.sessions.SessionMonitor.RemediationStep;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.server.VaadinRequest;
import com.vaadin.flow.server.VaadinServletRequest;
import com.vaadin.flow.shared.Registration;
import com.vaadin.flow.spring.annotation.SpringComponent;
import com.vaadin.flow.spring.annotation.VaadinSessionScope;

/**
 * The OpenZiti Edge Management API client for one browser session, or the Demo Sandbox store
 * when demo mode is on. Server-side counterpart of the web console's {@code zitiService}: every
 * call goes from this server to the controller, so the browser never holds a controller token.
 */
@SpringComponent
@VaadinSessionScope
public class ZitiService {

    private static final Logger LOG = LoggerFactory.getLogger(ZitiService.class);

    public static final String DEMO_URL = "https://demo.openziti.local:1280";
    private static final String MGMT = "edge/management/v1";
    private static final String FABRIC = "fabric/v1";
    /** Refresh this long before the access token expires, to absorb clock skew and slow requests. */
    private static final long REFRESH_LEEWAY_MS = 60_000;
    private static final SecureRandom RANDOM = new SecureRandom();

    // ------------------------------------------------------------------ session state

    private String controllerUrl;
    private final List<String> knownControllers = new ArrayList<>();
    private boolean demoMode;
    private boolean firstVisit = true;
    private boolean trustAllCertificates;

    private String sessionToken;
    private String jwtToken;
    private String authMode;
    private String expiresAt;
    private String refreshToken;
    private Long refreshExpiresAt;
    private String oidcClientId;
    private String oidcTokenEndpoint;

    public String controllerVersion = "v1.3.2";
    public boolean oidcEnabled;
    private String edgeOidcPath = "/oidc";

    private SSLContext clientCertContext;
    private String clientCertSubject;
    private HttpClient http;

    private Map<String, Object> demoStore;
    private ConcurrencyPolicy concurrencyPolicy = new ConcurrencyPolicy();
    private final Map<String, AcLayout> layouts = new HashMap<>();
    private String ipGeoKey;

    private record Listener(UI ui, Runnable fn) {
    }

    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final List<Listener> policyListeners = new CopyOnWriteArrayList<>();

    public ZitiService(@Value("${ziti.controller-url:https://localhost:1280}") String defaultController,
            @Value("${ziti.trust-all-certificates:false}") boolean trustAll) {
        this.controllerUrl = trimUrl(defaultController);
        this.trustAllCertificates = trustAll;
    }

    // ------------------------------------------------------------------ listeners

    /** Runs {@code fn} (in that UI) whenever the user signs in/out, switches controller or changes data. */
    public Registration subscribe(Runnable fn) {
        Listener l = new Listener(UI.getCurrent(), fn);
        listeners.add(l);
        return () -> listeners.remove(l);
    }

    /** Notifies only concurrency-policy readers, so tuning thresholds never triggers full reloads. */
    public Registration subscribePolicy(Runnable fn) {
        Listener l = new Listener(UI.getCurrent(), fn);
        policyListeners.add(l);
        return () -> policyListeners.remove(l);
    }

    public void notifyChanged() {
        fire(listeners);
    }

    private void fire(List<Listener> list) {
        UI current = UI.getCurrent();
        for (Listener l : list) {
            if (l.ui == null || l.ui == current) {
                try {
                    l.fn.run();
                } catch (RuntimeException e) {
                    LOG.warn("Change listener failed", e);
                }
            } else if (l.ui.isAttached()) {
                l.ui.access(l.fn::run);
            }
        }
    }

    // ------------------------------------------------------------------ state accessors

    public boolean isAuthenticated() {
        return demoMode || sessionToken != null || jwtToken != null;
    }

    public boolean isDemoMode() {
        return demoMode;
    }

    /** True until the first time the shell decides between demo and sign-in for this session. */
    public boolean consumeFirstVisit() {
        boolean f = firstVisit;
        firstVisit = false;
        return f;
    }

    public String controllerUrl() {
        return demoMode ? DEMO_URL : controllerUrl;
    }

    /** The controller URL the user last chose, even while demo mode is on. */
    public String savedControllerUrl() {
        return controllerUrl;
    }

    public String controllerHost() {
        try {
            String host = URI.create(controllerUrl()).getAuthority();
            return host == null ? controllerUrl() : host;
        } catch (IllegalArgumentException e) {
            return controllerUrl();
        }
    }

    public List<String> knownControllers() {
        return List.copyOf(knownControllers);
    }

    public String authMode() {
        return demoMode ? "demo" : authMode;
    }

    public String expiresAt() {
        return expiresAt;
    }

    public boolean isTrustAllCertificates() {
        return trustAllCertificates;
    }

    public void setTrustAllCertificates(boolean trust) {
        if (trust != trustAllCertificates) {
            trustAllCertificates = trust;
            http = null;
        }
    }

    public String clientCertSubject() {
        return clientCertSubject;
    }

    /** Active legacy zt-session token, protected from self-termination on the Sessions page. */
    public String currentSessionToken() {
        if (jwtToken != null && !demoMode) {
            return null;
        }
        return demoMode ? "demo-session-token" : sessionToken;
    }

    public void saveControllerUrl(String url) {
        controllerUrl = trimUrl(url);
        http = null;
        notifyChanged();
    }

    private String colorScheme = "system";

    /** "light", "dark" or "system". */
    public String colorScheme() {
        return colorScheme;
    }

    public void setColorScheme(String scheme) {
        colorScheme = scheme;
    }

    public String ipGeoKey() {
        return ipGeoKey;
    }

    public void setIpGeoKey(String key) {
        ipGeoKey = key == null || key.isBlank() ? null : key.trim();
    }

    private static String trimUrl(String url) {
        return url == null ? "" : url.trim().replaceAll("/+$", "");
    }

    // ------------------------------------------------------------------ demo mode

    public void enableDemoMode() {
        if (demoStore == null) {
            demoStore = DemoStore.createInitial();
        }
        demoMode = true;
        jwtToken = null;
        sessionToken = "demo-session-token";
        authMode = "demo";
        notifyChanged();
    }

    public void resetDemoStore() {
        demoStore = DemoStore.createInitial();
        layouts.remove(layoutKey());
        notifyChanged();
    }

    private Map<String, Object> demo() {
        if (demoStore == null) {
            demoStore = DemoStore.createInitial();
        }
        return demoStore;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> demoRows(String collection) {
        Object rows = demo().get(collection);
        if (!(rows instanceof List<?>)) {
            rows = new ArrayList<Map<String, Object>>();
            demo().put(collection, rows);
        }
        return (List<Map<String, Object>>) rows;
    }

    private Map<String, Object> demoRow(String collection, String id) {
        return demoRows(collection).stream().filter(r -> id.equals(r.get("id"))).findFirst().orElse(null);
    }

    // ------------------------------------------------------------------ HTTP

    private HttpClient http() {
        if (http == null) {
            http = buildClient(HttpClient.Redirect.NORMAL, null);
        }
        return http;
    }

    private HttpClient buildClient(HttpClient.Redirect redirect, CookieManager cookies) {
        HttpClient.Builder b = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(redirect);
        if (cookies != null) {
            b.cookieHandler(cookies);
        }
        SSLContext ctx = sslContext();
        if (ctx != null) {
            b.sslContext(ctx);
        }
        return b.build();
    }

    private SSLContext sslContext() {
        if (!trustAllCertificates && clientCertContext == null) {
            return null;
        }
        if (clientCertContext != null && !trustAllCertificates) {
            return clientCertContext;
        }
        try {
            SSLContext ctx = SSLContext.getInstance("TLS");
            // Must be an X509ExtendedTrustManager: the JDK wraps a plain X509TrustManager and still
            // checks the hostname, so a self-signed cert issued for another name would be refused.
            TrustManager[] trustAll = { new X509ExtendedTrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {
                }

                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType, java.net.Socket s) {
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType, java.net.Socket s) {
                }

                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType, javax.net.ssl.SSLEngine e) {
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType, javax.net.ssl.SSLEngine e) {
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            } };
            ctx.init(clientKeyManagers, trustAll, RANDOM);
            return ctx;
        } catch (Exception e) {
            throw new ZitiException("Could not set up TLS: " + e.getMessage(), 0, e);
        }
    }

    private javax.net.ssl.KeyManager[] clientKeyManagers;

    /** Loads a PKCS#12 client certificate used for "Client Cert" sign-in (mutual TLS). */
    public void loadClientCertificate(byte[] pkcs12, char[] password) {
        try {
            KeyStore ks = KeyStore.getInstance("PKCS12");
            ks.load(new ByteArrayInputStream(pkcs12), password);
            KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            kmf.init(ks, password);
            clientKeyManagers = kmf.getKeyManagers();
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(clientKeyManagers, null, RANDOM);
            clientCertContext = ctx;
            String alias = ks.aliases().hasMoreElements() ? ks.aliases().nextElement() : null;
            clientCertSubject = alias != null && ks.getCertificate(alias) instanceof X509Certificate x
                    ? x.getSubjectX500Principal().getName()
                    : "client certificate";
            http = null;
        } catch (Exception e) {
            throw new ZitiException("Could not read the PKCS#12 file: " + ZitiException.text(e), 0, e);
        }
    }

    public void clearClientCertificate() {
        clientCertContext = null;
        clientKeyManagers = null;
        clientCertSubject = null;
        http = null;
    }

    private static String messageOf(Object body) {
        if (body instanceof String s) {
            return s;
        }
        if (!(body instanceof Map<?, ?>)) {
            return "";
        }
        Object err = Json.path(body, "error");
        if (err instanceof Map<?, ?>) {
            String inner = messageOf(err);
            if (!inner.isEmpty()) {
                return inner;
            }
        }
        for (String p : List.of("cause.reason", "cause.message", "message", "code")) {
            String s = Json.str(body, p);
            if (s != null && !s.isEmpty()) {
                return s;
            }
        }
        return "";
    }

    private static Object parseOrNull(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return Json.parse(text);
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ probe & login

    public record Probe(boolean online, String version, boolean oidc, String error) {
    }

    /** Probes a controller's version endpoint (no authentication needed). */
    public Probe probeController(String url) {
        String base = trimUrl(url == null ? controllerUrl() : url);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/" + MGMT + "/version"))
                    .timeout(Duration.ofSeconds(8)).header("Accept", "application/json").GET().build();
            HttpResponse<String> resp = http().send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 400) {
                return new Probe(false, null, false, "HTTP " + resp.statusCode());
            }
            Object body = parseOrNull(resp.body());
            String ver = Json.str(body, "data.version");
            if (ver == null && Json.path(body, "data.apiVersions") == null) {
                return new Probe(false, null, false, "not an OpenZiti controller");
            }
            controllerVersion = ver != null ? ver : "v1.x";
            List<String> caps = Json.strings(body, "data.capabilities");
            String oidcPath = Json.str(body, "data.apiVersions.edge-oidc.v1.path");
            oidcEnabled = caps.contains("OIDC_AUTH") && oidcPath != null;
            if (oidcPath != null) {
                edgeOidcPath = oidcPath;
            }
            return new Probe(true, controllerVersion, oidcEnabled, null);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Probe(false, null, false, "interrupted");
        } catch (Exception e) {
            String msg = e instanceof javax.net.ssl.SSLHandshakeException || String.valueOf(e.getMessage()).contains("PKIX")
                    ? "TLS certificate not trusted (enable \"Accept self-signed certificate\")"
                    : ZitiException.text(e);
            return new Probe(false, null, false, msg);
        }
    }

    /** Sign-in method: "password", "cert" or "ext-jwt". */
    public void login(String url, String method, String username, String password, String extJwt) {
        String base = trimUrl(url);
        Probe probe = probeController(base);
        if (!probe.online()) {
            throw new ZitiException("Unable to reach Edge Controller at " + base + "/" + MGMT + "/version"
                    + (probe.error() != null ? " (" + probe.error() + ")" : ""));
        }
        if (!knownControllers.contains(base)) {
            knownControllers.add(base);
        }
        if (probe.oidc()) {
            try {
                OidcResult r = loginOidc(base, method, username, password, extJwt);
                demoMode = false;
                controllerUrl = base;
                jwtToken = r.accessToken;
                sessionToken = r.accessToken;
                authMode = "oidc";
                expiresAt = r.expiresAt;
                refreshToken = r.refreshToken;
                refreshExpiresAt = r.refreshExpiresAt;
                oidcClientId = r.clientId;
                oidcTokenEndpoint = r.tokenEndpoint;
                notifyChanged();
                return;
            } catch (OidcUnavailable e) {
                LOG.info("OIDC could not start on {}; falling back to /authenticate", base);
            }
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("Accept", "application/json");
        if ("ext-jwt".equals(method) && extJwt != null && !extJwt.isBlank()) {
            headers.put("Authorization", "Bearer " + extJwt.trim());
        }
        String body = "password".equals(method) ? Json.write(map("username", username, "password", password)) : "{}";
        HttpResponse<String> resp = rawSend("POST", base + "/" + MGMT + "/authenticate?method=" + method, headers, body,
                http());
        Object json = parseOrNull(resp.body());
        String token = Json.str(json, "data.token");
        if (resp.statusCode() >= 400 || token == null) {
            throw new ZitiException(firstNonEmpty(messageOf(json), "Login failed (HTTP " + resp.statusCode() + ")"));
        }
        boolean isJwt = token.split("\\.").length == 3;
        demoMode = false;
        controllerUrl = base;
        jwtToken = isJwt ? token : null;
        sessionToken = token;
        authMode = "cert".equals(method) ? "cert" : "legacy";
        expiresAt = Json.str(json, "data.expiresAt");
        refreshToken = null;
        oidcTokenEndpoint = null;
        notifyChanged();
    }

    private static String firstNonEmpty(String a, String b) {
        return a != null && !a.isEmpty() ? a : b;
    }

    private static final class OidcUnavailable extends RuntimeException {
        OidcUnavailable(String m) {
            super(m);
        }
    }

    private record OidcResult(String accessToken, String refreshToken, String expiresAt, Long refreshExpiresAt,
            String clientId, String tokenEndpoint) {
    }

    private static String randomUrlSafe(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static String form(Map<String, String> fields) {
        return fields.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }

    private static Map<String, String> query(URI uri) {
        Map<String, String> out = new HashMap<>();
        String q = uri.getRawQuery();
        if (q == null) {
            return out;
        }
        for (String part : q.split("&")) {
            int i = part.indexOf('=');
            String k = URLDecoder.decode(i < 0 ? part : part.substring(0, i), StandardCharsets.UTF_8);
            String v = i < 0 ? "" : URLDecoder.decode(part.substring(i + 1), StandardCharsets.UTF_8);
            out.put(k, v);
        }
        return out;
    }

    /** The origin this console is served from, for the OIDC redirect URI. */
    private static String consoleOrigin() {
        VaadinRequest req = VaadinRequest.getCurrent();
        if (req instanceof VaadinServletRequest sr) {
            var r = sr.getHttpServletRequest();
            int port = r.getServerPort();
            boolean dflt = (port == 80 && "http".equals(r.getScheme())) || (port == 443 && "https".equals(r.getScheme()));
            return r.getScheme() + "://" + r.getServerName() + (dflt ? "" : ":" + port);
        }
        return "http://localhost:8080";
    }

    /**
     * OIDC authorization-code flow with PKCE, driven from the server. Redirects are followed by
     * hand so the final hop to the redirect URI is read, never fetched.
     */
    private OidcResult loginOidc(String base, String method, String username, String password, String extJwt) {
        String oidcBase = base + edgeOidcPath;
        String tokenEndpoint = oidcBase + "/oauth/token";
        String redirectUri = consoleOrigin() + "/auth/callback";
        String state = randomUrlSafe(32);
        String nonce = randomUrlSafe(32);
        String verifier = randomUrlSafe(48);
        String challenge;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            throw new ZitiException("SHA-256 unavailable", 0, e);
        }
        HttpClient client = buildClient(HttpClient.Redirect.NEVER, new CookieManager());

        String authRequestId = null;
        String activeClient = "openziti";
        for (String clientId : List.of("openziti", "native")) {
            Map<String, String> q = new LinkedHashMap<>();
            q.put("client_id", clientId);
            q.put("response_type", "code");
            q.put("scope", "openid offline_access");
            q.put("state", state);
            q.put("nonce", nonce);
            q.put("code_challenge", challenge);
            q.put("code_challenge_method", "S256");
            q.put("redirect_uri", redirectUri);
            URI uri = URI.create(oidcBase + "/authorize?" + form(q));
            for (int hop = 0; hop < 8 && uri != null; hop++) {
                Map<String, String> params = query(uri);
                String id = params.getOrDefault("authRequestID", params.get("id"));
                if (id != null && hop > 0) {
                    authRequestId = id;
                    break;
                }
                HttpResponse<String> resp = rawSend("GET", uri.toString(), Map.of("Accept", "application/json"), null, client);
                String hdr = resp.headers().firstValue("auth-request-id").orElse(null);
                if (hdr != null) {
                    authRequestId = hdr;
                    break;
                }
                String loc = resp.headers().firstValue("location").orElse(null);
                uri = loc == null ? null : uri.resolve(loc);
            }
            if (authRequestId != null) {
                activeClient = clientId;
                break;
            }
        }
        if (authRequestId == null) {
            throw new OidcUnavailable("Could not start OIDC auth request");
        }

        String loginPath = "ext-jwt".equals(method) ? oidcBase + "/login/ext-jwt"
                : "cert".equals(method) ? oidcBase + "/login/cert" : oidcBase + "/login/username";
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("id", authRequestId);
        if (username != null && !username.isEmpty() && "password".equals(method)) {
            fields.put("username", username);
        }
        if (password != null && !password.isEmpty() && "password".equals(method)) {
            fields.put("password", password);
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept", "application/json");
        headers.put("Content-Type", "application/x-www-form-urlencoded");
        if ("ext-jwt".equals(method) && extJwt != null) {
            headers.put("Authorization", "Bearer " + extJwt.trim());
        }
        URI next = URI.create(loginPath);
        String code = null;
        String returnedState = null;
        HttpResponse<String> last = null;
        for (int hop = 0; hop < 8 && next != null; hop++) {
            last = hop == 0 ? rawSend("POST", next.toString(), headers, form(fields), client)
                    : rawSend("GET", next.toString(), Map.of("Accept", "application/json"), null, client);
            String loc = last.headers().firstValue("location").orElse(null);
            if (loc == null) {
                break;
            }
            URI target = next.resolve(loc);
            Map<String, String> params = query(target);
            if (params.containsKey("code") || target.toString().startsWith(redirectUri)) {
                code = params.get("code");
                returnedState = params.get("state");
                break;
            }
            next = target;
        }
        if (code == null) {
            Object detail = last == null ? null : parseOrNull(last.body());
            throw new ZitiException(firstNonEmpty(messageOf(detail),
                    "OIDC sign-in was rejected (HTTP " + (last == null ? 0 : last.statusCode()) + ")"));
        }
        if (!state.equals(returnedState)) {
            throw new ZitiException("OIDC state mismatch: the authorization response does not belong to this sign-in");
        }
        Map<String, String> tokenForm = new LinkedHashMap<>();
        tokenForm.put("grant_type", "authorization_code");
        tokenForm.put("client_id", activeClient);
        tokenForm.put("code", code);
        tokenForm.put("code_verifier", verifier);
        tokenForm.put("redirect_uri", redirectUri);
        HttpResponse<String> tokenResp = rawSend("POST", tokenEndpoint,
                Map.of("Accept", "application/json", "Content-Type", "application/x-www-form-urlencoded"),
                form(tokenForm), client);
        Object tb = parseOrNull(tokenResp.body());
        if (tokenResp.statusCode() >= 400 || Json.str(tb, "access_token") == null) {
            throw new ZitiException("OIDC token exchange failed");
        }
        String idToken = Json.str(tb, "id_token");
        if (idToken != null && !nonce.equals(Json.str(decodeJwtPayload(idToken), "nonce"))) {
            throw new ZitiException("OIDC nonce mismatch: the ID token was not issued for this sign-in");
        }
        return tokensFrom(tb, null, activeClient, tokenEndpoint);
    }

    private static OidcResult tokensFrom(Object body, String previousRefresh, String clientId, String tokenEndpoint) {
        String access = Json.str(body, "access_token");
        long now = System.currentTimeMillis();
        String exp = null;
        Number expiresIn = Json.num(body, "expires_in");
        if (expiresIn != null) {
            exp = Instant.ofEpochMilli(now + expiresIn.longValue() * 1000).toString();
        } else {
            Number e = Json.num(decodeJwtPayload(access), "exp");
            if (e != null) {
                exp = Instant.ofEpochSecond(e.longValue()).toString();
            }
        }
        Number rexp = Json.num(body, "refresh_expires_in");
        String refresh = Json.str(body, "refresh_token");
        return new OidcResult(access, refresh != null ? refresh : previousRefresh, exp,
                rexp == null ? null : now + rexp.longValue() * 1000, clientId, tokenEndpoint);
    }

    public static Map<String, Object> decodeJwtPayload(String token) {
        if (token == null) {
            return null;
        }
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            return null;
        }
        try {
            byte[] bytes = Base64.getUrlDecoder().decode(parts[1].replace('+', '-').replace('/', '_').replace("=", ""));
            return Json.parseObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private boolean canRefresh() {
        if (demoMode || !"oidc".equals(authMode) || refreshToken == null || oidcTokenEndpoint == null) {
            return false;
        }
        return refreshExpiresAt == null || refreshExpiresAt > System.currentTimeMillis();
    }

    private boolean accessTokenExpiringSoon() {
        if (expiresAt == null) {
            return false;
        }
        try {
            return Instant.parse(expiresAt).toEpochMilli() - System.currentTimeMillis() < REFRESH_LEEWAY_MS;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Exchanges the refresh token for a new access token; false when that is not possible. */
    public synchronized boolean refreshSession() {
        if (!canRefresh()) {
            return false;
        }
        try {
            Map<String, String> f = new LinkedHashMap<>();
            f.put("grant_type", "refresh_token");
            f.put("refresh_token", refreshToken);
            f.put("client_id", oidcClientId == null ? "openziti" : oidcClientId);
            HttpResponse<String> resp = rawSend("POST", oidcTokenEndpoint,
                    Map.of("Accept", "application/json", "Content-Type", "application/x-www-form-urlencoded"), form(f),
                    http());
            Object body = parseOrNull(resp.body());
            if (resp.statusCode() >= 400 || Json.str(body, "access_token") == null) {
                return false;
            }
            OidcResult t = tokensFrom(body, refreshToken, oidcClientId, oidcTokenEndpoint);
            jwtToken = t.accessToken;
            sessionToken = t.accessToken;
            expiresAt = t.expiresAt;
            refreshToken = t.refreshToken;
            if (t.refreshExpiresAt != null) {
                refreshExpiresAt = t.refreshExpiresAt;
            }
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    public void logout() {
        demoMode = false;
        jwtToken = null;
        sessionToken = null;
        authMode = null;
        expiresAt = null;
        refreshToken = null;
        refreshExpiresAt = null;
        oidcTokenEndpoint = null;
        notifyChanged();
    }

    // ------------------------------------------------------------------ authenticated requests

    private HttpResponse<String> rawSend(String method, String url, Map<String, String> headers, String body,
            HttpClient client) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30));
            headers.forEach(b::header);
            b.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
            return client.send(b.build(), HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ZitiException("Request interrupted", 0, e);
        } catch (IOException e) {
            throw new ZitiException("Could not reach the controller: " + ZitiException.text(e), 0, e);
        } catch (IllegalArgumentException e) {
            throw new ZitiException("Invalid controller URL: " + url, 0, e);
        }
    }

    private Map<String, String> authHeaders(String contentType, String accept) {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Content-Type", contentType == null ? "application/json" : contentType);
        h.put("Accept", accept == null ? "application/json" : accept);
        if (jwtToken != null) {
            h.put("Authorization", "Bearer " + jwtToken);
        } else if (sessionToken != null) {
            h.put("zt-session", sessionToken);
        }
        return h;
    }

    /**
     * Single entry point for management/fabric API calls. Refuses to send anything without a
     * session; one refresh-and-retry on 401 for OIDC, after which the session is cleared.
     */
    private HttpResponse<String> send(String method, String path, String body, String api, String contentType,
            String accept) {
        if (!isAuthenticated()) {
            throw new ZitiException("Not signed in to a controller.");
        }
        if (canRefresh() && accessTokenExpiringSoon()) {
            refreshSession();
        }
        String url = controllerUrl() + "/" + api + "/" + path;
        HttpResponse<String> resp = rawSend(method, url, authHeaders(contentType, accept), body, http());
        if (resp.statusCode() == 401 && canRefresh() && refreshSession()) {
            resp = rawSend(method, url, authHeaders(contentType, accept), body, http());
        }
        if (resp.statusCode() == 401) {
            if (isAuthenticated()) {
                logout();
            }
            throw new ZitiException("Session expired. Please sign in again.", 401, null);
        }
        return resp;
    }

    private Object request(String method, String path, String failure, Object body, String api) {
        HttpResponse<String> resp = send(method, path, body == null ? null : Json.write(body), api, null, null);
        Object json = parseOrNull(resp.body());
        if (resp.statusCode() >= 400) {
            throw new ZitiException(firstNonEmpty(messageOf(json), failure + " (HTTP " + resp.statusCode() + ")"),
                    resp.statusCode(), null);
        }
        return json;
    }

    private String requestText(String method, String path, String failure, String body, String contentType,
            String accept) {
        HttpResponse<String> resp = send(method, path, body, MGMT, contentType, accept);
        if (resp.statusCode() >= 400) {
            throw new ZitiException(firstNonEmpty(messageOf(parseOrNull(resp.body())),
                    failure + " (HTTP " + resp.statusCode() + ")"), resp.statusCode(), null);
        }
        return resp.body();
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /**
     * A 200 without a {@code data} array is not an empty list: something else answered the path
     * (e.g. a static page), so it is an error rather than "nothing found".
     */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listRows(Object json, String failure, String api) {
        if (Json.path(json, "data") instanceof List<?> l) {
            return (List<Map<String, Object>>) l;
        }
        String hint = FABRIC.equals(api)
                ? "the controller does not serve the fabric API at this address (add \"binding: fabric\" to its web listener)"
                : "the controller did not return API data for /" + api;
        throw new ZitiException(failure + ": " + hint + ".");
    }

    // ------------------------------------------------------------------ CRUD

    public List<Map<String, Object>> list(String collection) {
        if (demoMode) {
            return Json.copy(demoRows(collection));
        }
        List<Map<String, Object>> out = new ArrayList<>();
        int limit = 500;
        for (int page = 0;; page++) {
            if (page >= 1000) {
                throw new ZitiException("Stopped loading " + collection + " after " + (1000 * limit)
                        + " rows; pagination did not terminate.");
            }
            String failure = "Failed to load " + collection;
            Object json = request("GET", collection + "?limit=" + limit + "&offset=" + (page * limit), failure, null, MGMT);
            List<Map<String, Object>> rows = listRows(json, failure, MGMT);
            out.addAll(rows);
            Number total = Json.num(json, "meta.pagination.totalCount");
            if (rows.size() < limit || (total != null && out.size() >= total.intValue())) {
                break;
            }
        }
        return out;
    }

    /** Creates an entity and returns its new id. */
    public String create(String collection, Map<String, Object> body) {
        if (demoMode) {
            String id = collection.substring(0, Math.min(3, collection.length())) + "-" + randomId();
            String now = Instant.now().toString();
            String name = Json.str(body, "name");
            Map<String, Object> created = new LinkedHashMap<>();
            created.put("id", id);
            created.putAll(Json.copy(body));
            created.put("createdAt", now);
            if (collection.equals("identities")) {
                created.put("authenticators", new LinkedHashMap<>());
                created.put("enrollment", map("ott", demoOttToken(id, name == null ? id : name,
                        Instant.now().plusMillis(86_400_000))));
                created.put("hasEdgeRouterConnection", false);
                created.put("type", map("name", Json.strOr(body, "type", "Default")));
                created.put("typeId", Json.strOr(body, "type", "Default"));
            }
            if (collection.equals("edge-routers") || collection.equals("transit-routers")) {
                created.put("isOnline", false);
                created.put("isVerified", false);
                created.put("enrollmentJwt", demoRouterJwt(id, name == null ? id : name));
                created.put("enrollmentExpiresAt", Instant.now().plusMillis(86_400_000).toString());
            }
            if (collection.equals("cas")) {
                created.put("isVerified", false);
                created.put("verificationToken", randomId() + randomId().substring(0, 3));
            }
            if (collection.equals("configs")) {
                String typeId = Json.str(body, "configTypeId");
                Map<String, Object> type = typeId == null ? null : demoRow("config-types", typeId);
                if (type != null) {
                    created.put("configType", map("id", typeId, "name", type.get("name")));
                }
            }
            demoRows(collection).add(created);
            notifyChanged();
            return id;
        }
        Object json = request("POST", collection, "POST " + collection + " failed", body, MGMT);
        String id = Json.str(json, "data.id");
        notifyChanged();
        return id;
    }

    public void patch(String collection, String id, Map<String, Object> body) {
        patch(collection, id, body, true);
    }

    private void patch(String collection, String id, Map<String, Object> body, boolean notify) {
        if (demoMode) {
            Map<String, Object> row = demoRow(collection, id);
            if (row != null) {
                row.putAll(Json.copy(body));
                if (collection.equals("configs") && body.containsKey("data")) {
                    row.put("data", Json.copy(body.get("data")));
                }
            }
        } else {
            request("PATCH", collection + "/" + enc(id), "PATCH " + collection + "/" + id + " failed", body, MGMT);
        }
        if (notify) {
            notifyChanged();
        }
    }

    public void put(String collection, String id, Map<String, Object> body) {
        if (demoMode) {
            patch(collection, id, body);
            return;
        }
        request("PUT", collection + "/" + enc(id), "PUT " + collection + "/" + id + " failed", body, MGMT);
        notifyChanged();
    }

    public void remove(String collection, String id) {
        remove(collection, id, true);
    }

    private void remove(String collection, String id, boolean notify) {
        if (demoMode) {
            if (collection.equals("api-sessions")) {
                Map<String, Object> target = demoRow("api-sessions", id);
                demoRows("api-sessions").removeIf(s -> id.equals(s.get("id")));
                demoRows("sessions").removeIf(s -> id.equals(s.get("apiSessionId")));
                String identityId = target == null ? null : Json.str(target, "identityId");
                if (identityId != null) {
                    boolean still = demoRows("api-sessions").stream().anyMatch(s -> identityId.equals(s.get("identityId")));
                    Map<String, Object> ident = demoRow("identities", identityId);
                    if (ident != null && !still) {
                        ident.put("hasEdgeRouterConnection", false);
                    }
                }
            } else if (collection.equals("authenticators")) {
                demoRows("authenticators").removeIf(a -> id.equals(a.get("id")));
                for (Map<String, Object> ident : demoRows("identities")) {
                    Map<String, Object> auth = Json.obj(ident, "authenticators");
                    if (auth != null) {
                        auth.entrySet().removeIf(e -> id.equals(Json.str(e.getValue(), "id")));
                    }
                }
            } else {
                demoRows(collection).removeIf(x -> id.equals(x.get("id")));
            }
        } else {
            request("DELETE", collection + "/" + enc(id), "DELETE " + collection + "/" + id + " failed", null, MGMT);
        }
        if (notify) {
            notifyChanged();
        }
    }

    public List<Map<String, Object>> listIdentityAuthenticators(String identityId) {
        if (demoMode) {
            return Json.copy(demoRows("authenticators").stream()
                    .filter(a -> identityId.equals(a.get("identityId")) || identityId.equals(Json.str(a, "identity.id")))
                    .toList());
        }
        Object json = request("GET", "identities/" + enc(identityId) + "/authenticators",
                "Failed to load authenticators for identity " + identityId, null, MGMT);
        return Json.objects(json, "data");
    }

    // ------------------------------------------------------------------ concurrency policy & remediation

    public ConcurrencyPolicy getConcurrencyPolicy() {
        return concurrencyPolicy.copy();
    }

    public ConcurrencyPolicy saveConcurrencyPolicy(ConcurrencyPolicy next) {
        concurrencyPolicy = next.normalized();
        fire(policyListeners);
        return concurrencyPolicy.copy();
    }

    public ConcurrencyPolicy resetConcurrencyPolicy() {
        concurrencyPolicy = new ConcurrencyPolicy();
        fire(policyListeners);
        return concurrencyPolicy.copy();
    }

    public record RemediationResult(int executed, List<String> failures) {
    }

    /** Runs remediation steps in order; stops if an authenticator DELETE fails. */
    public RemediationResult executeRemediationSteps(List<RemediationStep> steps) {
        int executed = 0;
        List<String> failures = new ArrayList<>();
        try {
            for (RemediationStep step : steps) {
                try {
                    remove(step.collection(), step.targetId(), false);
                    executed++;
                } catch (RuntimeException e) {
                    failures.add(step.collection() + "/" + step.targetId() + ": " + ZitiException.text(e));
                    if (step.collection().equals("authenticators")) {
                        break;
                    }
                }
            }
        } finally {
            notifyChanged();
        }
        return new RemediationResult(executed, failures);
    }

    // ------------------------------------------------------------------ fabric

    /** Lists a fabric collection (circuits, links, routers); callers treat failure as "live data unavailable". */
    public List<Map<String, Object>> listFabric(String collection) {
        if (demoMode) {
            return Json.copy(DemoStore.fabric(demo()).getOrDefault(collection, List.of()));
        }
        List<Map<String, Object>> out = new ArrayList<>();
        int limit = 500;
        for (int page = 0; page < 200; page++) {
            String failure = "Failed to load fabric " + collection;
            Object json = request("GET", collection + "?limit=" + limit + "&offset=" + (page * limit), failure, null,
                    FABRIC);
            List<Map<String, Object>> rows = listRows(json, failure, FABRIC);
            out.addAll(rows);
            Number total = Json.num(json, "meta.pagination.totalCount");
            if (rows.size() < limit || (total != null && out.size() >= total.intValue())) {
                return out;
            }
        }
        throw new ZitiException("Stopped loading fabric " + collection + "; pagination did not terminate.");
    }

    /** Sets or clears an entity's "geolocation" tag; tags are replaced as a whole map. */
    public void saveGeolocation(String collection, Map<String, Object> entity, String geolocation, boolean notify) {
        Map<String, Object> tags = new LinkedHashMap<>();
        Map<String, Object> current = Json.obj(entity, "tags");
        if (current != null) {
            tags.putAll(current);
        }
        if (geolocation != null) {
            tags.put("geolocation", geolocation);
        } else {
            tags.remove("geolocation");
        }
        // An empty tags object is ignored by the controller's PATCH; send a placeholder instead.
        if (tags.isEmpty()) {
            tags.put("temp", "empty");
        }
        patch(collection, Json.str(entity, "id"), map("tags", tags), notify);
    }

    // ------------------------------------------------------------------ enrollment lifecycle

    private static String randomId() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 7; i++) {
            sb.append(chars.charAt(RANDOM.nextInt(chars.length())));
        }
        return sb.toString();
    }

    private Map<String, Object> demoOttToken(String identityId, String name, Instant expiresAt) {
        String nonce = randomId();
        String payload = Json.write(map("sub", identityId, "name", name, "iss", controllerUrl(), "jti", nonce, "exp",
                expiresAt.getEpochSecond()));
        return map("id", "enr-" + identityId + "-" + nonce,
                "jwt", "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9."
                        + Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + ".demo-jwt-sig",
                "expiresAt", expiresAt.toString());
    }

    private static String demoRouterJwt(String id, String name) {
        String payload = Json.write(map("sub", id, "name", name, "router", true, "jti", randomId()));
        return "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9."
                + Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + ".router-jwt";
    }

    /** Revokes an enrolled identity's authenticator and issues a new one-time enrollment token. */
    public void resetEnrollment(Map<String, Object> identity, Instant expires) {
        String authId = Json.strOr(identity, "authenticators.cert.id", Json.str(identity, "authenticators.updb.id"));
        String name = Json.str(identity, "name");
        if (authId == null) {
            throw new ZitiException(name + " has no authenticator to reset.");
        }
        if (demoMode) {
            Map<String, Object> ident = demoRow("identities", Json.str(identity, "id"));
            if (ident != null) {
                ident.put("authenticators", new LinkedHashMap<>());
                ident.put("enrollment", map("ott", demoOttToken(Json.str(ident, "id"), name, expires)));
                ident.put("hasEdgeRouterConnection", false);
            }
        } else {
            request("POST", "authenticators/" + enc(authId) + "/re-enroll", "Reset enrollment failed",
                    map("expiresAt", expires.toString()), MGMT);
        }
        notifyChanged();
    }

    /** Replaces a pending enrollment token with a new one that expires at {@code expires}. */
    public void reissueEnrollment(Map<String, Object> identity, Instant expires) {
        String enrollmentId = null;
        for (String k : List.of("ott", "ottca", "updb", "ca")) {
            enrollmentId = enrollmentId != null ? enrollmentId : Json.str(identity, "enrollment." + k + ".id");
        }
        String name = Json.str(identity, "name");
        if (enrollmentId == null) {
            throw new ZitiException(name + " has no pending enrollment to reissue.");
        }
        if (demoMode) {
            Map<String, Object> ident = demoRow("identities", Json.str(identity, "id"));
            if (ident != null) {
                ident.put("enrollment", map("ott", demoOttToken(Json.str(ident, "id"), name, expires)));
            }
        } else {
            request("POST", "enrollments/" + enc(enrollmentId) + "/refresh", "Reissue enrollment failed",
                    map("expiresAt", expires.toString()), MGMT);
        }
        notifyChanged();
    }

    /** Removes an identity's MFA (TOTP) enrollment. */
    public void resetMfa(Map<String, Object> identity) {
        if (demoMode) {
            Map<String, Object> ident = demoRow("identities", Json.str(identity, "id"));
            if (ident != null) {
                ident.put("isMfaEnabled", false);
            }
        } else {
            request("DELETE", "identities/" + enc(Json.str(identity, "id")) + "/mfa", "Reset MFA failed", null, MGMT);
        }
        notifyChanged();
    }

    /** Re-enrolls a router: its certificate is revoked until it enrolls with the new JWT. */
    public void reEnrollRouter(String collection, Map<String, Object> router) {
        String id = Json.str(router, "id");
        if (demoMode) {
            Map<String, Object> row = demoRow(collection, id);
            if (row != null) {
                row.put("isOnline", false);
                row.put("isVerified", false);
                row.put("enrollmentJwt", demoRouterJwt(id, Json.str(row, "name")));
                row.put("enrollmentExpiresAt", Instant.now().plusMillis(86_400_000).toString());
            }
        } else {
            request("POST", collection + "/" + enc(id) + "/re-enroll", "Re-enroll failed", map(), MGMT);
        }
        notifyChanged();
    }

    /** Simulates enrolling an identity in demo mode so status updates can be seen. */
    public void simulateEnrollDemoIdentity(String id) {
        if (!demoMode) {
            return;
        }
        Map<String, Object> ident = demoRow("identities", id);
        if (ident != null) {
            ident.put("authenticators", map("cert", map("id", "auth-" + id)));
            ident.put("enrollment", new LinkedHashMap<>());
            ident.put("hasEdgeRouterConnection", true);
            notifyChanged();
        }
    }

    // ------------------------------------------------------------------ certificate authorities

    public String caEnrollmentJwt(Map<String, Object> ca) {
        if (demoMode) {
            String payload = Json.write(map("em", "ca", "ca", ca.get("id")));
            return "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9."
                    + Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + ".demo-ca-jwt";
        }
        return requestText("GET", "cas/" + enc(Json.str(ca, "id")) + "/jwt", "Failed to fetch the CA JWT", null, null,
                "application/jwt");
    }

    public void verifyCa(Map<String, Object> ca, String certPem) {
        if (!FormValues.looksLikePemCertificate(certPem)) {
            throw new ZitiException("Paste a PEM certificate (-----BEGIN CERTIFICATE----- …).");
        }
        if (demoMode) {
            Map<String, Object> row = demoRow("cas", Json.str(ca, "id"));
            if (row != null) {
                row.put("isVerified", true);
            }
        } else {
            requestText("POST", "cas/" + enc(Json.str(ca, "id")) + "/verify", "CA verification failed", certPem.trim(),
                    "text/plain", null);
        }
        notifyChanged();
    }

    // ------------------------------------------------------------------ identity service config overrides

    public record ConfigOverride(String serviceId, String configId, String serviceName, String configName) {
    }

    @SuppressWarnings("unchecked")
    public List<ConfigOverride> listServiceConfigOverrides(String identityId) {
        if (demoMode) {
            Map<String, Object> all = (Map<String, Object>) demo().computeIfAbsent("serviceConfigOverrides",
                    k -> new LinkedHashMap<>());
            List<ConfigOverride> out = new ArrayList<>();
            for (Map<String, Object> o : Json.objects(all, identityId)) {
                String sid = Json.str(o, "serviceId");
                String cid = Json.str(o, "configId");
                Map<String, Object> svc = demoRow("services", sid);
                Map<String, Object> cfg = demoRow("configs", cid);
                out.add(new ConfigOverride(sid, cid, svc == null ? sid : Json.str(svc, "name"),
                        cfg == null ? cid : Json.str(cfg, "name")));
            }
            return out;
        }
        Object json = request("GET", "identities/" + enc(identityId) + "/service-configs?limit=500",
                "Failed to load config overrides", null, MGMT);
        return Json.objects(json, "data").stream()
                .map(o -> new ConfigOverride(Json.strOr(o, "serviceId", Json.strOr(o, "service.id", "")),
                        Json.strOr(o, "configId", Json.strOr(o, "config.id", "")),
                        Json.strOr(o, "service.name", Json.str(o, "serviceId")),
                        Json.strOr(o, "config.name", Json.str(o, "configId"))))
                .toList();
    }

    public void addServiceConfigOverride(String identityId, String serviceId, String configId) {
        changeOverride("POST", identityId, serviceId, configId);
    }

    public void removeServiceConfigOverride(String identityId, String serviceId, String configId) {
        changeOverride("DELETE", identityId, serviceId, configId);
    }

    @SuppressWarnings("unchecked")
    private void changeOverride(String method, String identityId, String serviceId, String configId) {
        if (demoMode) {
            Map<String, Object> all = (Map<String, Object>) demo().computeIfAbsent("serviceConfigOverrides",
                    k -> new LinkedHashMap<>());
            List<Object> current = new ArrayList<>(Json.objects(all, identityId).stream()
                    .filter(o -> !(serviceId.equals(o.get("serviceId")) && configId.equals(o.get("configId")))).toList());
            if (method.equals("POST")) {
                current.add(map("serviceId", serviceId, "configId", configId));
            }
            all.put(identityId, current);
        } else {
            HttpResponse<String> resp = send(method, "identities/" + enc(identityId) + "/service-configs",
                    Json.write(List.of(map("serviceId", serviceId, "configId", configId))), MGMT, null, null);
            if (resp.statusCode() >= 400) {
                throw new ZitiException(firstNonEmpty(messageOf(parseOrNull(resp.body())),
                        (method.equals("POST") ? "Adding the override failed" : "Removing the override failed")
                                + " (HTTP " + resp.statusCode() + ")"));
            }
        }
        notifyChanged();
    }

    // ------------------------------------------------------------------ canvas layout

    private String layoutKey() {
        return controllerUrl().trim().replaceAll("/+$", "").toLowerCase();
    }

    public AcLayout loadLayout() {
        AcLayout l = layouts.get(layoutKey());
        return l == null ? new AcLayout() : l.copy();
    }

    public void saveLayout(AcLayout layout) {
        layouts.put(layoutKey(), layout.copy());
    }

    // ------------------------------------------------------------------ Access Canvas model

    public AcModel loadCanvasModel() {
        List<Map<String, Object>> ids = list("identities");
        List<Map<String, Object>> svcs = list("services");
        List<Map<String, Object>> ers = list("edge-routers");
        List<Map<String, Object>> sps = list("service-policies");
        List<Map<String, Object>> erps = list("edge-router-policies");
        List<Map<String, Object>> serps = list("service-edge-router-policies");
        List<Map<String, Object>> cfgs = list("configs");
        AcModel m = new AcModel();
        Set<String> referencedIdentityRefs = new HashSet<>();
        for (Map<String, Object> p : sps) {
            if (Json.bool(p, "isSystem")) {
                continue;
            }
            for (String role : Json.strings(p, "identityRoles")) {
                if (role.startsWith("@")) {
                    referencedIdentityRefs.add(role.substring(1));
                }
            }
        }
        for (Map<String, Object> p : erps) {
            if (Json.bool(p, "isSystem")) {
                continue;
            }
            for (String role : Json.strings(p, "identityRoles")) {
                if (role.startsWith("@")) {
                    referencedIdentityRefs.add(role.substring(1));
                }
            }
        }
        Map<String, Boolean> routerOnlineById = new HashMap<>();
        for (Map<String, Object> r : ers) {
            routerOnlineById.put(Json.str(r, "id"), Json.bool(r, "isOnline"));
        }
        for (Map<String, Object> i : ids) {
            String type = Json.strOr(i, "typeId", Json.strOr(i, "type.name", Json.str(i, "type.id")));
            boolean isRouter = "Router".equals(type);
            String id = Json.str(i, "id");
            String name = Json.str(i, "name");
            List<String> attrs = Json.strings(i, "roleAttributes");
            if (isRouter && attrs.isEmpty()
                    && !referencedIdentityRefs.contains(id)
                    && !referencedIdentityRefs.contains(name)) {
                continue;
            }
            AcIdentity a = new AcIdentity(id, name, attrs);
            a.enrolled = !Json.isEmptyObj(i.get("authenticators")) || Json.isEmptyObj(i.get("enrollment"));
            a.online = Json.bool(i, "hasEdgeRouterConnection")
                    || (isRouter && Boolean.TRUE.equals(routerOnlineById.get(id)));
            a.isAdmin = Json.bool(i, "isDefaultAdmin") || (Json.bool(i, "isAdmin") && a.attrs.isEmpty()
                    && Json.path(i, "authenticators.cert") == null && Json.path(i, "enrollment.ott") == null);
            a.externalId = Json.str(i, "externalId");
            m.identities.add(a);
        }
        for (Map<String, Object> s : svcs) {
            AcService a = new AcService(Json.str(s, "id"), Json.str(s, "name"), Json.strings(s, "roleAttributes"));
            a.configs = new ArrayList<>(Json.strings(s, "configs"));
            a.encryptionRequired = !Boolean.FALSE.equals(s.get("encryptionRequired"));
            a.terminatorStrategy = Json.strOr(s, "terminatorStrategy", "smartrouting");
            m.services.add(a);
        }
        for (Map<String, Object> r : ers) {
            m.routers.add(new AcRouter(Json.str(r, "id"), Json.str(r, "name"), Json.strings(r, "roleAttributes"),
                    Json.bool(r, "isOnline")));
        }
        for (Map<String, Object> p : sps) {
            if (Json.bool(p, "isSystem")) {
                continue;
            }
            List<Map<String, Object>> disp = Json.objects(p, "postureCheckRolesDisplay");
            List<String> posture = !disp.isEmpty()
                    ? disp.stream().map(x -> Json.strOr(x, "name", Json.str(x, "role"))).toList()
                    : Json.strings(p, "postureCheckRoles");
            m.servicePolicies.add(new AcServicePolicy(Json.str(p, "id"), Json.str(p, "name"), Json.str(p, "type"),
                    Json.strOr(p, "semantic", "AnyOf"), Json.strings(p, "identityRoles"), Json.strings(p, "serviceRoles"),
                    posture));
        }
        for (Map<String, Object> p : erps) {
            if (!Json.bool(p, "isSystem")) {
                m.erPolicies.add(new AcErPolicy(Json.str(p, "id"), Json.str(p, "name"), Json.strOr(p, "semantic", "AnyOf"),
                        Json.strings(p, "identityRoles"), Json.strings(p, "edgeRouterRoles")));
            }
        }
        for (Map<String, Object> p : serps) {
            if (!Json.bool(p, "isSystem")) {
                m.serps.add(new AcSerp(Json.str(p, "id"), Json.str(p, "name"), Json.strOr(p, "semantic", "AnyOf"),
                        Json.strings(p, "serviceRoles"), Json.strings(p, "edgeRouterRoles")));
            }
        }
        for (Map<String, Object> c : cfgs) {
            m.configs.add(new AcModel.AcConfig(Json.str(c, "id"), Json.str(c, "name"), Json.str(c, "configType.name"),
                    Json.obj(c, "data")));
        }
        return m;
    }

    /** One step that undoes part of an applied change set. */
    public record AcRevert(String label, Runnable run) {
    }

    /** Thrown when an apply fails part-way; {@code reverts} undoes the steps that succeeded, newest first. */
    public static final class CanvasApplyError extends ZitiException {
        private final transient List<AcRevert> reverts;

        CanvasApplyError(Throwable cause, List<AcRevert> reverts) {
            super(ZitiException.text(cause), 0, cause);
            this.reverts = reverts;
        }

        public List<AcRevert> reverts() {
            return reverts;
        }
    }

    private List<String> currentRoleList(String api, String id, String field) {
        if (demoMode) {
            Map<String, Object> row = demoRow(api, id);
            return new ArrayList<>(Json.strings(row, field));
        }
        Object json = request("GET", api + "/" + enc(id), "GET " + api + "/" + id + " failed", null, MGMT);
        return new ArrayList<>(Json.strings(json, "data." + field));
    }

    /** Adds/removes role-list entries relative to the controller's current value (a delta, not a snapshot). */
    private boolean patchRoleList(String api, String id, String field, List<String> add, List<String> remove) {
        List<String> current = currentRoleList(api, id, field);
        List<String> next = new ArrayList<>(current.stream().filter(a -> !remove.contains(a)).toList());
        add.stream().filter(a -> !current.contains(a)).forEach(next::add);
        if (next.equals(current)) {
            return false;
        }
        patch(api, id, map(field, next), false);
        return true;
    }

    public List<AcRevert> applyCanvasOps(List<AcOp> ops, Map<String, String> idMap) {
        List<AcRevert> reverts = new ArrayList<>();
        List<Map<String, Object>> configTypes = null;
        try {
            for (AcOp op : ops) {
                switch (op) {
                    case AddAttr a -> attrOp(a.kind().api, idMap.getOrDefault(a.id(), a.id()), a.attr(), true,
                            a.kind().one, reverts);
                    case RemoveAttr a -> attrOp(a.kind().api, idMap.getOrDefault(a.id(), a.id()), a.attr(), false,
                            a.kind().one, reverts);
                    case AddIdentityRole r -> {
                        String policy = idMap.getOrDefault(r.policy(), r.policy());
                        if (patchRoleList("service-policies", policy, "identityRoles", List.of(r.role()), List.of())) {
                            reverts.add(0, new AcRevert("remove " + r.role() + " from policy " + policy,
                                    () -> patchRoleList("service-policies", policy, "identityRoles", List.of(),
                                            List.of(r.role()))));
                        }
                    }
                    case CreateIdentity c -> created("identities", AccessLogic.identityBody(c.identity()),
                            c.identity().id(), "identity " + c.identity().name(), idMap, reverts);
                    case CreateConfig c -> {
                        var cfg = c.config();
                        if (cfg.existingId != null) {
                            patch("configs", cfg.existingId, map("name", cfg.name, "data", cfg.data), false);
                            idMap.put(cfg.id, cfg.existingId);
                        } else {
                            if (configTypes == null) {
                                configTypes = list("config-types");
                            }
                            String typeId = configTypes.stream().filter(t -> cfg.type.equals(t.get("name")))
                                    .map(t -> Json.str(t, "id")).findFirst()
                                    .orElseThrow(() -> new ZitiException(
                                            "Config type " + cfg.type + " not found on the controller"));
                            created("configs", map("name", cfg.name, "configTypeId", typeId, "data", cfg.data), cfg.id,
                                    "config " + cfg.name, idMap, reverts);
                        }
                    }
                    case CreateSerp c -> upsert("service-edge-router-policies", AccessLogic.serpBody(c.policy()),
                            c.policy().id, c.policy().existingId, "service router policy " + c.policy().name, idMap,
                            reverts);
                    case CreateService c -> {
                        Map<String, Object> body = AccessLogic.serviceBody(c.service());
                        body.put("configs", c.service().configs.stream().map(x -> idMap.getOrDefault(x, x)).toList());
                        upsert("services", body, c.service().id, c.service().existingId, "service " + c.service().name,
                                idMap, reverts);
                    }
                    case CreatePolicy c -> upsert("service-policies", AccessLogic.policyBody(c.policy()), c.policy().id,
                            c.policy().existingId, "service policy " + c.policy().name, idMap, reverts);
                    case CreateErPolicy c -> upsert("edge-router-policies", AccessLogic.erPolicyBody(c.policy()),
                            c.policy().id, c.policy().existingId, "edge router policy " + c.policy().name, idMap,
                            reverts);
                }
            }
        } catch (RuntimeException e) {
            notifyChanged();
            throw new CanvasApplyError(e, reverts);
        }
        notifyChanged();
        return reverts;
    }

    private void attrOp(String api, String id, String attr, boolean adding, String kind, List<AcRevert> reverts) {
        List<String> add = adding ? List.of(attr) : List.of();
        List<String> rem = adding ? List.of() : List.of(attr);
        if (patchRoleList(api, id, "roleAttributes", add, rem)) {
            reverts.add(0, new AcRevert((adding ? "remove" : "re-add") + " #" + attr + " on " + kind + " " + id,
                    () -> patchRoleList(api, id, "roleAttributes", rem, add)));
        }
    }

    private void created(String api, Map<String, Object> body, String localId, String label, Map<String, String> idMap,
            List<AcRevert> reverts) {
        String id;
        if (demoMode) {
            id = create(api, body);
        } else {
            Object json = request("POST", api, "POST " + api + " failed", body, MGMT);
            id = Json.str(json, "data.id");
        }
        if (id != null) {
            idMap.put(localId, id);
            reverts.add(0, new AcRevert("delete " + label, () -> remove(api, id, false)));
        }
    }

    private void upsert(String api, Map<String, Object> body, String localId, String existingId, String label,
            Map<String, String> idMap, List<AcRevert> reverts) {
        if (existingId != null) {
            patch(api, existingId, body, false);
            idMap.put(localId, existingId);
        } else {
            created(api, body, localId, label, idMap, reverts);
        }
    }

    public record RevertFailure(AcRevert revert, String error) {
    }

    /** Runs every revert even if some fail, so the UI never claims a rollback that did not happen. */
    public List<RevertFailure> revertCanvasOps(List<AcRevert> reverts) {
        List<RevertFailure> failures = new ArrayList<>();
        for (AcRevert r : reverts) {
            try {
                r.run().run();
            } catch (RuntimeException e) {
                failures.add(new RevertFailure(r, ZitiException.text(e)));
            }
        }
        notifyChanged();
        return failures;
    }

    public static String describeRevertFailures(List<RevertFailure> failures) {
        return failures.stream().map(f -> f.revert().label() + " (" + f.error() + ")").collect(Collectors.joining("; "));
    }

    /** Small helper for views: null-safe equality on string ids. */
    public static boolean sameId(Object a, Object b) {
        return Objects.equals(a, b);
    }
}
