---
name: my-day-summary
description: Use when the user asks what my-day did or is doing - "summary", "what happened today", "status", "what failed", "summary since Monday" - or asks to elaborate on a my-day item ID like bug-1 or mr-4.
---

# my-day summary

`$SM` = `~/.claude/skills/my-day-loop/bin/state.mjs` (full path, run from the workspace root).

- Summary: `$SM summary [--today|--yesterday|--since D|--from D --to D]` (default today).
  Report tightly: merged, in review, running agents, failed (links or the elaborate hint),
  open questions, pending reviews; add the dashboard URL from `$SM server status`.
- Now: `$SM list [--failed]`, `$SM questions`.
- `elaborate <id>`: `$SM show <id>`, then read what it links to (MR, pipeline, ticket) and its
  worktree (`git -C <worktree> log --oneline origin/main..`). Explain what happened, why it's
  stuck, and the next step; offer `retry <id>`.
