<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# After an MR is opened

1. Assign the Jira ticket to me (if not already) and transition it to **<STATUS_IN_REVIEW>**.
2. Assign the MR to me: `glab mr update <iid> -R <path> --assignee @me`.
3. Wait for the pipeline (poll `head_pipeline.status`, timeout `pipelineTimeoutMinutes`).
   - `success` → step 4.
   - `failed`:
     - failure caused by our change → `pipeline-fix` worker, then wait again.
     - looks flaky (infra/network/timeout, unrelated job) → retry the job once (`glab ci retry`).
     - unrelated to our change and retry failed → escalate.
4. AI reviewer (`<AI_REVIEW_JOB>` job) comments → `FIX-REVIEW.md` with only the AI comments, then wait for the next pipeline and repeat until no new actionable AI comments (max `retryLimit` rounds).
5. Assign reviewers by domain from `<TEAM_ROSTER_FILE>`:
   - <REPO or path> → <DOMAIN> (<people from the roster>)
   - <REPO or path> → <DOMAIN> (<people from the roster>)
   Pick 1–2, never myself. Resolve GitLab usernames via `glab api "users?search=<email>"`.
6. Mark the MR ready (undraft) if it is a draft created by a worker (not `<CI_PLAN_MARKER>` MRs until CI finished).
7. Status → `in-review`.

## After merge
All MRs of the ticket merged → transition Jira to **<STATUS_DEV_DONE>**, status `done`, remove worktrees.
