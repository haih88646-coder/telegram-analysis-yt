import { sendText, sendTyping } from './client.js';
import { parseCommand, isOwner, rateLimit } from './security.js';
import { hasDatabase, getEnv, LIMITS } from '../config.js';
import { getOwnChannel } from '../youtube/auth.js';
import { getRecentVideos, extractVideoId, validateVideoId } from '../youtube/videos.js';
import { getChannelDaily, getOverviewTotals, getVideoDaily, getVideoTotals } from '../youtube/analytics.js';
import { syncNow } from '../services/sync.js';
import { buildPerformanceReport, formatTopVideos, buildTrends, getChannelRowsDB, getVideoStatsDB, identifyUnderperformers, clip } from '../services/report.js';
import { collectChannelBundle, generateFullReport, generateIdeas, generateTitles, generateThumbnailConcepts, answerChatQuestion, collectVideoBundle } from '../services/recommendations.js';
import { query } from '../database/db.js';
import { fmtNum, fmtDuration, fmtPct, fmtDelta } from '../utils/formatting.js';
import { AppError } from '../utils/errors.js';
import { logSafeError } from '../utils/errors.js';

const WELCOME = `Welcome! I am your private AI YouTube analyst.\n\nCommands:\n/status - API config and connection status\n/report - channel performance report\n/videos - top 10 videos by views\n/shorts - Shorts analysis\n/longform - long-form analysis\n/trends - recent growth trends\n/ideas - 5 AI video ideas from real data\n/analyze VIDEO_ID - deep dive one video\n/title VIDEO_ID - title alternatives\n/thumbnail VIDEO_ID - thumbnail concepts\n/weekly - weekly AI report\n/sync - refresh analytics storage\n/chat QUESTION - ask about your channel\n\nFirst steps: authorize your channel (see README), then run /sync.`;

const HELP = WELCOME;

const COMMAND_NAMES = new Set(['start', 'help', 'status', 'report', 'videos', 'shorts', 'longform', 'trends', 'ideas', 'analyze', 'title', 'thumbnail', 'weekly', 'sync', 'chat']);

export async function handleTelegramUpdate(update) {
  const message = update?.message || update?.edited_message;
  if (!message || !message.chat || !message.from) return { handled: false };

  const ownerTelegramId = getEnv('OWNER_TELEGRAM_ID');
  if (!isOwner(message.from.id, ownerTelegramId)) {
    if (message.chat.type === 'private') {
      try {
        await sendText(message.chat.id, 'This bot is private. You are not the configured owner.');
      } catch {
        // ignore reply failures to strangers
      }
    }
    return { handled: false, reason: 'not authorized' };
  }

  const chatId = message.chat.id;
  const text = message.text || '';
  const parsed = parseCommand(text);
  if (!parsed) {
    await sendText(chatId, 'I understand commands starting with / . Send /help to see them.');
    return { handled: true };
  }
  if (!COMMAND_NAMES.has(parsed.command)) {
    await sendText(chatId, `Unknown command: /${parsed.command}. Send /help to see available commands.`);
    return { handled: true };
  }

  const isAi = ['ideas', 'analyze', 'title', 'thumbnail', 'weekly', 'chat', 'report'].includes(parsed.command);
  const limiterKey = isAi ? `ai:${ownerTelegramId}` : `gen:${ownerTelegramId}`;
  const limit = isAi ? LIMITS.aiRequestsPerMinute : LIMITS.generalRequestsPerMinute;
  const rl = rateLimit(limiterKey, limit, 60000);
  if (!rl.allowed) {
    await sendText(chatId, 'Too many requests. Please wait a minute before trying again.');
    return { handled: true, reason: 'rate limited' };
  }

  await sendTyping(chatId);
  try {
    await dispatchCommand(parsed.command, parsed.args, chatId, ownerTelegramId);
  } catch (err) {
    logSafeError(`command.${parsed.command}`, err);
    const userMessage = err instanceof AppError || err?.userMessage
      ? err.userMessage
      : `Something went wrong: ${String(err?.message || 'unknown error').slice(0, 200)}`;
    await sendText(chatId, `${userMessage}`).catch(() => {});
  }
  return { handled: true, command: parsed.command };
}

async function dispatchCommand(command, args, chatId, ownerId) {
  switch (command) {
    case 'start':
    case 'help':
      await sendText(chatId, WELCOME);
      return;

    case 'status':
      await cmdStatus(chatId);
      return;

    case 'sync': {
      if (!hasDatabase()) throw needDb();
      const summary = await syncNow();
      const note = summary.videoStatRows === 0 ? '\n\nNote: YouTube creates per-video rows 1-3 days after a video gets views, so brand-new uploads are not listed yet. Lifetime totals (/report, /videos fallback) still work.' : '';
      await sendText(chatId, `Sync complete.\nVideos stored: ${summary.videosSaved}\nDaily analytics rows: ${summary.dailyRows}\nPer-video snapshot rows: ${summary.videoStatRows}\nTraffic source rows: ${summary.trafficRows}${note}${summary.errors.length ? `\n\nWarnings:\n${summary.errors.slice(0, 5).join('\n')}` : ''}`);
      return;
    }

    case 'report': {
      await cmdReport(chatId);
      return;
    }
    case 'videos':
    case 'shorts':
    case 'longform': {
      const filter = command === 'videos' ? undefined : command === 'shorts' ? 'short' : 'long';
      await cmdVideos(chatId, filter);
      return;
    }
    case 'trends':
      await cmdTrends(chatId);
      return;

    case 'weekly':
      await cmdWeekly(chatId);
      return;

    case 'ideas': {
      await sendText(chatId, 'Generating ideas from your channel data... (about 10-30 seconds)');
      const bundle = await collectChannelBundle();
      const text = await generateIdeas(bundle);
      await sendText(chatId, text);
      return;
    }

    case 'analyze':
      await cmdAnalyze(chatId, args);
      return;

    case 'title':
      await cmdTitle(chatId, args);
      return;

    case 'thumbnail':
      await cmdThumbnail(chatId, args);
      return;

    case 'chat': {
      if (!args) {
        await sendText(chatId, 'Ask like this: /chat which video topic grew fastest this month?');
        return;
      }
      if (args.length > 500) {
        await sendText(chatId, 'Please keep questions under 500 characters.');
        return;
      }
      const bundle = await collectChannelBundle();
      const text = await answerChatQuestion(args, bundle);
      await sendText(chatId, text || '(No answer produced. Try again.)');
      return;
    }
    default:
      await sendText(chatId, `Unknown command: /${command}`);
  }
}

function needDb() {
  return new AppError('Database not configured', {
    userMessage: 'This command needs persistent storage. Add DATABASE_URL (free Neon Postgres works) to the environment, redeploy, then run /sync.'
  });
}

async function cmdStatus(chatId) {
  const lines = [];
  lines.push('\u{1F9ED} Status');
  lines.push('');
  const envKeys = ['TELEGRAM_BOT_TOKEN', 'OWNER_TELEGRAM_ID', 'TELEGRAM_WEBHOOK_SECRET', 'GEMINI_API_KEY', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'DATABASE_URL', 'CRON_SECRET'];
  for (const key of envKeys) {
    lines.push(`${getEnv(key) ? '\u2705' : '\u274C'} ${key}: ${getEnv(key) ? 'configured' : 'NOT configured'}`);
  }
  lines.push('');
  lines.push('\u{1F3AC} YouTube channel:');
  try {
    const channel = await getOwnChannel();
    lines.push(`\u2705 Authorized as: ${channel.title}`);
    lines.push(`Channel ID: ${channel.channelId}`);
    lines.push(`Subscribers: ${fmtNum(channel.subscriberCount)}`);
  } catch (err) {
    lines.push(`\u274C Channel check failed: ${err?.userMessage || err?.message || 'unknown error'}`);
  }
  lines.push('');
  if (hasDatabase()) {
    try {
      const lastSync = await query(`SELECT value, updated_at FROM sync_state WHERE key='last_sync_at'`);
      if (lastSync.length) {
        lines.push(`Last sync: ${lastSync[0].value}`);
      } else {
        lines.push('Last sync: never (run /sync)');
      }
      const errs = await query(`SELECT count(*)::int AS n FROM sync_errors`);
      lines.push(`Stored sync errors: ${errs[0]?.n ?? 0}`);
    } catch (err) {
      lines.push(`\u274C Database reachable but schema check failed: ${err.message}`);
    }
  } else {
    lines.push('Database: not configured (live-only commands still work)');
  }
  await sendText(chatId, lines.join('\n'));
}

async function getDailyRowsWithLiveFallback(channelId) {
  if (hasDatabase()) {
    const rows = await getChannelRowsDB(channelId || null);
    if (rows && rows.length > 0) return { rows, source: 'stored snapshots (run /sync to refresh)' };
  }
  const live = await getChannelDaily(28);
  return { rows: live, source: 'live YouTube Analytics API call' };
}

async function getVideoStatsWithLiveFallback(channelId) {
  if (hasDatabase()) {
    const stats = await getVideoStatsDB(channelId || null);
    if (stats && stats.length > 0) return { stats, source: 'stored snapshot' };
  }
  try {
    const { getPerVideoTotals } = await import('../youtube/analytics.js');
    const { getRecentVideos } = await import('../youtube/videos.js');
    const perVideo = await getPerVideoTotals(30);
    const { videos } = await getRecentVideos(200);
    const metaById = new Map(
      videos
        .filter((v) => !channelId || v.channelId === channelId)
        .map((v) => [v.videoId, v])
    );
    const stats = perVideo
      .filter((s) => metaById.has(s.videoId))
      .map((s) => {
        const v = metaById.get(s.videoId);
        return { videoId: s.videoId, title: v.title, isShort: v.isShort, publishedAt: v.publishedAt, lifetimeViews: v.lifetimeViews, analyticsViews: s.views, estimatedMinutesWatched: s.estimatedMinutesWatched, averageViewDurationSeconds: s.averageViewDurationSeconds, averageViewPercentage: s.averageViewPercentage, likes: s.likes, comments: s.comments, shares: s.shares };
      });
    return { stats, source: 'live YouTube Analytics API call' };
  } catch {
    return { stats: [], source: 'unavailable' };
  }
}

async function cmdReport(chatId) {
  const channel = await getOwnChannel();
  const [{ rows, source: dailySource }, { stats, source: videoStatsSource }] = await Promise.all([
    getDailyRowsWithLiveFallback(channel.channelId),
    getVideoStatsWithLiveFallback(channel.channelId)
  ]);
  const text = buildPerformanceReport(channel.title, rows, stats);
  await sendText(chatId, `${text}\n\nData source: ${dailySource}; per-video: ${videoStatsSource}`);
}

async function cmdVideos(chatId, filter) {
  const channel = await getOwnChannel();
  const { stats } = await getVideoStatsWithLiveFallback(channel.channelId);
  if (stats.length === 0) {
    const { videos } = await getRecentVideos(200);
    const list = filter ? videos.filter((v) => (filter === 'shorts' ? v.isShort : !v.isShort)) : videos;
    const head = 'No per-video Analytics rows yet (videos too new for the 1-3 day reporting delay).\nLifetime totals from Data API instead:\n\n';
    if (list.length === 0) {
      await sendText(chatId, `${head}No such videos found on the channel.`);
      return;
    }
    const lines = list.slice(0, 10).map((v, i) => `${i + 1}. ${v.isShort ? '[Short] ' : ''}${v.title} | ${fmtNum(v.lifetimeViews)} views (${v.videoId})`);
    await sendText(chatId, `${head}${lines.join('\n')}`);
    return;
  }
  await sendText(chatId, formatTopVideos(stats, { filter, limit: 10 }));
}

async function cmdTrends(chatId) {
  const channel = await getOwnChannel();
  const { rows } = await getDailyRowsWithLiveFallback(channel.channelId);
  await sendText(chatId, buildTrends(rows));
}

async function cmdWeekly(chatId) {
  const bundle = await collectChannelBundle();
  const rubricNote = `Data freshness: ${bundle.hasDaily ? 'daily snapshots present' : 'no daily snapshots yet - run /sync'}. ${bundle.videoStats.length} videos in the per-video window.`;
  const text = await generateFullReport(bundle);
  await sendText(chatId, `${text}\n\n${rubricNote}`);
}

async function resolveVideoArg(args) {
  const raw = args.trim();
  if (!raw) return { error: 'Provide a video ID or URL. Example: /analyze dQw4w9WgXcQ' };
  if (raw.length > 300) return { error: 'That input is too long.' };
  const id = extractVideoId(raw) || validateVideoId(raw);
  if (!id) return { error: 'That does not look like a valid YouTube video ID (11 characters) or a YouTube URL.' };
  return { id };
}

async function getVideoMeta(videoId) {
  const { getRecentVideos, validateVideoId, extractVideoId } = await import('../youtube/videos.js');
  const id = validateVideoId(extractVideoId(videoId));
  if (!id) return null;
  const { videos } = await getRecentVideos(200);
  const v = videos.find((x) => x.videoId === id);
  if (!v) {
    const { getYoutubeClients } = await import('../youtube/auth.js');
    const { youtube } = getYoutubeClients();
    const res = await youtube.videos.list({ part: 'snippet,contentDetails,statistics', id });
    const item = res?.data?.items?.[0];
    if (!item) return null;
    const { normalizeVideo } = await import('../youtube/videos.js');
    return normalizeVideo(item);
  }
  return v;
}

async function cmdAnalyze(chatId, args) {
  const resolved = resolveVideoArg(args);
  if (resolved.error) {
    await sendText(chatId, resolved.error);
    return;
  }
  const videoId = resolved.id;
  if (!videoId) {
    await sendText(chatId, 'Video ID missing. Use /analyze VIDEO_ID or /analyze YOUTUBE_URL.');
    return;
  }
  const meta = await getVideoMeta(videoId);
  if (!meta) {
    await sendText(chatId, `No video found for ID ${videoId} on your channel.`);
    return;
  }
  const shortLabel = meta.isShort ? 'Short' : 'Long-form';
  let lines = [];
  lines.push(`\u{1F50D} Video analysis: ${clip(meta.title, 90)}`);
  lines.push('');
  lines.push(`https://youtube.com/watch?v=${videoId}`);
  lines.push(`Format: ${shortLabel} (${fmtDuration(meta.durationSeconds)})`);
  lines.push(`Published: ${meta.publishedAt ? meta.publishedAt.slice(0, 10) : 'unknown'}`);
  lines.push(`Lifetime (Data API): ${fmtNum(meta.lifetimeViews)} views, ${fmtNum(meta.lifetimeLikes)} likes, ${fmtNum(meta.lifetimeComments)} comments`);
  try {
    const totals = await getVideoTotals(videoId, 90);
    if (totals) {
      lines.push('');
      lines.push('Analytics (last 90 days of availability):');
      lines.push(`\u2022 Views: ${fmtNum(totals.views)}`);
      lines.push(`\u2022 Minutes watched: ${fmtNum(totals.estimatedMinutesWatched)}`);
      lines.push(`\u2022 Avg view duration: ${fmtDuration(totals.averageViewDurationSeconds)}`);
      if (totals.averageViewPercentage !== null) lines.push(`\u2022 Avg viewed: ${fmtPct(totals.averageViewPercentage)}`);
      lines.push(`\u2022 Likes: ${fmtNum(totals.likes)} | Comments: ${fmtNum(totals.comments)} | Shares: ${fmtNum(totals.shares)}`);
    }
    const daily = await getVideoDaily(videoId, 21);
    if (daily.length) {
      lines.push('');
      lines.push('Recent daily views:');
      for (const row of daily.slice(-7)) {
        lines.push(`\u2022 ${row.date}: ${fmtNum(row.views)}`);
      }
    }
  } catch (err) {
    lines.push('');
    lines.push(`Analytics query failed: ${err?.userMessage || err?.message}`);
  }
  await sendText(chatId, lines.join('\n'));
}

async function cmdTitle(chatId, args) {
  const resolved = resolveVideoArg(args);
  if (resolved.error) {
    await sendText(chatId, resolved.error);
    return;
  }
  const bundle = await collectVideoBundle(resolved.id);
  if (!bundle) {
    await sendText(chatId, 'That video is not on your channel or not recent. Use a video ID from your channel (or /videos).');
    return;
  }
  const text = await generateTitles(bundle);
  await sendText(chatId, text);
}

async function cmdThumbnail(chatId, args) {
  const resolved = resolveVideoArg(args);
  if (resolved.error) {
    await sendText(chatId, resolved.error);
    return;
  }
  const bundle = await collectVideoBundle(resolved.id);
  if (!bundle) {
    await sendText(chatId, 'That video is not on your channel or not recent. Use a video ID from your channel (or /videos).');
    return;
  }
  const text = await generateThumbnailConcepts(bundle);
  await sendText(chatId, text);
}
