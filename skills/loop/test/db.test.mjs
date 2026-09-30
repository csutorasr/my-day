import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../lib/db.mjs';

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'myday-db-'));
  return { dir, file: join(dir, 'state.db'), db: S.openDb(join(dir, 'state.db')) };
};

test('ids are allocated per type and never reused', () => {
  const { db } = fresh();
  assert.equal(S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-1' }).id, 'bug-1');
  assert.equal(S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-2' }).id, 'bug-2');
  assert.equal(S.upsertItem(db, { type: 'mr', ext: 'gitlab:a!1' }).id, 'mr-1');
  assert.throws(() => S.upsertItem(db, { type: 'nope', ext: 'x' }), /unknown type/);
});

test('upsert is idempotent by ext key', () => {
  const { db } = fresh();
  const a = S.upsertItem(db, { type: 'story', ext: 'jira:ABC-9', title: 'Old' });
  const b = S.upsertItem(db, { type: 'story', ext: 'jira:ABC-9', title: 'New' });
  assert.equal(a.id, b.id);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(S.getItem(db, a.id).title, 'New');
  assert.equal(S.listItems(db).length, 1);
});

test('setFields merges data and logs status changes', () => {
  const { db } = fresh();
  const { id } = S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-3', data: { a: 1 } });
  S.setFields(db, id, { status: 'attempting', branch: 'fix/ABC-3', 'data.b': 2 });
  const it = S.getItem(db, id);
  assert.equal(it.status, 'attempting');
  assert.equal(it.branch, 'fix/ABC-3');
  assert.deepEqual(it.data, { a: 1, b: 2 });
  assert.ok(S.listEvents(db, { itemId: id }).some((e) => e.kind === 'status' && /new → attempting/.test(e.message)));
  assert.throws(() => S.setFields(db, id, { evil: 1 }), /unknown field/);
  assert.throws(() => S.setFields(db, 'bug-99', { status: 'x' }), /no item/);
});

test('upsert and set accept repos as array or comma string', () => {
  const { db } = fresh();
  const { id } = S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-7', repos: 'api, web' });
  assert.deepEqual(S.getItem(db, id).repos, ['api', 'web']);
  S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-7', repos: 'api' });
  assert.deepEqual(S.getItem(db, id).repos, ['api']);
  assert.deepEqual(S.setFields(db, id, { repos: 'a,b' }).repos, ['a', 'b']);
  assert.deepEqual(S.setFields(db, id, { repos: '' }).repos, []);
});

test('deleteItem removes the item and its links, detaches children and questions', () => {
  const { db } = fresh();
  const parent = S.upsertItem(db, { type: 'story', ext: 'jira:ABC-1' }).id;
  const child = S.upsertItem(db, { type: 'subtask', ext: 'jira:ABC-2', parent }).id;
  S.addLink(db, parent, { kind: 'mr', url: 'https://example.invalid/1' });
  const q = S.ask(db, parent, 'q?');
  S.deleteItem(db, parent);
  assert.equal(S.getItem(db, parent), null);
  assert.equal(S.getItem(db, child).parent_id, null);
  assert.equal(S.listQuestions(db).find((x) => x.id === q).item_id, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM links').get().n, 0);
  assert.throws(() => S.deleteItem(db, parent));
});

test('fail / unfail and attempts', () => {
  const { db } = fresh();
  const { id } = S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-4' });
  S.incAttempts(db, id);
  S.fail(db, id, 'tests red');
  let it = S.getItem(db, id);
  assert.equal(it.failed, true);
  assert.equal(it.fail_reason, 'tests red');
  assert.equal(it.attempts, 1);
  assert.equal(S.listItems(db, { failed: true }).length, 1);
  S.unfail(db, id);
  it = S.getItem(db, id);
  assert.equal(it.failed, false);
  assert.equal(it.fail_reason, null);
});

test('links are unique per url and show hint appears without links', () => {
  const { db } = fresh();
  const { id } = S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-5' });
  assert.match(S.showItem(db, id).hint, /elaborate bug-1/);
  S.addLink(db, id, { kind: 'mr', url: 'https://g/1', label: '!1' });
  S.addLink(db, id, { kind: 'mr', url: 'https://g/1', label: 'dup' });
  const shown = S.showItem(db, id);
  assert.equal(shown.links.length, 1);
  assert.equal(shown.hint, null);
});

test('questions lifecycle', () => {
  const { db } = fresh();
  const { id } = S.upsertItem(db, { type: 'story', ext: 'jira:ABC-6' });
  const q = S.ask(db, id, 'Take it next?');
  assert.equal(q, 'q-1');
  assert.equal(S.listQuestions(db, { status: 'open' }).length, 1);
  S.answer(db, q, 'yes');
  assert.equal(S.listQuestions(db, { status: 'open' }).length, 0);
  const q2 = S.ask(db, id, 'Again?');
  S.decline(db, q2);
  assert.equal(S.listQuestions(db, { status: 'declined' })[0].id, 'q-2');
});

test('events range, summary and prune', () => {
  const { db } = fresh();
  const { id } = S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-7' });
  S.addEvent(db, { itemId: id, kind: 'note', message: 'old', ts: '2026-01-01T10:00:00.000Z' });
  S.addEvent(db, { itemId: id, kind: 'note', message: 'new', ts: '2026-09-29T10:00:00.000Z' });
  const inRange = S.listEvents(db, { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' });
  assert.deepEqual(inRange.filter((e) => e.kind === 'note').map((e) => e.message), ['new']);
  const sum = S.summary(db, { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' });
  assert.equal(sum.events.filter((e) => e.kind === 'note').length, 1);
  assert.ok(sum.byStatus.new >= 1);
  const removed = S.prune(db, 30, new Date('2026-09-29T12:00:00Z'));
  assert.ok(removed >= 1);
  assert.ok(!S.listEvents(db, {}).some((e) => e.message === 'old'));
});

test('two connections write concurrently', () => {
  const { file, db } = fresh();
  const db2 = S.openDb(file);
  for (let i = 0; i < 50; i++) {
    S.upsertItem(db, { type: 'mr', ext: `gitlab:a!${i}` });
    S.addEvent(db2, { kind: 'note', message: `n${i}` });
  }
  assert.equal(S.listItems(db2, { type: 'mr' }).length, 50);
});

test('subscriptions', () => {
  const { db } = fresh();
  S.addSubscription(db, { endpoint: 'https://p/1', keys: {} });
  S.addSubscription(db, { endpoint: 'https://p/1', keys: { a: 1 } });
  assert.equal(S.listSubscriptions(db).length, 1);
  S.removeSubscription(db, 'https://p/1');
  assert.equal(S.listSubscriptions(db).length, 0);
});
