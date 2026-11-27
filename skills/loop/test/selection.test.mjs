import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFor, defaultSelection, mergeStates, sanitizeSelection, visibleLoops } from '../ui/src/selection.js';

const L = (id, running, stopped = !running) => ({ id, name: id, running, stopped });

test('default selection is the running loops, or all when none runs', () => {
  assert.deepEqual(defaultSelection([L('a', true), L('b', false)]), ['a']);
  assert.deepEqual(defaultSelection([L('a', false), L('b', false)]), ['a', 'b']);
  assert.deepEqual(defaultSelection([]), []);
});

test('loops with an error (no store) are never selectable', () => {
  assert.deepEqual(defaultSelection([{ ...L('a', false), error: 'no store' }, L('b', false)]), ['b']);
  assert.deepEqual(visibleLoops([{ ...L('a', false), error: 'no store' }, L('b', true)], true).map((l) => l.id), ['b']);
});

test('visibleLoops hides stopped ones unless asked', () => {
  assert.deepEqual(visibleLoops([L('a', true), L('b', false)], false).map((l) => l.id), ['a']);
  assert.deepEqual(visibleLoops([L('a', true), L('b', false)], true).map((l) => l.id), ['a', 'b']);
});

test('a saved selection keeps only loops that still exist and are visible, else the default', () => {
  const loops = [L('a', true), L('b', false), L('c', true)];
  assert.deepEqual(sanitizeSelection(['b', 'c', 'zz'], loops, false), ['c']);
  assert.deepEqual(sanitizeSelection(['b'], loops, true), ['b']);
  assert.deepEqual(sanitizeSelection(['zz'], loops, false), ['a', 'c']);
  assert.deepEqual(sanitizeSelection(null, loops, false), ['a', 'c']);
});

test('mergeStates tags every row with its loop and keeps ids apart', () => {
  const st = (id) => ({ id, name: id, dryRun: false, items: [{ id: 'bug-1' }], questions: [{ id: 'q-1', item: { id: 'bug-1' } }], failed: [{ id: 'bug-1' }], reviews: [], finishedToday: [], recent: [{ id: 1 }], sources: [{ name: 'mcp:slack', status: 'error' }], loop: { paused: false } });
  const m = mergeStates([st('a'), st('b')]);
  assert.deepEqual(m.questions.map((q) => `${q.loop}:${q.id}`), ['a:q-1', 'b:q-1']);
  assert.deepEqual(m.items.map((i) => i.loopName), ['a', 'b']);
  assert.deepEqual(m.failed.map((f) => f.loop), ['a', 'b']);
  assert.deepEqual(m.sources.map((x) => `${x.loopName}:${x.name}`), ['a:mcp:slack', 'b:mcp:slack']);
  assert.equal(m.multi, true);
  assert.deepEqual(m.loops.map((l) => l.id), ['a', 'b']);
  // Each loop keeps its own host: one may run in T3 Code (a thread to open), another in a terminal.
  const hosted = mergeStates([{ ...st('a'), host: { name: 't3', threadLink: 'https://t3/a' } }, st('b')]);
  assert.deepEqual(hosted.loops.map((l) => l.host?.threadLink), ['https://t3/a', undefined]);
  assert.equal(mergeStates([st('a')]).multi, false);
  assert.equal(mergeStates([]), null);
  assert.equal(apiFor('a'), '/api/loops/a');
});

test('runStep: a T3 thread run has its link and says when it waits; waitingRuns lists those', async () => {
  const { runStep, waitingRuns } = await import('../ui/src/format.js');
  const item = { id: 'bug-1', loop: 'a', agent_id: 'run:bug-1-2' };
  const t3 = { id: 'bug-1-2', loop: 'a', runner: 't3', item: 'bug-1', status: 'running', steps: [{ repo: 'api', status: 'done' }, { repo: 'web', status: 'running', startedAt: '2026-01-01T10:00:00Z', link: 'https://t3/x', waiting: true }] };
  assert.deepEqual(runStep(item, [t3]), { repo: 'web', label: 'web (2 of 2)', since: '2026-01-01T10:00:00Z', runner: 'T3 thread', link: 'https://t3/x', waiting: true });
  const p = { id: 'bug-1-2', loop: 'a', item: 'bug-1', status: 'running', steps: [{ repo: 'web', status: 'running', startedAt: '2026-01-01T10:00:00Z' }] };
  assert.deepEqual(runStep(item, [p]), { repo: 'web', label: 'web (1 of 1)', since: '2026-01-01T10:00:00Z', runner: 'claude -p', link: null, waiting: false });
  // The same chain id in another loop is another run.
  assert.equal(runStep({ ...item, loop: 'b' }, [t3]), null);
  assert.equal(runStep({ id: 'mr-1', loop: 'a', agent_id: 'a1b2' }, [t3]), null);
  assert.deepEqual(waitingRuns([t3, p]).map((w) => [w.loop, w.item, w.repo, w.link]), [['a', 'bug-1', 'web', 'https://t3/x']]);
  // A chain that ended while its thread still waited is no longer asking through my-day.
  assert.deepEqual(waitingRuns([{ ...t3, status: 'stopped' }]), []);
  assert.deepEqual(waitingRuns(undefined), []);
});
