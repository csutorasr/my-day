# AGENTS.md

Notes for coding agents working on this repo. Read `README.md` first.

## Layout

- `skills/*/SKILL.md`: the plugin's skills. `skills/loop/bin/state.mjs` is the CLI the loop runs.
- `skills/loop/lib`: state DB, config, forge and helpers. `skills/loop/server`: the dashboard server.
- `skills/loop/ui`: the dashboard UI (React + Vite). `skills/loop/test`: `node --test` suites.
- `skills/loop/e2e`: Playwright test on an imaginary workspace (`seed.mjs`); writes the README screenshot.

## Rules

- Node ≥ 22.13, ES modules, no runtime dependencies beyond the optional `web-push`. Vite and
  React are dev dependencies; nothing builds at install time.
- Run `npm test` before every commit. It needs no `npm install`.
- CI (`.github/workflows/ci.yml`) runs the unit tests on Node 22 and 24, rebuilds the UI and fails
  if `skills/loop/server/public` differs from what was committed, and runs the e2e test.
- **UI changes:** edit `skills/loop/ui`, run `npm run ui:build` and commit
  `skills/loop/server/public` together with the sources. `npm test` fails on a stale build.
- **Keep the README screenshot up to date.** After any visible dashboard change, run
  `npm run test:e2e` and commit `docs/dashboard.png`. The test seeds an imaginary workspace
  (`skills/loop/e2e/seed.mjs`), starts the real server on it and captures the page in Chrome
  (set `PW_CHANNEL=` and run `npx playwright install chromium` to use Playwright's Chromium).
  Extend the seed when a new panel or state should show; never screenshot real workspace data.
- The dashboard server never talks to a code host or tracker. Dashboard actions are recorded
  as events; the loop acts on them on its next tick.
- Bump the version in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
  with every user-visible change.
