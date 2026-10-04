---
# Shared loop settings. Override any key in LOOP.local.md (gitignored).
maxAgents: 3              # background worktree agents at once
retryLimit: 3             # attempts per item before escalating
idleMinutes: 20           # wakeup cadence when no agent is running
busyFallbackMinutes: 30   # fallback wakeup while agents run (they wake the session themselves)
workingHours: 08:00-18:00
workingDays: Mon-Fri
retentionDays: 30         # events older than this are pruned
pipelineTimeoutMinutes: 60
port: 4711
dryRun: false             # true = log outward actions instead of doing them (rehearsal)
# Scope (read by `state.mjs tick`)
tracker: <TRACKER>        # jira | github | gitlab | linear | azure | other | none
forge: <FORGE>            # gitlab | github | none (no code-host sync)
group: <GROUP>/
ticketPattern: '<TICKET_REGEX>'
aiReviewer: <AI_REVIEWER_BOT>   # bot account(s) of AI reviewers, comma-separated, if any
requires: <REQUIRES>      # sources the loop cannot work without, e.g. mcp:atlassian, cli:glab
targetBranch: main
reviewBatchNotify: 3
hideCoveredReviews: false  # true = hide reviews others already handled, until re-requested with an approval still needed
dreamSchedule: ''          # weekly local reflection (my-day:dream), e.g. Fri 17:00 or Mon,Thu 09:30; '' = off
# Personal keys belong in LOOP.local.md: trackerAccountId, gitEmail
---

<!-- TEMPLATE — the dev profile, a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->

# Loop

State CLI: `bin/state.mjs` of the my-day plugin's `loop` skill (`$SM` below; the skills give the full path).

## Files
QUERY-MY-TASKS.md, QUERY-MY-REVIEWS.md, QUERY-INBOX.md, TRIAGE.md, WORKFLOW-STORY.md,
WORKFLOW-SUBTASK.md, WORKFLOW-BUG.md, DEVELOP.md, FIX-REVIEW.md, MERGE-GATES.md, POST-MR.md

## Tick priority
Tracker sync: run the ticket queries in `QUERY-MY-TASKS.md` → `$SM upsert-many`; items gone from
scope → `status=closed` + event, only from a query that succeeded while its source is up (`tick` →
`sources.down`); `awaiting-answers` tickets → look for replies. `QUERY-INBOX.md`
only when 1–5 find nothing actionable. Code host and reviews come from `$SM tick` (`sync`).

1. `act.merge` → extra gates in `MERGE-GATES.md` (dependencies, trains) → merge; event `merged`.
2. MRs in `mr-open` / `post-mr` → next unfinished `POST-MR.md` step; progress in `data.postMr`;
   never block on a pipeline.
3. `act.rebase` → per `MERGE-GATES.md` (server-side first, `rebase` worker on failure).
   `act.fix-review` / `act.fix-pipeline` → `review-fix` / `pipeline-fix` worker (`FIX-REVIEW.md`).
4. My bugs → next transition of `WORKFLOW-BUG.md`.
5. My stories / tasks / subtasks → next transition of `WORKFLOW-STORY.md` / `WORKFLOW-SUBTASK.md`.
   Brainstorm, spec and planning steps run in the session, one brainstorm at a time (queue others
   as `brainstorm-queued`); code steps → `develop` / `bug` worker (`DEVELOP.md`).
6. Review requests for me (`QUERY-MY-REVIEWS.md`) — dashboard notification only.
7. Inbox triage (`TRIAGE.md`) — only when 1–5 have nothing actionable.

## Outside working hours
Refresh (read-only) is fine; no dispatches, brainstorms or outward writes. Wakeups are capped at
60 minutes, so schedule hourly `noop` ticks until the window opens.

## Communication
All questions go to the main session (reached via Remote Control). The dashboard only mirrors them.
