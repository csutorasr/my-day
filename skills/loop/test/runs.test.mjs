import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../lib/db.mjs';
import { DEFAULTS } from '../lib/config.mjs';
import { alive, collectRuns, finishedSteps, listChains, startChain, stopChain, workerPrompt } from '../lib/runs.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
chmodSync(FAKE, 0o755);
const settings = { ...DEFAULTS, claudeBin: FAKE, retryLimit: 3 };

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'myday-runs-'));
  const dir = join(root, '.my-day');
  mkdirSync(dir, { recursive: true });
  for (const r of ['api-spec', 'backend', 'web']) mkdirSync(join(root, '.worktrees', r), { recursive: true });
  const db = S.openDb(join(dir, 'state.db'));
  const { id } = S.upsertItem(db, { type: 'story', ext: 'jira:ABC-12', title: 'Wishlist' });
  const steps = (...repos) => repos.map((repo) => ({ repo, cwd: join(root, '.worktrees', repo) }));
  return { root, dir, db, item: id, steps };
}

const chainOf = (dir, item) => listChains(dir).find((c) => c.item === item);
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}
const start = (w, task, ...repos) => startChain(w.db, w.dir, settings, { item: w.item, kind: 'develop', task, dryRun: false, workspace: w.root, steps: w.steps(...repos) });

test('workerPrompt names the repo and the worktree it runs in, and the earlier runs', () => {
  const p = workerPrompt({ kind: 'develop', workspace: '/w', item: 'story-1', dryRun: true, task: 'do it', repo: 'web', worktree: '/w/.worktrees/web/b', previous: [{ repo: 'backend', status: 'done', result: { branch: 'b', mrUrl: 'https://g/1', summary: 'ok' } }] });
  assert.match(p, /my-day:worker/);
  assert.match(p, /^Repo: web$/m);
  assert.match(p, /^Worktree: \/w\/\.worktrees\/web\/b$/m);
  assert.match(p, /^Dry run: true$/m);
  assert.match(p, /backend: done · branch b · https:\/\/g\/1 · ok/);
});

test('a chain runs repo by repo; the next one sees the earlier result; the item is reconciled once at the end', async () => {
  const w = workspace();
  const r = await start(w, 'ok', 'api-spec', 'backend');
  assert.deepEqual(r.started, { repo: 'api-spec' });
  assert.equal(S.getItem(w.db, w.item).agent_id, `run:${r.chain}`);
  assert.equal(S.getItem(w.db, w.item).attempts, 1);
  const second = await until(() => collectRuns(w.db, w.dir, settings).started.find((s) => s.repo === 'backend'));
  assert.equal(second.item, w.item);
  const out = chainOf(w.dir, w.item);
  assert.equal(out.steps[0].status, 'done');
  assert.equal(out.steps[0].result.branch, 'b-api-spec');
  const fin = await until(() => collectRuns(w.db, w.dir, settings).finished[0]);
  assert.equal(fin.next, 'advance');
  assert.equal(chainOf(w.dir, w.item).status, 'done');
  // The second run's prompt carried the first run's result.
  const prompt = readFileSync(join(w.dir, 'runs', `${r.chain}.backend.prompt`), 'utf8');
  assert.match(prompt, /api-spec: done · branch b-api-spec/);
  const item = S.getItem(w.db, w.item);
  assert.equal(item.agent_id, null);
  assert.equal(S.listItems(w.db, { type: 'mr' }).filter((m) => m.parent_id === w.item).length, 2);
  // Collecting again finds nothing new: reconciled exactly once.
  assert.deepEqual(collectRuns(w.db, w.dir, settings).finished, []);
  assert.equal(S.listEvents(w.db, { itemId: w.item }).filter((e) => e.kind === 'worker').length, 1);
});

test('a failing repo stops the chain; later repos are cancelled', async () => {
  const w = workspace();
  await start(w, 'fail-backend', 'api-spec', 'backend', 'web');
  const fin = await until(() => collectRuns(w.db, w.dir, settings).finished[0]);
  assert.equal(fin.next, 'failure-transition');
  assert.match(fin.reason, /backend broke/);
  assert.deepEqual(chainOf(w.dir, w.item).steps.map((s) => s.status), ['done', 'failed', 'cancelled']);
});

test('a run that ends without a result fails with its output tail', async () => {
  const w = workspace();
  await start(w, 'silent', 'web');
  const fin = await until(() => collectRuns(w.db, w.dir, settings).finished[0]);
  assert.match(fin.reason, /run ended without a result/);
});

test('a claude that cannot start fails the chain at once, with stderr', async () => {
  const w = workspace();
  const r = await start(w, 'crash', 'web');
  assert.match(r.failed.reason, /cannot start/);
  assert.equal(r.failed.next, 'failure-transition');
  assert.equal(S.getItem(w.db, w.item).attempts, 1);
  assert.equal(S.getItem(w.db, w.item).agent_id, null);
  assert.equal(chainOf(w.dir, w.item).status, 'failed');
});

test('a missing claude binary fails the chain at once', async () => {
  const w = workspace();
  const r = await startChain(w.db, w.dir, { ...settings, claudeBin: '/nonexistent/claude' }, { item: w.item, kind: 'develop', task: 'ok', workspace: w.root, steps: w.steps('web') });
  assert.match(r.failed.reason, /ENOENT|not found|cannot start/);
});

test('a run past its timeout is stopped and fails', async () => {
  const w = workspace();
  await start(w, 'sleep', 'web');
  const step = chainOf(w.dir, w.item).steps[0];
  assert.equal(alive(step), true);
  const fin = await until(() => collectRuns(w.db, w.dir, { ...settings, runTimeoutMinutes: 0.0001 }).finished[0]);
  assert.match(fin.reason, /timeout/);
  await until(() => !alive(step));
});

test('a reused pid (start time differs) counts as exited', async () => {
  const w = workspace();
  const r = await start(w, 'sleep', 'web');
  const file = join(w.dir, 'runs', `${r.chain}.json`);
  const chain = JSON.parse(readFileSync(file, 'utf8'));
  const realPid = chain.steps[0].pid;
  chain.steps[0].lstart = 'Thu Jan  1 00:00:00 1970';
  writeFileSync(file, JSON.stringify(chain));
  assert.equal(alive(chain.steps[0]), false);
  assert.deepEqual(finishedSteps(w.dir).map((f) => f.item), [w.item]);
  process.kill(-realPid, 'SIGKILL');
});

test('stop kills the running repo, cancels the rest and blocks the item; stopping again is a no-op', async () => {
  const w = workspace();
  await start(w, 'sleep', 'web', 'backend');
  const step = chainOf(w.dir, w.item).steps[0];
  const r = stopChain(w.db, w.dir, settings, w.item);
  assert.equal(r.stopped, true);
  assert.equal(r.next, 'failure-transition');
  assert.deepEqual(chainOf(w.dir, w.item).steps.map((s) => s.status), ['stopped', 'cancelled']);
  assert.equal(chainOf(w.dir, w.item).status, 'stopped');
  await until(() => !alive(step));
  assert.equal(S.getItem(w.db, w.item).agent_id, null);
  assert.deepEqual(stopChain(w.db, w.dir, settings, w.item), { stopped: false });
  assert.deepEqual(collectRuns(w.db, w.dir, settings).finished, []);
});

test('verbose output (a JSON array of messages) still yields the result', async () => {
  const w = workspace();
  await start(w, 'verbose', 'web');
  const fin = await until(() => collectRuns(w.db, w.dir, settings).finished[0]);
  assert.equal(fin.next, 'advance');
});

test('a run sees the loop store through MY_DAY_DIR, so the worker can use the state CLI', async () => {
  const w = workspace();
  await start(w, 'ok', 'web');
  await until(() => collectRuns(w.db, w.dir, settings).finished[0]);
  assert.equal(chainOf(w.dir, w.item).steps[0].result.stateDir, w.dir);
});

test('an earlier summary spanning lines stays on one line in the next prompt', async () => {
  const w = workspace();
  const r = await start(w, 'multiline', 'api-spec', 'web');
  await until(() => collectRuns(w.db, w.dir, settings).finished[0]);
  const prompt = readFileSync(join(w.dir, 'runs', `${r.chain}.web.prompt`), 'utf8');
  assert.equal(prompt.match(/^Task: /gm).length, 1);
});

test('a chain another collector holds (lock) is skipped, then collected once', async () => {
  const w = workspace();
  const r = await start(w, 'ok', 'web');
  await until(() => !alive(chainOf(w.dir, w.item).steps[0]));
  const { spawn } = await import('node:child_process');
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  writeFileSync(join(w.dir, 'runs', `${r.chain}.lock`), String(holder.pid));
  assert.deepEqual(collectRuns(w.db, w.dir, settings).finished, []);
  holder.kill();
  rmSync(join(w.dir, 'runs', `${r.chain}.lock`));
  assert.equal(collectRuns(w.db, w.dir, settings).finished.length, 1);
  assert.deepEqual(collectRuns(w.db, w.dir, settings).finished, []);
});

test('a stale lock (holder gone) does not block collection forever', async () => {
  const w = workspace();
  const r = await start(w, 'ok', 'web');
  await until(() => !alive(chainOf(w.dir, w.item).steps[0]));
  writeFileSync(join(w.dir, 'runs', `${r.chain}.lock`), '999999');
  assert.equal(collectRuns(w.db, w.dir, settings).finished.length, 1);
});

test('while paused or outside hours the next repo waits; it starts once allowed', async () => {
  const w = workspace();
  await start(w, 'ok', 'api-spec', 'web');
  await until(() => !alive(chainOf(w.dir, w.item).steps[0]));
  const held = collectRuns(w.db, w.dir, settings, new Date(), { startNext: false });
  assert.deepEqual([held.started, held.finished], [[], []]);
  assert.deepEqual(chainOf(w.dir, w.item).steps.map((x) => x.status), ['done', 'queued']);
  assert.deepEqual(collectRuns(w.db, w.dir, settings).started.map((x) => x.repo), ['web']);
});

test('stop after the running repo already finished keeps its result and MR', async () => {
  const w = workspace();
  await start(w, 'ok', 'api-spec', 'web');
  await until(() => !alive(chainOf(w.dir, w.item).steps[0]));
  const r = stopChain(w.db, w.dir, settings, w.item);
  assert.equal(r.stopped, true);
  assert.equal(r.next, 'failure-transition');
  assert.deepEqual(chainOf(w.dir, w.item).steps.map((x) => x.status), ['done', 'cancelled']);
  assert.equal(S.listItems(w.db, { type: 'mr' }).filter((m) => m.parent_id === w.item).length, 1);
  assert.match(r.reason, /stopped on the dashboard/);
});

test('without ps the runner still sees a live process', async () => {
  const w = workspace();
  await start(w, 'sleep', 'web');
  const step = chainOf(w.dir, w.item).steps[0];
  process.env.MY_DAY_PS = '/nonexistent/ps';
  try {
    assert.equal(alive(step), true);
    assert.deepEqual(collectRuns(w.db, w.dir, settings).finished, []);
  } finally {
    delete process.env.MY_DAY_PS;
    process.kill(-step.pid, 'SIGKILL');
  }
});

test('stop also kills what the run started (its process group), even what ignores SIGTERM', async () => {
  const w = workspace();
  await start(w, 'child', 'web');
  const pidFile = join(w.root, '.worktrees', 'web', 'child.pid');
  const child = Number(await until(() => { try { return readFileSync(pidFile, 'utf8'); } catch { return ''; } }));
  stopChain(w.db, w.dir, settings, w.item);
  const gone = () => { try { process.kill(child, 0); return false; } catch { return true; } };
  try {
    await until(gone, 3000);
  } finally {
    try { process.kill(child, 'SIGKILL'); } catch {}
  }
});
