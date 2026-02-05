# Repository Guidelines

## Project Structure & Module Organization
Core server logic sits in `src/` (TypeScript, Koa middleware, plugins). Shared React packages live under the workspace folders `frontend/`, `admin/`, `shared/`, and `mui-grid-form/`. Runtime assets (icons, central metadata) are in the repo root; packaged plugins reside in `plugins/`. Tests use `tests/` for Node-based suites and `e2e/` + `playwright.config.ts` for UI regression coverage. Build outputs land in `dist/`; avoid committing its contents manually.

## Docs Map
- `README.md` — overview, installation, and general usage.
- `config.md` — configuration keys and where config files are stored (includes `server_code` for backend scripting).
- `dev.md` — build, dev environment, tests, and coding guidelines.
- `dev-plugins.md` — plugin development and API reference (backend and frontend APIs).
- `SECURITY.md` — security policy and reporting.
- Wiki — some topics are documented only on the project wiki.

## Build, Test, and Development Commands
- `npm run watch-server` — start the TypeScript server with hot reload (set `FRONTEND_PROXY`/`ADMIN_PROXY` when pairing with dev UIs).
- `npm run watch-server-full` — boot both React apps plus the API server for integrated development.
- `npm run build-server` / `npm run build-frontend` / `npm run build-admin` — compile individual targets into `dist/`.
- `npm run build-all` — audit dependencies, rebuild everything, run API tests, and kick off frontend/admin builds in parallel. Use a 100s timeout.
- `npm run test-with-server` — execute the Node test suite (`tests/test.ts`) with related server. May require escalated permissions in sandboxed environments to bind to port 81.
- `npm run test-ui` — launch Playwright’s headless CI.

## Coding Style & Naming Conventions
Use TypeScript/ES2022 with 4-space indentation and single quotes except when JSON compatibility is needed. Prefer async/await over promise chains and keep streaming utilities (e.g., `AsapJStream`) in dedicated modules. Name files by responsibility (`*.ts` for services, `*.spec.ts` for tests) and React components in PascalCase. Run `tsc` implicitly via the build scripts; no separate lint step exists, so keep code self-explanatory and add succinct comments only for non-obvious flows.

## Testing Guidelines
Node-side tests rely on the built-in `node --test` runner via `npm test`. Place fixtures under `tests/work` where scripts already expect them. UI coverage uses Playwright (`tests-ui`/`frontend` suites); target critical upload/download flows and plugin management. Name new tests after the behavior they assert (e.g., `plugin-disable.test.ts`). Before pushing, run at least `npm test` and, when touching UI, the relevant Playwright suite.
When you want to run fewer tests, use `npm run test-with-server -- --test-name-pattern="<pattern>"`.
For long-running commands like tests/builds, use a 30s timeout unless a different value is requested.
Changes to the config are automatically reloaded and applied asap, no need to restart.

## Commit & Pull Request Guidelines
Recent history favors short, component-scoped subjects (`admin/plugins: faster list on get-more`). Follow that pattern: `<area>: <concise change>`. Keep commits focused and self-contained. Pull requests should describe motivation, summarize key changes, call out affected packages (`src`, `frontend`, etc.), and mention how to reproduce or verify. Include screenshots for UI changes and note which commands/tests were run. Reference GitHub issues when applicable and flag any follow-up work.
