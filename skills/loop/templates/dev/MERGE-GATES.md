<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Merge gates

## An MR may be merged when ALL hold
- target branch is `main`
- approved (approvals API `approved: true`)
- not draft
- head pipeline `success`
- `blocking_discussions_resolved: true`
- `detailed_merge_status` is `mergeable`
- every upstream dependency MR (DEVELOP.md cross-repo order) is merged
- consumer MRs no longer reference a pre-release SDK version

Merge: `glab mr merge <iid> -R <path> --yes` (repo's squash/delete-branch defaults). Event `merged`.

## Merge train (fast-forward-only repos: <FF_ONLY_REPOS>)
- The head pipeline must be green on the **rebased** sha; merging one MR puts every other open MR in that repo behind again.
- Merge at most one MR per repo per tick: pick the oldest approved MR, rebase it (server-side), wait for its pipeline on the new sha, merge, then the next. Record the train in `data.train` on the MR items.
- Stacked MRs: when the parent merges GitLab retargets the child to `main`; re-evaluate the child on the next tick.
- A merge API `405` on <BACKEND_REPO> means the approval rule is not satisfied — treat as "not approved", not as a failure.

## Not mergeable
- `need_rebase` / `conflict` → rebase (below).
- not approved + unresolved comments → `FIX-REVIEW.md`.
- not approved, no comments → wait; nudge nothing.
- pipeline failed → `POST-MR.md` failure handling.

## Rebase strategy
1. `glab mr rebase <iid> -R <path>` (server-side). Poll until `rebase_in_progress: false`; check `merge_error`.
2. Failed or conflicts → `rebase` worker: worktree on the branch, `git rebase origin/main`, resolve conflicts, run the repo's tests, `git push --force-with-lease`.
3. Never while a `<CI_PLAN_MARKER>` job (`<CI_PLAN_JOB>`) is running on that branch — wait for it.
4. Conflicts the worker can't resolve confidently → `blocked`, ask me.
