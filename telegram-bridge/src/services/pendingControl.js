import { cancelOutstandPost, getPost, listRecentPostIds } from './outstand.js';
import { collectTodayPublishLinks } from './todayPublish.js';
import { getWibDayKey } from '../utils/wibTime.js';
import {
  hoursSincePost,
  isPendingStuck,
  normalizeOutstandStatus,
  PENDING_STUCK_HOURS,
} from '../utils/postStatus.js';
import { createLogger } from '../utils/logger.js';
import { safeReply } from '../utils/telegramMarkdown.js';
import { replyTelegramLong } from './publishResult.js';
import { isValidOutstandPostId } from '../utils/postStatus.js';
import {
  markPostIdCancelled,
  isPostIdCancelled,
} from '../utils/cancelledPostIds.js';

const log = createLogger('pending');

export { markPostIdCancelled, isPostIdCancelled };

/**
 * Parse argumen /stop — Post ID case-sensitive, jangan di-lowercase.
 * @param {string} rawArgs teks setelah /stop
 */
export function parseStopCommandArgs(rawArgs) {
  const raw = String(rawArgs || '').trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const postIds = [];
  /** @type {string[]} */
  const other = [];

  for (const t of tokens) {
    if (isValidOutstandPostId(t)) postIds.push(t);
    else other.push(t);
  }

  const rest = other.join(' ').toLowerCase();
  return {
    postIds: [...new Set(postIds)],
    stuckOnly: /\bstuck\b/.test(rest),
    doCancel: /\b(yes|ya|kirim|confirm|batalkan)\b/.test(rest),
    localMark: /\bmark\b/.test(rest),
    daysMatch: rest.match(/\b(\d+)\s*d\b/),
    rest,
  };
}

/**
 * Tandai Post ID dibatalkan di bot (tanpa API Outstand) — blok retry/republish.
 * @param {string[]} postIds
 */
export function markPostIdsStoppedLocally(postIds) {
  for (const id of postIds) {
    markPostIdCancelled(id);
  }
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
 * Scan pending dari Outstand untuk beberapa hari terakhir (tanpa Sheets).
 * Dipakai untuk menemukan batch lama yang masih berjalan dan bisa menyebabkan
 * "konten kemarin" muncul hari ini.
 *
 * @param {{ daysBack?: number, network?: string, stuckOnly?: boolean }} [options]
 */
export async function listPendingRecent(options = {}) {
  const daysBack = Math.max(0, Number(options.daysBack ?? 3) || 3);
  const network = options.network ? String(options.network).toLowerCase() : null;
  const stuckOnly = Boolean(options.stuckOnly);
  const today = getWibDayKey();

  const postIds = await listRecentPostIds({ daysBack });
  /** @type {Array<{ postId: string, network: string, username: string, status: string, hours: number, contentLabel: string, kontenHari: string, stuck: boolean }>} */
  const rows = [];

  for (const pid of postIds) {
    if (!pid) continue;
    let post;
    try {
      post = await getPost(pid);
    } catch (err) {
      log.warn({ postId: pid, err: err.message }, `[Pending] getPost ${pid}: ${err.message}`);
      continue;
    }
    const accounts = post?.socialAccounts || [];
    for (const a of accounts) {
      const st = normalizeOutstandStatus(a.status);
      if (st !== 'pending') continue;
      const net = (a.network || '').toLowerCase();
      if (network && net !== network) continue;
      const hours = hoursSincePost(a, post?.createdAt || post?.scheduledAt || post?.publishedAt);
      const stuck = isPendingStuck({ ...a, rowTimestamp: post?.createdAt }, post?.createdAt);
      if (stuckOnly && !stuck) continue;
      rows.push({
        postId: pid,
        network: net,
        username: (a.username || '').replace(/^@/, ''),
        status: st,
        hours,
        contentLabel: '', // Outstand tidak expose label; Sheets akan tetap punya kolom Konten
        kontenHari: '', // unknown; ditandai di Sheets via context kalau berasal dari bot
        stuck,
      });
    }
  }

  return {
    tabName: `${today} (scan ${daysBack}d)`,
    today,
    postIds,
    pending: rows,
    meta: { pending: rows.length },
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
 * Ringkasan status akun dalam satu Post ID (preflight sebelum DELETE).
 * @param {string} postId
 */
/**
 * @param {string} postId
 */
export async function summarizePostForCancel(postId) {
  try {
    const post = await getPost(postId);
    const accounts = post?.socialAccounts || [];
    let pending = 0;
    let published = 0;
    let failed = 0;
    /** @type {Set<string>} */
    const networks = new Set();
    /** @type {string[]} */
    const pendingUsernames = [];
    for (const a of accounts) {
      const net = (a.network || '').toLowerCase();
      if (net) networks.add(net);
      const st = normalizeOutstandStatus(a.status);
      const user = (a.username || '').replace(/^@/, '');
      if (st === 'pending') {
        pending += 1;
        if (user && pendingUsernames.length < 20) {
          pendingUsernames.push(`${net || '?'} @${user}`);
        }
      } else if (st === 'published') published += 1;
      else if (st === 'failed') failed += 1;
    }
    return {
      postId,
      pending,
      published,
      failed,
      total: accounts.length,
      networks: [...networks],
      pendingUsernames,
      mixed: pending > 0 && published > 0,
    };
  } catch (err) {
    log.warn({ postId, err: err.message }, `[Pending] preflight ${postId}: ${err.message}`);
    return null;
  }
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

    const summary = await summarizePostForCancel(postId);
    if (summary && summary.total > 0 && summary.pending === 0) {
      markPostIdCancelled(postId);
      results.push({
        postId,
        ok: true,
        message:
          `tidak ada antrian pending (${summary.published} live` +
          (summary.failed ? `, ${summary.failed} gagal` : '') +
          ') — tidak perlu DELETE',
      });
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
      const message = err.message || String(err);
      results.push({
        postId,
        ok: false,
        message,
        summary: summary || undefined,
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
 * Draft email ke support@outstand.so (English).
 * @param {string[]} postIds
 */
export async function buildOutstandCancelSupportDraft(postIds) {
  const unique = [...new Set(postIds.filter(Boolean))];
  /** @type {Awaited<ReturnType<typeof summarizePostForCancel>>[]} */
  const summaries = [];
  for (const id of unique) {
    const s = await summarizePostForCancel(id);
    if (s) summaries.push(s);
  }

  const today = new Date().toISOString().slice(0, 10);
  const detailLines = summaries.map((s) => {
    const nets = (s.networks || [])
      .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
      .join(', ');
    let line = `- ${s.postId} (${nets || 'multi'}): ${s.published} published, ${s.pending} pending`;
    if (s.failed) line += `, ${s.failed} failed`;
    if (s.mixed) line += ' — mixed batch';
    return line;
  });

  const pendingSample = summaries
    .flatMap((s) =>
      (s.pendingUsernames || []).slice(0, 8).map((u) => `  • ${s.postId}: ${u}`)
    )
    .slice(0, 16);

  return (
    `Subject: Urgent — Cannot cancel queued posts (HTTP 500)\n\n` +
    `Hi Outstand Support,\n\n` +
    `We cannot cancel stuck publishing jobs via API. Every attempt to cancel returns HTTP 500.\n\n` +
    `Endpoint:\n` +
    `DELETE https://api.outstand.so/v1/posts/{id}\n\n` +
    `Error message:\n` +
    `"Failed to cancel scheduled post from publishing queue"\n\n` +
    `Affected Post IDs (as of ${today}):\n` +
    (detailLines.length ? detailLines.join('\n') : unique.map((id) => `- ${id}`).join('\n')) +
    `\n\n` +
    `These are mixed batches: some targets are already published while others remain pending. ` +
    `We only need to stop the remaining pending targets. Published content on the platforms should remain live.\n\n` +
    (pendingSample.length
      ? `Sample still-pending targets:\n${pendingSample.join('\n')}\n\n`
      : '') +
    `What we tried:\n` +
    `- DELETE /v1/posts/{id} via API (multiple retries)\n` +
    `- Dashboard cancel if available\n` +
    `- Bot /stop and /stop stuck flows\n\n` +
    `Request:\n` +
    `1) Please force-cancel / purge the remaining pending queue jobs for the Post IDs above.\n` +
    `2) If required, delete the Outstand post records without removing already-published platform posts.\n\n` +
    `Screenshots of the HTTP 500 responses are attached.\n\n` +
    `Thank you.`
  );
}

/**
 * @param {Array<{ postId: string, ok: boolean, message: string, summary?: object }>} results
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
    msg += `\n\n❌ Gagal ${fail.length}:`;
    for (const r of fail.slice(0, 8)) {
      const sum = r.summary;
      const extra =
        sum && sum.mixed
          ? ` (${sum.published} live · ${sum.pending} pending)`
          : '';
      msg += `\n• \`${r.postId}\`${extra}\n  ${r.message}`;
    }
  }
  const has500 = fail.some((r) => /500|HTTP 500/i.test(r.message));
  msg +=
    '\n\nRefresh: `/synctoday` · Cek status: `/status POST_ID`\n' +
    '_Post yang sudah live di IG/Threads tidak terhapus dari sini._';
  if (has500) {
    const ids = fail.map((r) => r.postId).filter(Boolean);
    const markHint = ids.length
      ? `\`/stop mark ${ids.slice(0, 4).join(' ')}\``
      : '`/stop mark POST_ID`';
    msg +=
      '\n\n💡 *HTTP 500* = server Outstand (bukan bot). API cancel tidak jalan.\n' +
      '• Dashboard: app.outstand.so → Posts (cancel manual)\n' +
      '• Draft email: `/stopsupport`\n' +
      `• Blok retry di bot (antrian Outstand bisa masih jalan): ${markHint}\n` +
      '• Jangan `/retry` sebelum antrian berhenti.';
  }
  return msg;
}

/**
 * @param {string[]} postIds
 */
export function formatLocalStopMarkResults(postIds) {
  markPostIdsStoppedLocally(postIds);
  return (
    `🛑 *Stop lokal* — ${postIds.length} Post ID ditandai dibatalkan di bot\n` +
    postIds.map((id) => `• \`${id}\``).join('\n') +
    '\n\n' +
    '_Bot akan blok `/retry` & republish untuk ID ini._\n' +
    '⚠️ *Antrian Outstand bisa tetap jalan* kalau API cancel 500 — cek profil & dashboard Outstand.\n\n' +
    'Refresh: `/synctoday`'
  );
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {Array<{ postId: string, ok: boolean }>} results
 */
export async function replyCancelResults(ctx, results) {
  await safeReply(ctx, formatCancelResults(results), { parse_mode: 'Markdown' });
  const failIds = results.filter((r) => !r.ok).map((r) => r.postId);
  if (!failIds.length) return;
  if (!results.some((r) => !r.ok && /500|HTTP 500/i.test(r.message))) return;
  try {
    const draft = await buildOutstandCancelSupportDraft(failIds);
    await replyTelegramLong(ctx, `📧 *Salin ke support@outstand.so:*\n\n\`\`\`\n${draft}\n\`\`\``);
  } catch (err) {
    log.warn({ err: err.message }, `[Pending] support draft: ${err.message}`);
  }
}
