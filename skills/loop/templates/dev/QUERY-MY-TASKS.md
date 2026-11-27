<!-- TEMPLATE — a worked example (Jira + GitLab). my-day:setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Query: my tasks

Run the Jira query every tick; upsert results with `$SM upsert-many` (idempotent on `ext`).

## Scope
Tracker, code host, group, ticket pattern and AI reviewer are in `LOOP.md` front matter.
- Jira project keys: `<JIRA_PROJECT>`
- Ignored continuous / bucket tickets (time tracking, umbrella work — never developed, never triaged):
  - `<KEY>` <why it is ignored>
  Keep this list in sync with the `key not in (…)` clauses below and in `QUERY-INBOX.md`.

## My merge requests
Handled by `$SM tick` (sync): upserts my open MRs (`mineBy` in `LOOP.md`: assigned to me,
opened by me and/or nobody assigned), links them to tracked tickets by
`ticketPattern`, stores gate data + `data.verdict` (merge | rebase | fix-review |
fix-pipeline | wait), and marks merged/closed ones.

## My Jira tickets
Atlassian MCP `searchJiraIssuesUsingJql`, cloudId `<JIRA_SITE>`,
fields `summary,status,issuetype,parent,priority` only, `responseContentFormat: markdown`
(more fields, or none, overflows the tool output).
Fetch `issuelinks` / description / comments per ticket only when a workflow step needs them.

```jql
project = <JIRA_PROJECT> AND assignee = currentUser()
  AND issuetype in (Story, Task, Sub-task, Bug)
  AND status in ("ToDo", "In Progress")
  AND key not in (<IGNORED_KEYS>)
ORDER BY Rank ASC
```
- `Story`, `Task` → `--type story`; `Sub-task` → `--type subtask` (`--parent` = parent's item id); `Bug` → `--type bug`.
- `--ext jira:<key> --title "<key>: <summary>" --url https://<JIRA_SITE>/browse/<key>`.
- Statuses `<STATUS_IN_REVIEW>`, `<STATUS_DEV_DONE>`, `Blocked` are not development work — track them only through their MRs. `Blocked` items: skip.
- Epics are never worked directly.
