// Apply a worker's final report to the state.
import * as S from './db.mjs';
import { extFromUrl } from './forge/url.mjs';

// Accepts the JSON object or the agent's whole last message (uses its last JSON block).
export function parseResult(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw ?? '');
  const fenced = [...text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].at(-1)?.[1];
  const candidates = [fenced, text.slice(text.lastIndexOf('\n{') + 1), text].filter(Boolean);
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch {}
  }
  return null;
}

export function dispatch(db, id, { agent, status }) {
  const fields = { agent_id: agent };
  if (status) fields.status = status;
  S.setFields(db, id, fields);
  const attempts = S.incAttempts(db, id);
  S.addEvent(db, { itemId: id, kind: 'dispatched', message: `${id} → agent ${agent} (attempt ${attempts})` });
  return { id, agent, attempts };
}

export function reconcile(db, id, raw, { retryLimit }) {
  const r = parseResult(raw) ?? { status: 'failed', summary: 'worker returned no parsable JSON result' };
  const fields = { agent_id: '' };
  if (r.branch) fields.branch = r.branch;
  if (r.worktree) fields.worktree = r.worktree;
  S.setFields(db, id, fields);

  // One MR (subagent worker) or one per repo (a claude -p chain): `mrId` is the first.
  let mrId = null;
  for (const url of [...new Set([r.mrUrl, ...(r.mrUrls ?? [])].filter(Boolean))]) {
    S.addLink(db, id, { kind: 'mr', url });
    const ref = extFromUrl(url);
    if (!ref) continue;
    const mr = S.upsertItem(db, { type: 'mr', ext: ref.ext, url, parent: id, data: { project: ref.project, iid: ref.iid } }).id;
    mrId ??= mr;
  }
  for (const l of r.links ?? []) if (l?.url) S.addLink(db, id, { kind: l.kind ?? 'other', url: l.url, label: l.label });
  S.addEvent(db, { itemId: id, kind: 'worker', message: `${id} ${r.status}: ${r.summary ?? ''}`.trim(), data: { status: r.status, commits: r.commits, blockers: r.blockers, handled: r.handled } });

  if (r.status === 'done') return { id, status: 'done', next: 'advance', mrId };
  const { attempts } = S.getItem(db, id);
  const reason = [r.summary, ...(r.blockers ?? [])].filter(Boolean).join(' · ') || r.status;
  if (attempts >= retryLimit) {
    S.fail(db, id, reason);
    S.addEvent(db, { itemId: id, kind: 'escalated', message: `${id} gave up after ${attempts} attempts: ${reason}` });
    return { id, status: r.status, next: 'escalate', attempts, reason };
  }
  return { id, status: r.status, next: 'failure-transition', attempts, reason, mrId };
}
