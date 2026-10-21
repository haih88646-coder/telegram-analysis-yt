import test from 'node:test';
import assert from 'node:assert/strict';
import { isDuplicateUpdate, markProcessed } from '../api/webhook.js';

test('duplicate update handling in memory', () => {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  assert.equal(isDuplicateUpdate(id), false);
  markProcessed(id);
  assert.equal(isDuplicateUpdate(id), true);
});
