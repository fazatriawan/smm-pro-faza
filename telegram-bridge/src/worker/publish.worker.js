/**
 * Worker untuk queue PUBLISH (BullMQ).
 *
 * Status Phase 0:
 *  - BELUM dijalankan. Aktifkan dengan `npm run worker` (lihat package.json).
 *  - Setelah Phase 1 aktif, jalankan via PM2 sebagai proses TERPISAH dari bot:
 *      pm2 start ecosystem.config.cjs   (akan diperbarui untuk include worker)
 *
 * Tanggung jawab worker:
 *  1. Ambil job dari queue PUBLISH.
 *  2. Tulis state PROCESSING ke Postgres (`publish_jobs.status = processing`).
 *  3. Panggil adapter (Outstand) untuk submit publish.
 *  4. Tulis hasil + per-target status ke `post_targets`.
 *  5. Enqueue STATUS_POLL untuk post yang pending (sesuai DEFAULT_POLL_SCHEDULE_MS).
 *  6. Emit event ke `job_events` supaya bot bisa kirim Telegram notification.
 *  7. Throw kalau retriable error → BullMQ akan retry pakai backoff exponential.
 *
 * File ini berisi SKELETON dengan stub logic. Implementasi DB write + adapter
 * call dilakukan Phase 1 sebelum di-`npm run worker`.
 */

import { QueueNames } from '../queue/types.js';
import { getRedisConnection } from '../queue/connection.js';
import { createLogger } from '../utils/logger.js';
import { OutstandAdapter } from '../adapters/OutstandAdapter.js';
import { AdapterError } from '../adapters/IPublishingAdapter.js';
import { PublishErrorCode } from '../utils/errorTypes.js';

const log = createLogger('worker:publish');

async function loadBullMq() {
  try {
    return await import('bullmq');
  } catch {
    throw new Error(
      "bullmq belum ter-install. Jalankan: 'npm install bullmq ioredis @prisma/client'",
    );
  }
}

/**
 * Pemroses 1 job. Dipanggil BullMQ Worker.
 *
 * @param {import('bullmq').Job<import('../queue/types.js').PublishJobData>} job
 * @returns {Promise<import('../queue/types.js').WorkerJobResult>}
 */
async function processPublishJob(job) {
  const t0 = Date.now();
  const data = job.data;
  log.info(
    { jobId: job.id, attempts: job.attemptsMade, targets: data.targets?.length || 0 },
    'processing publish job',
  );

  // TODO Phase 1 step 1: tulis state 'processing' ke Postgres.
  // const prisma = await getPrisma();
  // await prisma.publishJob.update({ where: { idempotencyKey: data.idempotencyKey }, data: { status: 'processing', startedAt: new Date() } });

  const adapter = new OutstandAdapter();

  try {
    // TODO Phase 1 step 2: panggil adapter.publish().
    // const result = await adapter.publish({ ... });
    // Untuk sekarang adapter.publish() throw AdapterError('NOT_WIRED').

    // Placeholder supaya skeleton bisa dijalankan tanpa crash:
    throw new AdapterError('Worker skeleton — adapter.publish belum diimplementasikan Phase 1.', {
      code: 'NOT_WIRED',
      retriable: false,
    });
  } catch (err) {
    const code = err?.code || PublishErrorCode.UNKNOWN;
    const retriable = err?.retriable ?? false;
    log.error(
      { jobId: job.id, code, retriable, err: err?.message },
      `publish job failed: ${err?.message}`,
    );

    // TODO Phase 1 step 3: tulis state 'failed'/'partial_success' ke Postgres + events.

    if (retriable) {
      // Lempar ulang supaya BullMQ retry sesuai backoff.
      throw err;
    }

    return {
      ok: false,
      jobId: String(job.id),
      adapter: adapter.name,
      errorCode: code,
      errorMessage: err?.message || String(err),
      latencyMs: Date.now() - t0,
    };
  }
}

/**
 * Start worker. Dipanggil dari `src/worker/index.js`.
 * @param {{ concurrency?: number }} [opts]
 */
export async function startPublishWorker(opts = {}) {
  const { Worker } = await loadBullMq();
  const connection = await getRedisConnection();
  const concurrency = opts.concurrency ?? Number(process.env.WORKER_PUBLISH_CONCURRENCY || 4);

  const worker = new Worker(QueueNames.PUBLISH, processPublishJob, {
    connection,
    concurrency,
    // BullMQ default: tidak menghapus job otomatis. Kita atur supaya tidak menumpuk.
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 5000 },
  });

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });

  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err?.message }, `job failed permanently: ${err?.message}`);
  });

  worker.on('error', (err) => {
    log.error({ err: err?.message }, `worker error: ${err?.message}`);
  });

  log.info({ concurrency }, `Worker PUBLISH started, concurrency=${concurrency}`);
  return worker;
}
