# my-day

A run-forever development loop for [Claude Code](https://claude.com/claude-code). You start
it once; it keeps your merge requests moving, fixes review comments, develops the tickets
assigned to you on isolated git worktrees, triages unassigned work, and only pulls you in
for the things that need a human: brainstorms, decisions and reviews.

Everything is configured per workspace in plain markdown (`.my-day/*.md`), so the same
skills work with Jira, GitHub Issues, GitLab Issues, Linear or no tracker at all, on GitLab
or GitHub.

## How it helps

```mermaid
flowchart LR
  subgraph you["You"]
    direction TB
    Y1["Answer questions<br/>(in the session / Remote Control)"]
    Y2["Brainstorm new stories"]
    Y3["Review teammates' MRs<br/>when the dashboard pings"]
  end

  subgraph loop["my-day loop (Claude Code session)"]
    direction TB
    T["tick<br/>sync MRs, reviews, tickets"] --> V{"merge-gate<br/>verdict"}
    V -->|merge| M["Merge<br/>(gates + trains)"]
    V -->|rebase| R["Rebase worker"]
    V -->|fix-review / fix-pipeline| F["Fix worker<br/>fix · push back · escalate"]
    T --> W{"ticket<br/>workflow"}
    W -->|needs spec| Y2
    W -->|code| D["Develop / bug worker<br/>on its own worktree"]
    D --> P["MR → pipeline → AI review fixes<br/>→ domain reviewers → ticket transition"]
    F --> P
    R --> P
    P --> T
  end

  T -. "review requested" .-> N["Dashboard + web push"]
  N -.-> Y3
  W -. "unassigned bug / next story?" .-> Y1
  F -. "product question" .-> Y1
```

| Without my-day | With my-day |
|---|---|
| You poll GitLab/GitHub and Jira to find what moved | `tick` syncs everything and says what to act on |
| Approved MRs wait until you notice them | Mergeable MRs are merged once every gate passes |
| AI-reviewer and human comments pile up | A worker fixes or reasons back on each thread, then re-requests review |
| Rebasing ff-only repos is a manual train | Rebases run server-side first, locally only when needed |
| Tickets wait for a free afternoon | Specified tickets are developed on worktrees in the background |
| Unassigned bugs go unnoticed | You're asked whether to take them; fixes can start in the background |

## Skills

| Skill | Role |
|---|---|
| `my-day:loop` | Orchestrator. Bootstraps, runs `tick`, acts, dispatches workers, schedules the next wakeup. Holds the shared code. |
| `my-day:setup` | First-run interview: tracker, code host, scope, workflow → writes `.my-day/*.md` from templates. |
| `my-day:config` | Turns standing decisions made while the loop runs ("ignore ABC-50", "never merge on Fridays") into config edits. |
| `my-day:worker` | Background agent: `develop`, `bug`, `review-fix`, `pipeline-fix`, `rebase` — each on its own git worktree. |
| `my-day:summary` | "What happened today?", failures, `elaborate <id>`. |
| `my-day:dream` | Periodic local reflection (`dreamSchedule`, e.g. weekly): reads the loop's history, writes a report to `.my-day/dreams/`, proposes config edits for approval, flags team and tooling issues. Never runs in the cloud. |

## Requirements

- Claude Code, with the `loop` skill (built in) and ideally the
  [superpowers](https://github.com/obra/superpowers) skills (debugging, TDD, code review).
- Node.js ≥ 22.13 (uses the built-in `node:sqlite`; developed on Node 24).
- `glab` (GitLab) or `gh` (GitHub), authenticated.
- Access to your tracker: an MCP server (e.g. Atlassian for Jira, Linear) or a CLI
  (`gh issue`, `glab issue`, `az boards`).

## Install

In Claude Code:

```
/plugin marketplace add csutorasr/my-day
/plugin install my-day@csutorasr
```

(or from a shell: `claude plugin marketplace add csutorasr/my-day && claude plugin install my-day@csutorasr`).
The repository is private for now, so this needs git access to it.

Skills are namespaced by the plugin: `/my-day:loop`, `my-day:setup`, ….
Web push is optional — setup offers to install its one dependency (`web-push`); without it
the dashboard still notifies while its tab is open.

## First run

In the root of the workspace you want the loop to work on:

```
/my-day:loop
```

With no `.my-day/` yet, `my-day:setup` interviews you (one question at a time, proposing what
it found): which tracker and code host you use, which tickets count as your development work,
which bucket tickets to ignore, how bugs and stories flow, your merge gates, who reviews what.
Then the dashboard opens at `http://127.0.0.1:4711` and the loop starts.

## Configuration

`.my-day/` in the workspace root. Every `X.md` is shared with the team (commit it); an
optional `X.local.md` next to it holds personal overrides and is gitignored.

| File | Defines |
|---|---|
| `LOOP.md` | Cadence, working hours, parallel agents, retry limit, dry run, `dreamSchedule` — plus the scope the Node side reads: `tracker`, `forge`, `group`, `ticketPattern`, `aiReviewer`, `targetBranch` |
| `QUERY-MY-TASKS.md` | Tracker queries for your tickets; ignored bucket tickets |
| `QUERY-MY-REVIEWS.md` | Review-queue behaviour (the sync itself is automatic) |
| `QUERY-INBOX.md` / `TRIAGE.md` | Unassigned work and how to triage it |
| `WORKFLOW-BUG.md` / `-STORY.md` / `-SUBTASK.md` | Human-readable state machines: fix-first vs spec-first, CI plan vs local, brainstorm skills |
| `DEVELOP.md` | Worktrees, branch names, cross-repo order, per-repo tooling |
| `FIX-REVIEW.md` | How review comments are classified and answered |
| `MERGE-GATES.md` | Gates, merge method, rebase and force-push rules, merge trains |
| `POST-MR.md` | Pipeline handling, reviewer selection, ticket transitions |
| `DREAM.md` (optional) | Checks `my-day:dream` runs over the loop's history; defaults to the template |

Add to `.gitignore`:

```
.my-day/*.local.md
.my-day/state.db*
.my-day/.vapid.json
.my-day/server.pid
.my-day/server.log
.my-day/dreams/
.worktrees/
```

## Everyday use

- The loop talks to you in its Claude Code session — use Remote Control to follow it from
  your phone. Questions get IDs (`q-4 · bug-2 …`); answer in the session.
- Items have short IDs: `bug-1`, `story-2`, `mr-4`, `review-5`.
- `summary`, `summary since Monday`, `elaborate bug-1`, `retry bug-1`, `pause`, `resume`,
  `stop`.
- The dashboard shows what needs you (answer or decline questions right there), your MRs
  grouped by what they wait for, reviews (Done / Skip), agents, tickets and the activity log, and
  sends web push notifications. Every MR / ticket / link has quick actions: copy, open, and a loop
  action (rebase, fix pipeline, fix review, merge step, retry, ask why). Pause / resume the loop
  from the header.
- Dashboard clicks reach the loop on its next `tick` (`fromDashboard`); the loop also runs
  `state.mjs watch-dashboard` as a monitor, so a click wakes it within seconds.

## How it works

The model only does what needs judgement. Everything deterministic runs in Node through one
CLI, `skills/loop/bin/state.mjs`, backed by SQLite in `.my-day/state.db`:

| Command | Does |
|---|---|
| `bootstrap` | Config check, DB, dashboard server, orphaned agents |
| `tick` | Code-host sync (MRs + review requests), merge-gate verdicts, schedule, compact to-do JSON |
| `dispatch` / `reconcile` | Worker bookkeeping: attempts, links, new MRs, retry limit → escalation |
| `dream-data` / `dream-done` | History bundle for a dream; record `lastDreamAt` |
| `pause` / `resume`, `watch-dashboard` | Stop dispatching; stream dashboard clicks to the session |
| `summary`, `show`, `list`, `ask`, `answer`, … | State queries and updates (`state.mjs help`) |

`bin/forge.mjs` reads GitLab (`glab`) and GitHub (`gh`) with one output shape. The
orchestrator writes all task state; workers only report a JSON result.

## Safety

- **Dry run** (`dryRun: true`) replaces every outward action with a logged event — use it to
  rehearse a new setup.
- **Working hours** gate dispatching and outward actions (read-only refresh continues).
- Merges only when every gate in `MERGE-GATES.md` passes; force-push only where that file
  allows it (e.g. `--force-with-lease` after a failed server-side rebase).
- Personal data stays in `*.local.md`; the shared files use "current user" queries.

## Development

```bash
npm test     # node --test, no dependencies needed
```

Status: early. Used daily on a Jira + GitLab workspace; the GitHub provider is covered by
fixture tests only.
