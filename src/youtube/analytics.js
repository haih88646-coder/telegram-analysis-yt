import { getYoutubeClients } from './auth.js';
import { withRetries, describeGoogleError, isRetryableStatus } from '../utils/errors.js';
import { analyticsWindow } from '../utils/dates.js';

const CHANNEL_METRICS = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
  'shares'
].join(',');

const VIDEO_METRICS = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'likes',
  'comments',
  'shares'
].join(',');

const RETRYABLE_ANALYTICS = (err) => {
  const status = Number(err?.status || err?.code || err?.response?.status || 0);
  return isRetryableStatus(status) || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET';
};

async function runQuery(params) {
  const { youtubeAnalytics } = getYoutubeClients();
  const res = await withRetries(
    async () => {
      try {
        return await youtubeAnalytics.reports.query(params);
      } catch (err) {
        throw describeGoogleError(err);
      }
    },
    { retries: 2, baseDelayMs: 800 },
    RETRYABLE_ANALYTICS
  );
  const data = res?.data || {};
  if (data.rows === undefined && data.rows === null) return [];
  return parseAnalyticsResponse(data).filter(
    (row) => !Object.values(row).every((v) => v === undefined || v === null)
  );
}

export function parseAnalyticsResponse(data) {
  const headers = (data.columnHeaders || []).map((h) => h.name);
  const rows = data.rows || [];
  return rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getChannelDaily(days = 28) {
  const { startDate, endDate } = analyticsWindow(days);
  const rows = await runQuery({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: CHANNEL_METRICS,
    dimensions: 'day',
    sort: '+day',
    maxResults: Math.min(days + 3, 100)
  });
  return rows.map((r) => ({
    date: r.day,
    views: num(r.views),
    estimatedMinutesWatched: num(r.estimatedMinutesWatched),
    averageViewDurationSeconds: num(r.averageViewDuration),
    averageViewPercentage: r.averageViewPercentage === undefined ? null : num(r.averageViewPercentage),
    subscribersGained: num(r.subscribersGained),
    subscribersLost: num(r.subscribersLost),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares)
  }));
}

export async function getPerVideoTotals(days = 30) {
  const { startDate, endDate } = analyticsWindow(days);
  const rows = await runQuery({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: VIDEO_METRICS,
    dimensions: 'video',
    maxResults: 200
  });
  return rows
    .filter((r) => r.video)
    .map((r) => ({
      videoId: r.video,
      views: num(r.views),
      estimatedMinutesWatched: num(r.estimatedMinutesWatched),
      averageViewDurationSeconds: num(r.averageViewDuration),
      averageViewPercentage: r.averageViewPercentage === undefined ? null : num(r.averageViewPercentage),
      likes: num(r.likes),
      comments: num(r.comments),
      shares: num(r.shares)
    }));
}

export async function getVideoDaily(videoId, days = 21) {
  const { startDate, endDate } = analyticsWindow(days);
  const rows = await runQuery({
    ids: 'channel==MINE',
    startDate,
    endDate,
    filters: `video==${videoId}`,
    metrics: VIDEO_METRICS,
    dimensions: 'day',
    sort: '+day',
    maxResults: 40
  });
  return rows.map((r) => ({
    date: r.day,
    views: num(r.views),
    estimatedMinutesWatched: num(r.estimatedMinutesWatched),
    averageViewDurationSeconds: num(r.averageViewDuration),
    averageViewPercentage: r.averageViewPercentage === undefined ? null : num(r.averageViewPercentage),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares)
  }));
}

export async function getOverviewTotals(days = 7) {
  const { startDate, endDate } = analyticsWindow(days);
  const rows = await runQuery({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: CHANNEL_METRICS
  });
  const r = rows[0] || {};
  return {
    views: num(r.views),
    estimatedMinutesWatched: num(r.estimatedMinutesWatched),
    averageViewDurationSeconds: num(r.averageViewDuration),
    averageViewPercentage: r.averageViewPercentage === undefined ? null : num(r.averageViewPercentage),
    subscribersGained: num(r.subscribersGained),
    subscribersLost: num(r.subscribersLost),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares)
  };
}

export async function getTrafficSources(days = 28) {
  const { startDate, endDate } = analyticsWindow(days);
  const rows = await runQuery({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'trafficSourceType',
    maxResults: 60
  });
  return rows
    .filter((r) => r.trafficSourceType)
    .map((r) => ({
      trafficSource: r.trafficSourceType,
      views: num(r.views),
      estimatedMinutesWatched: num(r.estimatedMinutesWatched)
    }));
}

export async function getVideoTotals(videoId, days = 90) {
  const { startDate, endDate } = analyticsWindow(days);
  const rows = await runQuery({
    ids: 'channel==MINE',
    startDate,
    endDate,
    filters: `video==${videoId}`,
    metrics: VIDEO_METRICS
  });
  const r = rows[0] || null;
  if (!r) return null;
  return {
    videoId,
    views: num(r.views),
    estimatedMinutesWatched: num(r.estimatedMinutesWatched),
    averageViewDurationSeconds: num(r.averageViewDuration),
    averageViewPercentage: r.averageViewPercentage === undefined ? null : num(r.averageViewPercentage),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares)
  };
}

