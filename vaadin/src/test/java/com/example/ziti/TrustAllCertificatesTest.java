package com.example.ziti;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;

/** A self-signed controller whose certificate names another host (common with quickstart PKI). */
class TrustAllCertificatesTest {

    private HttpsServer server;
    private String url;

    @BeforeEach
    void start() throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (InputStream in = getClass().getResourceAsStream("/tls/other-host.p12")) {
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
}
