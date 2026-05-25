/**
 * Queue DTO typedefs — kontrak data yang dilewatkan antara producer (bot)
 * dan worker (BullMQ) di Phase 1.
 *
 * File ini sengaja BELUM mengimpor BullMQ — semua tipe di sini adalah JSDoc
 * murni dan zero runtime overhead. Dipakai oleh:
 *   - `src/queue/publish.queue.js` (Phase 1, belum ada) sebagai producer
 *   - `src/worker/publish.worker.js` (Phase 1, belum ada) sebagai consumer
 *   - `OutstandAdapter.publish(req)` untuk mengkonversi PublishJobData → PublishRequest
 *
 * NOTE: jaga sinkron antara `IPublishingAdapter` DTOs dan typedef di sini.
 * Job data adalah SUPERSET dari `PublishRequest` (tambah audit & retry metadata).
 */

/**
 * @typedef {'publish' | 'status-poll' | 'webhook-process'} QueueName
 */

/**
 * Nama-nama BullMQ queue yang dipakai bot.
 * @readonly
 */
export const QueueNames = Object.freeze({
  /** Job utama: kirim publish ke adapter (Outstand / Vista / dst). */
  PUBLISH: 'publish',
  /** Polling status pending post (fallback kalau webhook telat). */
  STATUS_POLL: 'status-poll',
  /** Proses payload webhook Outstand secara async (tidak blocking HTTP). */
  WEBHOOK_PROCESS: 'webhook-process',
});

/**
 * Daftar event yang di-emit ke chat Telegram setelah job selesai.
 * Worker tidak boleh kirim Telegram langsung — pass via event log table.
 *
 * @typedef {'PUBLISH_SUBMITTED'|'POST_LIVE'|'POST_FAILED'|'POST_PENDING_LONG'|'RETRY_SCHEDULED'} PublishEventType
 */

/* ----------------------------------------------------------------------- *
 * PUBLISH job
 * ----------------------------------------------------------------------- */

/**
 * Data lengkap untuk job PUBLISH. Disimpan di Postgres `publish_jobs` row
 * sebelum di-enqueue ke BullMQ supaya tahan restart worker.
 *
 * @typedef {Object} PublishJobData
 * @property {string} idempotencyKey         SHA256 hex, sekaligus BullMQ jobId.
 * @property {string} chatId                 Telegram chat / user pemilik.
 * @property {string} dayKey                 'YYYY-MM-DD' (WIB), untuk anti-duplikat harian.
 * @property {string} requestedAtIsoUtc      Saat producer menerima request.
 * @property {string} [scheduledAtIsoUtc]    Null/empty = publish now.
 *
 * @property {Array<import('../adapters/IPublishingAdapter.js').PublishAccountTarget>} targets
 * @property {Array<import('../adapters/IPublishingAdapter.js').PublishMediaItem>} media
 * @property {import('../adapters/IPublishingAdapter.js').PublishCaptions} captions
 *
 * @property {string} [title]                YouTube only.
 * @property {string} [contentLabel]         Konten singkat untuk display ke user.
 *
 * @property {string} adapter                Nama adapter target (mis. 'outstand').
 * @property {string} [batchTag]             Pengelompokan UI (mis. 'random:ig-20').
 *
 * @property {PublishJobAuditTrail} [audit]
 */

/**
 * Audit metadata — dibuat oleh producer, diperbarui worker.
 *
 * @typedef {Object} PublishJobAuditTrail
 * @property {number} [attempts]             Sudah berapa kali worker mencoba.
 * @property {string} [lastErrorCode]        Lihat PublishErrorCode.
 * @property {string} [lastErrorMessage]
 * @property {string} [lastAttemptAtIsoUtc]
 * @property {string} [parentJobId]          Untuk retry: jobId yang menelurkan ini.
 */

/* ----------------------------------------------------------------------- *
 * STATUS_POLL job
 * ----------------------------------------------------------------------- */

/**
 * @typedef {Object} StatusPollJobData
 * @property {string} postId                 Adapter post id (Outstand).
 * @property {string} adapter                'outstand' / 'vista' / ...
 * @property {string} parentJobId            BullMQ jobId yang menelurkan ini.
 * @property {string} chatId
 * @property {number} attempt                Polling ke berapa (1,2,3, ...).
 * @property {number} scheduleDelayMs        Delay yang dipakai untuk job ini.
 */

/** Tahapan polling default (setelah submit). */
export const DEFAULT_POLL_SCHEDULE_MS = Object.freeze([
  90_000,     // +90s
  4 * 60_000, // +4m
  8 * 60_000, // +8m
  20 * 60_000, // +20m
  60 * 60_000, // +1h
  3 * 60 * 60_000, // +3h
]);

/* ----------------------------------------------------------------------- *
 * WEBHOOK_PROCESS job
 * ----------------------------------------------------------------------- */

/**
 * Payload diterima dari Outstand webhook, dibuang ke queue supaya HTTP
 * handler tetap < 200ms dan worker yang melakukan reconcile ke DB+Sheets.
 *
 * @typedef {Object} WebhookJobData
 * @property {string} receivedAtIsoUtc
 * @property {string} signature              Header X-Outstand-Signature (untuk audit).
 * @property {string} eventId                Outstand event id / dedup.
 * @property {Record<string, unknown>} payload   Body mentah dari Outstand.
 */

/* ----------------------------------------------------------------------- *
 * Worker result envelope
 * ----------------------------------------------------------------------- */

/**
 * Apa yang dikembalikan worker setelah selesai memproses job.
 *
 * @typedef {Object} WorkerJobResult
 * @property {boolean} ok
 * @property {string} jobId
 * @property {string} [adapter]
 * @property {string} [errorCode]
 * @property {string} [errorMessage]
 * @property {number} latencyMs
 * @property {any} [data]                    Hasil spesifik per queue.
 */

/* ----------------------------------------------------------------------- *
 * Helper: default BullMQ options yang dipakai semua queue
 * ----------------------------------------------------------------------- */

/**
 * Konvensi opsi BullMQ. Dipakai sebagai default di producer Phase 1.
 *
 * @typedef {Object} BullMqJobOptions
 * @property {string} jobId
 * @property {number} [attempts]
 * @property {{ type: 'exponential' | 'fixed', delay: number }} [backoff]
 * @property {number} [delay]                ms; untuk scheduled job.
 * @property {number} [removeOnComplete]
 * @property {number} [removeOnFail]
 */

export const DEFAULT_PUBLISH_JOB_OPTS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 500,
  removeOnFail: 5000,
});

export const DEFAULT_STATUS_POLL_OPTS = Object.freeze({
  attempts: 1,
  removeOnComplete: 200,
  removeOnFail: 1000,
});

export const DEFAULT_WEBHOOK_OPTS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
});
