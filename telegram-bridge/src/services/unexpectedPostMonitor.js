import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { getRuntime, setRuntime } from '../utils/runtimeStore.js';
import { createLogger } from '../utils/logger.js';
import { getPost, listRecentPostIds } from './outstand.js';
import { formatWibDateTime, getWibDayKey } from '../utils/wibTime.js';
import { safeSendMessage } from '../utils/telegramMarkdown.js';

const log = createLogger('unexpected-post');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const archiveDir = path.resolve(__dirname, '../../data/publish-archives');

/** Post ID yang sudah diketahui (dibuat oleh bot atau sudah dilaporkan). */
const knownPostIds = new Set();

/** @type {ReturnType<typeof setInterval> | null} */
let monitorTimer = null;
let initialized = false;

/**
 * Catat Post ID sebagai "milik bot" — supaya monitor tidak menganggapnya
 * sebagai post tak terduga. Panggil ini SEGERA setelah `publishBulk` return.
 *
 * @param {string | string[]} postIdOrIds
 */
export function markPostIdsKnown(postIdOrIds) {
  const ids = Array.isArray(postIdOrIds) ? postIdOrIds : [postIdOrIds];
  let added = false;
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id) continue;
    if (!knownPostIds.has(id)) {
      knownPostIds.add(id);
      added = true;
    }
  }
  if (added) persistKnownPostIds();
}

export function isPostIdKnown(postId) {
  return knownPostIds.has(String(postId || '').trim());
}

/** Persist known Post IDs ke runtime store (file). */
function persistKnownPostIds() {
  try {
    // Cap supaya tidak tumbuh tanpa batas. Simpan 5000 terakhir.
    const arr = [...knownPostIds];
    const tail = arr.length > 5000 ? arr.slice(-5000) : arr;
    setRuntime('knownPostIds', tail);
  } catch (err) {
    log.warn({ err: err.message }, '[Unexpected] persist failed');
  }
}

/** Seed dari publish archive (semua chat) + runtime store. */
function seedKnownPostIds() {
  if (initialized) return;
  initialized = true;

  // Dari runtime store
  try {
    const stored = getRuntime('knownPostIds');
    if (Array.isArray(stored)) {
      for (const id of stored) {
        if (typeof id === 'string' && id.trim()) knownPostIds.add(id.trim());
      }
    }
  } catch (err) {
    log.warn({ err: err.message }, '[Unexpected] read runtime failed');
  }

  // Dari publish archive (1 file per chat)
  try {
    if (fs.existsSync(archiveDir)) {
      const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(archiveDir, f), 'utf8');
          const parsed = JSON.parse(raw);
          const byPostId = parsed?.byPostId || {};
          for (const id of Object.keys(byPostId)) {
            if (id) knownPostIds.add(String(id).trim());
          }
          for (const id of parsed?.latest?.postIds || []) {
            if (id) knownPostIds.add(String(id).trim());
          }
        } catch {
          /* skip rusak */
        }
      }
    }
  } catch (err) {
    log.warn({ err: err.message }, '[Unexpected] seed archive failed');
  }

  log.info({ size: knownPostIds.size }, '[Unexpected] seeded known Post IDs');
}

const ESC_RE = /[_*`[\]]/g;
function esc(s) {
  return String(s || '').replace(ESC_RE, '\\$&');
}

/**
 * Kirim notifikasi Telegram untuk 1 Post ID yang tidak dikenal.
 *
 * @param {string} postId
 */
async function notifyUnexpectedPost(postId) {
  const chatId = getRuntime('notifyChatId');
  if (!chatId) return;

  const { getBot } = await import('./bot.js');
  const bot = getBot();
  if (!bot) return;

  let post;
  try {
    post = await getPost(postId);
  } catch (err) {
    log.warn({ postId, err: err.message }, '[Unexpected] getPost failed');
    return;
  }

  const accounts = post?.socialAccounts || [];
  const accountLines = accounts.slice(0, 10).map((a) => {
    const net = (a.network || '').toLowerCase();
    const user = (a.username || '').replace(/^@/, '');
    const status = a.status || 'pending';
    return `• *${net}* @${esc(user)} — ${status}`;
  });
  const more =
    accounts.length > 10 ? `\n_…+${accounts.length - 10} akun_` : '';

  const captionSnippet = post?.caption
    ? esc(String(post.caption).slice(0, 200))
    : '(tanpa caption)';
  const createdAt = formatWibDateTime(
    post?.createdAt || post?.scheduledAt || post?.publishedAt || new Date()
  );

  const msg =
    `🚨 *Post tak terduga terdeteksi di Outstand*\n\n` +
    `Post ID: \`${postId}\`\n` +
    `Dibuat: ${createdAt}\n` +
    `Akun terlibat: *${accounts.length}*\n\n` +
    `Caption:\n_${captionSnippet}${(post?.caption || '').length > 200 ? '…' : ''}_\n\n` +
    accountLines.join('\n') +
    more +
    `\n\n💡 *Mungkin penyebab:*\n` +
    `• Publish dari Outstand UI / app lain (API key sama)\n` +
    `• Scheduled post lama yang baru jalan\n` +
    `• Integrasi pihak ketiga menggunakan kredensial Anda\n\n` +
    `🛑 Batalkan kalau bukan Anda: \`/stop\` lalu pilih batch ini\n` +
    `Atau cek dashboard Outstand.`;

  try {
    await safeSendMessage(bot.telegram, chatId, msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
    log.info({ postId, accounts: accounts.length }, '[Unexpected] notified');
  } catch (err) {
    log.warn({ postId, err: err.message }, '[Unexpected] notify failed');
  }
}

/**
 * Scan Outstand untuk Post ID baru yang tidak dikenal, lalu notifikasi.
 * Catatan: run pertama setelah startup hanya "seed" — tidak kirim notifikasi
 * supaya tidak spam Telegram saat bot baru restart.
 */
let isFirstRun = true;
export async function checkForUnexpectedPosts() {
  seedKnownPostIds();

  const daysBack = Math.max(
    1,
    Number(env.unexpectedPostScanDays || 2) || 2
  );

  let recentIds = [];
  try {
    recentIds = await listRecentPostIds({ daysBack });
  } catch (err) {
    log.warn({ err: err.message }, '[Unexpected] listRecentPostIds failed');
    return;
  }

  /** @type {string[]} */
  const unknown = [];
  for (const id of recentIds) {
    if (!knownPostIds.has(id)) unknown.push(id);
  }

  if (isFirstRun) {
    // Run pertama: anggap semua sudah "diketahui" (history yang ada saat bot start).
    for (const id of unknown) knownPostIds.add(id);
    persistKnownPostIds();
    isFirstRun = false;
    log.info(
      { seeded: unknown.length, total: knownPostIds.size },
      '[Unexpected] first run — silently seeded',
    );
    return;
  }

  if (!unknown.length) return;

  log.warn(
    { count: unknown.length, sample: unknown.slice(0, 5) },
    `[Unexpected] ${unknown.length} Post ID baru tidak dikenal — kirim notifikasi`,
  );

  // Cap notifikasi sekali jalan supaya tidak spam Telegram.
  const cap = 5;
  for (const id of unknown.slice(0, cap)) {
    await notifyUnexpectedPost(id);
    knownPostIds.add(id);
  }
  // Sisanya tandai known tanpa kirim notif (kalau >5 sekaligus, kemungkinan besar bukan masalah baru).
  for (const id of unknown.slice(cap)) knownPostIds.add(id);

  if (unknown.length > cap) {
    const chatId = getRuntime('notifyChatId');
    const { getBot } = await import('./bot.js');
    const bot = getBot();
    if (chatId && bot) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          `🚨 ${unknown.length} Post ID baru tak terduga terdeteksi (5 contoh dikirim di atas, sisanya: ${unknown.slice(cap, cap + 10).join(', ')}${unknown.length > cap + 10 ? '…' : ''}).\nCek dashboard Outstand & jalankan /stop ${daysBack}d untuk lihat batch pending.`,
        );
      } catch {
        /* ignore */
      }
    }
  }

  persistKnownPostIds();
}

/**
 * Mulai loop monitor: scan tiap N menit (default 10, atur via
 * `UNEXPECTED_POST_MONITOR_MINUTES`). Set 0 untuk matikan.
 */
export function startUnexpectedPostMonitorLoop() {
  const minutes = Math.max(0, Number(env.unexpectedPostMonitorMinutes || 10) || 10);
  if (!minutes || monitorTimer) return;

  seedKnownPostIds();

  // Run pertama setelah delay singkat (agar bot.js sudah init telegram).
  setTimeout(() => {
    checkForUnexpectedPosts().catch((err) =>
      log.warn({ err: err.message }, `[Unexpected] first check: ${err.message}`),
    );
  }, 30_000);

  monitorTimer = setInterval(() => {
    checkForUnexpectedPosts().catch((err) =>
      log.warn({ err: err.message }, `[Unexpected] loop: ${err.message}`),
    );
  }, minutes * 60_000);

  log.info(
    { minutes },
    `[Unexpected] Monitor aktif — scan post tak terduga tiap ${minutes} menit`,
  );
}

export function stopUnexpectedPostMonitorLoop() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
