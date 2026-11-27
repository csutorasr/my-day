# my-day

A run-forever development loop for [Claude Code](https://claude.com/claude-code). You start
it once; it keeps your merge requests moving, fixes review comments, develops the tickets
assigned to you on isolated git worktrees, triages unassigned work, and only pulls you in
for the things that need a human: brainstorms, decisions and reviews.

Everything is configured per workspace in plain markdown (`.my-day/*.md`), so the same
skills work with Jira, GitHub Issues, GitLab Issues, Linear or no tracker at all, on GitLab
or GitHub. The loop itself is generic — it resolves whatever tasks its markdown describes; the
development workflow above is the `dev` **profile**, the template set setup starts from, and the
`pm` profile runs a product manager's day the same way (backlog hygiene, specs, feedback,
stakeholder replies, status updates). Run one loop per workspace folder; one dashboard shows
them all.

![The my-day dashboard inbox: decisions, failures and reviews that need you, under a health strip](docs/dashboard.png)

![The loop view: the MR board, tickets, agents and activity, opened over the inbox](docs/dashboard-loop.png)

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
| `my-day:setup` | First-run interview → writes `.my-day/*.md` from a profile's templates (`setup dev`, `setup pm`; see [Profiles](#profiles)). Registers the workspace for the shared dashboard. |
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

## Several loops

Start `/my-day:loop` in each workspace folder you want worked on (`~/work/client-a`,
`~/work/client-b`, …): one Claude Code session per folder, each with its own `.my-day/` store and
config. The first loop starts the machine's one dashboard; the others join it. The dashboard shows
the loops whose session is running; with more than one, a filter picks workspaces and **Show
stopped** adds the rest. `stop` in a session marks its loop stopped (`state.mjs stop`).

The machine home `~/.my-day/` (`MY_DAY_HOME`) holds the list of loops (`loops/`), the dashboard's
process files, its web-push keys and subscriptions, and an optional `SETTINGS.md` with `port` and
`pushSubject` (otherwise the first loop's `LOOP.md` values). Upgrading from 0.7: keys and phone
subscriptions move there on the first start; **restart running loops after updating** so none of
them still runs the per-workspace dashboard.

### Profiles

A profile is a folder under `skills/loop/templates/` with a `SETUP.md` (its interview) and the
files it writes. `LOOP.md`'s `## Files` section lists the files a workspace's loop needs and its
*Tick priority* says what each step does, so a new kind of loop (a UX loop fed by other sessions,
a team-lead loop with weekly 1:1 prep, …) is a new template folder, not new code. Item types are
free (`request`, `1on1`, …); `forge: none` turns off the code-host sync.

| Profile | For |
|---|---|
| `dev` | Repos side by side under the workspace root; workers are subagents of the loop session |
| `dev-bundle` | A **bundle repo** that gitignores several cloned repos inside it; every code step runs as `claude -p` in the repo's worktree (`runner: claude-p`) |
| `pm` | A product manager: grooms the backlog against a definition of ready, takes ideas and epics to a PRD and stories, groups feedback from chat and support into tickets, drafts replies to stakeholders and a scheduled status update. No code host, no workers; every message, comment or ticket it sends is a draft you approve, unless `WRITES.md` says otherwise |

Two things every profile shares:

- **Outward writes** (`WRITES.md`): each action the loop takes outside the workspace
  (`jira: comment`, `slack: post channel`, `gitlab: merge`, `gmail: send` …) is `auto`, `ask` or
  `never`. An `ask` becomes a **draft** in the inbox: what it writes where, the text editable in
  place, Approve / Decline; the loop writes exactly what you approved. `never` is refused, with a
  fallback where one fits (an email draft instead of sending). Without a `WRITES.md` everything is
  `auto`, which is how dev workspaces have always run.
- **Required sources** (`requires:` in `LOOP.md`, e.g. `mcp:atlassian, mcp:slack, cli:glab`):
  the MCP servers and CLIs the loop cannot work without. CLIs are checked at start, MCP servers
  by the session; a source that is missing or failing shows in the dashboard's health strip, its
  steps are skipped, and the loop never mistakes its silence for "nothing to do".

### Workers as `claude -p`

`runner: claude-p` in `LOOP.md` runs each worker as a separate, detached `claude -p` process started
in the worktree of the repo it works on — so that repo's `CLAUDE.md`, tracked
`.claude/settings.json`, skills and MCP servers apply, exactly as in a fresh session there. A ticket
that touches several repos runs one process per repo in `DEVELOP.md`'s cross-repo order; each gets
the earlier repos' results, and a failed or blocked repo stops the chain. Runs are tracked in
`.my-day/runs/`, outlive the loop session and are collected by the next tick; the dashboard shows
which repo a chain is in and offers **Stop run**. Settings: `permissionMode` (default `acceptEdits`;
runs cannot answer prompts, so allow a repo's build and test commands in its
`.claude/settings.json`), `runTimeoutMinutes` (90), `claudeBin`. The default `runner: agent` keeps
subagents.

Smoke test by hand (CI uses a fake `claude`): in a workspace with `runner: claude-p`, make a
worktree, then `state.mjs run <item> --kind develop --task "add a line to README, local only" --chain <repo>=<worktree>`;
`state.mjs runs` shows it running, and the next `tick` reports it under `runs.finished`.

## Configuration

`.my-day/` in the workspace root. Every `X.md` is shared with the team (commit it); an
optional `X.local.md` next to it holds personal overrides and is gitignored.

| File | Defines |
|---|---|
| `LOOP.md` | Cadence, working hours, parallel agents, retry limit, dry run, `dreamSchedule` and any other `<name>Schedule` (e.g. `statusSchedule: Fri 14:00`) — plus the scope the Node side reads: `tracker`, `forge`, `group`, `mineBy` (which MRs/PRs are mine, comma-separated: `assignee` (default), `author`, `unassigned` — nobody assigned, e.g. a bot's, needs `group`; `both` = `author, assignee`), `ticketPattern`, `aiReviewer`, `targetBranch`, `requires`. Body: `## Files` (the manifest) and *Tick priority* |
| `WRITES.md` | `auto` / `ask` / `never` per outward action (every profile; optional, absent = all `auto`) |
| `QUERY-MY-TASKS.md` | Tracker queries for your tickets; ignored bucket tickets |
| `QUERY-MY-REVIEWS.md` | Review-queue behaviour (the sync itself is automatic) |
| `QUERY-INBOX.md` / `TRIAGE.md` | Unassigned work and how to triage it |
| `WORKFLOW-BUG.md` / `-STORY.md` / `-SUBTASK.md` | Human-readable state machines: fix-first vs spec-first, CI plan vs local, brainstorm skills |
| `DEVELOP.md` | Worktrees, branch names, cross-repo order, per-repo tooling |
| `FIX-REVIEW.md` | How review comments are classified and answered |
| `MERGE-GATES.md` | Gates, merge method, rebase and force-push rules, merge trains |
| `POST-MR.md` | Pipeline handling, reviewer selection, ticket transitions |
| `DREAM.md` (optional) | Checks `my-day:dream` runs over the loop's history; defaults to the template |

The table lists the `dev` profile's files; the `pm` profile has `QUERY-BACKLOG.md`, `HYGIENE.md`,
`QUERY-FEEDBACK.md`, `FEEDBACK.md`, `QUERY-MENTIONS.md`, `WORKFLOW-SPEC.md` and `STATUS.md`
instead.

Add to `.gitignore`:

```
.my-day/*.local.md
.my-day/state.db*
.my-day/dreams/
.worktrees/
```

## Everyday use

- The loop talks to you in its Claude Code session — use Remote Control to follow it from
  your phone. Questions get IDs (`q-4 · bug-2 …`); answer in the session.
- Items have short IDs: `bug-1`, `story-2`, `mr-4`, `review-5`.
- `summary`, `summary since Monday`, `elaborate bug-1`, `retry bug-1`, `pause`, `resume`,
  `stop`.
- The dashboard puts everything that needs you in one inbox: decisions (answer, approve or
  decline right there, with the MR's title and gates beside the question), drafts of outward
  writes (edit the text, then approve or decline), failures and review requests (Done / Skip),
  under a health strip (live, next check, MRs blocked on you, agents busy, sources down); the tab title shows the count. The Loop button (or `l`) opens the loop view over it: your
  MRs grouped by what they wait for, tickets, agents and the activity log (`#loop` survives a
  reload; Esc goes back, and "Waiting for you" on an MR card jumps to that question). It also
  sends web push notifications. Every dashboard action waits a few seconds
  with Undo before it reaches the loop. Keyboard: `j`/`k` move through the inbox, `a` approves or
  sends, `d` declines, `u` undoes, `c` copies a link, `?` lists them. On a phone the dashboard is the inbox
  only, and approvals are not offered: decide those on a larger screen. Every MR / ticket / link has quick actions: copy, open, and a loop
  action (rebase, fix pipeline, fix review, merge step, retry, ask why). Pause / resume the loop
  from the header (with several loops shown: per loop, in the health strip). The loop view shows
  one loop at a time, with a switcher when several are shown.
- Dashboard clicks reach the loop on its next `tick` (`fromDashboard`); the loop also runs
  `state.mjs watch` as a monitor, so a click (or a finished `claude -p` run) wakes it within seconds.

## How it works

The model only does what needs judgement. Everything deterministic runs in Node through one
CLI, `skills/loop/bin/state.mjs`, backed by SQLite in `.my-day/state.db`:

| Command | Does |
|---|---|
| `bootstrap` | Config check, DB, registers the loop in `~/.my-day`, one-time migration, shared dashboard server, orphaned agents |
| `loops`, `stop` | The machine's loops (running / stopped); mark this loop stopped |
| `run`, `runs`, `run-stop` | `claude -p` workers per repo (`runner: claude-p`): start a chain, list, stop |
| `tick` | Code-host sync (MRs + review requests), merge-gate verdicts, schedule, compact to-do JSON |
| `dispatch` / `reconcile` | Worker bookkeeping: attempts, links, new MRs, retry limit → escalation |
| `dream-data` / `dream-done` | History bundle for a dream; record `lastDreamAt` |
| `ask --draft`, `wrote` | A draft of an outward write to approve; mark an approved one written (`tick` lists approved drafts until then) |
| `source`, `sources`, `schedule-done` | Health of the required sources; record a `<name>Schedule` run |
| `pause` / `resume`, `watch` | Stop dispatching; stream dashboard clicks and finished runs to the session |
| `summary`, `show`, `list`, `ask`, `answer`, … | State queries and updates (`state.mjs help`) |

`bin/forge.mjs` reads GitLab (`glab`) and GitHub (`gh`) with one output shape. The
orchestrator writes all task state; workers only report a JSON result.

## Safety

- **Dry run** (`dryRun: true`) replaces every outward action with a logged event — use it to
  rehearse a new setup.
- **Outward writes** follow `WRITES.md`: `ask` ones wait for your approval as drafts, `never`
  ones are refused; workers hand theirs back as drafts.
- **Working hours** gate dispatching and outward actions (read-only refresh continues).
- Merges only when every gate in `MERGE-GATES.md` passes; force-push only where that file
  allows it (e.g. `--force-with-lease` after a failed server-side rebase).
- Personal data stays in `*.local.md`; the shared files use "current user" queries.

## Development

```bash
npm test     # node --test, no dependencies needed
```

The dashboard UI is a React app built with Vite, Tailwind CSS v4 and
[shadcn/ui](https://ui.shadcn.com) components on Base UI (`skills/loop/ui`, an npm workspace; theme
from the shadcn preset `b5r7j0sfMW`). The build output in `skills/loop/server/public` is committed,
so an installed plugin never builds anything.

```bash
npm install          # Vite, React, Tailwind, shadcn and Playwright, development only
npm run ui:dev       # hot reload against the running dashboard (MY_DAY_URL, default :4711)
npm run ui:demo      # the real server on three imaginary workspaces (skills/loop/e2e/seed.mjs), port 4712
npm run ui:dev:demo  # hot reload against `ui:demo`
npm run ui:build     # rebuild skills/loop/server/public; commit the result
npm run test:e2e     # build, seed the imaginary workspaces, drive the dashboard in Chrome
```

Add a shadcn component from `skills/loop/ui`: `pnpm dlx shadcn@latest add <name>` (it lands in
`src/components/ui`; dependencies go to the workspace's `package.json`).

`npm test` fails when the committed build is older than the UI sources. `npm run test:e2e`
also rewrites the screenshots at the top of this README (`docs/dashboard.png`,
`docs/dashboard-loop.png`); commit it after a
visible UI change, see [AGENTS.md](AGENTS.md).

Status: early. Used daily on a Jira + GitLab workspace; the GitHub provider is covered by
fixture tests only.
