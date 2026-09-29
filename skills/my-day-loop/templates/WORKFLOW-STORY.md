<!-- TEMPLATE — a worked example (Jira + GitLab). my-day-setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Workflow: Story / Task

## States
new → brainstorm-queued → brainstorming → awaiting-answers → ready → developing → mr-open → post-mr → in-review → approved → merged → done

## Transitions
- new → brainstorm-queued: description empty/incomplete, or no spec in description/comments. Already specified → ready.
- brainstorm-queued → brainstorming: main session is free (one brainstorm at a time). Run `<BRAINSTORM_STORY_SKILL>` **in the main session**.
- brainstorming → awaiting-answers: brainstorm posted "<OPEN_QUESTION_MARKER>" comments.
- brainstorming → ready: no open questions left.
- awaiting-answers → ready: replies found on refresh → run `<REVIEW_ANSWERS_SKILL>` in the main session; no open questions remain.
- ready → developing: route (below), set `data.routing`.
- developing → mr-open: MR exists (CI plan MR or worker MR). Link it.
- mr-open → post-mr → in-review: `POST-MR.md`.
- in-review → approved → merged: `MERGE-GATES.md`.
- merged → done: all MRs of the ticket merged; transition Jira per `POST-MR.md`; remove worktrees.

## Routing (ready → developing)
- **CI plan** (`data.routing=ci`): stories; anything touching more than one repo; anything whose spec lists more than ~5 files. Run `<PLAN_TICKET_SKILL>` in the main session → draft MR with `<CI_PLAN_MARKER>` commit → CI `<CI_PLAN_JOB>` implements it. One plan MR per repo, dependency order from `DEVELOP.md`.
- **Local worker** (`data.routing=local`): small single-repo tasks. Dispatch a `develop` worker (`DEVELOP.md`).
- Unsure → ask in the session with a recommendation.

## Failure
Worker failed or CI plan implementation failed `retryLimit` times → `$SM fail <id> --reason …` + ask.
