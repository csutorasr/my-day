# Tracker interview (shared by the profiles)

Not a config file: profiles' `SETUP.md` point here. Ask only the block for the user's tracker.

Every tracker gets the same five questions, phrased in that tracker's terms; the profile says
what its item types and states are:
**(a)** which container(s) hold the work, **(b)** how tracker items map to the profile's item
types, **(c)** which states mean what the profile's workflows need (e.g. *to develop*, *in
review*, *done*, *blocked*), **(d)** continuous / bucket items to ignore, **(e)** labels or areas
that belong to other teams.

For (d), propose candidates: the user's open items whose title looks like a bucket
(`Generic`, `activities`, `meetings`, `support`, `overhead`, `time tracking`), umbrella items,
and items open for months with no activity. The confirmed list goes into the profile's scope
section and into every query's exclusion clause.

| Tracker | Access | (a) container | (b) type mapping | (c) states | "mine" / "unassigned" |
|---|---|---|---|---|---|
| Jira | Atlassian MCP (`searchJiraIssuesUsingJql`, explicit `fields`, markdown) or `jira` CLI | project keys, boards | issue types (Epic/Story/Task/Sub-task/Bug) | workflow statuses | `assignee = currentUser()` / `assignee is EMPTY`; exclude `key not in (…)` |
| GitHub Issues | `gh issue list --json …`, Projects v2 via `gh project item-list` | repos or org, optional project board | labels (`bug`, `story` …), sub-issues | open/closed + project Status field or labels | `--assignee @me` / `no:assignee`; exclude by number or label |
| GitLab Issues | `glab issue list -O json`, `glab api` | group/projects, optional board | labels, issue type, epics, tasks | open/closed + board lists / scoped labels (`workflow::…`) | `--assignee @me` / `--assignee none` |
| Linear | Linear MCP or API | team keys, projects, cycles | labels, projects, sub-issues | workflow states per team | `assignee: me` / unassigned |
| Azure Boards | `az boards query --wiql` | org / project / area path | work item types (Epic, Feature, User Story, Bug, Task) | states | `[System.AssignedTo] = @Me` |
| other | ask how they list their items (CLI, MCP, API) | ask | ask | ask | ask |
| none | — | — | the profile says what still works without a tracker | — | — |

The tracker's access goes into `LOOP.md` `requires` (`mcp:atlassian`, `mcp:linear`, `cli:gh`,
`cli:glab`, `cli:az` …), and its write actions into `WRITES.md` (`jira: comment`,
`jira: transition`, `github: label` …).
