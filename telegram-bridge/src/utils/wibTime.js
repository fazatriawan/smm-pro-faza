/** Waktu Indonesia Barat — selalu dipakai untuk tampilan ke user / Sheets. */
export const WIB_TIMEZONE = 'Asia/Jakarta';

/**
 * Format tanggal-waktu untuk Sheets & Telegram: `21/05/2026 13:21 WIB`
 * @param {string | Date | number} input ISO string, Date, atau epoch ms
 */
/** Jam:menit WIB saja, mis. `14:30` */
export function formatWibTimeShort(input) {
  if (input == null || input === '') return '';
  try {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: WIB_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}

export function formatWibDateTime(input) {
  if (input == null || input === '') return '';
  try {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return '';

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: WIB_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')} WIB`;
  } catch {
    return '';
  }
}

/** ISO UTC untuk penyimpanan internal (Outstand, context, sort). */
export function nowIsoUtc() {
  return new Date().toISOString();
}

/**
 * Day-key di zona WIB, format `YYYY-MM-DD`. Dipakai untuk anti-stale session:
 * kalau key berubah, artinya hari sudah ganti dan session media lama harus
 * di-clear sebelum dipakai ulang.
 * @param {string | Date | number} [input]
 */
export function getWibDayKey(input) {
  try {
    const d = input == null || input === ''
      ? new Date()
      : input instanceof Date
        ? input
        : new Date(input);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: WIB_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return '';
  }
}

/** Awal hari (00:00:00) di WIB, dalam epoch ms UTC. */
export function getWibDayStartMs(dayKey) {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return NaN;
  const d = new Date(`${dayKey}T00:00:00+07:00`);
  return d.getTime();
}

/** Akhir hari (23:59:59.999) di WIB, dalam epoch ms UTC. */
export function getWibDayEndMs(dayKey) {
  const start = getWibDayStartMs(dayKey);
  if (!Number.isFinite(start)) return NaN;
  return start + 86_400_000 - 1;
}
