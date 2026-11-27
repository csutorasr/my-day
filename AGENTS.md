# AGENTS.md

Notes for coding agents working on this repo. Read `README.md` first.

## Layout

- `skills/*/SKILL.md`: the plugin's skills. `skills/loop/bin/state.mjs` is the CLI the loop runs.
- `skills/loop/templates/<profile>/`: a profile = `SETUP.md` (its interview) + the `.md` files it
  writes (`dev`, `dev-bundle`, `pm`); shared by all: `templates/WRITES.md` (outward-write policy),
  `templates/TRACKERS.md` (tracker interview), `templates/DREAM.md`. A new kind of loop is a new
  profile folder, not new code. `LOOP.md`'s `## Files` section is the manifest `config missing`
  checks; `requires:` lists the MCP servers / CLIs it needs.
- `skills/loop/lib`: state DB, config, forge and helpers; `home.mjs` is the machine home
  (`~/.my-day`, `MY_DAY_HOME`): loop registry, liveness, migration. `skills/loop/server`: the one
  dashboard server per machine, reading every registered loop's `state.db`. `runs.mjs` holds the
  runners that work outside the loop session — `claude -p` processes (`runner: claude-p`) and T3
  Code threads (`runner: t3`): chain files in `.my-day/runs/` (`runner` in the file says which).
  `t3.mjs` is everything T3 Code: host detection (`CLAUDE_CODE_ENTRYPOINT=t3-code`,
  `T3CODE_THREAD_ID`), the `t3` CLI calls and `threadState` (what `t3 thread show --json` means).
  Tests use `test/fixtures/fake-claude.mjs` via `CLAUDE_BIN` and `test/fixtures/fake-t3.mjs` via
  `T3_BIN` (+ `FAKE_T3_HOME`) — never start a real `claude` or `t3` in tests.
- `skills/loop/ui`: the dashboard UI (React + Vite + Tailwind v4 + shadcn/ui on Base UI), an npm
  workspace. `src/components/ui` is shadcn's (add with `pnpm dlx shadcn@latest add <name>` run in
  `skills/loop/ui`); app components compose them. `skills/loop/test`: `node --test` suites.
- `skills/loop/e2e`: Playwright test on imaginary workspaces under a temp home (`seed.mjs`: three
  running loops — two dev, one pm — and one stopped); writes the README screenshots.

## Rules

- Node ≥ 22.13, ES modules, no runtime dependencies beyond the optional `web-push`. The UI's
  packages are only build inputs (bundled into `server/public`); nothing builds at install time.
- **UI styling:** shadcn components and Tailwind classes with the preset's tokens
  (`src/globals.css`; status tones `success` / `warning` / `danger`, `link`). No hand-written CSS
  files; dark mode is the `.dark` class on `<html>`.
- Run `npm test` before every commit. It needs no `npm install`.
- CI (`.github/workflows/ci.yml`) runs the unit tests on Node 22 and 24, rebuilds the UI and fails
  if `skills/loop/server/public` differs from what was committed, and runs the e2e test.
- **UI changes:** edit `skills/loop/ui`, run `npm run ui:build` and commit
  `skills/loop/server/public` together with the sources. `npm test` fails on a stale build.
- **Keep the README screenshots up to date.** After any visible dashboard change, run
  `npm run test:e2e` and commit `docs/dashboard.png` and `docs/dashboard-loop.png`. The test seeds an imaginary workspace
  (`skills/loop/e2e/seed.mjs`), starts the real server on it and captures the page in Chrome
  (set `PW_CHANNEL=` and run `npx playwright install chromium` to use Playwright's Chromium).
  Extend the seed when a new panel or state should show; never screenshot real workspace data.
- Tests never touch the real `~/.my-day`: set `MY_DAY_HOME` to a temp dir.
- Tests may themselves run inside a T3 Code thread: a test that spawns the CLI first deletes
  `CLAUDE_CODE_ENTRYPOINT`, `T3CODE_*` and `T3_BIN` from the environment (see `cli.test.mjs`), or
  `bootstrap` would see a T3 host and call the real `t3`.
- **T3 Code:** Node reaches T3 Code only through the `t3` CLI (`lib/t3.mjs`); the MCP tools
  (`preview_open`, `t3_thread_interrupt` …) exist only for the model, so skills name them as "when
  available". The CLI cannot stop a thread and cannot start one in an existing worktree —
  `run-stop`, timeouts, the one-thread-per-worktree check and `t3Project` are built around that;
  keep outputs and docs honest about it. Skills must not depend on `TaskList` or Remote Control
  (neither exists in T3 Code).
- The dashboard server never talks to a code host or tracker. Dashboard actions are recorded
  as events; the loop acts on them on its next tick.
- Bump the version in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
  with every user-visible change.
