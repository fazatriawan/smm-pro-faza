import { cancelOutstandPost } from './outstand.js';
import { collectTodayPublishLinks } from './todayPublish.js';
import { getWibDayKey } from '../utils/wibTime.js';
import {
  hoursSincePost,
  isPendingStuck,
  normalizeOutstandStatus,
  PENDING_STUCK_HOURS,
} from '../utils/postStatus.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pending');

/** Post ID yang sudah di-cancel lewat bot — jangan dipakai retry/republish. */
const cancelledPostIds = new Set();

/**
 * @param {string} postId
 */
export function markPostIdCancelled(postId) {
  const id = String(postId || '').trim();
  if (id) cancelledPostIds.add(id);
}

export function isPostIdCancelled(postId) {
  return cancelledPostIds.has(String(postId || '').trim());
}

/**
 * @param {object} [options]
 * @param {string} [options.network] filter platform
 * @param {string[]} [options.usernames] filter @username
 * @param {boolean} [options.stuckOnly] hanya pending >= PENDING_STUCK_HOURS
 */
export async function listPendingToday(options = {}) {
  const data = await collectTodayPublishLinks();
  const today = getWibDayKey();
  const network = options.network
    ? String(options.network).toLowerCase()
    : null;
  const userSet = options.usernames?.length
    ? new Set(
        options.usernames.map((u) =>
          String(u || '')
            .replace(/^@/, '')
            .toLowerCase()
        )
      )
    : null;

  /** @type {Array<{ postId: string, network: string, username: string, status: string, hours: number, contentLabel: string, kontenHari: string, stuck: boolean }>} */
  const rows = [];

  for (const a of data.accounts) {
    const st = normalizeOutstandStatus(a.status);
    if (st !== 'pending') continue;

    const net = (a.network || '').toLowerCase();
    const user = (a.username || '').replace(/^@/, '');
    if (network && net !== network) continue;
    if (userSet && !userSet.has(user.toLowerCase())) continue;

    const hours = hoursSincePost(a, a.rowTimestamp);
    const stuck = isPendingStuck(a, a.rowTimestamp);
    if (options.stuckOnly && !stuck) continue;

    rows.push({
      postId: a.postId || '',
      network: net,
      username: user,
      status: st,
      hours,
      contentLabel: a.contentLabel || '',
      kontenHari: a.mediaFilesDay || a.kontenHari || '',
      stuck,
    });
  }

  return {
    tabName: data.tabName,
    today,
    postIds: data.postIds,
    pending: rows,
    meta: data.meta,
  };
}

/**
 * Kelompokkan pending per Post ID (satu cancel = satu batch Outstand).
 * @param {{ pending: Array<{ postId: string }> }} data
 */
export function groupPendingByPostId(data) {
  /** @type {Map<string, typeof data.pending>} */
  const byPost = new Map();
  for (const row of data.pending) {
    const pid = row.postId || '(tanpa-id)';
    if (!byPost.has(pid)) byPost.set(pid, []);
    byPost.get(pid).push(row);
  }
  return byPost;
}

/**
 * Batalkan Post ID di Outstand (DELETE) — menghentikan antrian publish.
 * @param {string[]} postIds
 */
export async function cancelPendingPostIds(postIds) {
  const unique = [...new Set(postIds.filter(Boolean))];
  /** @type {Array<{ postId: string, ok: boolean, message: string }>} */
  const results = [];

  for (const postId of unique) {
    if (isPostIdCancelled(postId)) {
      results.push({ postId, ok: true, message: 'sudah dibatalkan sebelumnya' });
      continue;
    }
    try {
      const res = await cancelOutstandPost(postId);
      markPostIdCancelled(postId);
      results.push({
        postId,
        ok: true,
        message: res.message || 'dibatalkan',
      });
    } catch (err) {
      results.push({
        postId,
        ok: false,
        message: err.message || String(err),
      });
    }
  }

  return results;
}

const esc = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');

/**
 * Laporan pending untuk Telegram.
 * @param {Awaited<ReturnType<typeof listPendingToday>>} data
 */
export function formatPendingReport(data) {
  const today = data.today;
  if (!data.pending.length) {
    return (
      `✅ Tidak ada akun *pending* di tab *${data.tabName}*.\n\n` +
      `Kalau profil masih upload konten lama, itu antrian *Outstand* dari batch kemarin — cek dashboard Outstand atau tunggu habis.\n` +
      `Refresh Sheets: \`/synctoday\``
    );
  }

  const byPost = groupPendingByPostId(data);
  const staleKonten = data.pending.filter(
    (r) => r.kontenHari && r.kontenHari !== today
  ).length;

  let msg =
    `⏳ *Antrian pending* — ${data.pending.length} akun · tab *${data.tabName}*\n` +
    `${data.meta.pending ?? data.pending.length} masih antrian di Outstand\n`;

  if (staleKonten) {
    msg += `\n⚠️ *${staleKonten}* baris konten dari batch *bukan hari ini* (cek kolom Konten di Sheets)\n`;
  }

  const lines = data.pending.slice(0, 20).map((r) => {
    const h = r.hours >= 0.1 ? `${r.hours.toFixed(1)}j` : '<1j';
    const konten = r.contentLabel
      ? `\n  _${esc(r.contentLabel.slice(0, 80))}_`
      : '';
    const stale =
      r.kontenHari && r.kontenHari !== today
        ? ` · ⚠️ batch ${r.kontenHari}`
        : '';
    return `• *${r.network}* @${esc(r.username)} — pending ${h}${stale}${konten}`;
  });

  msg += '\n' + lines.join('\n');
  if (data.pending.length > 20) {
    msg += `\n_…+${data.pending.length - 20} akun_`;
  }

  const postCount = byPost.size;
  msg +=
    `\n\n📦 *${postCount}* Post ID punya antrian\n` +
    `Hentikan antrian Outstand:\n` +
    `• \`/stop\` — batalkan semua batch pending hari ini\n` +
    `• \`/stop ig\` — hanya Instagram\n` +
    `• \`/stop stuck\` — hanya pending >${PENDING_STUCK_HOURS} jam\n\n` +
    `_Cancel = seluruh akun dalam Post ID yang sama ikut dibatalkan di Outstand._\n` +
    `Jangan \`/retry\` / republish stuck sebelum cancel — bisa dobel post.`;

  return msg;
}

/**
 * @param {Array<{ postId: string, ok: boolean, message: string }>} results
 */
export function formatCancelResults(results) {
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  let msg = `🛑 *Cancel antrian Outstand*\n\n✅ ${ok.length} Post ID dibatalkan`;
  if (ok.length) {
    msg +=
      '\n' +
      ok
        .slice(0, 12)
        .map((r) => `• \`${r.postId}\` — ${r.message}`)
        .join('\n');
  }
  if (fail.length) {
    msg +=
      `\n\n❌ Gagal ${fail.length}:\n` +
      fail
        .slice(0, 8)
        .map((r) => `• \`${r.postId}\` — ${r.message}`)
        .join('\n');
  }
  msg +=
    '\n\nRefresh status: `/synctoday`\n' +
    'Cek profil IG — post yang sudah terbit tidak bisa dihapus dari sini.';
  return msg;
}
