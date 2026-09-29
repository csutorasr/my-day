<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Workflow: Bug

Fix first, then spec, then brainstorm.

## States
new → attempting → mr-open → post-mr → in-review → approved → merged → done
                 ↘ spec → spec-ready → attempting (second try with the spec)
                          ↘ brainstorm-queued → brainstorming → ready → attempting

## Transitions
- new → attempting: dispatch a `bug` worker.
- attempting → mr-open: worker `status=done` with `mrUrl`.
- attempting → spec: worker `failed|blocked`. Record `fail_reason` in `data.firstAttempt`. Run `<BUG_SPEC_SKILL>` (main session; it posts the spec as a Jira comment).
- spec → spec-ready: spec written with a confident root cause → dispatch a second `bug` worker with the spec.
- spec → brainstorm-queued: root cause still unclear, or the fix needs product decisions.
- brainstorming → ready: questions resolved → attempting.
- attempts ≥ retryLimit at any point → `$SM fail <id>` + ask me.
- mr-open onwards: `POST-MR.md`, `MERGE-GATES.md`.
