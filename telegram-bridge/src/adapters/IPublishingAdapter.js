/**
 * IPublishingAdapter — kontrak abstrak untuk publisher pihak ketiga
 * (saat ini Outstand; ke depan bisa Vista Social, direct Meta Graph API,
 * direct Threads, dsb).
 *
 * Tujuan abstraksi:
 *  - Memisahkan logika bisnis bot dari spesifik vendor.
 *  - Memudahkan migrasi sebagian platform (mis. YouTube via Vista).
 *  - Memungkinkan dry-run / mock adapter untuk testing.
 *
 * Setiap adapter konkret WAJIB mengimplementasikan semua method di kelas
 * IPublishingAdapter. Method yang tidak didukung adapter tertentu boleh
 * throw `UnsupportedAdapterError`.
 *
 * NOTE Phase 0: ini adalah SKELETON. Implementasi konkret (OutstandAdapter)
 * masih wrapper-thin di sekitar `services/outstand.js` yang ada. Migrasi
 * call-site dari `services/outstand.js` → `adapter.publish(...)` dikerjakan
 * Phase 1 setelah BullMQ & Postgres siap.
 */

/* ----------------------------------------------------------------------- *
 * Typedefs (JSDoc) — dijaga sebagai single source of truth untuk DTO.
 * ----------------------------------------------------------------------- */

/**
 * @typedef {'facebook'|'instagram'|'threads'|'youtube'|'tiktok'|'twitter'|'linkedin'} NetworkName
 */

/**
 * @typedef {Object} PublishMediaItem
 * @property {'image'|'video'} kind
 * @property {string} url            URL publik (Drive, presigned S3, dsb).
 * @property {string} [filename]
 * @property {string} [mimeType]
 * @property {number} [durationSec]  Diisi untuk video.
 */

/**
 * @typedef {Object} PublishAccountTarget
 * @property {string} accountId     ID internal adapter (mis. Outstand account id).
 * @property {NetworkName} network
 * @property {string} [username]
 * @property {string} [pageId]      Untuk Facebook.
 */

/**
 * @typedef {Object} PublishCaptions
 * Caption per-network. Key = NetworkName, value = teks caption final.
 * @property {string} [facebook]
 * @property {string} [instagram]
 * @property {string} [threads]
 * @property {string} [youtube]
 * @property {string} [tiktok]
 * @property {string} [twitter]
 * @property {string} [linkedin]
 */

/**
 * @typedef {Object} PublishRequest
 * @property {string} idempotencyKey       SHA256 dari (media + accounts + scheduledAt + chatId/day).
 * @property {PublishMediaItem[]} media
 * @property {PublishAccountTarget[]} targets
 * @property {PublishCaptions} captions
 * @property {string} [title]              Khusus YouTube.
 * @property {string} [scheduledAtIsoUtc]  Jika null/undefined = publish now.
 * @property {Object} [meta]               Free-form (chatId, batchTag, dsb).
 */

/**
 * @typedef {'pending'|'processing'|'published'|'failed'|'rate_limited'|'unknown'} PostStatus
 */

/**
 * @typedef {Object} PublishAccountResult
 * @property {string} accountId
 * @property {NetworkName} network
 * @property {string} [username]
 * @property {PostStatus} status
 * @property {string} [postId]        ID di sisi adapter (Outstand post id).
 * @property {string} [liveUrl]       URL post live (kalau sudah ada).
 * @property {string} [error]         Pesan error mentah dari vendor.
 * @property {string} [errorCode]     Kode terstruktur (mis. RATE_LIMIT, INVALID_TOKEN).
 */

/**
 * @typedef {Object} PublishResult
 * @property {string} idempotencyKey
 * @property {string[]} postIds        Daftar post id yang dibuat oleh adapter.
 * @property {PublishAccountResult[]} accounts
 * @property {string} submittedAtIsoUtc
 * @property {Object} [raw]            Body mentah dari vendor (untuk audit).
 */

/**
 * @typedef {Object} PostStatusSnapshot
 * @property {string} postId
 * @property {PostStatus} status
 * @property {PublishAccountResult[]} accounts
 * @property {string} [fetchedAtIsoUtc]
 */

/* ----------------------------------------------------------------------- *
 * Error types
 * ----------------------------------------------------------------------- */

export class AdapterError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, retriable?: boolean, cause?: unknown, raw?: any }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'AdapterError';
    this.code = opts.code || 'ADAPTER_ERROR';
    this.retriable = opts.retriable ?? false;
    if (opts.cause) this.cause = opts.cause;
    if (opts.raw !== undefined) this.raw = opts.raw;
  }
}

export class UnsupportedAdapterError extends AdapterError {
  constructor(method) {
    super(`Adapter does not implement: ${method}`, { code: 'UNSUPPORTED' });
    this.name = 'UnsupportedAdapterError';
  }
}

/* ----------------------------------------------------------------------- *
 * Abstract interface
 * ----------------------------------------------------------------------- */

export class IPublishingAdapter {
  /** Nama adapter (mis. 'outstand', 'vista', 'meta-direct'). */
  get name() {
    return 'abstract';
  }

  /**
   * Daftarkan akun-akun yang terhubung. Dipakai untuk picker & sinkronisasi.
   * @returns {Promise<PublishAccountTarget[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async listAccounts() {
    throw new UnsupportedAdapterError('listAccounts');
  }

  /**
   * Kirim media + caption ke adapter. WAJIB idempotent terhadap `idempotencyKey`:
   * jika sudah pernah submit dengan key sama, return hasil submit sebelumnya.
   *
   * @param {PublishRequest} req
   * @returns {Promise<PublishResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async publish(req) {
    throw new UnsupportedAdapterError('publish');
  }

  /**
   * Ambil status terbaru sebuah post.
   * @param {string} postId
   * @returns {Promise<PostStatusSnapshot>}
   */
  // eslint-disable-next-line no-unused-vars
  async getStatus(postId) {
    throw new UnsupportedAdapterError('getStatus');
  }

  /**
   * Batal/delete post (kalau didukung vendor).
   * @param {string} postId
   * @returns {Promise<{ ok: boolean }>}
   */
  // eslint-disable-next-line no-unused-vars
  async cancel(postId) {
    throw new UnsupportedAdapterError('cancel');
  }

  /**
   * Health probe ringan (untuk circuit breaker / dashboard).
   * @returns {Promise<{ ok: boolean, latencyMs?: number, info?: any }>}
   */
  async health() {
    return { ok: true };
  }
}

export default IPublishingAdapter;
