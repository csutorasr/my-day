#!/usr/bin/env node
// my-day state CLI — the only door to .my-day/state.db. Run with no args for help.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as S from '../lib/db.mjs';
import { resolveRange } from '../lib/range.mjs';
import { REQUIRED, findMissing, readConfig, loopSettings } from '../lib/config.mjs';
import * as server from '../lib/serverctl.mjs';
import { schedule } from '../lib/schedule.mjs';
import { sync } from '../lib/sync.mjs';
import { dispatch, reconcile } from '../lib/reconcile.mjs';

const HELP = `my-day state CLI   (state dir: $MY_DAY_DIR or ./.my-day)

Loop       bootstrap [--new-session]  config check, DB, dashboard, orphaned agents → JSON
           tick                       code-host sync + schedule + what to act on → JSON
           sync | schedule            the two halves of tick
           dispatch <id> --agent <name> [--status s]   record a started worker (attempts++)
           reconcile <id> [--result '<json|message>'] (or stdin)   apply a worker's report

Items      upsert --type bug|story|subtask|mr|review --ext <jira:KEY|gitlab:path!iid> [--title] [--url]
                  [--status] [--parent <id>] [--repos a,b] [--data '{json}']
           upsert-many < items.json  (JSON array of {type,ext,title,url,status,parent,repos,data};
                                      prints [{id,ext,created}])
           get <id|ext> | show <id> | list [--type] [--status] [--failed]
           set <id> key=value …      (status, title, url, branch, worktree, agent_id, parent_id,
                                      repos, attempts, data.<key>; value '' clears)
           attempt <id>              (attempts++)
           fail <id> --reason "…" | unfail <id>
           link <id> --kind mr|pipeline|jira|spec|other --url <url> [--label]
Questions  ask <id|-> "text" | answer <q-n> "text" | decline <q-n> | questions [--status open]
Events     event <id|-> <kind> "message" | events [range] [--item <id>] [--limit n]
Summary    summary [--today|--yesterday|--since D|--from D --to D] | prune [--days n]
Reviews    review done|skip <id>
Config     config missing | config show <NAME> | config all | config settings | config dir
Server     server start | server stop | server status
Debug      init | dump
Add --json to any read for machine output.`;

const { values: opt, positionals: pos } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    type: { type: 'string' }, ext: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' },
    status: { type: 'string' }, parent: { type: 'string' }, repos: { type: 'string' }, data: { type: 'string' },
    failed: { type: 'boolean' }, reason: { type: 'string' }, kind: { type: 'string' }, label: { type: 'string' },
    item: { type: 'string' }, limit: { type: 'string' }, days: { type: 'string' },
    today: { type: 'boolean' }, yesterday: { type: 'boolean' },
    since: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
    json: { type: 'boolean' },
    agent: { type: 'string' }, result: { type: 'string' }, 'new-session': { type: 'boolean' },
  },
});

const dir = resolve(process.env.MY_DAY_DIR ?? join(process.cwd(), '.my-day'));
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const die = (msg) => { console.error(`my-day: ${msg}`); process.exit(1); };
let _db;
const db = () => {
  if (!_db) {
    mkdirSync(dir, { recursive: true });
    _db = S.openDb(join(dir, 'state.db'));
  }
  return _db;
};
const itemRef = (s) => (s === '-' || s === undefined ? undefined : s);
const resolveId = (ref) => {
  const it = S.getItem(db(), ref);
  if (!it) die(`no item ${ref}`);
  return it.id;
};
const range = () => resolveRange(opt);
const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localTime = (iso) => { const d = new Date(iso); return `${localDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function coerceValue(key, v) {
  if (key === 'attempts') return Number(v);
  if (key === 'repos') return v.split(',').map((s) => s.trim()).filter(Boolean);
  if (!key.startsWith('data.')) return v;
  try { return JSON.parse(v); } catch { return v; }
}

const fmtItem = (i) =>
  `${i.id.padEnd(11)} ${(i.failed ? '✖ ' : '') + i.status}`.padEnd(34) + ` ${i.title ?? i.ext_key}${i.url ? `  ${i.url}` : ''}`;

function fmtShow(s) {
  const i = s.item;
  const lines = [
    `${i.id} · ${i.type} · ${i.status}${i.failed ? ` · FAILED: ${i.fail_reason}` : ''}`,
    `  ${i.title ?? ''}  (${i.ext_key})`,
  ];
  if (i.url) lines.push(`  url: ${i.url}`);
  if (i.branch) lines.push(`  branch: ${i.branch}${i.worktree ? `  worktree: ${i.worktree}` : ''}`);
  if (i.repos.length) lines.push(`  repos: ${i.repos.join(', ')}`);
  if (i.agent_id) lines.push(`  agent: ${i.agent_id}`);
  if (i.parent_id) lines.push(`  parent: ${i.parent_id}`);
  lines.push(`  attempts: ${i.attempts}`);
  if (Object.keys(i.data).length) lines.push(`  data: ${JSON.stringify(i.data)}`);
  for (const l of s.links) lines.push(`  [${l.kind}] ${l.label ? l.label + ' ' : ''}${l.url}`);
  if (s.hint) lines.push(`  ${s.hint}`);
  for (const q of s.questions) lines.push(`  ${q.id} (${q.status}) ${q.text}${q.answer ? ` → ${q.answer}` : ''}`);
  if (s.events.length) lines.push('  recent:');
  for (const e of s.events) lines.push(`    ${localTime(e.ts)} ${e.kind}: ${e.message}`);
  return lines.join('\n');
}

function fmtSummary(sum) {
  const lines = [`Summary ${sum.range.from ? localDay(sum.range.from) : '…'} → ${sum.range.to ? localDay(new Date(new Date(sum.range.to).getTime() - 1).toISOString()) : 'now'} (inclusive)`];
  lines.push('By status: ' + (Object.entries(sum.byStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'no items'));
  if (sum.failed.length) {
    lines.push('Failed:');
    for (const f of sum.failed) {
      lines.push(`  ${f.id} ${f.title ?? f.ext_key} — ${f.fail_reason}`);
      for (const l of f.links) lines.push(`      [${l.kind}] ${l.url}`);
      if (f.url && !f.links.length) lines.push(`      ${f.url}`);
      if (f.hint) lines.push(`      ${f.hint}`);
    }
  }
  if (sum.openQuestions.length) {
    lines.push('Open questions:');
    for (const q of sum.openQuestions) lines.push(`  ${q.id}${q.item_id ? ` (${q.item_id})` : ''} ${q.text}`);
  }
  const notable = sum.events.filter((e) => e.kind !== 'created');
  lines.push(`Events (${notable.length}):`);
  for (const e of notable) lines.push(`  ${localTime(e.ts)} ${e.kind}: ${e.message}`);
  return lines.join('\n');
}

const [verb, ...args] = pos;
try {
  switch (verb) {
    case undefined:
    case 'help':
      out(HELP);
      break;
    case 'init':
      db();
      out(`ok ${join(dir, 'state.db')}`);
      break;
    case 'upsert': {
      const r = S.upsertItem(db(), {
        type: opt.type, ext: opt.ext, title: opt.title, url: opt.url, status: opt.status, parent: opt.parent,
        repos: opt.repos ? coerceValue('repos', opt.repos) : undefined,
        data: opt.data ? JSON.parse(opt.data) : undefined,
      });
      opt.json ? out(r) : out(`${r.id}${r.created ? ' (new)' : ''}`);
      break;
    }
    case 'upsert-many': {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      const list = JSON.parse(Buffer.concat(chunks).toString('utf8') || '[]');
      if (!Array.isArray(list)) die('upsert-many expects a JSON array on stdin');
      out(list.map((it) => ({ ...S.upsertItem(db(), it), ext: it.ext })));
      break;
    }
    case 'get': {
      const it = S.getItem(db(), args[0]);
      if (!it) die(`no item ${args[0]}`);
      out(it);
      break;
    }
    case 'show': {
      const s = S.showItem(db(), resolveId(args[0]));
      opt.json ? out(s) : out(fmtShow(s));
      break;
    }
    case 'list': {
      const items = S.listItems(db(), { type: opt.type, status: opt.status, failed: opt.failed ? true : undefined });
      opt.json ? out(items) : out(items.map(fmtItem).join('\n') || '(none)');
      break;
    }
    case 'set': {
      const [ref, ...pairs] = args;
      const fields = {};
      for (const p of pairs) {
        const eq = p.indexOf('=');
        if (eq < 1) die(`expected key=value, got ${p}`);
        const k = p.slice(0, eq);
        fields[k] = coerceValue(k, p.slice(eq + 1));
      }
      const it = S.setFields(db(), resolveId(ref), fields);
      opt.json ? out(it) : out(fmtItem(it));
      break;
    }
    case 'attempt':
      out(String(S.incAttempts(db(), resolveId(args[0]))));
      break;
    case 'fail':
      if (!opt.reason) die('fail needs --reason');
      S.fail(db(), resolveId(args[0]), opt.reason);
      out('ok');
      break;
    case 'unfail':
      S.unfail(db(), resolveId(args[0]));
      out('ok');
      break;
    case 'link':
      if (!opt.kind || !opt.url) die('link needs --kind and --url');
      S.addLink(db(), resolveId(args[0]), { kind: opt.kind, url: opt.url, label: opt.label });
      out('ok');
      break;
    case 'ask': {
      const ref = itemRef(args[0]);
      out(S.ask(db(), ref && resolveId(ref), args.slice(1).join(' ')));
      break;
    }
    case 'answer':
      S.answer(db(), args[0], args.slice(1).join(' '));
      out('ok');
      break;
    case 'decline':
      S.decline(db(), args[0]);
      out('ok');
      break;
    case 'questions': {
      const qs = S.listQuestions(db(), { status: opt.status ?? 'open' });
      opt.json ? out(qs) : out(qs.map((q) => `${q.id}${q.item_id ? ` (${q.item_id})` : ''} ${q.text}`).join('\n') || '(none)');
      break;
    }
    case 'event': {
      const ref = itemRef(args[0]);
      if (!args[1]) die('event needs <id|-> <kind> "message"');
      S.addEvent(db(), { itemId: ref && resolveId(ref), kind: args[1], message: args.slice(2).join(' ') || args[1] });
      out('ok');
      break;
    }
    case 'events': {
      const evs = S.listEvents(db(), { ...range(), itemId: opt.item && resolveId(opt.item), limit: opt.limit ? Number(opt.limit) : undefined });
      opt.json ? out(evs) : out(evs.map((e) => `${localTime(e.ts)} ${e.item_id ?? '-'} ${e.kind}: ${e.message}`).join('\n') || '(none)');
      break;
    }
    case 'summary': {
      const sum = S.summary(db(), range());
      opt.json ? out(sum) : out(fmtSummary(sum));
      break;
    }
    case 'prune': {
      const days = opt.days ? Number(opt.days) : loopSettings(dir).retentionDays;
      out(`pruned ${S.prune(db(), days)} events older than ${days} days`);
      break;
    }
    case 'review': {
      const [action, ref] = args;
      if (!['done', 'skip'].includes(action)) die('review done|skip <id>');
      const id = resolveId(ref);
      S.setFields(db(), id, { status: action === 'done' ? 'done' : 'skipped' });
      out('ok');
      break;
    }
    case 'bootstrap': {
      const missing = findMissing(dir);
      if (missing.length) { out({ missing }); break; }
      const settings = loopSettings(dir);
      const orphans = S.listItems(db()).filter((i) => i.agent_id);
      if (opt['new-session']) {
        for (const o of orphans) {
          S.setFields(db(), o.id, { agent_id: '' });
          S.addEvent(db(), { itemId: o.id, kind: 'orphaned', message: `${o.id}: agent ${o.agent_id} did not survive the session` });
        }
      }
      const srv = await server.start(dir, settings);
      out({ missing: [], dir, server: srv, orphans: orphans.map((o) => o.id), settings });
      break;
    }
    case 'schedule':
      out(schedule(loopSettings(dir), S.listItems(db()).filter((i) => i.agent_id).length));
      break;
    case 'sync':
      out(sync(db(), loopSettings(dir)));
      break;
    case 'tick': {
      const settings = loopSettings(dir);
      let delta;
      try { delta = sync(db(), settings); } catch (e) { delta = { error: e.message }; }
      const items = S.listItems(db());
      // Items waiting on the user (open question) or blocked are not actionable until answered.
      const waiting = new Set(S.listQuestions(db(), { status: 'open' }).map((q) => q.item_id));
      const open = items.filter((i) => !['merged', 'closed', 'done', 'skipped', 'ignored'].includes(i.status) && !i.failed);
      const actionable = open.filter((i) => !waiting.has(i.id) && i.status !== 'blocked');
      const byVerdict = {};
      for (const m of actionable.filter((i) => i.type === 'mr' && !i.agent_id)) {
        const v = m.data.verdict ?? 'unchecked';
        if (v !== 'wait') (byVerdict[v] ??= []).push(m.id);
      }
      out({
        schedule: schedule(settings, items.filter((i) => i.agent_id).length),
        sync: delta,
        act: byVerdict,
        tickets: actionable.filter((i) => ['bug', 'story', 'subtask'].includes(i.type) && !i.agent_id).map((i) => `${i.id}:${i.status}`),
        waitingOnUser: [...waiting].filter(Boolean),
        running: items.filter((i) => i.agent_id).map((i) => `${i.id}:${i.agent_id}`),
        reviewsPending: open.filter((i) => i.type === 'review').length,
        openQuestions: S.listQuestions(db(), { status: 'open' }).map((q) => q.id),
        failed: items.filter((i) => i.failed).map((i) => i.id),
      });
      break;
    }
    case 'dispatch':
      if (!opt.agent) die('dispatch needs --agent');
      out(dispatch(db(), resolveId(args[0]), { agent: opt.agent, status: opt.status }));
      break;
    case 'reconcile': {
      let raw = opt.result;
      if (raw === undefined) { const c = []; for await (const x of process.stdin) c.push(x); raw = Buffer.concat(c).toString('utf8'); }
      out(reconcile(db(), resolveId(args[0]), raw, loopSettings(dir)));
      break;
    }
    case 'dump':
      out(S.dump(db()));
      break;
    case 'config': {
      const [sub, name] = args;
      if (sub === 'missing') out(findMissing(dir).join('\n'));
      else if (sub === 'show') out(readConfig(dir, name).text || die(`no ${name}.md in ${dir}`));
      else if (sub === 'all') out(REQUIRED.map((n) => `# ===== ${n} =====\n${readConfig(dir, n).text}`).join('\n\n'));
      else if (sub === 'settings') out(loopSettings(dir));
      else if (sub === 'dir') out(dir);
      else die('config missing|show <NAME>|all|settings|dir');
      break;
    }
    case 'server': {
      const [sub] = args;
      if (sub === 'start') out(await server.start(dir, loopSettings(dir)));
      else if (sub === 'stop') out(await server.stop(dir));
      else if (sub === 'status') out(await server.status(dir));
      else die('server start|stop|status');
      break;
    }
    default:
      die(`unknown command ${verb}\n\n${HELP}`);
  }
} catch (e) {
  die(e.message);
}
