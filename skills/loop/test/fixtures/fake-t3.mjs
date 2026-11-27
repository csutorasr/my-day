#!/usr/bin/env node
// Stand-in for the `t3` CLI in tests (via $T3_BIN). Its "server" is $FAKE_T3_HOME/state.json:
// registered projects and started threads; every call is appended to calls.jsonl.
// $FAKE_T3_DOWN=1 = no server answers (only --version works). $FAKE_T3_SEND_DOWN=1 = only `thread send`
// fails. $FAKE_T3_START: `hang` = the thread is created, but the answer comes after 3 s; `garbage` =
// created, the answer is no JSON; `noisy` = a log line before the JSON. $FAKE_T3_WARN=1 = every
// command first prints a warning on stderr.
// Output and errors look like the real CLI's (checked against t3 v0.1.12).
//
// A thread's behaviour comes from its message's `Task:` line, read on every `thread show`:
//   ok            completed; the reply ends with a done JSON block (cwd = the project folder it ran in)
//   fail-<repo>   like ok, but reports failed when running for <repo>
//   silent        completed without a JSON block, also after a reminder
//   forgetful     completed without a JSON block; after one `thread send` it reports done
//   sleep         running for ever
//   ask           running with a pending request (waiting for the user) until the test sets
//                 `answered` on the thread in state.json, then like ok
//   interrupted   someone pressed Stop in T3 Code
//   error         the run failed; `error` says why
//   gone          the thread was deleted: `thread show` fails
//   leftovers     completed with its report, but an active run id and a background task are left
//   background    reported, then left a background task: status `waiting`, no pending request; once
//                 the test sets `woke`, a second run (no report in it) completes
//   background-silent   like background, without a report
//   busy-reported still running, but its report is already written
//   plain message (no Task: line): completed, the reply is "ok"
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
if (process.env.FAKE_T3_WARN) process.stderr.write('[12:00:00.000] WARN: a newer t3 is available\n');
const input = pos.at(-1) === '-' ? stdin() : undefined;
appendFileSync(join(home, 'calls.jsonl'), `${JSON.stringify({ argv, ...(input === undefined ? {} : { input }) })}\n`);
if (process.env.FAKE_T3_DOWN) die(`No running T3 Code server uses ${home}. Start T3 Code, then retry.`);

const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
// Deepest registered project that holds the path, as the real CLI resolves it.
const projectOf = (p) => state.projects.filter((x) => inside(x.root, resolve(p))).sort((a, b) => b.root.length - a.root.length)[0];
const noProject = (p) => die(`No T3 Code project matches '${p}'. Pass a project id or a path inside a project.`);
const field = (text, name) => new RegExp(`^${name}: (.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
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
} else if (group === 'project' && verb === 'remove') {
  // Only an exact project root (or id): a folder inside a project is "not found", as in the real CLI.
  const root = resolve(rest[0]);
  const p = state.projects.find((x) => x.root === root || x.id === rest[0]);
  if (!p) die(`[12:00:00.000] ERROR (#2): ProjectNotFoundError: No active project found for '${rest[0]}'.`);
  const threads = Object.values(state.threads).filter((t) => t.project === p.id);
  if (threads.length && !flags['--force']) die('[12:00:00.000] ERROR (#2): ProjectLiveServerDeclaredResponseError: Server request failed (invalid_request, trace fake).');
  for (const t of threads) delete state.threads[t.id];
  state.projects = state.projects.filter((x) => x !== p);
  save();
  process.stdout.write(`Removed project ${p.id} (${p.title}).\n`);
} else if (group === 'thread' && verb === 'list') {
  const p = projectOf(one('--project') ?? '.');
  if (!p) noProject(one('--project') ?? '.');
  print(Object.values(state.threads).filter((t) => t.project === p.id).reverse().map((t) => ({ threadId: t.id, projectId: p.id, title: t.title, link: link(t.id), status: 'completed', latestRunId: runId(t) })));
} else if (group === 'thread' && verb === 'start') {
  const p = projectOf(rest[0]);
  if (!p) noProject(rest[0]);
  if (!String(input ?? rest[1] ?? '').trim()) die('The message is empty.');
  if ((one('--provider') === undefined) !== (one('--model') === undefined)) die('--provider and --model go together.');
  const id = `mcp:fake-${state.next++}`;
  const message = input ?? rest[1];
  state.threads[id] = {
    id, project: p.id, cwd: p.root, title: one('--title') ?? message.split('\n')[0], message, runs: 1, sent: [],
    provider: one('--provider') ?? null, model: one('--model') ?? null, options: flags['--option'] ?? [],
  };
  save();
  const answer = { threadId: id, projectId: p.id, runId: runId(state.threads[id]) };
  const how = process.env.FAKE_T3_START;
  if (how === 'hang') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000); print(answer); }
  else if (how === 'garbage') process.stdout.write('Thread started.\n');
  else if (how === 'noisy') { process.stdout.write('[12:00:00.000] WARN: slow provider start\n'); print(answer); }
  else print(answer);
} else if (group === 'thread' && verb === 'send') {
  const t = state.threads[rest[0]];
  if (!t) die(`Thread ${rest[0]} is no longer available.`);
  if (process.env.FAKE_T3_SEND_DOWN) die('[12:00:00.000] ERROR (#2): ThreadSendError: Server request failed (unavailable, trace fake).');
  t.sent.push(input ?? rest[1]);
  t.runs++;
  save();
  print({ threadId: t.id, link: link(t.id), runId: runId(t), status: 'starting', delivery: 'started' });
} else if (group === 'thread' && verb === 'show') {
  const t = state.threads[rest[0]];
  const task = t ? field(t.message, 'Task') : '';
  if (!t || task === 'gone') die(`Thread ${rest[0]} is no longer available.`);
  const repo = field(t.message, 'Repo');
  const run = runId(t);
  const report = task === `fail-${repo}`
    ? { status: 'failed', summary: `${repo} broke`, blockers: ['tests red'] }
    : { status: 'done', branch: `b-${repo}`, mrUrl: `https://git.example.com/x/${repo}/-/merge_requests/1`, commits: [`c-${repo} change`], summary: `${repo} ok`, cwd: t.cwd, stateDir: field(t.message, 'State dir') || null };
  const block = `Worked in ${t.cwd}.\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\``;
  let status = 'completed';
  let pending = 0;
  let reply = block;
  let error = null;
  let active = null;
  let background = [];
  const earlier = [];
  if (!/^Task: /m.test(t.message)) reply = 'ok';
  else if (task === 'sleep') { status = 'running'; reply = null; }
  else if (task === 'busy-reported') status = 'running';
  else if (task === 'ask' && !t.answered) { status = 'running'; pending = 1; reply = null; }
  else if (task === 'silent' || (task === 'forgetful' && !t.sent.length)) reply = 'All done, I think.';
  else if (task === 'interrupted') { status = 'interrupted'; reply = 'Working on it…'; error = 'Interrupted by the user.'; }
  else if (task === 'error') { status = 'failed'; reply = null; error = 'Provider error: overloaded\nretry later'; }
  else if (task === 'leftovers') { active = run; background = [{ taskId: 'bg1', kind: 'command', description: 'watch tests', awaited: true }]; }
  else if (task === 'background' || task === 'background-silent') {
    if (task === 'background-silent') reply = 'Started the tests in the background.';
    if (!t.woke) { status = 'waiting'; background = [{ taskId: 'bg1', kind: 'command', description: 'run the tests', awaited: true }]; }
    else {
      // Woken by its finished background task: a second run, whose reply has no report.
      earlier.push({ role: 'user', runId: run, text: t.message }, { role: 'assistant', runId: run, text: reply });
      t.runs = 2;
      reply = 'The background tests finished.';
    }
  }
  else if (!['ok', 'ask', 'forgetful', 'busy-reported'].includes(task) && !task.startsWith('fail-')) reply = `unknown task "${task}"`;
  const latest = runId(t);
  const messages = [...earlier, ...(earlier.length ? [] : [{ role: 'user', runId: latest, text: t.sent.at(-1) ?? t.message }])];
  if (reply !== null) messages.push({ role: 'assistant', runId: latest, text: reply });
  print({
    thread: {
      threadId: t.id, projectId: t.project, title: t.title, link: link(t.id), status,
      latestRunId: latest, activeRunId: status === 'running' ? latest : active, providerInstanceId: t.provider ?? 'claudeAgent', model: t.model ?? 'default',
      branch: null, worktreePath: null, runCount: t.runs, pendingRequestCount: pending, archived: false, settled: false, pendingBackgroundTasks: background, blockedOnThreadWait: false,
    },
    messages: messages.slice(-Number(one('--messages') ?? 10)),
    error,
  });
} else {
  die(`fake-t3: unknown command ${argv.join(' ')}`, 64);
}
