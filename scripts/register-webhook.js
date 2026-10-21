import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireEnv, baseUrl } from '../src/config.js';

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

const token = requireEnv('TELEGRAM_BOT_TOKEN', 'webhook registration');
const webhookSecret = requireEnv('TELEGRAM_WEBHOOK_SECRET', 'webhook registration');
const base = baseUrl();

const webhookUrl = `${base}/api/webhook`;
if (!webhookUrl.startsWith('https://')) {
  console.error('Telegram only accepts HTTPS webhook URLs. Set APP_BASE_URL to your deployed Vercel URL (https://...).');
  process.exit(1);
}

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`${method} failed:`, data.description || data.error_code);
    process.exit(1);
  }
  return data.result;
}

const arg = process.argv[2] || 'set';
if (arg === 'set') {
  const result = await tg('setWebhook', {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ['message'],
    drop_pending_updates: false
  });
  console.log('Webhook registered for: ' + webhookUrl);
  console.log('Result:', JSON.stringify(result));
} else if (arg === 'remove') {
  await tg('deleteWebhook', {});
  console.log('Webhook removed.');
} else if (arg === 'check') {
  const info = await tg('getWebhookInfo', {});
  console.log(JSON.stringify(info, null, 2));
  if (info.url && info.url !== webhookUrl) {
    console.log(`\nNOTE: registered URL (${info.url}) differs from your APP_BASE_URL (${base}). Update APP_BASE_URL and re-run.`);
  }
  if (info.last_error_message) {
    console.log(`\nLast delivery error: ${info.last_error_message} at ${new Date(info.last_error_date * 1000).toISOString()}`);
  }
  console.log('\nVerification checklist:');
  console.log('1. URL above must be your Vercel deployment URL ending in /api/webhook');
  console.log('2. pending_update_count should not grow unbounded');
  console.log('3. last_error_message should be empty once things work');
} else {
  console.log('Usage: node scripts/register-webhook.js [set|remove|check]');
}
