---
# Shared loop settings. Override any key in LOOP.local.md (gitignored).
maxAgents: 0              # the pm loop reads and drafts in the session; no background workers
retryLimit: 3             # attempts per item before escalating
idleMinutes: 20           # wakeup cadence
busyFallbackMinutes: 30
workingHours: 08:00-18:00
workingDays: Mon-Fri
retentionDays: 30         # events older than this are pruned
port: 4711
dryRun: false             # true = log outward actions instead of doing them (rehearsal)
# Scope
tracker: <TRACKER>        # jira | github | gitlab | linear | azure | other | none
forge: none               # no code-host sync: merge requests are not this loop's work
requires: <REQUIRES>      # sources the loop cannot work without, e.g. mcp:atlassian, mcp:slack, mcp:intercom
statusSchedule: <STATUS_SLOT>   # when the status update is due, e.g. Fri 14:00 (STATUS.md); '' = off
hygienePerTick: 5         # backlog tickets checked per tick (HYGIENE.md)
dreamSchedule: ''          # weekly local reflection (my-day:dream), e.g. Fri 17:00; '' = off
# Personal keys belong in LOOP.local.md: trackerAccountId, slackUserId
---

<!-- TEMPLATE — the pm profile, a worked example (Jira + Confluence + Slack + Intercom). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tools. -->

# Loop

State CLI: `bin/state.mjs` of the my-day plugin's `loop` skill (`$SM` below; the skills give the full path).

## Files
QUERY-BACKLOG.md, HYGIENE.md, QUERY-FEEDBACK.md, FEEDBACK.md, QUERY-MENTIONS.md,
WORKFLOW-SPEC.md, STATUS.md

## Items
`ticket` (a backlog ticket with hygiene findings in `data.findings`), `spec` (an idea or epic on
its way to a PRD and stories), `feedback` (a cluster of requests; sources as links), `thread` (a
stakeholder question waiting for my reply), `report` (one status update per period).

## Tick priority
Refresh (read-only), each only while its source is up (`tick` → `sources`): `QUERY-BACKLOG.md`,
`QUERY-FEEDBACK.md`, `QUERY-MENTIONS.md` → `$SM upsert-many`. Items gone from a query's scope →
`status=closed` + event, only from a query that succeeded.

1. `approvedDrafts` → write each exactly as approved (`WRITES.md`), then `$SM wrote <q>`.
2. `thread` items → answer from what the tracker, the specs and earlier threads say; draft the
   reply (`WRITES.md`). Can't answer → ask me in the session with what is missing.
3. `schedule.due` has `status` → `STATUS.md`; then `$SM schedule-done status "<summary>"`.
4. `spec` items → next transition of `WORKFLOW-SPEC.md`. Brainstorms run in the session, one at a
   time (queue others as `brainstorm-queued`).
5. New `feedback` items → `FEEDBACK.md`.
6. Backlog hygiene (`HYGIENE.md`) — only when 1–5 have nothing actionable; at most
   `hygienePerTick` tickets.

## Outside working hours
Refresh (read-only) is fine; no brainstorms, drafts or outward writes. Wakeups are capped at
60 minutes, so schedule hourly `noop` ticks until the window opens.

## Communication
All questions and drafts go to the loop's session (its T3 Code thread, or Remote Control). The
dashboard mirrors them and can approve, edit or decline drafts.
