#!/usr/bin/env node
// Stand-in for the `t3` CLI in tests (via $T3_BIN). Its "server" is $FAKE_T3_HOME/state.json:
// registered projects and started threads; every call is appended to calls.jsonl.
// $FAKE_T3_DOWN=1 = no server answers (only --version works).
// A thread completes at once and replies "ok". Output and errors look like the real CLI's.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';

const home = process.env.FAKE_T3_HOME;
if (!home) { console.error('fake-t3: FAKE_T3_HOME is not set'); process.exit(64); }
mkdirSync(home, { recursive: true });
const file = join(home, 'state.json');
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { projects: [], threads: {}, next: 1 };
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
const argv = process.argv.slice(2);
const stdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };
const die = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const print = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);

// Flags that take a value; the rest of argv are positionals.
const VALUE = new Set(['--title', '--provider', '--model', '--option', '--messages', '--project', '--worktree', '--branch', '--output-schema', '--track']);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUE.has(a)) (flags[a] ??= []).push(argv[++i]);
  else if (a.startsWith('--')) flags[a] = true;
  else pos.push(a);
}
const one = (name) => flags[name]?.[0];

if (flags['--version']) { process.stdout.write('t3 v0.0.0-fake\n'); process.exit(0); }
const input = pos.at(-1) === '-' ? stdin() : undefined;
appendFileSync(join(home, 'calls.jsonl'), `${JSON.stringify({ argv, ...(input === undefined ? {} : { input }) })}\n`);
if (process.env.FAKE_T3_DOWN) die(`No running T3 Code server uses ${home}. Start T3 Code, then retry.`);

const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
// Deepest registered project that holds the path, as the real CLI resolves it.
const projectOf = (p) => state.projects.filter((x) => inside(x.root, resolve(p))).sort((a, b) => b.root.length - a.root.length)[0];
const noProject = (p) => die(`No T3 Code project matches '${p}'. Pass a project id or a path inside a project.`);
const link = (id) => `https://app.t3.codes/threads/fake-env/${encodeURIComponent(id)}`;
const runId = (t) => `run:thread:${encodeURIComponent(t.id)}:ordinal:${t.runs}`;

const [group, verb, ...rest] = pos;

if (group === 'project' && verb === 'add') {
  const root = resolve(rest[0]);
  // The real CLI prints this error, with a stack, on stdout.
  if (state.projects.some((p) => p.root === root)) {
    process.stdout.write(`[12:00:00.000] ERROR (#2): ProjectAlreadyExistsError: An active project already exists for '${root}'.\n    at projectAddMutation (fake)\n`);
    process.exit(1);
  }
  const id = `project-${state.next++}`;
  state.projects.push({ id, root, title: one('--title') ?? root.split(sep).at(-1) });
  save();
  process.stdout.write(`Added project ${id} (${state.projects.at(-1).title}) at ${root}.\n`);
} else if (group === 'thread' && verb === 'start') {
  const p = projectOf(rest[0]);
  if (!p) noProject(rest[0]);
  const message = input ?? rest[1];
  if (!String(message ?? '').trim()) die('The message is empty.');
  const id = `mcp:fake-${state.next++}`;
  state.threads[id] = { id, project: p.id, cwd: p.root, title: one('--title') ?? message.split('\n')[0], message, runs: 1, sent: [] };
  save();
  print({ threadId: id, projectId: p.id, runId: runId(state.threads[id]) });
} else if (group === 'thread' && verb === 'show') {
  const t = state.threads[rest[0]];
  if (!t) die(`Thread ${rest[0]} is no longer available.`);
  const run = runId(t);
  print({
    thread: {
      threadId: t.id, projectId: t.project, title: t.title, link: link(t.id), status: 'completed',
      latestRunId: run, activeRunId: null, runCount: t.runs, pendingRequestCount: 0, pendingBackgroundTasks: [],
    },
    messages: [{ role: 'user', runId: run, text: t.message }, { role: 'assistant', runId: run, text: 'ok' }].slice(-Number(one('--messages') ?? 10)),
    error: null,
  });
} else {
  die(`fake-t3: unknown command ${argv.join(' ')}`, 64);
}
