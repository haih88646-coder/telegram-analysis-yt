import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getYoutubeClients, getOwnChannel } from '../src/youtube/auth.js';
import { analyticsWindow } from '../src/utils/dates.js';
import { getRecentVideos } from '../src/youtube/videos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadLocalEnv() {
  for (const name of ['.env']) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}
loadLocalEnv();

const { youtubeAnalytics } = getYoutubeClients();
const channel = await getOwnChannel();
const { videos } = await getRecentVideos(200);
console.log(`Channel: ${channel.title} (${channel.channelId})`);
console.log(`Videos: ${videos.length}. Oldest: ${videos[videos.length - 1]?.publishedAt || 'n/a'}. Newest: ${videos[0]?.publishedAt || 'n/a'}`);
const oldest = videos[videos.length - 1];

async function tryQuery(name, params) {
  try {
    const res = await youtubeAnalytics.reports.query(params);
    const d = res.data || {};
    console.log(`\n[${name}] columns:`, JSON.stringify((d.columnHeaders || []).map((h) => h.name)));
    console.log(`[${name}] rows count: ${(d.rows || []).length}`);
    console.log(`[${name}] first rows:`, JSON.stringify((d.rows || []).slice(0, 5)));
    return d;
  } catch (err) {
    console.error(`[${name}] FAILED:`, JSON.stringify({
      status: err?.response?.status || err?.code,
      body: err?.response?.data
    }));
    return null;
  }
}

const w30 = analyticsWindow(30);
const w90 = analyticsWindow(90);
const w365 = analyticsWindow(365);

await tryQuery('per-video 90d', {
  ids: 'channel==MINE',
  startDate: w90.startDate,
  endDate: w90.endDate,
  metrics: 'views,estimatedMinutesWatched',
  dimensions: 'video',
  sort: '-views',
  maxResults: 200
});

await tryQuery('per-video 30d', {
  ids: 'channel==MINE',
  startDate: w30.startDate,
  endDate: w30.endDate,
  metrics: 'views,estimatedMinutesWatched',
  dimensions: 'video',
  sort: '-views',
  maxResults: 200
});

if (oldest) {
  await tryQuery('oldest-video only 365d (no dimensions)', {
    ids: 'channel==MINE',
    startDate: w365.startDate,
    endDate: w365.endDate,
    metrics: 'views,estimatedMinutesWatched',
    filters: `video==${oldest.videoId}`
  });
}

const w3 = analyticsWindow(3);
await tryQuery('daily last-3-days', {
  ids: 'channel==MINE',
  startDate: w3.startDate,
  endDate: w3.endDate,
  metrics: 'views',
  dimensions: 'day',
  sort: 'day'
});
