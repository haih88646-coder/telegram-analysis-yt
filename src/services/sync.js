import { getRecentVideos } from '../youtube/videos.js';
import { getChannelDaily, getPerVideoTotals, getTrafficSources } from '../youtube/analytics.js';
import { query, dbNotConfiguredError } from '../database/db.js';
import { todayIso } from '../utils/dates.js';
import { logSafeError } from '../utils/errors.js';

export async function syncNow({ days = 28, videoLimit = 200 } = {}) {
  const errors = [];
  const summary = { channel: null, videosSaved: 0, dailyRows: 0, videoStatRows: 0, trafficRows: 0 };

  const dailyRes = await getChannelDaily(days);
  const perVideo = await getPerVideoTotals(days);
  const traffic = await getTrafficSources(days);
  const { channel, videos } = await getRecentVideos(videoLimit);
  summary.channel = channel.title;

  if (channel) {
    await query(
      `INSERT INTO channels (channel_id, title, username, subscriber_count, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (channel_id) DO UPDATE SET title=$2, username=$3, subscriber_count=$4, updated_at=now()`,
      [channel.channelId, channel.title, channel.username, channel.subscriberCount]
    );
  }
  for (const v of videos) {
    try {
      const result = await query(
        `INSERT INTO videos (video_id, channel_id, title, description, duration_seconds, is_short, published_at, lifetime_views, lifetime_likes, lifetime_comments, tags, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now())
         ON CONFLICT (video_id) DO UPDATE SET title=$3, description=$4, duration_seconds=$5, is_short=$6, published_at=$7, lifetime_views=$8, lifetime_likes=$9, lifetime_comments=$10, tags=$11::jsonb, updated_at=now()`,
        [v.videoId, channel.channelId, v.title, v.description.slice(0, 5000), v.durationSeconds, v.isShort, v.publishedAt, v.lifetimeViews, v.lifetimeLikes, v.lifetimeComments, JSON.stringify(v.tags || [])]
      );
      summary.videosSaved++;
    } catch (err) {
      logSafeError('sync.video', err);
      errors.push(`video ${v.videoId}: ${err.message}`);
    }
  }

  for (const row of dailyRes) {
    try {
      await query(
        `INSERT INTO channel_daily (channel_id, date, views, estimated_minutes_watched, average_view_duration_seconds, average_view_percentage, subscribers_gained, subscribers_lost, likes, comments, shares)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (channel_id, date) DO UPDATE SET views=$3, estimated_minutes_watched=$4, average_view_duration_seconds=$5, average_view_percentage=$6, subscribers_gained=$7, subscribers_lost=$8, likes=$9, comments=$10, shares=$11`,
        [channel.channelId, row.date, row.views, row.estimatedMinutesWatched, row.averageViewDurationSeconds, row.averageViewPercentage, row.subscribersGained, row.subscribersLost, row.likes, row.comments, row.shares]
      );
      summary.dailyRows++;
    } catch (err) {
      logSafeError('sync.channel_daily', err);
      errors.push(`channel_daily ${row.date}: ${err.message}`);
    }
  }

  const syncDate = todayIso();
  const knownVideoIds = new Set(videos.map((v) => v.videoId));
  for (const stat of perVideo) {
    if (!knownVideoIds.has(stat.videoId)) continue;
    try {
      await query(
        `INSERT INTO video_stats (video_id, sync_date, window_days, views, estimated_minutes_watched, average_view_duration_seconds, average_view_percentage, likes, comments, shares)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (video_id, sync_date, window_days) DO UPDATE SET views=$4, estimated_minutes_watched=$5, average_view_duration_seconds=$6, average_view_percentage=$7, likes=$8, comments=$9, shares=$10`,
        [stat.videoId, syncDate, days, stat.views, stat.estimatedMinutesWatched, stat.averageViewDurationSeconds, stat.averageViewPercentage, stat.likes, stat.comments, stat.shares]
      );
      summary.videoStatRows++;
    } catch (err) {
      logSafeError('sync.video_stats', err);
      errors.push(`video_stats ${stat.videoId}: ${err.message}`);
    }
  }

  for (const t of traffic) {
    try {
      await query(
        `INSERT INTO channel_traffic (channel_id, sync_date, window_days, traffic_source, views, estimated_minutes_watched)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (channel_id, sync_date, window_days, traffic_source) DO UPDATE SET views=$5, estimated_minutes_watched=$6`,
        [channel.channelId, syncDate, days, t.trafficSource, t.views, t.estimatedMinutesWatched]
      );
      summary.trafficRows++;
    } catch (err) {
      logSafeError('sync.traffic', err);
      errors.push(`traffic ${t.trafficSource}: ${err.message}`);
    }
  }

  await query(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('last_sync_at', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [new Date().toISOString()]
  );
  await query(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('last_sync_summary', $1, now())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [JSON.stringify({ ...summary, errors })]
  );
  for (const message of errors.slice(0, 10)) {
    await query(`INSERT INTO sync_errors (context, message) VALUES ('sync', $1)`, [message.slice(0, 400)]);
  }

  return { ...summary, errors };
}
