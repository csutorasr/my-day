<!-- TEMPLATE — the dev-bundle profile, a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> from what it detected in the bundle. -->
# Development rules (claude -p runs)

## Repos
Cloned inside the bundle repo and ignored by it. Every code step runs as `claude -p` in the repo's
worktree (the repo's own CLAUDE.md, `.claude/settings.json`, skills and MCP apply).

| Repo | Remote | Target branch | Notes |
|---|---|---|---|
| `<REPO_A>` | `<REMOTE_A>` | main | <own CLAUDE.md / settings? tooling> |
| `<REPO_B>` | `<REMOTE_B>` | main | |

## Worktrees
- Created by the loop before a run, from the sub-clone:
  `git -C <repo> fetch origin && git -C <repo> worktree add ../.worktrees/<repo>/<branch> -b <branch> origin/<target>`
  (existing branch: `git -C <repo> worktree add ../.worktrees/<repo>/<branch> <branch>`).
- Only tracked files are in a worktree: settings a run needs belong in the repo's tracked
  `.claude/settings.json`, not `settings.local.json`.
- Branch names: `feat/<KEY>-<slug>`, `fix/<KEY>-<slug>`, `chore/<KEY>-<slug>`. Same branch name in every repo a ticket touches.
- The loop removes the worktree after merge: `git -C <repo> worktree remove ../.worktrees/<repo>/<branch>`.

## Cross-repo order
The chain order for a ticket touching several repos; each run gets the earlier runs' results.
1. `<SPEC_REPO>` (contract)
2. `<BACKEND_REPO>`
3. `<FRONTEND_REPO>`

A failed or blocked repo stops the chain; the repos before it keep their branch and MR.

## Repo specifics (on top of my-day:worker's rules)
- <per-repo tooling notes, e.g. which package manager a repo uses>
- Open MRs with `glab mr create --fill --target-branch main`; multiline descriptions via `--input -` JSON.
