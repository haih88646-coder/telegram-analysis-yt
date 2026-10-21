import { getOwnChannel } from './auth.js';
import { withRetries, describeGoogleError } from '../utils/errors.js';
import { parseIsoDuration } from '../utils/formatting.js';

export function normalizeVideo(item) {
  const contentDetails = item.contentDetails || {};
  const snippet = item.snippet || {};
  const stats = item.statistics || {};
  const durationSeconds = parseIsoDuration(contentDetails.duration) || 0;
  const title = snippet.title || '';
  const description = snippet.description || '';
  const hashtagsShorts = /#shorts/i.test(title) || /#shorts/i.test(description);
  return {
    videoId: item.id,
    channelId: snippet.channelId || null,
    title,
    description,
    durationSeconds,
    isShort: durationSeconds > 0 && durationSeconds <= 60,
    hashtagsShorts,
    publishedAt: snippet.publishedAt || null,
    lifetimeViews: Number(stats.viewCount || 0),
    lifetimeLikes: Number(stats.likeCount || 0),
    lifetimeComments: Number(stats.commentCount || 0),
    tags: snippet.tags || [],
    thumbnailUrl: snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`
  };
}

const HARD_SHORT_LIMIT_SECONDS = 60;

export function classifyShort(video) {
  if (video.durationSeconds > 0 && video.durationSeconds <= HARD_SHORT_LIMIT_SECONDS) return true;
  return false;
}

export async function getRecentVideos(limit = 200) {
  const channel = await getOwnChannel();
  if (!channel.uploadsPlaylistId) {
    return { channel, videos: [] };
  }
  const { youtube } = await import('./auth.js').then((m) => m.getYoutubeClients());
  const ids = [];
  let pageToken;
  let pages = 0;
  do {
    const res = await withRetries(
      async () => {
        try {
          return await youtube.playlistItems.list({
            part: 'contentDetails',
            playlistId: channel.uploadsPlaylistId,
            maxResults: 50,
            pageToken: pageToken || undefined
          });
        } catch (err) {
          throw describeGoogleError(err);
        }
      },
      { retries: 2, baseDelayMs: 700 }
    );
    for (const item of res.data.items || []) {
      if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
    }
    pageToken = res.data.nextPageToken;
    pages++;
  } while (pageToken && ids.length < limit && pages < 8);

  const wanted = ids.slice(0, limit);
  const videos = [];
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50);
    const res = await withRetries(
      async () => {
        try {
          return await youtube.videos.list({
            part: 'snippet,contentDetails,statistics',
            id: batch.join(',')
          });
        } catch (err) {
          throw describeGoogleError(err);
        }
      },
      { retries: 2, baseDelayMs: 700 }
    );
    for (const item of res.data.items || []) videos.push(normalizeVideo(item));
  }
  videos.forEach((v) => {
    v.isShort = classifyShort(v);
  });
  videos.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return { channel, videos };
}

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function validateVideoId(id) {
  const trimmed = String(id || '').trim();
  if (!VIDEO_ID_RE.test(trimmed)) return null;
  return trimmed;
}

export function extractVideoId(input) {
  const trimmed = String(input || '').trim();
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;
  const urlMatch = /(?:v=|\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  return null;
}
