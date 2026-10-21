import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SCOPES, requireEnv, youtubeConfig } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadLocalEnv() {
  for (const name of ['.env']) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    }
  }
}
loadLocalEnv();

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}`;

const clientId = requireEnv('YOUTUBE_CLIENT_ID', 'the OAuth authorization script');
const clientSecret = requireEnv('YOUTUBE_CLIENT_SECRET', 'the OAuth authorization script');
youtubeConfig();

const state = 'yt-analyst-' + Math.random().toString(36).slice(2);
let receivedCode = null;

const consentUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
consentUrl.searchParams.set('client_id', clientId);
consentUrl.searchParams.set('redirect_uri', REDIRECT_URI);
consentUrl.searchParams.set('response_type', 'code');
consentUrl.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
consentUrl.searchParams.set('access_type', 'offline');
consentUrl.searchParams.set('prompt', 'consent');
consentUrl.searchParams.set('state', state);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/' && url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('State mismatch. Aborting (possible CSRF).');
    return;
  }
  if (url.searchParams.get('error')) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end(`Authorization error: ${url.searchParams.get('error')}`);
    return;
  }
  receivedCode = url.searchParams.get('code');
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf8' });
  res.end('Authorization code received. Check the terminal for your refresh token. You can close this tab.');
});

function printIntro() {
  console.log('\nYouTube channel authorization');
  console.log('------------------------------');
  console.log('Scopes requested (read-only):');
  for (const scope of REQUIRED_SCOPES) console.log('  - ' + scope);
  console.log(`\nMake sure this redirect URI is registered exactly in Google Cloud console (OAuth client, type "Web application"):\n  ${REDIRECT_URI}\n`);
  if (!process.env.YOUTUBE_REFRESH_TOKEN) console.log('(No YOUTUBE_REFRESH_TOKEN currently in environment.)');
}

server.listen(PORT, () => {
  printIntro();
  console.log(`\nOpening consent URL:\n${consentUrl.toString()}\n`);
  console.log('Paste the URL above in a browser if it does not open automatically.');
  console.log('Sign in with the Google account that owns your YouTube channel, approve, then come back here.');
});

async function exchangeLoop() {
  while (!receivedCode) {
    await new Promise((r) => setTimeout(r, 400));
  }
  const body = new URLSearchParams({
    code: receivedCode,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('\nToken exchange failed:', data.error || data);
    console.error('Common causes: wrong client secret, redirect URI mismatch, or the authorization code was already used.');
    process.exit(1);
  }
  const refreshToken = data.refresh_token;
  if (!refreshToken) {
    console.error('\nNo refresh_token was returned. Re-authorize while this account is in Testing mode, or unlink the app at https://myaccount.google.com/permissions and re-run with prompt=consent.');
    process.exit(1);
  }
  console.log('\nWorked! Put these into your .env (locally) and Vercel environment variables:\n');
  console.log('YOUTUBE_CLIENT_ID=' + clientId);
  console.log('YOUTUBE_CLIENT_SECRET=' + (clientSecret.slice(0, 4) + '...(kept in .env)'));
  console.log('YOUTUBE_REFRESH_TOKEN=' + refreshToken);
  console.log(friendlySummaryLine(data));
  console.log('\nNext step: run /status in your bot to confirm the channel reads correctly.');
  server.close();
  process.exit(0);
}

function friendlySummaryLine(data) {
  return `Scope granted: ${data.scope || REQUIRED_SCOPES.join('+')}`;
}

exchangeLoop();

setTimeout(() => {
  console.error('\nTimed out waiting for authorization (10 minutes). Re-run the script.');
  process.exit(1);
}, 600_000);
