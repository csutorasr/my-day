// An imaginary machine for the dashboard: a home (~/.my-day stand-in) with four registered loops,
// each a workspace .my-day folder with LOOP.md and a state.db filled through the real DB layer.
// `shop` shows every panel, `studio` is a second running loop whose session is a T3 Code thread
// (its worker is a T3 thread waiting for an answer), `voyage` is a pm loop (a draft to
// approve, a source down), `archive` is stopped. Used by the
// e2e test (README screenshots) and `npm run ui:demo`. Everything here is made up; never copy real
// work into it. Times are relative to now so the "Today" activity filter keeps working.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '../lib/db.mjs';
import { register } from '../lib/home.mjs';

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const git = 'https://git.example.com/shop';
const tracker = 'https://tracker.example.com/browse';

function seedShop(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'LOOP.md'), '---\nworkingHours: 08:00-19:00\nmaxAgents: 3\ntargetBranch: main\n---\n# Imaginary workspace\n');
  const db = S.openDb(join(dir, 'state.db'));

  const mr = (repo, iid, title, data, fields = {}) => {
    const { status, ...rest } = fields;
    const { id } = S.upsertItem(db, {
      type: 'mr', ext: `gitlab:shop/${repo}!${iid}`, title, url: `${git}/${repo}/-/merge_requests/${iid}`,
      status: status ?? 'in-review', repos: [repo], data: { iid, project: `shop/${repo}`, target: 'main', ...data },
    });
    S.addLink(db, id, { kind: 'pipeline', label: 'pipeline', url: `${git}/${repo}/-/pipelines/${4000 + iid}` });
    if (Object.keys(rest).length) S.setFields(db, id, rest);
    return id;
  };
  const ticket = (type, key, title, status, fields = {}) => {
    const { id } = S.upsertItem(db, { type, ext: `jira:${key}`, title, url: `${tracker}/${key}`, status });
    if (Object.keys(fields).length) S.setFields(db, id, fields);
    return id;
  };

  // Tickets.
  const wishlist = ticket('subtask', 'SHOP-42', '[BE] Wishlist storage', 'post-mr', { branch: 'feat/SHOP-42-wishlist-storage', repos: 'backend' });
  const discount = ticket('bug', 'SHOP-57', 'Discount code applied twice at checkout', 'developing', { branch: 'fix/SHOP-57-double-discount', repos: 'api-spec,backend', attempts: 3, agent_id: 'run:bug-1-3' });
  // A claude -p chain (runner: claude-p) for the bug: api-spec is done, backend runs now.
  mkdirSync(join(dir, 'runs'), { recursive: true });
  writeFileSync(join(dir, 'runs', 'bug-1-3.json'), JSON.stringify({
    id: 'bug-1-3', item: discount, kind: 'bug', status: 'running', startedAt: ago(14), endedAt: null,
    steps: [
      { repo: 'api-spec', status: 'done', startedAt: ago(14), endedAt: ago(9) },
      { repo: 'backend', status: 'running', startedAt: ago(9) },
    ],
  }));
  ticket('story', 'SHOP-30', 'Wishlist', 'in-subtasks');
  const flaky = ticket('bug', 'SHOP-51', 'Order e-mail shows the wrong currency', 'developing', { attempts: 3 });
  ticket('bug', 'SHOP-48', 'Search ignores accented characters', 'done');

  // Merge requests, one per board lane.
  const ready = mr('backend', 118, 'SHOP-42: wishlist table and API',
    { pipeline: { status: 'success' }, approvedBy: ['alice'], verdict: 'merge', ticketKeys: ['SHOP-42'] });
  const sso = mr('backend', 112, 'SHOP-35: sign in with a magic link',
    { pipeline: { status: 'success' }, approvedBy: [], unresolved: [{ id: 1 }], verdict: 'fix-review', ticketKeys: ['SHOP-35'] });
  const gallery = mr('web', 77, 'SHOP-38: product gallery with zoom',
    { pipeline: { status: 'running' }, approvedBy: [], mergeStatus: 'need_rebase', verdict: 'rebase', ticketKeys: ['SHOP-38'] });
  const cart = mr('web', 81, 'SHOP-44: sticky cart summary',
    { pipeline: { status: 'failed' }, approvedBy: [], verdict: 'fix-pipeline', ticketKeys: ['SHOP-44'] },
    { agent_id: 'a1b2c3d4', status: 'fixing', attempts: 1 });
  mr('api-spec', 23, 'SHOP-46: add the wishlist endpoints to the API spec',
    { pipeline: { status: 'success' }, approvedBy: ['bob'], verdict: 'merge', ticketKeys: ['SHOP-46'] });

  // Reviews requested from you.
  S.upsertItem(db, { type: 'review', ext: 'gitlab:shop/web!83', title: 'feat(checkout): saved addresses (SHOP-49)', url: `${git}/web/-/merge_requests/83`, data: { iid: 83, project: 'shop/web' } });
  const specReview = S.upsertItem(db, { type: 'review', ext: 'gitlab:shop/api-spec!25', title: 'feat(orders)!: rename the order status values (SHOP-50)', url: `${git}/api-spec/-/merge_requests/25`, data: { iid: 25, project: 'shop/api-spec' } }).id;

  // Today's activity and finished agents, oldest first.
  S.addEvent(db, { kind: 'merged', message: 'backend!109 merged; SHOP-40 moved to QA', ts: ago(95) });
  S.addEvent(db, { itemId: sso, kind: 'worker', message: `${sso} done: rebased on main; only a generated file conflicted`, data: { status: 'done', commits: ['3f9c21ab', '7d04e5c9'] }, ts: ago(70) });
  S.addEvent(db, { itemId: flaky, kind: 'worker', message: `${flaky} failed: pipeline still red after 3 attempts`, data: { status: 'failed', commits: [] }, ts: ago(60) });
  S.addEvent(db, { itemId: cart, kind: 'pipeline-failed', message: 'web!81 pipeline failed in test:e2e', ts: ago(25) });
  S.addEvent(db, { itemId: cart, kind: 'dispatched', message: `${cart} → agent a1b2c3d4 (attempt 1)`, ts: ago(20) });
  S.addEvent(db, { itemId: gallery, kind: 'status', message: `${gallery}: behind main after a sibling merge`, ts: ago(12) });
  S.addEvent(db, { itemId: specReview, kind: 'review-requested', message: 'api-spec!25 needs your review', ts: ago(5) });
  S.addEvent(db, { itemId: ready, kind: 'pipeline-green', message: 'backend!118 pipeline green, approved by alice', ts: ago(3) });

  // The latest moments (stamped now): the loop gives up on the flaky bug and asks you two things.
  // Events list in insertion order, so these come after the dated history above.
  S.fail(db, flaky, 'Pipeline still red after 3 attempts: flaky checkout test');
  S.ask(db, sso, 'Approve: rebase !112 onto main and force-push with lease?');
  S.ask(db, wishlist, 'Should a wishlist be shareable through a public link?');

  S.setMeta(db, 'lastTickAt', ago(4));
  S.setMeta(db, 'nextTickAt', new Date(Date.now() + 16 * 60_000).toISOString());
  S.setMeta(db, 'sessionStartedAt', ago(240));
  db.close();
  return dir;
}

// A design-system workspace: one MR waiting on a question, one failed story and one review. Its ids
// (mr-1, q-1, review-1) repeat shop's on purpose: the dashboard must keep them apart. Its loop runs
// in a T3 Code thread (runner: t3): the dashboard links to the loop's thread, and the worker on UI-16
// is a T3 thread that stopped to ask something.
const t3Thread = (id) => `https://app.t3.codes/threads/demo-env/${id}`;
function seedStudio(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'LOOP.md'), '---\nworkingHours: 09:00-17:00\nmaxAgents: 2\ntargetBranch: main\nrunner: t3\n---\n# Imaginary workspace\n');
  const db = S.openDb(join(dir, 'state.db'));
  S.setMeta(db, 'host', 't3');
  S.setMeta(db, 'hostThreadId', 'demo-loop');
  S.setMeta(db, 'hostThreadLink', t3Thread('demo-loop'));
  S.setSource(db, 'cli:t3', 'ok');
  const { id: toolbar } = S.upsertItem(db, { type: 'subtask', ext: 'jira:UI-16', title: 'Outline icons for the toolbar', url: `${tracker}/UI-16`, status: 'developing' });
  S.setFields(db, toolbar, { branch: 'feat/UI-16-toolbar-icons', repos: 'ui', attempts: 1, agent_id: `run:${toolbar}-1` });
  S.addLink(db, toolbar, { kind: 'thread', label: 'ui worker (attempt 1)', url: t3Thread('demo-worker') });
  mkdirSync(join(dir, 'runs'), { recursive: true });
  writeFileSync(join(dir, 'runs', `${toolbar}-1.json`), JSON.stringify({
    id: `${toolbar}-1`, runner: 't3', item: toolbar, kind: 'develop', status: 'running', startedAt: ago(22), endedAt: null,
    steps: [{ repo: 'ui', status: 'running', startedAt: ago(22), thread: 'demo-worker', link: t3Thread('demo-worker'), waiting: true, waitingSince: ago(6) }],
  }));
  S.addEvent(db, { itemId: toolbar, kind: 'run-started', message: `${toolbar}: T3 thread in ui (1 of 1)`, ts: ago(22) });
  S.addEvent(db, { itemId: toolbar, kind: 'run-waiting', message: `${toolbar}: the ui worker waits for your answer in its T3 thread`, data: { link: t3Thread('demo-worker') }, ts: ago(6) });
  const { id: tokens } = S.upsertItem(db, { type: 'story', ext: 'jira:UI-12', title: 'Dark mode tokens for the button set', url: `${tracker}/UI-12`, status: 'developing' });
  S.fail(db, tokens, 'Visual regression tests fail on the focus ring');
  const { id: icons } = S.upsertItem(db, {
    type: 'mr', ext: 'gitlab:studio/ui!9', title: 'UI-14: rename the icon set', url: 'https://git.example.com/studio/ui/-/merge_requests/9',
    status: 'in-review', repos: ['ui'], data: { iid: 9, project: 'studio/ui', target: 'main', pipeline: { status: 'success' }, approvedBy: [], verdict: 'wait', ticketKeys: ['UI-14'] },
  });
  S.ask(db, icons, 'Keep the old icon names as aliases for one release?');
  S.upsertItem(db, { type: 'review', ext: 'gitlab:studio/ui!14', title: 'feat(icons): outline set v2 (UI-15)', url: 'https://git.example.com/studio/ui/-/merge_requests/14', data: { iid: 14, project: 'studio/ui' } });
  S.addEvent(db, { itemId: tokens, kind: 'failed', message: `${tokens}: visual regression tests fail`, ts: ago(30) });
  S.setMeta(db, 'lastTickAt', ago(2));
  S.setMeta(db, 'nextTickAt', new Date(Date.now() + 18 * 60_000).toISOString());
  S.setMeta(db, 'sessionStartedAt', ago(120));
  db.close();
  return dir;
}

// A product manager's loop (pm profile, no code host): a spec in progress, clustered feedback, a
// backlog ticket with hygiene findings, and the weekly status as a Slack draft to approve. The
// feedback tool's MCP server lost its login, so its intake is paused.
function seedVoyage(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'LOOP.md'), '---\nworkingHours: 08:00-18:00\nmaxAgents: 0\nforge: none\nrequires: mcp:atlassian, mcp:slack, mcp:intercom\nstatusSchedule: Fri 14:00\n---\n# Imaginary workspace\n');
  const db = S.openDb(join(dir, 'state.db'));
  const trip = 'https://tracker.example.com/browse';
  S.upsertItem(db, { type: 'spec', ext: 'jira:TRIP-20', title: 'Offline itinerary', url: `${trip}/TRIP-20`, status: 'prd-review' });
  S.upsertItem(db, { type: 'feedback', ext: 'fb:calendar-export', title: 'Export trips to a calendar (7 requests)', status: 'linked', data: { ticket: 'TRIP-24', requests: 7 } });
  S.upsertItem(db, { type: 'ticket', ext: 'jira:TRIP-31', title: 'Map pins overlap on dense cities', url: `${trip}/TRIP-31`, status: 'needs-fix', data: { findings: ['no acceptance criteria', 'no estimate'] } });
  const { id: report } = S.upsertItem(db, { type: 'report', ext: 'status:2026-w40', title: 'Status, week 40', status: 'drafted' });
  S.addEvent(db, { kind: 'scheduled', message: 'status: drafted from TRIP board and 3 merged epics', ts: ago(40) });
  S.setSource(db, 'mcp:atlassian', 'ok');
  S.setSource(db, 'mcp:slack', 'ok');
  S.setSource(db, 'mcp:intercom', 'error', 'login expired');
  S.ask(db, report, 'Post the weekly status to the product channel?', {
    draft: {
      action: 'slack: post channel',
      target: '#voyage-product',
      body: 'Week 40\nShipped: trip sharing, faster search.\nIn progress: offline itinerary (PRD in review).\nRisk: map pins overlap on dense cities, fix planned for next sprint.',
    },
  });
  S.setMeta(db, 'lastTickAt', ago(3));
  S.setMeta(db, 'nextTickAt', new Date(Date.now() + 17 * 60_000).toISOString());
  S.setMeta(db, 'sessionStartedAt', ago(90));
  db.close();
  return dir;
}

// A finished engagement: the loop was stopped yesterday.
function seedArchive(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'LOOP.md'), '---\nworkingHours: 08:00-16:00\n---\n# Imaginary workspace\n');
  const db = S.openDb(join(dir, 'state.db'));
  S.upsertItem(db, { type: 'bug', ext: 'jira:OLD-3', title: 'Export keeps the old logo', status: 'done' });
  S.setMeta(db, 'sessionStartedAt', ago(60 * 30));
  S.setMeta(db, 'nextTickAt', ago(60 * 26));
  S.setMeta(db, 'stoppedAt', ago(60 * 26));
  db.close();
  return dir;
}

// `root` holds the workspaces and the home. `only` limits the seed to some loops (e.g. ['shop']).
export function seedDemo(root, { only = ['shop', 'studio', 'voyage', 'archive'] } = {}) {
  const home = join(root, 'home');
  const seeders = { shop: seedShop, studio: seedStudio, voyage: seedVoyage, archive: seedArchive };
  const loops = {};
  for (const name of only) {
    const dir = seeders[name](join(root, name, '.my-day'));
    loops[name] = register(home, dir).id;
  }
  return { home, loops };
}
