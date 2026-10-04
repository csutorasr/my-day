---
name: setup
description: Use when .my-day config files are missing (first run of the my-day loop in a workspace) or the user wants to (re)configure my-day from scratch - "set up my day", "configure my day", "redo my-day setup", "set up my day with the <profile> profile". Interviews the user about where their work comes from and how it flows, and writes .my-day/*.md from a profile's templates. Small rule changes while the loop runs belong to my-day:config.
---

# my-day setup

`$SM` = `${CLAUDE_PLUGIN_ROOT}/skills/loop/bin/state.mjs` (write the full path in each Bash call;
shell variables do not persist). Templates: `${CLAUDE_PLUGIN_ROOT}/skills/loop/templates/`.

A **profile** is a template folder there (`templates/<profile>/`, e.g. `dev`) with a `SETUP.md`
(its interview) and the `.md` files it writes. The loop itself is the same for every profile: it
runs what the written files say. `templates/DREAM.md` is shared by every profile.

Ask one question per message, multiple choice when possible, and always propose what
exploration found so the user mostly confirms.

## 1. Explore (read-only)
- `$SM config missing` (files to create), `$SM config dir` (target).
- `CLAUDE.md` / `README.md` files.
- A team roster (people → domain → accounts) if one exists.
- Available tools: which MCP servers and CLIs are connected (Atlassian, Linear, Azure DevOps,
  YouTrack, `gh`, `glab` …).

## 2. Profile
The profiles are the folders under `templates/` that contain a `SETUP.md`. A profile named in the
request (`setup dev`) wins; with only one profile, use it without asking; otherwise ask which
kind of work this workspace's loop does, one option per profile (its `SETUP.md` title).

## 3. Interview and files
Follow `templates/<profile>/SETUP.md`. For every file it writes:
- Start from the template, replace every `<PLACEHOLDER>`, rewrite tool-specific parts for what
  the user actually uses, delete sections that don't apply.
- Show the result, run its queries once, then save. Remove the `<!-- TEMPLATE … -->` line.
- Keep `LOOP.md`'s `## Files` section in step with the files written: it is the manifest the loop
  checks (`$SM config missing`).
- Personal data (account ids, emails, `dryRun`, port, `maxAgents`) → `X.local.md`, never the
  shared files. Shared queries use "current user" forms (`currentUser()`, `@me`, `@Me`).

## 4. Ignores
In a git repo root append to `.gitignore` (ask before editing a tracked file; otherwise
`.git/info/exclude`):
```
.my-day/*.local.md
.my-day/state.db*
.my-day/dreams/
.worktrees/
```
Web push (optional): `npm install --prefix ${CLAUDE_PLUGIN_ROOT}/skills/loop/server --no-audit --no-fund`
— without it the dashboard only notifies while its tab is open.

## 5. Register
`$SM loops register` adds this workspace to the machine's loop list (`~/.my-day/loops/`), so the
shared dashboard shows it. `$SM config missing` empty → hand back to `my-day:loop`.

