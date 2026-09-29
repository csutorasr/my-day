import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../lib/db.mjs';
import { schedule, inWorkingHours } from '../lib/schedule.mjs';
import { verdict } from '../lib/gates.mjs';
import { extFromUrl } from '../lib/forge/url.mjs';
import { sync } from '../lib/sync.mjs';
import { DEFAULTS } from '../lib/config.mjs';

const settings = { ...DEFAULTS, tracker: 'jira', forge: 'gitlab', group: 'g/', reviewBatchNotify: 1 };

test('schedule: outside hours caps at an hour and blocks dispatch', () => {
  const night = new Date(2026, 8, 29, 23, 30); // Tue
  const s = schedule(settings, 0, night);
  assert.equal(s.inHours, false);
  assert.equal(s.freeSlots, 0);
  assert.equal(s.delaySeconds, 3600);
  const lateEve = new Date(2026, 9, 1, 7, 45); // Thu 07:45 → 15 min to window
  assert.equal(schedule(settings, 0, lateEve).delaySeconds, 900);
});

test('schedule: weekend and busy/idle cadence', () => {
  assert.equal(inWorkingHours(settings, new Date(2026, 9, 3, 10, 0)), false); // Sat
  const day = new Date(2026, 8, 30, 10, 0);
  assert.deepEqual([schedule(settings, 2, day).freeSlots, schedule(settings, 2, day).delaySeconds], [1, 1800]);
  assert.equal(schedule(settings, 0, day).delaySeconds, 1200);
});

const base = { target: 'main', draft: false, approved: true, unresolved: [], pipeline: { status: 'success' }, mergeStatus: 'mergeable', hasConflicts: false };
test('gates: verdicts', () => {
  assert.equal(verdict(base).action, 'merge');
  assert.equal(verdict({ ...base, approved: false, unresolved: [{}] }).action, 'fix-review');
  assert.equal(verdict({ ...base, pipeline: { status: 'failed' } }).action, 'fix-pipeline');
  assert.equal(verdict({ ...base, mergeStatus: 'need_rebase' }).action, 'rebase');
  assert.equal(verdict({ ...base, draft: true, mergeStatus: 'need_rebase' }).action, 'wait');
  assert.equal(verdict({ ...base, approved: false }).action, 'wait');
  assert.equal(verdict({ ...base, target: 'dev' }).action, 'wait');
});

test('url → ext', () => {
  assert.equal(extFromUrl('https://gitlab.example/a/b/c/-/merge_requests/12').ext, 'gitlab:a/b/c!12');
  assert.equal(extFromUrl('https://github.com/o/r/pull/3').ext, 'github:o/r#3');
  assert.equal(extFromUrl('https://example/x'), null);
});

function fakeProvider() {
  const mr = (full, extra = {}) => ({ ext: `gitlab:${full}`, project: full.split('!')[0], repo: 'web', iid: Number(full.split('!')[1]), title: `ABC-1 t${full}`, url: `https://g/${full}`, draft: false, target: 'main', sourceBranch: 'b', updatedAt: 'u1', ticketKeys: ['ABC-1'], ...extra });
  const p = {
    mineList: [mr('g/web!1')],
    reviewList: [mr('g/api!5'), mr('g/api!6')],
    states: { 2: 'merged' },
    approved: new Set(),
    mine() { return p.mineList; },
    reviews() { return p.reviewList; },
    mr(project, iid) { return { ...mr(`${project}!${iid}`), ...base, approved: false, unresolved: [{ discussionId: 'd', author: 'bot', fromAi: true, body: 'x'.repeat(500) }], pipeline: { status: 'success', url: 'https://g/p/1' } }; },
    state(project, iid) { return p.states[iid] ?? 'opened'; },
    reviewStatus(project, iid) { const a = p.approved.has(iid); return { approvedByMe: a, done: a }; },
  };
  return p;
}

test('sync: MRs get verdicts, parents and vanish on merge; reviews batch-notify and complete', () => {
  const db = S.openDb(join(mkdtempSync(join(tmpdir(), 'myday-sync-')), 'state.db'));
  const { id: ticket } = S.upsertItem(db, { type: 'story', ext: 'jira:ABC-1' });
  S.upsertItem(db, { type: 'mr', ext: 'gitlab:g/old!2', data: { project: 'g/old', iid: 2 } });
  const p = fakeProvider();
  const d1 = sync(db, settings, { provider: p });
  const mr = S.getItem(db, 'gitlab:g/web!1');
  assert.deepEqual(d1.mrs.new, [mr.id]);
  assert.equal(mr.parent_id, ticket);
  assert.equal(mr.data.verdict, 'fix-review');
  assert.ok(mr.data.unresolved[0].body.length < 310);
  assert.deepEqual(d1.mrs.vanished, [{ id: 'mr-1', state: 'merged' }]);
  assert.equal(S.getItem(db, 'mr-1').status, 'merged');
  assert.equal(d1.reviews.new.length, 2);
  assert.ok(S.listEvents(db, {}).some((e) => e.kind === 'notify' && /2 reviews/.test(e.message)));

  p.approved.add(5);
  p.reviewList = [p.reviewList[0]];
  const d2 = sync(db, settings, { provider: p, now: Date.now() + 31 * 60 * 1000 });
  assert.deepEqual(d2.reviews.done, [S.getItem(db, 'gitlab:g/api!5').id]);
  assert.deepEqual(d2.reviews.gone, [S.getItem(db, 'gitlab:g/api!6').id]);
  assert.equal(d2.mrs.new.length, 0);
});

import { reconcile, dispatch, parseResult } from '../lib/reconcile.mjs';

test('parseResult takes the last JSON block from a message', () => {
  assert.equal(parseResult('did stuff\n```json\n{"status":"done"}\n```').status, 'done');
  assert.equal(parseResult('text\n{"status":"failed","summary":"x"}').status, 'failed');
  assert.equal(parseResult('no json here'), null);
});

test('dispatch + reconcile: done links the MR, failures escalate at the retry limit', () => {
  const db = S.openDb(join(mkdtempSync(join(tmpdir(), 'myday-rec-')), 'state.db'));
  const { id } = S.upsertItem(db, { type: 'bug', ext: 'jira:ABC-9' });
  dispatch(db, id, { agent: 'a1', status: 'attempting' });
  const ok = reconcile(db, id, { status: 'done', mrUrl: 'https://g.example/grp/web/-/merge_requests/4', branch: 'fix/ABC-9' }, { retryLimit: 2 });
  assert.equal(ok.next, 'advance');
  assert.equal(S.getItem(db, ok.mrId).parent_id, id);
  assert.equal(S.getItem(db, id).agent_id, null);

  dispatch(db, id, { agent: 'a2' });
  const bad = reconcile(db, id, 'no json', { retryLimit: 2 });
  assert.equal(bad.next, 'escalate');
  assert.equal(S.getItem(db, id).failed, true);
});
