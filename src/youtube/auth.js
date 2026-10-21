import { google } from 'googleapis';
import { youtubeConfig, REQUIRED_SCOPES } from '../config.js';
import { withRetries, describeGoogleError } from '../utils/errors.js';

let cached = null;

export function getGoogleAuth() {
  const config = youtubeConfig();
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret, 'http://localhost');
  auth.setCredentials({
    refresh_token: config.refreshToken
  });
  return auth;
}

export function getYoutubeClients() {
  if (cached) return cached;
  const auth = getGoogleAuth();
  cached = {
    oauth: auth,
    youtube: google.youtube({ version: 'v3', auth }),
    youtubeAnalytics: google.youtubeAnalytics({ version: 'v2', auth }),
    scopes: REQUIRED_SCOPES
  };
  return cached;
}

export async function getOwnChannel() {
  const { youtube } = getYoutubeClients();
  const res = await withRetries(
    async () => {
      try {
        return await youtube.channels.list({
          part: 'snippet,contentDetails,statistics',
          mine: true
        });
      } catch (err) {
        throw describeGoogleError(err);
      }
    },
    { retries: 2, baseDelayMs: 700 }
  );
  const items = res?.data?.items || [];
  if (items.length === 0) {
    const err = new Error('The authorized Google account has no YouTube channel linked. Authorize the account that owns your channel.');
    err.name = 'AuthError';
    err.userMessage = 'The authorized Google account has no YouTube channel linked. Re-run the local authorization script with the correct account (your channel owner account).';
    throw err;
  }
  const channel = items[0];
  return {
    channelId: channel.id,
    title: channel.snippet?.title || 'Unknown channel',
    username: channel.snippet?.customUrl || null,
    subscriberCount: Number(channel.statistics?.subscriberCount || 0),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads || null
  };
}

export function revokeAwareTokenErrorHandler(err) {
  return describeGoogleError(err);
}
