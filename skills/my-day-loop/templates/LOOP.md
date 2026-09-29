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
forge: <FORGE>            # gitlab | github
group: <GROUP>/
ticketPattern: '<TICKET_REGEX>'
aiReviewer: <AI_REVIEWER_BOT>   # bot account of the AI review job, if any
targetBranch: main
reviewBatchNotify: 3
# Personal keys belong in LOOP.local.md: trackerAccountId, gitEmail
---

<!-- TEMPLATE — a worked example (Jira + GitLab). my-day-setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->

# Loop

State CLI: `bin/state.mjs` of the my-day plugin's `my-day-loop` skill (`$SM` below; the skills give the full path).

## Tick priority
1. Merge-ready MRs (`MERGE-GATES.md`)
2. Post-MR steps for freshly opened MRs (`POST-MR.md`)
3. Review fixes and rebases on my MRs (`FIX-REVIEW.md`, `MERGE-GATES.md`)
4. My bugs (`WORKFLOW-BUG.md`)
5. My stories / tasks / subtasks (`WORKFLOW-STORY.md`, `WORKFLOW-SUBTASK.md`)
6. Review requests for me (`QUERY-MY-REVIEWS.md`) — dashboard notification only
7. Inbox triage (`TRIAGE.md`) — only when 1–5 have nothing actionable

## Outside working hours
Refresh (read-only) is fine; no dispatches, brainstorms or outward writes. Wakeups are capped at
60 minutes, so schedule hourly `noop` ticks until the window opens.

## Communication
All questions go to the main session (reached via Remote Control). The dashboard only mirrors them.
