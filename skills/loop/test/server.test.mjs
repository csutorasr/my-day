import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import * as S from '../lib/db.mjs';
import * as ctl from '../lib/serverctl.mjs';

const dir = mkdtempSync(join(tmpdir(), 'myday-srv-'));
const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
const port = await freePort();
const db = S.openDb(join(dir, 'state.db'));
const { id: reviewId } = S.upsertItem(db, { type: 'review', ext: 'gitlab:x!1', title: 'Review me', url: 'https://g/x/1' });
S.upsertItem(db, { type: 'review', ext: 'gitlab:x!2', title: 'Handled by others', status: 'covered' });
const base = `http://127.0.0.1:${port}`;
after(() => ctl.stop(dir));

test('starts, reports health and push flag', async () => {
  const s = await ctl.start(dir, { port });
  assert.equal(s.running, true);
  const h = await (await fetch(`${base}/health`)).json();
  assert.equal(h.dir, dir);
  assert.equal(typeof h.push, 'boolean');
  const again = await ctl.start(dir, { port });
  assert.equal(again.started, false);
});

test('state lists the open review, not covered ones', async () => {
  const st = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(st.reviews.map((r) => r.id), [reviewId]);
});

test('state exposes the closed statuses, including ignored', async () => {
  const st = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(st.closedStatuses, S.CLOSED_STATUSES);
  assert.ok(st.closedStatuses.includes('ignored'));
});

test('cross-origin POST is rejected', async () => {
  const r = await fetch(`${base}/api/reviews/${reviewId}/done`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('review done from dashboard updates the DB', async () => {
  const r = await fetch(`${base}/api/reviews/${reviewId}/done`, { method: 'POST', headers: { origin: base } });
  assert.equal(r.status, 200);
  assert.equal(S.getItem(db, reviewId).status, 'done');
});

test('answering a question from the dashboard closes it and logs a dashboard event', async () => {
  const qid = S.ask(db, reviewId, 'Approve: rebase?');
  const st = await (await fetch(`${base}/api/state`)).json();
  assert.equal(st.questions.find((q) => q.id === qid).item.id, reviewId);
  const empty = await fetch(`${base}/api/questions/${qid}/answer`, { method: 'POST', headers: { origin: base }, body: '{}' });
  assert.equal(empty.status, 400);
  const r = await fetch(`${base}/api/questions/${qid}/answer`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'yes' }) });
  assert.equal(r.status, 200);
  assert.equal(S.listQuestions(db, { status: 'answered' }).find((q) => q.id === qid).answer, 'yes');
  const ev = S.listEvents(db, { limit: 5 }).find((e) => e.kind === 'dashboard-answer');
  assert.equal(ev.data.questionId, qid);
  const again = await fetch(`${base}/api/questions/${qid}/decline`, { method: 'POST', headers: { origin: base } });
  assert.equal(again.status, 404);
});

test('quick-action requests are validated and logged, never executed', async () => {
  const bad = await fetch(`${base}/api/items/${reviewId}/request`, { method: 'POST', headers: { origin: base }, body: JSON.stringify({ action: 'rm -rf' }) });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${base}/api/items/mr-404/request`, { method: 'POST', headers: { origin: base }, body: JSON.stringify({ action: 'rebase' }) });
  assert.equal(missing.status, 404);
  const ok = await fetch(`${base}/api/items/${reviewId}/request`, { method: 'POST', headers: { origin: base }, body: JSON.stringify({ action: 'elaborate' }) });
  assert.equal(ok.status, 200);
  assert.equal(S.listEvents(db, { limit: 1 })[0].data.action, 'elaborate');
  const cross = await fetch(`${base}/api/items/${reviewId}/request`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ action: 'rebase' }) });
  assert.equal(cross.status, 403);
});

test('pause and resume from the dashboard set the paused flag', async () => {
  await fetch(`${base}/api/loop/pause`, { method: 'POST', headers: { origin: base } });
  assert.equal((await (await fetch(`${base}/api/state`)).json()).loop.paused, true);
  await fetch(`${base}/api/loop/resume`, { method: 'POST', headers: { origin: base } });
  assert.equal(S.getMeta(db, 'paused'), 'false');
});

test('stale pid is replaced', async () => {
  await ctl.stop(dir);
  writeFileSync(join(dir, 'server.pid'), JSON.stringify({ pid: 999999, port }));
  const s = await ctl.start(dir, { port });
  assert.equal(s.started, true);
});

test('a server running other code (older install / moved folder) is replaced', async () => {
  const { cpSync } = await import('node:fs');
  const here = join(dirname(fileURLToPath(import.meta.url)), '..');
  const copy = join(mkdtempSync(join(tmpdir(), 'myday-old-')), 'loop');
  cpSync(here, copy, { recursive: true, filter: (p) => !p.includes('/test/') });
  const oldCtl = await import(join(copy, 'lib', 'serverctl.mjs'));
  await ctl.stop(dir);
  await oldCtl.start(dir, { port });
  const s = await ctl.start(dir, { port });
  assert.equal(s.started, true);
  const h = await (await fetch(`${base}/health`)).json();
  assert.equal(h.code, join(here, 'server', 'server.mjs'));
  assert.equal((await fetch(`${base}/`)).status, 200);
});
