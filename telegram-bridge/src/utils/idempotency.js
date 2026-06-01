/**
 * Idempotency helper — membangun kunci deterministik untuk request publish
 * sehingga retry yang tidak disengaja TIDAK menghasilkan duplikat post.
 *
 * Kontrak:
 *  - `buildIdempotencyKey(parts)` → hex SHA256, 64 karakter.
 *  - Urutan akun + media TIDAK boleh mengubah kunci (di-sort dulu).
 *  - Field tambahan boleh dimasukkan via `extra` (mis. chatId, day).
 *
 * Catatan Phase 0:
 *  Util ini BELUM dipakai runtime. Akan dipakai oleh queue producer di
 *  Phase 1 sebagai unique job id (BullMQ `jobId` + DB unique constraint).
 *
 * Catatan Node:
 *  Menggunakan `node:crypto` (built-in) — tidak perlu install dependency.
 */

import { createHash } from 'node:crypto';

/**
 * Normalisasi nilai jadi string yang stabil untuk hashing.
 * - String dipangkas whitespace.
 * - Angka di-toString.
 * - null/undefined → string kosong.
 * @param {unknown} v
 */
function norm(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Membentuk array akun yang stabil terhadap urutan input.
 * @param {Array<{ accountId: string|number, network?: string }>} targets
 */
function canonicalTargets(targets) {
  if (!Array.isArray(targets)) return '';
  return targets
    .map((t) => `${norm(t?.network).toLowerCase()}:${norm(t?.accountId)}`)
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * Membentuk array media yang stabil terhadap urutan input.
 * Menggunakan URL sebagai identitas utama (Drive link / S3 presigned).
 * @param {Array<{ url?: string, filename?: string, kind?: string }>} media
 */
function canonicalMedia(media) {
  if (!Array.isArray(media)) return '';
  return media
    .map((m) => `${norm(m?.kind)}:${norm(m?.url || m?.filename)}`)
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * @typedef {Object} IdempotencyParts
 * @property {Array<{ accountId: string|number, network?: string }>} [targets]
 * @property {Array<{ url?: string, filename?: string, kind?: string }>} [media]
 * @property {string} [scheduledAtIsoUtc]   ISO UTC; '' = publish now.
 * @property {string} [captionDigest]       Hash caption gabungan (opsional).
 * @property {string|number} [chatId]       Pemilik request (mis. Telegram chat).
 * @property {string} [dayKey]              Bucket harian (mis. '2026-05-25').
 * @property {Record<string, unknown>} [extra]
 */

/**
 * Hash SHA256 deterministik untuk request publish.
 * Output: hex 64 karakter.
 *
 * @param {IdempotencyParts} parts
 * @returns {string}
 */
export function buildIdempotencyKey(parts = {}) {
  const segments = [
    `targets=${canonicalTargets(parts.targets)}`,
    `media=${canonicalMedia(parts.media)}`,
    `scheduled=${norm(parts.scheduledAtIsoUtc)}`,
    `captionDigest=${norm(parts.captionDigest)}`,
    `chatId=${norm(parts.chatId)}`,
    `dayKey=${norm(parts.dayKey)}`,
  ];

  if (parts.extra && typeof parts.extra === 'object') {
    const extraEntries = Object.keys(parts.extra)
      .sort()
      .map((k) => `${k}=${norm(parts.extra[k])}`);
    segments.push(`extra=${extraEntries.join('&')}`);
  }

  return createHash('sha256').update(segments.join('\n')).digest('hex');
}

/**
 * Versi pendek untuk display/log (12 char, tidak untuk DB unique check).
 * @param {string} key
 */
export function shortKey(key) {
  if (typeof key !== 'string' || key.length < 12) return key || '';
  return key.slice(0, 12);
}

/**
 * Hash caption gabungan supaya perbedaan caption mempengaruhi key.
 * Caption boleh array (per-network) atau object.
 *
 * @param {string[] | Record<string, string> | string} captions
 */
export function captionsDigest(captions) {
  if (!captions) return '';
  let normalized;
  if (typeof captions === 'string') {
    normalized = captions;
  } else if (Array.isArray(captions)) {
    normalized = captions.map((c) => norm(c)).sort().join('\n');
  } else {
    normalized = Object.keys(captions)
      .sort()
      .map((k) => `${k}::${norm(captions[k])}`)
      .join('\n');
  }
  return createHash('sha256').update(normalized).digest('hex');
}
