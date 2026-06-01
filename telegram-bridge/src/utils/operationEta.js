/**
 * Estimasi durasi operasi bot (untuk pesan "⏳ …" di Telegram).
 * Angka berdasarkan rata-rata API Outstand + Sheets; bukan jaminan keras.
 */

const MS_PER_POST_GET = 7_000;
const MS_PER_SOCIAL_ACCOUNTS_PAGE = 2_500;
const MS_SHEETS_WRITE = 4_000;
const MS_DRIVE_FILE = 12_000;
const MS_AI_CAPTION = 25_000;
const MS_PENDING_SCAN_DAY = 8_000;
const MS_PENDING_SCAN_RECENT_POST = 3_500;

/**
 * @param {string} kind
 * @param {{
 *   postCount?: number,
 *   accountCount?: number,
 *   fileCount?: number,
 *   daysBack?: number,
 *   networkCount?: number,
 * }} [params]
 */
export function estimateOperationMs(kind, params = {}) {
  const posts = Math.max(1, Number(params.postCount) || 1);
  const accounts = Math.max(0, Number(params.accountCount) || 0);
  const acctPages = Math.max(1, Math.ceil(Math.max(accounts, 80) / 100));
  const files = Math.max(1, Number(params.fileCount) || 1);
  const daysBack = Math.max(0, Number(params.daysBack) || 0);
  const nets = Math.max(1, Number(params.networkCount) || 1);

  switch (kind) {
    case 'links':
    case 'status_post':
    case 'syncsheet':
      return (
        posts * MS_PER_POST_GET +
        acctPages * MS_PER_SOCIAL_ACCOUNTS_PAGE +
        MS_SHEETS_WRITE
      );

    case 'synctoday':
    case 'refresh':
      return (
        Math.max(posts, 15) * MS_PER_POST_GET +
        acctPages * MS_PER_SOCIAL_ACCOUNTS_PAGE +
        MS_SHEETS_WRITE * 2
      );

    case 'linkshari':
      return (
        Math.max(posts, 20) * MS_PER_POST_GET +
        acctPages * MS_PER_SOCIAL_ACCOUNTS_PAGE +
        5_000
      );

    case 'kuota':
      return (
        Math.max(posts, 12) * MS_PER_POST_GET +
        acctPages * MS_PER_SOCIAL_ACCOUNTS_PAGE +
        3_000
      );

    case 'pending_today':
      return MS_PENDING_SCAN_DAY + posts * 2_000;

    case 'pending_recent':
      return (
        MS_PENDING_SCAN_RECENT_POST * Math.max(10, daysBack * 8) +
        5_000
      );

    case 'unexpected_scan':
      return 45_000 + daysBack * 10_000;

    case 'audit_duplicates':
      return 90_000;

    case 'drive_open':
      return 8_000 + files * 2_000;

    case 'drive_download':
      return files * MS_DRIVE_FILE;

    case 'caption_outstand':
      return posts * MS_PER_POST_GET + 3_000;

    case 'caption_ai':
      return nets * MS_AI_CAPTION;

    case 'random_pick':
      return acctPages * MS_PER_SOCIAL_ACCOUNTS_PAGE + 2_000;

    case 'republish':
    case 'retry_analyze':
      return posts * MS_PER_POST_GET + 15_000;

    case 'republish_run':
      return (
        posts * MS_PER_POST_GET +
        accounts * 400 +
        60_000
      );

    case 'replacement_publish':
      return 90_000 + accounts * 500;

    case 'stop_cancel':
      return posts * 4_000 + 5_000;

    default:
      return 20_000;
  }
}

/**
 * @param {number} ms
 */
export function formatEtaRange(ms) {
  const lowSec = Math.max(5, Math.round((ms * 0.45) / 1000));
  const highSec = Math.max(lowSec + 3, Math.round((ms * 1.6) / 1000));

  if (highSec < 60) {
    return `${lowSec}–${highSec} detik`;
  }

  const lowMin = Math.max(1, Math.ceil(lowSec / 60));
  const highMin = Math.max(lowMin, Math.ceil(highSec / 60));
  if (lowMin === highMin) return `±${lowMin} menit`;
  return `${lowMin}–${highMin} menit`;
}

/**
 * @param {string} label
 * @param {string} kind
 * @param {Parameters<typeof estimateOperationMs>[1]} [params]
 */
export function formatOperationWait(label, kind, params = {}) {
  const ms = estimateOperationMs(kind, params);
  const eta = formatEtaRange(ms);
  let extra = '';
  if (ms >= 60_000) {
    extra =
      '\n_Jika lebih lama dari estimasi: API Outstand/Sheets sedang lambat — tunggu atau ulangi perintah._';
  } else if (kind === 'links' || kind === 'status_post') {
    extra = '\n_Biasanya selesai sebelum 1 menit untuk 1 Post ID._';
  }

  return `⏳ ${label}\n⏱ *Estimasi:* ${eta}${extra}`;
}
