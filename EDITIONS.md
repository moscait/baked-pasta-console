# Web vs. Vaadin Editions

**Baked Pasta Console** is maintained in two editions inside this repository, sharing the same visual design language, OpenZiti domain model, and documentation assets:

- **[`web/`](web/)** — Static **React 19 + TypeScript + Vite** single-page application (SPA), packaged as a drop-in `ziti-console.zip` for the OpenZiti Controller's `zac` binding (released under `web-v*` tags).
- **[`vaadin/`](vaadin/)** — Server-side **Java + Vaadin Flow + Spring Boot** application, packaged as an executable JAR or container image (released under `vaadin-v*` tags).

Both talk to the same OpenZiti Edge Management API (`/edge/management/v1`), but their deployment models, operational footprints, and security properties are meaningfully different.

---

## At a Glance

| Dimension | `web/` (React / Vite SPA) | `vaadin/` (Java / Vaadin Flow) |
| :--- | :--- | :--- |
| **Architecture** | Client-side SPA in the browser | Server-side UI on the JVM (Vaadin Flow + Spring Boot) |
| **Stack** | React 19, TypeScript, Vite, Tailwind CSS, React Flow | Java 25, Vaadin 25, Spring Boot 4, Maven |
| **Deployment Artifact** | Static files (`web/dist/`, `ziti-console.zip`) | Executable JAR / Docker image (`vaadin/Dockerfile`) |
| **Upstream ZAC Drop-In** | **Yes** — served directly by the OpenZiti Controller's `zac` web binding | **No** — runs as a separate JVM web service |
| **Runtime Footprint** | Zero extra servers (pure static assets) | Dedicated JVM process (heap scales with active sessions) |
| **Controller API Access** | Browser connects directly to `/edge/management/v1` over HTTPS | Server connects to `/edge/management/v1`; browser only talks to Vaadin |
| **Session & Token Storage** | Browser `localStorage['ziti.settings']` (matches upstream ZAC contract) | Server-side `VaadinSession` / Spring session; browser gets `HttpOnly` cookie only |
| **OIDC Client Type** | Public client (PKCE, no client secret) | Confidential client (client secret / `private_key_jwt`) or mTLS |
| **Server-Side RBAC & Audit** | Limited to what the OpenZiti Controller enforces | Full Spring Security RBAC, server-enforced guardrails, structured audit logs |
| **Zero-Setup Evaluation** | Built-in browser **Interactive Demo Sandbox** (no backend needed) | Requires running the JVM app locally (`./mvnw`) or via Docker |
| **Release Tags** | `web-v*` | `vaadin-v*` |

---

## Architectural Differences

### `web/` — Static Drop-In SPA
- Everything runs in the admin's browser: rendering, Access Canvas layout, staged change-set diffs, and direct `fetch()` calls to the OpenZiti Controller.
- Because it builds to plain HTML/JS/CSS, the OpenZiti Controller itself can serve it at `/zac/` with no extra infrastructure, matching `openziti/ziti-console`'s `./build.sh <base-href>` and `ziti-console.zip` contract.

### `vaadin/` — Server-Side JVM Application
- UI components, state, validation, and OpenZiti Management API calls all execute in Java on the server; Vaadin Flow synchronizes minimal DOM updates to the browser over its UIDL channel.
- Runs as a standalone Spring Boot service (or container) positioned between the admin's browser and the OpenZiti Controller.

---

## Security Comparison

### Where `vaadin/` Is Stronger

1. **No OpenZiti Tokens in Browser Storage**
   - `web/` stores `zt-session` and OIDC tokens in `localStorage['ziti.settings']` to stay compatible with upstream ZAC, relying on a strict Content Security Policy ([`web/vite.config.ts`](web/vite.config.ts)) as the main XSS backstop.
   - `vaadin/` keeps `zt-session`, OIDC refresh tokens, and controller credentials strictly on the server. The browser only receives an `HttpOnly`, `Secure`, `SameSite` session cookie, eliminating token theft via XSS or compromised browser extensions.

2. **Keep the Controller's Management API Dark**
   - `web/` requires the admin's browser to have direct HTTPS reachability to `/edge/management/v1` (and CORS when accessed cross-origin).
   - `vaadin/` lets you restrict the controller's management API to `127.0.0.1`, a private management subnet, or an OpenZiti overlay service accessed from the backend (e.g., via the OpenZiti Java SDK). The admin's browser never needs direct network access to the controller.

3. **Confidential OIDC & mTLS Authentication**
   - A browser SPA is inherently a public OIDC client (PKCE only) and has awkward UX for dedicated mTLS client certificates.
   - The Vaadin backend can act as a confidential OIDC client and authenticate to the controller using mTLS client certificates managed in a server keystore or secrets manager.

4. **Server-Enforced Authorization, Validation & Audit Trails**
   - In a browser SPA, hiding destructive actions or enforcing a review step is only a UI safeguard — a user with a valid `zt-session` can still call `/edge/management/v1` directly from DevTools.
   - With Vaadin + Spring Security, you can enforce read-only or scoped admin roles, validate every staged change-set on the server before calling the controller, enforce rate limits, and emit tamper-resistant SIEM audit logs (who changed what, before/after state, timestamp).

5. **Built-In CSRF & Smaller Client Surface**
   - Vaadin Flow enforces CSRF tokens on its UIDL channel (alongside Spring Security CSRF), escapes text by default, and avoids exposing API client code and schemas in browser bundles.

### Trade-Offs & Security Considerations for `vaadin/`

- **Additional Runtime to Harden & Patch**: `web/` adds zero runtime servers to your infrastructure; `vaadin/` introduces a long-running JVM / Spring Boot tier that must be kept patched and properly configured.
- **Per-User Session Isolation**: Each signed-in administrator should hold their own isolated OpenZiti session inside `VaadinSession` (with sensible idle timeouts), rather than proxying all users through a single shared super-admin credential.
- **XSS Hygiene Still Matters**: Vaadin's default escaping protects standard components, but any raw HTML/SVG injection (for example, rendering user-supplied OpenZiti entity names or tags via `Html` or `innerHTML`) must still be sanitized.

---

## Operational & UX Trade-Offs

- **Simplicity vs. Control**: `web/` is the fastest path to get running — drop `ziti-console.zip` into your controller's `zac` folder and go. `vaadin/` requires deploying and monitoring a JVM service or container, in exchange for enterprise network isolation, server-side RBAC, and auditability.
- **Scaling**: `web/` scales effortlessly because it is static files. `vaadin/` holds UI state in JVM memory per active user and requires sticky sessions (or session replication) if run across multiple replicas.
- **Client-Heavy Canvas Work**: Highly interactive, 60fps drag-and-drop canvas gestures (`web/`'s Free-Form Board and React Flow graph) run locally in the browser with zero network round-trips; in `vaadin/`, heavy canvas interactions require client-side Lit/JS components bridged to Java state.

---

## When to Choose Which

**Choose [`web/`](web/) when you want:**
- A **zero-infrastructure drop-in** served directly by the OpenZiti Controller's `zac` binding (`ziti-console.zip`).
- Instant evaluation via the built-in **Interactive Demo Sandbox**.
- No extra JVM/container tier to operate or patch.

**Choose [`vaadin/`](vaadin/) when you want:**
- **Dark management APIs** where browsers never directly reach the OpenZiti Controller.
- **No controller tokens in browser storage** (`HttpOnly` cookies + server-side sessions).
- **Confidential OIDC or mTLS** authentication to the controller.
- **Server-enforced RBAC, guardrails, and centralized audit logging** integrated with Spring Security and existing Java infrastructure.
