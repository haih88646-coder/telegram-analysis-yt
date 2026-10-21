import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtNum, fmtDuration, fmtDurationIso, fmtPct, fmtDelta, splitMessage, clip } from '../src/utils/formatting.js';

test('fmtNum thousand and million formatting', () => {
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(999), '999');
  assert.equal(fmtNum(1500), '1.5K');
  assert.equal(fmtNum(12345), '12.3K');
  assert.equal(fmtNum(1_500_000), '1.5M');
  assert.equal(fmtNum(2_300_000_000), '2.3B');
  assert.equal(fmtNum('not-a-number'), '0');
});

test('fmtDuration seconds to readable', () => {
  assert.equal(fmtDuration(0), '0s');
  assert.equal(fmtDuration(45), '45s');
  assert.equal(fmtDuration(90), '1m 30s');
  assert.equal(fmtDuration(60), '1m');
  assert.equal(fmtDuration(3720), '1h 2m');
});

test('fmtDurationIso parses ISO-8601 durations', () => {
  assert.equal(fmtDurationIso('PT1M32S'), 92);
  assert.equal(fmtDurationIso('PT59S'), 59);
  assert.equal(fmtDurationIso('PT1H'), 3600);
  assert.equal(fmtDurationIso('P2D'), 172800);
  assert.equal(fmtDurationIso('garbage'), null);
});

test('fmtPct', () => {
  assert.equal(fmtPct(23.5), '23.5%');
  assert.equal(fmtPct(null), 'n/a');
});

test('fmtDelta direction', () => {
  assert.equal(fmtDelta(120, 100), '+20 (20.0%)');
  assert.ok(fmtDelta(80, 100).startsWith('-20'));
  assert.ok(fmtDelta(100, 100).startsWith('~'));
});

test('splitMessage chunks long text without loss', () => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i} some filler text to make lines decent length for testing`).join('\n');
  const parts = splitMessage(long, 1200);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(part.length <= 1200);
  }
  const recombined = parts.map((p) => p).join('\n');
  for (let i = 0; i < 200; i++) assert.ok(recombined.includes(`line ${i} `));
});

test('splitMessage handles very long single lines', () => {
  const giantLine = 'x'.repeat(9000);
  const parts = splitMessage(giantLine, 4000);
  assert.equal(parts.length, 3);
  assert.equal(parts.join('').length, 9000);
});

test('clip', () => {
  assert.equal(clip('short', 10), 'short');
  assert.equal(clip('a very long sentence here', 7), 'a very\u2026');
});
