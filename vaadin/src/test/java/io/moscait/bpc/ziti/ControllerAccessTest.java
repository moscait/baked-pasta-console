package io.moscait.bpc.ziti;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * Which hosts the server-side HTTP client may talk to, and what it sends them. The console has no login of
 * its own, so these are the controls that stop it being used to reach arbitrary hosts or leak a session.
 */
class ControllerAccessTest {

    /** A fake legacy-auth controller (no OIDC) that records every request. */
    private static final class FakeController {
        final HttpServer server;
        final List<String> requests = new CopyOnWriteArrayList<>();
        final List<String> sessionHeaders = new CopyOnWriteArrayList<>();
        volatile String identitiesRedirect;

        FakeController() throws IOException {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", this::handle);
            server.start();
        }

        String url() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        private void handle(HttpExchange x) throws IOException {
            String path = x.getRequestURI().getPath();
            requests.add(x.getRequestMethod() + " " + path);
            String session = x.getRequestHeaders().getFirst("zt-session");
            if (session != null) {
                sessionHeaders.add(session);
            }
            if (path.endsWith("/version")) {
                reply(x, 200, "{\"data\":{\"version\":\"v1.5.0\",\"capabilities\":[]}}");
            } else if (path.endsWith("/authenticate")) {
                reply(x, 200, "{\"data\":{\"token\":\"secret-session\"}}");
            } else if (path.endsWith("/identities") && identitiesRedirect != null) {
                x.getResponseHeaders().add("Location", identitiesRedirect);
                x.sendResponseHeaders(302, -1);
                x.close();
            } else {
                reply(x, 200, "{\"data\":[],\"meta\":{\"pagination\":{\"totalCount\":0}}}");
            }
        }

        private static void reply(HttpExchange x, int status, String json) throws IOException {
            byte[] body = json.getBytes(StandardCharsets.UTF_8);
            x.getResponseHeaders().add("Content-Type", "application/json");
            x.sendResponseHeaders(status, body.length);
            x.getResponseBody().write(body);
            x.close();
        }
    }

    private FakeController configured;
    private FakeController other;

    @BeforeEach
    void start() throws IOException {
        configured = new FakeController();
        other = new FakeController();
    }

    @AfterEach
    void stop() {
        configured.server.stop(0);
        other.server.stop(0);
    }

    /** Only {@code configured} is on the allowlist. */
    private ZitiService service() {
        return new ZitiService(configured.url(), false);
    }

    @Test
    void probingAnUnlistedControllerSendsNothing() {
        var probe = service().probeController(other.url());
        assertFalse(probe.online());
        assertEquals("not a configured controller", probe.error());
        assertTrue(other.requests.isEmpty(), other.requests::toString);
        assertTrue(configured.requests.isEmpty(), configured.requests::toString);
    }

    @Test
    void signingInToAnUnlistedControllerIsRefusedBeforeAnyRequest() {
        ZitiService ziti = service();
        ZitiException e = assertThrows(ZitiException.class,
                () -> ziti.login(other.url(), "password", "admin", "pw", null));
        assertTrue(e.getMessage().contains("ziti.controllers"), e.getMessage());
        assertFalse(ziti.isAuthenticated());
        assertTrue(other.requests.isEmpty(), other.requests::toString);
    }

    @Test
    void anUnlistedControllerCannotBeSelected() {
        ZitiService ziti = service();
        assertThrows(ZitiException.class, () -> ziti.saveControllerUrl(other.url()));
        assertEquals(configured.url(), ziti.savedControllerUrl());
    }

    @Test
    void listedControllersCanBeChosenIgnoringCaseAndTrailingSlash() {
        ZitiService ziti = new ZitiService(configured.url() + "," + other.url(), false);
        assertEquals(List.of(configured.url(), other.url()), ziti.controllers());
        ziti.saveControllerUrl(other.url().toUpperCase() + "/");
        assertEquals(other.url(), ziti.savedControllerUrl());
        ziti.login(other.url() + "/", "password", "admin", "pw", null);
        assertTrue(ziti.isAuthenticated());
        assertEquals(other.url(), ziti.controllerUrl());
        assertTrue(configured.requests.isEmpty(), configured.requests::toString);
    }

    @Test
    void aRedirectNeverCarriesTheSessionToAnotherHost() {
        ZitiService ziti = service();
        ziti.login(configured.url(), "password", "admin", "pw", null);
        configured.identitiesRedirect = other.url() + "/steal";
        try {
            ziti.list("identities");
        } catch (ZitiException expected) {
            // A redirect is not API data; failing is fine, following it is not.
        }
        assertTrue(other.requests.isEmpty(), other.requests::toString);
        assertTrue(other.sessionHeaders.isEmpty());
        assertTrue(configured.sessionHeaders.contains("secret-session"));
    }

    @Test
    void aRedirectingControllerIsReportedWithItsTarget() {
        configured.identitiesRedirect = null;
        HttpServer redirecting = configured.server;
        redirecting.removeContext("/");
        redirecting.createContext("/", x -> {
            x.getResponseHeaders().add("Location", "https://elsewhere.example:1280/edge/management/v1/version");
            x.sendResponseHeaders(301, -1);
            x.close();
        });
        var probe = new ZitiService(configured.url(), false).probeController(configured.url());
        assertFalse(probe.online());
        assertTrue(probe.error().contains("https://elsewhere.example:1280"), probe.error());
    }

    @Test
    void unknownSignInMethodsAreRefusedBeforeAnyRequest() {
        ZitiService ziti = new ZitiService(configured.url(), false);
        assertThrows(ZitiException.class,
                () -> ziti.login(configured.url(), "password&method=cert", "admin", "pw", null));
        assertTrue(configured.requests.isEmpty(), configured.requests::toString);
    }
}
