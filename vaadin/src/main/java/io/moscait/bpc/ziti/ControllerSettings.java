package io.moscait.bpc.ziti;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import javax.net.ssl.TrustManager;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The controllers this console may talk to, and how their certificates are checked. Set on the server only.
 *
 * <p>The console has no login of its own, and every controller call is made by this server, so letting a
 * visitor type any URL would let anyone make the server send requests to any host it can reach. Instead the
 * server is configured with an allowlist ({@code ziti.controllers}); users pick from it and nothing else is
 * ever contacted. The application refuses to start without a valid list.
 */
@Component
public class ControllerSettings {

    public static final String PROPERTY = "ziti.controllers";

    private final List<String> controllers;
    private final boolean trustAll;
    private final TrustManager[] caTrust;
    private final String caFile;

    public ControllerSettings(@Value("${ziti.controllers:}") String controllers,
            @Value("${ziti.trust-all-certificates:false}") boolean trustAll,
            @Value("${ziti.controller-ca-file:}") String caFile) {
        this.controllers = parse(controllers);
        this.trustAll = trustAll;
        this.caFile = caFile == null || caFile.isBlank() ? null : caFile.trim();
        this.caTrust = this.caFile == null ? null : ControllerHttp.trustManagersFromPem(Path.of(this.caFile));
    }

    /** Controller URLs separated by commas, spaces or newlines; at least one, each {@code http(s)://host[:port]}. */
    static List<String> parse(String raw) {
        List<String> out = new ArrayList<>();
        for (String part : (raw == null ? "" : raw).trim().split("[,\\s]+")) {
            if (part.isEmpty()) {
                continue;
            }
            String url = normalize(part);
            String problem = problem(url);
            if (problem != null) {
                throw new IllegalStateException(PROPERTY + ": \"" + part + "\" " + problem);
            }
            if (out.stream().noneMatch(u -> u.equalsIgnoreCase(url))) {
                out.add(url);
            }
        }
        if (out.isEmpty()) {
            throw new IllegalStateException(PROPERTY + " (ZITI_CONTROLLERS) must list at least one controller URL, "
                    + "e.g. https://ctrl.example.com:1280. The console only ever contacts the controllers listed there.");
        }
        return List.copyOf(out);
    }

    private static String problem(String url) {
        try {
            URI u = new URI(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("https") && !scheme.equals("http")) {
                return "is not an http(s) URL";
            }
            if (u.getHost() == null || u.getHost().isEmpty()) {
                return "has no host";
            }
            if (u.getRawUserInfo() != null || u.getRawQuery() != null || u.getRawFragment() != null
                    || (u.getRawPath() != null && !u.getRawPath().isEmpty())) {
                return "must be just scheme://host[:port], with no path, query or credentials";
            }
            return null;
        } catch (URISyntaxException e) {
            return "is not a valid URL";
        }
    }

    static String normalize(String url) {
        return url == null ? "" : url.trim().replaceAll("/+$", "");
    }

    public List<String> controllers() {
        return controllers;
    }

    /** The first configured controller: the one a new session starts with. */
    public String defaultController() {
        return controllers.getFirst();
    }

    /** The configured URL matching {@code url} (ignoring case and trailing slashes), if it is allowed. */
    public Optional<String> match(String url) {
        String n = normalize(url);
        return controllers.stream().filter(c -> c.equalsIgnoreCase(n)).findFirst();
    }

    public boolean trustAll() {
        return trustAll;
    }

    TrustManager[] caTrust() {
        return caTrust;
    }

    /** How controller certificates are checked, for display. */
    public String certificatePolicy() {
        if (trustAll) {
            return "Any certificate is accepted (ziti.trust-all-certificates).";
        }
        if (caFile != null) {
            return "Trusted CA bundle " + caFile + ", with hostname checks.";
        }
        return "This server's default trust store, with hostname checks.";
    }
}
