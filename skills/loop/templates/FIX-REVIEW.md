<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Fixing review comments

## Which comments
- Unresolved, resolvable discussions on my MRs newer than `data.lastSeenCommentId`.
- Human reviewers and the CI AI reviewer (`<AI_REVIEW_JOB>` job: one summary note + inline diff notes, posted by the bot in `LOOP.md` `aiReviewer`; `tick` flags those threads `fromAi` in `data.unresolved`).
- Ignore: my own notes, system notes, cost-report notes.

## Classification (per comment, `superpowers:receiving-code-review`)
- **Fix**: correct and in scope → change the code.
- **Push back**: technically wrong or out of scope → reply with reasoning, leave the thread open for the reviewer.
- **Escalate**: product/design decision or disagreement between reviewers → ask me in the session, don't reply.

## Worker (`review-fix`)
- Worktree on the MR branch (`DEVELOP.md`), rebase not required.
- One commit per logical fix, or amend the applicable commit when the fix belongs to it (then push per `MERGE-GATES.md` force rules).
- Reply on each handled thread (what changed / why not) and resolve the threads it fixed.
- Push; list every thread in the result's `handled`.

## After the worker
- Orchestrator sets `data.lastSeenCommentId`.
- Re-request review from the reviewers who commented: `glab api -X PUT "projects/<path>/merge_requests/<iid>" -f "reviewer_ids[]=…"` (same set, triggers re-request), or `glab mr update <iid> --reviewer +<user>`.
- AI reviewer comments only → retrigger the manual `<AI_REVIEW_RETRY_JOB>` job instead.
