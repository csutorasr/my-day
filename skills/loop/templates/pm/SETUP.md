# Setup: the pm profile

Followed by `my-day:setup` for a product manager's workspace: a backlog in a tracker, specs in a
docs tool, feedback and stakeholders in chat, email or a support tool. The loop reads and drafts
in the session (no workers, no code host); everything it sends out goes through `WRITES.md`.
Templates in this folder are a worked example (Jira + Confluence + Slack + Intercom); adapt them
to what the user actually uses — never assume the example's tools.

## 0. Explore (read-only, on top of the generic exploration)
- Connected MCP servers and CLIs (tracker, docs, chat, email, support, analytics). Each one the
  user picks below goes into `LOOP.md` `requires` as `mcp:<server>` / `cli:<bin>`.
- The user's recent tracker activity: projects, boards, epics they own or report.

## 1. Tracker
Follow `templates/TRACKERS.md`. For this profile: **(a)** the projects / boards the user owns;
**(b)** epics (or the tracker's equivalent) → `spec`, stories / tasks / bugs → `ticket`;
**(c)** which states mean *upcoming* (hygiene candidates) and *done*; **(d)** and **(e)** as
there. Results → `QUERY-BACKLOG.md`. Run the upcoming-work query once and ask "is this the
backlog you groom?".

## 2. Interview
One question at a time, proposing what exploration found:
1. **Definition of ready** — what a ticket needs before a sprint (acceptance criteria,
   estimate field, epic link, labels); when it is stale; how big is too big. → `HYGIENE.md`.
2. **Specs** — where PRDs live (Confluence, Google Docs, Notion, Claude Docs …), the template if
   there is one, and the brainstorm skill to use (default `superpowers:brainstorming`).
   → `WORKFLOW-SPEC.md`.
3. **Feedback** — which channels, support tags or forms carry requests; the threshold for
   proposing a ticket; whether to thank requesters. → `QUERY-FEEDBACK.md`, `FEEDBACK.md`.
4. **Stakeholders** — who asks the user things, and where (channels, DMs, email senders).
   → `QUERY-MENTIONS.md`.
5. **Status update** — cadence (→ `statusSchedule`, e.g. `Fri 14:00`), audience, channel,
   format. → `STATUS.md`.
6. **Outward writes** — show the `## Writes defaults` below, named for the chosen tools, and
   ask which to loosen or tighten. → `WRITES.md`.
7. "Enable weekly dreaming? When?" — as in the dev profile: `dreamSchedule` in `LOOP.local.md`.

## 3. Write the files
`LOOP.md` → QUERY-BACKLOG → HYGIENE → QUERY-FEEDBACK → FEEDBACK → QUERY-MENTIONS →
WORKFLOW-SPEC → STATUS → WRITES (`templates/WRITES.md`) → DREAM (optional), each as the generic
setup says: placeholders replaced, tools rewritten, unused sections deleted, queries run once.
Personal data (account ids, Slack user id, `dryRun`) → `LOOP.local.md`.

## 4. Check the sources
`$SM bootstrap` checks the `cli:` sources; check each `mcp:` one against the session's tools and
report it with `$SM source <name> ok|missing`. A missing one → help the user connect it, or drop
the parts that need it (and its `requires` entry).

## Writes defaults
| action | policy | note |
|---|---|---|
| confluence: create draft | auto | a draft page nobody is notified about |
| confluence: publish | ask | |
| jira: comment | ask | |
| jira: edit fields | ask | |
| jira: create issue | ask | |
| jira: transition · assign · change priority or sprint | never | the team's call |
| slack: post channel | ask | |
| slack: reply thread | ask | |
| slack: send DM | ask | |
| gmail: send | never | fallback: `gmail: create draft` |
| gmail: create draft | auto | lands in my drafts folder |
| intercom: reply | never | support answers customers |
| default | ask | |
