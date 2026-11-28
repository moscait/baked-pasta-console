# My Application

A Spring Boot + Vaadin project. Build your UI in pure Java — no HTML, no JavaScript.

> **New to Vaadin?** The 5-minute [Quickstart](https://vaadin.com/quickstart) walks you from here to your first running app, a live code change, and an AI-assisted edit with Copilot.

---

## Fastest start — no plugin needed

From the project folder:

```bash
./mvnw spring-boot:run        # Windows: mvnw.cmd spring-boot:run
```

Then open **http://localhost:8080**.

The first start takes ~30 seconds while Maven downloads dependencies. This project has no views yet, so the browser shows a *Could not navigate to ''* (route not found) page. That means the app is running: add your first view, a class annotated with `@Route("")`, to replace it.

> **Port 8080 already in use?** Stop the other process, or set `server.port=8081` in `src/main/resources/application.properties` and open that port instead.
>
> **To stop the app:** press `Ctrl+C` in the terminal (or the red Stop button if you launched from your IDE).

## Optional upgrade — instant hotswap

Running with `spring-boot:run` works, but Java code changes need a server restart. For **live reload** — edit Java, see it in the browser without restarting — install the **Vaadin plugin** and start the app through it:

- **IntelliJ IDEA:** install *Vaadin* from the JetBrains Marketplace → **Debug using Hotswap Agent** (dropdown next to Run). *Just installed it? Let IntelliJ finish indexing, or restart it, if the menu item isn't there yet.*
- **VS Code:** install the *Vaadin* extension → **Vaadin: Debug using Hotswap Agent** from the command palette.
- **Eclipse:** install the *Vaadin* plugin → right-click the project → **Run As → Vaadin Application**.

This is what makes the edit-and-see-it loop feel instant — and it's required for the AI edits in [Vaadin Copilot](https://vaadin.com/docs/latest/tools/copilot).

> **Run the app one way at a time.** `./mvnw spring-boot:run`, your IDE, and the Dev Loop all serve on port 8080, so stop one before starting another. If an AI coding agent edits the code for you, use the Dev Loop instead of the IDE — see [Agentic Development](#agentic-development).

---

## Ask your AI assistant about Vaadin (optional)

If you use Claude Code, Cursor, or another AI coding assistant, connect it to the **Vaadin MCP server** so it answers against real Vaadin docs and the exact API of your installed version — instead of guessing from outdated training data.

The one-time setup is described in [Vaadin MCP server](https://vaadin.com/docs/latest/building-apps/mcp).

---

## Agentic Development

If you develop with an AI coding agent, such as Claude Code or Codex, enable the Vaadin Dev Loop. It lets the agent make
its changes live in the running application with a single command, and tells it whether they took effect, without
restarting the application or checking screenshots. To enable it, run:

```bash
./mvnw vaadin:install-dev-cli
```

This installs the Dev Loop CLI into `.vaadin/`, and skills that teach your agent how to use it into `.agents/skills/` and
`.claude/skills/`. Commit these files with the rest of the project, and run the command again after upgrading Vaadin.

Once it is enabled, start the application through the Dev Loop, and leave the page open in the browser:

```bash
.vaadin/vaadin-dev start      # Windows: .vaadin\vaadin-dev.cmd start
```

The Dev Loop owns the application process and brings its own Hotswap Agent, so do not also start the application with
`./mvnw spring-boot:run` or an IDE run or debug configuration: the second launcher fights the Dev Loop for port 8080. Use
`.vaadin/vaadin-dev status` to see whether the application is running, and `.vaadin/vaadin-dev restart` instead of
restarting it from the IDE.

The Dev Loop is a preview feature. To learn more, including how to give your agent access to the Vaadin documentation,
see the [Dev Loop tutorial](https://vaadin.com/docs/v25/building-apps/agentic-development/dev-loop-tutorial).

---

## Build for production

```bash
./mvnw package
java -jar target/*.jar
```

To build a Docker image, run:

```bash
docker build -t baked-pasta-console-vaadin .
```

To run the image against your controllers (`ZITI_CONTROLLERS` is required; the container will not start without it):

```bash
docker run -p 8080:8080 -m 2g \
  -e ZITI_CONTROLLERS=https://ctrl.example.com:1280,https://staging-ctrl.example.com:1280 \
  baked-pasta-console-vaadin
```

The application is then available at http://localhost:8080. The `-m` option sets the memory limit of the container. The
application uses up to 75% of it for the Java heap, which holds the UI state of all users, so adjust the limit to fit
your application.

The console has no login of its own: anyone who can reach it can use the sign-in page. So it only ever talks to the
controllers listed in `ZITI_CONTROLLERS`: users pick one from a list on the sign-in page, and the server refuses any
other address, which stops it being used to reach other hosts on its network. Certificate settings are server-side
too.

| Variable | In the container | What it does |
| --- | --- | --- |
| `ZITI_CONTROLLERS` | **required** | Comma-separated controller URLs (`https://host:port`, no path). The first is the default. |
| `ZITI_CONTROLLER_CA_FILE` | (none) | PEM file with the controllers' CAs (mount it into the container; concatenate several). Use this instead of `ZITI_TRUST_ALL` for controllers with their own PKI; hostname checks still apply. |
| `ZITI_TRUST_ALL` | `false` | Accept any controller certificate, like `curl -k`. |
| `SESSION_COOKIE_SECURE` | `true` | Session cookie only over HTTPS (`http://localhost` counts as secure in browsers). |

To get the controller's CA as PEM:

```bash
curl -sk https://ctrl.example.com:1280/.well-known/est/cacerts | base64 -d \
  | openssl pkcs7 -inform DER -print_certs > controller-ca.pem
```

Every response carries `X-Frame-Options: DENY` and a `frame-ancestors 'none'` CSP, so the console cannot be embedded in
another site. Behind a reverse proxy, `X-Forwarded-*` headers are honoured only from private or loopback addresses.

## Learn more

- [Vaadin Quickstart](https://vaadin.com/quickstart) — the 5-minute getting-started path
- [Components](https://vaadin.com/docs/latest/components) — 50+ UI components, all callable from Java
- [Vaadin Copilot](https://vaadin.com/docs/latest/tools/copilot) — visual + AI editing in the browser
- [Full documentation](https://vaadin.com/docs)
