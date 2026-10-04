// The machine home (~/.my-day, or $MY_DAY_HOME): which workspaces run a my-day loop, and the one
// dashboard that shows them all (its pid, log, VAPID keys and push subscriptions).
// Workspace stores stay in <workspace>/.my-day; the registry only points at them. Whether a loop
// runs is read from its own store (meta: sessionStartedAt, nextTickAt, stoppedAt).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import * as S from './db.mjs';
import { parseFrontmatter } from './config.mjs';

// A loop counts as running until this long after the wakeup it scheduled (or its session start).
export const GRACE_MS = 15 * 60 * 1000;

export const homeDir = (env = process.env) => resolve(env.MY_DAY_HOME ?? join(homedir(), '.my-day'));
export const loopId = (dir) => createHash('sha256').update(resolve(dir)).digest('hex').slice(0, 12);
const loopsDir = (home) => join(home, 'loops');

// `dir` is the workspace's .my-day folder; the workspace is its parent.
export function register(home, dir) {
  const abs = resolve(dir);
  const id = loopId(abs);
  const file = join(loopsDir(home), `${id}.json`);
  const prev = readJson(file);
  const entry = { id, name: basename(dirname(abs)), workspace: dirname(abs), dir: abs, registeredAt: prev?.registeredAt ?? new Date().toISOString() };
  mkdirSync(loopsDir(home), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(entry, null, 2));
  renameSync(`${file}.tmp`, file);
  return entry;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function listLoops(home) {
  if (!existsSync(loopsDir(home))) return [];
  return readdirSync(loopsDir(home))
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(loopsDir(home), f)))
    .filter((e) => e?.id && e.dir)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// `ref`: a loop id, its workspace or its .my-day folder.
export function forget(home, ref) {
  const abs = resolve(ref);
  const hit = listLoops(home).find((e) => e.id === ref || e.workspace === abs || e.dir === abs);
  if (!hit) return false;
  rmSync(join(loopsDir(home), `${hit.id}.json`), { force: true });
  return true;
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN);

// Stopped = `stop` ran after the session started and after the last tick (a tick after a stop means
// the loop was started again in the same session).
export function loopStatus({ sessionStartedAt, nextTickAt, stoppedAt, lastTickAt } = {}, now = new Date()) {
  const started = ms(sessionStartedAt);
  const stopped = !!stoppedAt && !(started > ms(stoppedAt)) && !(ms(lastTickAt) > ms(stoppedAt));
  const until = Math.max(started + GRACE_MS || 0, ms(nextTickAt) + GRACE_MS || 0);
  return { running: !stopped && until > now.getTime(), stopped };
}

// Machine-wide dashboard settings: ~/.my-day/SETTINGS.md front matter, else the loop's LOOP.md values.
export function homeSettings(home, fallback) {
  const file = join(home, 'SETTINGS.md');
  const own = existsSync(file) ? parseFrontmatter(readFileSync(file, 'utf8')) : {};
  return {
    port: typeof own.port === 'number' ? own.port : fallback.port,
    pushSubject: own.pushSubject || fallback.pushSubject,
  };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// One-time moves from the per-workspace dashboard (before 0.8): VAPID keys (so phones keep their
// subscription), push subscriptions, and the old server process. Idempotent; never edits config.
export function migrate(home, dir) {
  const result = { vapid: false, subscriptions: 0, stoppedOldServer: false };
  // A loop run in ~ has its store in the home itself: its keys are already in place and its pid file
  // is the shared server's, but its subscriptions still have to move to dashboard.db.
  const isHome = resolve(home) === resolve(dir);
  mkdirSync(home, { recursive: true });
  if (!isHome && !existsSync(join(home, '.vapid.json')) && existsSync(join(dir, '.vapid.json'))) {
    copyFileSync(join(dir, '.vapid.json'), join(home, '.vapid.json'));
    result.vapid = true;
  }
  if (existsSync(join(dir, 'state.db'))) {
    const from = S.openDb(join(dir, 'state.db'));
    const subs = S.listSubscriptions(from);
    from.close();
    if (subs.length) {
      const to = S.openDb(join(home, 'dashboard.db'));
      const known = new Set(S.listSubscriptions(to).map((s) => s.endpoint));
      for (const sub of subs) {
        if (known.has(sub.endpoint)) continue;
        S.addSubscription(to, sub);
        result.subscriptions++;
      }
      to.close();
    }
  }
  const pidFile = join(dir, 'server.pid');
  if (!isHome && existsSync(pidFile)) {
    const rec = readJson(pidFile);
    if (rec?.pid && alive(rec.pid)) {
      process.kill(rec.pid, 'SIGTERM');
      result.stoppedOldServer = true;
    }
    rmSync(pidFile, { force: true });
  }
  return result;
}
