import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalyticsResponse } from '../src/youtube/analytics.js';
import { normalizeVideo, classifyShort, extractVideoId, validateVideoId } from '../src/youtube/videos.js';

const SAMPLE_DATA = {
  columnHeaders: [
    { name: 'day' },
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
    { name: 'averageViewDuration' }
  ],
  rows: [
    ['2026-10-01', '100', '55.5', '33.2'],
    ['2026-10-02', '0', '0', '0']
  ]
};

test('parseAnalyticsResponse maps columns to named objects', () => {
  const rows = parseAnalyticsResponse(SAMPLE_DATA);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    day: '2026-10-01',
    views: '100',
    estimatedMinutesWatched: '55.5',
    averageViewDuration: '33.2'
  });
});

test('parseAnalyticsResponse handles missing rows', () => {
  assert.deepEqual(parseAnalyticsResponse({ columnHeaders: [{ name: 'day' }], rows: undefined }), []);
  assert.deepEqual(parseAnalyticsResponse({}), []);
});

test('normalizeVideo extracts fields and short classification', () => {
  const v = normalizeVideo({
    id: 'dQw4w9WgXcQ',
    snippet: {
      title: 'My test video',
      description: 'A test',
      publishedAt: '2026-01-02T03:04:05Z',
      channelId: 'UC123',
      statistics: undefined,
      tags: ['one', 'two'],
      thumbnails: { medium: { url: 'https://example.com/t.jpg' } }
    },
    contentDetails: { duration: 'PT1M32S' },
    statistics: { viewCount: '52', likeCount: '3', commentCount: '1' }
  });
  assert.equal(v.videoId, 'dQw4w9WgXcQ');
  assert.equal(v.durationSeconds, 92);
  assert.equal(v.isShort, false);
  assert.equal(v.lifetimeViews, 52);
});

test('classifyShort boundary at 60 seconds', () => {
  assert.equal(classifyShort({ durationSeconds: 60 }), true);
  assert.equal(classifyShort({ durationSeconds: 59 }), true);
  assert.equal(classifyShort({ durationSeconds: 61 }), false);
  assert.equal(classifyShort({ durationSeconds: 0 }), false);
});

test('extractVideoId accepts IDs and common URLs', () => {
  assert.equal(extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXc'), null);
  assert.equal(extractVideoId(''), null);
});

test('validateVideoId', () => {
  assert.equal(validateVideoId('short'), null);
  assert.equal(validateVideoId('this-is-way-too-long-for-a-video-id'), null);
  assert.equal(validateVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});
