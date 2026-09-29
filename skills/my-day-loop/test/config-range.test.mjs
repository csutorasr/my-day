import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRange } from '../lib/range.mjs';
import { REQUIRED, DEFAULTS, findMissing, readConfig, loopSettings } from '../lib/config.mjs';

test('range to is inclusive of the whole local day', () => {
  const r = resolveRange({ from: '2026-09-28', to: '2026-09-28' });
  assert.equal(r.from, new Date(2026, 8, 28).toISOString());
  assert.equal(r.to, new Date(2026, 8, 29).toISOString());
});

test('range today / since', () => {
  const now = new Date(2026, 8, 29, 15, 30);
  assert.deepEqual(resolveRange({ today: true }, now), {
    from: new Date(2026, 8, 29).toISOString(),
    to: new Date(2026, 8, 30).toISOString(),
  });
  assert.deepEqual(resolveRange({ since: '2026-09-01' }), { from: new Date(2026, 8, 1).toISOString() });
  assert.throws(() => resolveRange({ from: 'garbage' }), /bad date/);
});

test('missing files are detected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myday-cfg-'));
  assert.deepEqual(findMissing(dir), REQUIRED);
  writeFileSync(join(dir, 'LOOP.md'), '# loop');
  assert.ok(!findMissing(dir).includes('LOOP'));
});

test('local overlay is appended after shared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myday-cfg-'));
  writeFileSync(join(dir, 'TRIAGE.md'), 'shared rules');
  writeFileSync(join(dir, 'TRIAGE.local.md'), 'my rules');
  const c = readConfig(dir, 'TRIAGE');
  assert.ok(c.text.indexOf('shared rules') < c.text.indexOf('my rules'));
  assert.match(c.text, /TRIAGE\.local\.md/);
});

test('settings merge local > shared > defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myday-cfg-'));
  writeFileSync(join(dir, 'LOOP.md'), '---\nmaxAgents: 5\nretryLimit: 2\n---\n# Loop');
  writeFileSync(join(dir, 'LOOP.local.md'), '---\nmaxAgents: 1 # laptop\ndryRun: false\n---\n');
  const s = loopSettings(dir);
  assert.equal(s.maxAgents, 1);
  assert.equal(s.retryLimit, 2);
  assert.equal(s.dryRun, false);
  assert.equal(s.port, DEFAULTS.port);
});

test('settings tolerate junk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myday-cfg-'));
  assert.deepEqual(loopSettings(dir), DEFAULTS);
  writeFileSync(join(dir, 'LOOP.md'), '---\n: nope\nmaxAgents: lots\n  indented: 1\n---');
  assert.equal(loopSettings(dir).maxAgents, DEFAULTS.maxAgents);
});

test('front matter keeps quoted values and strips only real comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myday-cfg-'));
  writeFileSync(join(dir, 'LOOP.md'), "---\nticketPattern: '#\\d+'   # issues\ngroup: acme/ # org\naiReviewer: bot#1\n---\n");
  const s = loopSettings(dir);
  assert.equal(s.ticketPattern, '#\\d+');
  assert.equal(s.group, 'acme/');
  assert.equal(s.aiReviewer, 'bot#1');
});
