<!-- TEMPLATE — a worked example (Jira). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker. -->
# Query: backlog

Source: `mcp:atlassian`. Atlassian MCP `searchJiraIssuesUsingJql`, cloudId `<JIRA_SITE>`,
fields `summary,status,issuetype,priority,updated,labels,parent` only,
`responseContentFormat: markdown`. Fetch description, estimate and links per ticket only when
`HYGIENE.md` checks it.

## Scope
- Projects / boards I own: `<JIRA_PROJECT>` (board `<BOARD>`)
- Ignored items (buckets, umbrella work):
  - `<KEY>` <why it is ignored>
  Keep this list in sync with the `key not in (…)` clauses below.
- Areas that belong to other teams: `<LABELS>`

## Upcoming work (hygiene candidates)
```jql
project = <JIRA_PROJECT> AND statusCategory = "To Do"
  AND issuetype in (Story, Task, Bug)
  AND (sprint in openSprints() OR sprint in futureSprints() OR Rank is not EMPTY)
  AND key not in (<IGNORED_KEYS>)
ORDER BY Rank ASC
```
Upsert `--type ticket --ext jira:<key> --title "<key>: <summary>" --url https://<JIRA_SITE>/browse/<key>`,
status `unchecked` for new ones (`HYGIENE.md` moves them on). Only the first 50 by rank.

## Epics and ideas (specs)
```jql
project = <JIRA_PROJECT> AND issuetype = Epic AND statusCategory != Done
  AND (assignee = currentUser() OR reporter = currentUser())
  AND key not in (<IGNORED_KEYS>)
ORDER BY Rank ASC
```
Upsert `--type spec --ext jira:<key>`, status `new` for new ones (`WORKFLOW-SPEC.md`). Ideas I
give in the session ("spec out X") become `--type spec --ext idea:<slug>` with status `new`.
