# Security Policy

Baked Pasta Console is an admin console: it signs in to an OpenZiti controller and can change identities, services and policies. Security reports are welcome and taken seriously.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can see the report.

Please include:

- what an attacker could do, and what they need first (for example, a signed-in admin opening a crafted link);
- steps to reproduce, or a proof of concept;
- the console version or commit, how it is served (`npm run dev`, a controller's `zac` binding, or another web server), and the OpenZiti controller version if it matters;
- any suggested fix.

You will get an acknowledgement once the report has been read, and updates as it is investigated. When a fix is released, the advisory credits the reporter unless you ask not to be named.

## Supported versions

Fixes go into the latest release and the `main` branch. Older releases do not receive security updates.

## Scope

In scope: this repository's code and build output, for example:

- cross-site scripting or HTML injection from controller data (names, attributes, config JSON);
- leaking or mishandling session tokens, OIDC tokens or refresh tokens;
- flaws in the OIDC PKCE sign-in (state, nonce, redirect handling);
- weaknesses in the Content Security Policy added to production builds;
- the console sending data anywhere other than the controller it is signed in to;
- Access Canvas or wizard changes that apply something different from what the pending-changes review showed.

Out of scope:

- vulnerabilities in the OpenZiti controller, routers, tunnelers or SDKs. Report those to the OpenZiti project as described in its [security policy](https://github.com/openziti/ziti/security/policy).
- the Interactive Demo Sandbox's data, which is fictional and stored only in your own browser;
- issues that require an attacker who already controls the admin's browser or the web server serving the console.

## How the console handles credentials

So that reviewers know what is intended:

- **Session storage.** Like the upstream OpenZiti console, the session (`zt-session` token or OIDC access token) is kept in the browser's `localStorage` under `ziti.settings`. OIDC refresh tokens are stored there too, so a session can be renewed without signing in again. Signing out clears them. Any script running on the console's origin can read `localStorage`, which is why the build adds a strict Content Security Policy.
- **Content Security Policy.** Production builds include a CSP that allows only the console's own scripts (by hash) and blocks plugins. Connections are allowed to the console's own origin and to any HTTPS host, so the console can manage a controller on a different address; it does not restrict which HTTPS host that is.
- **Network.** The console talks only to the controller it is signed in to. It loads no analytics, fonts or other third-party resources.
- **Passwords** entered on the sign-in page are sent to the controller's authenticate endpoint and are not stored.
