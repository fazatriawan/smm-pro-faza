import { createLogger } from './logger.js';

const log = createLogger('outstand-retry');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} err
 */
export function parseOutstandRetryAfterMs(err) {
  const status = err?.response?.status;
  const headers = err?.response?.headers || {};
  const headerWait = headers['retry-after'] ?? headers['Retry-After'];
  if (headerWait != null && headerWait !== '') {
    const n = Number(headerWait);
    if (!Number.isNaN(n) && n > 0) return n < 1000 ? n * 1000 : n;
  }

  const parts = [
    err?.response?.data?.message,
    err?.response?.data?.error,
    err?.message,
  ];
  for (const p of parts) {
    const m = String(p || '').match(/retry\s+after\s+(\d+)/i);
    if (m?.[1]) return Number(m[1]) * 1000;
  }

  if (status === 429) return 10_000;
  return null;
}

/**
 * @param {unknown} err
 */
export function isOutstandRateLimitError(err) {
  const status = err?.response?.status;
  if (status === 429) return true;
  return /too many requests|rate limit|429/i.test(String(err?.message || ''));
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, label?: string }} [opts]
 */
export async function withOutstandRetry(fn, opts = {}) {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  /** @type {unknown} */
  let lastErr;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isOutstandRateLimitError(err) || attempt >= maxAttempts - 1) {
        throw err;
      }
      const waitMs = parseOutstandRetryAfterMs(err) ?? 2000 * 2 ** attempt;
      log.warn(
        { attempt: attempt + 1, waitMs, label: opts.label },
        `[Outstand] 429 — tunggu ${Math.round(waitMs / 1000)}s lalu coba lagi`
      );
      await sleep(waitMs);
    }
  }

  throw lastErr;
}

/**
 * @param {unknown} err
 */
export function formatOutstandRateLimitHint(err) {
  const waitMs = parseOutstandRetryAfterMs(err);
  const sec = waitMs ? Math.ceil(waitMs / 1000) : 30;
  return (
    `Outstand rate limit (429). Tunggu *${sec} detik* lalu ulangi perintah.\n` +
    `_Jangan spam /links berkali-kali — tunggu antrian selesai._`
  );
}
