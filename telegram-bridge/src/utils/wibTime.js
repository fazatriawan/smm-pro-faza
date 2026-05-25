/** Waktu Indonesia Barat — selalu dipakai untuk tampilan ke user / Sheets. */
export const WIB_TIMEZONE = 'Asia/Jakarta';

/**
 * Format tanggal-waktu untuk Sheets & Telegram: `21/05/2026 13:21 WIB`
 * @param {string | Date | number} input ISO string, Date, atau epoch ms
 */
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
