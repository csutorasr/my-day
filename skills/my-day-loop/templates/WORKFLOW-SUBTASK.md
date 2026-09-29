<!-- TEMPLATE — a worked example (Jira + GitLab). my-day-setup replaces every <PLACEHOLDER> and rewrites tool-specific parts for the user's tracker and code host. -->
# Workflow: Sub-task

## States
new → brainstorm-queued → brainstorming → awaiting-answers → ready → developing → mr-open → post-mr → in-review → approved → merged → done

## Transitions
Same as `WORKFLOW-STORY.md`, except:
- Brainstorm with `<BRAINSTORM_SUBTASK_SKILL>` (parent story context included).
- Routing default is **local worker**; use **CI plan** only if it spans repos or is large.
- Order sibling subtasks by their dependencies (spec → backend → frontend) and Jira rank.
- merged → done does not close the parent story; the parent is done when all its subtasks are.
