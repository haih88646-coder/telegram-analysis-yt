import { youtubeConfig, baseUrl } from '../../src/config.js';
import { logSafeError } from '../../src/utils/errors.js';

export default async function handler(req, res) {
  const config = youtubeConfigSafe();
  if (!config) {
    res.status(500).send('OAuth environment variables are not fully configured (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET).');
    return;
  }
  const url = new URL(req.url, baseUrl() || 'http://localhost');
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const redirectUri = `${url.origin}/api/oauth/callback`;

  if (error) {
    res.status(400).send(`Authorization denied: ${error}. Close this page and try again.`);
    return;
  }
  if (!code) {
    res.status(400).send('No authorization code received.');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.refresh_token) {
      logSafeError('oauth.callback', new Error(`token exchange failed: ${tokenData.error || 'no refresh token (re-consent with prompt=consent required)'}`));
      res.status(400).send(`Token exchange failed: ${tokenData.error_description || tokenData.error || 'no refresh token returned. Re-authorize with consent prompt (unlink the app in your Google account, then authorize via /api/oauth/start again).'}`);
      return;
    }
    res.status(200).send(
      '<!doctype html><html><body style="font-family: monospace; padding: 24px;">' +
      '<h2>Refresh token generated</h2>' +
      '<p>Copy your YOUTUBE_REFRESH_TOKEN below into Vercel environment variables. Do not share it with anyone.</p>' +
      '<textarea style="width:100%;height:120px" readonly>' + escapeHtml(tokenData.refresh_token) + '</textarea>' +
      '<p>Scope granted: ' + escapeHtml(tokenData.scope || '') + '</p>' +
      '</body></html>'
    );
  } catch (err) {
    logSafeError('oauth.callback', err);
    res.status(500).send('Token exchange failed due to a network or configuration error. Check the function logs.');
  }
}

function youtubeConfigSafe() {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) return null;
  return { clientId: process.env.YOUTUBE_CLIENT_ID.trim(), clientSecret: process.env.YOUTUBE_CLIENT_SECRET.trim() };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
