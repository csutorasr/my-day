---
name: my-day-loop
description: Use when the user says "my day", "start my day", "/my-day-loop", or wants the run-forever development loop that merges ready MRs/PRs, fixes review comments, develops assigned tickets on worktrees, triages unassigned work and keeps a dashboard. Also the entry point on every loop wakeup.
---

# my-day loop (orchestrator)

This session owns the state, runs brainstorms, talks to the user and dispatches background
workers. It never writes product code. CLI: `~/.claude/skills/my-day-loop/bin/state.mjs`
(`$SM` below — write the full path in every Bash call). `$SM help` lists every command.
Config: `$SM config show <NAME>` (shared `X.md` + personal `X.local.md`).

## Start
1. `$SM bootstrap --new-session` on the first call of a session, `$SM bootstrap` after.
   `missing` non-empty → run `my-day-setup` first. First call: `open <server.url>`.
2. Read `$SM config all` once per session; re-read a file after it changes.
3. Not inside `/loop` yet → invoke the `loop` skill with `/my-day-loop` (self-paced); it runs
   the first tick right away.

## Tick
1. `$SM tick` → `schedule`, `sync` (code-host delta), `act` (MR ids by verdict), `tickets`,
   `running`, `reviewsPending`, `openQuestions`, `failed`. Code host and reviews are done.
2. Tracker: run the ticket queries in QUERY-MY-TASKS.md → `$SM upsert-many`; items gone
   from scope → `status=closed` + event. `awaiting-answers` tickets → look for replies.
   QUERY-INBOX.md only when step 4 finds nothing actionable.
3. `schedule.inHours` false → skip to step 6 (read-only outside hours).
4. Act in this order; workers only within `schedule.freeSlots`:
   - `act.merge` → extra gates in MERGE-GATES.md (dependencies, trains) → merge; event `merged`.
   - `act.rebase` → per MERGE-GATES.md (server-side first, `rebase` worker on failure).
   - `act.fix-review` / `act.fix-pipeline` → `review-fix` / `pipeline-fix` worker.
   - MRs in `mr-open` / `post-mr` → next unfinished POST-MR.md step; progress in
     `data.postMr`; never block on a pipeline.
   - `tickets` → next transition of WORKFLOW-BUG / -STORY / -SUBTASK.md. Brainstorm, spec
     and planning steps run here, one brainstorm at a time (queue others as
     `brainstorm-queued`); code steps → `develop` / `bug` worker.
   - Nothing actionable → TRIAGE.md for inbox items.
5. `$SM prune` once a day.
6. `ScheduleWakeup`: prompt `/loop /my-day-loop`, `delaySeconds` = `schedule.delaySeconds`,
   `noop` = nothing changed.

## Workers
Agent tool, `general-purpose`, no `isolation` (workers make their own sub-repo worktree):
```
Invoke the Skill tool with "my-day-worker" and follow it.
Kind: <develop|bug|review-fix|pipeline-fix|rebase>. Workspace root: <abs path>.
Item: <id>. Dry run: <true|false>.
Task: <goal and what "done" means; add "local only" when no push/MR/tracker writes are allowed>.
```
Then `$SM dispatch <id> --agent <name> --status <new status>`. On completion:
`$SM reconcile <id> --result '<its last message>'` → `next`: `advance` (next workflow step),
`failure-transition` (the workflow's failure path) or `escalate` (already failed — tell the user).

## User
- All communication in this session (the user follows it via Remote Control); the dashboard
  mirrors it. Ask with `$SM ask <id> "<q>"` and in chat as "q-4 · bug-2 (ABC-812 …): …";
  record with `$SM answer` / `$SM decline`; never re-ask; keep working meanwhile.
- An answer or instruction that sets a standing rule → `my-day-config`.
- `elaborate <id>` / `summary …` → `my-day-summary`. `pause` (no dispatch), `resume`,
  `stop` (`ScheduleWakeup stop`; server stays), `retry <id>` (`$SM unfail <id>`,
  `$SM set <id> attempts=0`).

## Dry run
`schedule.dryRun` true → every outward action (merge, push, MR/PR create/update/rebase,
thread reply/resolve, reviewer/assignee change, ticket assign/transition/comment, CI retry)
becomes `$SM event <id> dry-run "would: …"`. Brainstorms stop before their tracker write
and show it instead.

## Rules
- Only this session writes task state (the dashboard only marks reviews done/skip).
- Follow the workspace's CLAUDE.md / AGENTS.md. Force-push only as MERGE-GATES.md allows.
- zsh: never name variables `path`, `status` or `argv`; no shell state survives between
  calls; request only the fields you need from tracker APIs.
