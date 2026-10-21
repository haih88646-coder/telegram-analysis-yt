import { youtubeConfig, baseUrl } from '../../src/config.js';

export default function handler(req, res) {
  let config;
  try {
    config = youtubeConfig();
  } catch (err) {
    res.status(500).send(`Missing environment variables for OAuth: ${err.message}`);
    return;
  }
  const redirectUri = `${baseUrl()}/api/oauth/callback`;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false'
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
