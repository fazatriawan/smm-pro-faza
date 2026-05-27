/** Post ID Outstand: pendek, biasanya ada angka (mis. 1dHcG, ew0Tr). */
const SHEET_HEADER_WORDS = new Set([
  'akun',
  'post',
  'postid',
  'platform',
  'status',
  'link',
  'catatan',
  'judul',
  'konten',
  'waktu',
  'ke',
  'duplikat',
  'youtube',
  'instagram',
  'facebook',
  'threads',
  'tiktok',
  'twitter',
  'x',
]);

export function isValidOutstandPostId(id) {
  const s = String(id || '').trim();
  if (s.length < 3 || s.length > 16) return false;
  if (!/^[a-zA-Z0-9]+$/.test(s)) return false;
  if (/^rekap/i.test(s)) return false;
  if (SHEET_HEADER_WORDS.has(s.toLowerCase())) return false;
  return true;
}

/**
 * Normalisasi status dari Outstand ke: published | pending | failed
 * @param {string} [status]
 */
export function normalizeOutstandStatus(status) {
  const st = String(status || 'pending').toLowerCase().trim();
  if (
    st === 'published' ||
    st === 'success' ||
    st === 'completed' ||
    st === 'complete' ||
    st === 'live'
  ) {
    return 'published';
  }
  if (
    st === 'failed' ||
    st === 'error' ||
    st === 'rejected' ||
    st === 'cancelled' ||
    st === 'canceled'
  ) {
    return 'failed';
  }
  if (
    st === 'pending' ||
    st === 'processing' ||
    st === 'queued' ||
    st === 'scheduled' ||
    st === 'in_progress' ||
    st === 'inprogress'
  ) {
    return 'pending';
  }
  return 'pending';
}

/**
 * Berapa jam baris ini sudah pending (dari rowTimestamp / event.timestamp).
 * @param {{ rowTimestamp?: string | null }} acc
 * @param {string} [eventIso]
 */
export function hoursSincePost(acc, eventIso) {
  const raw = acc.rowTimestamp || eventIso || '';
  const t = Date.parse(raw);
  if (!t) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

/** Threshold (jam) untuk dianggap "pending lama / stuck". */
export const PENDING_STUCK_HOURS = 2;

/**
 * @param {{ status?: string, rowTimestamp?: string | null }} acc
 * @param {string} [eventIso]
 */
export function isPendingStuck(acc, eventIso) {
  return (
    normalizeOutstandStatus(acc.status) === 'pending' &&
    hoursSincePost(acc, eventIso) >= PENDING_STUCK_HOURS
  );
}

/** Label kolom Status di Google Sheets (membedakan pending baru vs stuck) */
export function sheetStatusLabel(status, acc, eventIso) {
  const st = normalizeOutstandStatus(status);
  if (st === 'published') return '✅ Live';
  if (st === 'failed') return '❌ Gagal';
  if (acc && isPendingStuck({ ...acc, status }, eventIso)) {
    const h = Math.round(hoursSincePost(acc, eventIso));
    return `⌛ Pending lama (${h}j)`;
  }
  return '⏳ Pending';
}

/**
 * Kolom Catatan — beda teks untuk pending vs gagal vs pending lama.
 * @param {{ status?: string, error?: string, rowTimestamp?: string | null }} acc
 * @param {string} [eventIso]
 */
export function sheetNoteForAccount(acc, eventIso) {
  const st = normalizeOutstandStatus(acc.status);
  if (st === 'published') return '';
  if (st === 'failed') {
    const err = String(acc.error || '').trim();
    return err
      ? err.slice(0, 500)
      : 'Publish gagal — cek error di Outstand';
  }
  if (isPendingStuck(acc, eventIso)) {
    const h = Math.round(hoursSincePost(acc, eventIso));
    return `Pending ${h} jam — mungkin konten kemarin; batalkan: /stop · cek profil IG`;
  }
  return 'Antrian Outstand — /stop untuk batalkan · /refresh untuk update status';
}

/**
 * Kolom Link (URL) — hanya URL asli jika live.
 * @param {string} httpLink dari buildLivePostUrl
 * @param {string} status
 */
export function sheetHttpLinkCell(httpLink, status) {
  const st = normalizeOutstandStatus(status);
  if (st !== 'published') return '';
  return typeof httpLink === 'string' && /^https?:\/\//i.test(httpLink)
    ? httpLink
    : '';
}

/**
 * Kolom platform Link (@ pair) — jangan campur error ke sel link.
 * @param {{ status?: string, platformPostId?: string, url?: string }} acc
 * @param {string} liveUrl
 */
export function sheetPlatformLinkCell(acc, liveUrl) {
  const st = normalizeOutstandStatus(acc.status);
  if (st === 'published') {
    if (liveUrl && /^https?:\/\//i.test(liveUrl)) return liveUrl;
    return '✅ live';
  }
  if (st === 'pending') return '⏳ antrian';
  if (st === 'failed') return '—';
  return '—';
}
