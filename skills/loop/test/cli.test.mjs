import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'state.mjs');
const dir = mkdtempSync(join(tmpdir(), 'myday-cli-'));
const home = mkdtempSync(join(tmpdir(), 'myday-cli-home-'));
process.env.MY_DAY_HOME = home; // every spawned CLI inherits it; never touch the real ~/.my-day
const run = (...a) => execFileSync(process.execPath, [CLI, ...a], { env: { ...process.env, MY_DAY_DIR: dir }, encoding: 'utf8' }).trim();

test('upsert → set → fail → show → summary round trip', () => {
  assert.equal(run('upsert', '--type', 'bug', '--ext', 'jira:ABC-1', '--title', 'Broken'), 'bug-1 (new)');
  assert.equal(run('upsert', '--type', 'bug', '--ext', 'jira:ABC-1'), 'bug-1');
  run('set', 'bug-1', 'status=attempting', 'data.routing=local', 'repos=api,web');
  const got = JSON.parse(run('get', 'jira:ABC-1'));
  assert.equal(got.status, 'attempting');
  assert.deepEqual(got.repos, ['api', 'web']);
  assert.equal(got.data.routing, 'local');
  run('fail', 'bug-1', '--reason', 'could not reproduce');
  assert.match(run('show', 'bug-1'), /elaborate bug-1/);
  const sum = run('summary', '--today');
  assert.match(sum, /bug-1 Broken — could not reproduce/);
});

test('questions via CLI', () => {
  run('upsert', '--type', 'story', '--ext', 'jira:ABC-2', '--title', 'Story');
  const q = run('ask', 'story-1', 'Take', 'story-1', 'next?');
  assert.match(q, /^q-\d+$/);
  assert.match(run('questions'), /Take story-1 next\?/);
  run('answer', q, 'yes');
  assert.doesNotMatch(run('questions'), /Take story-1/);
});

test('errors exit 1 with a message', () => {
  const r = spawnSync(process.execPath, [CLI, 'show', 'bug-404'], { env: { ...process.env, MY_DAY_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no item bug-404/);
});

test('config missing lists all required files in an empty dir', () => {
  assert.match(run('config', 'missing'), /LOOP\nQUERY-MY-TASKS/);
});

test('upsert-many is idempotent and reports created flags', () => {
  const input = JSON.stringify([
    { type: 'review', ext: 'gitlab:g/a!1', title: 'A' },
    { type: 'review', ext: 'gitlab:g/a!2', title: 'B' },
  ]);
  const opts = { env: { ...process.env, MY_DAY_DIR: dir }, encoding: 'utf8', input };
  const first = JSON.parse(execFileSync(process.execPath, [CLI, 'upsert-many'], opts));
  const second = JSON.parse(execFileSync(process.execPath, [CLI, 'upsert-many'], opts));
  assert.deepEqual(first.map((r) => r.created), [true, true]);
  assert.deepEqual(second.map((r) => r.created), [false, false]);
  assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id));
});

test('delete removes items by id and --closed sweeps terminal ones', () => {
  const a = run('upsert', '--type', 'bug', '--ext', 'jira:DEL-1', '--status', 'ignored').split(' ')[0];
  const b = run('upsert', '--type', 'bug', '--ext', 'jira:DEL-2').split(' ')[0];
  const c = run('upsert', '--type', 'bug', '--ext', 'jira:DEL-3').split(' ')[0];
  assert.equal(run('delete', b), `deleted ${b}`);
  assert.equal(spawnSync(process.execPath, [CLI, 'get', b], { env: { ...process.env, MY_DAY_DIR: dir } }).status, 1);
  assert.ok(run('delete', '--closed', '--type', 'bug').split(' ').includes(a));
  assert.ok(run('get', c).includes('jira:DEL-3'));
});

test('dream-data bundles the window and dream-done moves it forward', () => {
  const d = mkdtempSync(join(tmpdir(), 'myday-dream-'));
  const r = (...a) => execFileSync(process.execPath, [CLI, ...a], { env: { ...process.env, MY_DAY_DIR: d }, encoding: 'utf8' }).trim();
  r('upsert', '--type', 'bug', '--ext', 'jira:DR-1', '--title', 'Flaky');
  r('dispatch', 'bug-1', '--agent', 'w1');
  r('reconcile', 'bug-1', '--result', '{"status":"failed","summary":"CI red, local green"}');
  r('dispatch', 'bug-1', '--agent', 'w2');
  r('fail', 'bug-1', '--reason', 'CI red, local green');
  r('upsert', '--type', 'mr', '--ext', 'gitlab:g/a!7', '--title', 'Fix');
  r('set', 'mr-1', 'status=merged');
  r('upsert', '--type', 'review', '--ext', 'gitlab:g/b!3', '--title', 'Teammate MR');
  const q = r('ask', 'bug-1', 'Skip', 'flaky', 'test?');
  r('answer', q, 'yes, quarantine it');
  r('event', '-', 'config-changed', 'DEVELOP: run the full CI suite locally');

  const b = JSON.parse(r('dream-data', '--json'));
  assert.deepEqual(Object.keys(b).sort(), ['attempts', 'configChanges', 'counts', 'cycleTimes', 'events', 'failed', 'questions', 'reconciles', 'reviews', 'window']);
  assert.equal(b.window.lastDreamAt, null);
  assert.ok(new Date(b.window.until) - new Date(b.window.from) >= 7 * 86400000 - 1000);
  assert.ok(b.events.byKind.dispatched.every((e) => e.id && e.ts && e.item === 'bug-1'));
  assert.equal(b.events.byItem['bug-1'].kinds.dispatched, 2);
  assert.deepEqual(b.failed.map((f) => [f.id, f.fail_reason]), [['bug-1', 'CI red, local green']]);
  assert.equal(b.failed[0].eventIds.length, 1);
  assert.deepEqual(b.questions.map((x) => [x.status, x.answer]), [['answered', 'yes, quarantine it']]);
  assert.deepEqual(b.reconciles.map((x) => [x.item, x.status]), [['bug-1', 'failed']]);
  assert.deepEqual(b.attempts.map((a) => [a.id, a.dispatches, a.attempts]), [['bug-1', 2, 2]]);
  assert.equal(b.cycleTimes[0].id, 'mr-1');
  assert.equal(typeof b.cycleTimes[0].hours, 'number');
  assert.deepEqual(b.reviews.map((x) => [x.id, x.status]), [['review-1', 'new']]);
  assert.match(b.configChanges[0].message, /full CI suite/);
  assert.match(r('dream-data'), /Failed 1 · questions 1/);

  r('dream-done', '--report', '.my-day/dreams/2026-10-02.md', '3 findings, 1 config edit');
  const after = JSON.parse(r('dream-data', '--json'));
  assert.ok(after.window.lastDreamAt);
  assert.equal(after.window.from, after.window.lastDreamAt);
  assert.deepEqual(Object.keys(after.events.byKind).sort(), ['dream', 'notify']);
  assert.equal(after.events.byKind.dream[0].message, '3 findings, 1 config edit');
  // --since overrides lastDreamAt.
  assert.ok(JSON.parse(r('dream-data', '--since', '2000-01-01', '--json')).events.byKind.dispatched);
});

test('tick reports dashboard answers and requests once, records the next tick and honours pause', async () => {
  const tick = () => JSON.parse(execFileSync(process.execPath, [CLI, 'tick'], { env: { ...process.env, MY_DAY_DIR: dir, GLAB_BIN: '/usr/bin/false' }, encoding: 'utf8' }));
  tick();
  run('event', 'bug-1', 'dashboard-request', 'bug-1: retry requested on dashboard');
  run('pause');
  const t = tick();
  assert.deepEqual(t.fromDashboard.map((d) => d.kind), ['dashboard-request']);
  assert.equal(t.schedule.paused, true);
  assert.equal(t.schedule.freeSlots, 0);
  assert.equal(tick().fromDashboard.length, 0);
  run('resume');
  assert.equal(tick().schedule.paused, false);
  const S = await import('../lib/db.mjs');
  const db = S.openDb(join(dir, 'state.db'));
  assert.ok(Date.parse(S.getMeta(db, 'nextTickAt')) > Date.parse(S.getMeta(db, 'lastTickAt')));
  db.close();
});

test('watch-dashboard streams only dashboard events after the tick cursor', () => {
  run('event', 'bug-1', 'note', 'not a dashboard event');
  run('event', 'bug-1', 'dashboard-request', 'bug-1: elaborate requested on dashboard');
  const lines = run('watch-dashboard', '--once').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.kind), ['dashboard-request']);
  assert.equal(lines[0].item, 'bug-1');
});

test('loops register lists the workspace; stop marks it stopped; a new session runs again', async () => {
  const d = join(mkdtempSync(join(tmpdir(), 'myday-cli-')), 'client-a', '.my-day');
  const r = (...a) => execFileSync(process.execPath, [CLI, ...a], { env: { ...process.env, MY_DAY_DIR: d, GLAB_BIN: '/usr/bin/false' }, encoding: 'utf8' }).trim();
  const reg = JSON.parse(r('loops', 'register', '--json'));
  assert.equal(reg.name, 'client-a');
  const mine = () => JSON.parse(r('loops', '--json')).find((l) => l.id === reg.id);
  assert.deepEqual([mine().running, mine().stopped], [false, false]);
  r('tick');
  assert.equal(mine().running, true);
  assert.match(r('stop'), /stopped/);
  assert.deepEqual([mine().running, mine().stopped], [false, true]);
  assert.match(r('loops'), /client-a\s+stopped/);
  r('tick'); // "start my day" again in the same session: no new --new-session bootstrap
  assert.deepEqual([mine().running, mine().stopped], [true, false]);
  assert.equal(JSON.parse(r('loops', 'forget', reg.id, '--json')).forgotten, true);
  assert.equal(mine(), undefined);
});

test('run → tick collects the chain; watch reports a finished run; bootstrap keeps run agents', async () => {
  const { chmodSync, mkdirSync } = await import('node:fs');
  const fake = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
  chmodSync(fake, 0o755);
  const root = mkdtempSync(join(tmpdir(), 'myday-cli-run-'));
  const d = join(root, '.my-day');
  mkdirSync(join(root, 'wt', 'web'), { recursive: true });
  const env = { ...process.env, MY_DAY_DIR: d, GLAB_BIN: '/usr/bin/false', CLAUDE_BIN: fake };
  const r = (...a) => execFileSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8' }).trim();
  r('upsert', '--type', 'bug', '--ext', 'jira:RUN-1');
  // The task comes on stdin: ticket text never passes through a shell command line.
  const started = JSON.parse(execFileSync(process.execPath, [CLI, 'run', 'bug-1', '--kind', 'bug', '--chain', `web=${join(root, 'wt', 'web')}`, '--status', 'developing'], { env, encoding: 'utf8', input: 'ok\n' }));
  assert.deepEqual(started.started, { repo: 'web' });
  assert.equal(JSON.parse(r('get', 'bug-1')).status, 'developing');
  assert.equal(JSON.parse(r('get', 'bug-1')).agent_id, `run:${started.chain}`);
  // The fake has exited by now: watch sees it, a new session keeps the item's run, tick reconciles.
  assert.deepEqual(r('watch', '--once').split('\n').filter(Boolean).map((l) => JSON.parse(l)), [{ kind: 'run-finished', item: 'bug-1', chain: started.chain }]);
  assert.match(JSON.stringify(JSON.parse(r('runs', '--json'))), /"status":"running"/);
  const t = JSON.parse(r('tick'));
  assert.deepEqual(t.runs.finished.map((f) => [f.item, f.next]), [['bug-1', 'advance']]);
  assert.equal(JSON.parse(r('get', 'bug-1')).agent_id, null);
  assert.match(r('runs'), /bug-1-1\s+done\s+web done/);
  assert.equal(JSON.parse(r('run-stop', 'bug-1')).stopped, false);
});

test('bootstrap --new-session clears subagent orphans but keeps claude -p runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'myday-cli-orph-'));
  const d = join(root, '.my-day');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(d, { recursive: true });
  const { createServer } = await import('node:net');
  const port = await new Promise((ok) => { const srv = createServer().listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => ok(p)); }); });
  writeFileSync(join(d, 'LOOP.md'), `---\nport: ${port}\n---\n# Loop\n## Files\n`);
  const r = (...a) => execFileSync(process.execPath, [CLI, ...a], { env: { ...process.env, MY_DAY_DIR: d }, encoding: 'utf8' }).trim();
  r('upsert', '--type', 'bug', '--ext', 'jira:O-1');
  r('upsert', '--type', 'bug', '--ext', 'jira:O-2');
  r('set', 'bug-1', 'agent_id=w1');
  r('set', 'bug-2', 'agent_id=run:bug-2-1');
  r('upsert', '--type', 'bug', '--ext', 'jira:O-3');
  r('set', 'bug-3', 'agent_id=run:bug-3-1');
  mkdirSync(join(d, 'runs'), { recursive: true });
  writeFileSync(join(d, 'runs', 'bug-2-1.json'), JSON.stringify({ id: 'bug-2-1', item: 'bug-2', status: 'running', startedAt: new Date().toISOString(), steps: [] }));
  let orphans;
  try {
    ({ orphans } = JSON.parse(r('bootstrap', '--new-session')));
  } finally {
    r('server', 'stop');
  }
  // bug-3's chain file is gone: nothing will ever collect it, so it is an orphan too.
  assert.deepEqual(orphans, ['bug-1', 'bug-3']);
  assert.equal(JSON.parse(r('get', 'bug-1')).agent_id, null);
  assert.equal(JSON.parse(r('get', 'bug-3')).agent_id, null);
  assert.equal(JSON.parse(r('get', 'bug-2')).agent_id, 'run:bug-2-1');
});
