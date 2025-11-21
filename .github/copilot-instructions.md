<!-- Copilot / AI agent instructions for the HFS repository -->

# HFS — AI contributor quick guide

This project is the HFS (HTTP File Server) monorepo. The goal of this file is to give an AI coding agent the concise, practical knowledge needed to be productive immediately.

Key facts
- **Runtime:** Node.js (requirement enforced in `src/index.ts`) — minimum `18.15.0` (see `package.json`).
- **Workspaces:** Root `package.json` uses npm workspaces: `admin`, `frontend`, `shared`, `mui-grid-form`.
- **Language:** TypeScript for server and parts of frontend; built outputs are emitted to `dist/`.

Architecture (big picture)
- Server: `src/` contains the Koa-based HTTP server. Entry point: `src/index.ts`. Middlewares are composed here (session, plugins, throttler, API mounting).
- APIs: API endpoints are split into `frontEndApis` and `adminApis` and mounted together under `API_URI` (see `src/index.ts` and `src/frontEndApis.ts`). Avoid duplicating endpoint names — code asserts no clashes.
- GUI: Two separate front-end apps are served: the admin UI in `admin/` and the public frontend in `frontend/`. Serving logic is in `src/serveGuiAndSharedFiles.ts` and `src/serveGuiFiles.ts` and uses environment vars `FRONTEND_PROXY` and `ADMIN_PROXY` for dev-mode proxies.
- VFS & files: Virtual filesystem logic lives in `src/vfs.ts` and is heavily used by `serveGuiAndSharedFiles.ts`, `serveFile.ts`, upload handlers, and plugins.
- Plugins: `plugins/` contains built-in plugins. Plugin hooks are wired via `src/plugins.ts` and `pluginsMiddleware` in `src/index.ts`.
- Packaging: `build-server` compiles TypeScript into `dist/` and `dist` is used for producing binaries with `pkg` (see `package.json` scripts and `afterbuild.js`).

Developer workflows & the exact commands to use
- Quick dev server (auto-restarts on server TS changes):
  - `npm run watch-server` (uses `nodemon` + `tsx`).
  - To run proxied for Vite frontends: `npm run watch-server-proxied` (sets `FRONTEND_PROXY` and `ADMIN_PROXY`).
- Start frontends individually (workspace):
  - Admin: `npm run start-admin` (runs `npm run start --workspace=admin`).
  - Frontend: `npm run start-frontend`.
- Build everything (packaging + tests): `npm run build-all` — this runs audits, compiles server, runs tests, and builds frontends/admin.
- Build server only: `npm run build-server` (emits `dist/`).
- Run tests:
  - Unit / node tests: `npm test` (uses `tsx` test harness). For tests that need a running server: `npm run test-with-server` (the script launches `dist/src` and runs tests against it, then shuts down the server).
  - Playwright UI tests: `npm run test-ui` (calls `npx playwright test frontend` and serial tests). Use `npm run test-with-ui` to get Playwright UI runner.
- Packaging / distribution: `npm run dist` and related `dist-*` scripts use `pkg` to create OS-specific binaries.

Repository & coding conventions specific to this project
- Entrypoint and middleware pattern: the server composes many small Koa middlewares; prefer implementing features as middlewares that plug into `src/index.ts` unless they are pure library code.
- API registration: add endpoints to either `frontEndApis` or `adminApis` (do not modify both). Search for `frontEndApis` / `adminApis` to see existing patterns.
- Config: configuration keys and defaults live in `src/config.ts` and `central.json`. `config.md` documents runtime config. The runtime config file is `config.yaml` in the cwd by default.
- Environment flags:
  - `DEV` / `HFS_DEBUG` — toggles extra logging and dev-mode behaviors.
  - `FRONTEND_PROXY`, `ADMIN_PROXY` — used when running server in dev while frontend is served by Vite.
  - `COOKIE_SIGN_KEYS` — comma-separated keys for session signing.
  - `DISABLE_UPDATE` — useful for containerized builds.
- Frontend serving: the server may proxy to vite during development. `serveGuiAndSharedFiles.ts` contains the heuristics (look for `DEV` checks and `FRONTEND_PROXY`).

Important files to inspect for any change or feature
- `src/index.ts` — server bootstrap and middleware composition.
- `src/serveGuiAndSharedFiles.ts` and `src/serveGuiFiles.ts` — how frontend/admin apps are discovered and served.
- `src/vfs.ts` — virtual filesystem model and path/url translation (`urlToNode`, `walkNode`).
- `src/plugins.ts` and `plugins/` — plugin lifecycle and example plugins.
- `src/*Apis.ts` (e.g., `adminApis.ts`, `frontEndApis.ts`) — API endpoints and permission checks.
- `package.json` (root) — scripts, workspace config, Node engine requirement.
- `dev.md` and `dev-plugins.md` — developer-specific notes and plugin authoring tips.

Patterns & gotchas discovered in the codebase
- Avoid changing endpoints directly in router code; add handlers to the appropriate `*Apis` module so the `API_URI` mounting remains consistent.
- The server expects to be started with cwd containing `config.yaml` (or `--cwd` passed). Tests use `tests/work` as a temporary cwd — mimic that pattern when writing tests.
- Many operations emit events via `events` (an EventEmitter). Use `events.emit` and `events.on` to participate in cross-cutting behaviors.
- Binary packaging relies on `pkg` and expects assets declared in `package.json` `pkg.assets`. If adding static assets, update both `files` and `pkg.assets` as needed.

How to propose changes safely
- For server-side code changes: run `npm run watch-server` locally and exercise APIs with the frontend or curl. If your change affects front-end bundles, use `npm run build-server` + `npm run build-admin` / `npm run build-frontend`.
- For UI changes: run the appropriate workspace dev server (`npm run start-admin` or `npm run start-frontend`) and use `watch-server-proxied` on the server to test integrated behavior.
- For changes that impact distribution (binaries), run `npm run build-all` and `npm run dist-uncommitted` on CI-like environment; packaging is stateful and can modify `dist/` and stashes.

Examples (copyable)
- Start dev server + admin dev UI (two terminals):
  - Terminal 1: `npm run start-admin`
  - Terminal 2: `npm run watch-server-proxied`
- Run integration tests that expect a running server (single command):
  - `npm run build-server && npm run test-with-server`

<!-- End of file -->
