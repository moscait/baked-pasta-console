package io.moscait.bpc.ziti;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.KeyStore;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;

/**
 * Controllers with their own PKI: one whose self-signed certificate names another host (common with
 * quickstart PKI), and one whose certificate is valid for localhost but not trusted by the JVM.
 */
class TrustAllCertificatesTest {

    private HttpsServer server;
    private String url;

    @BeforeEach
    void start() throws Exception {
        start("/tls/other-host.p12");
    }

    private void start(String keystore) throws Exception {
        if (server != null) {
            server.stop(0);
        }
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (InputStream in = getClass().getResourceAsStream(keystore)) {
            ks.load(in, "changeit".toCharArray());
        }
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, "changeit".toCharArray());
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), null, null);
        server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(ctx));
        server.createContext("/", x -> {
            byte[] body = "{\"data\":{\"version\":\"v1.5.0\",\"capabilities\":[]}}".getBytes(StandardCharsets.UTF_8);
            x.getResponseHeaders().add("Content-Type", "application/json");
            x.sendResponseHeaders(200, body.length);
            x.getResponseBody().write(body);
            x.close();
        });
        server.start();
        url = "https://localhost:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    void refusedWithoutTrustAll() {
        var probe = new ZitiService(url, false).probeController(url);
        assertFalse(probe.online());
        assertTrue(probe.error().contains("not trusted"), probe.error());
    }

    @Test
    void trustAllAcceptsItDespiteTheHostnameMismatch() {
        var probe = new ZitiService(url, true).probeController(url);
        assertTrue(probe.online(), probe.error());
    }

    @Test
    void aConfiguredCaBundleIsTrustedWithHostnameChecks() throws Exception {
        start("/tls/localhost.p12");
        String ca = Path.of(getClass().getResource("/tls/localhost-ca.pem").toURI()).toString();
        assertFalse(new ZitiService(url, false).probeController(url).online(), "JVM trust store must not trust it");
        var probe = new ZitiService(new ControllerSettings(url, false, ca)).probeController(url);
        assertTrue(probe.online(), probe.error());
    }

    @Test
    void aConfiguredCaBundleStillRefusesAnotherHostsCertificate() throws Exception {
        String ca = Path.of(getClass().getResource("/tls/localhost-ca.pem").toURI()).toString();
        var probe = new ZitiService(new ControllerSettings(url, false, ca)).probeController(url);
        assertFalse(probe.online());
        assertTrue(probe.error().contains("ziti.controller-ca-file"), probe.error());
    }
}
