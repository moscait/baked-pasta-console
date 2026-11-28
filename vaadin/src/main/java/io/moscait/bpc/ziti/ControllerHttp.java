package io.moscait.bpc.ziti;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.CookieManager;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.Collection;
import java.util.Map;

import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509ExtendedTrustManager;

/**
 * The HTTP/TLS side of talking to a controller: which certificates to trust (JVM default, a configured CA
 * bundle, or trust-all), the optional client certificate for mutual TLS, and the clients built from those.
 *
 * <p>Clients never follow redirects. Authenticated requests carry a session token or bearer token, and a
 * redirect must not be able to send it to another host; the OIDC flow walks its redirects by hand.
 */
final class ControllerHttp {

    private static final SecureRandom RANDOM = new SecureRandom();

    /** Trust managers for a configured CA bundle; null means the JVM's default trust store. */
    private final TrustManager[] caTrust;
    private final boolean trustAll;
    private KeyManager[] clientKeys;
    private String clientCertSubject;
    private HttpClient client;

    ControllerHttp(boolean trustAll, TrustManager[] caTrust) {
        this.trustAll = trustAll;
        this.caTrust = caTrust;
    }

    boolean trustAll() {
        return trustAll;
    }

    String clientCertSubject() {
        return clientCertSubject;
    }

    /** Loads a PKCS#12 client certificate used for "Client Cert" sign-in (mutual TLS). */
    void loadClientCertificate(byte[] pkcs12, char[] password) {
        try {
            KeyStore ks = KeyStore.getInstance("PKCS12");
            ks.load(new ByteArrayInputStream(pkcs12), password);
            KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            kmf.init(ks, password);
            String alias = ks.aliases().hasMoreElements() ? ks.aliases().nextElement() : null;
            clientKeys = kmf.getKeyManagers();
            clientCertSubject = alias != null && ks.getCertificate(alias) instanceof X509Certificate x
                    ? x.getSubjectX500Principal().getName()
                    : "client certificate";
            client = null;
        } catch (Exception e) {
            throw new ZitiException("Could not read the PKCS#12 file: " + ZitiException.text(e), 0, e);
        }
    }

    void clearClientCertificate() {
        clientKeys = null;
        clientCertSubject = null;
        client = null;
    }

    /** The shared client for this session (rebuilt when the TLS settings change). */
    HttpClient client() {
        if (client == null) {
            client = newClient(null);
        }
        return client;
    }

    /** A fresh client with its own cookie jar (OIDC needs one per sign-in). */
    HttpClient newClient(CookieManager cookies) {
        HttpClient.Builder b = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8))
                .followRedirects(HttpClient.Redirect.NEVER);
        if (cookies != null) {
            b.cookieHandler(cookies);
        }
        SSLContext ctx = sslContext();
        if (ctx != null) {
            b.sslContext(ctx);
        }
        return b.build();
    }

    HttpResponse<String> send(String method, String url, Map<String, String> headers, String body) {
        return send(method, url, headers, body, client());
    }

    static HttpResponse<String> send(String method, String url, Map<String, String> headers, String body,
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

    /** Null when the JVM defaults apply (no CA bundle, no client certificate, no trust-all). */
    private SSLContext sslContext() {
        if (!trustAll && caTrust == null && clientKeys == null) {
            return null;
        }
        try {
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(clientKeys, trustAll ? TRUST_ALL : caTrust, RANDOM);
            return ctx;
        } catch (Exception e) {
            throw new ZitiException("Could not set up TLS: " + e.getMessage(), 0, e);
        }
    }

    /**
     * Trust managers that accept exactly the certificates in a PEM bundle (e.g. the controller's CA from
     * {@code /.well-known/est/cacerts}), with normal chain and hostname checks.
     */
    static TrustManager[] trustManagersFromPem(Path pem) {
        try (InputStream in = Files.newInputStream(pem)) {
            Collection<? extends Certificate> certs = CertificateFactory.getInstance("X.509").generateCertificates(in);
            if (certs.isEmpty()) {
                throw new IllegalArgumentException("no certificates found");
            }
            KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
            ks.load(null, null);
            int i = 0;
            for (Certificate c : certs) {
                ks.setCertificateEntry("ca-" + i++, c);
            }
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(ks);
            return tmf.getTrustManagers();
        } catch (Exception e) {
            throw new IllegalStateException("Could not load controller CA bundle " + pem + ": " + e.getMessage(), e);
        }
    }

    // Must be an X509ExtendedTrustManager: the JDK wraps a plain X509TrustManager and still checks the
    // hostname, so a self-signed certificate issued for another name would be refused.
    private static final TrustManager[] TRUST_ALL = { new X509ExtendedTrustManager() {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) {
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) {
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, Socket s) {
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, Socket s) {
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine e) {
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine e) {
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    } };
}
