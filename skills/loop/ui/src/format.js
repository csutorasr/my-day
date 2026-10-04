// Pure helpers shared by the dashboard components: labels, gate chips, quick actions, time.

export const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// Time, prefixed with the day when it is not today ("Oct 1, 18:14").
export const when = (ts) =>
  new Date(ts).toDateString() === new Date().toDateString()
    ? hhmm(ts)
    : `${new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${hhmm(ts)}`;

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Quick actions the loop understands (server REQUESTS); labels per action.
export const ACTION_LABEL = { rebase: 'Rebase', 'fix-pipeline': 'Fix pipeline', 'fix-review': 'Fix review', merge: 'Merge', retry: 'Retry', elaborate: 'Explain' };
// What each action asks the loop to do, for tooltips and screen readers.
export const ACTION_HINT = {
  rebase: 'rebase onto the target branch (force-push with lease)',
  'fix-pipeline': 'send an agent to fix the failing pipeline',
  'fix-review': 'send an agent to handle the open review comments',
  merge: 'merge it if every merge gate passes',
  retry: 'try this item again',
  elaborate: 'explain where this item stands, in the session',
};
// Actions that rewrite or merge shared history: never offered on a phone.
export const RISKY_ACTIONS = new Set(['rebase', 'merge']);
const VERDICT_ACTION = { rebase: 'rebase', 'fix-pipeline': 'fix-pipeline', 'fix-review': 'fix-review', merge: 'merge' };
export const NEXT = { merge: 'Ready for the merge step', rebase: 'Needs a rebase', 'fix-pipeline': 'Pipeline failed', 'fix-review': 'Review comments to handle' };

export const repoOf = (i) => (i?.data?.project ?? i?.project ?? '').split('/').at(-1);

export function label(i) {
  if (!i) return '';
  const iid = i.data?.iid ?? i.iid;
  if ((i.type === 'mr' || i.type === 'review') && iid) return `${repoOf(i)} !${iid}`;
  const key = (i.ext_key ?? '').split(':').slice(1).join(':');
  return key || i.id;
}

// Actions offered on an item reference, most useful first.
export function actionsFor(i, state) {
  if (!i || !state || i.type === 'review') return [];
  const acts = [];
  if (i.failed) acts.push('retry');
  const v = VERDICT_ACTION[i.data?.verdict];
  if (i.type === 'mr' && v && !i.agent_id) acts.push(v);
  if (!acts.length) acts.push('elaborate');
  return acts.filter((a) => state.requests.includes(a));
}

// Requests sent from the dashboard that the loop has not picked up yet, as "itemId:action".
// Keyed `loop:item:action`; each loop's own last tick decides what it has picked up.
export function pendingRequests(state) {
  const lastTick = (loop) => state?.loops?.find((l) => l.id === loop)?.loop.lastTickAt ?? state?.loop.lastTickAt ?? '';
  const out = new Set();
  for (const e of state?.recent ?? []) if (e.kind === 'dashboard-request' && e.ts > lastTick(e.loop)) out.add(`${e.loop}:${e.item_id}:${e.data?.action}`);
  return out;
}

// Answers given on the dashboard that the loop has not picked up yet, by item id.
export function pendingAnswers(state) {
  const since = state?.loop.lastTickAt ?? '';
  const out = new Map();
  for (const e of state?.recent ?? []) if (e.kind === 'dashboard-answer' && e.ts > since && e.item_id) out.set(e.item_id, e.data ?? {});
  return out;
}

// Extra links on an item, newest per kind (a pipeline link is added on every run; only the latest matters).
export function latestLinks(i) {
  const latest = new Map();
  for (const l of i.links ?? []) if (l.url !== i.url && l.kind !== 'mr') latest.set(l.kind, l);
  return [...latest.values()];
}

// Gate reasons from the verdict, phrased for people.
export const humanFailing = (f) => f.map((x) => x.replace(/^target is (\S+), not \S+$/, 'targets $1 (outside the merge step)')).join(', ');

// Gate chips of an MR card: [text, tone] with tone '' | ok | bad | wait.
export function gates(m, target) {
  const d = m.data ?? {};
  const out = [];
  if (d.draft) out.push(['draft', '']);
  const p = d.pipeline?.status;
  out.push(p === 'success' ? ['pipeline green', 'ok'] : p === 'failed' ? ['pipeline failed', 'bad'] : p ? [`pipeline ${p}`, 'wait'] : ['no pipeline', '']);
  const n = (d.approvedBy ?? []).length;
  out.push([`${n} approved`, n ? 'ok' : 'wait']);
  const t = (d.unresolved ?? []).length;
  if (t) out.push([`${t} thread${t > 1 ? 's' : ''}`, 'wait']);
  if (d.mergeStatus === 'conflict') out.push(['conflicts', 'bad']);
  else if (d.mergeStatus === 'need_rebase') out.push(['behind target', 'wait']);
  if (d.target && d.target !== target) out.push([`→ ${d.target}`, '']);
  return out;
}

const BAD = new Set(['failed', 'escalated', 'orphaned', 'pipeline-failed', 'conflicts']);
const GOOD = new Set(['merged', 'rebased', 'pipeline-green', 'review-done', 'question-answered']);
const ATTN = new Set(['question', 'review-requested', 'dashboard-request', 'dashboard-answer']);
export const dotFor = (k) => (BAD.has(k) ? 'bad' : GOOD.has(k) ? 'ok' : ATTN.has(k) ? 'warn' : 'accent');

export const isApproval = (q) => /^approve\b/i.test(q.text);

// Event kinds as words: "pipeline-green" → "pipeline green", with a few clearer names.
const EVENT_WORDS = { dispatched: 'agent started', worker: 'agent finished', 'review-requested': 'review requested', 'dashboard-request': 'requested on the dashboard', 'dashboard-answer': 'answered on the dashboard', 'dashboard-pause': 'paused on the dashboard', status: 'status change' };
export const eventLabel = (kind) => EVENT_WORDS[kind] ?? kind.replace(/-/g, ' ');

// What a running agent is doing, from the item it works on ("Fixing pipeline on web !81").
const STATUS_VERB = { fixing: 'Fixing', rebasing: 'Rebasing', developing: 'Developing', reviewing: 'Handling review on' };
export function agentTask(item) {
  const verb = STATUS_VERB[item.status] ?? 'Working on';
  const what = item.data?.verdict === 'fix-pipeline' && item.status === 'fixing' ? 'pipeline on ' : '';
  return `${verb} ${what}${label(item)}`;
}

// "Next check 14:20" while a tick is scheduled, else "Last check …", else ''.
export function nextCheck(loop) {
  if (loop.nextTickAt && new Date(loop.nextTickAt) > new Date()) return `Next check ${when(loop.nextTickAt)}`;
  return loop.lastTickAt ? `Last check ${when(loop.lastTickAt)}` : '';
}
