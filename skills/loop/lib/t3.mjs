// T3 Code: which host the loop session runs in, and the `t3` CLI (it talks to the running T3 Code
// server). Every call is synchronous and bounded; tests point $T3_BIN at test/fixtures/fake-t3.mjs —
// never start a real `t3` in tests.
import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 30_000;

// A Claude thread in T3 Code gets these from the harness; outside T3 Code none is set.
export function detectHost(env = process.env) {
  const t3 = env.CLAUDE_CODE_ENTRYPOINT === 't3-code' || !!env.T3CODE_THREAD_ID;
  return t3 ? { name: 't3', threadId: env.T3CODE_THREAD_ID || null } : { name: 'claude-code', threadId: null };
}

// What a process started for the loop must not inherit: it is not the loop's T3 thread.
export const isHostVar = (key) => key === 'CLAUDE_CODE_ENTRYPOINT' || key.startsWith('T3CODE_');

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

// $T3_BIN > LOOP.md `t3Bin` > $T3CODE_CLI_PATH (set inside a T3 Code thread) > `t3` on PATH.
export const t3Bin = (settings = {}, env = process.env) => env.T3_BIN || str(settings.t3Bin) || env.T3CODE_CLI_PATH || 't3';

// The CLI's own errors are one line; a crash adds a log prefix and a stack below it.
const firstLine = (text) => str(text).split('\n')[0].replace(/^\[[\d:.]+\]\s+ERROR\s+\(#\d+\):\s*/, '').trim();

// → { ok, stdout } or { ok: false, error }.
export function call(settings, args, { input, timeout = TIMEOUT_MS } = {}) {
  const bin = t3Bin(settings);
  const r = spawnSync(bin, args, { input, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) {
    const why = r.error.code === 'ETIMEDOUT' ? `no answer from ${bin} ${args.slice(0, 2).join(' ')} in ${timeout / 1000}s` : `cannot start ${bin}: ${r.error.code ?? r.error.message}`;
    return { ok: false, missing: r.error.code === 'ENOENT', error: why };
  }
  if (r.status !== 0) return { ok: false, code: r.status, error: firstLine(r.stderr) || firstLine(r.stdout) || `${bin} exited ${r.status ?? r.signal}` };
  return { ok: true, stdout: r.stdout };
}

export function json(res) {
  if (!res.ok) return res;
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch {
    return { ok: false, error: `unreadable answer from t3: ${str(res.stdout).slice(0, 200) || '(empty)'}` };
  }
}

// → { ok, data: { thread: {status, link, …}, messages: [{role, runId, text}], error } }; `gone` = the
// thread was deleted (the CLI says "Thread <id> is no longer available.").
export function showThread(settings, threadId, messages = 1) {
  const r = json(call(settings, ['thread', 'show', threadId, '--json', '--messages', String(messages)]));
  if (!r.ok) return { ...r, gone: /no longer available/i.test(r.error ?? '') };
  return r.data?.thread ? r : { ok: false, error: 'unreadable answer from t3 thread show' };
}

export function threadLink(settings, threadId) {
  const r = showThread(settings, threadId, 1);
  return r.ok ? r.data.thread.link ?? null : null;
}
