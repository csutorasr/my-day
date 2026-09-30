---
name: dream
description: Use when the my-day loop's tick reports `dreamDue`, or when the user asks to "dream", "reflect on the last week", "what should my-day learn", "retro the loop". A periodic local reflection run over the loop's own history that proposes config edits, writes a report and flags team and tooling issues. Runs only in a local session, never in the cloud.
---

# my-day dream (local reflection)

`$SM` = `${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/state.mjs` (full path in every Bash call, run
from the workspace root). The loop's main session runs this; it is not a worker.

**Local only.** A dream needs `.my-day/state.db`, the `*.local.md` files and this session's
context — a cloud or remote-scheduled run can't reach them. Never schedule or run it in the
cloud; if `$SM config dir` has no `state.db`, stop and say so.

**Read-only outward.** No tracker, code-host, chat or forge writes (no comments, transitions,
issues, MR edits) unless the user approves that specific action in this session.

## 1. Gather
- `$SM dream-data --json` (window: since `lastDreamAt`, else 7 days; the user may give
  `--since <date>`). It holds `events.byKind` / `events.byItem`, `failed`, `questions`
  (answers and declines), `reconciles`, `attempts`, `cycleTimes` (created → merged, hours),
  `reviews`, `configChanges`.
- `$SM config all` — the workspace config, including `DREAM.md` + `DREAM.local.md` when present.
- Checks: the `DREAM.md` section of `config all`; no `DREAM.md` → read
  `${CLAUDE_PLUGIN_ROOT}/skills/loop/templates/DREAM.md` and use its defaults.
- Drill into an item only when a finding needs it: `$SM show <id>`. Reading code-host or
  tracker data is fine; keep it to what the evidence needs.

## 2. Analyse
Run each check against the bundle. A finding needs evidence: item ids (`bug-3`) or event ids
(`#412`, from `events.byKind[].id`). No evidence → drop it. Prefer patterns (2+ occurrences)
over one-offs. "Rules to encode" means an answer repeated 2+ times.

## 3. Report
Write `.my-day/dreams/<YYYY-MM-DD>.md` (local date; add `-2` … when the file exists).
The folder is gitignored — create it if missing. Sections, each finding with its evidence:
```
# Dream <date> (<window from> → <until>)
## What went well
## Recurring failures and root causes
## Rules to encode
## Team and way of working
## Plugin or tooling issues worth filing
## Proposed config edits
```
Empty section → "Nothing notable." Team observations are phrased as questions, never as
judgements about named people. Tooling issues get a draft title + body; filing them is an
outward action (ask first).

## 4. Propose config edits
For each rule worth encoding, show a diff against the owning `.my-day/*.md` (owner table in
`my-day:config`), with the evidence and whether it is shared (`X.md`) or personal
(`X.local.md`). Ask once, listing them numbered: "Apply 1, 3? (all / none / numbers)".
- Approved → apply each through the `my-day:config` skill (it keeps derived places in sync
  and logs `config-changed`). Never apply an edit silently or without approval.
- Declined → leave it in the report as "not applied".
- Cadence or limit changes (`idleMinutes`, `maxAgents`, `retryLimit`, `dreamSchedule`) are
  config edits too.

## 5. Finish
- `$SM dream-done --report .my-day/dreams/<file>.md "<one line: N findings, M edits applied>"`
  → records `lastDreamAt` and logs the `dream` and `notify` events.
- In the session: 3–6 lines — top findings, edits applied, report path.
- Hand back to the loop (`my-day:loop` resumes its tick).
