---
name: setup
description: Use when .my-day config files are missing (first run of the my-day loop in a workspace) or the user wants to (re)configure my-day from scratch - "set up my day", "configure my day", "redo my-day setup", "set up my day with the <profile> profile". Interviews the user about where their work comes from and how it flows, and writes .my-day/*.md from a profile's templates. Small rule changes while the loop runs belong to my-day:config.
---

# my-day setup

`$SM` = `${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/state.mjs` (write the full path in each Bash call;
shell variables do not persist). Templates: `${CLAUDE_PLUGIN_ROOT}/skills/loop/templates/`.

A **profile** is a template folder there (`templates/<profile>/`, e.g. `dev`) with a `SETUP.md`
(its interview) and the `.md` files it writes. The loop itself is the same for every profile: it
runs what the written files say. Shared by every profile: `templates/WRITES.md` (outward-write
policy), `templates/TRACKERS.md` (the tracker interview) and `templates/DREAM.md`.

Ask one question per message, multiple choice when possible, and always propose what
exploration found so the user mostly confirms.

## 1. Explore (read-only)
- `$SM config missing` (files to create), `$SM config dir` (target).
- `CLAUDE.md` / `README.md` files.
- A team roster (people → domain → accounts) if one exists.
- Available tools: which MCP servers and CLIs are connected (Atlassian, Linear, Azure DevOps,
  YouTrack, `gh`, `glab` …).
- The host: `$SM t3 check` → `host.name` `t3` = this session is a T3 Code thread (section 4).

## 2. Profile
The profiles are the folders under `templates/` that contain a `SETUP.md`. A profile named in the
request (`setup dev`) wins; with only one profile, use it without asking; otherwise ask which
kind of work this workspace's loop does, one option per profile (its `SETUP.md` title).

## 3. Interview and files
Follow `templates/<profile>/SETUP.md`. A profile may build on another one (its `SETUP.md` says so):
files it does not have come from that profile's folder. For every file it writes:
- Start from the template, replace every `<PLACEHOLDER>`, rewrite tool-specific parts for what
  the user actually uses, delete sections that don't apply.
- Show the result, run its queries once, then save. Remove the `<!-- TEMPLATE … -->` line.
- Keep `LOOP.md`'s `## Files` section in step with the files written: it is the manifest the loop
  checks (`$SM config missing`).
- Personal data (account ids, emails, `dryRun`, port, `maxAgents`) → `X.local.md`, never the
  shared files. Shared queries use "current user" forms (`currentUser()`, `@me`, `@Me`).
- Always write `WRITES.md` from `templates/WRITES.md`, with the profile's `## Writes defaults`
  named for the user's tools and adjusted by their answers. It is not in `## Files` (workspaces
  without one treat every action as `auto`).
- `LOOP.md` `requires` names every MCP server (`mcp:<server>`) and CLI (`cli:<bin>`) the written
  files use. Check them before handing back: `$SM bootstrap` reports the CLIs; check each `mcp:`
  one against this session's tools and record it with `$SM source <name> ok|missing`.

## 4. T3 Code
Only when `$SM t3 check` says `host.name` is `t3`, or the user asks for workers as T3 threads.
`ok` false → show its `error` (T3 Code not running, or the CLI not found: `t3Bin` in
`LOOP.local.md`) and leave the runner as it is.

**Runner** (profiles with workers) — ask how workers should run; in T3 Code propose `t3`:

| `runner` | A worker is | For | Against |
|---|---|---|---|
| `t3` | its own T3 Code thread in the repo's worktree | The repo's `CLAUDE.md`, settings and skills apply. You can open each worker, watch it and answer it, from desktop or phone; it outlives the loop's thread. A model per kind (`t3Model…`), Codex possible | Every worktree becomes a T3 project in the sidebar (or `t3Project: containing`). The `t3` CLI cannot stop a thread: the loop interrupts it with T3 Code's tool when it has it, else you press Stop in it |
| `agent` | a subagent of the loop's thread | Nothing to set up | Works from the workspace root, so a repo's own settings do not apply. Ends with the loop's session; you see it only through the loop |
| `claude-p` | a headless `claude -p` process in the repo's worktree | The repo's settings apply; can be killed | No UI: it cannot ask, and you cannot look in. Needs the `claude` CLI |

`t3` → in `LOOP.md`: `runner: t3`; ask which model workers use (`t3Model`, with `t3Provider` and
`t3Options`; empty = the T3 project's default) and propose a cheap `t3ModelRebase`. Personal
choices (`t3Bin`, a model) → `LOOP.local.md`. Worker threads start in a worktree, where a
project-scope enable of this plugin does not apply: check it is enabled at **user** scope
(`claude plugin list`), else offer `claude plugin install my-day@csutorasr --scope user`.

**Projects** — `$SM t3 check <repo folder> …` → `projects` says which folders are inside a T3
project. Always ask before registering anything:
- The workspace is not one → offer `$SM t3 register <workspace> --title <name>` (it runs
  `t3 project add`): the loop's thread and the dashboard tab then belong to a project the user
  can find.
- `t3Project: worktree` (default) needs nothing more: each worker's worktree is registered when
  the worker starts — say so, and that those projects stay until removed (`t3Cleanup`).
- `t3Project: containing` → every repo must be inside a registered project: offer the workspace
  (covers repos under it) or each repo that is outside.

## 5. Ignores
In a git repo root append to `.gitignore` (ask before editing a tracked file; otherwise
`.git/info/exclude`):
```
.my-day/*.local.md
.my-day/state.db*
.my-day/dreams/
.my-day/runs/
.my-day/watch.lock*
.worktrees/
```
Web push (optional): `npm install --prefix ${CLAUDE_PLUGIN_ROOT}/skills/loop/server --no-audit --no-fund`
— without it the dashboard only notifies while its tab is open.

## 6. Register
`$SM loops register` adds this workspace to the machine's loop list (`~/.my-day/loops/`), so the
shared dashboard shows it. `$SM config missing` empty → hand back to `my-day:loop`.

