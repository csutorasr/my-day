---
name: my-day-setup
description: Use when .my-day config files are missing (first run of the my-day loop in a workspace) or the user wants to (re)configure my-day from scratch - "set up my day", "configure my day", "redo my-day setup". Interviews the user about their issue tracker, code host and workflow and writes .my-day/*.md. Small rule changes while the loop runs belong to my-day-config.
---

# my-day setup

`$SM` = `${CLAUDE_PLUGIN_ROOT}/skills/my-day-loop/bin/state.mjs` (write the full path in each Bash call;
shell variables do not persist). Templates: `${CLAUDE_PLUGIN_ROOT}/skills/my-day-loop/templates/`.
Templates are a worked example (a Jira + GitLab workspace); adapt them to what the user
actually uses — never assume the example's tools.

Ask one question per message, multiple choice when possible, and always propose what
exploration found so the user mostly confirms.

## 1. Explore (read-only)
- `$SM config missing` (files to create), `$SM config dir` (target).
- Repos and remotes (`git -C <repo> remote -v`) → code host(s) and group/org.
- `CLAUDE.md` / `README.md` files, CI config (AI review job? plan-implementation job?).
- A team roster (people → domain → accounts) if one exists.
- Available tools: `glab` / `gh` auth status, and which tracker MCP servers or CLIs are
  connected (Atlassian, Linear, Azure DevOps, YouTrack …).

## 2. Tools interview
1. **Issue tracker** — "Where do your tickets live?" Options from what's connected:
   Jira · GitHub Issues · GitLab Issues · Linear · Azure Boards · other · none (MR/PR-only mode).
2. **Code host** — GitLab or GitHub (`forge.mjs --provider`), and the group/org prefix
   (`--group`) whose MRs/PRs count.
3. **Ticket ↔ MR link** — how an MR names its ticket (branch/title). Propose a regex from
   recent MRs (`KEY-123` → default; `#123` for GitHub/GitLab issues) → `--ticket-pattern`.

## 3. Tracker interview (only the block for the chosen tracker)
Every tracker gets the same five questions, phrased in that tracker's terms:
**(a)** which container(s) hold the work, **(b)** how items map to `bug` / `story` /
`subtask`, **(c)** which states mean *to develop*, *in review*, *dev done*, *blocked*,
**(d)** continuous / bucket items to ignore, **(e)** labels or areas that belong to other teams.

For (d), propose candidates: the user's open items whose title looks like a bucket
(`Generic`, `activities`, `meetings`, `support`, `overhead`, `time tracking`), umbrella items
(epics, parents without code), and items open for months with no linked MR. The confirmed
list goes into `## Scope` of `QUERY-MY-TASKS.md` and into every query's exclusion clause.

| Tracker | Access | (a) container | (b) type mapping | (c) states | "mine" / "unassigned" |
|---|---|---|---|---|---|
| Jira | Atlassian MCP (`searchJiraIssuesUsingJql`, explicit `fields`, markdown) or `jira` CLI | project keys | issue types (Story/Task/Sub-task/Bug) | workflow statuses | `assignee = currentUser()` / `assignee is EMPTY`; exclude `key not in (…)` |
| GitHub Issues | `gh issue list --json …`, Projects v2 via `gh project item-list` | repos or org, optional project board | labels (`bug`, `story` …), sub-issues | open/closed + project Status field or labels | `--assignee @me` / `no:assignee`; exclude by number or label |
| GitLab Issues | `glab issue list -O json`, `glab api` | group/projects, optional board | labels, issue type, tasks | open/closed + board lists / scoped labels (`workflow::…`) | `--assignee @me` / `--assignee none` |
| Linear | Linear MCP or API | team keys, projects, cycles | labels, sub-issues | workflow states per team | `assignee: me` / unassigned |
| Azure Boards | `az boards query --wiql` | org / project / area path | work item types (Bug, User Story, Task) | states | `[System.AssignedTo] = @Me` |
| other | ask how they list "my tickets" (CLI, MCP, API) | ask | ask | ask | ask |
| none | — | — | skip ticket workflows; the loop only handles MRs/PRs and reviews | — | — |

Run the resulting "my tickets" query once, show the list, and ask "anything here that isn't
development work?". Machine-read scope goes into `LOOP.md` front matter (`tracker`, `forge`,
`group`, `ticketPattern`, `aiReviewer`, `targetBranch`) — `state.mjs tick` syncs the code host
from it, so check it with `$SM tick` once the files exist.

## 4. Workflow interview
One question at a time, proposing a default:
- Bugs: fix attempt first, spec first, or brainstorm first? (WORKFLOW-BUG)
- Stories/subtasks: which brainstorm / planning skills exist here; CI-plan vs local routing
  rule (WORKFLOW-STORY/-SUBTASK). No such skills → brainstorm with `superpowers:brainstorming`
  and develop locally.
- Merge gates and merge method (squash, ff-only trains, required approvals) (MERGE-GATES).
- Rebase strategy (server-side first? force-push allowed?).
- AI reviewer: job name and bot account, if any (FIX-REVIEW, POST-MR).
- Reviewers by repo/domain, from the roster (POST-MR).
- Ticket transitions after MR open / after merge (POST-MR).

## 5. Write the files
For each missing file in `LOOP.md` → QUERY-* → TRIAGE → WORKFLOW-* → DEVELOP → FIX-REVIEW →
MERGE-GATES → POST-MR order:
- Start from the template, replace every `<PLACEHOLDER>`, and rewrite tool-specific parts
  for the chosen tracker and code host (tracker queries, transition/assign/comment commands;
  code-host commands per the table below). Delete sections that don't apply (e.g. ticket
  workflows in MR-only mode).
- Show the result, run its queries once, then save. Remove the `<!-- TEMPLATE … -->` line.
- Personal data (account ids, emails, `dryRun`, port, `maxAgents`) → `LOOP.local.md`
  (`trackerAccountId`, `gitEmail`), never the shared files. Shared queries use
  "current user" forms (`currentUser()`, `@me`, `@Me`).

## 6. Ignores
In a git repo root append to `.gitignore` (ask before editing a tracked file; otherwise
`.git/info/exclude`):
```
.my-day/*.local.md
.my-day/state.db*
.my-day/.vapid.json
.my-day/server.pid
.my-day/server.log
.worktrees/
```
Web push (optional): `npm install --prefix ${CLAUDE_PLUGIN_ROOT}/skills/my-day-loop/server --no-audit --no-fund`
— without it the dashboard only notifies while its tab is open.

`$SM config missing` empty → hand back to `my-day:my-day-loop`.

## Code host commands
Templates show GitLab (`glab`). For GitHub rewrite the commands with the equivalents:

| Action | GitLab | GitHub |
|---|---|---|
| list / details / review status | `forge.mjs … --provider gitlab` | `forge.mjs … --provider github` |
| open MR/PR | `glab mr create --fill --target-branch main` | `gh pr create --fill --base main` |
| merge | `glab mr merge <iid> -R <path> --yes` | `gh pr merge <n> -R <repo> --squash\|--rebase\|--merge` |
| server-side rebase | `glab mr rebase <iid> -R <path>` | `gh pr update-branch <n> -R <repo> --rebase` |
| assign me | `glab mr update <iid> --assignee @me` | `gh pr edit <n> --add-assignee @me` |
| reviewers | `glab mr update <iid> --reviewer +<user>` | `gh pr edit <n> --add-reviewer <user>` |
| undraft | `glab mr update <iid> --ready` | `gh pr ready <n>` |
| retry CI | `glab ci retry <job>` | `gh run rerun <run> --failed` |
| failed job log | `glab ci trace <job> -R <path>` | `gh run view <run> --log-failed` |
| reply / resolve thread | `glab api …/discussions/<id>/notes`, `PUT …/discussions/<id>?resolved=true` | GraphQL `addPullRequestReviewThreadReply`, `resolveReviewThread` |
