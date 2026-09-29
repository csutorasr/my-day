<!-- TEMPLATE — a worked example (Jira + GitLab). my-day-setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Development rules (workers)

## Worktrees
- Repos are separate git repos under the workspace root; workers create worktrees there:
  `git -C <repo> fetch origin && git -C <repo> worktree add ../.worktrees/<repo>/<branch> -b <branch> origin/main`
  (existing branch: `git -C <repo> worktree add ../.worktrees/<repo>/<branch> <branch>`).
- Branch names: `feat/<KEY>-<slug>`, `fix/<KEY>-<slug>`, `chore/<KEY>-<slug>`. Same branch name in every repo a ticket touches.
- The orchestrator removes the worktree after merge: `git -C <repo> worktree remove ../.worktrees/<repo>/<branch>`.

## Cross-repo order
<SPEC_REPO> (contract) → <SDK release step> → <BACKEND_REPO> → <FRONTEND_REPO>.
Consumer MRs that use a pre-release SDK must switch to the released one before they merge (MERGE-GATES).

## Repo specifics (on top of my-day-worker's rules)
- <per-repo tooling notes, e.g. which package manager a repo uses>
- Open MRs with `glab mr create --fill --target-branch main`; multiline descriptions via `--input -` JSON.
- Never touch `<CI_PLAN_MARKER>` branches while the CI implementation job runs.
