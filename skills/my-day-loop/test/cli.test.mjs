import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'state.mjs');
const dir = mkdtempSync(join(tmpdir(), 'myday-cli-'));
const run = (...a) => execFileSync(process.execPath, [CLI, ...a], { env: { ...process.env, MY_DAY_DIR: dir }, encoding: 'utf8' }).trim();

test('upsert → set → fail → show → summary round trip', () => {
  assert.equal(run('upsert', '--type', 'bug', '--ext', 'jira:ABC-1', '--title', 'Broken'), 'bug-1 (new)');
  assert.equal(run('upsert', '--type', 'bug', '--ext', 'jira:ABC-1'), 'bug-1');
  run('set', 'bug-1', 'status=attempting', 'data.routing=local', 'repos=api,web');
  const got = JSON.parse(run('get', 'jira:ABC-1'));
  assert.equal(got.status, 'attempting');
  assert.deepEqual(got.repos, ['api', 'web']);
  assert.equal(got.data.routing, 'local');
  run('fail', 'bug-1', '--reason', 'could not reproduce');
  assert.match(run('show', 'bug-1'), /elaborate bug-1/);
  const sum = run('summary', '--today');
  assert.match(sum, /bug-1 Broken — could not reproduce/);
});

test('questions via CLI', () => {
  run('upsert', '--type', 'story', '--ext', 'jira:ABC-2', '--title', 'Story');
  const q = run('ask', 'story-1', 'Take', 'story-1', 'next?');
  assert.match(q, /^q-\d+$/);
  assert.match(run('questions'), /Take story-1 next\?/);
  run('answer', q, 'yes');
  assert.doesNotMatch(run('questions'), /Take story-1/);
});

test('errors exit 1 with a message', () => {
  const r = spawnSync(process.execPath, [CLI, 'show', 'bug-404'], { env: { ...process.env, MY_DAY_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no item bug-404/);
});

test('config missing lists all required files in an empty dir', () => {
  assert.match(run('config', 'missing'), /LOOP\nQUERY-MY-TASKS/);
});

test('upsert-many is idempotent and reports created flags', () => {
  const input = JSON.stringify([
    { type: 'review', ext: 'gitlab:g/a!1', title: 'A' },
    { type: 'review', ext: 'gitlab:g/a!2', title: 'B' },
  ]);
  const opts = { env: { ...process.env, MY_DAY_DIR: dir }, encoding: 'utf8', input };
  const first = JSON.parse(execFileSync(process.execPath, [CLI, 'upsert-many'], opts));
  const second = JSON.parse(execFileSync(process.execPath, [CLI, 'upsert-many'], opts));
  assert.deepEqual(first.map((r) => r.created), [true, true]);
  assert.deepEqual(second.map((r) => r.created), [false, false]);
  assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id));
});
