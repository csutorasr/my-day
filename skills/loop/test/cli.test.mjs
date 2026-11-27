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
// The suite may itself run inside a T3 Code thread: no spawned CLI may see that, or reach a real t3.
for (const k of Object.keys(process.env)) if (k === 'CLAUDE_CODE_ENTRYPOINT' || k.startsWith('T3CODE_') || k === 'T3_BIN') delete process.env[k];
const FAKE_T3 = fileURLToPath(new URL('./fixtures/fake-t3.mjs', import.meta.url));
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

test('drafts, sources and schedules through the CLI and tick', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const d = join(mkdtempSync(join(tmpdir(), 'myday-cli-pm-')), '.my-day');
  mkdirSync(d, { recursive: true });
  // Every day, all day, so the status slot (earlier today or yesterday) is always due.
  writeFileSync(join(d, 'LOOP.md'), '---\nforge: none\nworkingHours: 00:00-24:00\nworkingDays: Sun-Sat\nrequires: mcp:atlassian, mcp:slack\nstatusSchedule: Sun-Sat 00:00\n---\n# Loop\n## Files\n');
  const env = { ...process.env, MY_DAY_DIR: d };
  const r = (...a) => execFileSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8' }).trim();
  const tick = () => JSON.parse(r('tick'));
  r('upsert', '--type', 'report', '--ext', 'status:w40', '--title', 'Week 40');

  // A draft comes on stdin (its body may hold anything); bad drafts are refused.
  const draft = { action: 'slack: post channel', target: '#product', body: 'Shipped: "search" & filters.' };
  const q = execFileSync(process.execPath, [CLI, 'ask', 'report-1', 'Post the weekly status?', '--draft', '-'], { env, encoding: 'utf8', input: JSON.stringify(draft) }).trim();
  assert.match(r('questions'), /q-1 \(report-1\) \[draft slack: post channel → #product\] Post the weekly status\?/);
  assert.equal(spawnSync(process.execPath, [CLI, 'ask', '-', 'x', '--draft', '{"body":"b"}'], { env, encoding: 'utf8' }).status, 1);
  assert.deepEqual(tick().approvedDrafts, []);
  r('answer', q, 'approved', '--body', 'Shipped: search, filters and saved views.');
  assert.deepEqual(tick().approvedDrafts, [q]);
  assert.deepEqual(tick().approvedDrafts, [q]); // still there until written
  assert.equal(JSON.parse(r('questions', '--status', 'answered', '--json'))[0].draft.body, 'Shipped: search, filters and saved views.');
  r('wrote', q, '--url', 'https://chat.example.com/p/1');
  assert.deepEqual(tick().approvedDrafts, []);

  // Sources: only the required ones count; unreported ones are unchecked.
  assert.deepEqual(tick().sources, { down: [], unchecked: ['mcp:atlassian', 'mcp:slack'] });
  r('source', 'mcp:atlassian', 'ok');
  r('source', 'mcp:slack', 'error', 'auth', 'expired');
  r('source', 'mcp:figma', 'missing');
  assert.deepEqual(tick().sources, { down: [{ name: 'mcp:slack', status: 'error', message: 'auth expired' }], unchecked: [] });
  assert.equal(spawnSync(process.execPath, [CLI, 'source', 'mcp:slack', 'broken'], { env, encoding: 'utf8' }).status, 1);

  // Generic schedules: due until schedule-done records the run.
  assert.deepEqual(tick().schedule.due, ['status']);
  r('schedule-done', 'status', 'posted week 40');
  assert.deepEqual(tick().schedule.due, []);
  assert.match(r('events'), /scheduled: status: posted week 40/);
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
  writeFileSync(join(d, 'LOOP.md'), `---\nport: ${port}\nrequires: cli:node, cli:no-such-bin-xyz, mcp:slack\n---\n# Loop\n## Files\n`);
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
  let sources;
  try {
    ({ orphans, sources } = JSON.parse(r('bootstrap', '--new-session')));
  } finally {
    r('server', 'stop');
  }
  // CLIs are checked here; MCP servers only the session can see.
  assert.deepEqual(sources, { cli: { 'cli:node': 'ok', 'cli:no-such-bin-xyz': 'missing' }, checkMcp: ['mcp:slack'] });
  assert.match(r('sources'), /cli:no-such-bin-xyz\s+missing/);
  // bug-3's chain file is gone: nothing will ever collect it, so it is an orphan too.
  assert.deepEqual(orphans, ['bug-1', 'bug-3']);
  assert.equal(JSON.parse(r('get', 'bug-1')).agent_id, null);
  assert.equal(JSON.parse(r('get', 'bug-3')).agent_id, null);
  assert.equal(JSON.parse(r('get', 'bug-2')).agent_id, 'run:bug-2-1');
});

// ---- T3 Code: the host the loop runs in, and a watch that is safe to start twice.

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((ok) => { const srv = createServer().listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => ok(p)); }); });
}

async function t3Workspace(loopFrontmatter = '') {
  const { chmodSync, mkdirSync, writeFileSync } = await import('node:fs');
  chmodSync(FAKE_T3, 0o755);
  const root = mkdtempSync(join(tmpdir(), 'myday-cli-t3-'));
  const d = join(root, '.my-day');
  mkdirSync(join(root, 'wt', 'web'), { recursive: true });
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'LOOP.md'), `---\nport: ${await freePort()}\n${loopFrontmatter}---\n# Loop\n## Files\n`);
  const env = { ...process.env, MY_DAY_DIR: d, GLAB_BIN: '/usr/bin/false', FAKE_T3_HOME: join(root, 't3-server'), T3_BIN: FAKE_T3 };
  const r = (...a) => execFileSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8' }).trim();
  const t3 = (args, input) => execFileSync(process.execPath, [FAKE_T3, ...args], { env, encoding: 'utf8', input });
  return { root, d, env, r, t3 };
}

test('bootstrap in a T3 Code thread reports the host and the loop thread\'s link, asked for once per session', async () => {
  const { readFileSync } = await import('node:fs');
  const w = await t3Workspace();
  w.t3(['project', 'add', w.root]);
  const { threadId } = JSON.parse(w.t3(['thread', 'start', '--json', w.root, 'start my day']));
  // Inside T3 Code the CLI is named by $T3CODE_CLI_PATH; nothing else points at it here.
  const { T3_BIN: _, ...bare } = w.env;
  const inT3 = { ...bare, CLAUDE_CODE_ENTRYPOINT: 't3-code', T3CODE_THREAD_ID: threadId, T3CODE_CLI_PATH: FAKE_T3 };
  const boot = (env, ...a) => JSON.parse(execFileSync(process.execPath, [CLI, 'bootstrap', ...a], { env, encoding: 'utf8' }));
  const { DatabaseSync } = await import('node:sqlite');
  const meta = () => { const db = new DatabaseSync(join(w.d, 'state.db')); const rows = Object.fromEntries(db.prepare("SELECT key, value FROM meta WHERE key LIKE 'host%'").all().map((x) => [x.key, x.value])); db.close(); return rows; };
  const shows = () => readFileSync(join(w.root, 't3-server', 'calls.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"show"')).length;
  try {
    const b = boot(inT3, '--new-session');
    assert.deepEqual(b.host, { name: 't3', threadId, link: `https://app.t3.codes/threads/fake-env/${encodeURIComponent(threadId)}` });
    // In T3 Code the first bootstrap of a session also checks the t3 CLI and the workspace project.
    assert.deepEqual(b.t3, { bin: FAKE_T3, ok: true, version: 'v0.0.0-fake', workspaceProject: true });
    assert.deepEqual(meta(), { host: 't3', hostThreadId: threadId, hostThreadLink: b.host.link });
    // Later bootstraps of the session reuse the stored link instead of asking t3 again.
    const before = shows();
    assert.equal(boot(inT3).host.link, b.host.link);
    assert.equal(shows(), before);
    // A link t3 could not give is not asked for again until the next session either.
    const down = { ...inT3, FAKE_T3_DOWN: '1' };
    assert.equal(boot(down, '--new-session').host.link, null);
    const failed = shows();
    assert.equal(boot(down).host.link, null);
    assert.equal(boot(inT3).host.link, null);
    assert.equal(shows(), failed);
    assert.equal(boot(inT3, '--new-session').host.link, b.host.link);
    // The same loop started outside T3 Code: no stale thread link.
    assert.deepEqual(boot(bare, '--new-session').host, { name: 'claude-code', threadId: null });
    assert.deepEqual(meta(), { host: 'claude-code', hostThreadId: '', hostThreadLink: '' });
  } finally {
    w.r('server', 'stop');
  }
});

function watcher(w, ...extra) {
  return import('node:child_process').then(({ spawn }) => {
    const p = spawn(process.execPath, [CLI, 'watch', '--interval', '50'], { env: { ...w.env, ...Object.assign({}, ...extra) }, stdio: ['ignore', 'pipe', 'inherit'] });
    p.lines = [];
    p.exited = new Promise((ok) => p.on('exit', (code) => ok(code)));
    let buf = '';
    p.stdout.on('data', (c) => { buf += c; const parts = buf.split('\n'); buf = parts.pop(); p.lines.push(...parts.filter(Boolean).map((l) => JSON.parse(l))); });
    return p;
  });
}
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; ;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((ok) => setTimeout(ok, 25)); } };

test('watch started twice: the new one takes over, the old one says so and ends by itself', async () => {
  const { readFileSync } = await import('node:fs');
  const w = await t3Workspace();
  w.r('upsert', '--type', 'bug', '--ext', 'jira:W-1');
  const lock = join(w.d, 'watch.lock');
  const held = () => { try { return JSON.parse(readFileSync(lock, 'utf8')); } catch { return undefined; } };
  const first = await watcher(w);
  try {
    await until(() => held()?.pid === first.pid);
    w.r('event', 'bug-1', 'dashboard-request', 'one');
    await until(() => first.lines.length === 1);
    w.r('tick'); // the loop acted on it (a watch starts from what tick has not consumed yet)
    const second = await watcher(w);
    try {
      // The old watch ends on its own, with a last line naming who replaced it.
      assert.equal(await first.exited, 0);
      assert.deepEqual(first.lines.at(-1), { kind: 'watch-replaced', by: second.pid });
      await until(() => held()?.pid === second.pid);
      w.r('event', 'bug-1', 'dashboard-request', 'two');
      await until(() => second.lines.some((l) => l.message === 'two'));
      // Each event reached exactly one watch.
      assert.deepEqual(first.lines.filter((l) => l.kind === 'dashboard-request').map((l) => l.message), ['one']);
      assert.deepEqual(second.lines.filter((l) => l.kind === 'dashboard-request').map((l) => l.message), ['two']);
      // A one-shot watch is no takeover.
      w.r('watch', '--once');
      assert.equal(held().pid, second.pid);
    } finally {
      second.kill('SIGTERM');
      await second.exited;
    }
    // A watch that is stopped says so in the lock; it does not delete it.
    assert.equal(held().pid, second.pid);
    assert.ok(held().endedAt);
  } finally {
    first.kill('SIGKILL');
  }
});

test('a watch replaced while busy reports nothing more and never claims the lock back, even after its successor ended', async () => {
  const { chmodSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const w = await t3Workspace();
  w.r('upsert', '--type', 'bug', '--ext', 'jira:W-2');
  // A claude -p chain whose process is gone; `ps` blocks until the test opens the gate, so the first
  // watch is busy looking at runs while it is replaced.
  mkdirSync(join(w.d, 'runs'), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(w.d, 'runs', 'bug-1-1.json'), JSON.stringify({ id: 'bug-1-1', item: 'bug-1', status: 'running', startedAt: now, steps: [{ repo: 'web', status: 'running', pid: 999999, lstart: 'x', startedAt: now }] }));
  const ps = join(w.root, 'slow-ps');
  const gate = join(w.root, 'ps-gate');
  writeFileSync(ps, `#!/bin/sh\nwhile [ ! -f ${gate} ]; do sleep 0.05; done\nexit 1\n`);
  chmodSync(ps, 0o755);
  const lock = join(w.d, 'watch.lock');
  const held = () => { try { return JSON.parse(readFileSync(lock, 'utf8')); } catch { return undefined; } };
  const first = await watcher(w, { MY_DAY_PS: ps });
  try {
    await until(() => held()?.pid === first.pid);
    // A second watch takes over (its own `ps` answers at once) and is stopped again, all while the
    // first one is still waiting for `ps`.
    const second = await watcher(w);
    await until(() => held()?.pid === second.pid, 10_000);
    second.kill('SIGTERM');
    await second.exited;
    assert.ok(held().endedAt);
    writeFileSync(gate, '');
    assert.equal(await first.exited, 0);
    // No run-finished from the old watch (the next watch reports it), and no claim on the lock.
    assert.deepEqual(first.lines, [{ kind: 'watch-replaced', by: second.pid }]);
    assert.equal(held().pid, second.pid);
  } finally {
    writeFileSync(gate, '');
    first.kill('SIGKILL');
  }
});

// ---- runner: t3 through the CLI.

const callsOf = async (w, verb) => {
  const { existsSync, readFileSync } = await import('node:fs');
  const f = join(w.root, 't3-server', 'calls.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.argv.slice(0, 2).join(' ') === verb).length : 0;
};

test('runner: t3 makes the t3 CLI a source, checked once per session: ok, down with the reason, or missing', async () => {
  const w = await t3Workspace('runner: t3\n');
  const boot = (env, ...a) => JSON.parse(execFileSync(process.execPath, [CLI, 'bootstrap', ...a], { env, encoding: 'utf8' }));
  try {
    const ok = boot(w.env, '--new-session');
    assert.deepEqual(ok.sources.cli, { 'cli:t3': 'ok' });
    // Not a T3 project yet: setup offers to register it.
    assert.equal(ok.t3.workspaceProject, false);
    assert.equal(ok.host.name, 'claude-code');
    // Later bootstraps of the session keep that answer instead of asking t3 again.
    const asked = await callsOf(w, 'thread list');
    const again = boot({ ...w.env, FAKE_T3_DOWN: '1' });
    assert.deepEqual([again.sources.cli, again.t3], [{ 'cli:t3': 'ok' }, undefined]);
    assert.equal(await callsOf(w, 'thread list'), asked);
    const down = boot({ ...w.env, FAKE_T3_DOWN: '1' }, '--new-session');
    assert.deepEqual(down.sources.cli, { 'cli:t3': 'error' });
    assert.match(down.t3.error, /No running T3 Code server/);
    assert.match(w.r('sources'), /cli:t3\s+error.*No running T3 Code server/);
    assert.deepEqual(JSON.parse(w.r('tick')).sources.down.map((x) => x.name), ['cli:t3']);
    assert.deepEqual(boot({ ...w.env, T3_BIN: '/nonexistent/t3' }, '--new-session').sources.cli, { 'cli:t3': 'missing' });
    // Outside T3 Code and without runner: t3 nothing asks t3.
    const plain = await t3Workspace();
    const before = await callsOf(plain, 'thread list');
    assert.equal(boot(plain.env, '--new-session').t3, undefined);
    assert.equal(await callsOf(plain, 'thread list'), before);
    plain.r('server', 'stop');
  } finally {
    w.r('server', 'stop');
  }
});

test('t3 check / register, and t3 remove only for a worker worktree the runner registered', async () => {
  const w = await t3Workspace('runner: t3\n');
  const wt = join(w.root, 'wt', 'web');
  const fails = (...a) => spawnSync(process.execPath, [CLI, ...a], { env: w.env, encoding: 'utf8' });
  let c = JSON.parse(w.r('t3', 'check', wt));
  assert.deepEqual([c.ok, c.projects], [true, { [w.root]: false, [wt]: false }]);
  assert.deepEqual(JSON.parse(w.r('t3', 'register', w.root, '--title', 'client-a')), { registered: w.root, added: true });
  assert.deepEqual(JSON.parse(w.r('t3', 'register', w.root)), { registered: w.root, added: false });
  c = JSON.parse(w.r('t3', 'check', wt));
  assert.deepEqual(c.projects, { [w.root]: true, [wt]: true });
  // The workspace (or a folder holding it) and a folder my-day did not register are never removed.
  for (const target of [w.root, join(w.root, '..')]) assert.match(fails('t3', 'remove', target).stderr, /is the workspace or holds it/);
  assert.match(fails('t3', 'remove', wt).stderr, /is not a T3 project the t3 runner registered/);
  // A worker on the worktree registers it; while its chain runs the project stays.
  w.r('upsert', '--type', 'bug', '--ext', 'jira:RM-1');
  execFileSync(process.execPath, [CLI, 'run', 'bug-1', '--kind', 'bug', '--chain', `web=${wt}`], { env: w.env, encoding: 'utf8', input: 'ok\n' });
  assert.match(fails('t3', 'remove', wt).stderr, /is still used by bug-1-1/);
  w.r('tick');
  assert.deepEqual(JSON.parse(w.r('t3', 'remove', wt)), { removed: wt });
  assert.match(fails('t3', 'remove', wt).stderr, /my-day: ProjectNotFoundError: No active project found/);
  // The workspace project and its threads are still there.
  assert.equal(JSON.parse(w.r('t3', 'check')).projects[w.root], true);
  // With t3Project: containing the worktrees are no projects of their own: nothing to remove.
  const { writeFileSync, readFileSync } = await import('node:fs');
  writeFileSync(join(w.d, 'LOOP.md'), readFileSync(join(w.d, 'LOOP.md'), 'utf8').replace('runner: t3', 'runner: t3\nt3Project: containing'));
  assert.match(fails('t3', 'remove', wt).stderr, /t3Project is containing/);
});

test('run as T3 threads → watch reports the finished thread → tick collects it; runs and show carry the link', async () => {
  const w = await t3Workspace('runner: t3\nt3Model: claude-opus-5-5\nt3ModelBug: claude-sonnet-5-5\n');
  w.r('upsert', '--type', 'bug', '--ext', 'jira:RUN-9', '--title', 'Totals are off');
  const run = (task, ...extra) => JSON.parse(execFileSync(process.execPath, [CLI, 'run', 'bug-1', '--kind', 'bug', '--chain', `web=${join(w.root, 'wt', 'web')}`, '--status', 'developing', ...extra], { env: w.env, encoding: 'utf8', input: `${task}\n` }));
  const started = run('ok');
  assert.equal(started.started.repo, 'web');
  const link = `https://app.t3.codes/threads/fake-env/${encodeURIComponent(started.started.thread)}`;
  assert.equal(JSON.parse(w.r('get', 'bug-1')).agent_id, `run:${started.chain}`);
  const thread = Object.values(JSON.parse((await import('node:fs')).readFileSync(join(w.root, 't3-server', 'state.json'), 'utf8')).threads)[0];
  assert.deepEqual([thread.title, thread.provider, thread.model], [`RUN-9 bug · web (${started.chain}): Totals are off`, 'claudeAgent', 'claude-sonnet-5-5']);
  assert.match(w.r('runs'), new RegExp(`bug-1-1\\s+running\\s+web running\\n  web: ${started.started.thread}`));
  assert.deepEqual(w.r('watch', '--once').split('\n').filter(Boolean).map((l) => JSON.parse(l)), [{ kind: 'run-finished', item: 'bug-1', chain: started.chain }]);
  const t = JSON.parse(w.r('tick'));
  assert.deepEqual(t.runs.finished.map((f) => [f.item, f.next]), [['bug-1', 'advance']]);
  assert.deepEqual([t.runs.waiting, t.runs.stillRunning], [[], []]);
  assert.equal(JSON.parse(w.r('get', 'bug-1')).agent_id, null);
  // From the first look at the thread on, its link is in `runs` and among the item's links.
  assert.match(w.r('runs'), new RegExp(`  web: ${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(w.r('show', 'bug-1'), /\[thread\] web worker \(attempt 1\) https:\/\/app\.t3\.codes/);

  // A worker that asks: watch and tick both say so, with the thread to open; run-stop is honest.
  const asked = run('ask');
  const askedLink = `https://app.t3.codes/threads/fake-env/${encodeURIComponent(asked.started.thread)}`;
  const line = w.r('watch', '--once').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(line, [{ kind: 'run-waiting', item: 'bug-1', chain: asked.chain, repo: 'web', link: askedLink }]);
  assert.deepEqual(JSON.parse(w.r('tick')).runs.waiting.map((x) => [x.item, x.repo, x.link]), [['bug-1', 'web', askedLink]]);
  assert.match(w.r('runs'), /\(waiting for your answer\)/);
  const stopped = JSON.parse(w.r('run-stop', 'bug-1'));
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.stillRunning[0].link, askedLink);
  assert.match(w.r('runs'), /bug-1-2\s+stopped\s+web stopped\n  web: \S+  \(let go of; may still be running\)/);
  // That thread still waits in the worktree: a new run there is refused, naming it, until --force.
  const refused = spawnSync(process.execPath, [CLI, 'run', 'bug-1', '--kind', 'bug', '--chain', `web=${join(w.root, 'wt', 'web')}`, '--task', 'ok'], { env: w.env, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(`my-day: not started: the web worker of ${asked.chain} is still waiting in its T3 thread: ${askedLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Stop it in T3 Code first, or run again with --force\\.`));
  assert.ok(run('ok', '--force').started);

  // --runner overrides the setting for one run; an unknown one is refused.
  const bad = spawnSync(process.execPath, [CLI, 'run', 'bug-1', '--kind', 'bug', '--chain', `web=${join(w.root, 'wt', 'web')}`, '--runner', 'nope', '--task', 'ok'], { env: w.env, encoding: 'utf8' });
  assert.match(bad.stderr, /unknown runner nope/);
});

test('watch: a finished step is reported once, also after its chain moved on to the next repo', async () => {
  const w = await t3Workspace('runner: t3\nt3PollSeconds: 3600\nworkingHours: 00:00-24:00\nworkingDays: Sun-Sat\n');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(w.root, 'wt', 'api'), { recursive: true });
  w.r('upsert', '--type', 'bug', '--ext', 'jira:W-3');
  // api reports at once; web keeps working. Threads are asked about once (t3PollSeconds), so the
  // watch keeps its first answer while the tick moves the chain on.
  const started = JSON.parse(execFileSync(process.execPath, [CLI, 'run', 'bug-1', '--kind', 'bug', '--chain', `api=${join(w.root, 'wt', 'api')},web=${join(w.root, 'wt', 'web')}`], { env: w.env, encoding: 'utf8', input: 'ok\n' }));
  const watch = await watcher(w);
  try {
    await until(() => watch.lines.length === 1);
    assert.deepEqual(watch.lines, [{ kind: 'run-finished', item: 'bug-1', chain: started.chain }]);
    const t = JSON.parse(w.r('tick'));
    assert.deepEqual(t.runs.started.map((s) => s.repo), ['web']);
    await new Promise((ok) => setTimeout(ok, 400));
    assert.deepEqual(watch.lines.map((l) => l.kind), ['run-finished']);
  } finally {
    watch.kill('SIGTERM');
    await watch.exited;
  }
});
