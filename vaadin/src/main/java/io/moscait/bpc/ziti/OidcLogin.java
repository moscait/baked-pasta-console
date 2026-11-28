package io.moscait.bpc.ziti;

import java.net.CookieManager;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * OpenZiti's OIDC sign-in (authorization code + PKCE), driven from the server, and refresh-token exchange.
 * Redirects are followed by hand so the final hop to the redirect URI is read, never fetched.
 */
final class OidcLogin {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_HOPS = 8;
    private static final Map<String, String> FORM_HEADERS = Map.of("Accept", "application/json", "Content-Type",
            "application/x-www-form-urlencoded");

    /** The controller does not offer OIDC for this sign-in; the caller falls back to /authenticate. */
    static final class Unavailable extends RuntimeException {
        Unavailable(String m) {
            super(m);
        }
    }

    record Tokens(String accessToken, String refreshToken, String expiresAt, Long refreshExpiresAt, String clientId,
            String tokenEndpoint) {
    }

    private OidcLogin() {
    }

    /**
     * Signs in with {@code method} ("password", "cert" or "ext-jwt") against {@code oidcBase}
     * (controller URL + edge-oidc path).
     */
    static Tokens login(ControllerHttp http, String oidcBase, String redirectUri, String method, String username,
            String password, String extJwt) {
        String tokenEndpoint = oidcBase + "/oauth/token";
        String state = randomUrlSafe(32);
        String nonce = randomUrlSafe(32);
        String verifier = randomUrlSafe(48);
        String challenge = pkceChallenge(verifier);
        HttpClient client = http.newClient(new CookieManager());

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
            authRequestId = startAuthRequest(client, URI.create(oidcBase + "/authorize?" + form(q)));
            if (authRequestId != null) {
                activeClient = clientId;
                break;
            }
        }
        if (authRequestId == null) {
            throw new Unavailable("Could not start OIDC auth request");
        }

        String loginPath = "ext-jwt".equals(method) ? oidcBase + "/login/ext-jwt"
                : "cert".equals(method) ? oidcBase + "/login/cert" : oidcBase + "/login/username";
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("id", authRequestId);
        if ("password".equals(method)) {
            if (username != null && !username.isEmpty()) {
                fields.put("username", username);
            }
            if (password != null && !password.isEmpty()) {
                fields.put("password", password);
            }
        }
        Map<String, String> headers = new LinkedHashMap<>(FORM_HEADERS);
        if ("ext-jwt".equals(method) && extJwt != null) {
            headers.put("Authorization", "Bearer " + extJwt.trim());
        }
        URI next = URI.create(loginPath);
        String code = null;
        String returnedState = null;
        HttpResponse<String> last = null;
        for (int hop = 0; hop < MAX_HOPS && next != null; hop++) {
            last = hop == 0 ? ControllerHttp.send("POST", next.toString(), headers, form(fields), client)
                    : ControllerHttp.send("GET", next.toString(), Map.of("Accept", "application/json"), null, client);
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
            Object detail = last == null ? null : Json.parseOrNull(last.body());
            String msg = Json.messageOf(detail);
            throw new ZitiException(msg != null && !msg.isEmpty() ? msg
                    : "OIDC sign-in was rejected (HTTP " + (last == null ? 0 : last.statusCode()) + ")");
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
        HttpResponse<String> tokenResp = ControllerHttp.send("POST", tokenEndpoint, FORM_HEADERS, form(tokenForm),
                client);
        Object tb = Json.parseOrNull(tokenResp.body());
        if (tokenResp.statusCode() >= 400 || Json.str(tb, "access_token") == null) {
            throw new ZitiException("OIDC token exchange failed");
        }
        String idToken = Json.str(tb, "id_token");
        if (idToken != null && !nonce.equals(Json.str(ZitiService.decodeJwtPayload(idToken), "nonce"))) {
            throw new ZitiException("OIDC nonce mismatch: the ID token was not issued for this sign-in");
        }
        return tokens(tb, null, activeClient, tokenEndpoint);
    }

    /** New tokens for {@code refreshToken}, or null when the controller refuses it. */
    static Tokens refresh(ControllerHttp http, String tokenEndpoint, String refreshToken, String clientId) {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("grant_type", "refresh_token");
        f.put("refresh_token", refreshToken);
        f.put("client_id", clientId == null ? "openziti" : clientId);
        HttpResponse<String> resp = http.send("POST", tokenEndpoint, FORM_HEADERS, form(f));
        Object body = Json.parseOrNull(resp.body());
        if (resp.statusCode() >= 400 || Json.str(body, "access_token") == null) {
            return null;
        }
        return tokens(body, refreshToken, clientId, tokenEndpoint);
    }

    /** Follows the /authorize redirects until the controller names the auth request; null if it never does. */
    private static String startAuthRequest(HttpClient client, URI uri) {
        for (int hop = 0; hop < MAX_HOPS && uri != null; hop++) {
            Map<String, String> params = query(uri);
            String id = params.getOrDefault("authRequestID", params.get("id"));
            if (id != null && hop > 0) {
                return id;
            }
            HttpResponse<String> resp = ControllerHttp.send("GET", uri.toString(), Map.of("Accept", "application/json"),
                    null, client);
            String hdr = resp.headers().firstValue("auth-request-id").orElse(null);
            if (hdr != null) {
                return hdr;
            }
            String loc = resp.headers().firstValue("location").orElse(null);
            uri = loc == null ? null : uri.resolve(loc);
        }
        return null;
    }

    private static Tokens tokens(Object body, String previousRefresh, String clientId, String tokenEndpoint) {
        String access = Json.str(body, "access_token");
        long now = System.currentTimeMillis();
        String exp = null;
        Number expiresIn = Json.num(body, "expires_in");
        if (expiresIn != null) {
            exp = Instant.ofEpochMilli(now + expiresIn.longValue() * 1000).toString();
        } else {
            Number e = Json.num(ZitiService.decodeJwtPayload(access), "exp");
            if (e != null) {
                exp = Instant.ofEpochSecond(e.longValue()).toString();
            }
        }
        Number rexp = Json.num(body, "refresh_expires_in");
        String refresh = Json.str(body, "refresh_token");
        return new Tokens(access, refresh != null ? refresh : previousRefresh, exp,
                rexp == null ? null : now + rexp.longValue() * 1000, clientId, tokenEndpoint);
    }

    private static String pkceChallenge(String verifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            throw new ZitiException("SHA-256 unavailable", 0, e);
        }
    }

    private static String randomUrlSafe(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    static String form(Map<String, String> fields) {
        return fields.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }

    static Map<String, String> query(URI uri) {
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
}
