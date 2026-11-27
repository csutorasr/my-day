// T3 Code: which host the loop session runs in, and the `t3` CLI (it talks to the running T3 Code
// server). Used by bootstrap, setup and the t3 runner (lib/runs.mjs). Every call is synchronous and
// bounded; tests point $T3_BIN at test/fixtures/fake-t3.mjs — never start a real `t3` in tests.
import { spawnSync } from 'node:child_process';
import { parseResult } from './reconcile.mjs';

const TIMEOUT_MS = 30_000;
// `thread start` creates the thread and its first run; on a busy machine that takes longer.
const START_TIMEOUT_MS = 120_000;
// A worker's report is its last message; a few more cover a reply split over several messages.
const MESSAGES = 6;

// A Claude thread in T3 Code gets these from the harness; outside T3 Code none is set.
export function detectHost(env = process.env) {
  const t3 = env.CLAUDE_CODE_ENTRYPOINT === 't3-code' || !!env.T3CODE_THREAD_ID;
  return t3 ? { name: 't3', threadId: env.T3CODE_THREAD_ID || null } : { name: 'claude-code', threadId: null };
}

// What a process started for the loop must not inherit: it is not the loop's T3 thread.
export const isHostVar = (key) => key === 'CLAUDE_CODE_ENTRYPOINT' || key.startsWith('T3CODE_');

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

// $T3_BIN > LOOP.md `t3Bin` > $T3CODE_CLI_PATH (set inside a T3 Code thread) > `t3` on PATH.
export const t3Bin = (settings = {}, env = process.env) => env.T3_BIN || str(settings.t3Bin) || env.T3CODE_CLI_PATH || 't3';

// The CLI's own errors are one line; a crash adds a log prefix and a stack below it.
const firstLine = (text) => str(text).split('\n')[0].replace(/^\[[\d:.]+\]\s+ERROR\s+\(#\d+\):\s*/, '').trim();

// → { ok, stdout } or { ok: false, error, output } (`output` = all the CLI printed, both streams: the
// real CLI prints some errors on stdout). `timedOut` = no answer in time: the call may have worked.
export function call(settings, args, { input, timeout = TIMEOUT_MS } = {}) {
  const bin = t3Bin(settings);
  const r = spawnSync(bin, args, { input, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (r.error) {
    const timedOut = r.error.code === 'ETIMEDOUT';
    const why = timedOut ? `no answer from ${bin} ${args.slice(0, 2).join(' ')} in ${timeout / 1000}s` : `cannot start ${bin}: ${r.error.code ?? r.error.message}`;
    return { ok: false, missing: r.error.code === 'ENOENT', timedOut, error: why, output };
  }
  if (r.status !== 0) return { ok: false, code: r.status, error: firstLine(r.stderr) || firstLine(r.stdout) || `${bin} exited ${r.status ?? r.signal}`, output };
  return { ok: true, stdout: r.stdout };
}

// The answer is the last JSON value the CLI printed: all of stdout, else its last line that parses
// (a warning or log line may come before it).
export function lastJson(text) {
  try { return { ok: true, data: JSON.parse(text) }; } catch {}
  for (const line of String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).reverse()) {
    if (!/^[[{]/.test(line)) continue;
    try { return { ok: true, data: JSON.parse(line) }; } catch {}
  }
  return { ok: false };
}

export function json(res) {
  if (!res.ok) return res;
  const j = lastJson(res.stdout);
  return j.ok ? j : { ok: false, unreadable: true, error: `unreadable answer from t3: ${str(res.stdout).slice(0, 200) || '(empty)'}` };
}

const KIND_KEY = (kind) => str(kind).split('-').filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');

// Model options as `id=value`, comma-separated: "effort=high, fastMode=true".
const options = (v) => str(v).split(',').map((s) => s.trim()).filter(Boolean);

// The model a worker of this kind runs on: `t3Model<Kind>` (with `t3Provider<Kind>` and
// `t3Options<Kind>`; kinds Develop, Bug, ReviewFix, PipelineFix, Rebase) wins over `t3Model` /
// `t3Provider` / `t3Options`. Option ids belong to a model, so a kind's own model does not inherit
// the shared options. null = no model named: the T3 project's default model.
export function modelFor(settings = {}, kind = '') {
  const key = KIND_KEY(kind);
  const own = key ? str(settings[`t3Model${key}`]) : '';
  const model = own || str(settings.t3Model);
  if (!model) return null;
  return {
    provider: (own && str(settings[`t3Provider${key}`])) || str(settings.t3Provider) || 'claudeAgent',
    model,
    options: options(own ? settings[`t3Options${key}`] : (key && settings[`t3Options${key}`]) || settings.t3Options),
  };
}

export function version(settings) {
  const r = call(settings, ['--version'], { timeout: 10_000 });
  return r.ok ? { ok: true, version: str(r.stdout).replace(/^t3\s+/, '') } : r;
}

// Is `path` inside a registered T3 project? `server` false = the CLI or the T3 Code server did not
// answer (then nothing about projects is known).
export function inProject(settings, path) {
  const r = call(settings, ['thread', 'list', '--project', path, '--json']);
  if (r.ok) return { server: true, project: true };
  if (/No T3 Code project matches/i.test(r.error)) return { server: true, project: false };
  return { server: false, project: false, error: r.error, missing: !!r.missing };
}

// What bootstrap and setup need to know: does the CLI answer, does the server, and which of `paths`
// are inside a T3 project.
export function check(settings, paths = []) {
  const bin = t3Bin(settings);
  const v = version(settings);
  if (!v.ok) return { bin, ok: false, error: v.error, projects: {} };
  const projects = {};
  let error;
  for (const p of paths) {
    const r = inProject(settings, p);
    if (!r.server) { error = r.error; break; }
    projects[p] = r.project;
  }
  return { bin, ok: !error, version: v.version, ...(error ? { error } : {}), projects };
}

// Register a folder as a T3 project; one that already is counts as done. (The CLI prints that error,
// with a stack, on stdout: match all of its output.)
export function addProject(settings, path, title) {
  const r = call(settings, ['project', 'add', ...(title ? ['--title', title] : []), path]);
  if (r.ok) return { ok: true, added: true };
  if (/already exists/i.test(r.output ?? r.error)) return { ok: true, added: false };
  return r;
}

// T3 Code only removes a project that has threads together with them (`--force`). The CLI resolves
// an exact project root (or id) only: a folder inside a project is "not found".
export function removeProject(settings, path, { force = false } = {}) {
  return call(settings, ['project', 'remove', ...(force ? ['--force'] : []), path]);
}

// The threads of the project `project` (an id or a path inside it) resolves to, newest first:
// [{threadId, title, link, status, …}].
export function listThreads(settings, project) {
  const r = json(call(settings, ['thread', 'list', '--project', project, '--json']));
  if (!r.ok) return r;
  return Array.isArray(r.data) ? { ok: true, threads: r.data } : { ok: false, error: 'unreadable answer from t3 thread list' };
}

// Start a thread in the project that `project` (an id or a path) resolves to, the message on stdin
// so ticket text never passes through a command line. → { threadId, runId, adopted }
// When the answer is unclear (no answer in time, or output that is no JSON) the thread may exist all
// the same: one with exactly this title in that project is taken as the one started (`adopted`).
export function startThread(settings, { project, message, title, kind, timeout = START_TIMEOUT_MS }) {
  const m = modelFor(settings, kind);
  const args = ['thread', 'start', '--json'];
  if (title) args.push('--title', title);
  if (m) args.push('--provider', m.provider, '--model', m.model, ...m.options.flatMap((o) => ['--option', o]));
  const res = call(settings, [...args, project, '-'], { input: message, timeout });
  const r = json(res);
  if (r.ok && r.data?.threadId) return { ok: true, threadId: r.data.threadId, runId: r.data.runId ?? null };
  const unclear = res.timedOut || r.unreadable || (r.ok && !r.data?.threadId);
  if (unclear && title) {
    const found = listThreads(settings, project);
    const t = found.ok && found.threads.find((x) => x.title === title);
    if (t?.threadId) return { ok: true, threadId: t.threadId, runId: t.latestRunId ?? null, adopted: true };
  }
  return r.ok ? { ok: false, error: 'the t3 CLI started no thread' } : r;
}

// → { thread: {status, link, pendingRequestCount, …}, messages: [{role, runId, text}], error }; `gone`
// = the thread was deleted (the CLI says "Thread <id> is no longer available.").
export function showThread(settings, threadId, messages = MESSAGES) {
  const r = json(call(settings, ['thread', 'show', threadId, '--json', '--messages', String(messages)]));
  if (!r.ok) return { ...r, gone: /no longer available/i.test(r.error ?? '') };
  return r.data?.thread ? r : { ok: false, error: 'unreadable answer from t3 thread show' };
}

// The message becomes the thread's next turn (a busy thread is not interrupted).
export function sendThread(settings, threadId, message) {
  const r = json(call(settings, ['thread', 'send', threadId, '-', '--json'], { input: message }));
  return r.ok ? { ok: true, runId: r.data?.runId ?? null } : r;
}

export function threadLink(settings, threadId) {
  const r = showThread(settings, threadId, 1);
  return r.ok ? r.data.thread.link ?? null : null;
}

// `thread.status` is `idle` or its latest run's status: preparing | queued | starting | running |
// waiting | completed | interrupted | failed | cancelled | rolled_back.
const ACTIVE = new Set(['preparing', 'queued', 'starting', 'running']);
const hasReport = (text) => typeof parseResult(text)?.status === 'string';

// What a worker thread is doing, from `t3 thread show --json`:
//   running   a turn runs, or work it started (background tasks, a thread it waits on) will wake it
//   waiting   it stopped to ask the user (a question or an approval) — not a failure
//   done      it finished; `text` holds its report (or what it said in its latest run)
//   stopped   someone interrupted or cancelled it in T3 Code
//   failed    the run failed; `error` says why
// A run that ends with background tasks still going has status `waiting` (no pending request) and
// wakes by itself when they end: that is not a question. Its report counts once it is written — the
// wake-up run that follows may not repeat it, so earlier messages are read too.
export function threadState(shown) {
  const t = shown?.thread ?? {};
  const status = str(t.status);
  const assistant = (shown?.messages ?? []).filter((m) => m.role === 'assistant');
  const latest = assistant.filter((m) => !t.latestRunId || !m.runId || m.runId === t.latestRunId).map((m) => m.text ?? '').join('\n');
  const all = assistant.map((m) => m.text ?? '').join('\n');
  const text = hasReport(latest) || !hasReport(all) ? latest : all;
  // A thread that asks keeps status `running`; the pending request is what tells.
  if (Number(t.pendingRequestCount ?? 0) > 0) return { state: 'waiting', status, text };
  if (ACTIVE.has(status)) return { state: 'running', status, text };
  const settled = ['completed', 'idle', 'waiting'].includes(status);
  if (settled && hasReport(text)) return { state: 'done', status, text };
  if (t.activeRunId || (t.pendingBackgroundTasks ?? []).length || t.blockedOnThreadWait) return { state: 'running', status, text };
  if (status === 'waiting') return { state: 'waiting', status, text };
  if (status === 'completed' || status === 'idle') return { state: 'done', status, text };
  if (status === 'interrupted' || status === 'cancelled') return { state: 'stopped', status, text };
  return { state: 'failed', status, text, error: str(shown?.error) };
}
