// State store for my-day. The only module that touches state.db.
import { DatabaseSync } from 'node:sqlite';

export const TYPES = ['bug', 'story', 'subtask', 'mr', 'review'];
// Terminal statuses: no further work, kept only for history. The dashboard reads this list from /api/state.
export const CLOSED_STATUSES = ['merged', 'closed', 'done', 'skipped', 'ignored'];
const COLUMNS = ['title', 'url', 'status', 'repos', 'branch', 'worktree', 'agent_id', 'parent_id', 'attempts'];

const MIGRATIONS = [
  `CREATE TABLE items (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     ext_key TEXT UNIQUE NOT NULL,
     title TEXT, url TEXT,
     status TEXT NOT NULL DEFAULT 'new',
     failed INTEGER NOT NULL DEFAULT 0,
     fail_reason TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     repos TEXT NOT NULL DEFAULT '[]',
     branch TEXT, worktree TEXT, agent_id TEXT, parent_id TEXT,
     data TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE links (
     item_id TEXT NOT NULL REFERENCES items(id),
     kind TEXT NOT NULL, url TEXT NOT NULL, label TEXT,
     PRIMARY KEY (item_id, url));
   CREATE TABLE questions (
     id TEXT PRIMARY KEY, item_id TEXT REFERENCES items(id),
     text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
     answer TEXT, created_at TEXT NOT NULL, answered_at TEXT);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL, item_id TEXT, kind TEXT NOT NULL,
     message TEXT NOT NULL, data TEXT);
   CREATE INDEX events_ts ON events(ts);
   CREATE INDEX events_item ON events(item_id);
   CREATE TABLE counters (type TEXT PRIMARY KEY, next INTEGER NOT NULL);
   CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL);`,
];

const now = () => new Date().toISOString();

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function nextId(db, type) {
  db.prepare('INSERT INTO counters(type, next) VALUES (?, 1) ON CONFLICT(type) DO UPDATE SET next = next + 1').run(type);
  return `${type === 'question' ? 'q' : type}-${db.prepare('SELECT next FROM counters WHERE type = ?').get(type).next}`;
}

function hydrate(row) {
  if (!row) return null;
  return { ...row, failed: !!row.failed, repos: JSON.parse(row.repos), data: JSON.parse(row.data) };
}

function mustGet(db, id) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!row) throw new Error(`no item ${id}`);
  return hydrate(row);
}

function event(db, itemId, kind, message, data, ts = now()) {
  db.prepare('INSERT INTO events(ts, item_id, kind, message, data) VALUES (?, ?, ?, ?, ?)')
    .run(ts, itemId ?? null, kind, message, data === undefined ? null : JSON.stringify(data));
}

export function upsertItem(db, { type, ext, title, url, status, parent, repos, data }) {
  if (!TYPES.includes(type)) throw new Error(`unknown type ${type} (expected ${TYPES.join('|')})`);
  if (!ext) throw new Error('ext key required, e.g. jira:ABC-123 or gitlab:group/repo!12');
  return tx(db, () => {
    const existing = db.prepare('SELECT * FROM items WHERE ext_key = ?').get(ext);
    const ts = now();
    if (existing) {
      const merged = { ...JSON.parse(existing.data), ...(data ?? {}) };
      db.prepare(`UPDATE items SET title = coalesce(?, title), url = coalesce(?, url),
                  parent_id = coalesce(?, parent_id), repos = coalesce(?, repos), data = ?, updated_at = ? WHERE id = ?`)
        .run(title ?? null, url ?? null, parent ?? null, repos ? JSON.stringify(repos) : null, JSON.stringify(merged), ts, existing.id);
      return { id: existing.id, created: false };
    }
    const id = nextId(db, type);
    db.prepare(`INSERT INTO items(id, type, ext_key, title, url, status, parent_id, repos, data, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, type, ext, title ?? null, url ?? null, status ?? 'new', parent ?? null,
        JSON.stringify(repos ?? []), JSON.stringify(data ?? {}), ts, ts);
    event(db, id, 'created', `${id} ${title ?? ext}`);
    return { id, created: true };
  });
}

export const getItem = (db, id) => hydrate(db.prepare('SELECT * FROM items WHERE id = ? OR ext_key = ?').get(id, id));

export function listItems(db, { type, status, failed } = {}) {
  const where = [];
  const args = [];
  if (type) { where.push('type = ?'); args.push(type); }
  if (status) { where.push('status = ?'); args.push(status); }
  if (failed !== undefined) { where.push('failed = ?'); args.push(failed ? 1 : 0); }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY type, CAST(substr(id, instr(id, '-') + 1) AS INTEGER)`;
  return db.prepare(sql).all(...args).map(hydrate);
}

export function setFields(db, id, fields) {
  return tx(db, () => {
    const item = mustGet(db, id);
    const sets = [];
    const args = [];
    let data = item.data;
    let dataChanged = false;
    for (const [key, raw] of Object.entries(fields)) {
      if (key.startsWith('data.')) {
        data = { ...data, [key.slice(5)]: raw };
        dataChanged = true;
      } else if (COLUMNS.includes(key)) {
        const value = key === 'repos' && Array.isArray(raw) ? JSON.stringify(raw) : raw;
        sets.push(`${key} = ?`);
        args.push(value === '' ? null : value);
      } else {
        throw new Error(`unknown field ${key} (allowed: ${COLUMNS.join(', ')}, data.<key>)`);
      }
    }
    if (dataChanged) { sets.push('data = ?'); args.push(JSON.stringify(data)); }
    sets.push('updated_at = ?');
    args.push(now());
    db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...args, item.id);
    if (fields.status !== undefined && fields.status !== item.status) {
      event(db, item.id, 'status', `${item.id}: ${item.status} → ${fields.status}`);
    }
    return mustGet(db, item.id);
  });
}

export function incAttempts(db, id) {
  mustGet(db, id);
  db.prepare('UPDATE items SET attempts = attempts + 1, updated_at = ? WHERE id = ?').run(now(), id);
  return mustGet(db, id).attempts;
}

export function fail(db, id, reason) {
  tx(db, () => {
    mustGet(db, id);
    db.prepare('UPDATE items SET failed = 1, fail_reason = ?, updated_at = ? WHERE id = ?').run(reason, now(), id);
    event(db, id, 'failed', `${id} failed: ${reason}`);
  });
}

export function unfail(db, id) {
  tx(db, () => {
    mustGet(db, id);
    db.prepare('UPDATE items SET failed = 0, fail_reason = NULL, updated_at = ? WHERE id = ?').run(now(), id);
    event(db, id, 'unfailed', `${id} retried`);
  });
}

export function addLink(db, id, { kind, url, label }) {
  mustGet(db, id);
  db.prepare('INSERT INTO links(item_id, kind, url, label) VALUES (?, ?, ?, ?) ON CONFLICT(item_id, url) DO NOTHING')
    .run(id, kind, url, label ?? null);
}

export function ask(db, itemId, text) {
  return tx(db, () => {
    if (itemId) mustGet(db, itemId);
    const id = nextId(db, 'question');
    db.prepare('INSERT INTO questions(id, item_id, text, created_at) VALUES (?, ?, ?, ?)').run(id, itemId ?? null, text, now());
    event(db, itemId, 'question', `${id}: ${text}`, { questionId: id });
    return id;
  });
}

function closeQuestion(db, qid, status, answer) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(qid);
  if (!q) throw new Error(`no question ${qid}`);
  db.prepare('UPDATE questions SET status = ?, answer = ?, answered_at = ? WHERE id = ?').run(status, answer ?? null, now(), qid);
  event(db, q.item_id, `question-${status}`, `${qid}: ${answer ?? status}`);
}

export const answer = (db, qid, text) => closeQuestion(db, qid, 'answered', text);
export const decline = (db, qid) => closeQuestion(db, qid, 'declined');

export function listQuestions(db, { status, itemId } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (itemId) { where.push('item_id = ?'); args.push(itemId); }
  return db.prepare(`SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CAST(substr(id, 3) AS INTEGER)`).all(...args);
}

export function addEvent(db, { itemId, kind, message, data, ts }) {
  if (itemId) mustGet(db, itemId);
  event(db, itemId, kind, message, data, ts);
}

export function listEvents(db, { from, to, itemId, afterId, limit } = {}) {
  const where = [];
  const args = [];
  if (from) { where.push('ts >= ?'); args.push(from); }
  if (to) { where.push('ts < ?'); args.push(to); }
  if (itemId) { where.push('item_id = ?'); args.push(itemId); }
  if (afterId !== undefined) { where.push('id > ?'); args.push(afterId); }
  const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ${limit ? 'DESC LIMIT ' + Number(limit) : ''}`;
  const rows = db.prepare(sql).all(...args).map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
  return limit ? rows.reverse() : rows;
}

export const linksOf = (db, id) => db.prepare('SELECT kind, url, label FROM links WHERE item_id = ?').all(id);

export function showItem(db, id) {
  const item = getItem(db, id);
  if (!item) throw new Error(`no item ${id}`);
  const links = linksOf(db, item.id);
  return {
    item,
    links,
    questions: listQuestions(db, { itemId: item.id }),
    events: listEvents(db, { itemId: item.id, limit: 20 }),
    hint: links.length || item.url ? null : `No resources yet — ask in the session: \`elaborate ${item.id}\`.`,
  };
}

export function summary(db, { from, to } = {}) {
  const items = listItems(db);
  const byStatus = {};
  for (const it of items) byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
  const failed = items.filter((i) => i.failed).map((i) => ({
    ...i,
    links: linksOf(db, i.id),
    hint: linksOf(db, i.id).length || i.url ? null : `No resources yet — ask in the session: \`elaborate ${i.id}\`.`,
  }));
  return {
    range: { from: from ?? null, to: to ?? null },
    byStatus,
    failed,
    openQuestions: listQuestions(db, { status: 'open' }),
    events: listEvents(db, { from, to }),
  };
}

export function prune(db, days, at = new Date()) {
  const cutoff = new Date(at.getTime() - days * 86400000).toISOString();
  return Number(db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes);
}

export function addSubscription(db, sub) {
  db.prepare('INSERT INTO push_subscriptions(endpoint, json, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json')
    .run(sub.endpoint, JSON.stringify(sub), now());
}
export const listSubscriptions = (db) => db.prepare('SELECT json FROM push_subscriptions').all().map((r) => JSON.parse(r.json));
export const removeSubscription = (db, endpoint) => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);

export const dataVersion = (db) => db.prepare('PRAGMA data_version').get().data_version;

export function dump(db) {
  return {
    items: listItems(db).map((i) => ({ ...i, links: linksOf(db, i.id) })),
    questions: listQuestions(db),
    events: listEvents(db, { limit: 500 }),
  };
}
