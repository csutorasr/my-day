// The runners that start workers outside the loop session, one per repo, each in that repo's worktree
// so the folder's CLAUDE.md, settings, skills and MCP apply:
//   claude-p  a detached `claude -p` process (tracked by pid)
//   t3        a T3 Code thread started with the `t3` CLI (tracked by thread id; lib/t3.mjs)
// A chain = one item's runs in cross-repo order, tracked in .my-day/runs/<item>-<attempt>.json
// (`runner` says which kind; absent = claude-p). Runs outlive the session; `tick` collects finished
// steps and reconciles the item at the end.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './db.mjs';
import { dispatch, parseResult, reconcile } from './reconcile.mjs';
import * as T3 from './t3.mjs';

const runsDir = (dir) => join(dir, 'runs');
const PLUGIN_ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const TAIL = 2048;
const KILL_GRACE_MS = 2000;
const TITLE_MAX = 80;

export const isT3 = (chain) => chain?.runner === 't3';
const RUNNER_NAME = { 't3': 'T3 thread', 'claude-p': 'claude -p' };
const runnerName = (chain) => RUNNER_NAME[chain.runner] ?? RUNNER_NAME['claude-p'];

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

// `t3` ({ stateDir, pluginRoot, inWorktree }) adds what a T3 Code thread cannot get from its
// process: where the skill's files are when the provider has no Skill tool (Codex), and the state
// dir (a `claude -p` run gets it as $MY_DAY_DIR; a thread's environment is T3 Code's).
export function workerPrompt({ kind, workspace, item, dryRun, task, repo, worktree, previous = [], t3 }) {
  return [
    'Invoke the Skill tool with "my-day:worker" and follow it.',
    ...(t3 ? [`(No Skill tool, or no such skill: read ${join(t3.pluginRoot, 'skills', 'worker', 'SKILL.md')} and follow it; \`\${CLAUDE_PLUGIN_ROOT}\` in it is ${t3.pluginRoot}.)`] : []),
    `Kind: ${kind}`,
    `Workspace root: ${workspace}`,
    ...(t3 ? [`State dir: ${t3.stateDir}`, '(Put `MY_DAY_DIR=<state dir>` in front of every `$SM` command: you do not start in the workspace root.)'] : []),
    `Item: ${item}`,
    `Dry run: ${dryRun ? 'true' : 'false'}`,
    `Repo: ${repo}`,
    `Worktree: ${worktree}`,
    t3 && !t3.inWorktree
      ? '(The worktree exists, but you start in its T3 project folder: `cd` to the worktree first and work only there, do not create another one.)'
      : '(The worktree exists and is your working directory: work there, do not create another one.)',
    ...(previous.length ? ['Previous runs (earlier repos of this ticket, in order):', ...previous.map(previousLine)] : []),
    `Task: ${oneLine(task)}`,
  ].join('\n');
}

const workerEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !T3.isHostVar(k)));

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

const gitBranch = (cwd) => {
  try {
    const b = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return b && b !== 'HEAD' ? b : '';
  } catch {
    return '';
  }
};

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// "ABC-12 develop · backend (story-3-2): Wishlist storage", so the thread says what it is in T3
// Code's sidebar. The chain id makes it unique: a start whose answer got lost is found by its title.
const threadTitle = (chain, step) =>
  clip(`${chain.ticket ?? chain.item} ${chain.kind} · ${step.repo} (${chain.id})${chain.title ? `: ${oneLine(chain.title)}` : ''}`, TITLE_MAX);

// Start step `idx` of a t3 chain as a T3 Code thread (mutates the chain); false when it could not start.
// A thread runs in its project's folder, and `t3 thread start` takes no other folder: so with
// `t3Project: worktree` (default) the worktree itself is registered as a T3 project first. With
// `containing` the thread starts in whichever registered project holds the worktree and is told to
// `cd` there.
function startThread(db, dir, chain, idx, settings) {
  const step = chain.steps[idx];
  const inWorktree = settings.t3Project !== 'containing';
  const prompt = workerPrompt({
    kind: chain.kind, workspace: chain.workspace, item: chain.item, dryRun: chain.dryRun, task: chain.task,
    repo: step.repo, worktree: step.cwd, previous: chain.steps.slice(0, idx),
    t3: { stateDir: dir, pluginRoot: PLUGIN_ROOT, inWorktree },
  });
  mkdirSync(runsDir(dir), { recursive: true });
  writeFileSync(join(runsDir(dir), `${chain.id}.${step.repo}.prompt`), prompt);
  step.startedAt = new Date().toISOString();
  const failed = (summary) => {
    step.status = 'failed';
    step.endedAt = new Date().toISOString();
    step.result = { status: 'failed', summary };
    return false;
  };
  if (!existsSync(step.cwd)) return failed(`no worktree at ${step.cwd}`);
  if (inWorktree) {
    const added = T3.addProject(settings, step.cwd, `${step.repo} · ${gitBranch(step.cwd) || basename(step.cwd)}`);
    if (!added.ok) return failed(`cannot register the worktree as a T3 project: ${added.error}`);
    // The worktree is a project root now: the one folder `t3 remove` may remove later.
    step.project = step.cwd;
  }
  const started = T3.startThread(settings, { project: step.cwd, message: prompt, title: threadTitle(chain, step), kind: chain.kind });
  if (!started.ok) return failed(`cannot start a T3 thread: ${started.error}`);
  step.thread = started.threadId;
  step.run = started.runId;
  step.status = 'running';
  if (started.adopted) step.adopted = true;
  // Kept at once: from here on the thread works whatever happens to this process. Its link comes
  // with the first look at it (threadStep).
  writeChain(dir, chain);
  return true;
}

// The thread's page in T3 Code: on the step, and among the item's links.
function noteLink(db, chain, step, link) {
  if (!link || step.link === link) return false;
  step.link = link;
  S.addLink(db, chain.item, { kind: 'thread', url: link, label: `${step.repo} worker (attempt ${chain.id.split('-').at(-1)})` });
  return true;
}

const NUDGE = [
  'my-day could not find your result. Do no further work: reply with exactly one fenced json block as the worker skill says, e.g.',
  '```json',
  '{"status":"done|failed|blocked","summary":"…","branch":"…","mrUrl":"…","commits":["sha subject"],"blockers":["…"]}',
  '```',
].join('\n');

const hasStatus = (r) => !!r && typeof r.status === 'string';
const where = (step) => (step.link ? `: ${step.link}` : '');

// Where a t3 step's thread stands. 'running' = come back later (the chain file is rewritten when
// something worth keeping changed); otherwise `step.result` is set and the step is over.
function threadStep(db, dir, chain, step, settings, now, out) {
  const shown = T3.showThread(settings, step.thread);
  let dirty = shown.ok && noteLink(db, chain, step, shown.data.thread.link);
  const st = shown.ok ? T3.threadState(shown.data) : { state: shown.gone ? 'gone' : 'unknown', text: '' };
  const still = () => { if (dirty) writeChain(dir, chain); return 'running'; };
  if (st.state === 'waiting') {
    // Not a failure and not on the clock: the worker stopped to ask, the user has to answer in T3 Code.
    if (!step.waiting) {
      step.waiting = true;
      step.waitingSince = now.toISOString();
      dirty = true;
      S.addEvent(db, { itemId: chain.item, kind: 'run-waiting', message: `${chain.item}: the ${step.repo} worker waits for your answer in its T3 thread${where(step)}`, data: { chain: chain.id, repo: step.repo, thread: step.thread, link: step.link ?? null } });
    }
    out.waiting.push({ item: chain.item, chain: chain.id, repo: step.repo, thread: step.thread, link: step.link ?? null, since: step.waitingSince });
    return still();
  }
  if (step.waiting) {
    step.waitedMs = (step.waitedMs ?? 0) + Math.max(0, now.getTime() - Date.parse(step.waitingSince));
    step.waiting = false;
    delete step.waitingSince;
    dirty = true;
  }
  const deadline = Date.parse(step.startedAt) + Number(settings.runTimeoutMinutes ?? 90) * 60_000 + (step.waitedMs ?? 0);
  const report = parseResult(st.text);
  if (st.state === 'running' || st.state === 'unknown') {
    if (now.getTime() < deadline) return still();
    // Out of time, but the report may be there already (a thread still busy with leftovers).
    if (hasStatus(report)) { step.result = report; return 'ended'; }
    // There is no `t3` command that stops a thread: say so instead of pretending it was stopped.
    // A thread that cannot be read may be running too: my-day lets go of it either way.
    const state = st.state === 'unknown' ? `its T3 thread could not be read (${shown.error}) and may still be running` : 'its T3 thread is still running — stop it in T3 Code';
    step.result = { status: 'failed', summary: `timeout after ${settings.runTimeoutMinutes} min; ${state}${where(step)}` };
    step.detached = true;
    return 'ended';
  }
  if (st.state === 'gone') {
    step.result = { status: 'failed', summary: 'its T3 thread is gone (deleted in T3 Code?)' };
    return 'ended';
  }
  if (hasStatus(report)) {
    // A worker that reported before it was interrupted or failed keeps its report.
    step.result = report;
  } else if (st.state === 'done') {
    // Unlike a process, a thread can be asked again: one reminder before the step fails. A reminder
    // that could not be sent is tried again on the next tick, until the step runs out of time.
    if (!step.nudged) {
      const sent = T3.sendThread(settings, step.thread, NUDGE);
      if (sent.ok) {
        step.nudged = true;
        delete step.nudgeError;
        step.run = sent.runId ?? step.run;
        dirty = true;
        return still();
      }
      if (now.getTime() < deadline) {
        dirty = dirty || step.nudgeError !== sent.error;
        step.nudgeError = sent.error;
        return still();
      }
      step.result = { status: 'failed', summary: `run ended without a result; the reminder could not be sent (${sent.error})`, tail: st.text.trim().slice(-TAIL) };
      return 'ended';
    }
    step.result = { status: 'failed', summary: 'run ended without a result', tail: st.text.trim().slice(-TAIL) };
  } else if (st.state === 'stopped') {
    step.result = { status: 'blocked', summary: `stopped in T3 Code (${st.status})` };
  } else {
    step.result = { status: 'failed', summary: `T3 thread ${st.status || 'failed'}${st.error ? `: ${oneLine(st.error).slice(0, 500)}` : ''}`, tail: st.text.trim().slice(-TAIL) };
  }
  return 'ended';
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
  S.addEvent(db, {
    itemId: chain.item, kind: 'run-started',
    message: `${chain.item}: ${runnerName(chain)} in ${step.repo} (${idx + 1} of ${chain.steps.length})`,
    data: { chain: chain.id, repo: step.repo, ...(step.thread ? { thread: step.thread, link: step.link ?? null } : {}) },
  });

// Threads my-day let go of (a timeout, `run-stop`) that may still be working: in this item's earlier
// chains, or on one of `cwds` in any chain. A new worker beside one would edit the same worktree or
// redo the same item. Running, waiting and unreadable threads count; one that has ended is no longer
// marked (its chain is rewritten), so it is not asked again.
export function liveDetached(dir, settings, { item, cwds = [], except } = {}) {
  const live = [];
  for (const c of listChains(dir)) {
    if (c.id === except || c.status === 'running' || !isT3(c)) continue;
    let changed = false;
    for (const s of c.steps) {
      if (!s.detached || !s.thread || (c.item !== item && !cwds.includes(s.cwd))) continue;
      const shown = T3.showThread(settings, s.thread, 1);
      const state = shown.ok ? T3.threadState(shown.data).state : shown.gone ? 'gone' : 'unknown';
      if (['running', 'waiting', 'unknown'].includes(state)) {
        live.push({ item: c.item, chain: c.id, repo: s.repo, thread: s.thread, link: (shown.ok && shown.data.thread.link) || s.link || null, state });
      } else {
        s.detached = false;
        changed = true;
      }
    }
    if (changed) writeChain(dir, c);
  }
  return live;
}

const liveMessage = (live) =>
  live.map((l) => `the ${l.repo} worker of ${l.chain} ${l.state === 'unknown' ? 'could not be read and may still be running' : `is still ${l.state}`} in its T3 thread: ${l.link ?? l.thread}`).join('; ');

// `runner`: 't3' or 'claude-p'; default from the settings (`runner: t3` → t3, anything else → claude -p).
// `force`: start even beside a thread my-day let go of that may still be working (liveDetached).
export async function startChain(db, dir, settings, { item, kind, task, dryRun = false, workspace, steps, runner, force = false }) {
  if (!steps?.length) throw new Error('run needs at least one repo');
  const current = S.getItem(db, item);
  if (!current) throw new Error(`no item ${item}`);
  if (!force) {
    const live = liveDetached(dir, settings, { item: current.id, cwds: steps.map((s) => s.cwd) });
    if (live.length) throw new Error(`not started: ${liveMessage(live)}. Stop it in T3 Code first, or run again with --force.`);
  }
  const id = `${current.id}-${current.attempts + 1}`;
  const t3 = (runner ?? settings.runner) === 't3';
  dispatch(db, current.id, { agent: `run:${id}` });
  const chain = {
    id, runner: t3 ? 't3' : 'claude-p', item: current.id, kind, task, dryRun: !!dryRun, workspace, status: 'running',
    startedAt: new Date().toISOString(), endedAt: null, ...(force ? { force: true } : {}),
    steps: steps.map(({ repo, cwd }) => ({ repo, cwd, status: 'queued' })),
  };
  if (t3) {
    // What the thread is called in T3 Code: the ticket key and title rather than my-day's item id.
    chain.ticket = current.ext_key?.split(':').slice(1).join(':') || current.id;
    chain.title = current.title ?? '';
    const ok = startThread(db, dir, chain, 0, settings);
    writeChain(dir, chain);
    if (!ok) return { chain: id, failed: endChain(db, dir, chain, 'failed', settings) };
    startedEvent(db, chain, chain.steps[0], 0);
    // The link comes with the first look at the thread: `runs`, the item's links, the next tick.
    return { chain: id, started: { repo: chain.steps[0].repo, thread: chain.steps[0].thread } };
  }
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
  const step = chain.steps[idx];
  const live = chain.force ? [] : liveDetached(dir, settings, { item: chain.item, cwds: [step.cwd], except: chain.id });
  if (live.length) {
    Object.assign(step, { status: 'failed', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), result: { status: 'failed', summary: `not started: ${liveMessage(live)}` } });
    return false;
  }
  if (!(isT3(chain) ? startThread(db, dir, chain, idx, settings) : spawnStep(dir, chain, idx, settings))) return false;
  writeChain(dir, chain);
  startedEvent(db, chain, step, idx);
  out.started.push({ item: chain.item, repo: step.repo, ...(step.thread ? { thread: step.thread } : {}) });
  out.running.push(chain.id);
  return true;
}

// Advance every running chain: finished steps are read, the next repo starts (unless `startNext` is
// false: paused or outside working hours — it stays queued), ended chains reconcile. `waiting` =
// T3 threads that stopped to ask the user something (still running, off the clock).
// `stillRunning` = T3 threads of the chains that just ended which my-day let go of (a timeout): the
// loop interrupts them if it can, else the user has to press Stop in them.
export function collectRuns(db, dir, settings, now = new Date(), { startNext = true } = {}) {
  const out = { finished: [], started: [], running: [], waiting: [], stillRunning: [] };
  for (const { id } of listChains(dir).filter((c) => c.status === 'running')) {
    withLock(dir, id, (chain) => {
      collectChain(db, dir, settings, now, startNext, chain, out);
      if (chain.status === 'running') return;
      for (const s of chain.steps.filter((x) => x.detached)) out.stillRunning.push({ item: chain.item, chain: chain.id, repo: s.repo, thread: s.thread, link: s.link ?? null });
    });
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
    if (isT3(chain)) {
      if (threadStep(db, dir, chain, step, settings, now, out) === 'running') { out.running.push(chain.id); return; }
    } else if (alive(step)) {
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

const runningIdx = (chain) => chain.steps.findIndex((x) => x.status === 'running');
const runningStep = (chain) => chain.steps[runningIdx(chain)];

// Running claude -p steps whose process is gone (for `watch`): the next tick will collect them.
// `step` = the index of that step, so a signal keeps meaning the step it was about.
export function finishedSteps(dir) {
  return listChains(dir)
    .filter((c) => c.status === 'running' && !isT3(c))
    .filter((c) => { const s = runningStep(c); return s && !alive(s); })
    .map((c) => ({ item: c.item, chain: c.id, step: runningIdx(c) }));
}

export const hasThreadRuns = (dir) => listChains(dir).some((c) => c.status === 'running' && isT3(c) && runningStep(c));

// Running T3 threads the loop should look at (for `watch`; read-only, the next tick does the work):
// `run-finished` = the thread ended, `run-waiting` = it stopped to ask the user, `run-resumed` = a
// thread the loop knows as waiting got its answer (a tick clears that and stops the wait's clock).
// A thread that cannot be read right now is no news. `step` = the index of the step it is about.
export function threadSignals(dir, settings) {
  const out = [];
  for (const c of listChains(dir).filter((x) => x.status === 'running' && isT3(x))) {
    const idx = runningIdx(c);
    const step = c.steps[idx];
    if (!step?.thread) continue;
    const shown = T3.showThread(settings, step.thread);
    if (!shown.ok && !shown.gone) continue;
    const state = shown.ok ? T3.threadState(shown.data).state : 'gone';
    const base = { item: c.item, chain: c.id, step: idx };
    if (state === 'waiting') out.push({ kind: 'run-waiting', ...base, repo: step.repo, link: shown.data.thread.link ?? step.link ?? null });
    else if (state !== 'running') out.push({ kind: 'run-finished', ...base });
    else if (step.waiting) out.push({ kind: 'run-resumed', ...base, repo: step.repo });
  }
  return out;
}

// Stop an item's chain. A claude -p run is killed. A T3 thread cannot be stopped from here (the `t3`
// CLI has no such command): my-day lets go of it — the chain ends and later repos are cancelled —
// and the answer names the threads that keep running until someone stops them in T3 Code.
export function stopChain(db, dir, settings, item) {
  const found = listChains(dir).find((c) => c.item === item && c.status === 'running');
  if (!found) return { stopped: false };
  let detached = null;
  const res = withLock(dir, found.id, (chain) => {
    if (chain.status !== 'running') return null;
    const step = chain.steps.find((s) => s.status === 'running');
    if (step && isT3(chain)) {
      const shown = T3.showThread(settings, step.thread);
      if (shown.ok) noteLink(db, chain, step, shown.data.thread.link);
      const st = shown.ok ? T3.threadState(shown.data) : { state: shown.gone ? 'gone' : 'unknown', text: '' };
      const report = parseResult(st.text ?? '');
      if (hasStatus(report) && !['running', 'waiting', 'unknown'].includes(st.state)) {
        // It finished before anyone collected it: keep what it did (branch, MR).
        step.result = report;
        step.status = ['done', 'blocked'].includes(report.status) ? report.status : 'failed';
      } else {
        const live = ['running', 'waiting', 'unknown'].includes(st.state);
        step.status = 'stopped';
        step.detached = live;
        step.result = { status: 'blocked', summary: live ? `stopped by my-day; its T3 thread keeps running until you stop it in T3 Code${where(step)}` : 'stopped' };
        if (live) detached = { repo: step.repo, thread: step.thread, link: step.link ?? null };
      }
      delete step.waiting;
      delete step.waitingSince;
    } else if (step && alive(step)) {
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
  if (!res) return { stopped: false };
  return {
    stopped: true,
    ...res,
    ...(detached ? { stillRunning: [detached], note: 'T3 Code has no command to stop a thread: my-day let go of it (the chain ended, later repos are cancelled), but the thread keeps working until you press Stop in it.' } : {}),
  };
}
