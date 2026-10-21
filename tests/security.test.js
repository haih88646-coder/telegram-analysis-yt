import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, verifyWebhookSecret, isOwner, rateLimit } from '../src/telegram/security.js';

test('parseCommand basic commands', () => {
  assert.deepEqual(parseCommand('/start'), { command: 'start', args: '', botUsername: null });
  assert.deepEqual(parseCommand('/sync'), { command: 'sync', args: '', botUsername: null });
});

test('parseCommand with args', () => {
  const parsed = parseCommand('/analyze dQw4w9WgXcQ');
  assert.equal(parsed.command, 'analyze');
  assert.equal(parsed.args, 'dQw4w9WgXcQ');
});

test('parseCommand with bot username suffix', () => {
  const parsed = parseCommand('/report@MyAnalystBot extra args');
  assert.equal(parsed.command, 'report');
  assert.equal(parsed.args, 'extra args');
  assert.equal(parsed.botUsername, 'MyAnalystBot');
});

test('parseCommand rejects non-commands', () => {
  assert.equal(parseCommand('hello there'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(null), null);
  assert.equal(parseCommand(42), null);
});

test('parseCommand case-insensitive command', () => {
  assert.equal(parseCommand('/REPORT').command, 'report');
});

test('verifyWebhookSecret', () => {
  assert.equal(verifyWebhookSecret('secret123', 'secret123'), true);
  assert.equal(verifyWebhookSecret('secret124', 'secret123'), false);
  assert.equal(verifyWebhookSecret(undefined, 'secret123'), false);
  assert.equal(verifyWebhookSecret('secret123', null), false);
  assert.equal(verifyWebhookSecret('secret123', ''), false);
  assert.equal(verifyWebhookSecret('short', 'longersecret'), false);
});

test('isOwner', () => {
  assert.equal(isOwner(123456789, '123456789'), true);
  assert.equal(isOwner('123456789', 123456789), true);
  assert.equal(isOwner(111, '123456789'), false);
  assert.equal(isOwner(123, null), false);
  assert.equal(isOwner(123, undefined), false);
  assert.equal(isOwner(' 123 ', '123'), true);
});

test('rateLimit blocks over limit and resets with window', () => {
  const key = `rl-test-${Math.random()}`;
  for (let i = 0; i < 3; i++) {
    assert.equal(rateLimit(key, 3, 50).allowed, true);
  }
  assert.equal(rateLimit(key, 3, 50).allowed, false);
});
