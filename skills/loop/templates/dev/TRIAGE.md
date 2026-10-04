<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Triage

## Unassigned bug (seen for the first time)
1. Ask in the session: "Assign <id> (<key>: <summary>) to you?" (`$SM ask <id> "…"`). Never ask twice (check `$SM questions --status answered|declined` for the item).
2. Yes → assign in Jira to me (`editJiraIssue`, assignee = `trackerAccountId` from `$SM config settings` (set in LOOP.local.md; see <TEAM_ROSTER_FILE>)), status → `new`, enters `WORKFLOW-BUG.md`.
3. No → `$SM decline`, status `ignored`.
4. When I have **nothing actionable of my own** (my MRs, bugs, stories all waiting): start a background fix attempt on the highest-priority unassigned bug even before I answer, following `WORKFLOW-BUG.md` steps up to a local commit — **no push, no MR, no Jira writes** until I accept the assignment.

## Unassigned story
1. Ask: "Take <id> (<key>: <summary>) as next?".
2. If more than one story is waiting, rank them first and ask once with the proposed order:
   - active sprint before backlog
   - priority (Highest → Lowest)
   - Jira rank
   - stories blocking others (issuelinks "blocks") before the ones they block; never propose a story that is blocked by an open ticket
   - fewer repos touched first when otherwise equal
3. Yes → assign to me, status `new`, enters `WORKFLOW-STORY.md`.

## Never
- Assign anything to anyone else.
- Transition inbox tickets before I say yes.
