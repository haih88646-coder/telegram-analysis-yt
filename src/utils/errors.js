export class AppError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = opts.name || 'AppError';
    this.userMessage = opts.userMessage || message;
    this.retryable = Boolean(opts.retryable);
  }
}

export class ConfigError extends AppError {
  constructor(message) {
    super(message, { name: 'ConfigError', userMessage: message });
  }
}

export class AuthError extends AppError {
  constructor(message, userMessage) {
    super(message, {
      name: 'AuthError',
      userMessage: userMessage ||
        'YouTube authorization problem. The refresh token may be expired or revoked. Re-run scripts/authorize-youtube.js to generate a new one.'
    });
  }
}

export class QuotaError extends AppError {
  constructor(message) {
    super(message, {
      name: 'QuotaError',
      userMessage: 'API quota exceeded. Try again later; quota resets daily.'
    });
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(status);
}

export async function withRetries(fn, { retries = 2, baseDelayMs = 600 } = {}, isRetryable = (e) => e?.retryable) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export function describeGoogleError(err) {
  const status = err?.status || err?.code || err?.response?.status;
  const reason = err?.errors?.[0]?.reason || err?.details?.[0]?.reason || '';
  if (status === 401 || reason === 'invalidCredentials' || reason === 'unauthorized') {
    throw new AuthError(`Google auth error (${reason || 'invalid credentials'})`);
  }
  if (status === 403) {
    if (reason.includes('quota')) throw new QuotaError(reason);
    if (reason.includes('Permissions') || reason === 'insufficientPermissions') {
      throw new AuthError(`Google permissions error: ${reason}. The authorized account likely has no YouTube channel linked.`);
    }
    throw new QuotaError(String(reason || 'forbidden'));
  }
  if (status === 400 && reason.includes('quota')) throw new QuotaError(reason);
  return err;
}

export function logSafeError(context, err) {
  const line = err?.message ? String(err.message) : 'unknown error';
  console.error(JSON.stringify({ ts: new Date().toISOString(), context, message: line.slice(0, 300) }));
}
