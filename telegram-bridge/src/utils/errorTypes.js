/**
 * Error taxonomy — kategori error terstruktur untuk publish flow.
 *
 * Tujuan:
 *  - Memberi kode mesin yang konsisten untuk retry policy & metrics.
 *  - Memisahkan "harus retry sekarang", "tunggu", "akun rusak", "kuota habis".
 *  - Dipakai oleh adapter, queue worker, dan command `/retry`.
 *
 * Catatan Phase 0:
 *  Util ini BELUM dipakai runtime. Penggunaan dimulai dari adapter Phase 1
 *  dan worker BullMQ. Logika klasifikasi di `utils/retryPublish.js` sekarang
 *  pakai konstanta sendiri (`RETRY_ACTION`) yang akan diselaraskan ke sini.
 */

/**
 * Kategori utama (machine-readable) untuk error publish.
 * Selaraskan dengan `RETRY_ACTION` di `utils/retryPublish.js` saat migrasi.
 *
 * @readonly
 * @enum {string}
 */
export const PublishErrorCode = Object.freeze({
  /** Bisa di-retry segera (idempotensi aman, jaringan transient). */
  RETRY_NOW: 'RETRY_NOW',
  /** Tunggu beberapa menit/jam (rate limit eksplisit dengan retry-after). */
  WAIT: 'WAIT',
  /** Akun butuh intervensi manual (token expired, scope kurang, banned). */
  FIX_ACCOUNT: 'FIX_ACCOUNT',
  /** Kuota harian habis — coba lagi besok. */
  QUOTA_TOMORROW: 'QUOTA_TOMORROW',
  /** Outstand bilang gagal tapi kemungkinan post live (rate-limit ambigu). */
  RATE_LIMIT_MAYBE_LIVE: 'RATE_LIMIT_MAYBE_LIVE',
  /** Validasi input client (media format, durasi, dsb). Tidak retry. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** Tidak diketahui — escalate untuk inspeksi manual. */
  UNKNOWN: 'UNKNOWN',
});

/** Apakah kode error layak di-retry otomatis oleh worker. */
export function isAutoRetriable(code) {
  return code === PublishErrorCode.RETRY_NOW || code === PublishErrorCode.WAIT;
}

/** Apakah error berasal dari sisi akun (perlu intervensi manual). */
export function isAccountIssue(code) {
  return (
    code === PublishErrorCode.FIX_ACCOUNT ||
    code === PublishErrorCode.QUOTA_TOMORROW
  );
}

/**
 * Error class dasar untuk error publish — selalu pakai turunannya.
 */
export class PublishError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: keyof typeof PublishErrorCode | string, retriable?: boolean, retryAfterMs?: number, cause?: unknown, raw?: any }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = opts.code || PublishErrorCode.UNKNOWN;
    this.retriable = opts.retriable ?? isAutoRetriable(this.code);
    if (opts.retryAfterMs != null) this.retryAfterMs = opts.retryAfterMs;
    if (opts.cause) this.cause = opts.cause;
    if (opts.raw !== undefined) this.raw = opts.raw;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retriable: this.retriable,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

export class RateLimitError extends PublishError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || PublishErrorCode.WAIT });
    this.name = 'RateLimitError';
  }
}

export class AccountTokenError extends PublishError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: PublishErrorCode.FIX_ACCOUNT, retriable: false });
    this.name = 'AccountTokenError';
  }
}

export class QuotaExceededError extends PublishError {
  constructor(message, opts = {}) {
    super(message, {
      ...opts,
      code: PublishErrorCode.QUOTA_TOMORROW,
      retriable: false,
    });
    this.name = 'QuotaExceededError';
  }
}

export class InvalidInputError extends PublishError {
  constructor(message, opts = {}) {
    super(message, {
      ...opts,
      code: PublishErrorCode.INVALID_INPUT,
      retriable: false,
    });
    this.name = 'InvalidInputError';
  }
}

export class MaybeLiveError extends PublishError {
  constructor(message, opts = {}) {
    super(message, {
      ...opts,
      code: PublishErrorCode.RATE_LIMIT_MAYBE_LIVE,
      retriable: false,
    });
    this.name = 'MaybeLiveError';
  }
}
