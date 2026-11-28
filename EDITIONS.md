# Web vs. Vaadin Editions

**Baked Pasta Console** is maintained in two editions inside this repository, sharing the same visual design language, OpenZiti domain model, and documentation assets:

- **[`web/`](web/)**: a static **React 19 + TypeScript + Vite** single-page application (SPA), packaged as a drop-in `ziti-console.zip` for the OpenZiti Controller's `zac` binding (released under `web-v*` tags).
- **[`vaadin/`](vaadin/)**: a server-side **Java + Vaadin Flow + Spring Boot** application, packaged as an executable JAR or multi-arch container image on GHCR (released under `vaadin-v*` tags).

Both talk to the same OpenZiti Edge Management API (`/edge/management/v1`), but their deployment models, operational footprints, and security properties are meaningfully different.

---

## At a Glance

| Dimension | `web/` (React / Vite SPA) | `vaadin/` (Java / Vaadin Flow) |
| :--- | :--- | :--- |
| **Architecture** | Client-side SPA in the browser | Server-side UI on the JVM (Vaadin Flow + Spring Boot) |
| **Stack** | React 19, TypeScript, Vite, Tailwind CSS, React Flow | Java 25, Vaadin 25, Spring Boot 4, Maven |
| **Deployment Artifact** | Static files (`web/dist/`, `ziti-console.zip`) | Executable JAR / container image (`ghcr.io/moscait/baked-pasta-console-vaadin`) |
| **Upstream ZAC Drop-In** | **Yes**: served directly by the OpenZiti Controller's `zac` web binding | **No**: runs as a separate JVM web service |
| **Runtime Footprint** | Zero extra servers (pure static assets) | Dedicated JVM process (heap scales with active sessions) |
| **Controller API Access** | Browser connects directly to `/edge/management/v1` over HTTPS | Server connects to `/edge/management/v1`; browser only talks to Vaadin |
| **Which Controllers** | Any controller the admin's browser can reach | Only those listed in the required `ZITI_CONTROLLERS` server setting |
| **Session & Token Storage** | Browser `localStorage['ziti.settings']` (matches upstream ZAC contract) | Server memory, per `VaadinSession`; the browser gets an `HttpOnly` session cookie only |
| **Sign-In Methods** | Password, client certificate (via the browser), external JWT, OIDC with PKCE | Password, uploaded PKCS#12 client certificate (mTLS from the server), external JWT, OIDC with PKCE run by the server |
| **Controller TLS Trust** | The browser's trust store | Server setting: JVM trust store, a CA bundle (`ZITI_CONTROLLER_CA_FILE`), or trust-all |
| **Server-Side RBAC & Audit** | Only what the OpenZiti Controller enforces | Not built in yet; the server tier is where it can be added (e.g. Spring Security) |
| **Demo Sandbox** | Built in, runs entirely in the browser | Built in, but needs the server running (`./mvnw` or the container) |
| **Release Tags** | `web-v*` | `vaadin-v*` |

---

## Architectural Differences

### `web/`: Static Drop-In SPA
- Everything runs in the admin's browser: rendering, Access Canvas layout, staged change-set diffs, and direct `fetch()` calls to the OpenZiti Controller.
- Because it builds to plain HTML/JS/CSS, the OpenZiti Controller itself can serve it at `/zac/` with no extra infrastructure, matching `openziti/ziti-console`'s `./build.sh <base-href>` and `ziti-console.zip` contract.

### `vaadin/`: Server-Side JVM Application
- UI components, state, validation, and OpenZiti Management API calls all execute in Java on the server; Vaadin Flow synchronizes minimal DOM updates to the browser over its UIDL channel.
- Runs as a standalone Spring Boot service (or container) positioned between the admin's browser and the OpenZiti Controller.
- Each browser session signs in to the controller with the admin's own credentials and holds its own OpenZiti session; there is no shared service account.

---

## Security Comparison

### Where `vaadin/` Is Stronger

1. **No OpenZiti Tokens in the Browser**
   - `web/` stores `zt-session` and OIDC tokens in `localStorage['ziti.settings']` to stay compatible with upstream ZAC, relying on a strict Content Security Policy ([`web/vite.config.ts`](web/vite.config.ts)) as the main XSS backstop.
   - `vaadin/` keeps `zt-session`, OIDC access and refresh tokens, and uploaded client certificates in server memory only. The browser receives an `HttpOnly`, `SameSite=Lax` session cookie (`Secure` in the container), so XSS or a compromised browser extension cannot read controller tokens.

2. **Keep the Controller's Management API Dark**
   - `web/` requires the admin's browser to have direct HTTPS reachability to `/edge/management/v1` (and CORS when accessed cross-origin).
   - `vaadin/` only needs the *server* to reach the controller, so the management API can be restricted to `127.0.0.1` or a private management subnet. The admin's browser never needs direct network access to the controller.

3. **Server-Controlled Controller List and TLS Trust**
   - `vaadin/` only ever connects to the controllers in `ZITI_CONTROLLERS`; users pick from that list, and the application refuses to start without it. This matters because the server makes the requests: without the list, anyone who can load the page could make the server contact arbitrary hosts on its network. Upstream ZAC's proxy server works the same way (`ZAC_CONTROLLER_URLS`).
   - Certificate trust is also a server setting. `ZITI_CONTROLLER_CA_FILE` trusts the controller's own CA with full chain and hostname checks, so self-signed controller PKI does not require turning verification off.
   - The controller HTTP client never follows redirects, so a session token cannot be forwarded to another host.

4. **Browser Hardening**
   - Every response carries `X-Frame-Options: DENY` and a `frame-ancestors 'none'` CSP (no clickjacking), `X-Content-Type-Options: nosniff`, a same-origin referrer policy, and HSTS over HTTPS.
   - Vaadin Flow protects its UIDL channel with a CSRF token, escapes text by default, and keeps API client code and schemas out of the browser bundle.

5. **A Place for Server-Enforced Policy (Not Yet Built)**
   - In a browser SPA, hiding destructive actions or enforcing a review step is only a UI safeguard: a user with a valid `zt-session` can still call `/edge/management/v1` directly from DevTools.
   - Because every call in `vaadin/` goes through the server, read-only or scoped roles, server-side validation of staged change-sets, rate limits, and audit logging *can* be enforced there (for example with Spring Security). None of this is implemented yet; today the OpenZiti Controller's own authorization is the only enforcement in both editions.

### Trade-Offs & Security Considerations for `vaadin/`

- **No Login of Its Own**: anyone who can reach the console can see its sign-in page and the Demo Sandbox. Controller access still requires valid OpenZiti credentials, but expose the console only where admins need it (private network, VPN, an OpenZiti service, or an authenticating reverse proxy).
- **Additional Runtime to Harden & Patch**: `web/` adds zero runtime servers to your infrastructure; `vaadin/` introduces a long-running JVM / Spring Boot tier that must be kept patched (Dependabot covers its Maven dependencies) and properly configured.
- **Reverse Proxies**: in the container, `X-Forwarded-*` headers are trusted only from private or loopback addresses. Put the console behind a proxy on such an address, or the forwarded scheme and host are ignored.
- **XSS Hygiene Still Matters**: Vaadin's default escaping protects standard components, but any raw HTML/SVG rendering (for example, OpenZiti entity names or tags in map tooltips) must still be escaped, as the map does today.

---

## Operational & UX Trade-Offs

- **Simplicity vs. Control**: `web/` is the fastest path to get running: drop `ziti-console.zip` into your controller's `zac` folder and go. `vaadin/` requires deploying and monitoring a JVM service or container (with `ZITI_CONTROLLERS` set), in exchange for keeping tokens and controller access on the server.
- **Scaling**: `web/` scales effortlessly because it is static files. `vaadin/` holds UI state in JVM memory per active user and requires sticky sessions (or session replication) if run across multiple replicas.
- **Client-Heavy Canvas Work**: highly interactive drag-and-drop canvas gestures (`web/`'s Free-Form Board and React Flow graph) run locally in the browser with zero network round-trips; in `vaadin/`, the Access Canvas board is a client-side Lit component bridged to Java state, and other interactions make a server round-trip.

---

## When to Choose Which

**Choose [`web/`](web/) when you want:**
- A **zero-infrastructure drop-in** served directly by the OpenZiti Controller's `zac` binding (`ziti-console.zip`).
- Instant evaluation via the **Interactive Demo Sandbox**, with nothing to run.
- No extra JVM/container tier to operate or patch.

**Choose [`vaadin/`](vaadin/) when you want:**
- **Dark management APIs** where browsers never directly reach the OpenZiti Controller.
- **No controller tokens in browser storage** (`HttpOnly` cookie, server-side sessions).
- A **fixed, server-configured set of controllers** and server-managed TLS trust.
- A server tier where **RBAC, guardrails, and audit logging** can be added later.
