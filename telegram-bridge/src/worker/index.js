/**
 * Worker entry point — proses TERPISAH dari bot.
 *
 * Cara jalankan (Phase 1, setelah deps & DB siap):
 *   cd telegram-bridge
 *   npm run worker
 *
 * Atau via PM2 (recommended di produksi):
 *   pm2 start ecosystem.config.cjs --only smm-telegram-worker
 */

import 'dotenv/config';
import { createLogger } from '../utils/logger.js';
import { startPublishWorker } from './publish.worker.js';
import { closeRedis } from '../queue/connection.js';
import { closePrisma } from '../db/prisma.js';

const log = createLogger('worker:main');

async function main() {
  log.info('Starting worker process…');
  const worker = await startPublishWorker();

  const shutdown = async (signal) => {
    log.info({ signal }, `${signal} — shutting down worker…`);
    try {
      await worker.close();
    } catch (err) {
      log.warn({ err: err?.message }, `worker.close: ${err?.message}`);
    }
    await closeRedis();
    await closePrisma();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  log.info('Worker ready. Tunggu job dari queue.');
}

main().catch((err) => {
  log.fatal({ err: err?.message, stack: err?.stack }, `Fatal worker startup: ${err?.message}`);
  process.exit(1);
});
