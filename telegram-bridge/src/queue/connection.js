/**
 * Redis connection factory untuk BullMQ.
 *
 * Status Phase 0:
 *  - BELUM diimport runtime. Aktif setelah Phase 1 deploy.
 *  - Mendukung dua mode: REDIS_URL (recommended) atau host/port/password terpisah.
 *  - `ioredis` di-import lazy supaya bot tetap jalan walau Redis belum siap.
 *
 * ENV:
 *  - REDIS_URL=redis://default:password@host:6379
 *    atau
 *  - REDIS_HOST=localhost
 *    REDIS_PORT=6379
 *    REDIS_PASSWORD=...
 *    REDIS_TLS=1 (opsional)
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('queue:redis');

/** @type {any} */
let connectionInstance = null;

function buildOptions() {
  const url = process.env.REDIS_URL;
  if (url) return { url };

  const port = Number(process.env.REDIS_PORT || 6379);
  const host = process.env.REDIS_HOST || 'localhost';
  const password = process.env.REDIS_PASSWORD || undefined;
  const tls = process.env.REDIS_TLS === '1' ? {} : undefined;
  return { host, port, password, tls };
}

/**
 * Ambil instance ioredis untuk dipakai BullMQ.
 * BullMQ butuh maxRetriesPerRequest=null untuk Queue/Worker.
 *
 * @returns {Promise<any>}
 */
export async function getRedisConnection() {
  if (connectionInstance) return connectionInstance;

  let IORedis;
  try {
    const mod = await import('ioredis');
    IORedis = mod.default || mod.Redis || mod;
  } catch {
    throw new Error(
      "ioredis belum ter-install. Jalankan: 'cd telegram-bridge && npm install ioredis bullmq'\n" +
        '(lihat docs/MIGRATION.md "Phase 1 activation runbook")',
    );
  }

  const opts = buildOptions();
  const sharedOpts = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  };

  connectionInstance = opts.url
    ? new IORedis(opts.url, sharedOpts)
    : new IORedis({ ...opts, ...sharedOpts });

  connectionInstance.on('connect', () => log.info('Redis connect'));
  connectionInstance.on('ready', () => log.info('Redis ready'));
  connectionInstance.on('error', (err) => log.warn({ err: err?.message }, `Redis error: ${err?.message}`));
  connectionInstance.on('end', () => log.warn('Redis connection ended'));

  return connectionInstance;
}

export async function closeRedis() {
  if (!connectionInstance) return;
  try {
    await connectionInstance.quit();
    log.info('Redis disconnected');
  } catch (err) {
    log.warn({ err: err?.message }, `Redis quit: ${err?.message}`);
  } finally {
    connectionInstance = null;
  }
}

/** Probe untuk healthz. */
export async function pingRedis() {
  const t0 = Date.now();
  try {
    const c = await getRedisConnection();
    const pong = await c.ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: err?.message || String(err) };
  }
}
