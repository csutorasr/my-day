---
name: worker
description: Worker skill for a background agent dispatched by the my-day loop - implements a ticket, attempts a bug fix, fixes MR/PR review comments or a red pipeline, or rebases a branch, on its own git worktree. Loaded by the agent prompt the loop sends; not for direct use.
---

# my-day worker

Your prompt gives: Kind, workspace root, item id, task, dry run — and, when the loop runs you as
`claude -p` in one repo, `Repo`, `Worktree` (your working directory, already created) and maybe
`Previous runs` (what earlier repos of this ticket did: branch, MR, summary; build on them). `$SM` =
`${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/state.mjs` (full path each call; run from the workspace
root). Read `$SM show <id>`, `$SM config show DEVELOP` and your kind's file below. Never
write my-day state — the orchestrator does that from your final message.

## Every kind
1. Worktree in the sub-repo exactly as DEVELOP.md says (given `Worktree:` → work there and only in
   that repo; do not create another); first command in it:
   `git config user.email <gitEmail>` (`$SM config settings`).
2. Follow the repo's CLAUDE.md / README. Its build, tests and lint must pass for what you
   touched.
3. Commit per repo convention with the ticket key. Push and open/update the MR/PR only when
   dry run is false and the task doesn't say "local only". Never merge. Force-push only as
   MERGE-GATES.md allows.
4. End with exactly one JSON block:
   ```json
   {"status":"done|failed|blocked","mrUrl":"…","branch":"…","worktree":"…","commits":["sha subject"],
    "summary":"…","blockers":["…"],"links":[{"kind":"pipeline","url":"…"}],"handled":[{"discussionId":"…","action":"fixed|pushed-back|escalated"}],
    "drafts":[{"action":"jira: comment","target":"ABC-1","body":"…"}]}
   ```
5. Outward writes follow `WRITES.md` (`$SM config show WRITES`; none → all `auto`): never make
   an `ask` or `never` one yourself — put it in `drafts`, the loop asks. A tool or MCP server you
   need is missing → `blocked` with `missing mcp:<name>` (or `cli:<bin>`) in `blockers`.

## Kinds
| Kind | Also read | How |
|---|---|---|
| `develop` | WORKFLOW-STORY or -SUBTASK | Read the ticket, its parent and the spec via the tracker in QUERY-MY-TASKS.md. Plan (`superpowers:writing-plans` beyond a few files), then `superpowers:test-driven-development`. |
| `bug` | WORKFLOW-BUG | `superpowers:systematic-debugging`. Regression test first, then the fix. No root cause → `failed` with hypotheses, files and evidence (they feed the spec step). |
| `review-fix` | FIX-REVIEW | Threads: `data.unresolved` in `$SM show <id>`, or `${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/forge.mjs mr <project> <n> --provider <forge>`. Classify fix / push back / escalate with `superpowers:receiving-code-review`; reply and resolve as FIX-REVIEW.md says; fill `handled`. |
| `pipeline-fix` | POST-MR | Read the failed job log; `superpowers:systematic-debugging`; fix only what our change broke. |
| `rebase` | MERGE-GATES | `git rebase origin/<target>`, resolve, run tests, `git push --force-with-lease`. Unclear conflict → `blocked`. |
