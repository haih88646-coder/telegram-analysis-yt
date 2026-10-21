import { query, hasDb, dbNotConfiguredError } from '../database/db.js';
import { getChannelDaily } from '../youtube/analytics.js';
import { getOwnChannel } from '../youtube/auth.js';
import { fmtNum, fmtDuration, fmtPct, fmtDelta } from '../utils/formatting.js';
import { addDays, todayIso } from '../utils/dates.js';
import { logSafeError } from '../utils/errors.js';

export async function getChannelRowsDB() {
  if (!hasDb()) return null;
  try {
    const rows = await query(
      `SELECT date, views, estimated_minutes_watched, average_view_duration_seconds, average_view_percentage, subscribers_gained, subscribers_lost, likes, comments, shares
       FROM channel_daily ORDER BY date DESC LIMIT 120`
    );
    return rows.map((r) => ({
      date: typeof r.date === 'string' ? r.date.slice(0, 10) : r.date,
      views: Number(r.views) || 0,
      estimatedMinutesWatched: Number(r.estimated_minutes_watched) || 0,
      averageViewDurationSeconds: Number(r.average_view_duration_seconds) || 0,
      averageViewPercentage: r.average_view_percentage === null || r.average_view_percentage === undefined ? null : Number(r.average_view_percentage),
      subscribersGained: Number(r.subscribers_gained) || 0,
      subscribersLost: Number(r.subscribers_lost) || 0,
      likes: Number(r.likes) || 0,
      comments: Number(r.comments) || 0,
      shares: Number(r.shares) || 0
    }));
  } catch (err) {
    logSafeError('report.read_daily', err);
    return null;
  }
}

export async function getVideoStatsDB(channelId) {
  if (!hasDb() || !channelId) return null;
  try {
    const rows = await query(
      `SELECT v.video_id, v.title, v.is_short, v.published_at, v.lifetime_views,
              s.views, s.estimated_minutes_watched, s.average_view_duration_seconds, s.average_view_percentage, s.likes, s.comments, s.shares
       FROM video_stats s
       JOIN videos v ON v.video_id = s.video_id
       WHERE s.sync_date = (SELECT MAX(sync_date) FROM video_stats)
       ORDER BY s.views DESC`
    );
    return rows.map((r) => ({
      videoId: r.video_id,
      title: r.title,
      isShort: Boolean(r.is_short),
      publishedAt: r.published_at,
      lifetimeViews: Number(r.lifetime_views) || 0,
      analyticsViews: Number(r.views) || 0,
      estimatedMinutesWatched: Number(r.estimated_minutes_watched) || 0,
      averageViewDurationSeconds: Number(r.average_view_duration_seconds) || 0,
      averageViewPercentage: r.average_view_percentage === null || r.average_view_percentage === undefined ? null : Number(r.average_view_percentage),
      likes: Number(r.likes) || 0,
      comments: Number(r.comments) || 0,
      shares: Number(r.shares) || 0
    }));
  } catch (err) {
    logSafeError('report.read_video_stats', err);
    return null;
  }
}

export function sumWindow(rows, field, fromIso, toIso) {
  return rows
    .filter((r) => r.date >= fromIso && r.date <= toIso)
    .reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

export function buildPerformanceReport(channelTitle, daily, videoStats) {
  if (!daily || daily.length === 0) {
    return 'No channel analytics rows available yet.\nRun /sync first — analytics data may also take 48-72 hours to appear from YouTube.';
  }
  const latest = daily[0].date;
  const recentFrom = addDays(latest, -6);
  const priorFrom = addDays(latest, -13);
  const priorTo = addDays(latest, -7);

  const r7 = {
    views: sumWindow(daily, 'views', recentFrom, latest),
    minutes: sumWindow(daily, 'estimatedMinutesWatched', recentFrom, latest),
    subsG: sumWindow(daily, 'subscribersGained', recentFrom, latest),
    subsL: sumWindow(daily, 'subscribersLost', recentFrom, latest),
    likes: sumWindow(daily, 'likes', recentFrom, latest),
    comments: sumWindow(daily, 'comments', recentFrom, latest),
    shares: sumWindow(daily, 'shares', recentFrom, latest)
  };
  const p7 = {
    views: sumWindow(daily, 'views', priorFrom, priorTo),
    minutes: sumWindow(daily, 'estimatedMinutesWatched', priorFrom, priorTo),
    subsG: sumWindow(daily, 'subscribersGained', priorFrom, priorTo),
    subsL: sumWindow(daily, 'subscribersLost', priorFrom, priorTo),
    likes: sumWindow(daily, 'likes', priorFrom, priorTo),
    comments: sumWindow(daily, 'comments', priorFrom, priorTo),
    shares: sumWindow(daily, 'shares', priorFrom, priorTo)
  };
  const avgRecentDur = weightedAvgDur(daily, recentFrom, latest);
  const avgPriorDur = weightedAvgDur(daily, priorFrom, priorTo);

  const lines = [];
  lines.push(`\u{1F4CA} Channel report \u2014 ${channelTitle}`);
  lines.push(`Analytics window: ${recentFrom} to ${latest} (first 7 days) vs previous 7 days.`);
  lines.push('');
  lines.push(`Views: ${fmtNum(r7.views)} (${fmtDelta(r7.views, p7.views)})`);
  lines.push(`Watch time: ${fmtNum(r7.minutes)} min (${fmtDelta(r7.minutes, p7.minutes)})`);
  lines.push(`Avg view duration: ${fmtDuration(avgRecentDur)} (prev: ${fmtDuration(avgPriorDur)})`);
  lines.push(`Subscribers: +${fmtNum(r7.subsG)} / -${fmtNum(r7.subsL)} (net ${fmtDelta(r7.subsG - r7.subsL, p7.subsG - p7.subsL)})`);
  lines.push(`Likes: ${fmtNum(r7.likes)} | Comments: ${fmtNum(r7.comments)} | Shares: ${fmtNum(r7.shares)}`);

  if (videoStats && videoStats.length > 0) {
    const shorts = videoStats.filter((v) => v.isShort);
    const longform = videoStats.filter((v) => !v.isShort);
    const sViews = shorts.reduce((a, v) => a + v.analyticsViews, 0);
    const lViews = longform.reduce((a, v) => a + v.analyticsViews, 0);
    lines.push('');
    lines.push(`Shorts vs long-form (trailing window where each was synced):`);
    lines.push(`\u2022 Shorts: ${shorts.length} videos, ${fmtNum(sViews)} views`);
    lines.push(`\u2022 Long-form: ${longform.length} videos, ${fmtNum(lViews)} views`);
    const pctOf = (list) => {
      const withPct = list.filter((v) => v.averageViewPercentage !== null && v.averageViewPercentage > 0);
      if (withPct.length === 0) return null;
      return withPct.reduce((a, v) => a + v.averageViewPercentage, 0) / withPct.length;
    };
    const sPct = pctOf(shorts);
    const lPct = pctOf(longform);
    if (sPct !== null) lines.push(`\u2022 Shorts avg % viewed: ${fmtPct(sPct)}`);
    if (lPct !== null) lines.push(`\u2022 Long-form avg % viewed: ${fmtPct(lPct)}`);
  } else {
    lines.push('');
    lines.push('(Run /sync to collect per-video analytics for Shorts vs long-form splits.)');
  }

  const trendRows = daily.slice(0, 7).reverse();
  lines.push('');
  lines.push('Daily views (last 7 available days):');
  for (const row of trendRows) {
    lines.push(`\u2022 ${row.date}: ${fmtNum(row.views)} views, +${fmtNum(row.subscribersGained)}/-${fmtNum(row.subscribersLost)} subs`);
  }
  return lines.join('\n');
}

function weightedAvgDur(rows, fromIso, toIso) {
  let totalViews = 0;
  let weighted = 0;
  for (const r of rows) {
    if (r.date < fromIso || r.date > toIso) continue;
    totalViews += r.views;
    weighted += r.views * (r.averageViewDurationSeconds || 0);
  }
  return totalViews > 0 ? weighted / totalViews : 0;
}

export function formatTopVideos(videoStats, opts = {}) {
  if (!videoStats || videoStats.length === 0) {
    return 'No per-video analytics stored yet. Run /sync first, then retry.';
  }
  let list = videoStats;
  if (opts.filter) list = list.filter((v) => (opts.filter === 'short' ? v.isShort : !v.isShort));
  if (list.length === 0) return `No ${opts.filter === 'short' ? 'Shorts' : 'long-form videos'} found in the recent analytics window.`;
  list = [...list].sort((a, b) => b.analyticsViews - a.analyticsViews).slice(0, opts.limit || 10);
  const header = opts.filter === 'short' ? '\u{1F3AC} Top Shorts' : opts.filter === 'long' ? '\u{1F39E} Top long-form videos' : '\u{1F3AC} Top 10 videos';
  const lines = [`${header} (views>${opts.minViews || 0} in trailing analytics window)`];
  list.forEach((v, i) => {
    const dur = v.isShort ? 'Short' : fmtDuration(v.averageViewDurationSeconds);
    const pct = v.averageViewPercentage !== null ? ` \u2022 ${fmtPct(v.averageViewPercentage)} watched` : '';
    lines.push(`${i + 1}. ${clip(v.title, 90)} \u2014 ${fmtNum(v.analyticsViews)} views \u2022 ${dur}${pct}`);
    lines.push(`   https://youtube.com/watch?v=${v.videoId}`);
  });
  return lines.join('\n');
}

export function identifyUnderperformers(videoStats) {
  if (!videoStats) return null;
  const eligible = videoStats.filter((v) => v.analyticsViews >= 50 && v.averageViewPercentage !== null);
  const sorted = [...eligible].sort((a, b) => (a.averageViewPercentage || 0) - (b.averageViewPercentage || 0));
  return sorted.slice(0, 5);
}

export function buildTrends(daily) {
  if (!daily || daily.length < 8) {
    return 'Not enough stored history yet. Run /sync daily to build a trend history (7+ days of snapshots).';
  }
  const latest = daily[0].date;
  const thisWeek = sumWindow(daily, 'views', addDays(latest, -6), latest);
  const prevWeek = sumWindow(daily, 'views', addDays(latest, -13), addDays(latest, -7));
  const subThis = sumWindow(daily, 'subscribersGained', addDays(latest, -6), latest);
  const subPrev = sumWindow(daily, 'subscribersGained', addDays(latest, -13), addDays(latest, -7));
  const lostThis = sumWindow(daily, 'subscribersLost', addDays(latest, -6), latest);
  const lostPrev = sumWindow(daily, 'subscribersLost', addDays(latest, -13), addDays(latest, -7));
  const lines = [];
  lines.push('\u{1F4C8} Growth trends (based on stored daily snapshots)');
  lines.push('');
  lines.push(`Views \u2014 last 7 synced days: ${fmtNum(thisWeek)} (${fmtDelta(thisWeek, prevWeek)} vs previous 7)`);
  lines.push(`Subs gained \u2014 last 7: ${fmtNum(subThis)} (${fmtDelta(subThis, subPrev)})`);
  lines.push(`Subs lost \u2014 last 7: ${fmtNum(lostThis)} (${fmtDelta(lostThis, lostPrev)})`);
  const bestDay = [...daily.slice(0, 14)].sort((a, b) => b.views - a.views)[0];
  if (bestDay) lines.push(`Best recent day: ${bestDay.date} \u2014 ${fmtNum(bestDay.views)} views`);
  lines.push('');
  lines.push('Daily snapshots stored for the last ' + Math.min(daily.length, 30) + ' available days.');
  return lines.join('\n');
}

export function clip(text, max) {
  const t = String(text || '');
  return t.length > max ? t.slice(0, max - 1) + '\u2026' : t;
}
