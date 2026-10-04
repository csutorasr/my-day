---
name: loop
description: Use when the user says "my day", "start my day", "/my-day:loop", or wants the run-forever loop that resolves the workspace's tasks as its .my-day config says (dev profile - merges ready MRs/PRs, fixes review comments, develops assigned tickets on worktrees, triages unassigned work; pm profile - backlog hygiene, specs, feedback intake, stakeholder replies and status updates) and keeps a dashboard. Also the entry point on every loop wakeup.
---

# my-day loop (orchestrator)

This session owns the state, runs brainstorms, talks to the user and dispatches background
workers. It never writes product code. CLI: `${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/state.mjs`
(`$SM` below — write the full path in every Bash call). `$SM help` lists every command.
Config: `$SM config show <NAME>` (shared `X.md` + personal `X.local.md`).

## Start
1. `$SM bootstrap --new-session` on the first call of a session, `$SM bootstrap` after.
   `missing` non-empty → run the `my-day:setup` skill first. First call: `open <server.url>`.
   `sources.checkMcp` (first call of a session) → for each `mcp:<name>`, look for its tools
   (`mcp__*<name>*`, deferred ones included) and report `$SM source mcp:<name> ok|missing`.
2. Read `$SM config all` once per session; re-read a file after it changes.
3. Not inside `/loop` yet → invoke the built-in `loop` skill with `/my-day:loop` (self-paced); it runs
   the first tick right away.

## Tick
1. `$SM tick` → `schedule` (incl. `dreamDue` and `due`: other `<name>Schedule` slots that came
   round, e.g. `status`), `sync` (code-host delta), `act` (MR ids by verdict), `tickets`,
   `running`, `reviewsPending`, `openQuestions`, `approvedDrafts` (see *Outward writes*),
   `sources` (`down`, `unchecked`), `failed`, `fromDashboard`. Code host and reviews are done
   (`covered` reviews, see QUERY-MY-REVIEWS.md, are not pending).
   `fromDashboard` = what the user did on the dashboard since the last tick: `dashboard-answer`
   (a question answered/declined there — act on it exactly as on an answer in the session; a decline's
   `text` is the user's reason),
   `dashboard-request` (`action`: rebase | fix-pipeline | fix-review | merge | retry | elaborate | stop on `item` —
   the user's explicit go for that one action; do it this tick, `elaborate` → reply in the session via
   `my-day:summary`), `dashboard-pause` (just acknowledge it in the session).
2. Read `LOOP.md`'s *Tick priority*: it names, per step, the rules file to follow (the workspace's
   profile decides what is there — e.g. tracker queries, merges, workflows). Run its read-only
   refresh (the syncs listed before the numbered steps) on every tick. A `LOOP.md` without a
   `## Files` section was set up before profiles: use the *Tick priority* of
   `${CLAUDE_PLUGIN_ROOT}/skills/loop/templates/dev/LOOP.md` instead.
3. `schedule.inHours` false → skip to step 6 (read-only outside hours) — except a `stop` request,
   which always runs. `schedule.paused` true → no dispatches or outward actions either; still handle
   `fromDashboard` answers and requests.
4. Act in the order of the *Tick priority*; workers only within `schedule.freeSlots`.
   Last: `schedule.dreamDue` and no brainstorm running → run `my-day:dream` here in the
   main session (never as a worker, never in the cloud: it needs the local DB and
   `*.local.md`). A brainstorm in progress → leave it for the next tick.
5. `$SM prune` once a day.
6. `ScheduleWakeup`: prompt `/loop /my-day:loop`, `delaySeconds` = `schedule.delaySeconds`,
   `noop` = nothing changed.
7. Dashboard watch: unless one is already running (TaskList), arm a `Monitor` with
   `node $SM watch` (from the workspace root), `timeout_ms` 1800000, description
   "my-day dashboard clicks and runs". Each event is a click on the dashboard or a finished
   `claude -p` run → run a tick right away (from step 1; its `fromDashboard` / `runs` holds it)
   instead of waiting for the wakeup. Re-arm it when it
   expires. Outside working hours the watch keeps running: answers are recorded, actions wait for hours.

## Workers
`schedule`'s settings (`$SM config settings`) say how: `runner: agent` (default) or `runner: claude-p`.

**agent** — Agent tool, `general-purpose`, no `isolation` (workers make their own sub-repo worktree):
```
Invoke the Skill tool with "my-day:worker" and follow it.
Kind: <develop|bug|review-fix|pipeline-fix|rebase>. Workspace root: <abs path>.
Item: <id>. Dry run: <true|false>.
Task: <goal and what "done" means; add "local only" when no push/MR/tracker writes are allowed>.
```
Then `$SM dispatch <id> --agent <name> --status <new status>`. On completion:
`$SM reconcile <id> --result '<its last message>'` → `next`: `advance` (next workflow step),
`failure-transition` (the workflow's failure path) or `escalate` (already failed — tell the user).
Writes a worker was not allowed to make (`WRITES.md`) come back as drafts: reconcile asks them
(`drafts` in its answer); handle them as in *Outward writes*.

**claude-p** — one detached `claude -p` per repo, started in that repo's worktree, so the repo's
`CLAUDE.md`, `.claude/settings.json`, skills and MCP servers apply:
1. Create each repo's worktree and branch exactly as DEVELOP.md says (repos in its cross-repo order).
2. Start it with the task on stdin, in a quoted heredoc so ticket text is never expanded by the shell:
   ```
   node $SM run <id> --kind <kind> --chain <repo>=<worktree>[,<repo>=<worktree>…] --status <new status> <<'TASK'
   <goal and what "done" means>
   TASK
   ```
   It records the dispatch. A `failed` answer means the run could not start (already reconciled:
   act on its `next`, and tell the user when the CLI itself is missing).
3. Results arrive in `tick`'s `runs.finished` (`next` as above, already reconciled); `watch` wakes the
   loop when a run's process ends. Later repos start by themselves and get the earlier results
   (not while paused or outside working hours: they wait for the next tick that may dispatch).
4. A `blocked` result naming a denied tool or command → ask whether to allow it in that repo's
   `.claude/settings.json` (`permissions.allow`); on yes, add it in the repo (commit per repo rules)
   and retry.
5. `dashboard-request` `stop` → `$SM run-stop <id>` (kills the running repo, cancels the rest) —
   at once, also when paused or outside working hours.

## User
- All communication in this session (the user follows it via Remote Control); the dashboard
  mirrors it and can answer questions, pause, and send per-item quick actions (see `fromDashboard`). Ask with `$SM ask <id> "<q>"` and in chat as "q-4 · bug-2 (ABC-812 …): …";
  record with `$SM answer` / `$SM decline`; never re-ask; keep working meanwhile.
- An answer or instruction that sets a standing rule → `my-day:config`.
- `elaborate <id>` / `summary …` → `my-day:summary`. `dream` → `my-day:dream`. `pause` (`$SM pause`, no dispatch), `resume` (`$SM resume`),
  `stop` (`$SM stop`, then `ScheduleWakeup stop`; the dashboard stays and shows the loop as stopped), `retry <id>` (`$SM unfail <id>`,
  `$SM set <id> attempts=0`).

## Outward writes
`WRITES.md` (when present; without it every action is `auto`) gives each outward action
`<source>: <verb>` a policy. Before any outward action find its row, else `default`:
- `auto` → do it.
- `ask` → `$SM ask <id|-> "<one line: what and why>" --draft -`, with
  `{"action","target","body"}` on stdin (never on the command line). Keep working meanwhile.
  `approvedDrafts` (or a `dashboard-answer` whose `draft` is set) → write exactly
  `draft.body` as approved (`$SM questions --status answered --json` has it; the user may have
  edited it), then `$SM wrote <q-n> [--url <where>]`. Declined → don't write it.
- `never` → don't: `$SM event <id> write-blocked "<action> → <target>"`, then the row's
  fallback when its note names one.
An answer in the session ("q-7 ok", "q-7 but say …") counts the same: `$SM answer <q> "ok"
[--body "<edited text>"]`. A standing change ("stop asking before Jira comments") → `my-day:config`.

## Sources
`LOOP.md` `requires` lists what the loop cannot work without (`mcp:<server>`, `cli:<bin>`).
- A query or call that fails on auth, connection or a missing tool → `$SM source <name> error
  "<short reason>"`; the next success → `$SM source <name> ok`.
- `tick` → `sources.down`: skip every step that needs that source this tick, say so in the
  session once (when it goes down, not every tick), and never read its silence as "nothing to
  do": no items closed as gone from scope, no "inbox empty" conclusions.
- `sources.unchecked` → check them as in *Start* step 1.

## Dry run
`schedule.dryRun` true → every outward action (merge, push, MR/PR create/update/rebase,
thread reply/resolve, reviewer/assignee change, ticket assign/transition/comment, CI retry,
message, email, page publish) becomes `$SM event <id> dry-run "would: …"`, whatever `WRITES.md`
says, approved drafts included. Brainstorms stop before their tracker write and show it instead.

## Rules
- Only this session writes task state. The dashboard only marks reviews done/skip, answers questions,
  sets pause and logs quick-action requests; it never touches the code host or tracker.
- Follow the workspace's CLAUDE.md / AGENTS.md. Force-push only as MERGE-GATES.md allows.
- zsh: never name variables `path`, `status` or `argv`; no shell state survives between
  calls; request only the fields you need from tracker APIs.
