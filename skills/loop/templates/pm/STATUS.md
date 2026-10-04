<!-- TEMPLATE — a worked example (Jira + Slack). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts. -->
# Status update

Due when `tick` → `schedule.due` lists `status` (`statusSchedule` in `LOOP.md`).

## Gather (read-only)
- Since the last update (`$SM events --since <lastStatusAt>`, the tracker): tickets done,
  epics moved, specs that changed state.
- In progress: the sprint's open tickets by epic; anything blocked or past its due date.
- Risks: blocked tickets, specs waiting on answers for more than `<WAIT_DAYS>` days, feedback
  clusters that grew fast.
- Asks: decisions I need from the audience.

## Write
One `report` item per period: `--type report --ext status:<yyyy>-w<week> --title "Status, week <n>"`.
Format, in this order, plain sentences, no internal ticket jargon:

```
<TITLE_LINE>
Shipped: …
In progress: …
Risks: …
Asks: …
```

Keep it under `<MAX_LINES>` lines; link the board for detail.

## Send
Audience `<AUDIENCE>` in `<STATUS_CHANNEL>` → one draft (`slack: post channel`, `WRITES.md`).
Written → status `done`; `$SM schedule-done status "posted <title>"`.
