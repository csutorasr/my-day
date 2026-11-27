# Setup: the dev-bundle profile

For a **bundle repo**: one git repo that holds the shared instructions and settings (`CLAUDE.md`,
`.claude/`) and gitignores several independently cloned repos inside it. Every code step runs as a
separate `claude -p` in the repo's own worktree, so that repo's `CLAUDE.md`, tracked
`.claude/settings.json`, skills and MCP servers apply (the bundle's `CLAUDE.md` still loads as a
parent folder).

```
bundle/                 git repo (.gitignore: backend/ web/ …)
  CLAUDE.md  .claude/
  backend/  web/  …     own clones
  .worktrees/<repo>/<branch>/   worker worktrees, created from the sub-clone
  .my-day/
```

This profile builds on `dev`: the files not in this folder (QUERY-*, TRIAGE, WORKFLOW-*,
FIX-REVIEW, MERGE-GATES, POST-MR) come from `templates/dev/`.

## 0. Detect the bundle (read-only)
- The workspace root is a git repo (`git rev-parse --show-toplevel` = the root).
- Sub-clones: folders directly under the root that have their own `.git` and that the root's
  `.gitignore` excludes (`git check-ignore -q <folder>`). For each: remote (`git -C <repo> remote get-url origin`),
  default branch (`git -C <repo> symbolic-ref refs/remotes/origin/HEAD`), and whether it has its own
  `CLAUDE.md` / `.claude/settings.json`.
- Show the list and confirm it ("these are the repos the loop works in").
- `claude --version` works (the runner starts it); `.worktrees/` is ignored by the bundle repo.
  In T3 Code the runner can be `t3` instead (`my-day:setup` section 4): the same chain, each
  repo's run a T3 Code thread in that repo's worktree; then `$SM t3 check` must be `ok`.
- The my-day plugin is enabled at **user** scope (`claude plugin list`): a run starts in a repo's
  worktree, where a project-scope enable in the bundle's `.claude/settings.json` does not apply, so
  `my-day:worker` would be missing. Offer `claude plugin install my-day@csutorasr --scope user`.

## 1. Cross-repo order
Ask in which order a ticket that touches several repos is developed (e.g. contract → backend →
frontend), proposing one from dependencies you can see (API specs, SDK packages, imports). It is
the chain order: each repo's run starts when the previous one is done and gets its result.

## 2. Permissions
`claude -p` runs cannot answer prompts (a T3 thread can stop and ask: the loop then pulls the
user in, so prompts cost their time, not the run). Propose `permissionMode: acceptEdits` (in `LOOP.md`) and, per repo
without one, a minimal `.claude/settings.json` `permissions.allow` for its build, test and lint
commands, `git`, `glab`/`gh`, and the state CLI the worker reads first
(`Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/state.mjs:*)`, with the real plugin path) — ask
before writing into a repo; commit per that repo's rules. Then do one dry `claude -p` in a worktree
("invoke my-day:worker and run `$SM config settings`") to confirm the skill and permissions work.
`bypassPermissions` only on the user's explicit request.

## 3. The dev interview
Follow `templates/dev/SETUP.md` sections 1–4 (tools, tracker, workflow, write the files) with
these changes:
- `LOOP.md` and `DEVELOP.md` come from this folder; fill `DEVELOP.md`'s `## Repos` and
  `## Cross-repo order` from steps 0–1.
- The code host group covers every sub-clone's remote.
