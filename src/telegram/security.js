export function parseCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const firstSpace = trimmed.indexOf(' ');
  const rawCommand = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
  const withoutSlash = rawCommand.slice(1);
  const base = withoutSlash.split('@')[0];
  const command = base.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!command) return null;
  return { command, args: rest, botUsername: withoutSlash.split('@')[1] || null };
}

const buckets = new Map();

export function rateLimit(key, limit, windowMs = 60000) {
  const now = Date.now();
  const entry = buckets.get(key) || { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  if (entry.timestamps.length >= limit) {
    buckets.set(key, entry);
    return { allowed: false, retryAfterMs: windowMs - (now - entry.timestamps[0]) };
  }
  entry.timestamps.push(now);
  buckets.set(key, entry);
  return { allowed: true };
}

export function verifyWebhookSecret(received, expected) {
  if (!expected) return false;
  if (!received) return false;
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function isOwner(fromId, ownerTelegramId) {
  if (!ownerTelegramId) return false;
  return String(fromId).trim() === String(ownerTelegramId).trim();
}
