---
name: config
description: Use while the my-day loop runs, whenever the user's answer or instruction changes how the loop should behave from now on - "ignore ABC-50", "don't merge on Fridays", "always ask before rebasing", "route frontend bugs to CI", "stop notifying me about drafts", "add Anna as reviewer for the API repo" - or when the loop discovers a fact it will need again (a bot account, a status name, a job name). Writes the rule into the right .my-day/*.md file so it survives the session.
---

# my-day config update

`$SM` = `${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/state.mjs` (full path in every Bash call).
Read the current config with `$SM config show <NAME>` / `$SM config all`.

A decision that only lives in the state DB or in this conversation is lost next session and
never reaches teammates. Encode it in config.

## 1. Recognise it
Triggers: "from now on", "always", "never", "stop …", "don't …", "ignore …", "only …",
"prefer …", an answer to a loop question that implies a rule ("no, never assign me
DevOps bugs"), or a runtime discovery the loop will need again. A one-off decision about a
single item ("skip this review", "retry bug-3") is **not** a config change — just act on it.
Unsure → ask: "Make this a standing rule?"

## 2. Find the owner file
| The rule is about … | File |
|---|---|
| tracker, code host, group, ticket pattern, AI reviewer bot, target branch, required sources (`requires`) | `LOOP.md` front matter |
| whether to ask before an outward write ("stop asking before Jira comments", "never DM people") | `WRITES.md` (a row's policy: ask / auto / never) |
| what counts as my work, ignored items | `QUERY-MY-TASKS.md` (`## Scope` + every query's exclusion clause) |
| unassigned work, what to ask, ranking | `QUERY-INBOX.md`, `TRIAGE.md` |
| steps / routing / brainstorm vs fix order | `WORKFLOW-BUG.md`, `WORKFLOW-STORY.md`, `WORKFLOW-SUBTASK.md` |
| worktrees, branch names, repo order, tooling per repo | `DEVELOP.md` |
| review comments, AI reviewer identity, push-back rules | `FIX-REVIEW.md` |
| merging, gates, rebase, force-push, trains | `MERGE-GATES.md` |
| pipeline handling, reviewers, ticket transitions | `POST-MR.md` |
| cadence, hours, limits, notifications volume, dream schedule | `LOOP.md` |
| what a dream checks for | `DREAM.md` (optional; create from the template) |
| pm: backlog scope, definition of ready | `QUERY-BACKLOG.md`, `HYGIENE.md` |
| pm: feedback sources, grouping, ticket threshold | `QUERY-FEEDBACK.md`, `FEEDBACK.md` |
| pm: whose questions count, specs workflow, status update | `QUERY-MENTIONS.md`, `WORKFLOW-SPEC.md`, `STATUS.md` (cadence: `statusSchedule` in `LOOP.md`) |

## 3. Shared or personal?
- Team rule (everyone using this workspace should behave this way) → `X.md` (committed).
- Personal preference or personal data (my hours, my account id, my notification taste,
  `dryRun`) → `X.local.md` (gitignored). Create it if missing; it extends / overrides `X.md`.
- Not obvious → ask once: "Team rule or just for you?"

## 4. Edit
- Smallest edit that encodes the rule, in the file's existing style; one line of *why* when
  the reason isn't obvious.
- Keep derived places in sync: an ignored item goes into the `## Scope` list **and** every
  query's exclusion clause; a renamed status changes every file that uses it
  (`grep -n "<old>" .my-day/*.md`).
- Conflicts with an existing rule → show both and ask which wins; don't stack contradictions.
- If the rule changes a query, run the query once and show the new result.

## 5. Apply and record
- Re-read the changed file (`$SM config show <NAME>`) before the next tick uses it.
- Apply the rule to current state where it matters (e.g. ignored item → `$SM set <id> status=ignored`;
  answer the open question with `$SM answer`).
- `$SM event - config-changed "<FILE>: <one-line rule>"`.
- Tell the user in one line: file, rule, shared or local. Shared files are for the user to
  commit; never commit or push them yourself.
