<!-- TEMPLATE — a worked example (Jira). my-day:setup replaces every <PLACEHOLDER> and rewrites the checks to the team's definition of ready. -->
# Backlog hygiene

Runs only when nothing else is actionable, on at most `hygienePerTick` `ticket` items per tick,
oldest check first (`data.checkedAt`).

## Definition of ready
A ticket in the upcoming work is ready when it has:
- acceptance criteria (a list under "Acceptance criteria" in the description)
- an estimate (`<ESTIMATE_FIELD>`)
- a parent epic, unless it is a bug
- labels for its area (`<AREA_LABELS>`)
- no open "blocked by" link to an unresolved ticket

## Also flag
- duplicates: same intent as another open ticket (title and description), cite both keys
- stale: not updated for `<STALE_DAYS>` days while in a future sprint
- too big: estimate above `<MAX_ESTIMATE>` or more than ~8 acceptance criteria → propose a split

## Per ticket
1. Check it; store `data.findings` (list of short strings) and `data.checkedAt`.
2. No findings → status `ready`.
3. Findings → status `needs-fix`, and **one** draft per ticket with every fix:
   acceptance criteria written from the description and linked spec, a split proposal, the
   duplicate to close. Action `jira: edit fields` (or `jira: comment` when only a question can
   fix it), target the key (`WRITES.md`).
4. Draft approved and written → recheck on the next hygiene pass.

## Never
- Change priority, sprint, assignee or status — that is the team's call.
- Close a duplicate without approval, whatever `WRITES.md` says.
