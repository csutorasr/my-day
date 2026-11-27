import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineTerms } from '../lib/forge/mine-by.mjs';

test('mineBy: default, list, both, duplicates', () => {
  assert.deepEqual(mineTerms(undefined, ''), ['assignee']);
  assert.deepEqual(mineTerms('', ''), ['assignee']);
  assert.deepEqual(mineTerms('both', ''), ['author', 'assignee']);
  assert.deepEqual(mineTerms(' author , unassigned ', 'acme/'), ['author', 'unassigned']);
  assert.deepEqual(mineTerms('both, author, unassigned', 'acme/'), ['author', 'assignee', 'unassigned']);
});

test('mineBy: unknown terms and an unscoped unassigned fail', () => {
  assert.throws(() => mineTerms('owner', ''), /unknown mineBy owner/);
  assert.throws(() => mineTerms('author, unassigned', ''), /needs a group/);
});
