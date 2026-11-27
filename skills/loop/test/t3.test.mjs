import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T3 from '../lib/t3.mjs';

// Never a real t3: every call goes to the fake, whose "server" is a temp folder.
const FAKE = fileURLToPath(new URL('./fixtures/fake-t3.mjs', import.meta.url));
chmodSync(FAKE, 0o755);
for (const k of Object.keys(process.env)) if (k === 'CLAUDE_CODE_ENTRYPOINT' || k.startsWith('T3CODE_')) delete process.env[k];
process.env.T3_BIN = FAKE;

const fakeT3 = () => {
  const root = mkdtempSync(join(tmpdir(), 'myday-t3-'));
  process.env.FAKE_T3_HOME = join(root, 't3-server');
  return root;
};

test('host: a T3 Code thread is told by its environment, with its thread id', () => {
  assert.deepEqual(T3.detectHost({ CLAUDE_CODE_ENTRYPOINT: 't3-code', T3CODE_THREAD_ID: 'mcp:1' }), { name: 't3', threadId: 'mcp:1' });
  assert.deepEqual(T3.detectHost({ T3CODE_THREAD_ID: 'mcp:1' }), { name: 't3', threadId: 'mcp:1' });
  assert.deepEqual(T3.detectHost({ CLAUDE_CODE_ENTRYPOINT: 't3-code' }), { name: 't3', threadId: null });
  assert.deepEqual(T3.detectHost({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), { name: 'claude-code', threadId: null });
  assert.deepEqual(T3.detectHost({}), { name: 'claude-code', threadId: null });
  // What a process the loop starts must not inherit.
  assert.deepEqual(['CLAUDE_CODE_ENTRYPOINT', 'T3CODE_THREAD_ID', 'T3CODE_CLI_PATH', 'T3CODE_HOME', 'T3_BIN', 'PATH', 'MY_DAY_DIR'].filter(T3.isHostVar), ['CLAUDE_CODE_ENTRYPOINT', 'T3CODE_THREAD_ID', 'T3CODE_CLI_PATH', 'T3CODE_HOME']);
});

test('the t3 binary: $T3_BIN, then t3Bin, then $T3CODE_CLI_PATH, then t3 on PATH', () => {
  assert.equal(T3.t3Bin({ t3Bin: '/s/t3' }, { T3_BIN: '/e/t3', T3CODE_CLI_PATH: '/c/t3' }), '/e/t3');
  assert.equal(T3.t3Bin({ t3Bin: '/s/t3' }, { T3CODE_CLI_PATH: '/c/t3' }), '/s/t3');
  assert.equal(T3.t3Bin({ t3Bin: '' }, { T3CODE_CLI_PATH: '/c/t3' }), '/c/t3');
  assert.equal(T3.t3Bin({}, {}), 't3');
});

test('showThread and threadLink: the thread, a deleted one, and no server', () => {
  const root = fakeT3();
  T3.call({}, ['project', 'add', root]);
  const { threadId } = JSON.parse(T3.call({}, ['thread', 'start', '--json', root, 'hello']).stdout);
  const shown = T3.showThread({}, threadId);
  assert.equal(shown.ok, true);
  assert.equal(shown.data.thread.status, 'completed');
  assert.equal(T3.threadLink({}, threadId), `https://app.t3.codes/threads/fake-env/${encodeURIComponent(threadId)}`);
  // The real CLI's words for a deleted thread: "Thread <id> is no longer available."
  const gone = T3.showThread({}, 'mcp:deleted');
  assert.deepEqual([gone.ok, gone.gone], [false, true]);
  assert.match(gone.error, /^Thread mcp:deleted is no longer available\.$/);
  assert.equal(T3.threadLink({}, 'mcp:deleted'), null);
  process.env.FAKE_T3_DOWN = '1';
  try {
    const down = T3.showThread({}, threadId);
    assert.deepEqual([down.ok, down.gone], [false, false]);
    assert.match(down.error, /No running T3 Code server/);
  } finally {
    delete process.env.FAKE_T3_DOWN;
  }
  delete process.env.T3_BIN;
  try {
    const missing = T3.showThread({ t3Bin: '/nonexistent/t3' }, threadId);
    assert.deepEqual([missing.ok, missing.missing], [false, true]);
    assert.match(missing.error, /cannot start \/nonexistent\/t3: ENOENT/);
  } finally {
    process.env.T3_BIN = FAKE;
  }
});
