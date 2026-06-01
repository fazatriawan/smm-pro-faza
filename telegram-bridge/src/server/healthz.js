/**
 * Health probe endpoint — disable by default.
 *
 * Status Phase 0:
 *  - File ini BELUM di-mount di Express app. Aktifkan setelah Phase 1:
 *      // src/server/webhook.js
 *      import { mountHealthz } from './healthz.js';
 *      mountHealthz(app);
 *
 * Probe:
 *  - GET /healthz            → 200 selalu (proses hidup)
 *  - GET /healthz/deep       → 200 jika DB + Redis + Outstand OK, 503 jika ada yang gagal
 *  - GET /healthz/metrics    → JSON ringkas counts queue + akun aktif
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('healthz');

/**
 * @param {import('express').Express} app
 */
export function mountHealthz(app) {
  if (!app || typeof app.get !== 'function') {
    throw new TypeError('mountHealthz: butuh Express app');
  }

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.get('/healthz/deep', async (_req, res) => {
    const checks = {};
    let allOk = true;

    try {
      const { pingPrisma } = await import('../db/prisma.js');
      checks.db = await pingPrisma();
      if (!checks.db.ok) allOk = false;
    } catch (err) {
      checks.db = { ok: false, error: err?.message };
      allOk = false;
    }

    try {
      const { pingRedis } = await import('../queue/connection.js');
      checks.redis = await pingRedis();
      if (!checks.redis.ok) allOk = false;
    } catch (err) {
      checks.redis = { ok: false, error: err?.message };
      allOk = false;
    }

    try {
      const { OutstandAdapter } = await import('../adapters/OutstandAdapter.js');
      const adapter = new OutstandAdapter();
      checks.outstand = await adapter.health();
      if (!checks.outstand.ok) allOk = false;
    } catch (err) {
      checks.outstand = { ok: false, error: err?.message };
      allOk = false;
    }

    res.status(allOk ? 200 : 503).json({
      ok: allOk,
      ts: new Date().toISOString(),
      checks,
    });
  });

  app.get('/healthz/metrics', async (_req, res) => {
    const out = {};
    try {
      const { getPublishQueueStats } = await import('../queue/publish.queue.js');
      out.publishQueue = await getPublishQueueStats();
    } catch (err) {
      out.publishQueue = { ok: false, error: err?.message };
    }
    res.json({ ok: true, ts: new Date().toISOString(), ...out });
  });

  log.info('healthz endpoints mounted: /healthz, /healthz/deep, /healthz/metrics');
}
