import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceReport, formatTopVideos, buildTrends, identifyUnderperformers, sumWindow } from '../src/services/report.js';
import { parseCommand, verifyWebhookSecret, isOwner, rateLimit } from '../src/telegram/security.js';

const daily = [
  { date: '2026-10-01', views: 100, estimatedMinutesWatched: 50, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 5, subscribersLost: 1, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-02', views: 120, estimatedMinutesWatched: 60, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 6, subscribersLost: 2, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-03', views: 130, estimatedMinutesWatched: 65, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 7, subscribersLost: 0, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-04', views: 90, estimatedMinutesWatched: 45, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 4, subscribersLost: 3, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-05', views: 110, estimatedMinutesWatched: 55, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 5, subscribersLost: 1, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-06', views: 140, estimatedMinutesWatched: 70, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 8, subscribersLost: 0, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-07', views: 130, estimatedMinutesWatched: 65, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 7, subscribersLost: 0, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-08', views: 60, estimatedMinutesWatched: 30, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 2, subscribersLost: 1, likes: 10, comments: 2, shares: 1 },
  { date: '2026-10-09', views: 50, estimatedMinutesWatched: 25, averageViewDurationSeconds: 30, averageViewPercentage: null, subscribersGained: 1, subscribersLost: 2, likes: 10, comments: 2, shares: 1 }
];

test('buildPerformanceReport computes week over week and lists shorts split', () => {
  const videoStats = [
    { videoId: 'a', title: 'Short A', isShort: true, analyticsViews: 500, estimatedMinutesWatched: 10, averageViewDurationSeconds: 30, averageViewPercentage: 60, likes: 1, comments: 1, shares: 1 },
    { videoId: 'b', title: 'Long B', isShort: false, analyticsViews: 300, estimatedMinutesWatched: 30, averageViewDurationSeconds: 300, averageViewPercentage: 45, likes: 1, comments: 1, shares: 1 }
  ];
  const text = buildPerformanceReport('My Channel', daily, videoStats);
  assert.ok(text.includes('My Channel'));
  assert.ok(text.includes('Views:'));
  assert.ok(text.includes('Shorts vs long-form'));
  assert.ok(text.includes('Shorts: 1 videos, 500 views'));
});

test('buildPerformanceReport explains missing data', () => {
  const out = buildPerformanceReport('Ch', [], null);
  assert.ok(out.includes('No channel analytics rows'));
});

test('formatTopVideos lists top 10 with links', () => {
  const stats = Array.from({ length: 12 }, (_, i) => ({
    videoId: 'id' + String(i).padStart(9, '0'),
    title: `Video ${i}`,
    isShort: i % 2 === 0,
    analyticsViews: 1000 - i * 10,
    estimatedMinutesWatched: 10,
    averageViewDurationSeconds: 100,
    averageViewPercentage: 50,
    likes: 5,
    comments: 5,
    shares: 5
  }));
  const text = formatTopVideos(stats, {});
  assert.ok(text.includes('Top 10 videos'));
  for (let i = 0; i < 10; i++) assert.ok(text.includes(`Video ${i}`));
  assert.ok(!text.includes('Video 10'));
});

test('formatTopVideos filters shorts', () => {
  const stats = [
    { videoId: 'a', title: 'Short A', isShort: true, analyticsViews: 500, analyticsViews2: 0, estimatedMinutesWatched: 1, averageViewDurationSeconds: 30, averageViewPercentage: null, likes: 0, comments: 0, shares: 0 },
    { videoId: 'b', title: 'Long B', isShort: false, analyticsViews: 600, estimatedMinutesWatched: 100, averageViewDurationSeconds: 600, averageViewPercentage: 55, likes: 0, comments: 0, shares: 0 }
  ];
  const shorts = formatTopVideos(stats, { filter: 'short' });
  assert.ok(shorts.includes('Short A'));
  assert.ok(!shorts.includes('Long B'));
});

test('buildTrends requires stored history', () => {
  const empty = buildTrends([]);
  assert.ok(empty.includes('Not enough stored history'));
});

test('buildTrends computes deltas from 10 days', () => {
  const out = buildTrends(daily);
  assert.ok(out.includes('Growth trends'));
  assert.ok(out.includes('Best recent day'));
});

test('sumWindow matches report implementation', () => {
  const got = sumWindow(daily, 'views', '2026-10-03', '2026-10-05');
  assert.equal(got, 330);
});

test('identifyUnderperformers skips videos below 50 views', () => {
  const stats = [
    { title: 'a', analyticsViews: 200, averageViewPercentage: 20 },
    { title: 'b', analyticsViews: 10, averageViewPercentage: 5 },
    { title: 'c', analyticsViews: 300, averageViewPercentage: 10 }
  ];
  const worst = identifyUnderperformers(stats);
  assert.equal(worst.length, 2);
  assert.deepEqual(worst.map((v) => v.title), ['c', 'a']);
});
