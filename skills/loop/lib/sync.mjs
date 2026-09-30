// One code-host refresh: my MRs/PRs and review requests → state, with gate verdicts.
// Read-only towards the code host; writes only the local state.
import * as S from './db.mjs';
import { verdict } from './gates.mjs';
import * as gitlab from './forge/gitlab.mjs';
import * as github from './forge/github.mjs';

const PROVIDERS = { gitlab, github };
const CLOSED = new Set(S.CLOSED_STATUSES);
const RECHECK_MS = 30 * 60 * 1000;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

const stale = (data, updatedAt, now) =>
  !data.checkedAt ||
  data.lastUpdatedAt !== updatedAt ||
  now - Date.parse(data.checkedAt) > RECHECK_MS ||
  ['running', 'pending', 'created'].includes(data.pipeline?.status);

export function sync(db, settings, { now = Date.now(), provider } = {}) {
  const p = provider ?? PROVIDERS[settings.forge];
  if (!p) throw new Error(`unknown forge ${settings.forge}`);
  gitlab.setTicketPattern(settings.ticketPattern);
  const prefix = `${settings.forge}:`;
  const iso = new Date(now).toISOString();
  const delta = { mrs: { new: [], changed: [], vanished: [] }, reviews: { new: [], done: [], reopened: [], covered: [], gone: [] } };

  // ---- my MRs/PRs
  const mine = p.mine({ group: settings.group });
  const seen = new Set();
  for (const m of mine) {
    seen.add(m.ext);
    const { id, created } = S.upsertItem(db, {
      type: 'mr', ext: m.ext, title: m.title, url: m.url, repos: [m.repo],
      data: { project: m.project, iid: m.iid, draft: m.draft, target: m.target, sourceBranch: m.sourceBranch, ticketKeys: m.ticketKeys },
    });
    if (created) delta.mrs.new.push(id);
    const item = S.getItem(db, id);

    const key = m.ticketKeys[0];
    if (key && settings.tracker && !item.parent_id) {
      const ticket = S.getItem(db, `${settings.tracker}:${key}`);
      if (ticket) {
        S.setFields(db, id, { parent_id: ticket.id });
        S.addLink(db, ticket.id, { kind: 'mr', url: m.url, label: `${m.repo}!${m.iid}` });
      }
    }

    if (!stale(item.data, m.updatedAt, now)) continue;
    const d = p.mr(m.project, m.iid, { aiReviewer: settings.aiReviewer });
    const v = verdict(d, settings);
    if (d.pipeline?.url) S.addLink(db, id, { kind: 'pipeline', url: d.pipeline.url, label: `pipeline ${d.pipeline.status}` });
    const before = item.data.verdict;
    S.setFields(db, id, {
      'data.checkedAt': iso,
      'data.lastUpdatedAt': m.updatedAt,
      'data.verdict': v.action,
      'data.failing': v.failing,
      'data.approved': d.approved,
      'data.approvedBy': d.approvedBy,
      'data.pipeline': d.pipeline,
      'data.mergeStatus': d.mergeStatus,
      'data.headSha': d.headSha,
      'data.reviewers': d.reviewers,
      'data.unresolved': d.unresolved.map((u) => ({ ...u, body: clip(u.body, 300) })),
    });
    if (before !== v.action) delta.mrs.changed.push({ id, verdict: v.action, failing: v.failing });
  }
  for (const it of S.listItems(db, { type: 'mr' })) {
    if (CLOSED.has(it.status) || seen.has(it.ext_key) || !it.ext_key.startsWith(prefix)) continue;
    const st = p.state(it.data.project, it.data.iid);
    const status = st === 'merged' ? 'merged' : 'closed';
    S.setFields(db, it.id, { status });
    S.addEvent(db, { itemId: it.id, kind: status === 'merged' ? 'merged' : 'closed', message: `${it.id} ${st}${st === 'opened' ? ' (no longer assigned to me)' : ''}: ${it.title}` });
    delta.mrs.vanished.push({ id: it.id, state: st });
  }

  // ---- review requests
  // hideCoveredReviews: a request someone else already approved / requested changes on is
  // `covered` (hidden) until my review is re-requested while an approval is still needed.
  const hideCovered = settings.hideCoveredReviews === true;
  const reRequested = (item, rs) => !!item.data.coveredAt && !!rs.lastRequestedAt && rs.lastRequestedAt > item.data.coveredAt;
  const needsMe = (rs) => rs.approvalsLeft == null || rs.approvalsLeft > 0;
  const covers = (item, rs) => hideCovered && !!rs.othersVerdict && !rs.approvedByMe && (!reRequested(item, rs) || !needsMe(rs));
  const cover = (id, rs, title) => {
    S.setFields(db, id, { status: 'covered', 'data.coveredAt': iso, 'data.othersVerdict': rs.othersVerdict });
    S.addEvent(db, { itemId: id, kind: 'review-covered', message: `${id} already ${rs.othersVerdict === 'changes' ? 'has changes requested' : 'approved'} by others: ${title}` });
    delta.reviews.covered.push(id);
  };
  const reviews = p.reviews({ group: settings.group });
  const requested = new Set();
  const fresh = [];
  for (const m of reviews) {
    requested.add(m.ext);
    const { id, created } = S.upsertItem(db, { type: 'review', ext: m.ext, title: m.title, url: m.url, data: { project: m.project, iid: m.iid } });
    const item = S.getItem(db, id);
    if (created) {
      // Only an approval counts for a brand-new request; older comments predate it.
      const rs = p.reviewStatus(m.project, m.iid, { since: iso });
      S.setFields(db, id, { 'data.requestedAt': iso, 'data.lastUpdatedAt': m.updatedAt, 'data.checkedAt': iso });
      if (rs.approvedByMe) S.setFields(db, id, { status: 'done' });
      else if (covers(item, rs)) cover(id, rs, m.title);
      else { fresh.push(item); delta.reviews.new.push(id); }
      continue;
    }
    if (item.status === 'skipped' && m.updatedAt !== item.data.lastUpdatedAt) {
      S.setFields(db, id, { status: 'new', 'data.lastUpdatedAt': m.updatedAt });
      S.addEvent(db, { itemId: id, kind: 'review-requested', message: `${id} updated since you skipped it: ${m.title}` });
      delta.reviews.reopened.push(id);
      continue;
    }
    if (CLOSED.has(item.status) || !stale(item.data, m.updatedAt, now)) continue;
    const rs = p.reviewStatus(m.project, m.iid, { since: item.data.requestedAt ?? item.created_at });
    S.setFields(db, id, { 'data.checkedAt': iso, 'data.lastUpdatedAt': m.updatedAt });
    if (item.status === 'covered' && reRequested(item, rs) && needsMe(rs)) {
      S.setFields(db, id, { status: 'new', 'data.requestedAt': rs.lastRequestedAt });
      S.addEvent(db, { itemId: id, kind: 'review-requested', message: `${id} re-requested, approval still needed: ${m.title}` });
      delta.reviews.reopened.push(id);
    } else if (rs.done) {
      S.setFields(db, id, { status: 'done' });
      delta.reviews.done.push(id);
    } else if (item.status !== 'covered' && covers(item, rs)) cover(id, rs, m.title);
  }
  if (fresh.length > settings.reviewBatchNotify) {
    for (const it of fresh) S.addEvent(db, { itemId: it.id, kind: 'review-queued', message: `${it.id} ${it.title}` });
    S.addEvent(db, { kind: 'notify', message: `${fresh.length} reviews waiting for you` });
  } else {
    for (const it of fresh) S.addEvent(db, { itemId: it.id, kind: 'review-requested', message: `${it.id} ${it.title}` });
  }
  for (const it of S.listItems(db, { type: 'review' })) {
    if (CLOSED.has(it.status) || requested.has(it.ext_key) || !it.ext_key.startsWith(prefix)) continue;
    S.setFields(db, it.id, { status: 'done' });
    S.addEvent(db, { itemId: it.id, kind: 'review-gone', message: `${it.id} no longer requests my review` });
    delta.reviews.gone.push(it.id);
  }
  return delta;
}
