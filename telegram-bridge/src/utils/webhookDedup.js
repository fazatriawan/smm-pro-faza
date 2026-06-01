/**
 * Dedup webhook in-memory dengan TTL.
 *
 * Outstand retry sampai 5× dengan exponential backoff (10s → 5m) kalau
 * endpoint kita timeout / 5xx. Karena handler kita merespon 200 cepat
 * dan proses async, ada window di mana retry bisa datang sebelum proses
 * pertama selesai → bisa jadi double Sheets write / double Telegram notify.
 *
 * Key dedup = SHA256(rawBody) supaya retry yang persis sama dianggap
 * duplikat. Outstand mengirim payload identik untuk retry (event +
 * timestamp + data sama), jadi hash body cukup.
 *
 * TTL default 1 jam — Outstand max retry window ~30 menit (5× backoff
 * 10s/30s/2m/5m/5m), 1 jam memberi buffer aman.
 *
 * Catatan: ini in-memory. Saat process restart, dedup hilang. Phase 1
 * akan menggantinya dengan tabel Postgres `webhook_events.uniqueIndex`.
 */

import { createHash } from 'node:crypto';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 jam
const MAX_ENTRIES = 5000; // safeguard kalau lupa cleanup

/** @type {Map<string, number>} key → expireAtMs */
const seen = new Map();

function gc(now = Date.now()) {
  if (seen.size < MAX_ENTRIES) return;
  for (const [k, exp] of seen) {
    if (exp <= now) seen.delete(k);
  }
  // Kalau masih kebanyakan, hapus entri tertua sampai di bawah cap.
  if (seen.size >= MAX_ENTRIES) {
    const overflow = seen.size - Math.floor(MAX_ENTRIES * 0.8);
    let i = 0;
    for (const k of seen.keys()) {
      if (i++ >= overflow) break;
      seen.delete(k);
    }
  }
}

/**
 * Hitung dedup key dari raw body webhook.
 * @param {string} rawBody
 */
export function hashWebhookBody(rawBody) {
  return createHash('sha256').update(rawBody || '', 'utf8').digest('hex');
}

/**
 * Cek + tandai dedup. `true` = pertama kali (proses!), `false` = duplikat.
 *
 * @param {string} key
 * @param {number} [ttlMs]
 */
export function markIfNew(key, ttlMs = DEFAULT_TTL_MS) {
  if (!key) return true;
  const now = Date.now();
  const expire = seen.get(key);
  if (expire && expire > now) {
    return false;
  }
  seen.set(key, now + ttlMs);
  gc(now);
  return true;
}

/** Untuk testing / metrics. */
export function dedupSize() {
  return seen.size;
}

export function _resetForTests() {
  seen.clear();
}
