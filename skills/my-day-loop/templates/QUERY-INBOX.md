<!-- TEMPLATE — a worked example (Jira + GitLab). my-day-setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Query: inbox (unassigned work)

Atlassian MCP `searchJiraIssuesUsingJql`, cloudId `<JIRA_SITE>`, fields `summary,status,issuetype,priority`, `responseContentFormat: markdown`. Scope and ignored tickets: `QUERY-MY-TASKS.md`.

## Unassigned bugs
```jql
project = <JIRA_PROJECT> AND issuetype = Bug AND assignee is EMPTY AND statusCategory != Done
  AND key not in (<IGNORED_KEYS>)
ORDER BY priority DESC, Rank ASC
```

## Unassigned stories
```jql
project = <JIRA_PROJECT> AND issuetype in (Story, Task) AND assignee is EMPTY AND status = "ToDo"
  AND key not in (<IGNORED_KEYS>)
ORDER BY Rank ASC
```

Upsert with `--data '{"inbox":true}'`, status `inbox`. Handling is defined in `TRIAGE.md`.
