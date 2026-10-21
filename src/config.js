export function getEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') return null;
  return value.trim();
}

export function requireEnv(name, feature = 'this feature') {
  const value = getEnv(name);
  if (!value) {
    const err = new Error(`Missing required environment variable ${name}. Configure it in your .env file (locally) or in Vercel Project Settings > Environment Variables, then redeploy to enable ${feature}.`);
    err.code = 'CONFIG_MISSING';
    throw err;
  }
  return value;
}

export function hasEnv(name) {
  return Boolean(getEnv(name));
}

export function telegramConfig() {
  return {
    token: requireEnv('TELEGRAM_BOT_TOKEN', 'the Telegram bot'),
    webhookSecret: getEnv('TELEGRAM_WEBHOOK_SECRET'),
    ownerTelegramId: getEnv('OWNER_TELEGRAM_ID')
  };
}

export function youtubeConfig() {
  return {
    clientId: requireEnv('YOUTUBE_CLIENT_ID', 'YouTube access'),
    clientSecret: requireEnv('YOUTUBE_CLIENT_SECRET', 'YouTube access'),
    refreshToken: requireEnv('YOUTUBE_REFRESH_TOKEN', 'YouTube access')
  };
}

export function geminiConfig() {
  return {
    apiKey: requireEnv('GEMINI_API_KEY', 'AI analysis'),
    model: getEnv('GEMINI_MODEL') || 'gemini-3.8-flash',
    requestTimeoutMs: Number(getEnv('GEMINI_TIMEOUT_MS') || 45000),
    overallTimeoutMs: Number(getEnv('GEMINI_TOTAL_TIMEOUT_MS') || 90000)
  };
}

export const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly'
];

export function baseUrl() {
  const configured = getEnv('APP_BASE_URL');
  if (configured) return configured.replace(/\/$/, '');
  const vercelUrl = getEnv('VERCEL_PROJECT_PRODUCTION_URL') || getEnv('VERCEL_URL');
  if (vercelUrl) return `https://${vercelUrl}`;
  return 'http://localhost:8080';
}

export function hasDatabase() {
  return hasEnv('DATABASE_URL');
}

export const LIMITS = {
  maxMessageChars: 4000,
  videosToTrack: 200,
  aiRequestsPerMinute: 6,
  generalRequestsPerMinute: 20,
  analyticsLatencyDays: 3
};
