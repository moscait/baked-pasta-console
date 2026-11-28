# Contributing

Thanks for helping improve Baked Pasta Console. Bug reports, fixes and feature ideas are all welcome.

Security problems are the exception: please report them privately as described in [SECURITY.md](SECURITY.md), not in an issue.

## Getting started (`web/`)

You need Node.js 22 (the version CI uses) and npm.

```bash
cd web
npm ci
npm run dev
```

With no OpenZiti controller at the dev server's address, the console opens the Interactive Demo Sandbox, with sample identities, services and policies stored in your browser. To work against a real controller, choose it on the sign-in page.

## Before you open a pull request

Run the same checks CI runs from `web/`:

```bash
cd web
npm run check      # lint, typecheck and unit tests
npm run build      # production build, including the Content Security Policy
```

Please also:

- add or update tests for logic you change; pure logic (`*.logic.ts`, `service-configs.ts`, `problem-rows.ts`) is tested with Vitest next to the code;
- try the change in the demo sandbox, and against a controller if it touches sign-in or API calls;
- keep pull requests focused on one change, and describe what you changed and how you checked it.

## Code conventions

- TypeScript throughout; `any` is not allowed outside test files. API shapes live in `web/src/services/api-types.ts`.
- All controller calls go through `zitiService` in `web/src/services/ziti-service.ts`, which handles authentication, token refresh and the demo sandbox. Don't call `fetch` from components.
- Changes made from the Access Canvas or the wizard are staged as operations and applied together, with automatic rollback if a step fails. Keep that model when adding new kinds of change.

## Regenerating the diagrams and logo

The README diagrams and the logo are generated SVGs with PNG renders. Edit the generator scripts, not the SVGs.

Diagrams (Python 3 standard library only, plus `rsvg-convert` from librsvg for the PNGs):

```bash
python3 scripts/diagrams/build_diagrams.py
for f in assets/diagrams/*.svg; do rsvg-convert -w 2400 "$f" -o "${f%.svg}.png"; done
```

Logo: this also needs Python `fontTools` and the [Fraunces](https://github.com/undercasetype/Fraunces) variable font (SIL Open Font License), whose path you pass in `FRAUNCES_TTF`. The usage notes at the top of `scripts/logo/build_logo.py` give the full commands.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), the same license as the project.
