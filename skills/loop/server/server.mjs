// my-day dashboard: one per machine. Read-mostly view of every registered loop's state.db
// (~/.my-day/loops → <workspace>/.my-day/state.db) with SSE live updates and web push.
import { createServer } from 'node:http';
import { existsSync, readFileSync, watch } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as S from '../lib/db.mjs';
import { DEFAULTS, loopSettings } from '../lib/config.mjs';
import { homeDir, homeSettings, listLoops, loopStatus } from '../lib/home.mjs';
import { listChains } from '../lib/runs.mjs';
import { resolveRange } from '../lib/range.mjs';
import { createPush } from './push.mjs';

const { values } = parseArgs({ options: { home: { type: 'string' }, port: { type: 'string' }, 'push-subject': { type: 'string' } } });
const home = resolve(values.home ?? homeDir());
const settings = homeSettings(home, DEFAULTS);
const dash = S.openDb(join(home, 'dashboard.db'));
const push = await createPush(home, values['push-subject'] ?? settings.pushSubject);
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
// `stop` ends a claude -p chain: the loop kills it (`state.mjs run-stop`), never this server.
const REQUESTS = ['rebase', 'fix-pipeline', 'fix-review', 'merge', 'retry', 'elaborate', 'stop'];

// ---- loops: the registry entries, each with its store opened on first use.
// A loop whose store is missing or unreadable carries `error` and is skipped, never fatal.
const loops = new Map();

function openLoop(entry) {
  const known = loops.get(entry.id);
  // Reuse an open store or a known failure; retry once a missing store appears.
  if (known && known.dir === entry.dir && (known.db || !existsSync(join(entry.dir, 'state.db')) || known.error?.startsWith('cannot open'))) return known;
  known?.db?.close();
  const loop = { ...entry, db: null, error: null };
  if (!existsSync(join(entry.dir, 'state.db'))) loop.error = `no store at ${entry.dir}`;
  else {
    try {
      loop.db = S.openDb(join(entry.dir, 'state.db'));
      loop.version = S.dataVersion(loop.db);
      loop.lastEventId = S.listEvents(loop.db, { limit: 1 })[0]?.id ?? 0;
    } catch (e) {
      loop.error = `cannot open ${entry.dir}: ${e.message}`;
    }
  }
  loops.set(entry.id, loop);
  return loop;
}

function refreshLoops() {
  const entries = listLoops(home);
  const ids = new Set(entries.map((e) => e.id));
  let changed = false;
  for (const [id, l] of loops) {
    if (!ids.has(id)) { l.db?.close(); loops.delete(id); changed = true; }
  }
  for (const e of entries) {
    const before = loops.get(e.id);
    const after = openLoop(e);
    if (before !== after) changed = true;
  }
  if (changed) broadcast('change', {});
}

const meta = (l) => ({
  sessionStartedAt: S.getMeta(l.db, 'sessionStartedAt'),
  nextTickAt: S.getMeta(l.db, 'nextTickAt'),
  stoppedAt: S.getMeta(l.db, 'stoppedAt'),
  lastTickAt: S.getMeta(l.db, 'lastTickAt'),
});

// A store can break after it was opened (damaged file, a lock past the busy timeout): mark that loop
// with the error and keep serving the others.
function broken(l, e) {
  try { l.db?.close(); } catch {}
  l.db = null;
  l.error = `cannot open ${l.dir}: ${e.message}`;
}

function summaryOf(l) {
  try {
    return summaryOfOpen(l);
  } catch (e) {
    broken(l, e);
    return summaryOfOpen(l);
  }
}

function summaryOfOpen(l) {
  const base = { id: l.id, name: l.name, workspace: l.workspace };
  if (!l.db) return { ...base, running: false, stopped: false, paused: false, error: l.error, counts: { questions: 0, failed: 0, reviews: 0 } };
  const items = S.listItems(l.db);
  return {
    ...base,
    ...loopStatus(meta(l)),
    paused: S.getMeta(l.db, 'paused') === 'true',
    counts: {
      questions: S.listQuestions(l.db, { status: 'open' }).length,
      failed: items.filter((i) => i.failed).length,
      reviews: items.filter(openReview).length,
    },
  };
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const openReview = (i) => i.type === 'review' && !['done', 'skipped', 'covered'].includes(i.status);

function stateOf(l) {
  const db = l.db;
  const conf = loopSettings(l.dir);
  const items = S.listItems(db).map((i) => ({ ...i, links: S.linksOf(db, i.id) }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const ref = (i) => (i ? { id: i.id, type: i.type, title: i.title, url: i.url, project: i.data?.project ?? null, iid: i.data?.iid ?? null } : null);
  const withHint = (i) => ({ ...i, hint: i.links.length || i.url ? null : `No resources yet. Ask in the session: \`elaborate ${i.id}\`.` });
  return {
    ...summaryOf(l),
    dir: l.dir,
    dryRun: conf.dryRun,
    closedStatuses: S.CLOSED_STATUSES,
    push: push.enabled,
    items,
    reviews: items.filter(openReview),
    failed: items.filter((i) => i.failed).map(withHint),
    questions: S.listQuestions(db, { status: 'open' }).map((q) => ({ ...q, item: ref(byId.get(q.item_id)) })),
    // claude -p chains (runner: claude-p) that run now or ended today; process details stay local.
    runs: listChains(l.dir)
      .filter((c) => c.status === 'running' || (c.endedAt ?? '') >= startOfToday())
      .map((c) => ({ id: c.id, item: c.item, kind: c.kind, status: c.status, startedAt: c.startedAt, endedAt: c.endedAt, steps: c.steps.map(({ repo, status, startedAt, endedAt }) => ({ repo, status, startedAt: startedAt ?? null, endedAt: endedAt ?? null })) })),
    finishedToday: S.listEvents(db, { from: startOfToday() })
      .filter((e) => e.kind === 'worker')
      .map((e) => ({ id: e.id, ts: e.ts, message: e.message, status: e.data?.status ?? null, commits: e.data?.commits ?? [], item: ref(byId.get(e.item_id)) })),
    loop: {
      paused: S.getMeta(db, 'paused') === 'true',
      lastTickAt: S.getMeta(db, 'lastTickAt'),
      nextTickAt: S.getMeta(db, 'nextTickAt'),
      workingHours: conf.workingHours,
      workingDays: conf.workingDays,
      maxAgents: conf.maxAgents,
      targetBranch: conf.targetBranch,
    },
    requests: REQUESTS,
    recent: S.listEvents(db, { limit: 50 }),
  };
}

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

// The dashboard UI is a Vite build (skills/loop/ui) committed into public/: index.html, sw.js and
// content-hashed files under assets/. Anything else under public/ is not served.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

function staticFile(pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!(rel === 'index.html' || rel === 'sw.js' || /^assets\/[\w.-]+$/.test(rel))) return null;
  const type = TYPES[extname(rel)];
  const file = join(PUBLIC, rel);
  if (!type || !file.startsWith(PUBLIC + sep) || !existsSync(file)) return null;
  // Hashed assets never change under the same name; the page and the worker must always revalidate.
  return { body: readFileSync(file), type, cache: rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store' };
}

// POST /api/loops/:loop/… — the same actions as before 0.8, against that loop's store.
async function loopAction(req, res, db, rest) {
  const m = /^\/reviews\/([\w-]+)\/(done|skip)$/.exec(rest);
  if (m) {
    const item = S.getItem(db, m[1]);
    if (!item || item.type !== 'review') return send(res, 404, { error: `no review ${m[1]}` });
    S.setFields(db, item.id, { status: m[2] === 'done' ? 'done' : 'skipped' });
    S.addEvent(db, { itemId: item.id, kind: `review-${m[2]}`, message: `${item.id} marked ${m[2]} on dashboard` });
    return done(res);
  }
  const qa = /^\/questions\/(q-\d+)\/(answer|decline)$/.exec(rest);
  if (qa) {
    const q = S.listQuestions(db, { status: 'open' }).find((x) => x.id === qa[1]);
    if (!q) return send(res, 404, { error: `no open question ${qa[1]}` });
    // Answer text is required; a decline may carry an optional reason.
    const text = String((await body(req)).text ?? '').trim().slice(0, 2000);
    if (qa[2] === 'answer' && !text) return send(res, 400, { error: 'answer text required' });
    if (qa[2] === 'answer') S.answer(db, q.id, text); else S.decline(db, q.id, text);
    const what = qa[2] === 'answer' ? `answered on dashboard: ${text}` : `declined on dashboard${text ? `: ${text}` : ''}`;
    S.addEvent(db, { itemId: q.item_id, kind: 'dashboard-answer', message: `${q.id} ${what}`, data: { questionId: q.id, status: qa[2] === 'answer' ? 'answered' : 'declined', text } });
    return done(res);
  }
  const rq = /^\/items\/([\w-]+)\/request$/.exec(rest);
  if (rq) {
    const item = S.getItem(db, rq[1]);
    if (!item) return send(res, 404, { error: `no item ${rq[1]}` });
    const { action } = await body(req);
    if (!REQUESTS.includes(action)) return send(res, 400, { error: `unknown action ${action}` });
    S.addEvent(db, { itemId: item.id, kind: 'dashboard-request', message: `${item.id}: ${action} requested on dashboard`, data: { action } });
    return done(res);
  }
  const pz = /^\/(pause|resume)$/.exec(rest);
  if (pz) {
    S.setMeta(db, 'paused', pz[1] === 'pause' ? 'true' : 'false');
    S.addEvent(db, { kind: 'dashboard-pause', message: `loop ${pz[1] === 'pause' ? 'paused' : 'resumed'} on dashboard`, data: { paused: pz[1] === 'pause' } });
    return done(res);
  }
  return send(res, 404, { error: 'not found' });
}

function done(res) {
  broadcast('change', {});
  send(res, 200, { ok: true });
}

// The loop a /api/loops/:id/… route names, or a 404 already sent.
function loopFor(res, id) {
  refreshLoops();
  const l = loops.get(id);
  if (!l) { send(res, 404, { error: `no loop ${id}` }); return null; }
  if (!l.db) { send(res, 404, { error: l.error }); return null; }
  return l;
}

const server = createServer(async (req, res) => {
  const port = server.address().port;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return send(res, 403, { error: 'bad host' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const scoped = /^\/api\/loops\/([0-9a-f]{12})(\/.*)$/.exec(url.pathname);
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !allowedHosts.map((h) => `http://${h}`).includes(origin)) return send(res, 403, { error: 'cross-origin' });
      if (scoped) {
        const l = loopFor(res, scoped[1]);
        return l && loopAction(req, res, l.db, scoped[2]);
      }
      if (url.pathname === '/api/push/subscribe') {
        const sub = await body(req);
        if (!sub?.endpoint) return send(res, 400, { error: 'subscription required' });
        S.addSubscription(dash, sub);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    }
    if (url.pathname === '/health') return send(res, 200, { ok: true, home, pid: process.pid, push: push.enabled, code: SELF });
    if (url.pathname === '/api/loops') {
      refreshLoops();
      return send(res, 200, [...loops.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(summaryOf));
    }
    if (url.pathname === '/api/state') {
      refreshLoops();
      const asked = url.searchParams.get('loops');
      const usable = [...loops.values()].filter((l) => l.db).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      let pick;
      if (asked !== null) {
        const ids = asked.split(',').filter(Boolean);
        pick = ids.map((id) => loops.get(id)).filter((l) => l?.db);
      } else {
        // Default: the running loops; none running → all of them, so the page is never empty for no reason.
        const running = usable.filter((l) => summaryOf(l).running);
        pick = running.length ? running : usable;
      }
      const out = [];
      for (const l of pick) {
        try { out.push(stateOf(l)); } catch (e) { broken(l, e); }
      }
      return send(res, 200, { loops: out });
    }
    if (scoped && scoped[2] === '/summary') {
      const l = loopFor(res, scoped[1]);
      if (!l) return;
      // (errors here end up as a 500 for this one request only)
      const q = Object.fromEntries(url.searchParams);
      return send(res, 200, S.summary(l.db, resolveRange({ ...q, today: q.today === '1', yesterday: q.yesterday === '1' })));
    }
    if (url.pathname === '/api/push/key') return send(res, 200, { enabled: push.enabled, publicKey: push.publicKey });
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const file = req.method === 'GET' && staticFile(url.pathname);
    if (file) {
      res.writeHead(200, { 'content-type': file.type, 'cache-control': file.cache });
      return res.end(file.body);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// Poll every loop's store for commits from other connections (the loop sessions' CLI) and fan out.
setInterval(async () => {
  const many = loops.size > 1;
  for (const l of [...loops.values()]) {
    try {
      await pollLoop(l, many);
    } catch (e) {
      // Closed under us (loop forgotten / moved) or broken: only that loop is affected.
      if (loops.get(l.id) === l) broken(l, e);
    }
  }
}, 1000).unref();

async function pollLoop(l, many) {
  {
    if (!l.db) return;
    const v = S.dataVersion(l.db);
    if (v === l.version) return;
    l.version = v;
    broadcast('change', {});
    const fresh = S.listEvents(l.db, { afterId: l.lastEventId });
    if (fresh.length) l.lastEventId = fresh.at(-1).id;
    for (const e of fresh) {
      if (!NOTIFY[e.kind]) continue;
      const item = e.item_id ? S.getItem(l.db, e.item_id) : null;
      const title = many ? `${l.name} · ${NOTIFY[e.kind]}` : NOTIFY[e.kind];
      const payload = { title, body: e.message, url: item?.url ?? '/', tag: `${l.id}-${e.kind}-${e.item_id ?? e.id}` };
      broadcast('notify', payload);
      await push.send(dash, payload);
    }
  }
}

// New or removed loops: watch the registry folder, and rescan in case the watch misses one.
refreshLoops();
try { watch(join(home, 'loops'), () => refreshLoops()).unref(); } catch { /* folder appears with the first registration */ }
setInterval(refreshLoops, 5000).unref();
setInterval(() => broadcast('ping', {}), 25000).unref();

server.listen(Number(values.port ?? settings.port), '127.0.0.1', () => {
  console.log(`my-day server listening on http://127.0.0.1:${server.address().port} (home ${home}, push ${push.enabled ? 'on' : 'off'})`);
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); for (const l of loops.values()) l.db?.close(); dash.close(); process.exit(0); });
