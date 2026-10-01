import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'forge.mjs');
const dir = mkdtempSync(join(tmpdir(), 'myday-forge-'));

// A fake CLI answering `<cli> api <endpoint|graphql> …` from a fixture map.
function fakeCli(name, fixtures) {
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node\nconst f=${JSON.stringify(fixtures)};const k=process.argv[3];if(!(k in f)){console.error('no fixture '+k);process.exit(1)}console.log(JSON.stringify(f[k]));`);
  chmodSync(file, 0o755);
  return file;
}

// ---------- GitLab
const mr = (full, extra = {}) => ({
  references: { full }, iid: Number(full.split('!')[1]), title: 'ABC-7: thing', web_url: `https://g/${full}`,
  draft: false, target_branch: 'main', source_branch: 'fix/ABC-7-x', updated_at: '2026-09-29T10:00:00Z', ...extra,
});
const glab = fakeCli('glab', {
  user: { username: 'me' },
  'merge_requests?state=opened&scope=assigned_to_me&per_page=100': [mr('grp/app/web!1'), mr('other/x!2')],
  'merge_requests?state=opened&scope=all&reviewer_username=me&per_page=100': [mr('grp/app/api!3'), mr('grp/app/api!4', { draft: true })],
  'projects/grp%2Fapp%2Fweb/merge_requests/1': { ...mr('grp/app/web!1'), detailed_merge_status: 'mergeable', blocking_discussions_resolved: false, has_conflicts: false, sha: 'abc', head_pipeline: { id: 9, status: 'success', sha: 'abc', web_url: 'https://g/p/9' }, reviewers: [{ username: 'bob' }] },
  'projects/grp%2Fapp%2Fweb/merge_requests/1/approvals': { approved: false, approved_by: [] },
  'projects/grp%2Fapp%2Fweb/merge_requests/1/discussions?per_page=100': [
    { id: 'd1', notes: [{ id: 1, resolvable: true, resolved: false, author: { username: 'group_1_bot_x' }, body: 'fix me', position: { new_path: 'a.ts', new_line: 3 } }] },
    { id: 'd2', notes: [{ id: 2, resolvable: true, resolved: true, author: { username: 'bob' }, body: 'ok' }] },
  ],
  'projects/grp%2Fapp%2Fapi/merge_requests/3/approvals': { approved_by: [{ user: { username: 'me' } }] },
  'projects/grp%2Fapp%2Fapi/merge_requests/3/notes?sort=desc&per_page=100': [],
  'projects/grp%2Fapp%2Fapi/merge_requests/3/reviewers': [{ user: { username: 'me' }, state: 'approved' }],
  'projects/grp%2Fapp%2Fapi/merge_requests/8/approvals': { approved_by: [{ user: { username: 'ann' } }], approvals_left: 1 },
  'projects/grp%2Fapp%2Fapi/merge_requests/8/reviewers': [{ user: { username: 'me' }, state: 'unreviewed' }, { user: { username: 'bob' }, state: 'requested_changes' }],
  'projects/grp%2Fapp%2Fapi/merge_requests/8/notes?sort=desc&per_page=100': [
    { system: true, author: { username: 'bob' }, body: 'requested review from @ann, @meg and @me', created_at: '2026-09-29T12:00:00Z' },
    { system: true, author: { username: 'bob' }, body: 'requested review from @meg', created_at: '2026-09-29T11:00:00Z' },
    { system: true, author: { username: 'bob' }, body: 'requested review from @me', created_at: '2026-09-29T10:00:00Z' },
  ],
  'projects/grp%2Fapp%2Fapi/merge_requests/9/approvals': { approved_by: [{ user: { username: 'ann' } }], approvals_left: 0 },
  'projects/grp%2Fapp%2Fapi/merge_requests/9/reviewers': [{ user: { username: 'me' }, state: 'unreviewed' }],
  'projects/grp%2Fapp%2Fapi/merge_requests/9/notes?sort=desc&per_page=100': [
    { system: true, author: { username: 'bob' }, body: 'requested review from @meg', created_at: '2026-09-29T11:00:00Z' },
  ],
});
const gl = (...a) => JSON.parse(execFileSync(process.execPath, [BIN, '--provider', 'gitlab', ...a], { env: { ...process.env, GLAB_BIN: glab }, encoding: 'utf8' }));

test('gitlab: mine filters by group and extracts ticket keys', () => {
  const list = gl('mine', '--group', 'grp/app/');
  assert.deepEqual(list.map((m) => m.ext), ['gitlab:grp/app/web!1']);
  assert.deepEqual(list[0].ticketKeys, ['ABC-7']);
  assert.equal(list[0].repo, 'web');
});

test('gitlab: reviews skip drafts', () => {
  assert.deepEqual(gl('reviews', '--group', 'grp/app/').map((m) => m.iid), [3]);
});

test('gitlab: mr details expose gates and unresolved discussions only', () => {
  const d = gl('mr', 'grp/app/web', '1');
  assert.equal(d.pipeline.status, 'success');
  assert.equal(d.approved, false);
  assert.equal(d.unresolved.length, 1);
  assert.equal(d.unresolved[0].fromAi, true);
  assert.equal(d.unresolved[0].path, 'a.ts');
});

test('gitlab: review-status detects my approval', () => {
  const rs = gl('review-status', 'grp/app/api', '3');
  assert.equal(rs.done, true);
  assert.equal(rs.othersVerdict, null);
  assert.equal(rs.approvalsLeft, null);
  assert.equal(rs.lastRequestedAt, null);
});

test('gitlab: review-status reports what others decided and when I was last requested', () => {
  const changes = gl('review-status', 'grp/app/api', '8');
  assert.equal(changes.done, false);
  assert.equal(changes.othersVerdict, 'changes');
  assert.equal(changes.approvalsLeft, 1);
  assert.equal(changes.lastRequestedAt, '2026-09-29T12:00:00Z');
  const approved = gl('review-status', 'grp/app/api', '9');
  assert.equal(approved.othersVerdict, 'approved');
  assert.equal(approved.approvalsLeft, 0);
  assert.equal(approved.lastRequestedAt, null); // @meg is not @me
});

// ---------- GitHub
const pr = (repo, n, extra = {}) => ({
  number: n, title: `ABC-${n}: pr`, html_url: `https://github.com/${repo}/pull/${n}`, draft: false,
  base: { ref: 'main' }, head: { ref: `feat/ABC-${n}`, sha: `sha${n}` }, updated_at: '2026-09-29T10:00:00Z',
  mergeable_state: 'clean', requested_reviewers: [], ...extra,
});
const item = (repo, n) => ({ number: n, repository_url: `https://api.github.com/repos/${repo}` });
const gh = fakeCli('gh', {
  user: { login: 'me' },
  'search/issues?q=is:pr+is:open+assignee:@me+org:acme&per_page=100': { items: [item('acme/web', 5), item('acmeish/x', 6)] },
  'search/issues?q=is:pr+is:open+draft:false+review-requested:@me+org:acme&per_page=100': { items: [item('acme/api', 7)] },
  'repos/acme/web/pulls/5': pr('acme/web', 5, { mergeable_state: 'behind' }),
  'repos/acmeish/x/pulls/6': pr('acmeish/x', 6),
  'repos/acme/api/pulls/7': pr('acme/api', 7),
  'repos/acme/web/pulls/5/reviews?per_page=100': [
    { user: { login: 'bob' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-09-29T09:00:00Z' },
    { user: { login: 'bob' }, state: 'APPROVED', submitted_at: '2026-09-29T11:00:00Z' },
  ],
  'repos/acme/web/commits/sha5/check-runs?per_page=100': { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] },
  graphql: { data: { repository: { pullRequest: { reviewThreads: { nodes: [
    { id: 't1', isResolved: false, path: 'b.ts', line: 9, comments: { totalCount: 2, nodes: [{ databaseId: 11, body: 'nit', author: { login: 'reviewbot[bot]' } }] } },
    { id: 't2', isResolved: true, path: 'c.ts', line: 1, comments: { totalCount: 1, nodes: [{ databaseId: 12, body: 'done', author: { login: 'bob' } }] } },
  ] } } } } },
  'repos/acme/api/pulls/7/reviews?per_page=100': [],
  'repos/acme/api/issues/7/comments?per_page=100': [{ user: { login: 'me' }, created_at: '2026-09-30T08:00:00Z' }],
  'repos/acme/api/issues/7/timeline?per_page=100': [],
  'repos/acme/web/issues/5/comments?per_page=100': [],
  'repos/acme/web/issues/5/timeline?per_page=100': [
    { event: 'review_requested', requested_reviewer: { login: 'me' }, created_at: '2026-09-29T08:00:00Z' },
    { event: 'review_requested', requested_reviewer: { login: 'me' }, created_at: '2026-09-29T12:00:00Z' },
    { event: 'review_requested', requested_reviewer: { login: 'bob' }, created_at: '2026-09-29T13:00:00Z' },
  ],
});
const hub = (...a) => JSON.parse(execFileSync(process.execPath, [BIN, '--provider', 'github', ...a], { env: { ...process.env, GH_BIN: gh }, encoding: 'utf8' }));

test('github: mine scopes to the org and uses the shared shape', () => {
  const list = hub('mine', '--group', 'acme/');
  assert.deepEqual(list.map((m) => m.ext), ['github:acme/web#5']);
  assert.equal(list[0].sourceBranch, 'feat/ABC-5');
  assert.deepEqual(list[0].ticketKeys, ['ABC-5']);
});

test('github: reviews', () => {
  assert.deepEqual(hub('reviews', '--group', 'acme/').map((m) => m.ext), ['github:acme/api#7']);
});

test('github: mr normalizes merge state, approvals, checks and threads', () => {
  const d = hub('mr', 'acme/web', '5');
  assert.equal(d.mergeStatus, 'need_rebase');
  assert.equal(d.approved, true);
  assert.deepEqual(d.approvedBy, ['bob']);
  assert.equal(d.pipeline.status, 'running');
  assert.equal(d.unresolved.length, 1);
  assert.equal(d.unresolved[0].fromAi, true);
  assert.equal(d.blockingResolved, false);
});

test('github: review-status counts my comments after since', () => {
  assert.equal(hub('review-status', 'acme/api', '7', '--since', '2026-09-29T00:00:00Z').done, true);
  assert.equal(hub('review-status', 'acme/api', '7', '--since', '2026-10-01T00:00:00Z').done, false);
});

test('github: review-status takes the latest review of others and my last request', () => {
  const rs = hub('review-status', 'acme/web', '5');
  assert.equal(rs.othersVerdict, 'approved'); // bob's CHANGES_REQUESTED was superseded
  assert.equal(rs.approvalsLeft, null);
  assert.equal(rs.lastRequestedAt, '2026-09-29T12:00:00Z');
});

test('ticket pattern is configurable', () => {
  const list = JSON.parse(execFileSync(process.execPath, [BIN, '--provider', 'gitlab', 'mine', '--group', 'grp/app/', '--ticket-pattern', 'fix/[A-Z]+'], { env: { ...process.env, GLAB_BIN: glab }, encoding: 'utf8' }));
  assert.deepEqual(list[0].ticketKeys, ['fix/ABC']);
});

test('isAiReviewer accepts a comma-separated list and falls back to the bot pattern', async () => {
  const { isAiReviewer } = await import('../lib/forge/ai-reviewer.mjs');
  assert.equal(isAiReviewer('GitLabDuo', 'ci_bot, GitLabDuo', /_bot_/), true);
  assert.equal(isAiReviewer('ci_bot', 'ci_bot,GitLabDuo', /_bot_/), true);
  assert.equal(isAiReviewer('alice', 'ci_bot,GitLabDuo', /_bot_/), false);
  assert.equal(isAiReviewer('group_1_bot_x', '', /_bot_/), true);
});
