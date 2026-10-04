// Start / stop / probe the machine's one dashboard server. `home` is the machine home (~/.my-day);
// the server finds the loops through its registry.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'server.mjs');
const pidFile = (home) => join(home, 'server.pid');

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

function readPid(home) {
  if (!existsSync(pidFile(home))) return null;
  try {
    return JSON.parse(readFileSync(pidFile(home), 'utf8'));
  } catch {
    return null;
  }
}

export async function status(home) {
  const rec = readPid(home);
  if (!rec || !alive(rec.pid)) return { running: false, stale: !!rec };
  const h = await health(rec.port);
  if (!h || h.home !== home) return { running: false, stale: true };
  const outdated = h.code !== SERVER; // started from another install, version or moved folder
  return { running: true, outdated, pid: rec.pid, port: rec.port, url: `http://127.0.0.1:${rec.port}`, push: h.push };
}

// The dashboard before 0.8 ran once per workspace (its /health has `dir`, no `home`). It may still hold
// the port after an update: stop it so the shared server can take over.
async function takeOver(port) {
  const h = await health(port);
  if (!h || h.home || !h.dir || !h.pid || !alive(h.pid)) return;
  process.kill(h.pid, 'SIGTERM');
  for (let i = 0; i < 30 && (await health(port)); i++) await new Promise((r) => setTimeout(r, 100));
}

export async function start(home, { port, pushSubject }) {
  mkdirSync(home, { recursive: true });
  let current = await status(home);
  if (current.running && !current.outdated) return { ...current, started: false };
  if (current.running) {
    await stop(home);
    for (let i = 0; i < 30 && (await health(current.port)); i++) await new Promise((r) => setTimeout(r, 100));
    current = { running: false, stale: false };
  }
  if (current.stale) rmSync(pidFile(home), { force: true });
  await takeOver(port);
  const log = openSync(join(home, 'server.log'), 'a');
  const child = spawn(process.execPath, [SERVER, '--home', home, '--port', String(port), ...(pushSubject ? ['--push-subject', pushSubject] : [])], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  writeFileSync(pidFile(home), JSON.stringify({ pid: child.pid, port }));
  for (let i = 0; i < 50; i++) {
    const s = await status(home);
    if (s.running) return { ...s, started: true };
    if (!alive(child.pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  rmSync(pidFile(home), { force: true });
  throw new Error(`server did not come up on port ${port}; see ${join(home, 'server.log')}`);
}

export async function stop(home) {
  const rec = readPid(home);
  if (rec && alive(rec.pid)) process.kill(rec.pid, 'SIGTERM');
  rmSync(pidFile(home), { force: true });
  return { stopped: !!rec };
}
