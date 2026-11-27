# Setup: the dev profile

Followed by `my-day:setup` for a development workspace: tickets from a tracker, MRs/PRs on GitLab
or GitHub, workers on git worktrees. Templates in this folder are a worked example (a Jira +
GitLab workspace); adapt them to what the user actually uses — never assume the example's tools.

## 0. Explore (read-only, on top of the generic exploration)
- Repos and remotes (`git -C <repo> remote -v`) → code host(s) and group/org.
- CI config (AI review job? plan-implementation job?).
- `glab` / `gh` auth status.

## 1. Tools interview
1. **Issue tracker** — "Where do your tickets live?" Options from what's connected:
   Jira · GitHub Issues · GitLab Issues · Linear · Azure Boards · other · none (MR/PR-only mode).
2. **Code host** — GitLab or GitHub (`forge.mjs --provider`), and the group/org prefix
   (`--group`) whose MRs/PRs count.
3. **Ticket ↔ MR link** — how an MR names its ticket (branch/title). Propose a regex from
   recent MRs (`KEY-123` → default; `#123` for GitHub/GitLab issues) → `--ticket-pattern`.

## 2. Tracker interview
Follow `templates/TRACKERS.md` (only the block for the chosen tracker). For this profile:
**(b)** maps to `bug` / `story` / `subtask`; **(c)** asks which states mean *to develop*,
*in review*, *dev done*, *blocked*; **(d)** candidates also include parents without code and
items open for months with no linked MR, and the confirmed list goes into `## Scope` of
`QUERY-MY-TASKS.md`. Tracker `none` → skip ticket workflows; the loop only handles MRs/PRs and
reviews.

Run the resulting "my tickets" query once, show the list, and ask "anything here that isn't
development work?". Machine-read scope goes into `LOOP.md` front matter (`tracker`, `forge`,
`group`, `ticketPattern`, `aiReviewer`, `targetBranch`, `requires`) — `state.mjs tick` syncs the
code host from it, so check it with `$SM tick` once the files exist. `requires` lists what the
loop cannot work without: the tracker's MCP server or CLI and the code host CLI (e.g.
`mcp:atlassian, cli:glab`).

## 3. Workflow interview
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
- Workers: how they run (`runner` in `LOOP.md`). In a T3 Code thread follow `my-day:setup`
  section 4 (T3 threads per repo worktree, and T3 projects); otherwise keep `agent`.
- Outward writes: propose the `## Writes defaults` below for `WRITES.md`; ask which to tighten
  (e.g. `jira: transition` → `ask`). Everything stays `auto` unless the user says otherwise,
  so the dev loop behaves as it always has.
- "Enable weekly dreaming? When?" — a local reflection run (`my-day:dream`) that reads the
  loop's history and proposes config and team improvements. Propose `Fri 16:00` (inside
  working hours); the answer → `dreamSchedule` in `LOOP.local.md`, `''` = off. Yes → also
  offer DREAM.md (step 4).

## 4. Write the files
For each missing file in `LOOP.md` → QUERY-* → TRIAGE → WORKFLOW-* → DEVELOP → FIX-REVIEW →
MERGE-GATES → POST-MR → WRITES → DREAM order (DREAM.md is optional: write it only when dreaming is
enabled or the user wants it; without it the dream uses the template defaults):
- Start from the template, replace every `<PLACEHOLDER>`, and rewrite tool-specific parts
  for the chosen tracker and code host (tracker queries, transition/assign/comment commands;
  code-host commands per the table below). Delete sections that don't apply (e.g. ticket
  workflows in MR-only mode).
- Show the result, run its queries once, then save. Remove the `<!-- TEMPLATE … -->` line.
- Personal data (account ids, emails, `dryRun`, port, `maxAgents`) → `LOOP.local.md`
  (`trackerAccountId`, `gitEmail`, `dreamSchedule`), never the shared files. Shared queries use
  "current user" forms (`currentUser()`, `@me`, `@Me`).

## Writes defaults
For `WRITES.md` (from `templates/WRITES.md`), named for the user's tracker and code host:

| action | policy |
|---|---|
| gitlab: merge · push · open MR · update MR · rebase · reply thread · resolve thread · set reviewers · retry CI | auto |
| jira: assign · transition · comment | auto |
| default | ask |

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
