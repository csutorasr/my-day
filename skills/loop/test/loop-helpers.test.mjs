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
    status: {}, // per-iid reviewStatus overrides
    mine() { return p.mineList; },
    reviews() { return p.reviewList; },
    mr(project, iid) { return { ...mr(`${project}!${iid}`), ...base, approved: false, unresolved: [{ discussionId: 'd', author: 'bot', fromAi: true, body: 'x'.repeat(500) }], pipeline: { status: 'success', url: 'https://g/p/1' } }; },
    state(project, iid) { return p.states[iid] ?? 'opened'; },
    reviewStatus(project, iid) { const a = p.approved.has(iid); return { approvedByMe: a, done: a, othersVerdict: null, approvalsLeft: null, lastRequestedAt: null, ...p.status[iid] }; },
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

function coveredSetup(hideCoveredReviews = true) {
  const db = S.openDb(join(mkdtempSync(join(tmpdir(), 'myday-cov-')), 'state.db'));
  const p = fakeProvider();
  p.reviewList = [p.reviewList[0]];
  p.status[5] = { othersVerdict: 'approved', approvalsLeft: 1, lastRequestedAt: '2026-09-01T00:00:00Z' };
  const s = { ...settings, hideCoveredReviews };
  const d = sync(db, s, { provider: p, now: Date.parse('2026-09-30T10:00:00Z') });
  return { db, p, s, d, id: S.getItem(db, 'gitlab:g/api!5').id };
}
const kinds = (db, id) => S.listEvents(db, {}).filter((e) => e.item_id === id).map((e) => e.kind);

test('sync: a review others already handled is covered, hidden and not notified', () => {
  const { db, d, id } = coveredSetup();
  const it = S.getItem(db, id);
  assert.equal(it.status, 'covered');
  assert.equal(it.data.coveredAt, '2026-09-30T10:00:00.000Z');
  assert.deepEqual(d.reviews.covered, [id]);
  assert.deepEqual(d.reviews.new, []);
  assert.ok(kinds(db, id).includes('review-covered'));
  assert.ok(!kinds(db, id).includes('review-requested'));
  assert.ok(!S.CLOSED_STATUSES.includes('covered'));
});

test('sync: a covered review re-requested while approvals are left is back to new', () => {
  const { db, p, s, id } = coveredSetup();
  p.status[5] = { othersVerdict: 'approved', approvalsLeft: 1, lastRequestedAt: '2026-09-30T11:00:00Z' };
  p.reviewList = [{ ...p.reviewList[0], updatedAt: 'u2' }];
  const d = sync(db, s, { provider: p, now: Date.parse('2026-09-30T11:05:00Z') });
  assert.equal(S.getItem(db, id).status, 'new');
  assert.deepEqual(d.reviews.reopened, [id]);
  assert.ok(S.listEvents(db, {}).some((e) => e.item_id === id && e.kind === 'review-requested' && /re-requested/.test(e.message)));
  // Stays visible on the next check even though the others' verdict is still there.
  p.reviewList = [{ ...p.reviewList[0], updatedAt: 'u3' }];
  sync(db, s, { provider: p, now: Date.parse('2026-09-30T11:10:00Z') });
  assert.equal(S.getItem(db, id).status, 'new');
});

test('sync: a covered review re-requested with no approvals left stays covered', () => {
  const { db, p, s, id } = coveredSetup();
  p.status[5] = { othersVerdict: 'approved', approvalsLeft: 0, lastRequestedAt: '2026-09-30T11:00:00Z' };
  p.reviewList = [{ ...p.reviewList[0], updatedAt: 'u2' }];
  const d = sync(db, s, { provider: p, now: Date.parse('2026-09-30T11:05:00Z') });
  assert.equal(S.getItem(db, id).status, 'covered');
  assert.deepEqual(d.reviews.reopened, []);
});

test('sync: hideCoveredReviews false keeps reviews others handled in the list', () => {
  const { db, d, id } = coveredSetup(false);
  assert.equal(S.getItem(db, id).status, 'new');
  assert.deepEqual(d.reviews.new, [id]);
  assert.deepEqual(d.reviews.covered, []);
  assert.ok(kinds(db, id).includes('review-requested'));
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

import { dreamDue, lastDreamSlot } from '../lib/schedule.mjs';

test('dream: due once the schedule passed since the last dream, inside working hours', () => {
  const s = { ...settings, dreamSchedule: 'Fri 17:00' };
  const friEve = new Date(2026, 9, 2, 17, 30); // Fri 17:30
  assert.equal(dreamDue(s, null, friEve), true);
  assert.equal(dreamDue(s, new Date(2026, 8, 25, 17, 10).toISOString(), friEve), true); // last week's
  assert.equal(schedule(s, 0, friEve, { lastDreamAt: null }).dreamDue, true);
  // Missed on Friday → still due on Monday morning.
  assert.equal(dreamDue(s, new Date(2026, 8, 25, 17, 10).toISOString(), new Date(2026, 9, 5, 9, 0)), true);
});

test('dream: not due before the slot or after a dream since it', () => {
  const s = { ...settings, dreamSchedule: 'Fri 17:00' };
  assert.equal(dreamDue(s, new Date(2026, 9, 2, 17, 5).toISOString(), new Date(2026, 9, 2, 17, 30)), false);
  assert.equal(dreamDue(s, new Date(2026, 8, 25, 17, 10).toISOString(), new Date(2026, 9, 2, 16, 59)), false); // Fri before slot
  assert.equal(dreamDue(s, new Date(2026, 8, 25, 17, 10).toISOString(), new Date(2026, 8, 30, 10, 0)), false); // Wed
});

test('dream: off when the schedule is empty or unparseable', () => {
  const friEve = new Date(2026, 9, 2, 17, 30);
  assert.equal(dreamDue({ ...settings }, null, friEve), false); // default ''
  assert.equal(schedule(settings, 0, friEve).dreamDue, false);
  assert.equal(dreamDue({ ...settings, dreamSchedule: 'someday' }, null, friEve), false);
  assert.equal(lastDreamSlot('', friEve), null);
  assert.equal(lastDreamSlot('Mon,Thu 09:30', friEve).getDay(), 4);
});

test('dream: never due outside working hours', () => {
  const s = { ...settings, dreamSchedule: 'Fri 17:00' };
  assert.equal(dreamDue(s, null, new Date(2026, 9, 2, 19, 0)), false); // Fri after hours
  assert.equal(dreamDue(s, null, new Date(2026, 9, 3, 11, 0)), false); // Sat
  assert.equal(dreamDue({ ...s, dreamSchedule: 'Sat 10:00' }, null, new Date(2026, 9, 3, 11, 0)), false);
});

test('sync with forge none does nothing', () => {
  const db = S.openDb(join(mkdtempSync(join(tmpdir(), 'myday-none-')), 'state.db'));
  assert.deepEqual(sync(db, { forge: 'none' }), { skipped: 'forge: none' });
});
