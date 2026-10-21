import { requireEnv } from '../config.js';
import { withRetries, isRetryableStatus } from '../utils/errors.js';
import { splitMessage } from '../utils/formatting.js';

const TELEGRAM_API = 'https://api.telegram.org';

let cachedToken = null;

function token() {
  if (!cachedToken) cachedToken = requireEnv('TELEGRAM_BOT_TOKEN', 'the Telegram bot');
  return cachedToken;
}

export async function tgCall(method, payload) {
  const url = `${TELEGRAM_API}/bot${token()}/${method}`;
  return withRetries(
    async () => {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...(payload || {}), parse_mode: undefined })
        });
      } catch (err) {
        err.retryable = true;
        throw err;
      }
      if (isRetryableStatus(res.status)) {
        const err = new Error(`Telegram API HTTP ${res.status}`);
        err.retryable = true;
        throw err;
      }
      const data = await res.json();
      if (!data.ok) {
        const err = new Error(`Telegram API error in ${method}: ${data.error_code} ${data.description || ''}`.trim());
        err.retryable = false;
        throw err;
      }
      return data.result;
    },
    { retries: 2, baseDelayMs: 800 }
  );
}

export async function sendText(chatId, text, opts = {}) {
  const limit = opts.limit || 4000;
  const chunks = splitMessage(text, limit);
  for (const chunk of chunks) {
    await tgCall('sendMessage', {
      chat_id: chatId,
      text: chunk
    });
  }
}

export async function sendTyping(chatId) {
  try {
    await tgCall('sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch {
    // typing indicator failure is non-fatal
  }
}
