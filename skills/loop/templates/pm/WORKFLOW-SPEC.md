<!-- TEMPLATE — a worked example (Jira + Confluence). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts. -->
# Workflow: spec

From an idea or an epic to a PRD and ready stories.

## States
new → brainstorm-queued → brainstorming → awaiting-answers → prd-draft → prd-review → stories-draft → stories-created → done

## Transitions
- new → brainstorm-queued: the epic or idea has no PRD linked (`$SM show <id>` links, the epic's
  description). Already has a reviewed PRD → stories-draft.
- brainstorm-queued → brainstorming: the session is free (one brainstorm at a time). Run
  `<BRAINSTORM_SKILL>` (default `superpowers:brainstorming`) **in the session** with me: problem,
  users, success measures, scope and non-goals, open questions.
- brainstorming → awaiting-answers: questions only others can answer (design, engineering,
  legal …) → draft them as comments or messages to those people (`WRITES.md`); collect replies
  on refresh.
- brainstorming / awaiting-answers → prd-draft: no open questions. Write the PRD from
  `<PRD_TEMPLATE>` (problem, goals, non-goals, users, requirements, success metrics, risks,
  open questions) as a draft page in `<SPEC_SPACE>` (`confluence: create draft`, `WRITES.md`);
  link it (`$SM link <id> --kind spec --url …`).
- prd-draft → prd-review: draft written → ask me to review it in the session, with the three
  decisions I most need to make. My changes → edit the draft.
- prd-review → stories-draft: I approve the PRD → publish it (`confluence: publish`) and draft
  the stories: one per user-visible outcome, each with acceptance criteria, linked to the epic,
  sized so one fits in a sprint. One draft for the whole set (`jira: create issue`).
- stories-draft → stories-created: approved and created → link each (`$SM link <id> --kind jira`).
- stories-created → done: every story is in the backlog; the epic description links the PRD.

## Failure
A step that fails `retryLimit` times (a tool error, a page that cannot be written) →
`$SM fail <id> --reason …` + tell me.
