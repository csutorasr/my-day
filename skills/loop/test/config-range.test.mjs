import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRange } from '../lib/range.mjs';
import { REQUIRED, LEGACY_REQUIRED, DEFAULTS, OPTIONAL, findMissing, requiredFiles, requiredSources, readConfig, loopSettings } from '../lib/config.mjs';

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

test('dreamSchedule defaults to off and reads from LOOP.local.md; DREAM is optional', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myday-cfg-'));
  writeFileSync(join(dir, 'LOOP.md'), "---\ndreamSchedule:            # e.g. Fri 17:00\nmaxAgents: 2\n---\n");
  assert.equal(loopSettings(dir).dreamSchedule, '');
  writeFileSync(join(dir, 'LOOP.local.md'), '---\ndreamSchedule: Fri 17:00   # weekly\n---\n');
  assert.equal(loopSettings(dir).dreamSchedule, 'Fri 17:00');
  assert.ok(!REQUIRED.includes('DREAM'));
});

test('requiredFiles: LOOP.md ## Files is the manifest', () => {
  const d = mkdtempSync(join(tmpdir(), 'myday-man-'));
  writeFileSync(join(d, 'LOOP.md'), '---\nmaxAgents: 2\n---\n# Loop\n## Files\nSOURCES.md, RITUALS.md\nLOOP.local.md is personal\n\n## Tick priority\n1. MERGE-GATES.md\n');
  assert.deepEqual(requiredFiles(d), ['LOOP', 'SOURCES', 'RITUALS']);
  assert.deepEqual(findMissing(d), ['SOURCES', 'RITUALS']);
});

test('requiredFiles: a LOOP.md without ## Files falls back to the legacy dev list', () => {
  const d = mkdtempSync(join(tmpdir(), 'myday-man-'));
  writeFileSync(join(d, 'LOOP.md'), '---\n---\n# Loop\n');
  assert.deepEqual(requiredFiles(d), LEGACY_REQUIRED);
  assert.deepEqual(REQUIRED, LEGACY_REQUIRED);
});

test('findMissing: no LOOP.md → the legacy list, LOOP first', () => {
  const d = mkdtempSync(join(tmpdir(), 'myday-man-'));
  assert.deepEqual(findMissing(d), LEGACY_REQUIRED);
});

test('the dev template LOOP.md lists every legacy file', () => {
  const d = mkdtempSync(join(tmpdir(), 'myday-man-'));
  writeFileSync(join(d, 'LOOP.md'), readFileSync(new URL('../templates/dev/LOOP.md', import.meta.url), 'utf8'));
  assert.deepEqual(new Set(requiredFiles(d)), new Set(LEGACY_REQUIRED));
});

test('the dev-bundle profile: same manifest as dev, runs workers as claude -p', () => {
  const d = mkdtempSync(join(tmpdir(), 'myday-bundle-'));
  writeFileSync(join(d, 'LOOP.md'), readFileSync(new URL('../templates/dev-bundle/LOOP.md', import.meta.url), 'utf8'));
  assert.deepEqual(new Set(requiredFiles(d)), new Set(LEGACY_REQUIRED));
  const s = loopSettings(d);
  assert.equal(s.runner, 'claude-p');
  assert.equal(s.permissionMode, 'acceptEdits');
  assert.equal(s.runTimeoutMinutes, 90);
  assert.match(readFileSync(new URL('../templates/dev-bundle/SETUP.md', import.meta.url), 'utf8'), /templates\/dev\/SETUP\.md/);
  assert.match(readFileSync(new URL('../templates/dev-bundle/DEVELOP.md', import.meta.url), 'utf8'), /## Cross-repo order/);
});

test('requires: a comma list of sources, brackets optional; absent → none; WRITES is optional', () => {
  assert.deepEqual(requiredSources({}), []);
  assert.deepEqual(requiredSources({ requires: '' }), []);
  assert.deepEqual(requiredSources({ requires: 'mcp:slack' }), ['mcp:slack']);
  assert.deepEqual(requiredSources({ requires: '[mcp:atlassian,  mcp:slack , cli:glab, mcp:slack]' }), ['mcp:atlassian', 'mcp:slack', 'cli:glab']);
  const d = mkdtempSync(join(tmpdir(), 'myday-req-'));
  writeFileSync(join(d, 'LOOP.md'), '---\nrequires: [mcp:atlassian, cli:gh]   # sources\n---\n');
  assert.deepEqual(requiredSources(loopSettings(d)), ['mcp:atlassian', 'cli:gh']);
  assert.ok(OPTIONAL.includes('WRITES'));
  assert.ok(!requiredFiles(d).includes('WRITES'));
});

test('the pm profile: its manifest lists every file of the folder; no code host, no workers, sources required', () => {
  const folder = new URL('../templates/pm/', import.meta.url);
  const d = mkdtempSync(join(tmpdir(), 'myday-pm-'));
  writeFileSync(join(d, 'LOOP.md'), readFileSync(new URL('LOOP.md', folder), 'utf8'));
  const files = readdirSync(folder).filter((f) => f.endsWith('.md') && f !== 'SETUP.md').map((f) => f.slice(0, -3));
  assert.deepEqual(new Set(requiredFiles(d)), new Set(files));
  const s = loopSettings(d);
  assert.equal(s.forge, 'none');
  assert.equal(s.maxAgents, 0);
  assert.deepEqual(requiredSources(s), ['<REQUIRES>']);
  assert.match(s.statusSchedule, /<STATUS_SLOT>/);
  // Every profile's interview uses the shared tracker interview and fills WRITES.md.
  for (const p of ['dev', 'pm']) {
    const setup = readFileSync(new URL(`../templates/${p}/SETUP.md`, import.meta.url), 'utf8');
    assert.match(setup, /templates\/TRACKERS\.md/, p);
    assert.match(setup, /## Writes defaults/, p);
  }
  assert.match(readFileSync(new URL('../templates/WRITES.md', import.meta.url), 'utf8'), /\| default \| ask \|/);
});

test('runner defaults to agent', () => {
  const d = mkdtempSync(join(tmpdir(), 'myday-bundle-'));
  writeFileSync(join(d, 'LOOP.md'), '---\n---\n');
  assert.equal(loopSettings(d).runner, 'agent');
});

test('skills and templates are host-neutral: nothing depends on TaskList or on Remote Control alone', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const loop = read('../SKILL.md');
  // The watch is armed without looking for a running one; T3 Code has no TaskList.
  assert.doesNotMatch(loop, /unless one is already running \(TaskList\)/);
  assert.match(loop, /never\s+look for it with TaskList/);
  assert.match(loop, /watch-replaced/);
  // The dashboard opens in an in-app tab in T3 Code, in the browser elsewhere.
  assert.match(loop, /mcp__t3-code__preview_open/);
  assert.match(loop, /open <server\.url>/);
  for (const p of ['../SKILL.md', '../templates/dev/LOOP.md', '../templates/dev-bundle/LOOP.md', '../templates/pm/LOOP.md']) {
    for (const para of read(p).split(/\n(?=\S)/).filter((l) => /Remote\s+Control/.test(l))) assert.match(para, /T3 Code thread/, p);
  }
  // Every ignore list covers the watch lock and its temp files (watch.lock.<pid>).
  for (const p of ['../../setup/SKILL.md', '../../../README.md']) assert.match(read(p), /^\.my-day\/watch\.lock\*$/m, p);
});
