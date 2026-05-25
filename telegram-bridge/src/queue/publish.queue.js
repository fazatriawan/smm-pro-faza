/**
 * Publish queue producer (BullMQ).
 *
 * Status Phase 0:
 *  - BELUM diimport runtime. Saat ini `services/bot.js` masih memanggil
 *    `publishBulk()` di `services/outstand.js` secara langsung.
 *  - Setelah Phase 1 aktif: ganti pemanggilan tersebut ke `enqueuePublish(req)`.
 *
 * Kontrak:
 *  - `enqueuePublish(req)` IDEMPOTENT terhadap `req.idempotencyKey`. Jika job
 *    dengan jobId sama sudah ada (PRESENT di queue / completed / failed),
 *    BullMQ tidak akan membuat duplikat.
 *  - Worker baca dari queue → panggil adapter (Outstand) → tulis hasil ke DB
 *    → emit event → publish event ke topic Telegram di tabel `job_events`.
 */

import { QueueNames, DEFAULT_PUBLISH_JOB_OPTS } from './types.js';
import { getRedisConnection } from './connection.js';
import { buildIdempotencyKey } from '../utils/idempotency.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('queue:publish');

/** @type {any} */
let queueInstance = null;

async function loadBullMq() {
  try {
    return await import('bullmq');
  } catch {
    throw new Error(
      "bullmq belum ter-install. Jalankan: 'cd telegram-bridge && npm install bullmq ioredis'\n" +
        '(lihat docs/MIGRATION.md "Phase 1 activation runbook")',
    );
  }
}

async function getQueue() {
  if (queueInstance) return queueInstance;
  const { Queue } = await loadBullMq();
  const connection = await getRedisConnection();
  queueInstance = new Queue(QueueNames.PUBLISH, {
    connection,
    defaultJobOptions: DEFAULT_PUBLISH_JOB_OPTS,
  });
  log.info({ name: QueueNames.PUBLISH }, 'Queue ready');
  return queueInstance;
}

/**
 * Enqueue publish job. Idempotent terhadap `req.idempotencyKey`.
 * Kalau req tidak punya idempotencyKey, akan dibuat otomatis dari isi req.
 *
 * @param {import('./types.js').PublishJobData} req
 * @returns {Promise<{ jobId: string, alreadyExisted: boolean }>}
 */
export async function enqueuePublish(req) {
  const key =
    req.idempotencyKey ||
    buildIdempotencyKey({
      targets: req.targets,
      media: req.media,
      scheduledAtIsoUtc: req.scheduledAtIsoUtc,
      chatId: req.chatId,
      dayKey: req.dayKey,
    });

  const queue = await getQueue();

  const existing = await queue.getJob(key);
  if (existing) {
    log.info({ jobId: key, status: await existing.getState() }, 'duplicate enqueue ignored');
    return { jobId: key, alreadyExisted: true };
  }

  const job = await queue.add(
    'publish',
    { ...req, idempotencyKey: key },
    {
      jobId: key,
      delay: req.scheduledAtIsoUtc
        ? Math.max(0, new Date(req.scheduledAtIsoUtc).getTime() - Date.now())
        : 0,
    },
  );

  log.info(
    {
      jobId: job.id,
      targets: req.targets?.length || 0,
      media: req.media?.length || 0,
      delayedMs: job.opts?.delay || 0,
    },
    'publish enqueued',
  );
  return { jobId: String(job.id), alreadyExisted: false };
}

/** Tutup queue saat shutdown. */
export async function closePublishQueue() {
  if (!queueInstance) return;
  try {
    await queueInstance.close();
    log.info('Queue closed');
  } catch (err) {
    log.warn({ err: err?.message }, `Queue close: ${err?.message}`);
  } finally {
    queueInstance = null;
  }
}

/** Statistik queue untuk dashboard/healthz. */
export async function getPublishQueueStats() {
  try {
    const queue = await getQueue();
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
    );
    return { ok: true, counts };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
