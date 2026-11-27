// The claude -p runner (`runner: claude-p`): workers as detached `claude -p` processes, one per repo,
// each started in that repo's worktree so the folder's CLAUDE.md, settings, skills and MCP apply.
// A chain = one item's runs in cross-repo order, tracked in .my-day/runs/<item>-<attempt>.json.
// Processes outlive the session; `tick` collects finished steps and reconciles the item at the end.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from './db.mjs';
import { dispatch, parseResult, reconcile } from './reconcile.mjs';
import { isHostVar } from './t3.mjs';

const runsDir = (dir) => join(dir, 'runs');
const TAIL = 2048;
const KILL_GRACE_MS = 2000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const readText = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

function writeChain(dir, chain) {
  mkdirSync(runsDir(dir), { recursive: true });
  const file = join(runsDir(dir), `${chain.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(chain, null, 2));
  renameSync(`${file}.tmp`, file);
}

export function listChains(dir) {
  if (!existsSync(runsDir(dir))) return [];
  return readdirSync(runsDir(dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(runsDir(dir), f), 'utf8')); } catch { return null; } })
    .filter((c) => c?.id && Array.isArray(c.steps))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// `ps` state and start time of a pid; null when it is gone, undefined when there is no usable `ps`
// (slim images ship without procps). The start time pins a pid against reuse.
function proc(pid) {
  try {
    // C locale and UTC: the run and the tick that checks it print the same start time.
    const line = execFileSync(process.env.MY_DAY_PS || 'ps', ['-o', 'stat=,lstart=', '-p', String(pid)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
    }).trim();
    const m = /^(\S+)\s+(.*)$/.exec(line);
    return m ? { stat: m[1], lstart: m[2].trim() } : null;
  } catch (e) {
    return e.code === 'ENOENT' ? undefined : null;
  }
}
const procStart = (pid) => proc(pid)?.lstart ?? '';

function signalable(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Running = the pid exists, is not a zombie (exited, not yet reaped) and started when the run did.
// Without `ps`, only whether the pid exists can be checked.
export function alive(step) {
  if (!step?.pid) return false;
  const p = proc(step.pid);
  if (p === undefined) return signalable(step.pid);
  return !!p && !p.stat.startsWith('Z') && p.lstart === step.lstart;
}

// SIGTERM to the run's process group, SIGKILL if it is still there after a short grace.
// The group's other processes (test runners, MCP servers) get SIGKILL even when claude itself left.
function kill(step) {
  if (alive(step)) {
    try { process.kill(-step.pid, 'SIGTERM'); } catch {}
    for (let waited = 0; waited < KILL_GRACE_MS && alive(step); waited += 100) sleepSync(100);
  }
  try { process.kill(-step.pid, 'SIGKILL'); } catch {}
}

const oneLine = (t) => String(t ?? '').replace(/\s*\n\s*/g, ' ');

const previousLine = (p) => {
  const r = p.result ?? {};
  const line = [p.status, r.branch && `branch ${r.branch}`, r.mrUrl, r.summary].filter(Boolean).join(' · ');
  return `- ${p.repo}: ${oneLine(line)}`;
};

export function workerPrompt({ kind, workspace, item, dryRun, task, repo, worktree, previous = [] }) {
  return [
    'Invoke the Skill tool with "my-day:worker" and follow it.',
    `Kind: ${kind}`,
    `Workspace root: ${workspace}`,
    `Item: ${item}`,
    `Dry run: ${dryRun ? 'true' : 'false'}`,
    `Repo: ${repo}`,
    `Worktree: ${worktree}`,
    '(The worktree exists and is your working directory: work there, do not create another one.)',
    ...(previous.length ? ['Previous runs (earlier repos of this ticket, in order):', ...previous.map(previousLine)] : []),
    `Task: ${oneLine(task)}`,
  ].join('\n');
}

const workerEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !isHostVar(k)));

// Start step `idx` of the chain (mutates it); returns the child process, or null when it could not start.
function spawnStep(dir, chain, idx, settings) {
  const step = chain.steps[idx];
  const base = `${chain.id}.${step.repo}`;
  const prompt = workerPrompt({
    kind: chain.kind, workspace: chain.workspace, item: chain.item, dryRun: chain.dryRun, task: chain.task,
    repo: step.repo, worktree: step.cwd, previous: chain.steps.slice(0, idx),
  });
  mkdirSync(runsDir(dir), { recursive: true });
  writeFileSync(join(runsDir(dir), `${base}.prompt`), prompt);
  step.out = `runs/${base}.out`;
  step.err = `runs/${base}.err`;
  step.startedAt = new Date().toISOString();
  const out = openSync(join(dir, step.out), 'w');
  const err = openSync(join(dir, step.err), 'w');
  const bin = process.env.CLAUDE_BIN || settings.claudeBin || 'claude';
  let child;
  try {
    child = spawn(bin, ['-p', prompt, '--permission-mode', String(settings.permissionMode ?? 'acceptEdits'), '--output-format', 'json'], {
      // The worker runs `$SM` from the worktree: point it at this loop's store. A run is not the
      // loop's T3 Code thread, even when the loop runs in one: it gets none of the host's variables.
      cwd: step.cwd, detached: true, stdio: ['ignore', out, err], env: { ...workerEnv(), MY_DAY_DIR: dir },
    });
  } catch (e) {
    child = { pid: undefined, error: e };
  } finally {
    closeSync(out);
    closeSync(err);
  }
  child.on?.('error', () => {});
  if (!child.pid) {
    step.status = 'failed';
    step.endedAt = new Date().toISOString();
    step.result = { status: 'failed', summary: `cannot start ${bin}: ${child.error?.code ?? 'ENOENT'}` };
    return null;
  }
  child.unref?.();
  step.pid = child.pid;
  step.lstart = procStart(child.pid);
  step.status = 'running';
  return child;
}

// The worker's report from a finished step: the `result` text of --output-format json (or the raw
// output), last JSON block wins.
function readResult(dir, step) {
  const raw = readText(join(dir, step.out ?? ''));
  let text = raw;
  try {
    // --output-format json prints one result object; with --verbose, an array of messages ending in it.
    const j = JSON.parse(raw);
    const res = Array.isArray(j) ? j.findLast((m) => m?.type === 'result') : j;
    if (typeof res?.result === 'string') text = res.result;
  } catch {}
  const r = raw.trim() ? parseResult(text) : null;
  if (r && typeof r.status === 'string') return r;
  const tail = `${text}\n${readText(join(dir, step.err ?? ''))}`.trim().slice(-TAIL);
  return { status: 'failed', summary: 'run ended without a result', tail };
}

// One result for the item from every step that ran.
function combined(chain) {
  const ran = chain.steps.filter((s) => s.result);
  const results = ran.map((s) => s.result);
  const last = results.at(-1) ?? { status: 'failed' };
  return {
    status: ['done', 'failed', 'blocked'].includes(last.status) ? last.status : 'failed',
    summary: ran.map((s) => `${s.repo}: ${s.result.summary ?? s.result.status}`).join(' · '),
    branch: results.find((r) => r.branch)?.branch,
    worktree: ran[0]?.cwd,
    mrUrls: results.map((r) => r.mrUrl).filter(Boolean),
    commits: results.flatMap((r) => r.commits ?? []),
    blockers: results.flatMap((r) => r.blockers ?? []),
    links: results.flatMap((r) => r.links ?? []),
    handled: results.flatMap((r) => r.handled ?? []),
    drafts: results.flatMap((r) => r.drafts ?? []),
  };
}

function endChain(db, dir, chain, status, settings) {
  chain.status = status;
  chain.endedAt = new Date().toISOString();
  for (const s of chain.steps) if (s.status === 'queued') s.status = 'cancelled';
  writeChain(dir, chain); // before reconciling: a second collector must not reconcile again
  const result = combined(chain);
  // A stopped chain keeps what its repos did (branches, MRs) but did not finish.
  if (status === 'stopped') Object.assign(result, { status: 'blocked', summary: [result.summary, 'stopped on the dashboard'].filter(Boolean).join(' · ') });
  const res = reconcile(db, chain.item, result, settings);
  S.addEvent(db, { itemId: chain.item, kind: 'run-finished', message: `${chain.item}: runs ${status} (${chain.steps.map((s) => `${s.repo} ${s.status}`).join(', ')})`, data: { chain: chain.id } });
  return { item: chain.item, chain: chain.id, ...res };
}

const startedEvent = (db, chain, step, idx) =>
  S.addEvent(db, { itemId: chain.item, kind: 'run-started', message: `${chain.item}: claude -p in ${step.repo} (${idx + 1} of ${chain.steps.length})`, data: { chain: chain.id, repo: step.repo } });

export async function startChain(db, dir, settings, { item, kind, task, dryRun = false, workspace, steps }) {
  if (!steps?.length) throw new Error('run needs at least one repo');
  const current = S.getItem(db, item);
  if (!current) throw new Error(`no item ${item}`);
  const id = `${current.id}-${current.attempts + 1}`;
  dispatch(db, current.id, { agent: `run:${id}` });
  const chain = {
    id, item: current.id, kind, task, dryRun: !!dryRun, workspace, status: 'running',
    startedAt: new Date().toISOString(), endedAt: null,
    steps: steps.map(({ repo, cwd }) => ({ repo, cwd, status: 'queued' })),
  };
  const child = spawnStep(dir, chain, 0, settings);
  writeChain(dir, chain);
  if (!child) return { chain: id, failed: endChain(db, dir, chain, 'failed', settings) };
  startedEvent(db, chain, chain.steps[0], 0);
  // A claude that cannot start dies at once: report that now instead of on the next tick.
  const code = await new Promise((ok) => {
    const t = setTimeout(() => ok(null), 1500);
    child.once('exit', (c) => { clearTimeout(t); ok(c); });
  });
  if (code !== null && code !== 0) {
    const step = chain.steps[0];
    step.status = 'failed';
    step.endedAt = new Date().toISOString();
    step.result = { status: 'failed', summary: `claude exited ${code}: ${readText(join(dir, step.err)).trim().slice(-TAIL) || 'no output'}` };
    return { chain: id, failed: endChain(db, dir, chain, 'failed', settings) };
  }
  return { chain: id, started: { repo: chain.steps[0].repo } };
}

// One collector per chain at a time (a watch-triggered tick may overlap a wakeup tick or run-stop):
// an exclusive lock file holding the collector's pid; a lock whose holder is gone is taken over.
function withLock(dir, id, fn) {
  const lock = join(runsDir(dir), `${id}.lock`);
  let fd;
  try {
    fd = openSync(lock, 'wx');
  } catch {
    const holder = Number(readText(lock));
    if (holder && holder !== process.pid && signalable(holder)) return undefined;
    rmSync(lock, { force: true });
    try { fd = openSync(lock, 'wx'); } catch { return undefined; }
  }
  try {
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    // Re-read under the lock: another collector may have moved the chain on.
    const chain = listChains(dir).find((c) => c.id === id);
    return chain ? fn(chain) : undefined;
  } finally {
    rmSync(lock, { force: true });
  }
}

function startStep(db, dir, chain, idx, settings, out) {
  const child = spawnStep(dir, chain, idx, settings);
  if (!child) return false;
  writeChain(dir, chain);
  startedEvent(db, chain, chain.steps[idx], idx);
  out.started.push({ item: chain.item, repo: chain.steps[idx].repo });
  out.running.push(chain.id);
  return true;
}

// Advance every running chain: finished steps are read, the next repo starts (unless `startNext` is
// false: paused or outside working hours — it stays queued), ended chains reconcile.
export function collectRuns(db, dir, settings, now = new Date(), { startNext = true } = {}) {
  const out = { finished: [], started: [], running: [] };
  for (const { id } of listChains(dir).filter((c) => c.status === 'running')) {
    withLock(dir, id, (chain) => collectChain(db, dir, settings, now, startNext, chain, out));
  }
  return out;
}

function collectChain(db, dir, settings, now, startNext, chain, out) {
  if (chain.status !== 'running') return;
  const idx = chain.steps.findIndex((s) => s.status === 'running');
  if (idx < 0) {
    // The previous repo finished while starting was held back.
    const next = chain.steps.findIndex((s) => s.status === 'queued');
    if (next < 0) { out.finished.push(endChain(db, dir, chain, 'done', settings)); return; }
    if (!startNext) { out.running.push(chain.id); return; }
    if (startStep(db, dir, chain, next, settings, out)) return;
    out.finished.push(endChain(db, dir, chain, 'failed', settings));
    return;
  }
  {
    const step = chain.steps[idx];
    if (alive(step)) {
      const deadline = Date.parse(step.startedAt) + Number(settings.runTimeoutMinutes ?? 90) * 60_000;
      if (now.getTime() < deadline) { out.running.push(chain.id); return; }
      kill(step);
      step.result = { status: 'failed', summary: `timeout after ${settings.runTimeoutMinutes} min` };
    } else {
      step.result = readResult(dir, step);
    }
    step.status = ['done', 'blocked'].includes(step.result.status) ? step.result.status : 'failed';
    step.endedAt = new Date().toISOString();
    const next = chain.steps.findIndex((s) => s.status === 'queued');
    if (step.status === 'done' && next >= 0) {
      if (!startNext) { writeChain(dir, chain); out.running.push(chain.id); return; }
      if (startStep(db, dir, chain, next, settings, out)) return;
    }
    const status = chain.steps.some((s) => s.status === 'failed') ? 'failed' : chain.steps.some((s) => s.status === 'blocked') ? 'blocked' : 'done';
    out.finished.push(endChain(db, dir, chain, status, settings));
  }
}

// Running steps whose process is gone (for `watch`): the next tick will collect them.
export function finishedSteps(dir) {
  return listChains(dir)
    .filter((c) => c.status === 'running')
    .filter((c) => { const s = c.steps.find((x) => x.status === 'running'); return s && !alive(s); })
    .map((c) => ({ item: c.item, chain: c.id }));
}

export function stopChain(db, dir, settings, item) {
  const found = listChains(dir).find((c) => c.item === item && c.status === 'running');
  if (!found) return { stopped: false };
  const res = withLock(dir, found.id, (chain) => {
    if (chain.status !== 'running') return null;
    const step = chain.steps.find((s) => s.status === 'running');
    if (step && alive(step)) {
      kill(step);
      step.status = 'stopped';
      step.result = { status: 'blocked', summary: 'stopped' };
    } else if (step) {
      // It finished before anyone collected it: keep what it did (branch, MR).
      kill(step);
      step.result = readResult(dir, step);
      step.status = ['done', 'blocked'].includes(step.result.status) ? step.result.status : 'failed';
    }
    if (step) step.endedAt = new Date().toISOString();
    return endChain(db, dir, chain, 'stopped', settings);
  });
  return res ? { stopped: true, ...res } : { stopped: false };
}
