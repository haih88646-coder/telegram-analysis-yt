import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInsights, buildDataBundle, formatFullInsights } from '../src/services/recommendations.js';
import { reportInsightsSchema } from '../src/gemini/analyst.js';

const GOOD = {
  executive_summary: 'Views rose.',
  key_changes: ['Views up 20% week over week'],
  best_videos: ['Video A is leading'],
  underperforming_videos: ['Video B underperforms'],
  video_ideas: ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4', 'Idea 5'],
  shorts_topics: ['Short topic'],
  longform_topics: ['Long topic'],
  hooks_and_titles: ['Hook idea'],
  experiments_next_7_days: ['Post 3 shorts'],
  metrics_to_monitor: ['Watch time'],
  confidence_and_limits: 'Moderate; 10 days of data.'
};

test('validateInsights accepts well-formed model output', () => {
  const out = validateInsights(GOOD);
  assert.equal(out.executive_summary, 'Views rose.');
  assert.equal(out.video_ideas.length, 5);
  assert.equal(out.experiments_next_7_days.length, 1);
});

test('validateInsights rejects empty or non-object', () => {
  assert.throws(() => validateInsights(null));
  assert.throws(() => validateInsights('not an object'));
  assert.throws(() => validateInsights(42));
});

test('validateInsights rejects missing required fields', () => {
  const broken = { ...GOOD };
  delete broken.executive_summary;
  assert.throws(() => validateInsights(broken));
});

test('validateInsights rejects wrong list field types', () => {
  const broken = { ...GOOD, video_ideas: 'should be an array' };
  assert.throws(() => validateInsights(broken));
});

test('validateInsights truncates oversize lists to the allowed maximum', () => {
  const big = { ...GOOD, video_ideas: ['1', '2', '3', '4', '5'] };
  assert.equal(validateInsights(big).video_ideas.length, 5);
  const sixElements = { ...GOOD, video_ideas: ['1', '2', '3', '4', '5', '6'] };
  assert.equal(validateInsights(sixElements).video_ideas.length, 5);
  const manyChanges = { ...GOOD, key_changes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] };
  assert.equal(validateInsights(manyChanges).key_changes.length, 6);
});

test('reportInsightsSchema declares required keys', () => {
  assert.ok(reportInsightsSchema.required.includes('executive_summary'));
  assert.ok(reportInsightsSchema.required.includes('video_ideas'));
  assert.ok(reportInsightsSchema.required.includes('confidence_and_limits'));
});

test('buildDataBundle includes facts and marks missing snapshot data', () => {
  const bundle = {
    channel: { channelId: 'UCx', title: 'Test Channel', subscriberCount: 1200 },
    daily: [],
    videoStats: [
      {
        videoId: 'abc12345678',
        title: 'Top video',
        isShort: false,
        publishedAt: new Date('2026-09-01T00:00:00Z'),
        analyticsViews: 400,
        estimatedMinutesWatched: 33,
        averageViewDurationSeconds: 120,
        averageViewPercentage: 34.5,
        likes: 12,
        comments: 3,
        shares: 1
      }
    ],
    worst: []
  };
  const text = buildDataBundle(bundle);
  assert.ok(text.includes('Test Channel'));
  assert.ok(text.includes('NO daily snapshot data'));
  assert.ok(text.includes('Top video'));
  assert.ok(text.includes('age'));
});

test('formatFullInsights renders the 11 report sections', () => {
  const out = formatFullInsights(validateInsights(GOOD));
  assert.ok(out.includes('AI channel report'));
  for (const heading of ['Key changes', 'Best performers', 'Video ideas', 'Shorts topics', 'Long-form topics', 'Confidence & limitations']) {
    assert.ok(out.includes(heading));
  }
});
