// my-day dashboard: read-mostly view of state.db with SSE live updates and web push.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as S from '../lib/db.mjs';
import { loopSettings } from '../lib/config.mjs';
import { resolveRange } from '../lib/range.mjs';
import { createPush } from './push.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string' }, port: { type: 'string' } } });
const dir = resolve(values.dir ?? join(process.cwd(), '.my-day'));
const settings = loopSettings(dir);
const db = S.openDb(join(dir, 'state.db'));
const push = await createPush(dir, settings.pushSubject);
// SELF lets serverctl spot a server still running older / moved code and restart it.
const SELF = fileURLToPath(import.meta.url);
const PUBLIC = join(dirname(SELF), 'public');

// Event kinds that are worth interrupting the user for.
const NOTIFY = {
  'review-requested': 'Review requested',
  question: 'Question for you',
  merged: 'Merged',
  failed: 'Needs attention',
  escalated: 'Escalated',
  notify: 'my-day',
};

const clients = new Set();
const broadcast = (type, data) => {
  for (const res of clients) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
};

// Quick actions a dashboard viewer may ask the loop for. The loop picks them up on its next tick
// (`state.mjs tick` → fromDashboard); the server itself never touches the code host or tracker.
const REQUESTS = ['rebase', 'fix-pipeline', 'fix-review', 'merge', 'retry', 'elaborate'];

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

function state() {
  const items = S.listItems(db).map((i) => ({ ...i, links: S.linksOf(db, i.id) }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const ref = (i) => (i ? { id: i.id, type: i.type, title: i.title, url: i.url, project: i.data?.project ?? null, iid: i.data?.iid ?? null } : null);
  const withHint = (i) => ({ ...i, hint: i.links.length || i.url ? null : `No resources yet — ask in the session: \`elaborate ${i.id}\`.` });
  return {
    dir,
    dryRun: settings.dryRun,
    closedStatuses: S.CLOSED_STATUSES,
    push: push.enabled,
    items,
    reviews: items.filter((i) => i.type === 'review' && !['done', 'skipped', 'covered'].includes(i.status)),
    failed: items.filter((i) => i.failed).map(withHint),
    questions: S.listQuestions(db, { status: 'open' }).map((q) => ({ ...q, item: ref(byId.get(q.item_id)) })),
    finishedToday: S.listEvents(db, { from: startOfToday() })
      .filter((e) => e.kind === 'worker')
      .map((e) => ({ id: e.id, ts: e.ts, message: e.message, status: e.data?.status ?? null, commits: e.data?.commits ?? [], item: ref(byId.get(e.item_id)) })),
    loop: {
      paused: S.getMeta(db, 'paused') === 'true',
      lastTickAt: S.getMeta(db, 'lastTickAt'),
      nextTickAt: S.getMeta(db, 'nextTickAt'),
      workingHours: settings.workingHours,
      workingDays: settings.workingDays,
      maxAgents: settings.maxAgents,
      targetBranch: settings.targetBranch,
    },
    requests: REQUESTS,
    recent: S.listEvents(db, { limit: 50 }),
  };
}

const openQuestion = (qid) => S.listQuestions(db, { status: 'open' }).find((q) => q.id === qid) ?? null;

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const body = (req) =>
  new Promise((ok, bad) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
  });

const STATIC = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/sw.js': ['sw.js', 'text/javascript'] };

const server = createServer(async (req, res) => {
  const port = server.address().port;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return send(res, 403, { error: 'bad host' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !allowedHosts.map((h) => `http://${h}`).includes(origin)) return send(res, 403, { error: 'cross-origin' });
      const m = /^\/api\/reviews\/([\w-]+)\/(done|skip)$/.exec(url.pathname);
      if (m) {
        const item = S.getItem(db, m[1]);
        if (!item || item.type !== 'review') return send(res, 404, { error: `no review ${m[1]}` });
        S.setFields(db, item.id, { status: m[2] === 'done' ? 'done' : 'skipped' });
        S.addEvent(db, { itemId: item.id, kind: `review-${m[2]}`, message: `${item.id} marked ${m[2]} on dashboard` });
        broadcast('change', {});
        return send(res, 200, { ok: true });
      }
      const qa = /^\/api\/questions\/(q-\d+)\/(answer|decline)$/.exec(url.pathname);
      if (qa) {
        const q = openQuestion(qa[1]);
        if (!q) return send(res, 404, { error: `no open question ${qa[1]}` });
        const text = qa[2] === 'answer' ? String((await body(req)).text ?? '').trim().slice(0, 2000) : '';
        if (qa[2] === 'answer' && !text) return send(res, 400, { error: 'answer text required' });
        if (qa[2] === 'answer') S.answer(db, q.id, text); else S.decline(db, q.id);
        S.addEvent(db, { itemId: q.item_id, kind: 'dashboard-answer', message: `${q.id} ${qa[2] === 'answer' ? `answered on dashboard: ${text}` : 'declined on dashboard'}`, data: { questionId: q.id, status: qa[2] === 'answer' ? 'answered' : 'declined', text } });
        broadcast('change', {});
        return send(res, 200, { ok: true });
      }
      const rq = /^\/api\/items\/([\w-]+)\/request$/.exec(url.pathname);
      if (rq) {
        const item = S.getItem(db, rq[1]);
        if (!item) return send(res, 404, { error: `no item ${rq[1]}` });
        const { action } = await body(req);
        if (!REQUESTS.includes(action)) return send(res, 400, { error: `unknown action ${action}` });
        S.addEvent(db, { itemId: item.id, kind: 'dashboard-request', message: `${item.id}: ${action} requested on dashboard`, data: { action } });
        broadcast('change', {});
        return send(res, 200, { ok: true });
      }
      const pz = /^\/api\/loop\/(pause|resume)$/.exec(url.pathname);
      if (pz) {
        S.setMeta(db, 'paused', pz[1] === 'pause' ? 'true' : 'false');
        S.addEvent(db, { kind: 'dashboard-pause', message: `loop ${pz[1] === 'pause' ? 'paused' : 'resumed'} on dashboard`, data: { paused: pz[1] === 'pause' } });
        broadcast('change', {});
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/push/subscribe') {
        const sub = await body(req);
        if (!sub?.endpoint) return send(res, 400, { error: 'subscription required' });
        S.addSubscription(db, sub);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    }
    if (url.pathname === '/health') return send(res, 200, { ok: true, dir, pid: process.pid, push: push.enabled, code: SELF });
    if (url.pathname === '/api/state') return send(res, 200, state());
    if (url.pathname === '/api/summary') {
      const q = Object.fromEntries(url.searchParams);
      return send(res, 200, S.summary(db, resolveRange({ ...q, today: q.today === '1', yesterday: q.yesterday === '1' })));
    }
    if (url.pathname === '/api/push/key') return send(res, 200, { enabled: push.enabled, publicKey: push.publicKey });
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const file = STATIC[url.pathname];
    if (file) return send(res, 200, readFileSync(join(PUBLIC, file[0]), 'utf8'), file[1]);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// Poll for commits from other connections (the session CLI) and fan out.
let lastVersion = S.dataVersion(db);
let lastEventId = S.listEvents(db, { limit: 1 })[0]?.id ?? 0;
setInterval(async () => {
  const v = S.dataVersion(db);
  if (v === lastVersion) return;
  lastVersion = v;
  broadcast('change', {});
  const fresh = S.listEvents(db, { afterId: lastEventId });
  if (fresh.length) lastEventId = fresh.at(-1).id;
  for (const e of fresh) {
    if (!NOTIFY[e.kind]) continue;
    const item = e.item_id ? S.getItem(db, e.item_id) : null;
    const payload = { title: NOTIFY[e.kind], body: e.message, url: item?.url ?? '/', tag: `${e.kind}-${e.item_id ?? e.id}` };
    broadcast('notify', payload);
    await push.send(db, payload);
  }
}, 1000).unref();

setInterval(() => broadcast('ping', {}), 25000).unref();

server.listen(Number(values.port ?? settings.port), '127.0.0.1', () => {
  console.log(`my-day server listening on http://127.0.0.1:${server.address().port} (dir ${dir}, push ${push.enabled ? 'on' : 'off'})`);
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
