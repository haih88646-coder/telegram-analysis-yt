import { telegramConfig } from '../src/config.js';
import { verifyWebhookSecret } from '../src/telegram/security.js';
import { handleTelegramUpdate } from '../src/telegram/commands.js';
import { query, ensureSchema } from '../src/database/db.js';
import { logSafeError } from '../src/utils/errors.js';

export async function getProcessedUpdate(updateId) {
  try {
    return await query(`INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id`, [updateId]);
  } catch (err) {
    logSafeError('dedupe.db', err);
    return null;
  }
}

const memoryProcessed = new Set();

export function isDuplicateUpdate(updateId) {
  return memoryProcessed.has(updateId);
}

export function markProcessed(updateId) {
  memoryProcessed.add(updateId);
  if (memoryProcessed.size > 501) {
    for (const first of memoryProcessed) {
      memoryProcessed.delete(first);
      break;
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  let webhookSecret;
  try {
    webhookSecret = telegramConfig().webhookSecret;
  } catch {
    res.status(200).json({ ok: true });
    return;
  }

  const secretHeader = req.headers['x-telegram-bot-api-secret-token'] || '';
  if (!verifyWebhookSecret(secretHeader, webhookSecret)) {
    logSafeError('webhook.secret', new Error('bad webhook secret header'));
    res.status(401).json({ ok: false, error: 'forbidden' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ ok: false, error: 'bad request' });
    return;
  }
  const updateId = body?.update_id;
  if (typeof updateId !== 'number') {
    res.status(200).json({ ok: true });
    return;
  }

  if (isDuplicateUpdate(updateId)) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }
  markProcessed(updateId);
  let dbClaim = null;
  try {
    if (process.env.DATABASE_URL) {
      await ensureSchema();
    }
  } catch (err) {
    logSafeError('webhook.schema', err);
  }
  if (process.env.DATABASE_URL) {
    dbClaim = await getProcessedUpdate(updateId);
    if (dbClaim && Array.isArray(dbClaim) && dbClaim.length === 0) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
  }

  try {
    await handleTelegramUpdate(body);
  } catch (err) {
    logSafeError('webhook.handle', err);
  }
  res.status(200).json({ ok: true });
}
