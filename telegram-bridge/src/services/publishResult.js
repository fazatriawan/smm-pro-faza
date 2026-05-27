import {
  buildLivePostUrl,
  isThreadsProfileOnlyUrl,
} from '../utils/platformUrl.js';
import { normalizeOutstandStatus } from '../utils/postStatus.js';
import { buildYoutubePostFields } from './captionPlatforms.js';
import { env } from '../config/env.js';

const NET_LABELS = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  threads: 'Threads',
  facebook: 'Facebook',
  x: 'X',
  twitter: 'X',
  tiktok: 'TikTok',
};

const TELEGRAM_SAFE_LEN = 3800;
const MAX_DETAIL_LINES = 25;
const MAX_ERROR_SAMPLES = 8;
const MAX_LIVE_SAMPLES = 12;

/**
 * URL live per akun — utamakan `/post/` Threads, bukan profil.
 * @param {string} net
 * @param {{ username?: string, platformPostId?: string, url?: string, pageId?: string }} acct
 */
function resolveAccountLiveUrl(net, acct) {
  const user = (acct.username || '').replace(/^@/, '');
  const built = buildLivePostUrl(
    net,
    user,
    acct.platformPostId,
    acct.url,
    acct.pageId
  );
  if (built) return built;
  const raw = String(acct.url || '').trim();
  if (net === 'threads' && isThreadsProfileOnlyUrl(raw)) return undefined;
  return raw || undefined;
}

/**
 * @param {string} err
 */
export function shortenPublishError(err) {
  const raw = String(err || '').trim();
  if (!raw) return '';

  if (/quota exceeded|429|RESOURCE_EXHAUSTED|rateLimitExceeded/i.test(raw)) {
    if (/youtube|Video Uploads/i.test(raw)) {
      return 'Kuota upload YouTube harian habis (batas per project Outstand).';
    }
    return 'Rate limit / kuota API habis.';
  }

  const jsonMatch = raw.match(/\{[\s\S]*"message"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const msg = parsed?.error?.message || parsed?.message;
      if (msg) return String(msg).slice(0, 160);
    } catch {
      /* ignore */
    }
  }

  const afterColon = raw.match(/(?:failed|error)[:\s]+(.+)/i);
  if (afterColon?.[1]) {
    return afterColon[1].replace(/\s+/g, ' ').slice(0, 160);
  }

  return raw.replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * @param {Array<{ network: string, username?: string, status: string, error?: string, platformPostId?: string, url?: string }>} accounts
 */
function groupByNetwork(accounts) {
  /** @type {Record<string, { live: number, failed: number, pending: number }>} */
  const out = {};
  for (const a of accounts) {
    const net = (a.network || 'unknown').toLowerCase();
    if (!out[net]) out[net] = { live: 0, failed: 0, pending: 0 };
    const st = (a.status || '').toLowerCase();
    if (st === 'published') out[net].live += 1;
    else if (st === 'failed') out[net].failed += 1;
    else out[net].pending += 1;
  }
  return out;
}

const STATUS_RANK = { published: 3, failed: 2, pending: 1 };

/**
 * Gabungkan akun duplikat (satu baris per network+username), ambil status terbaik.
 * @param {Array<{ network: string, username?: string, accountId?: string, platformPostId?: string, status?: string, error?: string, url?: string }>} accounts
 */
export function mergeSheetAccounts(accounts) {
  /** @type {Map<string, typeof accounts[0]>} */
  const byKey = new Map();

  for (const acc of accounts) {
    const key = `${(acc.network || '').toLowerCase()}:${(acc.username || acc.accountId || '').replace(/^@/, '')}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, acc);
      continue;
    }
    const curRank = STATUS_RANK[cur.status] || 0;
    const nextRank = STATUS_RANK[acc.status] || 0;
    if (
      nextRank > curRank ||
      (nextRank === curRank && acc.url && !cur.url) ||
      (nextRank === curRank && acc.postId && !cur.postId)
    ) {
      byKey.set(key, acc);
    }
  }

  return [...byKey.values()];
}

/**
 * @param {Array<{ id?: string, socialAccounts?: Array<{ network?: string, username?: string, status?: string, error?: string | null, platformPostId?: string | null }> } | null>} posts
 * @param {string} [baseCaption]
 */
export function summarizePublishResults(posts, baseCaption = '') {
  let published = 0;
  let failed = 0;
  let pending = 0;
  const lines = [];
  /** @type {Array<{ network: string, username: string, status: string, error?: string, platformPostId?: string, url?: string, accountId?: string }>} */
  const sheetAccounts = [];

  for (const post of posts) {
    if (!post) continue;
    for (const acct of post.socialAccounts ?? []) {
      const net = (acct.network || 'unknown').toLowerCase();
      const user = (acct.username || acct.id || '').replace(/^@/, '');
      const status = normalizeOutstandStatus(acct.status);
      const label = NET_LABELS[net] || net;
      const shortErr = acct.error ? shortenPublishError(acct.error) : '';

      if (status === 'published') published += 1;
      else if (status === 'failed') failed += 1;
      else pending += 1;

      let line = `${status === 'published' ? '✅' : status === 'failed' ? '❌' : '⏳'} ${label} @${user}: ${status}`;
      if (status === 'published' && acct.platformPostId) {
        const url = buildLivePostUrl(
          net,
          user,
          acct.platformPostId,
          acct.url,
          acct.pageId
        );
        if (url) line += `\n   🔗 ${url}`;
      }
      if (status === 'failed' && shortErr) {
        line += `\n   ⚠️ ${shortErr}`;
      }
      lines.push(line);

      const postCaption = post.caption || '';

      sheetAccounts.push({
        network: net,
        username: user,
        accountId: acct.id,
        postId: post.id,
        pageId: acct.pageId,
        platformPostId: acct.platformPostId,
        status,
        error: shortErr || acct.error,
        postCaption,
        rowTimestamp:
          acct.publishedAt ||
          post.publishedAt ||
          post.scheduledAt ||
          post.createdAt ||
          post.updatedAt ||
          null,
        url: resolveAccountLiveUrl(net, acct),
      });
    }
  }

  const yt = baseCaption ? buildYoutubePostFields(baseCaption) : null;
  const hasYoutubeTarget = sheetAccounts.some((a) => a.network === 'youtube');
  const statusSummary =
    failed > 0 && published === 0
      ? 'Gagal'
      : pending > 0 && published === 0
        ? 'Pending'
        : failed > 0
          ? 'Sebagian'
          : published > 0
            ? 'Live'
            : 'Tidak diketahui';

  const errorNotes = sheetAccounts
    .filter((a) => a.status === 'failed' && a.error)
    .map((a) => `${a.network} @${a.username}: ${shortenPublishError(a.error)}`)
    .join('\n')
    .slice(0, 2000);

  return {
    published,
    failed,
    pending,
    lines,
    sheetAccounts,
    statusSummary,
    errorNotes,
    youtubeTitle: hasYoutubeTarget ? yt?.title || '' : '',
  };
}

/**
 * Ringkasan status dari daftar akun sheet (semua target, bukan hanya yang API kembalikan).
 * @param {Array<{ status?: string, network?: string, username?: string, error?: string }>} sheetAccounts
 * @param {string} [baseCaption]
 */
export function summarizeSheetAccounts(sheetAccounts, baseCaption = '') {
  let published = 0;
  let failed = 0;
  let pending = 0;

  for (const a of sheetAccounts) {
    const st = (a.status || 'pending').toLowerCase();
    if (st === 'published') published += 1;
    else if (st === 'failed') failed += 1;
    else pending += 1;
  }

  const yt = baseCaption ? buildYoutubePostFields(baseCaption) : null;
  const hasYoutubeTarget = sheetAccounts.some((a) => a.network === 'youtube');

  const statusSummary =
    failed > 0 && published === 0
      ? 'Gagal'
      : pending > 0 && published === 0
        ? 'Pending'
        : failed > 0
          ? 'Sebagian'
          : published > 0
            ? 'Live'
            : 'Tidak diketahui';

  const errorNotes = sheetAccounts
    .filter((a) => a.status === 'failed' && a.error)
    .map((a) => `${a.network} @${a.username}: ${shortenPublishError(a.error)}`)
    .join('\n')
    .slice(0, 5000);

  return {
    published,
    failed,
    pending,
    statusSummary,
    errorNotes,
    youtubeTitle: hasYoutubeTarget ? yt?.title || '' : '',
  };
}

/**
 * Gabungkan semua akun target dengan status terbaru dari Outstand (per id akun).
 * @param {Array<{ id: string, network?: string, username?: string }>} allAccounts
 * @param {string[]} expectedIds
 * @param {Array<{ socialAccounts?: Array<{ id?: string, network?: string, username?: string, status?: string, error?: string | null, platformPostId?: string | null }> } | null>} posts
 */
export function buildSheetAccountsFromTargets(allAccounts, expectedIds, posts) {
  const directoryById = new Map(allAccounts.map((a) => [a.id, a]));
  const expected = expectedIds
    .map((id) => directoryById.get(id))
    .filter(Boolean);
  /** @type {Map<string, { network?: string, username?: string, status?: string, error?: string | null, platformPostId?: string | null }>} */
  const statusById = new Map();

  /** @type {Map<string, string>} */
  const postIdByNet = new Map();

  for (const post of posts) {
    if (!post?.id) continue;
    for (const acct of post.socialAccounts ?? []) {
      if (acct.id) {
        statusById.set(acct.id, acct);
        const n = (acct.network || '').toLowerCase();
        if (n) postIdByNet.set(n, post.id);
      }
    }
  }

  return expected.map((exp) => {
    const net = (exp.network || 'unknown').toLowerCase();
    const user = (exp.username || exp.id).replace(/^@/, '');
    const acct = statusById.get(exp.id);
    const postId = postIdByNet.get(net) || '';

    if (!acct) {
      return {
        network: net,
        username: user,
        accountId: exp.id,
        postId,
        status: 'pending',
        platformPostId: undefined,
        error: undefined,
        url: undefined,
      };
    }

    const status = normalizeOutstandStatus(acct.status);
    const shortErr = acct.error ? shortenPublishError(acct.error) : '';

    return {
      network: net,
      username: (acct.username || user).replace(/^@/, ''),
      accountId: exp.id,
      postId,
      pageId: acct.pageId ?? exp.pageId ?? undefined,
      platformPostId: acct.platformPostId ?? undefined,
      status,
      error: shortErr || acct.error || undefined,
      url: resolveAccountLiveUrl(net, {
        username: user,
        platformPostId: acct.platformPostId,
        url: acct.url ?? undefined,
        pageId: acct.pageId ?? exp.pageId,
      }),
    };
  });
}

/**
 * @param {ReturnType<typeof summarizePublishResults>} summary
 * @param {string} postIdLine
 */
function formatCompactTelegramReport(summary, postIdLine) {
  const header =
    summary.failed > 0 && summary.published === 0
      ? '❌ Publish gagal'
      : summary.pending > 0 && summary.published === 0
        ? '⏳ Masih diproses'
        : summary.failed > 0
          ? '⚠️ Publish sebagian berhasil'
          : summary.published > 0
            ? '✅ Post sudah live'
            : '⏳ Status belum pasti';

  let msg =
    `${header}\n` +
    `Ringkasan: ${summary.published} live · ${summary.failed} gagal · ${summary.pending} pending\n`;

  const byNet = groupByNetwork(summary.sheetAccounts);
  msg += '\n*Per platform:*\n';
  for (const [net, c] of Object.entries(byNet).sort()) {
    const label = NET_LABELS[net] || net;
    msg += `• ${label}: ${c.live} live · ${c.pending} pending · ${c.failed} gagal\n`;
  }

  const live = summary.sheetAccounts.filter((a) => a.status === 'published');
  if (live.length) {
    msg += `\n*Contoh live* (${Math.min(live.length, MAX_LIVE_SAMPLES)} dari ${live.length}):\n`;
    for (const a of live.slice(0, MAX_LIVE_SAMPLES)) {
      const label = NET_LABELS[a.network] || a.network;
      msg += `✅ ${label} @${a.username}`;
      if (a.url) msg += `\n   ${a.url}`;
      msg += '\n';
    }
    if (live.length > MAX_LIVE_SAMPLES) {
      msg += `_…dan ${live.length - MAX_LIVE_SAMPLES} akun lain (lihat Sheets)._\n`;
    }
  }

  const failed = summary.sheetAccounts.filter((a) => a.status === 'failed');
  if (failed.length) {
    const seen = new Set();
    msg += `\n*Gagal* (${failed.length} akun):\n`;
    let shown = 0;
    for (const a of failed) {
      const key = `${a.network}:${shortenPublishError(a.error)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = NET_LABELS[a.network] || a.network;
      msg += `❌ ${label} — ${shortenPublishError(a.error) || 'error'}\n`;
      shown += 1;
      if (shown >= MAX_ERROR_SAMPLES) break;
    }
    if (failed.length > shown) {
      msg += `_Detail per akun ada di Google Sheets._\n`;
    }
  }

  if (summary.pending > 0) {
    msg += `\n⏳ *${summary.pending} akun masih pending* — tunggu webhook atau cek Outstand dashboard.\n`;
  }

  if (summary.failed > 0) {
    msg +=
      `\n💡 YouTube gagal massal? Kuota API = *satu pool per project Google* (Outstand), bukan per akun. Default project ≈${env.youtubeProjectUploadsPerDay} upload/hari *total* semua akun. Untuk ratusan akun × banyak video/hari butuh project API sendiri + perpanjangan kuota ke Google, atau tanya Outstand paket enterprise.`;
  }

  if (postIdLine) msg += `\n\nPost ID: ${postIdLine}`;
  return msg.trim();
}

const MAX_LINKS_PER_PLATFORM = 40;

/**
 * Daftar semua URL post yang sudah live (untuk disalin dari Telegram).
 * @param {Array<{ network: string, username?: string, status?: string, platformPostId?: string, url?: string }>} accounts
 * @param {string} [postIdLine]
 */
export function formatPublishLinksReport(accounts, postIdLine = '') {
  const live = accounts.filter((a) => {
    const st = (a.status || '').toLowerCase();
    return st === 'published' && (a.url || a.platformPostId);
  });

  if (!live.length) {
    return (
      'Belum ada link live.\n\n' +
      '• Tunggu beberapa menit lalu coba lagi\n' +
      '• Atau `/syncsheet` + `/links` dengan Post ID yang sama'
    );
  }

  /** @type {Record<string, typeof live>} */
  const byNet = {};
  for (const a of live) {
    const net = a.network || 'unknown';
    if (!byNet[net]) byNet[net] = [];
    byNet[net].push(a);
  }

  let msg = `🔗 *${live.length} link live* (bisa disalin)`;
  if (postIdLine) msg += `\nPost ID: ${postIdLine}`;
  msg += '\n\n';

  for (const [net, list] of Object.entries(byNet).sort()) {
    const label = NET_LABELS[net] || net;
    msg += `*${label}* — ${list.length} akun\n`;
    for (const a of list.slice(0, MAX_LINKS_PER_PLATFORM)) {
      const user = (a.username || '').replace(/^@/, '');
      const url = buildLivePostUrl(
        net,
        user,
        a.platformPostId,
        a.url,
        a.pageId
      );
      msg += `@${user}\n${url}\n\n`;
    }
    if (list.length > MAX_LINKS_PER_PLATFORM) {
      msg += `_+${list.length - MAX_LINKS_PER_PLATFORM} link → kolom Link di Google Sheets_\n\n`;
    }
  }

  const pending = accounts.filter(
    (a) => (a.status || '').toLowerCase() === 'pending'
  );
  const failed = accounts.filter(
    (a) => (a.status || '').toLowerCase() === 'failed'
  );
  if (pending.length) {
    msg += `\n⏳ ${pending.length} akun masih pending (belum ada link).`;
  }
  if (failed.length) {
    msg += `\n❌ ${failed.length} akun gagal — detail di Sheets kolom Catatan.`;
  }

  return msg.trim();
}

/**
 * @param {ReturnType<typeof summarizePublishResults>} summary
 * @param {string} postIdLine
 */
export function formatTelegramPublishReport(summary, postIdLine) {
  const total = summary.published + summary.failed + summary.pending;
  const useCompact =
    total > 30 ||
    summary.lines.length > MAX_DETAIL_LINES ||
    summary.lines.join('\n').length > TELEGRAM_SAFE_LEN;

  if (useCompact) {
    return formatCompactTelegramReport(summary, postIdLine);
  }

  const header =
    summary.failed > 0 && summary.published === 0
      ? '❌ Publish gagal'
      : summary.pending > 0 && summary.published === 0
        ? '⏳ Masih diproses'
        : summary.failed > 0
          ? '⚠️ Publish sebagian berhasil'
          : summary.published > 0
            ? '✅ Post sudah live'
            : '⏳ Status belum pasti';

  let msg =
    `${header}\n` +
    `Ringkasan: ${summary.published} live · ${summary.failed} gagal · ${summary.pending} pending\n\n` +
    summary.lines.slice(0, MAX_DETAIL_LINES).join('\n');

  if (summary.lines.length > MAX_DETAIL_LINES) {
    msg += `\n\n_…${summary.lines.length - MAX_DETAIL_LINES} akun lain — lihat Sheets._`;
  }

  if (summary.failed > 0) {
    msg +=
      '\n\n💡 Gagal? Reconnect akun di Outstand, IG Business, atau kuota YouTube harian.';
  }

  if (postIdLine) msg += `\n\nPost ID: ${postIdLine}`;
  return msg;
}

/**
 * Pecah pesan panjang untuk Telegram (max 4096).
 * @param {string} text
 * @param {number} [maxLen]
 */
/**
 * Telegram limit 4096 char per message. Pakai 3500 sebagai safety margin
 * supaya markdown escape, retry footer, atau emoji UTF-16 tidak overflow.
 */
export function splitTelegramMessage(text, maxLen = 3500) {
  if (!text || text.length <= maxLen) return [text];

  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Throttle antar chunk (ms). Telegram per-chat limit kira-kira 1 msg/s tapi
 * dengan sliding window — akumulasi message dari publish sebelumnya bisa
 * trigger 429. 1500ms aman untuk kirim banyak chunk berturut-turut bahkan
 * setelah aktivitas publish padat.
 */
const CHUNK_DELAY_MS = 1500;

/** Maksimum percobaan kirim ulang per chunk saat dapat 429. */
const MAX_SEND_ATTEMPTS = 6;

/** Sleep helper untuk throttle & retry. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Threshold otomatis switch ke document mode. Kalau report > 2 chunks
 * (~7000 char), kirim sebagai file .txt — jauh lebih hemat rate-limit
 * Telegram (1 upload vs N message), plus user dapat 1 file rapi yang bisa
 * di-search & copy.
 */
const DOCUMENT_FALLBACK_CHUNK_THRESHOLD = 2;

/** Di atas ini selalu kirim sebagai file .txt (linkshari / laporan link). */
const DOCUMENT_FALLBACK_CHAR_THRESHOLD = 1800;

/**
 * Kirim message panjang ke Telegram dengan strategi adaptif:
 *
 * - **Pendek** (≤ 3500 char, 1 chunk) → kirim sebagai satu message biasa.
 * - **Sedang** (2 chunks) → kirim sebagai 2 message dengan delay 1500ms.
 * - **Panjang** (≥ 3 chunks atau ≥ ~7000 char) → kirim sebagai file `.txt`,
 *   plus 1 message header pendek dengan ringkasan. Ini menghindari sliding
 *   window 429 di Telegram yang sering muncul saat report mencapai 5+ chunk.
 *
 * Otomatis retry kalau dapat 429 dengan `retry_after` + exponential backoff.
 *
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {object} [options] di-passthrough ke ctx.reply (mis. parse_mode)
 */
export async function replyTelegramLong(ctx, text, options = {}) {
  const parts = splitTelegramMessage(text);

  if (
    parts.length >= DOCUMENT_FALLBACK_CHUNK_THRESHOLD ||
    text.length >= DOCUMENT_FALLBACK_CHAR_THRESHOLD
  ) {
    return sendTelegramDocument(ctx, text, parts.length);
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let attempts = 0;
    let lastErr;
    while (attempts < MAX_SEND_ATTEMPTS) {
      try {
        await ctx.reply(part, options);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        const code = err?.response?.error_code ?? err?.code;
        const retryAfter =
          err?.response?.parameters?.retry_after ??
          err?.parameters?.retry_after;
        if (code === 429 && attempts < MAX_SEND_ATTEMPTS - 1) {
          // Pakai retry_after dari Telegram + buffer 2s. Kalau Telegram tidak
          // kasih retry_after, pakai exponential backoff (3s → 6s → 12s …).
          const waitSec = retryAfter
            ? Number(retryAfter) + 2
            : Math.min(60, 3 * 2 ** attempts);
          await sleep(waitSec * 1000);
          attempts += 1;
          continue;
        }
        // Bukan 429 atau attempts habis → bubble ke caller
        throw err;
      }
    }
    if (lastErr) throw lastErr;
    if (i < parts.length - 1) {
      await sleep(CHUNK_DELAY_MS);
    }
  }
}

/**
 * Kirim text panjang sebagai file `.txt`. Strategi:
 *   1. Buat preview pendek (header + summary baris pertama)
 *   2. Kirim header sebagai message biasa (single ctx.reply — 1 hit rate)
 *   3. Attach full text sebagai document
 *
 * Telegram menghitung document upload terpisah dari message rate limit,
 * jadi bahkan kalau chat sedang ter-throttle, document tetap bisa terkirim.
 *
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {number} chunkCount jumlah chunk kalau dipecah (untuk info)
 */
/**
 * Kirim laporan panjang sebagai file .txt (prioritas file dulu, lalu teks pendek).
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {number} [chunkCount]
 * @param {string} [filenamePrefix]
 */
export async function sendTelegramDocument(
  ctx,
  text,
  chunkCount = 1,
  filenamePrefix = 'linkshari'
) {
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .slice(0, 19);
  const filename = `${filenamePrefix}-${stamp}.txt`;
  const totalLines = text.split('\n').length;

  let attempts = 0;
  while (attempts < MAX_SEND_ATTEMPTS) {
    try {
      await ctx.replyWithDocument({
        source: Buffer.from(text, 'utf-8'),
        filename,
      });
      break;
    } catch (err) {
      const code = err?.response?.error_code ?? err?.code;
      const retryAfter =
        err?.response?.parameters?.retry_after ??
        err?.parameters?.retry_after;
      if (code === 429 && attempts < MAX_SEND_ATTEMPTS - 1) {
        const waitSec = retryAfter
          ? Number(retryAfter) + 2
          : Math.min(60, 3 * 2 ** attempts);
        await sleep(waitSec * 1000);
        attempts += 1;
        continue;
      }
      throw err;
    }
  }

  const header =
    `📎 Report panjang (${totalLines} baris` +
    (chunkCount > 1 ? `, ${chunkCount} bagian` : '') +
    `)\n` +
    `📥 File: ${filename}\n` +
    `Buka file untuk semua link (pesan chat tidak muat).`;

  await ctx
    .reply(header, { disable_web_page_preview: true })
    .catch(() => {});
}

/**
 * @param {ReturnType<typeof summarizePublishResults>} summary
 */
export function formatWebhookNotify(summary, postId) {
  const body = formatCompactTelegramReport(summary, postId);
  return body.length > 3500 ? body.slice(0, 3500) + '\n…' : body;
}
