// An imaginary machine for the dashboard: a home (~/.my-day stand-in) with three registered loops,
// each a workspace .my-day folder with LOOP.md and a state.db filled through the real DB layer.
// `shop` shows every panel, `studio` is a second running loop, `archive` is stopped. Used by the
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
  ticket('bug', 'SHOP-57', 'Discount code applied twice at checkout', 'developing', { branch: 'fix/SHOP-57-double-discount', repos: 'backend', attempts: 2 });
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
// (mr-1, q-1, review-1) repeat shop's on purpose: the dashboard must keep them apart.
function seedStudio(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'LOOP.md'), '---\nworkingHours: 09:00-17:00\nmaxAgents: 2\ntargetBranch: main\n---\n# Imaginary workspace\n');
  const db = S.openDb(join(dir, 'state.db'));
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
export function seedDemo(root, { only = ['shop', 'studio', 'archive'] } = {}) {
  const home = join(root, 'home');
  const seeders = { shop: seedShop, studio: seedStudio, archive: seedArchive };
  const loops = {};
  for (const name of only) {
    const dir = seeders[name](join(root, name, '.my-day'));
    loops[name] = register(home, dir).id;
  }
  return { home, loops };
}
