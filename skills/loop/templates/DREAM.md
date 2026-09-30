<!-- TEMPLATE — generic check ideas for my-day:dream. Keep the ones that fit this workspace, delete the rest, add your own. Without a DREAM.md the dream uses this template as is. Personal checks go into DREAM.local.md. -->
# Dream checks

A dream reads `$SM dream-data` (events, failures, questions, reconciles, attempts,
created → merged times, reviews, config changes since the last dream) plus the workspace
config, and looks for the patterns below. Every finding cites item ids (`bug-3`, `mr-7`) or
event ids (`#412`) as evidence; no evidence, no finding.

## Rules to encode
- The same answer given 2+ times to similar questions (e.g. "yes, take it", "skip drafts",
  "always rebase first") → propose a standing rule in the file that owns it.
- Questions declined repeatedly → the loop should stop asking them.
- Items manually set to `ignored` / `skipped` with a common trait (label, area, title
  pattern) → propose a scope exclusion.

## Recurring failures and root causes
- Worker failures with the same cause across items: local checks passing while CI fails,
  stale caches or lockfiles, flaky tests, missing environment variables or secrets,
  generated code out of date, wrong base branch.
- Retry and escalation hotspots: items with the most dispatches, and what each attempt
  changed (or did not).
- Rebase or merge trains that failed and why (conflicts, required approvals reset, pipeline
  re-runs).
- Deploy or release prerequisites missed before a merge (migrations, feature flags, a
  dependency or package release, a contract published first).
- Cross-repo contract changes that broke consumers (API, schema, shared package) — was the
  dependency order in DEVELOP.md followed?
- Tickets reopened after QA or review, and why.

## Flow and latency
- Time from `created` to `merged` per item type; the slowest items and where they waited.
- Time an approved MR/PR waited for a merge (gates, trains, pipeline, working hours).
- Review latency per repo and per reviewer, for my MRs and for reviews requested from me.
- AI-reviewer comment outcomes: fixed vs pushed back vs escalated — a signal for tuning the
  reviewer's prompt or FIX-REVIEW.md's classification.

## Config health
- Drift or contradictions between files (e.g. a status name used in one workflow file but
  renamed in another, a repo listed in DEVELOP.md but missing from the reviewer map).
- Rules added via `config-changed` that are never exercised, or that conflict with later
  answers.
- Cadence and limits: tick interval (`idleMinutes`, `busyFallbackMinutes`), `maxAgents`,
  `retryLimit`, `pipelineTimeoutMinutes` — too many idle ticks, agents waiting on slots,
  retries that never succeed after the first failure.

## Plugin and tooling issues
- Errors from the loop's own tools: a sync aborted by one failing API call, a CLI that
  returned unparsable output, a dashboard or notification that did not fire, a worker that
  returned no JSON result.
- Workarounds the loop repeated that belong in the tool itself — worth filing as an issue
  on the plugin or tool (draft it; never file without approval).

## Team / way of working
Observations, not verdicts. Phrase them as questions for the team:
- Where does work wait on people (reviews, answers, approvals), and is it the same few?
- Are stories arriving specified enough to develop, or does most time go into clarifying?
- Are MRs small enough to review quickly? Do large ones correlate with long review times?
- Are there recurring after-hours or end-of-week merges that raise risk?
- Which conventions (branch names, commit style, ticket links) are followed inconsistently?
- Is any repo or area a frequent source of failures that deserves a team discussion?
