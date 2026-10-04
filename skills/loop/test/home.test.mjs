import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as S from '../lib/db.mjs';
import { forget, homeDir, homeSettings, listLoops, loopId, loopStatus, migrate, register } from '../lib/home.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'myday-home-'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('homeDir: MY_DAY_HOME, else ~/.my-day', () => {
  assert.equal(homeDir({ MY_DAY_HOME: '/x/y' }), '/x/y');
  assert.equal(homeDir({}), join(homedir(), '.my-day'));
});

test('register / list / forget', () => {
  const home = tmp();
  const ws = join(tmp(), 'client-a', '.my-day');
  mkdirSync(ws, { recursive: true });
  const e = register(home, ws);
  assert.equal(e.name, 'client-a');
  assert.equal(e.id, loopId(ws));
  assert.equal(e.workspace, dirname(ws));
  assert.deepEqual(listLoops(home).map((l) => l.id), [e.id]);
  assert.equal(register(home, ws).id, e.id);
  assert.equal(listLoops(home).length, 1);
  assert.equal(forget(home, dirname(ws)), true);
  assert.deepEqual(listLoops(home), []);
  assert.equal(forget(home, 'nope'), false);
});

test('listLoops skips a corrupt registry file', () => {
  const home = tmp();
  mkdirSync(join(home, 'loops'), { recursive: true });
  writeFileSync(join(home, 'loops', 'bad.json'), '{');
  assert.deepEqual(listLoops(home), []);
});

test('loopStatus: running within grace of nextTickAt, stopped after stop, a new session clears the stop', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  assert.equal(loopStatus({ nextTickAt: '2026-10-04T09:50:00Z' }, now).running, true);
  assert.equal(loopStatus({ nextTickAt: '2026-10-04T09:40:00Z' }, now).running, false);
  assert.equal(loopStatus({ sessionStartedAt: '2026-10-04T09:59:00Z' }, now).running, true);
  assert.deepEqual(loopStatus({}, now), { running: false, stopped: false });
  assert.deepEqual(
    loopStatus({ sessionStartedAt: '2026-10-04T09:00:00Z', nextTickAt: '2026-10-04T10:05:00Z', stoppedAt: '2026-10-04T09:30:00Z' }, now),
    { running: false, stopped: true },
  );
  assert.equal(loopStatus({ sessionStartedAt: '2026-10-04T09:50:00Z', stoppedAt: '2026-10-04T09:30:00Z' }, now).running, true);
  // Restarted in the same session (no new sessionStartedAt): a tick after the stop means it runs again.
  assert.deepEqual(
    loopStatus({ sessionStartedAt: '2026-10-04T08:00:00Z', stoppedAt: '2026-10-04T09:30:00Z', lastTickAt: '2026-10-04T09:55:00Z', nextTickAt: '2026-10-04T10:15:00Z' }, now),
    { running: true, stopped: false },
  );
});

test('homeSettings: SETTINGS.md wins, else the loop settings', () => {
  const home = tmp();
  assert.deepEqual(homeSettings(home, { port: 4711, pushSubject: 'mailto:a' }), { port: 4711, pushSubject: 'mailto:a' });
  writeFileSync(join(home, 'SETTINGS.md'), '---\nport: 4800\n---\n');
  assert.deepEqual(homeSettings(home, { port: 4711, pushSubject: 'mailto:a' }), { port: 4800, pushSubject: 'mailto:a' });
});

test('migrate copies vapid and subscriptions, stops an old per-workspace server', async () => {
  const home = tmp();
  const ws = tmp();
  writeFileSync(join(ws, '.vapid.json'), '{"publicKey":"P","privateKey":"K"}');
  const db = S.openDb(join(ws, 'state.db'));
  S.addSubscription(db, { endpoint: 'https://push.example/1', keys: {} });
  db.close();
  const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  writeFileSync(join(ws, 'server.pid'), JSON.stringify({ pid: sleeper.pid, port: 1 }));
  assert.deepEqual(migrate(home, ws), { vapid: true, subscriptions: 1, stoppedOldServer: true });
  assert.equal(readFileSync(join(home, '.vapid.json'), 'utf8'), '{"publicKey":"P","privateKey":"K"}');
  assert.equal(S.listSubscriptions(S.openDb(join(home, 'dashboard.db'))).length, 1);
  assert.equal(existsSync(join(ws, 'server.pid')), false);
  for (let i = 0; i < 50 && alive(sleeper.pid); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(alive(sleeper.pid), false);
  // Home keys are never overwritten; a second run copies nothing new.
  writeFileSync(join(ws, '.vapid.json'), '{"publicKey":"OTHER","privateKey":"K2"}');
  assert.deepEqual(migrate(home, ws), { vapid: false, subscriptions: 0, stoppedOldServer: false });
  assert.match(readFileSync(join(home, '.vapid.json'), 'utf8'), /"P"/);
});

test('migrate, when the workspace store is the home itself, keeps the server and keys but moves subscriptions', () => {
  const home = tmp();
  writeFileSync(join(home, 'server.pid'), JSON.stringify({ pid: process.pid, port: 1 }));
  const db = S.openDb(join(home, 'state.db'));
  S.addSubscription(db, { endpoint: 'https://push.example/home', keys: {} });
  db.close();
  assert.deepEqual(migrate(home, home), { vapid: false, subscriptions: 1, stoppedOldServer: false });
  assert.equal(existsSync(join(home, 'server.pid')), true);
  assert.deepEqual(S.listSubscriptions(S.openDb(join(home, 'dashboard.db'))).map((x) => x.endpoint), ['https://push.example/home']);
});
