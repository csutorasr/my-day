import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import * as S from '../lib/db.mjs';
import * as ctl from '../lib/serverctl.mjs';

import { forget, loopId, register } from '../lib/home.mjs';

// One machine home with three registered loops: client-a (running), client-b (stopped) and gone
// (its folder was deleted). Both stores hold a bug-1, so routing by loop is visible.
const home = mkdtempSync(join(tmpdir(), 'myday-srv-home-'));
const wsA = join(mkdtempSync(join(tmpdir(), 'myday-srv-')), 'client-a', '.my-day');
const wsB = join(mkdtempSync(join(tmpdir(), 'myday-srv-')), 'client-b', '.my-day');
const wsGone = join(tmpdir(), `myday-srv-gone-${process.pid}`, 'gone', '.my-day');
for (const d of [wsA, wsB]) mkdirSync(d, { recursive: true });
const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
const port = await freePort();
const db = S.openDb(join(wsA, 'state.db'));
const dbB = S.openDb(join(wsB, 'state.db'));
S.upsertItem(db, { type: 'bug', ext: 'jira:A-1', title: 'A bug' });
S.upsertItem(dbB, { type: 'bug', ext: 'jira:B-1', title: 'B bug' });
const { id: reviewId } = S.upsertItem(db, { type: 'review', ext: 'gitlab:x!1', title: 'Review me', url: 'https://g/x/1' });
S.upsertItem(db, { type: 'review', ext: 'gitlab:x!2', title: 'Handled by others', status: 'covered' });
S.setMeta(db, 'sessionStartedAt', new Date().toISOString());
S.setMeta(dbB, 'sessionStartedAt', new Date(Date.now() - 3600_000).toISOString());
S.setMeta(dbB, 'stoppedAt', new Date(Date.now() - 1800_000).toISOString());
const idA = register(home, wsA).id;
const idB = register(home, wsB).id;
register(home, wsGone);
const base = `http://127.0.0.1:${port}`;
const loopBase = `${base}/api/loops/${idA}`;
const get = async (p) => (await fetch(`${base}${p}`)).json();
const post = (p, payload, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
const stateA = async () => (await get(`/api/state?loops=${idA}`)).loops[0];
after(() => ctl.stop(home));

test('starts, reports health and push flag', async () => {
  const s = await ctl.start(home, { port });
  assert.equal(s.running, true);
  const h = await (await fetch(`${base}/health`)).json();
  assert.equal(h.home, home);
  assert.equal(typeof h.push, 'boolean');
  const again = await ctl.start(home, { port });
  assert.equal(again.started, false);
});

test('/api/loops lists every registered loop with liveness, and an error for a missing store', async () => {
  const loops = await get('/api/loops');
  assert.deepEqual(loops.map((l) => [l.name, l.running, l.stopped]), [['client-a', true, false], ['client-b', false, true], ['gone', false, false]]);
  assert.match(loops.find((l) => l.name === 'gone').error, /no store/);
  assert.deepEqual(loops.find((l) => l.name === 'client-a').counts, { questions: 0, failed: 0, reviews: 1 });
});

test('/api/state defaults to the running loops; ?loops picks any', async () => {
  assert.deepEqual((await get('/api/state')).loops.map((l) => l.name), ['client-a']);
  const both = await get(`/api/state?loops=${idA},${idB}`);
  assert.deepEqual(both.loops.map((l) => [l.id, l.name]), [[idA, 'client-a'], [idB, 'client-b']]);
  assert.equal(both.loops[1].stopped, true);
});

test('a loop registered while the server runs shows up', async () => {
  const wsC = join(mkdtempSync(join(tmpdir(), 'myday-srv-')), 'client-c', '.my-day');
  mkdirSync(wsC, { recursive: true });
  S.openDb(join(wsC, 'state.db')).close();
  register(home, wsC);
  let names = [];
  for (let i = 0; i < 80 && !names.includes('client-c'); i++) {
    names = (await get('/api/loops')).map((l) => l.name);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(names.includes('client-c'));
  forget(home, wsC);
});

test('a scoped answer writes only to that loop, although both have the same question id', async () => {
  const qa = S.ask(db, 'bug-1', 'Take it?');
  const qb = S.ask(dbB, 'bug-1', 'Take it?');
  assert.equal(qa, qb);
  assert.equal((await post(`/api/loops/${idB}/questions/${qb}/answer`, { text: 'yes' })).status, 200);
  assert.equal(S.listQuestions(dbB, { status: 'answered' }).find((q) => q.id === qb).answer, 'yes');
  assert.ok(S.listQuestions(db, { status: 'open' }).some((q) => q.id === qa));
  S.decline(db, qa);
});

test('an unknown loop is 404; a loop without a store is 404 with its error', async () => {
  assert.equal((await post('/api/loops/0123456789ab/pause')).status, 404);
  const gone = await post(`/api/loops/${loopId(wsGone)}/pause`);
  assert.equal(gone.status, 404);
  assert.match((await gone.json()).error, /no store/);
});

test('a store that breaks after it was opened is reported on its loop; the others keep working', async () => {
  const wsD = join(mkdtempSync(join(tmpdir(), 'myday-srv-')), 'client-d', '.my-day');
  mkdirSync(wsD, { recursive: true });
  const dbD = S.openDb(join(wsD, 'state.db'));
  S.upsertItem(dbD, { type: 'bug', ext: 'jira:D-1' });
  S.setMeta(dbD, 'sessionStartedAt', new Date().toISOString());
  dbD.close();
  register(home, wsD);
  for (let i = 0; i < 80 && !(await get('/api/loops')).some((l) => l.name === 'client-d' && l.running); i++) await new Promise((r) => setTimeout(r, 100));
  // Overwrite the file in place: the server's open handle now reads garbage. (Leave -shm alone: it is
  // memory-mapped, and truncating it kills the process with SIGBUS, which no JS code can catch.)
  writeFileSync(join(wsD, 'state.db'), Buffer.alloc(8192, 7));
  await new Promise((r) => setTimeout(r, 1500)); // a poll round runs against the broken store
  const res = await fetch(`${base}/api/loops`);
  assert.equal(res.status, 200);
  const loopsNow = await res.json();
  assert.match(loopsNow.find((l) => l.name === 'client-d').error, /./);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await stateA()).name, 'client-a');
  forget(home, wsD);
});

test('state lists the open review, not covered ones', async () => {
  const st = await stateA();
  assert.deepEqual(st.reviews.map((r) => r.id), [reviewId]);
});

test('state exposes the closed statuses, including ignored', async () => {
  const st = await stateA();
  assert.deepEqual(st.closedStatuses, S.CLOSED_STATUSES);
  assert.ok(st.closedStatuses.includes('ignored'));
});

test('cross-origin POST is rejected', async () => {
  const r = await fetch(`${loopBase}/reviews/${reviewId}/done`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('review done from dashboard updates the DB', async () => {
  const r = await fetch(`${loopBase}/reviews/${reviewId}/done`, { method: 'POST', headers: { origin: base } });
  assert.equal(r.status, 200);
  assert.equal(S.getItem(db, reviewId).status, 'done');
});

test('answering a question from the dashboard closes it and logs a dashboard event', async () => {
  const qid = S.ask(db, reviewId, 'Approve: rebase?');
  const st = await stateA();
  assert.equal(st.questions.find((q) => q.id === qid).item.id, reviewId);
  const empty = await fetch(`${loopBase}/questions/${qid}/answer`, { method: 'POST', headers: { origin: base }, body: '{}' });
  assert.equal(empty.status, 400);
  const r = await fetch(`${loopBase}/questions/${qid}/answer`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'yes' }) });
  assert.equal(r.status, 200);
  assert.equal(S.listQuestions(db, { status: 'answered' }).find((q) => q.id === qid).answer, 'yes');
  const ev = S.listEvents(db, { limit: 5 }).find((e) => e.kind === 'dashboard-answer');
  assert.equal(ev.data.questionId, qid);
  const again = await fetch(`${loopBase}/questions/${qid}/decline`, { method: 'POST', headers: { origin: base } });
  assert.equal(again.status, 404);
});

test('declining from the dashboard keeps the optional reason for the loop', async () => {
  const withReason = S.ask(db, reviewId, 'Approve: force-push?');
  const r = await fetch(`${loopBase}/questions/${withReason}/decline`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'wait for the release' }) });
  assert.equal(r.status, 200);
  assert.equal(S.listQuestions(db, { status: 'declined' }).find((q) => q.id === withReason).answer, 'wait for the release');
  const ev = S.listEvents(db, { limit: 5 }).find((e) => e.kind === 'dashboard-answer' && e.data.questionId === withReason);
  assert.deepEqual([ev.data.status, ev.data.text], ['declined', 'wait for the release']);
  assert.match(ev.message, /declined on dashboard: wait for the release/);

  const bare = S.ask(db, reviewId, 'Approve: merge?');
  assert.equal((await fetch(`${loopBase}/questions/${bare}/decline`, { method: 'POST', headers: { origin: base } })).status, 200);
  assert.equal(S.listQuestions(db, { status: 'declined' }).find((q) => q.id === bare).answer, null);
});

test('quick-action requests are validated and logged, never executed', async () => {
  const bad = await fetch(`${loopBase}/items/${reviewId}/request`, { method: 'POST', headers: { origin: base }, body: JSON.stringify({ action: 'rm -rf' }) });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${loopBase}/items/mr-404/request`, { method: 'POST', headers: { origin: base }, body: JSON.stringify({ action: 'rebase' }) });
  assert.equal(missing.status, 404);
  const ok = await fetch(`${loopBase}/items/${reviewId}/request`, { method: 'POST', headers: { origin: base }, body: JSON.stringify({ action: 'elaborate' }) });
  assert.equal(ok.status, 200);
  assert.equal(S.listEvents(db, { limit: 1 })[0].data.action, 'elaborate');
  const cross = await fetch(`${loopBase}/items/${reviewId}/request`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ action: 'rebase' }) });
  assert.equal(cross.status, 403);
});

test('pause and resume from the dashboard set the paused flag', async () => {
  await fetch(`${loopBase}/pause`, { method: 'POST', headers: { origin: base } });
  assert.equal((await stateA()).loop.paused, true);
  await fetch(`${loopBase}/resume`, { method: 'POST', headers: { origin: base } });
  assert.equal(S.getMeta(db, 'paused'), 'false');
});

test('serves the built dashboard: page, its hashed assets and the service worker', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /<div id="root"><\/div>/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(assets.some((a) => a.endsWith('.js')) && assets.some((a) => a.endsWith('.css')), 'page links its JS and CSS bundle');
  for (const a of assets) {
    const r = await fetch(`${base}${a}`);
    assert.equal(r.status, 200, a);
    assert.match(r.headers.get('cache-control'), /immutable/);
  }
  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
});

test('does not serve anything else from the public folder', async () => {
  for (const p of ['/.build-hash', '/assets/../../server.mjs', '/%2e%2e/server.mjs', '/index.htm', '/assets/missing.js']) {
    assert.equal((await fetch(`${base}${p}`)).status, 404, p);
  }
});

test('stale pid is replaced', async () => {
  await ctl.stop(home);
  writeFileSync(join(home, 'server.pid'), JSON.stringify({ pid: 999999, port }));
  const s = await ctl.start(home, { port });
  assert.equal(s.started, true);
});

test('a server running other code (older install / moved folder) is replaced', async () => {
  const { cpSync } = await import('node:fs');
  const here = join(dirname(fileURLToPath(import.meta.url)), '..');
  const copy = join(mkdtempSync(join(tmpdir(), 'myday-old-')), 'loop');
  cpSync(here, copy, { recursive: true, filter: (p) => !p.includes('/test/') });
  const oldCtl = await import(join(copy, 'lib', 'serverctl.mjs'));
  await ctl.stop(home);
  await oldCtl.start(home, { port });
  const s = await ctl.start(home, { port });
  assert.equal(s.started, true);
  const h = await (await fetch(`${base}/health`)).json();
  assert.equal(h.code, join(here, 'server', 'server.mjs'));
  assert.equal((await fetch(`${base}/`)).status, 200);
});

// The dashboard before 0.8 ran per workspace and answered /health with its `dir`.
const OLD_SERVER = `require('node:http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ ok: true, dir: '/x/.my-day', pid: process.pid })); }).listen(Number(process.argv[1]), '127.0.0.1')`;

test('start takes over an old per-workspace server holding the port', async () => {
  const { spawn } = await import('node:child_process');
  const port2 = await freePort();
  const home2 = mkdtempSync(join(tmpdir(), 'myday-srv-home-'));
  const old = spawn(process.execPath, ['-e', OLD_SERVER, String(port2)], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${port2}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    const s = await ctl.start(home2, { port: port2 });
    assert.equal(s.running, true);
    assert.equal((await (await fetch(`http://127.0.0.1:${port2}/health`)).json()).home, home2);
  } finally {
    old.kill();
    await ctl.stop(home2);
  }
});
