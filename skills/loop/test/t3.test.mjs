import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../lib/db.mjs';
import { DEFAULTS, requiredSources } from '../lib/config.mjs';
import { collectRuns, finishedSteps, listChains, startChain, stopChain, threadSignals, workerPrompt } from '../lib/runs.mjs';
import * as T3 from '../lib/t3.mjs';

// Never a real t3: every call goes to the fake, whose "server" is a folder per workspace.
const FAKE = fileURLToPath(new URL('./fixtures/fake-t3.mjs', import.meta.url));
chmodSync(FAKE, 0o755);
for (const k of Object.keys(process.env)) if (k === 'CLAUDE_CODE_ENTRYPOINT' || k.startsWith('T3CODE_')) delete process.env[k];
process.env.T3_BIN = FAKE;
const settings = { ...DEFAULTS, runner: 't3', retryLimit: 3 };

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'myday-t3-'));
  const dir = join(root, '.my-day');
  mkdirSync(dir, { recursive: true });
  for (const r of ['api-spec', 'backend', 'web']) mkdirSync(join(root, '.worktrees', r), { recursive: true });
  process.env.FAKE_T3_HOME = join(root, 't3-server');
  const db = S.openDb(join(dir, 'state.db'));
  const { id } = S.upsertItem(db, { type: 'story', ext: 'jira:ABC-12', title: 'Wishlist' });
  const steps = (...repos) => repos.map((repo) => ({ repo, cwd: join(root, '.worktrees', repo) }));
  return { root, dir, db, item: id, steps, t3: process.env.FAKE_T3_HOME };
}
const server = (w) => (existsSync(join(w.t3, 'state.json')) ? JSON.parse(readFileSync(join(w.t3, 'state.json'), 'utf8')) : { projects: [], threads: {} });
const calls = (w) => readFileSync(join(w.t3, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const edit = (w, fn) => { const s = server(w); fn(s); writeFileSync(join(w.t3, 'state.json'), JSON.stringify(s)); };
const chainOf = (dir, item, id) => listChains(dir).filter((c) => c.item === item && (!id || c.id === id)).at(-1);
const start = (w, task, repos, extra = {}) =>
  startChain(w.db, w.dir, { ...settings, ...extra }, { item: w.item, kind: 'develop', task, dryRun: false, workspace: w.root, steps: w.steps(...repos) });
const collect = (w, extra = {}, now = new Date(), opts) => collectRuns(w.db, w.dir, { ...settings, ...extra }, now, opts);
const linkOf = (thread) => `https://app.t3.codes/threads/fake-env/${encodeURIComponent(thread)}`;

test('host: a T3 Code thread is told by its environment, with its thread id', () => {
  assert.deepEqual(T3.detectHost({ CLAUDE_CODE_ENTRYPOINT: 't3-code', T3CODE_THREAD_ID: 'mcp:1' }), { name: 't3', threadId: 'mcp:1' });
  assert.deepEqual(T3.detectHost({ T3CODE_THREAD_ID: 'mcp:1' }), { name: 't3', threadId: 'mcp:1' });
  assert.deepEqual(T3.detectHost({ CLAUDE_CODE_ENTRYPOINT: 't3-code' }), { name: 't3', threadId: null });
  assert.deepEqual(T3.detectHost({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), { name: 'claude-code', threadId: null });
  assert.deepEqual(T3.detectHost({}), { name: 'claude-code', threadId: null });
  // What a process the loop starts must not inherit.
  assert.deepEqual(['CLAUDE_CODE_ENTRYPOINT', 'T3CODE_THREAD_ID', 'T3CODE_CLI_PATH', 'T3CODE_HOME', 'T3_BIN', 'PATH', 'MY_DAY_DIR'].filter(T3.isHostVar), ['CLAUDE_CODE_ENTRYPOINT', 'T3CODE_THREAD_ID', 'T3CODE_CLI_PATH', 'T3CODE_HOME']);
});

test('the t3 binary: $T3_BIN, then t3Bin, then $T3CODE_CLI_PATH, then t3 on PATH', () => {
  assert.equal(T3.t3Bin({ t3Bin: '/s/t3' }, { T3_BIN: '/e/t3', T3CODE_CLI_PATH: '/c/t3' }), '/e/t3');
  assert.equal(T3.t3Bin({ t3Bin: '/s/t3' }, { T3CODE_CLI_PATH: '/c/t3' }), '/s/t3');
  assert.equal(T3.t3Bin({ t3Bin: '' }, { T3CODE_CLI_PATH: '/c/t3' }), '/c/t3');
  assert.equal(T3.t3Bin({}, {}), 't3');
});

test('showThread and threadLink: the thread, a deleted one, and no server', () => {
  const { root } = workspace();
  T3.call({}, ['project', 'add', root]);
  const { threadId } = JSON.parse(T3.call({}, ['thread', 'start', '--json', root, 'hello']).stdout);
  const shown = T3.showThread({}, threadId);
  assert.equal(shown.ok, true);
  assert.equal(shown.data.thread.status, 'completed');
  assert.equal(T3.threadLink({}, threadId), `https://app.t3.codes/threads/fake-env/${encodeURIComponent(threadId)}`);
  // The real CLI's words for a deleted thread: "Thread <id> is no longer available."
  const gone = T3.showThread({}, 'mcp:deleted');
  assert.deepEqual([gone.ok, gone.gone], [false, true]);
  assert.match(gone.error, /^Thread mcp:deleted is no longer available\.$/);
  assert.equal(T3.threadLink({}, 'mcp:deleted'), null);
  process.env.FAKE_T3_DOWN = '1';
  try {
    const down = T3.showThread({}, threadId);
    assert.deepEqual([down.ok, down.gone], [false, false]);
    assert.match(down.error, /No running T3 Code server/);
  } finally {
    delete process.env.FAKE_T3_DOWN;
  }
  delete process.env.T3_BIN;
  try {
    const missing = T3.showThread({ t3Bin: '/nonexistent/t3' }, threadId);
    assert.deepEqual([missing.ok, missing.missing], [false, true]);
    assert.match(missing.error, /cannot start \/nonexistent\/t3: ENOENT/);
  } finally {
    process.env.T3_BIN = FAKE;
  }
});

test('model: none named → the project default; a kind may have its own model, provider and options', () => {
  assert.equal(T3.modelFor(DEFAULTS, 'develop'), null);
  const s = { ...DEFAULTS, t3Model: 'claude-opus-5-5', t3Options: 'effort=high, fastMode=true', t3ModelRebase: 'claude-haiku-5-5', t3ModelReviewFix: 'gpt-5.2-codex', t3ProviderReviewFix: 'codex', t3OptionsReviewFix: 'reasoningEffort=high', t3OptionsBug: 'effort=max' };
  assert.deepEqual(T3.modelFor(s, 'develop'), { provider: 'claudeAgent', model: 'claude-opus-5-5', options: ['effort=high', 'fastMode=true'] });
  // Option ids belong to a model: a kind's own model does not inherit the shared options.
  assert.deepEqual(T3.modelFor(s, 'rebase'), { provider: 'claudeAgent', model: 'claude-haiku-5-5', options: [] });
  assert.deepEqual(T3.modelFor(s, 'review-fix'), { provider: 'codex', model: 'gpt-5.2-codex', options: ['reasoningEffort=high'] });
  // Same model, other options for one kind.
  assert.deepEqual(T3.modelFor(s, 'bug'), { provider: 'claudeAgent', model: 'claude-opus-5-5', options: ['effort=max'] });
  // A kind model on its own is enough.
  assert.deepEqual(T3.modelFor({ ...DEFAULTS, t3ModelRebase: 'claude-haiku-5-5' }, 'rebase').model, 'claude-haiku-5-5');
  assert.equal(T3.modelFor({ ...DEFAULTS, t3ModelRebase: 'claude-haiku-5-5' }, 'develop'), null);
});

test('thread state: every status T3 Code reports maps to running, waiting, done, stopped or failed', () => {
  const st = (thread, messages = [], error = null) => T3.threadState({ thread, messages, error });
  for (const status of ['preparing', 'queued', 'starting', 'running']) assert.equal(st({ status }).state, 'running', status);
  // A thread that asks keeps status `running`: the pending request tells.
  assert.equal(st({ status: 'running', pendingRequestCount: 1 }).state, 'waiting');
  assert.equal(st({ status: 'waiting' }).state, 'waiting');
  // Completed, but background work it started will wake it: not over yet.
  assert.equal(st({ status: 'completed', pendingBackgroundTasks: [{ id: 'x' }] }).state, 'running');
  const done = st({ status: 'completed', latestRunId: 'r2' }, [{ role: 'assistant', runId: 'r1', text: 'old' }, { role: 'user', runId: 'r2', text: 'again' }, { role: 'assistant', runId: 'r2', text: 'a' }, { role: 'assistant', runId: 'r2', text: 'b' }]);
  assert.deepEqual(done, { state: 'done', status: 'completed', text: 'a\nb' });
  assert.equal(st({ status: 'interrupted' }).state, 'stopped');
  assert.equal(st({ status: 'cancelled' }).state, 'stopped');
  assert.deepEqual(st({ status: 'failed' }, [], 'boom'), { state: 'failed', status: 'failed', text: '', error: 'boom' });
  assert.equal(st({ status: 'rolled_back' }).state, 'failed');
});

test('runner: t3 needs the t3 CLI as a source', () => {
  assert.deepEqual(requiredSources({ runner: 't3', requires: 'cli:glab' }), ['cli:glab', 'cli:t3']);
  assert.deepEqual(requiredSources({ runner: 'claude-p', requires: 'cli:glab' }), ['cli:glab']);
});

test('the t3 worker prompt names the state dir and where the skill is when there is no Skill tool', () => {
  const p = workerPrompt({ kind: 'develop', workspace: '/w', item: 'story-1', dryRun: false, task: 'do it', repo: 'web', worktree: '/w/.worktrees/web', t3: { stateDir: '/w/.my-day', pluginRoot: '/plugin', inWorktree: true } });
  assert.match(p, /^Invoke the Skill tool with "my-day:worker"/);
  assert.match(p, /read \/plugin\/skills\/worker\/SKILL\.md and follow it; `\$\{CLAUDE_PLUGIN_ROOT\}` in it is \/plugin\./);
  assert.match(p, /^State dir: \/w\/\.my-day$/m);
  assert.match(p, /is your working directory/);
  const cd = workerPrompt({ kind: 'develop', workspace: '/w', item: 'story-1', task: 'do it', repo: 'web', worktree: '/w/.worktrees/web', t3: { stateDir: '/w/.my-day', pluginRoot: '/plugin', inWorktree: false } });
  assert.match(cd, /`cd` to the worktree first/);
});

test('a chain runs repo by repo as T3 threads in the repo worktree; links are kept; reconciled once', async () => {
  const w = workspace();
  const r = await start(w, 'ok', ['api-spec', 'backend']);
  assert.equal(r.started.repo, 'api-spec');
  // The link comes with the first look at the thread, not from `thread start`.
  assert.equal(r.started.link, undefined);
  assert.equal(S.getItem(w.db, w.item).agent_id, `run:${r.chain}`);
  let chain = chainOf(w.dir, w.item);
  assert.equal(chain.runner, 't3');
  assert.equal(chain.steps[0].thread, r.started.thread);
  // The worktree itself became a T3 project, so the thread's folder is the worktree.
  assert.deepEqual(server(w).projects.map((p) => [p.root, p.title]), [[join(w.root, '.worktrees', 'api-spec'), 'api-spec · api-spec']]);
  assert.equal(server(w).threads[r.started.thread].title, `ABC-12 develop · api-spec (${r.chain}): Wishlist`);
  // The step names the project it registered: the one folder `t3 remove` may remove later.
  assert.equal(chain.steps[0].project, join(w.root, '.worktrees', 'api-spec'));
  // The message went in on stdin, never on the command line.
  const startCall = calls(w).find((c) => c.argv[1] === 'start');
  assert.equal(startCall.argv.at(-1), '-');
  assert.match(startCall.input, /^Task: ok$/m);
  assert.ok(!startCall.argv.includes('--provider'), 'no model named: the project default');

  const first = collect(w);
  assert.deepEqual(first.started.map((s) => s.repo), ['backend']);
  chain = chainOf(w.dir, w.item);
  assert.equal(chain.steps[0].status, 'done');
  assert.equal(chain.steps[0].link, linkOf(r.started.thread));
  assert.equal(chain.steps[0].result.cwd, join(w.root, '.worktrees', 'api-spec'));
  assert.equal(chain.steps[0].result.stateDir, w.dir);
  // The second thread's prompt carried the first one's result.
  assert.match(readFileSync(join(w.dir, 'runs', `${r.chain}.backend.prompt`), 'utf8'), /api-spec: done · branch b-api-spec/);

  const fin = collect(w).finished[0];
  assert.equal(fin.next, 'advance');
  assert.equal(chainOf(w.dir, w.item).status, 'done');
  assert.equal(S.getItem(w.db, w.item).agent_id, null);
  assert.equal(S.listItems(w.db, { type: 'mr' }).filter((m) => m.parent_id === w.item).length, 2);
  // Each worker thread is among the item's links.
  const threads = S.linksOf(w.db, w.item).filter((l) => l.kind === 'thread');
  assert.deepEqual(threads.map((l) => l.label), ['api-spec worker (attempt 1)', 'backend worker (attempt 1)']);
  assert.deepEqual(collect(w).finished, []);
  assert.equal(S.listEvents(w.db, { itemId: w.item }).filter((e) => e.kind === 'worker').length, 1);
  assert.match(S.listEvents(w.db, { itemId: w.item }).find((e) => e.kind === 'run-started').message, /T3 thread in api-spec \(1 of 2\)/);
});

test('provider, model and options reach the CLI; a kind uses its own model', async () => {
  const w = workspace();
  await start(w, 'ok', ['web'], { t3Model: 'claude-opus-5-5', t3Options: 'effort=high', t3ModelRebase: 'claude-haiku-5-5' });
  const argv = calls(w).find((c) => c.argv[1] === 'start').argv;
  assert.deepEqual(argv.slice(argv.indexOf('--provider'), argv.indexOf('--provider') + 6), ['--provider', 'claudeAgent', '--model', 'claude-opus-5-5', '--option', 'effort=high']);
  collect(w);
  const w2 = workspace();
  await startChain(w2.db, w2.dir, { ...settings, t3Model: 'claude-opus-5-5', t3Options: 'effort=high', t3ModelRebase: 'claude-haiku-5-5' }, { item: w2.item, kind: 'rebase', task: 'ok', workspace: w2.root, steps: w2.steps('web') });
  const t = Object.values(server(w2).threads)[0];
  assert.deepEqual([t.provider, t.model, t.options], ['claudeAgent', 'claude-haiku-5-5', []]);
});

test('a worktree that is already a T3 project is fine; t3Project: containing registers nothing', async () => {
  const w = workspace();
  assert.deepEqual(T3.addProject(settings, join(w.root, '.worktrees', 'web'), 'mine'), { ok: true, added: true });
  const r = await start(w, 'ok', ['web']);
  assert.ok(r.started, JSON.stringify(r));
  assert.equal(server(w).projects.length, 1);

  const c = workspace();
  // No project holds the worktree: the thread cannot start, and the reason is the CLI's.
  const none = await start(c, 'ok', ['web'], { t3Project: 'containing' });
  assert.match(none.failed.reason, /cannot start a T3 thread: No T3 Code project matches/);
  assert.equal(server(c).projects.length, 0);
  S.setFields(c.db, c.item, { attempts: 0 });
  T3.addProject(settings, c.root, 'workspace');
  const ok = await start(c, 'ok', ['web'], { t3Project: 'containing' });
  assert.ok(ok.started, JSON.stringify(ok));
  assert.equal(server(c).projects.length, 1);
  collect(c, { t3Project: 'containing' });
  // It ran in the workspace project, and was told to cd to the worktree.
  assert.equal(chainOf(c.dir, c.item).steps[0].result.cwd, c.root);
  assert.match(readFileSync(join(c.dir, 'runs', `${ok.chain}.web.prompt`), 'utf8'), /`cd` to the worktree first/);
});

test('a failing repo stops the chain; later repos are cancelled', async () => {
  const w = workspace();
  await start(w, 'fail-backend', ['api-spec', 'backend', 'web']);
  collect(w);
  const fin = collect(w).finished[0];
  assert.equal(fin.next, 'failure-transition');
  assert.match(fin.reason, /backend broke/);
  assert.deepEqual(chainOf(w.dir, w.item).steps.map((s) => s.status), ['done', 'failed', 'cancelled']);
});

test('no t3 CLI, or no T3 Code server: the chain fails at once and says why', async () => {
  const w = workspace();
  const missing = await start(w, 'ok', ['web'], { t3Bin: '/nonexistent/t3' });
  // $T3_BIN wins over t3Bin, so the fake still answered: prove the setting is used without it.
  assert.ok(missing.started);
  const w2 = workspace();
  delete process.env.T3_BIN;
  try {
    const r = await start(w2, 'ok', ['web'], { t3Bin: '/nonexistent/t3' });
    assert.match(r.failed.reason, /cannot register the worktree as a T3 project: cannot start \/nonexistent\/t3: ENOENT/);
    assert.equal(r.failed.next, 'failure-transition');
    assert.equal(S.getItem(w2.db, w2.item).agent_id, null);
    assert.equal(chainOf(w2.dir, w2.item).status, 'failed');
  } finally {
    process.env.T3_BIN = FAKE;
  }
  const w3 = workspace();
  process.env.FAKE_T3_DOWN = '1';
  try {
    const r = await start(w3, 'ok', ['web']);
    assert.match(r.failed.reason, /No running T3 Code server/);
  } finally {
    delete process.env.FAKE_T3_DOWN;
  }
});

test('a missing worktree fails the step before anything is registered', async () => {
  const w = workspace();
  const r = await startChain(w.db, w.dir, settings, { item: w.item, kind: 'develop', task: 'ok', workspace: w.root, steps: [{ repo: 'web', cwd: join(w.root, 'nope') }] });
  assert.match(r.failed.reason, /no worktree at/);
  assert.equal(server(w).projects.length, 0);
});

test('a thread waiting for an answer is surfaced once, is not a failure and is off the clock', async () => {
  const w = workspace();
  const r = await start(w, 'ask', ['web']);
  const link = linkOf(r.started.thread);
  const t0 = new Date();
  const first = collect(w, {}, t0);
  assert.deepEqual(first.finished, []);
  assert.deepEqual(first.running, [r.chain]);
  assert.deepEqual(first.waiting.map((x) => [x.item, x.repo, x.link]), [[w.item, 'web', link]]);
  assert.equal(chainOf(w.dir, w.item).steps[0].waiting, true);
  const events = () => S.listEvents(w.db, { itemId: w.item }).filter((e) => e.kind === 'run-waiting');
  assert.equal(events().length, 1);
  assert.match(events()[0].message, /the web worker waits for your answer in its T3 thread: https:/);
  assert.equal(events()[0].data.link, link);
  // `watch` reports it too, with the link to open.
  assert.deepEqual(threadSignals(w.dir, settings), [{ kind: 'run-waiting', item: w.item, chain: r.chain, step: 0, repo: 'web', link }]);
  // Hours later it still waits: listed again, no second event, no timeout.
  const later = new Date(t0.getTime() + 5 * 3600_000);
  const second = collect(w, { runTimeoutMinutes: 90 }, later);
  assert.equal(second.waiting.length, 1);
  assert.deepEqual(second.finished, []);
  assert.equal(events().length, 1);
  // The user answers in T3 Code: the worker goes on and reports. The wait did not count as run time.
  edit(w, (s) => { s.threads[r.started.thread].answered = true; });
  assert.deepEqual(threadSignals(w.dir, settings), [{ kind: 'run-finished', item: w.item, chain: r.chain, step: 0 }]);
  const fin = collect(w, { runTimeoutMinutes: 90 }, new Date(later.getTime() + 60_000));
  assert.deepEqual(fin.waiting, []);
  assert.equal(fin.finished[0].next, 'advance');
  assert.ok(chainOf(w.dir, w.item).steps[0].waitedMs >= 5 * 3600_000);
});

test('time spent waiting for the user extends the deadline; time spent working does not', async () => {
  const w = workspace();
  const r = await start(w, 'ask', ['web']);
  const t0 = Date.parse(chainOf(w.dir, w.item).steps[0].startedAt);
  collect(w, {}, new Date(t0 + 60_000)); // starts waiting at +1 min
  edit(w, (s) => { s.threads[r.started.thread].message = s.threads[r.started.thread].message.replace('Task: ask', 'Task: sleep'); });
  // +3 h: no longer waiting (2 h 59 min waited), running again; 90 min of work are not used up yet.
  assert.deepEqual(collect(w, { runTimeoutMinutes: 90 }, new Date(t0 + 180 * 60_000)).finished, []);
  assert.deepEqual(collect(w, { runTimeoutMinutes: 90 }, new Date(t0 + 268 * 60_000)).finished, []);
  const fin = collect(w, { runTimeoutMinutes: 90 }, new Date(t0 + 270 * 60_000)).finished[0];
  assert.match(fin.reason, /timeout after 90 min/);
});

test('a thread past its timeout fails the step and says the thread itself was not stopped', async () => {
  const w = workspace();
  const r = await start(w, 'sleep', ['web', 'backend']);
  assert.deepEqual(collect(w).finished, []);
  assert.deepEqual(threadSignals(w.dir, settings), []);
  const fin = collect(w, { runTimeoutMinutes: 0.0001 }, new Date(Date.now() + 1000)).finished[0];
  assert.match(fin.reason, /timeout after 0\.0001 min; its T3 thread is still running — stop it in T3 Code: https:/);
  const chain = chainOf(w.dir, w.item);
  assert.deepEqual(chain.steps.map((s) => s.status), ['failed', 'cancelled']);
  assert.equal(chain.steps[0].detached, true);
  // No stop was attempted: the CLI has none.
  assert.deepEqual(calls(w).map((c) => c.argv.slice(0, 2).join(' ')).filter((c) => !['thread show', 'thread start', 'project add'].includes(c)), []);
  assert.equal(r.chain, chain.id);
});

test('a thread that ends without a result is reminded once; then it reports', async () => {
  const w = workspace();
  const r = await start(w, 'forgetful', ['web']);
  const first = collect(w);
  assert.deepEqual([first.finished, first.running], [[], [r.chain]]);
  assert.equal(chainOf(w.dir, w.item).steps[0].nudged, true);
  const sent = calls(w).filter((c) => c.argv[1] === 'send');
  assert.equal(sent.length, 1);
  assert.match(sent[0].input, /could not find your result/);
  const fin = collect(w).finished[0];
  assert.equal(fin.next, 'advance');
  assert.equal(calls(w).filter((c) => c.argv[1] === 'send').length, 1);
});

test('a thread that stays without a result after the reminder fails with what it said', async () => {
  const w = workspace();
  await start(w, 'silent', ['web']);
  assert.deepEqual(collect(w).finished, []);
  const fin = collect(w).finished[0];
  assert.match(fin.reason, /run ended without a result/);
  assert.match(chainOf(w.dir, w.item).steps[0].result.tail, /All done, I think\./);
  assert.equal(calls(w).filter((c) => c.argv[1] === 'send').length, 1);
});

test('a failed run fails the step with T3 Code\'s error; an interrupted one blocks it; a deleted thread fails', async () => {
  const a = workspace();
  await start(a, 'error', ['web']);
  assert.match(collect(a).finished[0].reason, /T3 thread failed: Provider error: overloaded retry later/);
  const b = workspace();
  await start(b, 'interrupted', ['web', 'backend']);
  const fin = collect(b).finished[0];
  assert.match(fin.reason, /stopped in T3 Code \(interrupted\)/);
  assert.equal(fin.status, 'blocked');
  assert.deepEqual(chainOf(b.dir, b.item).steps.map((s) => s.status), ['blocked', 'cancelled']);
  const c = workspace();
  const r = await start(c, 'gone', ['web']);
  assert.deepEqual(threadSignals(c.dir, settings), [{ kind: 'run-finished', item: c.item, chain: r.chain, step: 0 }]);
  assert.match(collect(c).finished[0].reason, /its T3 thread is gone/);
});

test('while the T3 Code server does not answer, a running thread just stays running', async () => {
  const w = workspace();
  const r = await start(w, 'ok', ['web']);
  process.env.FAKE_T3_DOWN = '1';
  try {
    assert.deepEqual(threadSignals(w.dir, settings), []);
    const out = collect(w);
    assert.deepEqual([out.finished, out.running], [[], [r.chain]]);
  } finally {
    delete process.env.FAKE_T3_DOWN;
  }
  assert.equal(collect(w).finished[0].next, 'advance');
});

test('stop lets go of a running thread, cancels the rest, and says the thread keeps running', async () => {
  const w = workspace();
  const r = await start(w, 'sleep', ['web', 'backend']);
  const res = stopChain(w.db, w.dir, settings, w.item);
  assert.equal(res.stopped, true);
  assert.equal(res.next, 'failure-transition');
  assert.deepEqual(res.stillRunning, [{ repo: 'web', thread: r.started.thread, link: linkOf(r.started.thread) }]);
  assert.match(res.note, /no command to stop a thread/);
  assert.match(res.reason, /its T3 thread keeps running until you stop it in T3 Code: https:.* · stopped on the dashboard/);
  const chain = chainOf(w.dir, w.item);
  assert.deepEqual(chain.steps.map((s) => s.status), ['stopped', 'cancelled']);
  assert.equal(chain.status, 'stopped');
  assert.equal(S.getItem(w.db, w.item).agent_id, null);
  assert.deepEqual(stopChain(w.db, w.dir, settings, w.item), { stopped: false });
  assert.deepEqual(collect(w).finished, []);
  assert.deepEqual(threadSignals(w.dir, settings), []);
});

test('stop after the thread already finished keeps its result and MR', async () => {
  const w = workspace();
  await start(w, 'ok', ['api-spec', 'web']);
  const res = stopChain(w.db, w.dir, settings, w.item);
  assert.equal(res.stopped, true);
  assert.equal(res.stillRunning, undefined);
  assert.deepEqual(chainOf(w.dir, w.item).steps.map((x) => x.status), ['done', 'cancelled']);
  assert.equal(S.listItems(w.db, { type: 'mr' }).filter((m) => m.parent_id === w.item).length, 1);
});

test('while paused or outside hours the next repo waits; it starts once allowed', async () => {
  const w = workspace();
  await start(w, 'ok', ['api-spec', 'web']);
  const held = collect(w, {}, new Date(), { startNext: false });
  assert.deepEqual([held.started, held.finished], [[], []]);
  assert.deepEqual(chainOf(w.dir, w.item).steps.map((x) => x.status), ['done', 'queued']);
  assert.deepEqual(collect(w).started.map((x) => x.repo), ['web']);
});

test('t3 threads are not process runs: finishedSteps leaves them to threadSignals', async () => {
  const w = workspace();
  const r = await start(w, 'ok', ['web']);
  assert.deepEqual(finishedSteps(w.dir), []);
  assert.deepEqual(threadSignals(w.dir, settings), [{ kind: 'run-finished', item: w.item, chain: r.chain, step: 0 }]);
});

test('check: the CLI, the server, and which folders are T3 projects', () => {
  const w = workspace();
  T3.addProject(settings, w.root);
  const c = T3.check(settings, [w.root, join(w.root, '.worktrees', 'web'), tmpdir()]);
  assert.equal(c.ok, true);
  assert.equal(c.version, 'v0.0.0-fake');
  assert.deepEqual(Object.values(c.projects), [true, true, false]);
  process.env.FAKE_T3_DOWN = '1';
  try {
    const down = T3.check(settings, [w.root]);
    assert.equal(down.ok, false);
    assert.match(down.error, /No running T3 Code server/);
  } finally {
    delete process.env.FAKE_T3_DOWN;
  }
  // A project with threads is only removed together with them.
  assert.equal(T3.removeProject(settings, w.root).ok, true);
});

// ---- Review fixes: one thread per worktree, a robust start, reports with leftovers, resumed waits.

test('no second thread beside one my-day let go of that may still work: refused with its link; --force starts anyway', async () => {
  const w = workspace();
  const first = await start(w, 'sleep', ['web']);
  const link = linkOf(first.started.thread);
  // A timeout lets go of the thread (the CLI cannot stop it); it keeps working in the worktree.
  const timedOut = collect(w, { runTimeoutMinutes: 0.0001 }, new Date(Date.now() + 1000));
  assert.match(timedOut.finished[0].reason, /timeout/);
  await assert.rejects(start(w, 'ok', ['web']), (e) => {
    assert.match(e.message, new RegExp(`^not started: the web worker of ${first.chain} is still running in its T3 thread: ${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Stop it in T3 Code first, or run again with --force\\.$`));
    return true;
  });
  // Nothing was dispatched: no attempt counted, no chain written.
  assert.equal(S.getItem(w.db, w.item).attempts, 1);
  assert.equal(listChains(w.dir).length, 1);
  // A waiting thread, or one that cannot be read, counts as working too.
  edit(w, (s) => { s.threads[first.started.thread].message = s.threads[first.started.thread].message.replace('Task: sleep', 'Task: ask'); });
  await assert.rejects(start(w, 'ok', ['web']), /is still waiting in its T3 thread/);
  process.env.FAKE_T3_DOWN = '1';
  try {
    await assert.rejects(start(w, 'ok', ['web']), /could not be read and may still be running/);
  } finally {
    delete process.env.FAKE_T3_DOWN;
  }
  const forced = await startChain(w.db, w.dir, settings, { item: w.item, kind: 'develop', task: 'ok', workspace: w.root, steps: w.steps('web'), force: true });
  assert.ok(forced.started);
  assert.equal(chainOf(w.dir, w.item, forced.chain).force, true);
  collect(w);
  // Once that thread has ended, the next run starts, and it is not asked about again.
  edit(w, (s) => { s.threads[first.started.thread].message = s.threads[first.started.thread].message.replace('Task: ask', 'Task: ok'); });
  const shows = () => calls(w).filter((c) => c.argv[1] === 'show' && c.argv[2] === first.started.thread).length;
  assert.ok((await start(w, 'ok', ['web'])).started);
  const asked = shows();
  collect(w);
  assert.ok((await start(w, 'ok', ['web'])).started);
  assert.equal(shows(), asked);
  assert.equal(listChains(w.dir).find((c) => c.id === first.chain).steps[0].detached, false);
});

test('a thread let go of by run-stop blocks a new worker on its worktree, also for another item and a later repo', async () => {
  const w = workspace();
  const other = S.upsertItem(w.db, { type: 'bug', ext: 'jira:ABC-13', title: 'Other' }).id;
  const r = await start(w, 'sleep', ['web']);
  const stopped = stopChain(w.db, w.dir, settings, w.item);
  assert.equal(stopped.stillRunning[0].thread, r.started.thread);
  // Another item on the same worktree is refused at once.
  await assert.rejects(startChain(w.db, w.dir, settings, { item: other, kind: 'bug', task: 'ok', workspace: w.root, steps: w.steps('web') }), /the web worker of .* is still running/);
  // On another worktree it starts.
  const elsewhere = await startChain(w.db, w.dir, settings, { item: other, kind: 'bug', task: 'ok', workspace: w.root, steps: w.steps('api-spec', 'backend') });
  assert.ok(elsewhere.started);
  // A later repo of a chain is checked when its turn comes: here a thread let go of on backend.
  const third = S.upsertItem(w.db, { type: 'bug', ext: 'jira:ABC-14', title: 'Third' }).id;
  const blocker = await startChain(w.db, w.dir, settings, { item: third, kind: 'bug', task: 'sleep', workspace: w.root, steps: w.steps('backend') });
  stopChain(w.db, w.dir, settings, third);
  const fin = collect(w).finished.find((f) => f.item === other);
  assert.match(fin.reason, new RegExp(`backend: not started: the backend worker of ${blocker.chain} is still running`));
  assert.deepEqual(chainOf(w.dir, other).steps.map((s) => s.status), ['done', 'failed']);
});

test('a timeout while the thread cannot be read lets go of it too', async () => {
  const w = workspace();
  await start(w, 'sleep', ['web']);
  process.env.FAKE_T3_DOWN = '1';
  try {
    const out = collect(w, { runTimeoutMinutes: 0.0001 }, new Date(Date.now() + 1000));
    assert.match(out.finished[0].reason, /could not be read .* and may still be running/);
  } finally {
    delete process.env.FAKE_T3_DOWN;
  }
  assert.equal(chainOf(w.dir, w.item).steps[0].detached, true);
});

test('a timeout names the threads still running, for the loop to interrupt', async () => {
  const w = workspace();
  const r = await start(w, 'sleep', ['web', 'backend']);
  collect(w); // the link is known from here on
  const out = collect(w, { runTimeoutMinutes: 0.0001 }, new Date(Date.now() + 1000));
  assert.deepEqual(out.stillRunning, [{ item: w.item, chain: r.chain, repo: 'web', thread: r.started.thread, link: linkOf(r.started.thread) }]);
  // A chain that ends normally leaves nothing running.
  const w2 = workspace();
  await start(w2, 'ok', ['web']);
  assert.deepEqual(collect(w2).stillRunning, []);
});

test('thread start: the last JSON line counts; a lost answer is found by the title, which names the chain', async () => {
  assert.deepEqual(T3.lastJson('[12:00] WARN: slow\n{"threadId":"t1"}\n').data, { threadId: 't1' });
  assert.deepEqual(T3.lastJson('{"a":1}\n{"threadId":"t2"}').data, { threadId: 't2' });
  assert.equal(T3.lastJson('Thread started.').ok, false);
  const w = workspace();
  const wt = join(w.root, '.worktrees', 'web');
  T3.addProject(settings, wt);
  process.env.FAKE_T3_START = 'noisy';
  try {
    const noisy = T3.startThread(settings, { project: wt, message: 'Task: ok', title: 'noisy one' });
    assert.deepEqual([noisy.ok, noisy.adopted], [true, undefined]);
    // No JSON at all: the thread exists, and the one with exactly this title is adopted.
    process.env.FAKE_T3_START = 'garbage';
    const garbage = T3.startThread(settings, { project: wt, message: 'Task: ok', title: 'garbage one' });
    assert.equal(garbage.ok, true);
    assert.equal(garbage.adopted, true);
    assert.equal(server(w).threads[garbage.threadId].title, 'garbage one');
    // No answer in time: the same.
    process.env.FAKE_T3_START = 'hang';
    const hung = T3.startThread(settings, { project: wt, message: 'Task: ok', title: 'hung one', timeout: 500 });
    assert.deepEqual([hung.ok, hung.adopted, server(w).threads[hung.threadId].title], [true, true, 'hung one']);
    // Without a title there is nothing to look for: the failure stands.
    process.env.FAKE_T3_START = 'garbage';
    const untitled = T3.startThread(settings, { project: wt, message: 'Task: ok' });
    assert.match(untitled.error, /unreadable answer from t3: Thread started\./);
  } finally {
    delete process.env.FAKE_T3_START;
  }
  // Through the runner: a garbled answer still yields the chain's thread.
  const w2 = workspace();
  process.env.FAKE_T3_START = 'garbage';
  let r;
  try {
    r = await start(w2, 'ok', ['web']);
  } finally {
    delete process.env.FAKE_T3_START;
  }
  assert.ok(r.started, JSON.stringify(r));
  assert.equal(chainOf(w2.dir, w2.item).steps[0].adopted, true);
  assert.match(server(w2).threads[r.started.thread].title, new RegExp(`\\(${r.chain}\\)`));
  assert.equal(collect(w2).finished[0].next, 'advance');
});

test('the chain file has the thread as soon as it started; the start asks t3 for nothing else', async () => {
  const w = workspace();
  // The run-started event fails (a crash right after the start): the thread is on record all the same.
  let inserts = 0;
  const db = new Proxy(w.db, { get: (t, k) => (k === 'prepare' ? (sql) => { if (/INSERT INTO events/i.test(sql) && ++inserts === 2) throw new Error('crash'); return t.prepare(sql); } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  await assert.rejects(startChain(db, w.dir, settings, { item: w.item, kind: 'develop', task: 'ok', workspace: w.root, steps: w.steps('web') }), /crash/);
  const step = chainOf(w.dir, w.item).steps[0];
  assert.deepEqual([step.status, typeof step.thread], ['running', 'string']);
  assert.deepEqual(calls(w).map((c) => c.argv.slice(0, 2).join(' ')), ['project add', 'thread start']);
  // The next look at it records the link, and collects it.
  assert.equal(collect(w).finished[0].next, 'advance');
  assert.equal(chainOf(w.dir, w.item).steps[0].link, linkOf(step.thread));
});

test('a finished thread with background work left still yields its report', async () => {
  // As T3 Code reports it: status waiting, no pending request, a background task (t3 v0.1.12).
  const st = (thread, text) => T3.threadState({ thread: { latestRunId: 'r1', ...thread }, messages: text ? [{ role: 'assistant', runId: 'r1', text }] : [] });
  const report = '```json\n{"status":"done","summary":"ok"}\n```';
  const bg = [{ taskId: 'x', kind: 'command', awaited: true }];
  assert.equal(st({ status: 'waiting', pendingRequestCount: 0, activeRunId: null, pendingBackgroundTasks: bg }, report).state, 'done');
  assert.equal(st({ status: 'waiting', pendingRequestCount: 0, pendingBackgroundTasks: bg }, 'Started the tests.').state, 'running');
  assert.equal(st({ status: 'completed', activeRunId: 'r1', pendingBackgroundTasks: bg }, report).state, 'done');
  assert.equal(st({ status: 'completed', activeRunId: 'r1' }, 'still going').state, 'running');
  assert.equal(st({ status: 'running' }, report).state, 'running');
  assert.equal(st({ status: 'waiting', pendingRequestCount: 1 }, report).state, 'waiting');
  // The run that the finished background task woke has no report: the earlier one counts.
  const woke = T3.threadState({ thread: { status: 'completed', latestRunId: 'r2' }, messages: [{ role: 'assistant', runId: 'r1', text: report }, { role: 'assistant', runId: 'r2', text: 'The tests finished.' }] });
  assert.equal(woke.state, 'done');
  assert.match(woke.text, /"status":"done"/);

  for (const task of ['leftovers', 'background']) {
    const w = workspace();
    await start(w, task, ['web']);
    assert.deepEqual(threadSignals(w.dir, settings).map((x) => x.kind), ['run-finished'], task);
    const out = collect(w);
    assert.equal(out.finished[0]?.next, 'advance', task);
    assert.equal(S.listEvents(w.db, { itemId: w.item }).filter((e) => e.kind === 'run-waiting').length, 0, task);
  }
  // No report yet: it is still working (not asking the user); once woken it is reminded as usual.
  const w = workspace();
  const r = await start(w, 'background-silent', ['web']);
  const first = collect(w);
  assert.deepEqual([first.finished, first.waiting, first.running], [[], [], [r.chain]]);
  edit(w, (s) => { s.threads[r.started.thread].woke = true; });
  collect(w);
  assert.equal(chainOf(w.dir, w.item).steps[0].nudged, true);
  // A woken thread whose report came before the wake-up is done.
  const w2 = workspace();
  const r2 = await start(w2, 'background', ['web']);
  edit(w2, (s) => { s.threads[r2.started.thread].woke = true; });
  assert.equal(collect(w2).finished[0].next, 'advance');
});

test('at the timeout a report that is already there counts', async () => {
  const w = workspace();
  await start(w, 'busy-reported', ['web']);
  assert.deepEqual(collect(w).finished, []);
  const fin = collect(w, { runTimeoutMinutes: 0.0001 }, new Date(Date.now() + 1000)).finished[0];
  assert.equal(fin.next, 'advance');
  assert.equal(chainOf(w.dir, w.item).steps[0].detached, undefined);
});

test('a waiting worker that got its answer is reported as resumed, so its wait ends on time', async () => {
  const w = workspace();
  const r = await start(w, 'ask', ['web']);
  const t0 = Date.parse(chainOf(w.dir, w.item).steps[0].startedAt);
  collect(w, {}, new Date(t0 + 60_000));
  assert.equal(chainOf(w.dir, w.item).steps[0].waiting, true);
  // Answered; it works on.
  edit(w, (s) => { s.threads[r.started.thread].message = s.threads[r.started.thread].message.replace('Task: ask', 'Task: sleep'); });
  assert.deepEqual(threadSignals(w.dir, settings), [{ kind: 'run-resumed', item: w.item, chain: r.chain, step: 0, repo: 'web' }]);
  collect(w, {}, new Date(t0 + 10 * 60_000));
  const step = chainOf(w.dir, w.item).steps[0];
  assert.deepEqual([step.waiting, step.waitedMs], [false, 9 * 60_000]);
  assert.deepEqual(threadSignals(w.dir, settings), []);
});

test('a reminder that cannot be sent is tried again on the next tick; at the timeout the step fails', async () => {
  const w = workspace();
  const r = await start(w, 'forgetful', ['web']);
  process.env.FAKE_T3_SEND_DOWN = '1';
  try {
    const out = collect(w);
    assert.deepEqual([out.finished, out.running], [[], [r.chain]]);
    assert.match(chainOf(w.dir, w.item).steps[0].nudgeError, /Server request failed/);
  } finally {
    delete process.env.FAKE_T3_SEND_DOWN;
  }
  assert.deepEqual(collect(w).finished, []);
  assert.equal(chainOf(w.dir, w.item).steps[0].nudged, true);
  assert.equal(collect(w).finished[0].next, 'advance');
  const w2 = workspace();
  await start(w2, 'silent', ['web']);
  process.env.FAKE_T3_SEND_DOWN = '1';
  try {
    const fin = collect(w2, { runTimeoutMinutes: 0.0001 }, new Date(Date.now() + 1000)).finished[0];
    assert.match(fin.reason, /run ended without a result; the reminder could not be sent \(ThreadSendError/);
  } finally {
    delete process.env.FAKE_T3_SEND_DOWN;
  }
});

test('a project that already exists is fine, whatever else the CLI prints first', () => {
  const w = workspace();
  const wt = join(w.root, '.worktrees', 'web');
  assert.deepEqual(T3.addProject(settings, wt), { ok: true, added: true });
  process.env.FAKE_T3_WARN = '1';
  try {
    assert.deepEqual(T3.addProject(settings, wt), { ok: true, added: false });
  } finally {
    delete process.env.FAKE_T3_WARN;
  }
});
