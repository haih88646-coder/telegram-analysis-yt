import { generateJson, generateText, reportInsightsSchema, ideaListSchema, titleSuggestionsSchema, thumbnailConceptsSchema, ensureString, ensureStringList } from '../gemini/analyst.js';
import { getChannelRowsDB, getVideoStatsDB, identifyUnderperformers, sumWindow, clip } from './report.js';
import { getOwnChannel } from '../youtube/auth.js';
import { getVideoDaily, getVideoTotals } from '../youtube/analytics.js';
import { query } from '../database/db.js';
import { fmtNum, fmtDuration, fmtPct } from '../utils/formatting.js';
import { addDays } from '../utils/dates.js';
import { logSafeError, AppError } from '../utils/errors.js';

const GROUNDING_RULES = `You are a YouTube growth analyst working with real channel analytics supplied below.
Rules you MUST follow:
- Base every statement on the supplied data. Never invent metrics.
- Distinguish observed facts ("views fell 20% week over week") from hypotheses ("this may be due to topic fatigue").
- Compare Shorts with Shorts and long-form with long-form only. Never cross-compare the two formats against each other.
- Comparing individual videos, note their age since publication where provided.
- If data is noisy or the sample is small, say so and suggest an experiment instead of a confident claim.
- Never promise views, virality, or specific outcomes.
- Respond in plain text; do not use markdown formatting symbols such as *, _, or backticks.`;

export class ValidationError extends AppError {
  constructor(message) {
    super(message, {
      name: 'ValidationError',
      userMessage: 'The AI response was invalid. Please try again in a minute.'
    });
  }
}

function aiFailureUserMessage(err) {
  const text = String(err?.message || 'unknown error').slice(0, 200);
  if (err?.status === 404 || /no longer available|not found for API version/i.test(text)) {
    return `AI model is not available for your API key: ${text}\nSwitch with /model - for example: /model gemini-3.5-flash-lite or /model gemini-2.5-flash. Send just /model to see the current value.`;
  }
  if (err?.status === 503 || /high demand|overloaded|model is overloaded/i.test(text)) {
    return `AI model overloaded right now (503): ${text}\nYour key and settings are fine. Retry /ideas in 5-10 minutes. If it keeps failing, switch with /model, e.g. /model gemini-2.5-flash.`;
  }
  if (err?.status === 429 || /rate limit|RESOURCE_EXHAUSTED|quota/i.test(text)) {
    return `AI rate limit or quota reached: ${text}\nWait a few minutes, or switch with /model to another model.`;
  }
  return `AI request failed: ${text}. If it mentions "rate limit", wait about a minute and retry.`;
}

export function validateInsights(obj) {
  if (!obj || typeof obj !== 'object') throw new ValidationError('empty');
  return {
    executive_summary: ensureString(obj, 'executive_summary'),
    key_changes: ensureStringList(obj, 'key_changes', 6),
    best_videos: ensureStringList(obj, 'best_videos', 5),
    underperforming_videos: ensureStringList(obj, 'underperforming_videos', 5),
    video_ideas: ensureStringList(obj, 'video_ideas', 5),
    shorts_topics: ensureStringList(obj, 'shorts_topics', 5),
    longform_topics: ensureStringList(obj, 'longform_topics', 5),
    hooks_and_titles: ensureStringList(obj, 'hooks_and_titles', 6),
    experiments_next_7_days: ensureStringList(obj, 'experiments_next_7_days', 5),
    metrics_to_monitor: ensureStringList(obj, 'metrics_to_monitor', 5),
    confidence_and_limits: ensureString(obj, 'confidence_and_limits')
  };
}

export async function collectChannelBundle() {
  const channel = await getOwnChannel();
  const dailyRows = await getChannelRowsDB(channel.channelId);
  const videoStats = await getVideoStatsDB(channel.channelId);
  let upcoming = [];
  try {
    const { getRecentVideos } = await import('../youtube/videos.js');
    const { videos } = await getRecentVideos(200);
    const now = Date.now();
    upcoming = videos
      .filter((v) => v.publishedAt && new Date(v.publishedAt).getTime() > now)
      .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
  } catch {
    upcoming = [];
  }
  return {
    channel,
    daily: dailyRows || [],
    videoStats: videoStats || [],
    upcoming,
    hasDaily: Boolean(dailyRows && dailyRows.length > 0),
    hasVideoStats: Boolean(videoStats && videoStats.length > 0),
    worst: identifyUnderperformers(videoStats || [])
  };
}

function videoLine(v) {
  const kind = v.isShort ? 'Short' : 'Long-form';
  const age = v.ageDays !== null && v.ageDays !== undefined ? `, age ${v.ageDays}d` : '';
  const pctv = v.averageViewPercentage !== null && v.averageViewPercentage !== undefined ? `avg % viewed ${fmtPct(v.averageViewPercentage)}` : 'no avg % data';
  return `- "${clip(v.title, 90)}" [${kind}${age}] ${fmtNum(v.analyticsViews)} views, ${fmtNum(v.estimatedMinutesWatched)} min watched, ${pctv}, published ${v.publishedDate || 'unknown'}`;
}

export function buildDataBundle(bundle) {
  const { channel, daily, videoStats } = bundle;
  const latest = daily[0]?.date || null;  const stats = videoStats.map((v) => {
    const publishedDate = v.publishedAt ? new Date(v.publishedAt).toISOString().slice(0, 10) : null;
    const ageDays = publishedDate ? Math.max(0, Math.round((Date.now() - new Date(publishedDate + 'T00:00:00Z').getTime()) / 86400000)) : null;
    return { ...v, publishedDate, ageDays };
  });
  const shorts = stats.filter((v) => v.isShort).sort((a, b) => b.analyticsViews - a.analyticsViews).slice(0, 6);
  const longform = stats.filter((v) => !v.isShort).sort((a, b) => b.analyticsViews - a.analyticsViews).slice(0, 6);

  const lines = [];
  lines.push(`CHANNEL: ${channel.title} | subscribers: ${fmtNum(channel.subscriberCount)}`);
  if (latest) {
    const thisWeekViews = sumWindow(daily, 'views', addDays(latest, -6), latest);
    const prevWeekViews = sumWindow(daily, 'views', addDays(latest, -13), addDays(latest, -7));
    const subGNow = sumWindow(daily, 'subscribersGained', addDays(latest, -6), latest);
    const subGPrev = sumWindow(daily, 'subscribersGained', addDays(latest, -13), addDays(latest, -7));
    const subLNow = sumWindow(daily, 'subscribersLost', addDays(latest, -6), latest);
    const subLPrev = sumWindow(daily, 'subscribersLost', addDays(latest, -13), addDays(latest, -7));
    lines.push(`SYNCED DAILY DATA available from ${daily[daily.length - 1].date} to ${latest}.`);
    lines.push(`Last 7 synced days: views ${fmtNum(thisWeekViews)} (previous 7 days: ${fmtNum(prevWeekViews)}), subs +${fmtNum(subGNow)}/-${fmtNum(subLNow)} (previous: +${fmtNum(subGPrev)}/-${fmtNum(subLPrev)}).`);
  } else {
    lines.push('NO daily snapshot data available yet (database empty or /sync not run). Treat all channel-level claims as hypotheses.');
  }
  lines.push('');
  lines.push('TOP VIDEOS IN TRAILING ANALYTICS WINDOW (per-video Analytics API totals):');
  lines.push(stats.slice(0, 10).map(videoLine).join('\n') || 'none available');
  if (shorts.length) {
    lines.push('');
    lines.push('TOP SHORTS (same window):');
    lines.push(shorts.map(videoLine).join('\n'));
  }
  if (longform.length) {
    lines.push('');
    lines.push('TOP LONG-FORM (same window):');
    lines.push(longform.map(videoLine).join('\n'));
  }
  if (stats.length > 10) {
    const bottom = [...stats].sort((a, b) => a.analyticsViews - b.analyticsViews).slice(0, 5);
    lines.push('');
    lines.push('WEAKEST VIDEOS BY VIEWS (same window):');
    lines.push(bottom.map(videoLine).join('\n'));
  }
  if (Array.isArray(bundle.upcoming) && bundle.upcoming.length) {
    lines.push('');
    lines.push('SCHEDULED / UPCOMING VIDEOS (from YouTube Data API, not Analytics):');
    lines.push(
      bundle.upcoming.map((v) => {
        const dt = new Date(v.publishedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
        return `- "${clip(v.title, 90)}" [${v.isShort ? 'Short' : 'Long-form'}] scheduled for ${dt}`;
      }).join('\n')
    );
  }
  if (bundle.worst && bundle.worst.length) {
    lines.push('');
    lines.push('LOWEST RETENTION (videos with at least 50 views):');    lines.push(
      bundle.worst
        .map((v) => `- "${clip(v.title, 80)}" avg % viewed ${fmtPct(v.averageViewPercentage)}, ${fmtNum(v.analyticsViews)} views`)
        .join('\n')
    );
  }
  const dailyRows = daily
    .slice(0, 14)
    .reverse()
    .map((r) => `${r.date}: views ${r.views}, watchers-min ${fmtNum(r.estimatedMinutesWatched)}, subs +${r.subscribersGained}/-${r.subscribersLost}, likes ${r.likes}`)
    .join('\n');
  if (dailyRows) {
    lines.push('');
    lines.push('DAILY SNAPSHOTS (oldest to newest of the latest 14 available days):');
    lines.push(dailyRows);
  }
  return lines.join('\n');
}

export async function saveRecommendation(kind, channelId, payload) {
  if (!process.env.DATABASE_URL) return null;
  try {
    const res = await query(
      `INSERT INTO ai_recommendations (kind, channel_id, payload) VALUES ($1,$2,$3::jsonb) RETURNING id`,
      [kind, channelId, JSON.stringify(payload)]
    );
    return res[0]?.id || null;
  } catch (err) {
    logSafeError('recommendations.save', err);
    return null;
  }
}

export async function generateFullReport(bundle) {
  const dataBundle = buildDataBundle(bundle);
  const prompt = `Produce a complete channel analysis in the exact JSON structure requested.
Sections needed: executive summary, key performance changes (facts from data), best-performing videos, potentially underperforming videos (label clearly as hypotheses if evidence is thin), exactly 5 recommended video ideas grounded in what already works on THIS channel, suggested Shorts topics, suggested long-form topics, improved hooks and title concepts, practical experiments for the next 7 days, metrics to monitor after publishing, and confidence level plus data limitations (cover: how many data days exist, whether per-video data is present, whether Shorts and long-form each have enough videos to compare).\n\nREAL CHANNEL DATA:\n${dataBundle}`;
  let raw;
  try {
    raw = await generateJson({ system: GROUNDING_RULES, prompt, schema: reportInsightsSchema, temperature: 0.6 });
  } catch (err) {
    logSafeError('gemini.report', err);
    throw new AppError('Gemini request failed', {
      userMessage: aiFailureUserMessage(err)
    });
  }
  const validated = validateInsights(raw);
  await saveRecommendation('full_report', bundle.channel.channelId, validated);
  return formatFullInsights(validated);
}

export function formatFullInsights(r) {
  const list = (title, items) => (items?.length ? [title, ...items.map((x) => `\u2022 ${x}`), ''] : []);
  const sections = [];
  sections.push('\u{1F9E0} AI channel report (from real YouTube analytics + recent snapshots)');
  sections.push('');
  sections.push(r.executive_summary);
  sections.push('');
  sections.push(...list('Key changes observed:', r.key_changes));
  sections.push(...list('Best performers:', r.best_videos));
  sections.push(...list('Possibly underperforming (hypotheses only):', r.underperforming_videos));
  sections.push(...list('Video ideas:', r.video_ideas));
  sections.push(...list('Shorts topics:', r.shorts_topics));
  sections.push(...list('Long-form topics:', r.longform_topics));
  sections.push(...list('Hooks / title concepts:', r.hooks_and_titles));
  sections.push(...list('7-day experiments:', r.experiments_next_7_days));
  sections.push(...list('Metrics to monitor after publishing:', r.metrics_to_monitor));
  sections.push(`\u{2696}\u{FE0F} Confidence & limitations: ${r.confidence_and_limits}`);
  return sections.filter((s) => s !== undefined).join('\n');
}

export async function generateIdeas(bundle) {
  const dataBundle = buildDataBundle(bundle);
  const prompt = `Generate exactly 5 new video ideas for this creator. Each idea must be clearly grounded in patterns visible in the supplied channel data (what already earns views or watch time here). For every idea give "title", "angle" (the execution idea), and "why" (1-2 sentences citing the data pattern it builds on). Follow the JSON schema.\n\nREAL CHANNEL DATA:\n${dataBundle}`;
  let raw;
  try {
    raw = await generateJson({ system: GROUNDING_RULES, prompt, schema: ideaListSchema, temperature: 0.8 });
  } catch (err) {
    logSafeError('gemini.ideas', err);
    throw new AppError('Gemini request failed', {
      userMessage: aiFailureUserMessage(err)
    });
  }
  const ideas = (raw?.video_ideas || []).slice(0, 5).map((i) => ({
    title: typeof i?.title === 'string' ? i.title : '',
    angle: typeof i?.angle === 'string' ? i.angle : '',
    why: typeof i?.why === 'string' ? i.why : ''
  }));
  if (ideas.length !== 5) {
    throw new ValidationError('Idea list does not contain 5 valid ideas');
  }
  await saveRecommendation('ideas', bundle.channel.channelId, ideas);
  const lines = ['\u{1F4A1} 5 video ideas (grounded in your channel data)', ''];
  ideas.forEach((i, idx) => {
    lines.push(`${idx + 1}. ${i.title}`);
    if (i.angle) lines.push(`   angle: ${i.angle}`);
    if (i.why) lines.push(`   why: ${i.why}`);
    lines.push('');
  });
  lines.push('Hypotheses, not guarantees: test one idea at a time and evaluate the results.');
  return lines.join('\n');
}

export async function collectVideoBundle(videoId, includeDaily = true) {
  const { getRecentVideos } = await import('../youtube/videos.js');
  const { channel, videos } = await getRecentVideos(200);
  const video = videos.find((v) => v.videoId === videoId) || null;
  if (!video) {
    return null;
  }
  const totals = await getVideoTotals(videoId, 90);
  const daily = includeDaily ? await getVideoDaily(videoId, 21) : [];
  const videoWithMeta = { ...video, publishedDate: video.publishedAt ? video.publishedAt.slice(0, 10) : null };
  return { channel, video: videoWithMeta, totals, daily };
}

export function videoBundleText(b) {
  const v = b.video;
  const first = v.isShort ? 'Short' : 'Long-form';
  const ageDays = v.publishedDate ? Math.max(0, Math.round((Date.now() - new Date(v.publishedDate + 'T00:00:00Z').getTime()) / 86400000)) : null;
  const lines = [];
  lines.push(`TITLE: ${v.title}`);
  lines.push(`FORMAT: ${first} (duration ${fmtDuration(v.durationSeconds)}), published ${v.publishedDate || 'unknown'}${ageDays !== null ? `, age ${ageDays} days` : ''}`);
  lines.push(`DESCRIPTION (truncated to 700 chars): ${clip(v.description, 700)}`);
  if (v.tags?.length) lines.push(`TAGS: ${v.tags.slice(0, 12).join(', ')}`);
  if (v.lifetimeViews) lines.push(`Lifetime so far (Data API statistics): ${fmtNum(v.lifetimeViews)} views, ${fmtNum(v.lifetimeLikes)} likes, ${fmtNum(v.lifetimeComments)} comments.`);
  if (b.totals) {
    lines.push(`Analytics API (last 90 days): ${fmtNum(b.totals.views)} views, ${fmtNum(b.totals.estimatedMinutesWatched)} min watched, avg view duration ${fmtDuration(b.totals.averageViewDurationSeconds)}${b.totals.averageViewPercentage !== null && b.totals.averageViewPercentage !== undefined ? `, avg % viewed ${fmtPct(b.totals.averageViewPercentage)}` : ''}.`);
  } else {
    lines.push('Direct analytics rows unavailable for this video (possibly below the reporting threshold or too recent). Treat claims as hypotheses based on metadata only.');
  }
  const dailyLines = (b.daily || []).slice(0, 10).map((d) => `${d.date}: views ${d.views}, min watched ${fmtNum(d.estimatedMinutesWatched)}`);
  if (dailyLines.length) lines.push(`DAILY VIEWS (latest available):\n${dailyLines.join('\n')}`);
  return lines.join('\n');
}

export async function generateTitles(bundle) {
  const text = videoBundleText(bundle);
  const prompt = `Suggest improved title alternatives for this video. First briefly identify what may be weak in the current title (good hook missing, keyword placement, vagueness). Then provide 6 title alternatives of practical length (<= 70 characters) with a short rationale each.\n\nVIDEO DATA (real metadata + optional analytics):\n${text}`;
  let raw;
  try {
    raw = await generateJson({ system: GROUNDING_RULES, prompt, schema: titleSuggestionsSchema, temperature: 0.8 });
  } catch (err) {
    logSafeError('gemini.titles', err);
    throw new AppError('Gemini request failed', {
      userMessage: aiFailureUserMessage(err)
    });
  }
  const problem = typeof raw?.problem_detected === 'string' ? raw.problem_detected : '';
  const titles = (raw?.title_alternatives || [])
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .slice(0, 6)
    .map((t) => ({ text: t.text.trim(), rationale: typeof t.rationale === 'string' ? t.rationale.trim() : '' }));
  if (titles.length === 0) throw new ValidationError('no titles');
  await saveRecommendation('titles', bundle.video.videoId, { problem, titles });
  const lines = ['\u{1F511} Title alternatives', ''];
  lines.push(`Current: "${clip(bundle.video.title, 90)}"`);
  if (problem) lines.push(`Problem: ${problem}`);
  lines.push('');
  titles.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.text}`);
    if (t.rationale) lines.push(`   why: ${t.rationale}`);
  });
  return lines.join('\n');
}

export async function generateThumbnailConcepts(bundle) {
  const text = videoBundleText(bundle);
  const prompt = `Suggest thumbnail concepts for this video: 4 concepts, each with a concrete visual composition idea, short overlay text (max 4 words), and why it should earn a click based on title/topic. Follow the JSON schema.\n\nVIDEO DATA:\n${text}`;
  let raw;
  try {
    raw = await generateJson({ system: GROUNDING_RULES, prompt, schema: thumbnailConceptsSchema, temperature: 0.8 });
  } catch (err) {
    logSafeError('gemini.thumb', err);
    throw new AppError('Gemini request failed', {
      userMessage: aiFailureUserMessage(err)
    });
  }
  const concepts = (raw?.concepts || [])
    .filter((c) => c && typeof c.visual === 'string' && c.visual.trim())
    .slice(0, 4)
    .map((c) => ({
      visual: c.visual.trim(),
      text_overlay: typeof c.text_overlay === 'string' ? c.text_overlay.trim() : '',
      why: typeof c.why === 'string' ? c.why.trim() : ''
    }));
  if (concepts.length === 0) throw new ValidationError('no concepts');
  await saveRecommendation('thumbnail', bundle.video.videoId, concepts);
  const lines = ['\u{1F5BC}\u{FE0F} Thumbnail concepts', ''];
  concepts.forEach((c, i) => {
    lines.push(`${i + 1}. Visual: ${c.visual}`);
    if (c.text_overlay) lines.push(`   text: "${c.text_overlay}"`);
    if (c.why) lines.push(`   why: ${c.why}`);
    lines.push('');
  });
  return lines.join('\n');
}

export async function answerChatQuestion(question, bundle) {
  const dataBundle = buildDataBundle(bundle);
  const prompt = `Answer the creator's question using ONLY the channel data below. If the data does not contain the answer, say so explicitly and suggest what to measure or test next.\n\nQUESTION: ${question}\n\nCHANNEL DATA:\n${dataBundle}`;
  let text;
  try {
    text = await generateText({ system: GROUNDING_RULES, prompt });
  } catch (err) {
    logSafeError('gemini.chat', err);
    throw new AppError('Gemini request failed', {
      userMessage: aiFailureUserMessage(err)
    });
  }
  await saveRecommendation('chat', bundle.channel.channelId, { question, answer: text.slice(0, 4000) });
  return text;
}
