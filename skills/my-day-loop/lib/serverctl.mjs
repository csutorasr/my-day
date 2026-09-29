// Start / stop / probe the dashboard server for a .my-day directory.
import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'server.mjs');
const pidFile = (dir) => join(dir, 'server.pid');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function readPid(dir) {
  if (!existsSync(pidFile(dir))) return null;
  try {
    return JSON.parse(readFileSync(pidFile(dir), 'utf8'));
  } catch {
    return null;
  }
}

export async function status(dir) {
  const rec = readPid(dir);
  if (!rec || !alive(rec.pid)) return { running: false, stale: !!rec };
  const h = await health(rec.port);
  if (!h || h.dir !== dir) return { running: false, stale: true };
  return { running: true, pid: rec.pid, port: rec.port, url: `http://127.0.0.1:${rec.port}`, push: h.push };
}

export async function start(dir, { port }) {
  const current = await status(dir);
  if (current.running) return { ...current, started: false };
  if (current.stale) rmSync(pidFile(dir), { force: true });
  const log = openSync(join(dir, 'server.log'), 'a');
  const child = spawn(process.execPath, [SERVER, '--dir', dir, '--port', String(port)], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  writeFileSync(pidFile(dir), JSON.stringify({ pid: child.pid, port }));
  for (let i = 0; i < 50; i++) {
    const s = await status(dir);
    if (s.running) return { ...s, started: true };
    if (!alive(child.pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  rmSync(pidFile(dir), { force: true });
  throw new Error(`server did not come up on port ${port}; see ${join(dir, 'server.log')}`);
}

export async function stop(dir) {
  const rec = readPid(dir);
  if (rec && alive(rec.pid)) process.kill(rec.pid, 'SIGTERM');
  rmSync(pidFile(dir), { force: true });
  return { stopped: !!rec };
}
