import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceHash } from '../ui/source-hash.mjs';

// server/public is the committed Vite build of skills/loop/ui. An installed plugin never builds,
// so a UI change without `npm run ui:build` would silently ship the old dashboard.
test('the committed dashboard build matches the UI sources', () => {
  const built = readFileSync(new URL('../server/public/.build-hash', import.meta.url), 'utf8').trim();
  assert.equal(built, sourceHash(), 'skills/loop/server/public is stale: run `npm run ui:build` and commit the result');
});
