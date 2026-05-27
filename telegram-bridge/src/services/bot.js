import { Telegraf, Markup } from 'telegraf';
import { env } from '../config/env.js';
import { formatWibDateTime, getWibDayKey, nowIsoUtc } from '../utils/wibTime.js';
import {
  listMediaInFolder,
  pickDriveMediaForWibDay,
  resolveDriveEntry,
  getFolderMeta,
} from './drive.js';
import { extractDriveLinkFromText } from '../utils/driveId.js';
import { generateCaption, generateCaptionsByNetwork } from './ai.js';
import {
  listSocialAccounts,
  publishBulk,
  uploadMediaForTargets,
  waitForPostsSettled,
  getPost,
  fetchCaptionFromPostIds,
} from './outstand.js';
import { isImageToVideoNetwork, getDurationForNetwork } from './imageToVideo.js';
import {
  buildCaptionsByNetwork,
  buildYoutubePostFields,
  getMinCharLimitForNetworks,
  getTightestPlatform,
  YOUTUBE_TITLE_MAX,
  YOUTUBE_DESCRIPTION_MAX,
} from './captionPlatforms.js';
import {
  getSession,
  resetSession,
  updateSession,
  setSessionMediaFiles,
  clearSessionContent,
  getStaleMediaReason,
} from '../utils/session.js';
import { ensureSpreadsheetReady } from './spreadsheetSetup.js';
import {
  recordPublishResultsToSheet,
  refreshPublishResultsInSheet,
  scheduleSheetRefresh,
  fetchPublishAccountStatuses,
  getDailyTabName,
  readLatestPostIdsFromDailyTab,
  readPostIdsFromDailyTab,
} from './sheets.js';
import {
  savePublishArchive,
  loadPublishArchive,
  hydrateMediaFromArchive,
  getArchiveStaleReason,
} from './publishArchive.js';
import {
  listPendingToday,
  listPendingRecent,
  groupPendingByPostId,
  cancelPendingPostIds,
  formatPendingReport,
  formatCancelResults,
  isPostIdCancelled,
} from './pendingControl.js';
import {
  collectTodayPublishLinks,
  syncTodayToSheet,
  getPublishedAccountIdsToday,
  getTouchedAccountIdsToday,
  getTodayAccountUsageCounts,
  clearPublishedTodayCache,
} from './todayPublish.js';
import {
  buildDailyQuotaStatus,
  clearQuotaCache,
  formatDailyQuotaReport,
  formatDailyQuotaCompact,
} from './dailyQuota.js';
import {
  summarizePublishResults,
  formatTelegramPublishReport,
  formatPublishLinksReport,
  replyTelegramLong,
} from './publishResult.js';
import { validateBeforePublish, buildPublishPreviewText } from './validatePublish.js';
import { parseScheduleInput, formatScheduleHelp } from '../utils/scheduleParse.js';
import { CAPTION_TONES, getToneLabel } from '../config/captionTones.js';
import {
  looksLikeMissionBroadcast,
  parseMissionBroadcast,
  formatMissionSummary,
} from '../utils/missionParse.js';
import {
  downloadTelegramFile,
  extractTelegramMedia,
} from './telegramMedia.js';
import {
  escapeMarkdown,
  safeReply,
  safeSendMessage,
} from '../utils/telegramMarkdown.js';
import {
  buildIdempotencyKey,
  captionsDigest,
  shortKey,
} from '../utils/idempotency.js';
import {
  looksLikeRandomPick,
  parseRandomPickCommand,
  pickRandomAccounts,
  formatRandomPickHelp,
  parseNetworkFilter,
  getNetworkShortLabel,
} from '../utils/randomAccountPick.js';
import {
  annotateAccountsWithDayAttempts,
  buildDuplicateAccountSummary,
} from '../utils/accountDayUsage.js';
import {
  applyRetrySafetyFilter,
  parseRetryCommand,
  buildRetryPlan,
  formatRetryPlanReport,
  collectRetryAccountIds,
  filterRetryIdsByUsernames,
  formatRetryBlockedNotice,
} from '../utils/retryPublish.js';
import {
  computePublishPollPlan,
  formatPollWaitHint,
  formatLargeBatchFollowUp,
} from '../utils/publishPoll.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('bot');

/** @type {import('telegraf').Telegraf<Context> | null} */
let botInstance = null;

/** @type {Map<string, number>} */
const notifyChats = new Map();

export function getBot() {
  return botInstance;
}

export function registerNotifyChat(key, chatId) {
  if (chatId) {
    notifyChats.set(key, chatId);
    if (key === 'default') {
      import('../utils/runtimeStore.js').then(({ setRuntime }) => {
        setRuntime('notifyChatId', String(chatId));
      }).catch(() => {});
    }
  }
}

export function getNotifyChat(key = 'default') {
  return notifyChats.get(key);
}

/** Jawab tombol inline segera (hindari "query is too old"). */
async function ack(ctx, text) {
  try {
    await ctx.answerCbQuery(text ? { text } : undefined);
  } catch {
    /* callback kedaluwarsa — abaikan */
  }
}

/**
 * Format notice untuk user kalau session.mediaFiles dianggap basi (hari beda /
 * tidak ber-timestamp / lebih tua dari batas umur).
 * @param {ReturnType<typeof import('../utils/session.js').getStaleMediaReason>} stale
 * @param {import('../utils/session.js').PublishSession} session
 */
function formatStaleMediaNotice(stale, session) {
  if (!stale) return '';
  const setAtWib = stale.setAt ? formatWibDateTime(stale.setAt) : '';
  const folder = session?.mediaSourceLabel || session?.folderName || '(tidak diketahui)';
  const fileCount = session?.mediaFiles?.length || 0;
  const fileSample = (session?.mediaFiles || [])
    .slice(0, 3)
    .map((f) => `_${String(f.name || 'media').replace(/[_*`[\]]/g, '\\$&')}_`)
    .join(', ');
  const tailNote =
    fileCount > 3 ? ` …(+${fileCount - 3} lagi)` : '';

  let head;
  if (stale.reason === 'day-changed') {
    head =
      `🛑 *Media basi — hari sudah berganti.*\n` +
      `Konten terakhir di-load: *${stale.prevDay}* (sekarang ${stale.todayDay}).`;
  } else if (stale.reason === 'too-old') {
    const ageH = stale.ageHours?.toFixed(1) ?? '?';
    head =
      `🛑 *Media basi — sudah lebih dari ${ageH} jam yang lalu.*`;
  } else if (stale.reason === 'no-timestamp') {
    head =
      `🛑 *Media sesi tidak punya stempel waktu* (kemungkinan tersisa dari sesi sebelum update).`;
  } else {
    head = '🛑 *Media basi.*';
  }

  return (
    `${head}\n\n` +
    `📁 *Sumber tersimpan:* ${folder}\n` +
    (setAtWib ? `🕒 *Di-load pukul:* ${setAtWib}\n` : '') +
    (fileCount
      ? `📄 *Daftar (${fileCount}):* ${fileSample}${tailNote}\n`
      : '') +
    `\nSesi konten saya kosongkan untuk mencegah salah upload.\n` +
    `Ketik */publish* dan kirim link folder Drive *hari ini* (atau foto/video langsung), baru pilih akun.`
  );
}

/**
 * Bangun blok preview daftar media yang akan ter-publish.
 * @param {import('../utils/session.js').PublishSession} session
 * @param {{ max?: number }} [opts]
 */
function formatMediaListPreview(session, opts = {}) {
  const files = session?.mediaFiles || [];
  if (!files.length) return '';
  const max = opts.max ?? 8;
  const lines = files.slice(0, max).map((f, i) => {
    const name = String(f.name || 'media').replace(/[_*`[\]]/g, '\\$&');
    const kind = f.mimeType?.startsWith('video/') ? '🎬' : '🖼';
    return `${i + 1}. ${kind} _${name}_`;
  });
  if (files.length > max) {
    lines.push(`…(+${files.length - max} file lagi)`);
  }
  const folder = session.mediaSourceLabel || session.folderName || '';
  const setAtWib = session.mediaFilesSetAt
    ? formatWibDateTime(session.mediaFilesSetAt)
    : '';
  const folderLine = folder ? `📁 *${escapeMarkdown(folder)}*\n` : '';
  const setAtLine = setAtWib ? `🕒 Di-load: ${setAtWib}\n` : '';
  return (
    `📄 *Konten yang akan ter-publish (${files.length}):*\n` +
    folderLine +
    setAtLine +
    lines.join('\n')
  );
}

function isAllowed(ctx) {
  if (!env.telegramAllowedChatIds.length) return true;
  const chatId = String(ctx.chat?.id ?? '');
  return env.telegramAllowedChatIds.includes(chatId);
}

async function guard(ctx, next) {
  if (!isAllowed(ctx)) {
    await ctx.reply('⛔ Chat ini tidak diizinkan menggunakan bot ini.');
    return;
  }
  return next();
}

const NETWORK_LABELS = {
  youtube: '📺 YouTube',
  instagram: '📸 Instagram',
  facebook: '📘 Facebook',
  tiktok: '🎵 TikTok',
  threads: '🧵 Threads',
  x: '𝕏 X',
  twitter: '𝕏 X',
  linkedin: '💼 LinkedIn',
  pinterest: '📌 Pinterest',
};

const MENU = {
  PUBLISH: '📤 Publish',
  SHEET: '📊 Laporan Sheets',
  CANCEL: '❌ Batal',
  HELP: 'ℹ️ Menu / Bantuan',
};

function mainMenuKeyboard() {
  return Markup.keyboard([
    [MENU.PUBLISH, MENU.SHEET],
    [MENU.CANCEL, MENU.HELP],
  ]).resize();
}

async function showMainMenu(ctx, extraText = '') {
  const text =
    (extraText ? `${extraText}\n\n` : '') +
    '👋 *SMM Pro Publish Bot*\n\n' +
    'Pilih tombol di bawah (tidak perlu ketik perintah):\n' +
    `• ${MENU.PUBLISH} — mulai upload\n` +
    `• ${MENU.SHEET} — buka laporan Google Sheets\n` +
    `• ${MENU.CANCEL} — batalkan sesi\n` +
    `• ${MENU.HELP} — panduan singkat\n\n` +
    'Kirim *broadcast misi* (§1–2–5) → lalu link Drive atau foto/video.\n' +
    'Perintah: /publish · /stop · /retry · /kuota · /linkshari · /synctoday · /refresh · /stuck · /links · /status · /misi\n\n' +
    '💡 *Tip*: `/linkshari ig` → cuma link IG · `/linkshari fb` → cuma FB · `/linkshari ig fb` → IG+FB.';

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainMenuKeyboard() });
}

async function handleSheetCommand(ctx) {
  try {
    const { id, url } = await ensureSpreadsheetReady();
    await ctx.reply(`📊 Spreadsheet laporan:\n${url}\n\nID: ${id}`, mainMenuKeyboard());
  } catch (err) {
    await ctx.reply(`❌ ${err.message}`, mainMenuKeyboard());
  }
}

async function handleCancelCommand(ctx) {
  resetSession(ctx.chat.id);
  await showMainMenu(ctx, '✅ Sesi dibatalkan.');
}

function actionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('👁 Preview', 'action:preview'),
      Markup.button.callback('🚀 Send Now', 'action:send'),
    ],
    [
      Markup.button.callback('📅 Schedule', 'action:schedule'),
      Markup.button.callback('✍️ Edit Caption', 'action:edit'),
    ],
    [
      Markup.button.callback('🎯 Ganti target', 'target:change'),
      Markup.button.callback('🎨 Gaya caption', 'tone:change'),
    ],
  ]);
}

function scheduleKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('+1 jam', 'sched:+1 jam'),
      Markup.button.callback('+3 jam', 'sched:+3 jam'),
    ],
    [
      Markup.button.callback('Besok 09:00', 'sched:besok 09:00'),
      Markup.button.callback('✍️ Ketik manual', 'sched:manual'),
    ],
    [Markup.button.callback('« Batal jadwal', 'sched:cancel')],
  ]);
}

function tonePickerKeyboard() {
  const rows = Object.entries(CAPTION_TONES).map(([key, t]) => [
    Markup.button.callback(t.label, `tone:${key}`),
  ]);
  rows.push([Markup.button.callback('⏭ Lewati (default)', 'tone:skip')]);
  return Markup.inlineKeyboard(rows);
}

async function showTonePicker(ctx, label) {
  await safeReply(
    ctx,
    `🎨 *Gaya caption* untuk *${escapeMarkdown(label)}*\n\nPilih tone AI (bisa diubah lagi nanti):`,
    { parse_mode: 'Markdown', ...tonePickerKeyboard() }
  );
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string[]} accountIds
 * @param {string} label
 * @param {string[]} networks
 */
async function showReadyPreview(ctx, accountIds, label, networks) {
  const session = getSession(ctx.chat.id);
  const caption = session.caption || '';
  const { network: tightestNet, limit: minLimit } = getTightestPlatform(networks);
  const tightestLabel = NETWORK_LABELS[tightestNet] || tightestNet;
  const onlyYoutube = networks.length === 1 && networks[0] === 'youtube';
  const captionsByNetwork =
    session.captionsByNetwork || buildCaptionsByNetwork(caption, networks);

  let preview =
    `✅ *${escapeMarkdown(label)}* — ${accountIds.length} akun · ${networks.length} platform\n`;
  if (session.captionTone) {
    preview += `Gaya: ${escapeMarkdown(getToneLabel(session.captionTone))}\n`;
  }

  // Daftar konten yang akan ter-publish — biar user bisa lihat dan
  // sigap membatalkan kalau folder Drive berisi file salah/lama.
  const mediaBlock = formatMediaListPreview(session);
  if (mediaBlock) {
    preview += `\n${mediaBlock}\n`;
  }

  preview += onlyYoutube
    ? '\n*YouTube — judul & deskripsi terpisah:*\n'
    : `\n*Caption berbeda per platform* (bukan copy-paste):\n`;

  for (const net of networks.sort()) {
    const labelNet = NETWORK_LABELS[net] || net;
    if (net === 'youtube') {
      const yt =
        session.youtubeFields || buildYoutubePostFields(captionsByNetwork.youtube || caption);
      preview +=
        `\n${labelNet}\n` +
        `*Judul* (${yt.title.length}/${YOUTUBE_TITLE_MAX}):\n${escapeMarkdown(yt.title)}\n\n` +
        `*Deskripsi* (${yt.description.length}/${YOUTUBE_DESCRIPTION_MAX}):\n${escapeMarkdown(yt.description)}\n`;
      if (yt.tags.length) {
        preview += `\n_Tag:_ ${escapeMarkdown(yt.tags.join(', '))}\n`;
      }
    } else {
      const cap = captionsByNetwork[net] || '';
      const platLimit = getMinCharLimitForNetworks([net]);
      preview += `\n${labelNet} (${cap.length}/${platLimit}):\n${escapeMarkdown(cap)}\n`;
    }
  }
  if (preview.length > 3900) preview = `${preview.slice(0, 3900)}…`;

  await safeReply(ctx, preview, { parse_mode: 'Markdown', ...actionKeyboard() });
}

async function generateCaptionAndShowPreview(ctx, accountIds, label, networks) {
  const session = getSession(ctx.chat.id);
  const { limit: minLimit } = getTightestPlatform(networks);
  const onlyYoutube = networks.length === 1 && networks[0] === 'youtube';

  await safeReply(
    ctx,
    onlyYoutube
      ? `⏳ Membuat *judul* & *deskripsi* YouTube…`
      : `⏳ Membuat caption untuk *${escapeMarkdown(label)}*…\nLimit: *${minLimit}* karakter` +
          (session.captionTone
            ? ` · gaya: ${escapeMarkdown(getToneLabel(session.captionTone))}`
            : ''),
    { parse_mode: 'Markdown' }
  );

  const themeLabel = [session.folderName, session.driveRootName]
    .filter((n) => n && n !== '.' && n.trim())
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .join(' — ') || 'Konten';

  const { baseCaption, captionsByNetwork, youtubeFields } =
    await generateCaptionsByNetwork({
      folderName: themeLabel,
      mediaFiles: session.mediaFiles,
      targetNetworks: networks,
      tone: session.captionTone,
      missionBriefing: session.missionBriefing,
    });

  const caption = baseCaption;

  const onlyImages = session.mediaFiles.every((f) =>
    f.mimeType?.startsWith('image/')
  );
  const reelTargets = networks.filter((n) => isImageToVideoNetwork(n));
  if (reelTargets.length && onlyImages && !env.imageToVideoAudioPath) {
    await ctx.reply(
      env.imageToVideoAllowSilent
        ? `ℹ️ ${reelTargets.map((n) => NETWORK_LABELS[n] || n).join(', ')}: gambar→video *tanpa musik*.`
        : `⚠️ Gambar→video butuh MP3 di \`assets/audio/\`.`,
      { parse_mode: 'Markdown' }
    );
  }

  updateSession(ctx.chat.id, {
    caption,
    captionsByNetwork,
    youtubeFields: youtubeFields || undefined,
    step: 'ready',
  });
  await showReadyPreview(ctx, accountIds, label, networks);
}

function groupAccountsByNetwork(accounts) {
  /** @type {Record<string, typeof accounts>} */
  const byNet = {};
  for (const a of accounts) {
    const net = (a.network || 'unknown').toLowerCase();
    if (!byNet[net]) byNet[net] = [];
    byNet[net].push(a);
  }
  return byNet;
}

/**
 * Platform terpilih yang akan dapat gambar→video (jika konten hanya gambar).
 * @param {string[]} socialAccountIds
 */
async function getImageToVideoTargets(socialAccountIds) {
  const accounts = await listSocialAccounts();
  const selected = accounts.filter((a) => socialAccountIds.includes(a.id));
  const nets = [
    ...new Set(
      selected.map((a) => (a.network || '').toLowerCase()).filter(Boolean)
    ),
  ];
  return nets.filter((n) => isImageToVideoNetwork(n));
}

async function showTargetPicker(ctx) {
  const accounts = await listSocialAccounts();
  if (!accounts.length) {
    await ctx.reply(
      'Belum ada akun di Outstand.\nHubungkan dulu di dashboard → Social Accounts.'
    );
    return;
  }

  updateSession(ctx.chat.id, { step: 'selecting_targets' });

  const rows = [
    [
      Markup.button.callback(
        `🌐 Semua akun (${accounts.length})`,
        'target:all'
      ),
    ],
    [
      Markup.button.callback(
        '☑️ Pilih beberapa (lintas platform)',
        'target:multi'
      ),
    ],
    [Markup.button.callback('🎲 Acak per platform (ketik jumlah)', 'target:random')],
  ];

  const byNet = groupAccountsByNetwork(accounts);
  for (const [net, list] of Object.entries(byNet).sort(([a], [b]) => a.localeCompare(b))) {
    const label = NETWORK_LABELS[net] || `📡 ${net}`;
    rows.push([
      Markup.button.callback(
        `${label} — pilih akun (${list.length})`,
        `netpick:${net}`
      ),
    ]);
  }

  await ctx.reply(
    '🎯 Pilih target publish:\n' +
      '• *Semua akun* — satu tombol\n' +
      '• *Pilih beberapa* — centang manual\n' +
      '• *Acak* — ketik mis. `ig 22 fb 22` (22 IG + 22 FB acak)',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  );
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 */
function markAccountsUsedForToday(chatId, accountIds) {
  const tab = getDailyTabName();
  const session = getSession(chatId);
  if (session.usedAccountsTab !== tab) {
    updateSession(chatId, { usedAccountsTab: tab, usedAccountIdsToday: [] });
  }
  const prev = getSession(chatId).usedAccountIdsToday || [];
  updateSession(chatId, {
    usedAccountIdsToday: [...new Set([...prev, ...accountIds])],
    usedAccountsTab: tab,
  });
}

async function getExcludeIdsForRandomPick(chatId) {
  const session = getSession(chatId);
  const tab = getDailyTabName();
  /** @type {string[]} */
  let exclude = [];
  if (session.usedAccountsTab === tab && session.usedAccountIdsToday?.length) {
    exclude = [...session.usedAccountIdsToday];
  }
  try {
    const published = await getTouchedAccountIdsToday();
    exclude = [...new Set([...exclude, ...published])];
  } catch (err) {
    log.warn({ err: err.message }, `[Bot] exclude published today: ${err.message}`);
  }
  return exclude;
}

async function handleRandomAccountPick(ctx, text) {
  const forceRe = /\b(force|ulang|paksa|all)\b/i;
  const force = forceRe.test(text);
  const cleanText = text.replace(forceRe, '').trim();

  const parsed = parseRandomPickCommand(cleanText);
  if (!parsed?.counts || !Object.keys(parsed.counts).length) {
    await safeReply(ctx, formatRandomPickHelp(), { parse_mode: 'Markdown' });
    return;
  }

  // Anti-stale guard: tolak kalau session.mediaFiles dari hari sebelumnya,
  // tidak ber-timestamp, atau sudah lebih tua dari batas umur (default 6 jam).
  // Skenario yang dicegah: bot tidak pernah restart, user lupa /publish ulang,
  // tetapi langsung `/random ig 22` → upload konten kemarin ke akun acak hari ini.
  const session = getSession(ctx.chat.id);
  const stale = getStaleMediaReason(session);
  if (stale && stale.reason !== 'no-media') {
    await safeReply(ctx, formatStaleMediaNotice(stale, session), {
      parse_mode: 'Markdown',
    });
    clearSessionContent(ctx.chat.id);
    updateSession(ctx.chat.id, { step: 'awaiting_media' });
    return;
  }

  if (!session.mediaFiles?.length) {
    await safeReply(
      ctx,
      '❌ Belum ada media di sesi.\n\n' +
        'Ketik */publish* dulu, lalu kirim link folder Drive *hari ini* (atau foto/video langsung).',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await safeReply(
    ctx,
    force
      ? '⏳ Memilih akun acak (mode *force* — termasuk yang sudah post hari ini)…'
      : '⏳ Memilih akun acak (lewati yang sudah post hari ini)…',
    { parse_mode: 'Markdown' }
  );

  const accounts = await listSocialAccounts();
  const exclude = force ? [] : await getExcludeIdsForRandomPick(ctx.chat.id);
  const result = pickRandomAccounts(accounts, parsed.counts, {
    excludeAccountIds: exclude,
    maxReusePerAccount: env.maxReusePerAccount,
  });

  if (!result.accountIds.length) {
    const suggestForce = !force && exclude.length > 0;
    const baseMsg =
      '❌ Tidak ada akun yang bisa dipilih.\n\n' +
      (result.warnings.length
        ? result.warnings.join('\n')
        : 'Cek koneksi Outstand.');
    const escBackticks = (s) => String(s || '').replace(/`/g, '');
    const forceHint = suggestForce
      ? `\n\n🔥 Mau *paksa* tetap pilih (post 2× ke akun yang sama)?\nKetik ulang dengan keyword \`force\`:\n\`${escBackticks(cleanText)} force\``
      : '';
    await safeReply(ctx, baseMsg + forceHint, { parse_mode: 'Markdown' });
    return;
  }

  const escUser = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');
  const sample = result.picked
    .slice(0, 8)
    .map((a) => `@${escUser((a.username || a.id).replace(/^@/, ''))}`)
    .join(', ');

  const uniqueCount = new Set(result.accountIds).size;
  let msg =
    `🎲 *Akun terpilih (acak)*\n` +
    `${result.label}\n` +
    `Unik: ${uniqueCount} akun` +
    (result.accountIds.length > uniqueCount
      ? ` · ${result.accountIds.length - uniqueCount} pengulangan (maks 2×/akun)`
      : '') +
    (force
      ? `\n⚡ _Mode *force* — termasuk akun yang sudah post hari ini._`
      : exclude.length
        ? `\n_Lewati ${exclude.length} akun yang sudah dipakai / sudah live hari ini._`
        : '') +
    (sample ? `\nContoh: ${sample}${result.picked.length > 8 ? '…' : ''}` : '');

  if (result.warnings.length) {
    msg += `\n\n⚠️ ${result.warnings.join('\n')}`;
  }

  await safeReply(ctx, msg, { parse_mode: 'Markdown' });
  updateSession(ctx.chat.id, { step: 'selecting_targets' });
  await finalizeTargetSelection(ctx, result.accountIds, result.label);
}

/**
 * @param {string} network
 * @param {Array<{ id: string, username?: string }>} accounts
 * @param {Set<string>} selected
 */
function buildAccountPickerKeyboard(network, accounts, selected) {
  const label = NETWORK_LABELS[network] || network;
  const rows = [
    [
      Markup.button.callback(
        `✅ Semua ${label} (${accounts.length})`,
        `netall:${network}`
      ),
    ],
  ];

  for (const a of accounts) {
    const name = (a.username || a.id).replace(/^@/, '').slice(0, 26);
    const mark = selected.has(a.id) ? '✅' : '☐';
    rows.push([
      Markup.button.callback(`${mark} ${name}`, `accttog:${a.id}`),
    ]);
  }

  if (selected.size > 0) {
    rows.push([
      Markup.button.callback(
        `📤 Selesai (${selected.size} akun)`,
        `acctdone:${network}`
      ),
    ]);
  }

  rows.push([Markup.button.callback('« Kembali', 'target:back')]);
  return Markup.inlineKeyboard(rows);
}

function accountPickerMessage(network, selectedSize, total) {
  const label = NETWORK_LABELS[network] || network;
  return (
    `${label} — pilih akun:\n` +
    `• Ketuk baris untuk centang / hapus centang (bisa *beberapa* akun)\n` +
    `• *Semua* = langsung semua akun platform ini\n` +
    `• *Selesai* muncul setelah minimal 1 akun tercentang\n\n` +
    `Terpilih: ${selectedSize} / ${total}`
  );
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} network
 * @param {{ edit?: boolean }} [options]
 */
async function showNetworkAccountPicker(ctx, network, options = {}) {
  const accounts = await listSocialAccounts();
  const filtered = accounts.filter((a) => (a.network || '').toLowerCase() === network);
  if (!filtered.length) {
    await ctx.reply('Tidak ada akun di platform ini.');
    return;
  }

  const session = getSession(ctx.chat.id);
  const selected = new Set(
    options.edit && session.accountPickNetwork === network
      ? session.accountPickSelected || []
      : []
  );

  updateSession(ctx.chat.id, {
    step: 'selecting_accounts',
    accountPickNetwork: network,
    accountPickSelected: [...selected],
  });

  const text = accountPickerMessage(network, selected.size, filtered.length);
  const keyboard = buildAccountPickerKeyboard(network, filtered, selected);

  if (options.edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, keyboard);
      return;
    } catch {
      /* fallback */
    }
  }

  await ctx.reply(text, keyboard);
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function refreshAccountPicker(ctx) {
  const session = getSession(ctx.chat.id);
  const network = session.accountPickNetwork;
  if (!network) return;

  const accounts = await listSocialAccounts();
  const filtered = accounts.filter(
    (a) => (a.network || '').toLowerCase() === network
  );
  const selected = new Set(session.accountPickSelected || []);
  const text = accountPickerMessage(network, selected.size, filtered.length);
  const keyboard = buildAccountPickerKeyboard(network, filtered, selected);

  try {
    await ctx.editMessageText(text, keyboard);
  } catch (err) {
    if (!String(err.message).includes('message is not modified')) {
      throw err;
    }
  }
}

async function finalizeTargetSelection(ctx, accountIds, label) {
  await ack(ctx);
  const session = getSession(ctx.chat.id);
  const allAccounts = await listSocialAccounts();
  const uniqueIds = [...new Set(accountIds)];
  const selected = allAccounts.filter((a) => uniqueIds.includes(a.id));
  const networks = [
    ...new Set(
      selected.map((a) => (a.network || '').toLowerCase()).filter(Boolean)
    ),
  ];

  if (!session.mediaFiles?.length) {
    await ctx.reply('Sesi media hilang. Ketik /publish lagi.');
    return;
  }

  updateSession(ctx.chat.id, {
    selectedAccountIds: accountIds,
    targetLabel: label,
    step: 'selecting_tone',
  });

  if (session.caption) {
    const captionsByNetwork = buildCaptionsByNetwork(session.caption, networks);
    updateSession(ctx.chat.id, { captionsByNetwork, step: 'ready' });
    await showReadyPreview(ctx, accountIds, label, networks);
    return;
  }

  await showTonePicker(ctx, label);
}

async function showGlobalAccountPicker(ctx) {
  const accounts = await listSocialAccounts();
  if (!accounts.length) {
    await ctx.reply('Belum ada akun di Outstand.');
    return;
  }

  const session = getSession(ctx.chat.id);
  const selected = new Set(session.accountPickSelected || []);

  updateSession(ctx.chat.id, {
    step: 'selecting_accounts',
    accountPickNetwork: '__multi__',
    accountPickSelected: [...selected],
  });

  const rows = accounts.map((a) => {
    const net = (a.network || '').toLowerCase();
    const netShort = (NETWORK_LABELS[net] || net).replace(/[^\w\s]/g, '').slice(0, 4);
    const name = (a.username || a.id).replace(/^@/, '').slice(0, 22);
    const mark = selected.has(a.id) ? '✅' : '☐';
    return [
      Markup.button.callback(`${mark} ${netShort} ${name}`, `accttog:${a.id}`),
    ];
  });

  if (selected.size > 0) {
    rows.push([
      Markup.button.callback(
        `📤 Selesai (${selected.size} akun)`,
        'acctdone:__multi__'
      ),
    ]);
  }
  rows.push([Markup.button.callback('« Kembali', 'target:back')]);

  await ctx.reply(
    `☑️ *Pilih akun* (boleh lintas platform)\nTerpilih: ${selected.size} / ${accounts.length}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  );
}

async function refreshGlobalAccountPicker(ctx) {
  const session = getSession(ctx.chat.id);
  if (session.accountPickNetwork !== '__multi__') {
    return refreshAccountPicker(ctx);
  }

  const accounts = await listSocialAccounts();
  const selected = new Set(session.accountPickSelected || []);
  const rows = accounts.map((a) => {
    const net = (a.network || '').toLowerCase();
    const netShort = (NETWORK_LABELS[net] || net).replace(/[^\w\s]/g, '').slice(0, 4);
    const name = (a.username || a.id).replace(/^@/, '').slice(0, 22);
    const mark = selected.has(a.id) ? '✅' : '☐';
    return [
      Markup.button.callback(`${mark} ${netShort} ${name}`, `accttog:${a.id}`),
    ];
  });
  if (selected.size > 0) {
    rows.push([
      Markup.button.callback(
        `📤 Selesai (${selected.size} akun)`,
        'acctdone:__multi__'
      ),
    ]);
  }
  rows.push([Markup.button.callback('« Kembali', 'target:back')]);

  const text = `☑️ *Pilih akun* (lintas platform)\nTerpilih: ${selected.size} / ${accounts.length}`;
  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows),
    });
  } catch (err) {
    if (!String(err.message).includes('message is not modified')) throw err;
  }
}

const FILES_PER_PAGE = 8;

function mediaIcon(mimeType) {
  if (mimeType?.startsWith('video/')) return '🎬';
  if (mimeType?.startsWith('image/')) return '🖼';
  return '📄';
}

/**
 * Tombol pilih konten — satu file atau semua (+ halaman jika banyak file).
 * @param {Awaited<ReturnType<typeof resolveDriveEntry>>} entry
 * @param {number} [page]
 */
function contentChoiceKeyboard(entry, page = 0) {
  const rows = [];

  for (const f of entry.subfolders) {
    rows.push([
      Markup.button.callback(
        `📁 ${(f.name || 'Folder').slice(0, 42)}`,
        `folder:${f.id}`
      ),
    ]);
  }

  if (entry.media.length === 1) {
    const m = entry.media[0];
    rows.push([
      Markup.button.callback(
        `${mediaIcon(m.mimeType)} ${(m.name || 'Media').slice(0, 40)}`,
        `file:${m.id}`
      ),
    ]);
  } else if (entry.media.length > 1) {
    rows.push([
      Markup.button.callback(
        `📦 Semua file (${entry.media.length})`,
        `pack:${entry.id}`
      ),
    ]);

    const sorted = [...entry.media].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );
    const totalPages = Math.ceil(sorted.length / FILES_PER_PAGE);
    const slice = sorted.slice(
      page * FILES_PER_PAGE,
      (page + 1) * FILES_PER_PAGE
    );

    for (let i = 0; i < slice.length; i++) {
      const m = slice[i];
      const num = page * FILES_PER_PAGE + i + 1;
      rows.push([
        Markup.button.callback(
          `${mediaIcon(m.mimeType)} ${num}. ${(m.name || 'media').slice(0, 36)}`,
          `file:${m.id}`
        ),
      ]);
    }

    if (totalPages > 1) {
      const nav = [];
      if (page > 0) {
        nav.push(
          Markup.button.callback('« Sebelumnya', `browse:${entry.id}:${page - 1}`)
        );
      }
      if (page < totalPages - 1) {
        nav.push(
          Markup.button.callback('Berikutnya »', `browse:${entry.id}:${page + 1}`)
        );
      }
      rows.push(nav);
    }
  }

  return Markup.inlineKeyboard(rows);
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {Awaited<ReturnType<typeof resolveDriveEntry>>} entry
 * @param {number} [page]
 */
async function showContentPicker(ctx, entry, page = 0) {
  const n = entry.media.length;
  let text =
    `📂 ${escapeMarkdown(entry.name)}\n\n` +
    `Pilih *satu file* konten *hari ini* (disarankan) atau *semua*:\n` +
    `_Semua file_ hanya memakai media yang diubah di Drive hari ini (WIB).\n` +
    `Total: ${n} file`;

  if (n > FILES_PER_PAGE) {
    const pages = Math.ceil(n / FILES_PER_PAGE);
    text += `\nHalaman ${page + 1} / ${pages}`;
  }

  const keyboard = contentChoiceKeyboard(entry, page);
  const opts = { parse_mode: 'Markdown', ...keyboard };

  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch {
      /* fallback reply */
    }
  }
  await ctx.reply(text, opts);
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} folderId
 * @param {string} folderName
 * @param {Array<{ id: string, name?: string, mimeType?: string }>} [presetMedia]
 */
async function loadFolderAndCaption(ctx, folderId, folderName, presetMedia = null) {
  let mediaRaw = presetMedia?.length
    ? presetMedia
    : await listMediaInFolder(folderId);

  if (!mediaRaw.length) {
    await ctx.reply('Tidak ada gambar/video di pilihan ini.');
    resetSession(ctx.chat.id);
    return;
  }

  let filterNote = '';
  if (!presetMedia?.length) {
    const picked = pickDriveMediaForWibDay(mediaRaw);
    mediaRaw = picked.media;
    if (picked.excluded > 0) {
      filterNote +=
        `\n⚠️ *${picked.excluded}* file di folder tidak diubah hari ini (WIB) — dilewati.`;
    }
    if (picked.usedFallback && picked.media[0]) {
      const fn = escapeMarkdown(picked.media[0].name || 'media');
      filterNote +=
        `\n⚠️ Tidak ada file diubah hari ini — dipakai *1 file terbaru*: _${fn}_`;
    }
  }

  if (!mediaRaw.length) {
    await ctx.reply('Tidak ada media yang bisa dipakai untuk hari ini.');
    resetSession(ctx.chat.id);
    return;
  }

  const mediaFiles = mediaRaw.map((f) => ({
    id: f.id,
    name: f.name || 'media',
    mimeType: f.mimeType || 'application/octet-stream',
  }));

  setSessionMediaFiles(ctx.chat.id, mediaFiles, {
    folderId,
    folderName,
    sourceLabel: `Drive · ${folderName}`,
    extra: {
      step: 'selecting_targets',
      caption: undefined,
      captionsByNetwork: undefined,
      selectedAccountIds: undefined,
      targetLabel: undefined,
      outstandMediaIds: undefined,
    },
  });

  registerNotifyChat('default', ctx.chat.id);

  const session = getSession(ctx.chat.id);
  const kind = mediaFiles.some((f) => f.mimeType?.startsWith('video/'))
    ? 'video'
    : 'gambar';
  const filePreview = mediaFiles
    .slice(0, 5)
    .map((f, i) => `${i + 1}. _${escapeMarkdown(f.name)}_`)
    .join('\n');
  const moreFiles =
    mediaFiles.length > 5 ? `\n…+${mediaFiles.length - 5} file` : '';

  let msg =
    `✅ Media siap (${kind}): *${escapeMarkdown(folderName)}*\n` +
    `📄 *${mediaFiles.length}* file untuk publish hari ini:\n${filePreview}${moreFiles}`;
  if (filterNote) msg += filterNote;
  if (session.missionBriefing) {
    msg += '\n📋 Caption akan mengikuti *misi hari ini* (§1, §2, §5).';
  }
  msg +=
    '\n\n🎯 Pilih target platform — caption disesuaikan limit terpendek (mis. X/Threads).';
  await safeReply(ctx, msg, { parse_mode: 'Markdown' });
  await showTargetPicker(ctx);
}

/**
 * User mengirim link folder/file dari orang lain.
 * @param {import('telegraf').Context} ctx
 * @param {string} linkText
 */
async function processIncomingDriveLink(ctx, linkText) {
  const driveId = extractDriveLinkFromText(linkText);
  if (!driveId) {
    await ctx.reply(
      '❌ Link tidak dikenali.\n\nContoh:\nhttps://drive.google.com/drive/folders/xxxxx'
    );
    return;
  }

  await ctx.reply('⏳ Membuka link Drive…');

  try {
    const entry = await resolveDriveEntry(linkText);
    const session = getSession(ctx.chat.id);

    if (session.step === 'awaiting_retry_media' && session.retryPending) {
      const pending = session.retryPending;
      const mediaRaw = entry.media?.length
        ? entry.media
        : entry.subfolders?.length
          ? null
          : await listMediaInFolder(entry.id).catch(() => []);

      if (!mediaRaw?.length) {
        await ctx.reply(
          'Pilih folder/file yang berisi media, atau kirim link langsung ke file/folder media.'
        );
        return;
      }

      const mediaFiles = mediaRaw.map((f) => ({
        id: f.id,
        name: f.name || 'media',
        mimeType: f.mimeType || 'application/octet-stream',
        source: 'drive',
      }));

      setSessionMediaFiles(ctx.chat.id, mediaFiles, {
        folderId: entry.id,
        folderName: entry.name,
        sourceLabel: `Drive · ${entry.name} (retry)`,
        extra: {
          caption: pending.caption,
          step: 'idle',
          retryPending: undefined,
        },
      });
      await ctx.reply('✅ Media dari Drive siap. Melanjutkan retry…');
      await handleRetryPublish(ctx, {
        send: true,
        network: pending.network || null,
        postIds: pending.postIds || [],
        forcedRetryIds: pending.retryIds,
      });
      return;
    }

    updateSession(ctx.chat.id, {
      step: 'selecting_content',
      driveRootId: entry.id,
      driveRootName: entry.name,
    });

    const hasSubs = entry.subfolders.length > 0;
    const hasMedia = entry.media.length > 0;

    if (!hasSubs && !hasMedia) {
      await ctx.reply(
        'Folder kosong atau service account belum punya akses.\n\n' +
          'Minta pengirim link menambahkan email service account sebagai Viewer, ' +
          'atau share folder ke email di file credentials JSON (client_email).'
      );
      resetSession(ctx.chat.id);
      return;
    }

    if (!hasSubs && hasMedia.length === 1) {
      await loadFolderAndCaption(ctx, entry.id, entry.name, entry.media);
      return;
    }

    await showContentPicker(ctx, entry, 0);
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, `[Bot] drive link error: ${err?.message || err}`);
    const hint =
      err.message?.includes('404') || err.message?.includes('403')
        ? '\n\n💡 Pastikan folder di-share ke email service account (client_email di JSON).'
        : '';
    await ctx.reply(`❌ Gagal membuka Drive: ${err.message}${hint}`);
    resetSession(ctx.chat.id);
  }
}

async function handlePublishCommand(ctx) {
  updateSession(ctx.chat.id, { step: 'awaiting_media' });
  await ctx.reply(
    '📤 *Mulai publish*\n\n' +
      'Kirim salah satu:\n' +
      '1️⃣ *Broadcast misi* (SONAR dll.) — bot baca §1 Pesan utama, §2 Poin, §5 Aturan\n' +
      '2️⃣ *Link Google Drive* (folder/file)\n' +
      '3️⃣ *Foto atau video* langsung ke chat\n\n' +
      'Urutan disarankan: misi dulu (atau misi + link Drive dalam satu pesan), lalu pilih media.',
    { parse_mode: 'Markdown', ...mainMenuKeyboard() }
  );
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 */
async function handleMissionBroadcast(ctx, text) {
  const mission = parseMissionBroadcast(text);
  if (!mission) return false;

  updateSession(ctx.chat.id, {
    missionBriefing: mission,
    step: mission.driveLink ? 'selecting_content' : 'awaiting_media',
  });
  registerNotifyChat('default', ctx.chat.id);

  try {
    await safeReply(ctx, formatMissionSummary(mission), {
      parse_mode: 'Markdown',
    });

    if (mission.driveLink) {
      await ctx.reply('⏳ Membuka link Drive dari briefing…');
      await processIncomingDriveLink(ctx, mission.driveLink);
    }
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, `[Bot] mission broadcast error: ${err?.message || err}`);
    await ctx.reply(
      `⚠️ Misi tersimpan, tapi ada masalah:\n${err.message}\n\n` +
        `Kirim link Drive atau video secara terpisah.`
    );
  }
  return true;
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function processTelegramMedia(ctx) {
  const picked = extractTelegramMedia(ctx);
  if (!picked) {
    await ctx.reply(
      '❌ Format tidak didukung.\nKirim *foto*, *video*, atau *dokumen* gambar/video.'
    );
    return;
  }

  await ctx.reply('⏳ Mengunduh media dari Telegram…');
  const buffer = await downloadTelegramFile(ctx, picked.fileId);
  const session = getSession(ctx.chat.id);

  if (session.step === 'awaiting_retry_media' && session.retryPending) {
    const pending = session.retryPending;
    setSessionMediaFiles(
      ctx.chat.id,
      [
        {
          buffer,
          name: picked.name,
          mimeType: picked.mimeType,
          source: 'telegram',
        },
      ],
      {
        folderName: picked.name,
        sourceLabel: `Telegram · ${picked.name} (retry)`,
        extra: {
          caption: pending.caption,
          step: 'idle',
          retryPending: undefined,
        },
      }
    );
    await ctx.reply('✅ Media siap. Melanjutkan retry…');
    await handleRetryPublish(ctx, {
      send: true,
      network: pending.network || null,
      postIds: pending.postIds || [],
    });
    return;
  }

  const label = session.missionBriefing?.title || 'Upload Telegram';

  const mediaFiles = [
    {
      buffer,
      name: picked.name,
      mimeType: picked.mimeType,
      source: 'telegram',
    },
  ];

  setSessionMediaFiles(ctx.chat.id, mediaFiles, {
    folderName: label,
    sourceLabel: `Telegram · ${picked.name}`,
    extra: {
      step: 'selecting_targets',
      caption: undefined,
      captionsByNetwork: undefined,
      selectedAccountIds: undefined,
      targetLabel: undefined,
      outstandMediaIds: undefined,
    },
  });
  registerNotifyChat('default', ctx.chat.id);

  const kind = picked.mimeType.startsWith('video/') ? 'video' : 'gambar';
  let intro =
    `✅ Media dari Telegram (${kind}): *${picked.name}*\n`;
  if (session.missionBriefing) {
    intro += '📋 Misi hari ini aktif — caption mengikuti §1, §2, §5.\n';
  }
  intro += '\n🎯 Pilih target platform:';

  await ctx.reply(intro, { parse_mode: 'Markdown' });
  await showTargetPicker(ctx);
}

async function handleFolderSelect(ctx) {
  const folderId = ctx.match[1];
  await ack(ctx, 'Memuat folder…');

  try {
    const meta = await getFolderMeta(folderId);
    await loadFolderAndCaption(ctx, folderId, meta.name || 'Konten');
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, `[Bot] folder select error: ${err?.message || err}`);
    await ctx.reply(`❌ Error: ${err.message}`);
    resetSession(ctx.chat.id);
  }
}

async function handlePackSelect(ctx) {
  const folderId = ctx.match[1];
  await ack(ctx, 'Memuat semua file…');
  try {
    const meta = await getFolderMeta(folderId);
    await loadFolderAndCaption(ctx, folderId, meta.name || 'Konten');
  } catch (err) {
    await ctx.reply(`❌ Error: ${err.message}`);
  }
}

async function handleFileSelect(ctx) {
  const fileId = ctx.match[1];
  await ack(ctx, 'Memuat file…');
  try {
    const meta = await getFolderMeta(fileId);
    await loadFolderAndCaption(ctx, fileId, meta.name || 'Konten', [
      { id: meta.id, name: meta.name, mimeType: meta.mimeType },
    ]);
  } catch (err) {
    await ctx.reply(`❌ Error: ${err.message}`);
  }
}

/**
 * @param {string | number} chatId
 * @param {string[]} argPostIds
 */
async function resolveRetrySource(chatId, argPostIds) {
  const session = getSession(chatId);
  const hintPid = argPostIds[0];
  let archive =
    session.lastPublish ||
    (hintPid ? loadPublishArchive(chatId, hintPid) : null) ||
    loadPublishArchive(chatId);

  let postIds = argPostIds.length ? argPostIds : [];

  if (!postIds.length) {
    try {
      postIds = await readPostIdsFromDailyTab();
    } catch {
      postIds = [];
    }
  }

  if (!postIds.length) {
    postIds = archive?.postIds || session.outstandPostIds || [];
  }

  return { archive, postIds, session };
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {{ archive?: object | null, session: object, postIds: string[], networks: string[], mediaFiles: object[] }} input
 */
async function resolveCaptionForRetry(ctx, input) {
  const { archive, session, postIds, networks, mediaFiles } = input;
  let caption =
    archive?.caption ||
    session.caption ||
    session.retryPending?.caption ||
    '';

  if (!caption.trim() && postIds.length) {
    await ctx.reply('⏳ Mengambil caption dari Outstand…').catch(() => {});
    caption = await fetchCaptionFromPostIds(postIds);
  }

  if (!caption.trim() && session.missionBriefing) {
    await ctx.reply('⏳ Generate caption dari misi…').catch(() => {});
    try {
      caption = await generateCaption({
        folderName: session.folderName || archive?.folderName || 'Retry',
        mediaFiles: mediaFiles || session.mediaFiles || [],
        targetNetworks: networks,
        missionBriefing: session.missionBriefing,
      });
    } catch (err) {
      log.warn({ err: err.message }, `[Bot] retry caption AI: ${err.message}`);
    }
  }

  if (!caption.trim()) {
    caption = `Konten ${session.folderName || archive?.folderName || getDailyTabName()}`;
  }

  return caption;
}

/**
 * Analisis / publish ulang akun yang gagal (Post ID hari ini / arsip / argumen).
 * @param {import('telegraf').Context} ctx
 * @param {{ send?: boolean, network?: string | null, postIds?: string[], usernames?: string[], forcedRetryIds?: string[] }} options
 */
async function handleRetryPublish(ctx, options = {}) {
  const {
    send = false,
    network = null,
    postIds: argPostIds = [],
    usernames = [],
    forcedRetryIds,
  } = options;
  const { archive, postIds, session } = await resolveRetrySource(
    ctx.chat.id,
    argPostIds
  );

  if (!postIds.length) {
    await ctx.reply(
      'Tidak ada Post ID untuk dicek.\n\n' +
        'Contoh:\n' +
        '`/retry ig`\n' +
        '`/retry ew0Tr ig`\n' +
        '`/retry 1dHcG ig yeseniamandiri kirim`',
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
    return;
  }

  const cancelledIds = postIds.filter((id) => isPostIdCancelled(id));
  if (send && cancelledIds.length) {
    await safeReply(
      ctx,
      `🛑 Post ID sudah dibatalkan (\`/stop\`): \`${cancelledIds.join('`, `')}\`\n\n` +
        'Jangan retry batch ini — bisa memicu konten kemarin lagi.\n' +
        'Publish baru: `/publish` + folder Drive hari ini.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const useArchiveScope =
    argPostIds.length > 0 &&
    archive?.postIds?.length &&
    argPostIds.every((id) => archive.postIds.includes(id));

  const { accounts } = await fetchPublishAccountStatuses({
    postIds,
    expectedAccountIds: useArchiveScope ? archive?.selectedAccountIds || [] : [],
    baseCaption: archive?.caption || session.caption || '',
  });

  let scoped = accounts;
  if (network) {
    scoped = accounts.filter(
      (a) => (a.network || '').toLowerCase() === network
    );
  }

  const plan = buildRetryPlan(scoped);

  let retryIds =
    send && forcedRetryIds?.length
      ? forcedRetryIds
      : collectRetryAccountIds(plan, { includeWait: false });

  if (usernames.length) {
    retryIds = filterRetryIdsByUsernames(retryIds, scoped, usernames);
    if (!retryIds.length) {
      await ctx.reply(
        `Tidak ada akun *${usernames.map((u) => `@${u.replace(/^@/, '')}`).join(', ')}` +
          '* yang boleh di-retry pada batch ini.\n\n' +
          'Cek: sudah live? rate limit? atau salah username.\n' +
          'Lihat daftar: `/retry ' +
          (postIds[0] || '') +
          ' ig`',
        { parse_mode: 'Markdown' }
      );
      return;
    }
  }

  let blockedNotice = '';
  if (send) {
    const usage = await getTodayAccountUsageCounts();
    const safety = applyRetrySafetyFilter(retryIds, usage);
    retryIds = safety.allowed;
    blockedNotice = formatRetryBlockedNotice(safety.blocked);
    if (!retryIds.length) {
      await ctx.reply(
        (blockedNotice || '') +
          '⛔ Tidak ada akun aman untuk di-retry.\n' +
          'Gunakan satu username yang *belum* ada post: `/retry POSTID ig yeseniamandiri kirim`',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (blockedNotice) {
      await ctx.reply(blockedNotice, { parse_mode: 'Markdown' });
    }
  }

  if (!send) {
    updateSession(ctx.chat.id, {
      retryAccountIds: collectRetryAccountIds(plan, { includeWait: false }),
      retryAccountIdsWithWait: collectRetryAccountIds(plan, {
        includeWait: true,
      }),
    retryPostIds: postIds,
    retryNetwork: network,
    outstandPostIds: postIds,
  });

    let report = formatRetryPlanReport(plan, postIds.join(', '));
    if (usernames.length) {
      const preview = filterRetryIdsByUsernames(
        collectRetryAccountIds(plan, { includeWait: false }),
        scoped,
        usernames
      );
      report +=
        `\n\n🎯 Filter: ${usernames.map((u) => `@${u.replace(/^@/, '')}`).join(', ')}` +
        (preview.length
          ? ` → *${preview.length}* akun siap \`kirim\``
          : ' → tidak ada yang cocok');
    }
    const retryCount = usernames.length
      ? filterRetryIdsByUsernames(
          collectRetryAccountIds(plan, { includeWait: false }),
          scoped,
          usernames
        ).length
      : collectRetryAccountIds(plan, { includeWait: false }).length;
    const mediaNote = archive?.mediaFiles?.length || archive?.folderId
      ? ''
      : '\n\n📎 _Media arsip kosong — sebelum `/retry kirim`, kirim link Drive yang sama._';
    const keyboard =
      retryCount > 0
        ? Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `🔄 Publish ulang (${retryCount})`,
                'retry:send'
              ),
            ],
          ])
        : mainMenuKeyboard();

    await ctx.reply(report + mediaNote, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
    return;
  }

  if (!retryIds.length) {
    await ctx.reply(
      'Tidak ada akun yang bisa diulang.\nJalankan `/retry` untuk lihat daftar & penyebab gagal.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const archiveStale = getArchiveStaleReason(archive);
  if (archiveStale?.reason === 'day-changed') {
    await safeReply(
      ctx,
      `🛑 *Arsip publish dari hari ${archiveStale.prevDay}* — tidak bisa retry dengan media kemarin.\n\n` +
        'Langkah aman:\n' +
        '1. `/publish`\n' +
        '2. Kirim folder Drive *hari ini*\n' +
        '3. Pilih *satu file* konten hari ini (hindari *Semua file* kalau folder campur)\n' +
        '4. Publish ke akun yang gagal',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let mediaFiles = await hydrateMediaFromArchive(archive);
  if (!mediaFiles?.length && session.mediaFiles?.some((f) => f.id || f.buffer)) {
    const sessionStale = getStaleMediaReason(session);
    if (!sessionStale || sessionStale.reason === 'no-media') {
      mediaFiles = session.mediaFiles;
    }
  }

  const mediaStale = mediaFiles?.length
    ? getStaleMediaReason({
        mediaFiles,
        mediaFilesSetAt: archive?.savedAt || session.mediaFilesSetAt,
        mediaFilesDay: archive?.mediaFilesDay || session.mediaFilesDay,
      })
    : null;
  if (mediaStale && mediaStale.reason !== 'no-media') {
    await safeReply(
      ctx,
      formatStaleMediaNotice(mediaStale, session) +
        '\n\n_Retry dibatalkan — kirim media baru via `/publish`._',
      { parse_mode: 'Markdown' }
    );
    clearSessionContent(ctx.chat.id);
    return;
  }

  if (!mediaFiles?.length) {
    updateSession(ctx.chat.id, {
      step: 'awaiting_retry_media',
      retryPending: {
        postIds,
        network,
        retryIds,
        caption: archive?.caption || session.caption || '',
      },
    });
    await ctx.reply(
      '📎 *Media publish sebelumnya tidak tersimpan* (bot restart / timeout).\n\n' +
        'Kirim *link Google Drive yang sama* atau foto/video, lalu bot publish ulang otomatis.\n\n' +
        `Post ID: ${postIds.join(', ')}\n` +
        `Akun: ${retryIds.length}\n\n` +
        '_Caption diambil ulang dari Outstand jika tersedia._',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await ack(ctx, `Retry ${retryIds.length} akun…`);

  const allAccounts = await listSocialAccounts();
  const selected = allAccounts.filter((a) => retryIds.includes(a.id));
  const networks = [
    ...new Set(
      selected.map((a) => (a.network || '').toLowerCase()).filter(Boolean)
    ),
  ];

  const caption = await resolveCaptionForRetry(ctx, {
    archive,
    session,
    postIds,
    networks,
    mediaFiles,
  });
  const captionsByNetwork = buildCaptionsByNetwork(caption, networks);
  const youtubeFields = networks.includes('youtube')
    ? buildYoutubePostFields(captionsByNetwork?.youtube || caption)
    : session.youtubeFields;

  updateSession(ctx.chat.id, {
    mediaFiles,
    folderId: archive?.folderId || session.folderId,
    folderName: archive?.folderName || session.folderName,
    caption,
    captionsByNetwork,
    youtubeFields,
    selectedAccountIds: retryIds,
    targetLabel: `Retry gagal (${retryIds.length})`,
    step: 'ready',
    retryPending: undefined,
    retryPostIds: postIds,
    outstandPostIds: postIds,
  });

  await runPublish(ctx);
}

async function runPublish(ctx, scheduledAt) {
  const session = getSession(ctx.chat.id);
  if (
    session.step !== 'ready' &&
    session.step !== 'awaiting_schedule' &&
    session.step !== 'publishing'
  ) {
    await ctx.reply('Sesi tidak valid. Ketik /publish untuk mulai lagi.');
    return;
  }

  // Idempotency guard: request publish sama dalam window pendek dianggap duplikat.
  // Ini mencegah konten hari ini ter-submit berkali-kali akibat double click / reconnect.
  try {
    const dayKey = session.mediaFilesDay || getWibDayKey();
    const key = buildIdempotencyKey({
      targets: (session.selectedAccountIds || []).map((id) => ({
        accountId: id,
      })),
      media: (session.mediaFiles || []).map((m) => ({
        filename: m.name,
        kind: m.mimeType,
      })),
      scheduledAtIsoUtc: scheduledAt || '',
      captionDigest: captionsDigest(session.captionsByNetwork || session.caption || ''),
      chatId: String(ctx.chat.id),
      dayKey,
    });

    const now = Date.now();
    const lastKey = session.lastPublishKey;
    const lastAt = Number(session.lastPublishAt || 0);
    if (lastKey && lastKey === key && now - lastAt < 10 * 60_000) {
      await safeReply(
        ctx,
        `🛑 *Duplikat terdeteksi* — request publish sama baru saja dikirim.\n\n` +
          `Key: \`${shortKey(key)}\`\n` +
          `Tunggu settle / cek \`/status\` atau \`/synctoday\`.\n` +
          `Kalau ada antrian lama: \`/stop 3d ya\``,
        { parse_mode: 'Markdown' }
      );
      updateSession(ctx.chat.id, { step: 'idle' });
      return;
    }

    updateSession(ctx.chat.id, { lastPublishKey: key, lastPublishAt: now });
  } catch {
    /* ignore */
  }

  if (!session.mediaFiles?.length) {
    await ctx.reply(
      'Media belum ada. Kirim link Drive / foto, atau ketik /publish lagi.'
    );
    return;
  }

  const staleNow = getStaleMediaReason(session);
  if (staleNow && staleNow.reason !== 'no-media') {
    await safeReply(ctx, formatStaleMediaNotice(staleNow, session), {
      parse_mode: 'Markdown',
    });
    clearSessionContent(ctx.chat.id);
    updateSession(ctx.chat.id, { step: 'awaiting_media' });
    return;
  }

  if (!String(session.caption || '').trim()) {
    const accounts = await listSocialAccounts();
    const selected = accounts.filter((a) =>
      (session.selectedAccountIds || []).includes(a.id)
    );
    const networks = [
      ...new Set(
        selected.map((a) => (a.network || '').toLowerCase()).filter(Boolean)
      ),
    ];
    let caption = '';
    const postIds = session.retryPostIds || session.outstandPostIds || [];
    if (postIds.length) {
      caption = await fetchCaptionFromPostIds(postIds);
    }
    if (!caption.trim()) {
      caption = `Konten ${session.folderName || getDailyTabName()}`;
    }
    updateSession(ctx.chat.id, {
      caption,
      captionsByNetwork: buildCaptionsByNetwork(caption, networks),
      ...(networks.includes('youtube')
        ? {
            youtubeFields: buildYoutubePostFields(
              buildCaptionsByNetwork(caption, networks)?.youtube || caption
            ),
          }
        : {}),
    });
    await ctx
      .reply(`ℹ️ Caption dipulihkan otomatis untuk retry/publish.`)
      .catch(() => {});
  }

  if (!session.selectedAccountIds?.length) {
    await ctx.reply('Pilih target publish dulu:');
    await showTargetPicker(ctx);
    return;
  }

  const uniqueTargets = [...new Set(session.selectedAccountIds)];
  if (uniqueTargets.length < session.selectedAccountIds.length) {
    updateSession(ctx.chat.id, { selectedAccountIds: uniqueTargets });
  }

  const validation = await validateBeforePublish({
    mediaFiles: session.mediaFiles,
    selectedAccountIds: session.selectedAccountIds,
  });
  if (!validation.ok) {
    await ctx.reply(`❌ Tidak bisa publish:\n${validation.errors.join('\n')}`);
    return;
  }
  if (validation.warnings.length) {
    await ctx.reply(`ℹ️ ${validation.warnings.join('\n')}`);
  }

  const targetInfo = session.targetLabel || `${session.selectedAccountIds.length} akun`;

  await ctx.reply(
    scheduledAt
      ? '📅 Menjadwalkan & mengunggah media ke Outstand…'
      : '🚀 Mengunggah media & publish ke akun terpilih…'
  );

  try {
    const onlyImages = session.mediaFiles.every((f) =>
      f.mimeType?.startsWith('image/')
    );
    const reelTargets = await getImageToVideoTargets(
      session.selectedAccountIds
    );

    if (reelTargets.length && onlyImages) {
      const labels = reelTargets
        .map((n) => NETWORK_LABELS[n] || n)
        .join(', ');
      const dur = reelTargets.map((n) => `${n}:${getDurationForNetwork(n)}s`).join(', ');
      await ctx.reply(
        `🎬 Gambar → video (${dur})\n` +
          `Platform: ${labels}` +
          (session.mediaFiles.filter((f) => f.mimeType?.startsWith('image/')).length > 1
            ? '\n_Slideshow dari beberapa gambar._'
            : '')
      );
    }

    const {
      byNetwork: mediaByNetwork,
      imageToVideoNetworks,
      imageToVideoSilent,
    } = await uploadMediaForTargets(
      session.mediaFiles,
      session.selectedAccountIds
    );

    const allMediaIds = Object.values(mediaByNetwork)
      .flat()
      .map((m) => m.id);

    const result = await publishBulk({
      baseCaption: session.caption,
      captionsByNetwork: session.captionsByNetwork,
      youtubeFields: session.youtubeFields,
      mediaByNetwork,
      scheduledAt,
      socialAccountIds: session.selectedAccountIds,
    });

    const lastPublish = {
      mediaFiles: session.mediaFiles,
      caption: session.caption,
      folderName: session.folderName,
      folderId: session.folderId,
      targetLabel: targetInfo,
      postIds: result.postIds,
      selectedAccountIds: session.selectedAccountIds,
      mediaFilesDay: session.mediaFilesDay || getWibDayKey(),
      savedAt: nowIsoUtc(),
    };

    savePublishArchive(ctx.chat.id, lastPublish);

    // Kosongkan media/caption di sesi aktif supaya /random atau /republish
    // tidak bisa pakai konten batch ini lagi tanpa /publish + Drive baru.
    clearSessionContent(ctx.chat.id);
    updateSession(ctx.chat.id, {
      step: 'idle',
      lastPublish,
      outstandPostIds: result.postIds,
      outstandMediaIds: allMediaIds,
    });

    log.info(
      {
        folder: session.folderName,
        files: (session.mediaFiles || []).map((f) => f.name),
        postIds: result.postIds,
        accounts: session.selectedAccountIds?.length,
      },
      '[Bot] Publish submitted — session media cleared'
    );

    const postIdLine = result.postIds.join(', ') || '—';

    if (scheduledAt) {
      await ctx.reply(
        `✅ Post dijadwalkan (${scheduledAt})\n` +
          `Target: ${targetInfo}\n` +
          `Akun: ${result.accountCount} · Batch: ${result.batchCount}\n` +
          `Post ID: ${postIdLine}\n\n` +
          `Status live akan muncul setelah waktu jadwal. Cek Outstand dashboard jika perlu.`
      );
      return;
    }

    await ctx.reply(
      `📤 Request diterima Outstand\n` +
        `Target: ${targetInfo}\n` +
        `Post ID: ${postIdLine}` +
        (imageToVideoNetworks?.length
          ? `\n🎬 Video dari gambar (${env.imageToVideoDurationSec}s${imageToVideoSilent ? ', tanpa musik' : ''}): ${imageToVideoNetworks.join(', ')}`
          : '') +
        `\n\n⏳ Mengecek status publish (${formatPollWaitHint(
          result.accountCount
        )})…`
    );

    const pollPlan = computePublishPollPlan(result.accountCount);
    const posts = await waitForPostsSettled(result.postIds, {
      maxWaitMs: pollPlan.maxWaitMs,
      intervalMs: 3_000,
    });
    const summary = summarizePublishResults(posts, session.caption);

    markAccountsUsedForToday(ctx.chat.id, session.selectedAccountIds);
    clearPublishedTodayCache();
    clearQuotaCache();

    if (result.postIds?.length) {
      try {
        const sheetResult = await recordPublishResultsToSheet({
          postIds: result.postIds,
          posts,
          expectedAccountIds: session.selectedAccountIds,
          baseCaption: session.caption,
          folderName: session.folderName,
          targetLabel: session.targetLabel,
          mediaFiles: session.mediaFiles,
        });
        scheduleSheetRefresh(
          result.postIds,
          session.selectedAccountIds,
          session.caption || '',
          {
            folderName: session.folderName,
            targetLabel: session.targetLabel,
            mediaFiles: session.mediaFiles,
            mediaFilesDay: session.mediaFilesDay || getWibDayKey(),
          }
        );
        if (sheetResult.recorded > 0) {
          const rows = sheetResult.rowCount ?? sheetResult.recorded;
          await ctx.reply(
            `📊 Sheets: *${rows} baris* (1 baris = 1 posting)\n` +
              `Tab: ${sheetResult.tabName} · ${sheetResult.summary.statusSummary}\n` +
              `Kolom Ke-# / Duplikat / Konten.\n` +
              `Status diperbarui otomatis +5…+120 menit & tiap 20 menit (/refresh).\n` +
              `${sheetResult.spreadsheetUrl}`
          );
        }
      } catch (sheetErr) {
        log.error({ err: sheetErr?.message, stack: sheetErr?.stack }, `[Sheets] record after publish: ${sheetErr?.message || sheetErr}`);
        await ctx.reply(
          `⚠️ Publish selesai, gagal catat Sheets:\n${sheetErr.message}`
        );
      }
    }

    const reportText =
      formatTelegramPublishReport(summary, postIdLine) +
      formatLargeBatchFollowUp(summary, pollPlan, postIdLine) +
      (summary.pending > 0
        ? '\n\n_Webhook akan update jika masih pending._'
        : '');
    try {
      await replyTelegramLong(ctx, reportText);
    } catch (tgErr) {
      log.error({ err: tgErr?.message, stack: tgErr?.stack }, `[Bot] telegram report: ${tgErr?.message || tgErr}`);
      await ctx.reply(
        `✅ Publish selesai (${summary.published} live · ${summary.failed} gagal · ${summary.pending} pending).\n` +
          `Laporan detail ada di Google Sheets (pesan Telegram terlalu panjang).`
      );
    }

    try {
      const quota = await buildDailyQuotaStatus({
        chatId: ctx.chat.id,
        session: getSession(ctx.chat.id),
        forceRefresh: true,
      });
      await ctx.reply(formatDailyQuotaCompact(quota));
    } catch (quotaErr) {
      log.warn({ err: quotaErr.message }, `[Bot] quota after publish: ${quotaErr.message}`);
    }

    if (summary.pending > 0) {
      schedulePublishStatusFollowUp(ctx, {
        chatId: ctx.chat.id,
        postIds: result.postIds,
        expectedAccountIds: session.selectedAccountIds,
        baseCaption: session.caption || '',
        initialSummary: summary,
      });
    }
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, `[Bot] publish error: ${err?.message || err}`);
    const detail = err.response?.data;
    const extra =
      typeof detail === 'string'
        ? detail
        : detail?.error || detail?.message || '';
    await ctx.reply(
      `❌ Publish gagal: ${err.message}${extra ? `\n${extra}` : ''}`
    );
    // Pastikan lock dilepas jika publish gagal, supaya user bisa coba ulang.
    updateSession(ctx.chat.id, { step: 'idle' });
  }
}

/**
 * Poll Outstand setelah publish untuk update status pending → live secara otomatis ke Telegram.
 * Sheets sudah di-refresh oleh scheduleSheetRefresh; ini khusus untuk notifikasi Telegram.
 */
const FOLLOW_UP_DELAYS_MS = [90_000, 240_000, 480_000];

function schedulePublishStatusFollowUp(ctx, input) {
  const { chatId, postIds, expectedAccountIds, baseCaption, initialSummary } = input;
  if (!postIds?.length) return;

  /** @type {Map<string, string>} */
  const lastStatusById = new Map();
  for (const a of initialSummary?.sheetAccounts || []) {
    lastStatusById.set(a.accountId || `${a.network}:${a.username}`, a.status || 'pending');
  }

  let stopped = false;

  for (const delayMs of FOLLOW_UP_DELAYS_MS) {
    setTimeout(async () => {
      if (stopped) return;
      try {
        const { accounts } = await fetchPublishAccountStatuses({
          postIds,
          expectedAccountIds: expectedAccountIds || [],
          baseCaption,
        });

        /** @type {Array<{ network: string, username: string, status: string, url?: string }>} */
        const changed = [];
        let stillPending = 0;
        for (const a of accounts) {
          const key = a.accountId || `${a.network}:${a.username}`;
          const prev = lastStatusById.get(key) || 'pending';
          const cur = (a.status || 'pending').toLowerCase();
          if (cur !== prev && cur !== 'pending') {
            changed.push({
              network: (a.network || '').toLowerCase(),
              username: (a.username || '').replace(/^@/, ''),
              status: cur,
              url: a.url || '',
            });
          }
          lastStatusById.set(key, cur);
          if (cur === 'pending') stillPending += 1;
        }

        if (changed.length) {
          const escUser = (s) =>
            String(s || '').replace(/[_*`[\]]/g, '\\$&');
          const lines = changed.slice(0, 15).map((c) => {
            const icon = c.status === 'published' ? '✅' : '❌';
            const link =
              c.url && c.status === 'published'
                ? `\n  ${c.url}`
                : '';
            return `${icon} ${c.network} @${escUser(c.username)}${link}`;
          });
          const more =
            changed.length > 15 ? `\n_…+${changed.length - 15} lagi_` : '';

          const published = changed.filter((c) => c.status === 'published').length;
          const failed = changed.filter((c) => c.status === 'failed').length;
          const header =
            published > 0 && failed === 0
              ? `📈 *Update status* — ${published} akun baru *LIVE*`
              : failed > 0 && published === 0
                ? `📉 *Update status* — ${failed} akun *GAGAL*`
                : `📊 *Update status* — ${published} live, ${failed} gagal`;

          const followUpBody =
            header +
            ` (+${Math.round(delayMs / 60000)} mnt)\n\n` +
            lines.join('\n') +
            more +
            (stillPending
              ? `\n\n⏳ ${stillPending} akun masih pending.`
              : '\n\n✅ Semua post sudah settled.');
          try {
            await safeSendMessage(ctx.telegram, chatId, followUpBody, {
              parse_mode: 'Markdown',
              disable_web_page_preview: true,
            });
          } catch (err) {
            log.warn({ err: err.message }, `[FollowUp] reply failed: ${err.message}`);
          }
        }

        if (!stillPending) {
          stopped = true;
        }
      } catch (err) {
        log.warn(
          { delaySec: delayMs / 1000, err: err.message },
          `[FollowUp] poll +${delayMs / 1000}s: ${err.message}`,
        );
      }
    }, delayMs);
  }
}

async function handleAction(ctx) {
  const action = ctx.match[1];
  await ack(ctx, action === 'send' ? 'Mempublish…' : undefined);
  const session = getSession(ctx.chat.id);

  if (action === 'preview') {
    if (!session.mediaFiles?.length || !session.selectedAccountIds?.length) {
      await ctx.reply('Lengkapi target dulu.');
      return;
    }
    const validation = await validateBeforePublish({
      mediaFiles: session.mediaFiles,
      selectedAccountIds: session.selectedAccountIds,
    });
    let text = buildPublishPreviewText(session);
    if (!validation.ok) {
      text += `\n\n❌ *Masalah:*\n${validation.errors.join('\n')}`;
    } else if (validation.warnings.length) {
      text += `\n\nℹ️ ${validation.warnings.join('\n')}`;
    } else {
      text += '\n\n✅ Siap publish.';
    }
    await ctx.reply(text, { parse_mode: 'Markdown', ...actionKeyboard() });
    return;
  }

  if (action === 'send') {
    if (!session.selectedAccountIds?.length) {
      await showTargetPicker(ctx);
      return;
    }
    // Guard: cegah double click / callback replay yang bisa submit publish berkali-kali.
    if (session.step === 'publishing') {
      await ctx.reply('⏳ Masih mempublish batch sebelumnya…').catch(() => {});
      return;
    }
    updateSession(ctx.chat.id, { step: 'publishing' });
    await runPublish(ctx);
    return;
  }

  if (action === 'schedule') {
    updateSession(ctx.chat.id, { step: 'awaiting_schedule' });
    await ctx.reply(
      `📅 Pilih jadwal cepat atau ketik manual:\n\n${formatScheduleHelp()}`,
      { parse_mode: 'Markdown', ...scheduleKeyboard() }
    );
    return;
  }

  if (action === 'edit') {
    updateSession(ctx.chat.id, { step: 'awaiting_caption_edit' });
    await ctx.reply('✍️ Kirim teks caption baru (satu pesan):');
    return;
  }

  if (session.step !== 'ready') {
    await ctx.reply('Sesi kadaluarsa. Ketik /publish.');
  }
}

async function handleTextMessage(ctx) {
  const session = getSession(ctx.chat.id);
  const text = ctx.message.text?.trim();
  if (!text) return;

  if (text === MENU.PUBLISH) {
    await handlePublishCommand(ctx);
    return;
  }
  if (text === MENU.SHEET) {
    await handleSheetCommand(ctx);
    return;
  }
  if (text === MENU.CANCEL) {
    await handleCancelCommand(ctx);
    return;
  }
  if (text === MENU.HELP) {
    await showMainMenu(ctx);
    return;
  }

  if (
    (session.step === 'selecting_targets' ||
      session.step === 'awaiting_random_counts') &&
    session.mediaFiles?.length &&
    looksLikeRandomPick(text)
  ) {
    await handleRandomAccountPick(ctx, text);
    return;
  }

  if (session.step === 'awaiting_caption_edit') {
    updateSession(ctx.chat.id, { caption: text, captionsByNetwork: undefined });
    if (session.selectedAccountIds?.length) {
      await finalizeTargetSelection(
        ctx,
        session.selectedAccountIds,
        session.targetLabel || 'Target'
      );
    } else {
      updateSession(ctx.chat.id, { step: 'selecting_targets', caption: text });
      await ctx.reply('Caption disimpan. Pilih target platform:');
      await showTargetPicker(ctx);
    }
    return;
  }

  if (session.step === 'awaiting_status_id') {
    const postId = text.split(/[\s,]+/)[0];
    await ctx.reply('⏳ Mengecek status post…');
    try {
      const post = await getPost(postId);
      const summary = summarizePublishResults([post]);
      updateSession(ctx.chat.id, { step: 'idle' });
      await replyTelegramLong(ctx, formatTelegramPublishReport(summary, postId));
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
    return;
  }

  if (session.step === 'awaiting_schedule') {
    const parsed = parseScheduleInput(text) || new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      await ctx.reply(
        `Format tidak dikenali.\n\n${formatScheduleHelp()}`,
        scheduleKeyboard()
      );
      return;
    }
    if (parsed.getTime() <= Date.now()) {
      await ctx.reply('Jadwal harus di masa depan.');
      return;
    }
    const iso = parsed.toISOString();
    updateSession(ctx.chat.id, { scheduledAt: iso, step: 'ready' });
    await ctx.reply(
      `📅 Jadwal: ${formatWibDateTime(parsed)}`
    );
    await runPublish(ctx, iso);
    return;
  }

  if (looksLikeMissionBroadcast(text)) {
    try {
      await handleMissionBroadcast(ctx, text);
    } catch (err) {
      log.error({ err: err?.message, stack: err?.stack }, `[Bot] mission handler: ${err?.message || err}`);
      await ctx.reply(`❌ Gagal baca broadcast misi:\n${err.message}`);
    }
    return;
  }

  const driveLink = extractDriveLinkFromText(text);
  if (driveLink) {
    await processIncomingDriveLink(ctx, text);
    return;
  }

  if (session.step === 'awaiting_drive_link' || session.step === 'awaiting_media') {
    await ctx.reply(
      'Kirim:\n' +
        '• Broadcast misi (teks SONAR), atau\n' +
        '• Link Drive, atau\n' +
        '• Foto/video langsung'
    );
    return;
  }

  if (session.step === 'idle') {
    await ctx.reply(
      'Ketik /publish atau tombol 📤 Publish untuk mulai.\n' +
        'Atau forward *broadcast misi* + link Drive dalam satu pesan.'
    );
  }
}

export function createBot() {
  const bot = new Telegraf(env.telegramBotToken, {
    handlerTimeout: env.telegramHandlerTimeoutMs,
  });
  bot.use(guard);

  bot.start(async (ctx) => {
    resetSession(ctx.chat.id);
    await showMainMenu(ctx);
  });

  bot.command('menu', async (ctx) => {
    await showMainMenu(ctx);
  });

  bot.command('sheet', handleSheetCommand);
  bot.command('publish', handlePublishCommand);
  bot.command('cancel', handleCancelCommand);

  bot.command('status', async (ctx) => {
    try {
      updateSession(ctx.chat.id, { step: 'awaiting_status_id' });
      await ctx.reply(
        '🔍 Kirim *Post ID* Outstand (satu ID per pesan).\n' +
          'ID ada di pesan setelah publish.',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply(`🏓 Bot online · tab ${getDailyTabName()} · WIB`);
  });

  bot.command('kuota', async (ctx) => {
    await ctx.reply(
      `⏳ Menghitung kuota *${getDailyTabName()}*…`,
      { parse_mode: 'Markdown' }
    );
    try {
      let status = await buildDailyQuotaStatus({
        chatId: ctx.chat.id,
        session: getSession(ctx.chat.id),
        forceRefresh: false,
      });
      await ctx.reply(formatDailyQuotaReport(status, { compact: false }), {
        parse_mode: 'Markdown',
      });

      buildDailyQuotaStatus({
        chatId: ctx.chat.id,
        session: getSession(ctx.chat.id),
        forceRefresh: true,
      })
        .then((fresh) =>
          ctx.reply(
            `🔄 *Kuota diperbarui:*\n${formatDailyQuotaCompact(fresh)}`,
            { parse_mode: 'Markdown' }
          )
        )
        .catch((err) => log.warn({ err: err.message }, `[Bot] kuota refresh: ${err.message}`));
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  bot.command('misi', async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (session.missionBriefing) {
      await ctx.reply(formatMissionSummary(session.missionBriefing), {
        parse_mode: 'Markdown',
      });
      return;
    }
    await ctx.reply(
      '📋 Belum ada misi di sesi ini.\n\n' +
        'Forward *broadcast* harian ke bot (satu pesan). Bot akan baca §1, §2, §5.\n' +
        'Lalu kirim link Drive atau foto/video.',
      { parse_mode: 'Markdown', ...mainMenuKeyboard() }
    );
  });

  bot.command('linkshari', async (ctx) => {
    // Parse optional argument platform filter:
    //   /linkshari            → semua platform
    //   /linkshari ig         → hanya Instagram
    //   /linkshari ig fb      → Instagram + Facebook
    //   /linkshari instagram,facebook → sama seperti di atas
    const args = (ctx.message.text || '')
      .replace(/^\/linkshari(@\w+)?\s*/i, '')
      .trim();
    const { networks: filterNets, invalid } = parseNetworkFilter(args);

    if (invalid.length) {
      await ctx.reply(
        `⚠️ Platform tidak dikenal: \`${invalid.join('`, `')}\`\n\n` +
          '*Yang valid:*\n' +
          '• `ig` / `instagram`\n' +
          '• `fb` / `facebook`\n' +
          '• `th` / `threads`\n' +
          '• `yt` / `youtube`\n' +
          '• `tt` / `tiktok`\n' +
          '• `x` / `twitter`\n' +
          '• `li` / `linkedin`\n' +
          '• `pin` / `pinterest`\n\n' +
          '*Contoh:*\n' +
          '• `/linkshari` — semua platform\n' +
          '• `/linkshari ig` — link Instagram saja\n' +
          '• `/linkshari ig fb` — IG + FB',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const filterLabel = filterNets.length
      ? filterNets.map(getNetworkShortLabel).join(' + ')
      : 'semua platform';

    await ctx.reply(
      `⏳ Mengambil post *${filterLabel}* hari ini (${env.timezone}) dari Outstand…`,
      { parse_mode: 'Markdown' }
    );
    try {
      const data = await collectTodayPublishLinks();
      if (!data.postIds.length) {
        await ctx.reply(
          `Tidak ada post untuk tab *${data.tabName}*.\n` +
            'Pastikan publish lewat bot/Outstand hari ini.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Filter accounts berdasarkan network kalau user kasih argumen
      const filterSet = new Set(filterNets);
      const filteredAccounts = filterSet.size
        ? data.accounts.filter((a) =>
            filterSet.has((a.network || '').toLowerCase())
          )
        : data.accounts;

      if (filterSet.size && !filteredAccounts.length) {
        const validList = filterNets.map(getNetworkShortLabel).join(', ');
        await ctx.reply(
          `Tidak ada post *${validList}* untuk tab *${data.tabName}*.\n` +
            'Cek `/linkshari` (tanpa filter) untuk lihat platform yang tersedia hari ini.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const postIdLine = filterSet.size
        ? `${data.tabName} · ${filterLabel} · ${filteredAccounts.length} akun`
        : `${data.tabName} · ${data.postIds.length} batch`;

      const report = formatPublishLinksReport(filteredAccounts, postIdLine);
      await replyTelegramLong(ctx, report);

      const dupes = buildDuplicateAccountSummary(
        annotateAccountsWithDayAttempts(filteredAccounts)
      );
      const dupeNote = dupes.length
        ? `\n\n⚠️ *${dupes.length} akun posting >1× hari ini:*\n` +
          dupes
            .slice(0, 8)
            .map((d) => {
              const konten = d.contentSummary
                ? `\n  _${d.contentSummary}_`
                : '';
              return `• @${d.username} — *${d.count}×* (${d.network})${konten}`;
            })
            .join('\n') +
          (dupes.length > 8 ? `\n_…+${dupes.length - 8} akun_` : '') +
          '\n\nJalankan `/synctoday` untuk baris REKAP di Sheets.'
        : '';

      // Hitung ringkasan untuk filtered set (atau semua kalau tanpa filter)
      const counts = filteredAccounts.reduce(
        (acc, a) => {
          const st = (a.status || '').toLowerCase();
          if (st === 'published' || st === 'live') acc.live += 1;
          else if (st === 'failed' || st === 'error') acc.failed += 1;
          else acc.pending += 1;
          return acc;
        },
        { live: 0, failed: 0, pending: 0 }
      );

      const headerLabel = filterSet.size
        ? `📋 *${data.tabName}* · *${filterLabel}* · ${filteredAccounts.length} akun`
        : `📋 *${data.tabName}* · ${data.postIds.length} Post ID`;

      await safeReply(
        ctx,
        headerLabel +
          `\n${counts.live} live · ${counts.failed} gagal · ${counts.pending} pending` +
          dupeNote +
          (filterSet.size
            ? `\n\nFilter lain: \`/linkshari ig\`, \`/linkshari fb\`, \`/linkshari ig fb th\`\nSemua: \`/linkshari\``
            : `\n\nFilter per platform: \`/linkshari ig\`, \`/linkshari fb\`, dst.\nSimpan ke Sheets: /synctoday`),
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      const code = err?.response?.error_code ?? err?.code;
      if (code === 429) {
        const retryAfter =
          err?.response?.parameters?.retry_after ??
          err?.parameters?.retry_after ??
          '';
        await ctx
          .reply(
            `⏳ Telegram limit tercapai${retryAfter ? ` (tunggu ${retryAfter}s)` : ''}. Sebagian link sudah terkirim di atas. Ulangi 30 detik lagi atau cek Sheets.`
          )
          .catch(() => {});
      } else {
        await ctx.reply(`❌ ${err.message}`).catch(() => {});
      }
    }
  });

  async function replySyncTodayResult(ctx) {
    const result = await syncTodayToSheet();
    const dupeLine = result.duplicateAccounts
      ? `\n⚠️ *${result.duplicateAccounts} akun* posting >1× — lihat baris REKAP di atas tab.`
      : '';
    await ctx.reply(
      `✅ Sheets tab *${result.tabName}* diperbarui dari Outstand\n` +
        `${result.postIds.length} Post ID · ${result.recorded} baris\n` +
        `${result.meta.published} live · ${result.meta.failed} gagal · ${result.meta.pending} pending` +
        dupeLine +
        `\n\n_Gagal yang sudah live di IG akan berubah jadi Live jika Outstand sudah kirim link._\n` +
        `${result.spreadsheetUrl}`,
      { parse_mode: 'Markdown' }
    );
  }

  async function runSyncTodayCommand(ctx) {
    await ctx.reply(
      `⏳ Mengambil status terbaru Outstand → Sheets (*${getDailyTabName()}*)…`,
      { parse_mode: 'Markdown' }
    );
    try {
      await replySyncTodayResult(ctx);
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  }

  bot.command('synctoday', runSyncTodayCommand);
  bot.command('refresh', runSyncTodayCommand);

  bot.command('stop', async (ctx) => {
    const args = (ctx.message.text || '')
      .replace(/^\/stop(@\w+)?\s*/i, '')
      .trim()
      .toLowerCase();

    const stuckOnly = /\bstuck\b/.test(args);
    const doCancel = /\b(yes|ya|kirim|confirm|batalkan)\b/.test(args);
    const daysMatch = args.match(/\b(\d+)\s*d\b/);
    const daysBack = daysMatch ? Math.min(14, Math.max(1, Number(daysMatch[1]) || 0)) : 0;

    let network = null;
    if (!stuckOnly) {
      const cleaned = args
        .replace(/\b(\d+)\s*d\b/g, ' ')
        .replace(/\b(yes|ya|kirim|confirm|batalkan|stuck)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const { networks, invalid } = parseNetworkFilter(cleaned);
      if (invalid.length) {
        await ctx.reply(
          `Platform tidak dikenal: ${invalid.join(', ')}\n\n` +
            'Contoh:\n' +
            '• `/stop` — lihat antrian + cara batalkan\n' +
            '• `/stop ig` — antrian Instagram saja\n' +
            '• `/stop stuck` — pending >2 jam\n' +
            '• `/stop ig ya` — batalkan batch IG pending\n' +
            '• `/stop 4d ig` — scan 4 hari terakhir (IG)\n' +
            '• `/stop 4d ig ya` — cancel pending 4 hari terakhir (IG)',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      if (networks.length === 1) network = networks[0];
    }

    await ctx.reply('⏳ Mengecek antrian pending di Outstand…');

    try {
      const data = daysBack
        ? await listPendingRecent({
            daysBack,
            network: network || undefined,
            stuckOnly,
          })
        : await listPendingToday({
            network: network || undefined,
            stuckOnly,
          });

      if (!data.pending.length) {
        await safeReply(ctx, formatPendingReport(data), { parse_mode: 'Markdown' });
        return;
      }

      if (!doCancel) {
        const byPost = groupPendingByPostId(data);
        const postIds = [...byPost.keys()].filter((id) => id !== '(tanpa-id)');
        updateSession(ctx.chat.id, { pendingStopPostIds: postIds });

        await safeReply(
          ctx,
          formatPendingReport(data) +
            (daysBack ? `\n\n🔎 Mode scan: *${daysBack} hari terakhir*` : '') +
            '\n\n⚠️ *Batalkan semua batch di atas?*\n' +
            'Ketik `/stop ya` atau `/stop ig ya` (sesuai filter).\n' +
            (daysBack ? `Atau: \`/stop ${daysBack}d ya\`` : '') +
            '_Ini menghentikan antrian Outstand — post yang sudah live di IG tidak terhapus._',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🛑 Ya, batalkan antrian', 'stop:confirm')],
              [Markup.button.callback('❌ Batal', 'stop:abort')],
            ]),
          }
        );
        return;
      }

      const byPost = groupPendingByPostId(data);
      const postIds = [...byPost.keys()].filter((id) => id !== '(tanpa-id)');
      const results = await cancelPendingPostIds(postIds);
      clearPublishedTodayCache();

      await safeReply(ctx, formatCancelResults(results), {
        parse_mode: 'Markdown',
      });
      await runSyncTodayCommand(ctx).catch(() => {});
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  bot.action('stop:confirm', async (ctx) => {
    await ack(ctx, 'Membatalkan…');
    const session = getSession(ctx.chat.id);
    const postIds = session.pendingStopPostIds || [];
    if (!postIds.length) {
      await ctx.reply('Daftar kosong. Ketik `/stop` dulu.');
      return;
    }
    const results = await cancelPendingPostIds(postIds);
    clearPublishedTodayCache();
    updateSession(ctx.chat.id, { pendingStopPostIds: undefined });
    await safeReply(ctx, formatCancelResults(results), { parse_mode: 'Markdown' });
    await runSyncTodayCommand(ctx).catch(() => {});
  });

  bot.action('stop:abort', async (ctx) => {
    await ack(ctx);
    updateSession(ctx.chat.id, { pendingStopPostIds: undefined });
    await ctx.reply('Dibatalkan. Antrian Outstand tidak diubah.');
  });

  bot.command('antrian', async (ctx) => {
    ctx.message.text = `/stop ${(ctx.message.text || '').replace(/^\/antrian(@\w+)?\s*/i, '')}`;
    return ctx.telegram.callApi('sendMessage', ctx.message).catch(() => {
      const args = (ctx.message.text || '').replace(/^\/antrian(@\w+)?\s*/i, '').trim();
      ctx.message.text = `/stop ${args}`;
    });
  });

  bot.command('stuck', async (ctx) => {
    await ctx.reply('⏳ Mengecek akun pending lama…');
    try {
      const { hoursSincePost, isPendingStuck } = await import(
        '../utils/postStatus.js'
      );
      const data = await collectTodayPublishLinks();

      const livePairs = new Set();
      for (const a of data.accounts) {
        const st = (a.status || '').toLowerCase();
        if (st === 'published') {
          const key = `${(a.network || '').toLowerCase()}:${(a.username || '').replace(/^@/, '').toLowerCase()}`;
          livePairs.add(key);
        }
      }

      const stuck = data.accounts.filter((a) => {
        if (!isPendingStuck(a)) return false;
        const key = `${(a.network || '').toLowerCase()}:${(a.username || '').replace(/^@/, '').toLowerCase()}`;
        if (livePairs.has(key)) return false;
        return true;
      });
      if (!stuck.length) {
        updateSession(ctx.chat.id, { stuckSnapshot: undefined });
        await ctx.reply(
          `✅ Tidak ada akun pending >2 jam (tab ${data.tabName}).`
        );
        return;
      }

      stuck.sort((a, b) => hoursSincePost(b) - hoursSincePost(a));

      const seenPair = new Set();
      const stuckUnique = [];
      for (const a of stuck) {
        const key = `${(a.network || '').toLowerCase()}:${(a.username || a.accountId || '').replace(/^@/, '').toLowerCase()}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        stuckUnique.push(a);
      }

      /** @type {Record<string, string[]>} */
      const usernamesByNetwork = {};
      const postIdsSet = new Set();
      for (const a of stuckUnique) {
        const net = (a.network || '').toLowerCase();
        const user = (a.username || a.accountId || '').replace(/^@/, '');
        if (!net || !user) continue;
        if (!usernamesByNetwork[net]) usernamesByNetwork[net] = [];
        if (!usernamesByNetwork[net].includes(user)) {
          usernamesByNetwork[net].push(user);
        }
        if (a.postId) postIdsSet.add(a.postId);
      }

      updateSession(ctx.chat.id, {
        stuckSnapshot: {
          usernamesByNetwork,
          postIds: [...postIdsSet],
          total: stuckUnique.length,
          at: Date.now(),
        },
      });

      const lines = stuckUnique.slice(0, 25).map((a) => {
        const h = Math.round(hoursSincePost(a));
        const net = (a.network || '?').toLowerCase();
        const user = (a.username || a.accountId || '').replace(/^@/, '');
        const profileUrl =
          net === 'instagram'
            ? `https://www.instagram.com/${user}/`
            : net === 'threads'
              ? `https://www.threads.net/@${user}`
              : net === 'facebook'
                ? `https://www.facebook.com/${user}`
                : '';
        return (
          `• *${net}* @${user} — ${h} jam` +
          (profileUrl ? `\n  ${profileUrl}` : '')
        );
      });

      const extra =
        stuckUnique.length > 25 ? `\n_…+${stuckUnique.length - 25} akun_` : '';

      const buttons = Object.entries(usernamesByNetwork).map(([net, users]) => [
        Markup.button.callback(
          `🔄 Republish ${net} (${users.length})`,
          `stuck:retry:${net}`
        ),
      ]);
      buttons.push([
        Markup.button.callback('🔁 Refresh status', 'stuck:refresh'),
      ]);

      await ctx.reply(
        `⌛ *Pending >2 jam* — ${stuckUnique.length} akun\n` +
          `Tab ${data.tabName}\n\n` +
          lines.join('\n') +
          extra +
          '\n\n*Sebelum republish:*\n' +
          '1. Batalkan antrian lama: `/stop` (disarankan)\n' +
          '2. Cek profil — kalau sudah live → `/refresh`\n' +
          '3. Jangan retry kalau konten kemarin — `/publish` folder hari ini\n\n' +
          '_Republish = media batch lama. Bot skip akun yang sudah live._',
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  bot.action('stuck:refresh', async (ctx) => {
    await ctx.answerCbQuery('Sync ulang…').catch(() => {});
    await runSyncTodayCommand(ctx);
  });

  bot.action(/^stuck:retry:(.+)$/, async (ctx) => {
    const network = ctx.match[1];
    const session = getSession(ctx.chat.id);
    const snap = session.stuckSnapshot;

    if (!snap || Date.now() - snap.at > 30 * 60_000) {
      await ctx.answerCbQuery('Daftar stuck kadaluarsa, ketik /stuck lagi').catch(
        () => {}
      );
      await ctx.reply('⌛ Daftar stuck >30 menit. Jalankan /stuck lagi.');
      return;
    }

    const usernames = (snap.usernamesByNetwork[network] || []).map((u) =>
      u.replace(/^@/, '').toLowerCase()
    );
    if (!usernames.length) {
      await ctx.answerCbQuery('Tidak ada akun').catch(() => {});
      return;
    }

    await ctx.answerCbQuery(`Cek ${usernames.length} akun ${network}…`).catch(
      () => {}
    );

    try {
      const { isRateLimitMaybeLiveError } = await import(
        '../utils/accountDayUsage.js'
      );

      const { archive, postIds: resolvedPostIds, session: sess } =
        await resolveRetrySource(ctx.chat.id, snap.postIds);

      const postIds = resolvedPostIds.length ? resolvedPostIds : snap.postIds;

      if (!postIds.length) {
        await ctx.reply(
          '❌ Tidak ada Post ID untuk dicek. Coba `/stuck` lagi.'
        );
        return;
      }

      const { accounts } = await fetchPublishAccountStatuses({
        postIds,
        expectedAccountIds: [],
        baseCaption: archive?.caption || sess.caption || '',
      });

      /** @type {Array<{ a: object, reason: string }>} */
      const skipped = [];
      const candidates = [];
      for (const a of accounts) {
        if ((a.network || '').toLowerCase() !== network) continue;
        const u = (a.username || '').replace(/^@/, '').toLowerCase();
        if (!usernames.includes(u)) continue;

        const st = (a.status || '').toLowerCase();
        if (st === 'published') {
          skipped.push({ a, reason: 'sudah live (Outstand)' });
          continue;
        }
        if (st === 'failed' && isRateLimitMaybeLiveError(a.error)) {
          skipped.push({ a, reason: 'rate limit — cek profil dulu' });
          continue;
        }
        candidates.push(a);
      }

      const seen = new Set();
      const planAccounts = [];
      for (const a of candidates) {
        const id = a.accountId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        planAccounts.push(a);
      }

      const escapeUser = (s) =>
        String(s || '').replace(/[_*`[\]]/g, '\\$&');

      if (!planAccounts.length) {
        const skippedLines = skipped.slice(0, 10).map((s) => {
          const u = escapeUser((s.a.username || '').replace(/^@/, ''));
          return `• @${u} — _${s.reason}_`;
        });
        await safeReply(
          ctx,
          `⚠️ Tidak ada akun *${network}* yang masih layak retry dari daftar stuck.\n\n` +
            (skippedLines.length
              ? skippedLines.join('\n') + '\n\n'
              : '') +
            `Tips: \`/refresh\` dulu, lalu \`/stuck\` lagi untuk daftar terbaru.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const accountIds = planAccounts.map((a) => a.accountId);
      const preview = planAccounts
        .slice(0, 10)
        .map((a) => `@${escapeUser((a.username || '').replace(/^@/, ''))}`)
        .join(', ');
      const more = planAccounts.length > 10
        ? ` _+${planAccounts.length - 10} lagi_`
        : '';

      updateSession(ctx.chat.id, {
        retryAccountIds: accountIds,
        retryAccountIdsWithWait: accountIds,
        retryPostIds: postIds,
        retryNetwork: network,
        outstandPostIds: postIds,
      });

      const mediaNote =
        archive?.mediaFiles?.length || archive?.folderId
          ? ''
          : '\n\n📎 _Media arsip kosong. Sebelum konfirmasi, kirim link Drive yang sama persis._';

      await safeReply(
        ctx,
        `🔄 *Republish dari /stuck — ${network}*\n` +
          `Akun siap retry: *${planAccounts.length}*\n` +
          `${preview}${more}\n\n` +
          `⚠️ Pastikan job pending di dashboard Outstand sudah di-*cancel* dulu (cegah dobel).\n` +
          `Safety filter aktif: akun yang sudah live / sudah ≥2× attempt otomatis di-skip saat konfirmasi.` +
          mediaNote,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Kirim sekarang', 'retry:send')],
            [Markup.button.callback('❌ Batal', 'retry:cancel')],
          ]),
        }
      );
    } catch (err) {
      await ctx.reply(`❌ Republish gagal: ${err.message}`);
    }
  });

  bot.command('links', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const args = (ctx.message.text || '')
      .replace(/^\/links(@\w+)?\s*/i, '')
      .trim();
    const postIds = args
      ? args.split(/[\s,]+/).filter(Boolean)
      : session.lastPublish?.postIds || session.outstandPostIds || [];

    if (!postIds.length) {
      await ctx.reply(
        '📎 Ambil semua link post yang sudah live:\n\n' +
          '`/links atyGb, vSTXg, MgkAC, nH72l`\n\n' +
          'Post ID ada di pesan setelah publish. Tanpa argumen = publish terakhir di sesi ini.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply('⏳ Mengambil link dari Outstand…');
    try {
      const { accounts, meta, postIdLine } = await fetchPublishAccountStatuses({
        postIds,
        expectedAccountIds:
          session.lastPublish?.selectedAccountIds ||
          session.selectedAccountIds,
        baseCaption: session.lastPublish?.caption || session.caption || '',
      });

      const report = formatPublishLinksReport(accounts, postIdLine);
      await replyTelegramLong(ctx, report);

      const { url } = await ensureSpreadsheetReady().catch(() => ({ url: '' }));
      await ctx.reply(
        `Ringkasan: ${meta.published} live · ${meta.failed} gagal · ${meta.pending} pending\n` +
          (url
            ? `📊 Sheets: kolom *per platform* (@ + Link berdampingan).\n/synctoday = rapikan tab · /syncsheet = perbarui Post ID.\n${url}`
            : 'Tip: /syncsheet untuk salin semua link ke Google Sheets.')
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal ambil link: ${err.message}`);
    }
  });

  bot.command('syncsheet', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const args = (ctx.message.text || '')
      .replace(/^\/syncsheet(@\w+)?\s*/i, '')
      .trim();
    const postIds = args
      ? args.split(/[\s,]+/).filter(Boolean)
      : session.lastPublish?.postIds || session.outstandPostIds || [];

    if (!postIds.length) {
      await ctx.reply(
        'Kirim Post ID Outstand:\n`/syncsheet atyGb, vSTXg, MgkAC, nH72l`\n\n' +
          'Atau publish dulu — bot akan ingat Post ID terakhir.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply('⏳ Menyinkronkan Sheets dari Outstand…');
    try {
      const result = await refreshPublishResultsInSheet({
        postIds,
        expectedAccountIds:
          session.lastPublish?.selectedAccountIds ||
          session.selectedAccountIds,
        baseCaption: session.lastPublish?.caption || session.caption || '',
      });
      await ctx.reply(
        `✅ Sheets diperbarui\n` +
          `${result.recorded} akun · ${result.summary.statusSummary}\n` +
          `${result.summary.published} live · ${result.summary.failed} gagal · ${result.summary.pending} pending\n` +
          `${result.spreadsheetUrl}\n\n` +
          `Salin link di Telegram: /links ${postIds.join(', ')}`
      );
    } catch (err) {
      await ctx.reply(`❌ Sync gagal: ${err.message}`);
    }
  });

  bot.command('random', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const args = (ctx.message.text || '').replace(/^\/random(@\w+)?\s*/i, '').trim();

    if (!session.mediaFiles?.length) {
      await ctx.reply(
        'Kirim *media* dulu (link Drive / foto / broadcast misi), lalu:\n' +
          '`/random ig 22 fb 22`',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }

    if (!args) {
      updateSession(ctx.chat.id, { step: 'awaiting_random_counts' });
      await ctx.reply(formatRandomPickHelp(), { parse_mode: 'Markdown' });
      return;
    }

    await handleRandomAccountPick(ctx, args);
  });

  bot.command('republish', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const last = session.lastPublish || loadPublishArchive(ctx.chat.id);
    if (!last) {
      await ctx.reply(
        'Belum ada publish tersimpan.\nSelesaikan satu publish dulu, lalu /republish.\n\n' +
          'Atau `/retry ig` untuk ulangi akun gagal hari ini.',
        mainMenuKeyboard()
      );
      return;
    }

    const archiveStale = getArchiveStaleReason(last);
    if (archiveStale?.reason === 'day-changed') {
      await safeReply(
        ctx,
        `🛑 Publish terakhir dari hari *${archiveStale.prevDay}*.\n\n` +
          'Gunakan `/publish` + folder Drive hari ini — jangan `/republish` untuk konten kemarin.',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }

    let mediaFiles = last.mediaFiles;
    if (!mediaFiles?.length) {
      mediaFiles = (await hydrateMediaFromArchive(last)) || [];
    }
    if (!mediaFiles?.length) {
      await ctx.reply(
        'Media arsip tidak ditemukan.\nKirim link Drive yang sama lalu `/retry ig kirim`.',
        mainMenuKeyboard()
      );
      return;
    }

    updateSession(ctx.chat.id, {
      mediaFiles,
      folderName: last.folderName,
      folderId: last.folderId,
      caption: last.caption,
      captionsByNetwork: undefined,
      selectedAccountIds: undefined,
      targetLabel: undefined,
      step: 'selecting_targets',
      lastPublish: { ...last, mediaFiles },
    });
    await ctx.reply(
      `♻️ *Republish* — media: ${last.folderName || 'konten sebelumnya'}\n` +
        `Caption sebelumnya tetap dipakai.\n\nPilih *target baru*:`,
      { parse_mode: 'Markdown' }
    );
    await showTargetPicker(ctx);
  });

  bot.command('retry', async (ctx) => {
    try {
      const parsed = parseRetryCommand(ctx.message.text || '');
      await ctx.reply(
        parsed.send
          ? '⏳ Publish ulang akun gagal…'
          : '⏳ Menganalisis akun gagal…'
      );
      if (
        !parsed.send &&
        !parsed.postIds.length &&
        !getSession(ctx.chat.id).lastPublish?.postIds?.length
      ) {
        await ctx.reply(
          'Tip: lebih cepat dengan Post ID spesifik:\n' +
            '`/retry 1dHcG ig yeseniamandiri kirim`',
          { parse_mode: 'Markdown' }
        );
      }
      await handleRetryPublish(ctx, {
        send: parsed.send,
        network: parsed.network,
        postIds: parsed.postIds,
        usernames: parsed.usernames || [],
      });
    } catch (err) {
      log.error({ err: err?.message, stack: err?.stack }, `[Bot] /retry: ${err?.message || err}`);
      await ctx.reply(`❌ Retry gagal: ${err.message}`).catch(() => {});
    }
  });

  bot.action('retry:send', async (ctx) => {
    const session = getSession(ctx.chat.id);
    await ctx.answerCbQuery('Mengirim…').catch(() => {});
    await handleRetryPublish(ctx, {
      send: true,
      network: session.retryNetwork || null,
      postIds: session.retryPostIds || [],
      forcedRetryIds:
        session.retryAccountIds && session.retryAccountIds.length
          ? session.retryAccountIds
          : undefined,
    });
  });

  bot.action('retry:cancel', async (ctx) => {
    await ctx.answerCbQuery('Dibatalkan').catch(() => {});
    updateSession(ctx.chat.id, {
      retryAccountIds: undefined,
      retryAccountIdsWithWait: undefined,
      retryPostIds: undefined,
      retryNetwork: undefined,
    });
    await ctx.reply('❌ Retry dibatalkan.');
  });

  bot.action('target:all', async (ctx) => {
    const accounts = await listSocialAccounts();
    await finalizeTargetSelection(
      ctx,
      accounts.map((a) => a.id),
      `Semua akun (${accounts.length})`
    );
  });

  bot.action('target:back', async (ctx) => {
    await ack(ctx);
    await showTargetPicker(ctx);
  });

  bot.action(/^netpick:(.+)$/, async (ctx) => {
    const net = ctx.match[1].toLowerCase();
    await ack(ctx);
    await showNetworkAccountPicker(ctx, net);
  });

  bot.action(/^netall:(.+)$/, async (ctx) => {
    const net = ctx.match[1].toLowerCase();
    const accounts = await listSocialAccounts();
    const filtered = accounts.filter(
      (a) => (a.network || '').toLowerCase() === net
    );
    const label = NETWORK_LABELS[net] || net;
    await finalizeTargetSelection(
      ctx,
      filtered.map((a) => a.id),
      `Semua ${label} (${filtered.length})`
    );
  });

  bot.action(/^accttog:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await ack(ctx);
    const session = getSession(ctx.chat.id);
    const network = session.accountPickNetwork;
    if (!network) {
      await ctx.reply('Sesi kadaluarsa. Pilih target lagi.');
      return;
    }

    const selected = new Set(session.accountPickSelected || []);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);

    updateSession(ctx.chat.id, { accountPickSelected: [...selected] });
    if (network === '__multi__') {
      await refreshGlobalAccountPicker(ctx);
    } else {
      await refreshAccountPicker(ctx);
    }
  });

  bot.action(/^acctdone:(.+)$/, async (ctx) => {
    const network = ctx.match[1].toLowerCase();
    const session = getSession(ctx.chat.id);
    const ids = session.accountPickSelected || [];
    if (!ids.length) {
      await ack(ctx, 'Pilih minimal 1 akun');
      return;
    }
    await ack(ctx);

    const accounts = await listSocialAccounts();
    const picked = accounts.filter((a) => ids.includes(a.id));
    const names = picked
      .map((a) => `@${(a.username || a.id).replace(/^@/, '')}`)
      .join(', ');
    const label =
      network === '__multi__'
        ? `Multi (${ids.length}): ${names.slice(0, 120)}${names.length > 120 ? '…' : ''}`
        : `${NETWORK_LABELS[network] || network}: ${names} (${ids.length})`;
    await finalizeTargetSelection(ctx, ids, label);
  });

  bot.action('target:multi', async (ctx) => {
    await ack(ctx);
    await showGlobalAccountPicker(ctx);
  });

  bot.action('target:random', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.chat.id);
    if (!session.mediaFiles?.length) {
      await ctx.reply('Sesi media hilang. Ketik /publish lagi.');
      return;
    }
    updateSession(ctx.chat.id, { step: 'awaiting_random_counts' });
    await ctx.reply(formatRandomPickHelp(), { parse_mode: 'Markdown' });
  });

  bot.action(/^tone:(.+)$/, async (ctx) => {
    const toneKey = ctx.match[1];
    await ack(ctx);
    const session = getSession(ctx.chat.id);
    if (!session.selectedAccountIds?.length) {
      await ctx.reply('Sesi kadaluarsa. /publish lagi.');
      return;
    }

    if (toneKey !== 'skip' && toneKey !== 'change') {
      updateSession(ctx.chat.id, { captionTone: toneKey, caption: undefined });
    } else if (toneKey === 'change') {
      await showTonePicker(ctx, session.targetLabel || 'Target');
      return;
    } else {
      updateSession(ctx.chat.id, { captionTone: undefined });
    }

    const accounts = await listSocialAccounts();
    const selected = accounts.filter((a) =>
      session.selectedAccountIds.includes(a.id)
    );
    const networks = [
      ...new Set(
        selected.map((a) => (a.network || '').toLowerCase()).filter(Boolean)
      ),
    ];
    await generateCaptionAndShowPreview(
      ctx,
      session.selectedAccountIds,
      session.targetLabel || 'Target',
      networks
    );
  });

  bot.action(/^sched:(.+)$/, async (ctx) => {
    const pick = ctx.match[1];
    await ack(ctx);
    if (pick === 'cancel') {
      updateSession(ctx.chat.id, { step: 'ready' });
      await ctx.reply('Jadwal dibatalkan.', actionKeyboard());
      return;
    }
    if (pick === 'manual') {
      await ctx.reply(formatScheduleHelp(), { parse_mode: 'Markdown' });
      return;
    }
    const parsed = parseScheduleInput(pick);
    if (!parsed || parsed.getTime() <= Date.now()) {
      await ctx.reply('Jadwal tidak valid.');
      return;
    }
    const iso = parsed.toISOString();
    updateSession(ctx.chat.id, { scheduledAt: iso, step: 'ready' });
    await ctx.reply(`📅 Jadwal dipilih — mempublish…`);
    await runPublish(ctx, iso);
  });

  bot.action('target:change', async (ctx) => {
    await ack(ctx);
    await showTargetPicker(ctx);
  });

  bot.action(/^browse:(.+):(\d+)$/, async (ctx) => {
    const folderId = ctx.match[1];
    const page = Number(ctx.match[2]) || 0;
    await ack(ctx);
    try {
      const entry = await resolveDriveEntry(folderId);
      await showContentPicker(ctx, entry, page);
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  bot.action(/^folder:(.+)$/, handleFolderSelect);
  bot.action(/^pack:(.+)$/, handlePackSelect);
  bot.action(/^file:(.+)$/, handleFileSelect);
  bot.action(/^action:(send|schedule|edit)$/, handleAction);

  bot.on(['photo', 'video', 'document'], async (ctx) => {
    if (!extractTelegramMedia(ctx)) return;
    await processTelegramMedia(ctx);
  });

  bot.on('text', handleTextMessage);

  bot.catch((err, ctx) => {
    log.error(
      { err: err?.message || String(err), stack: err?.stack },
      `[Bot] unhandled: ${err?.message || err}`,
    );
    const hint =
      err?.response?.description ||
      err?.description ||
      err?.message ||
      'unknown';
    const code = err?.response?.error_code ?? err?.code;
    const isHandlerTimeout = /timed out after/i.test(String(hint));
    const session = ctx?.chat?.id ? getSession(ctx.chat.id) : null;
    const postIds =
      session?.outstandPostIds?.length
        ? session.outstandPostIds.join(', ')
        : session?.lastPublish?.postIds?.join(', ');

    if (isHandlerTimeout && postIds) {
      ctx
        .reply?.(
          `⏳ Proses publish masih berjalan di background (Telegram timeout).\n\n` +
            `Post ID: ${postIds}\n` +
            `Sheets akan diperbarui otomatis jika sudah tercatat.\n\n` +
            `Cek status: \`/links ${postIds}\` atau \`/syncsheet ${postIds}\``
        )
        .catch(() => {});
      return;
    }

    // Telegram rate limit — sebagian message kemungkinan sudah terkirim
    // (chunk awal). Beri pesan ramah, jangan tampilkan kode error mentah.
    if (code === 429) {
      const retryAfter =
        err?.response?.parameters?.retry_after ??
        err?.parameters?.retry_after ??
        '';
      ctx
        .reply?.(
          `⏳ Telegram limit kirim message tercapai${retryAfter ? ` (tunggu ${retryAfter}s)` : ''}.\n\n` +
            `Sebagian message mungkin sudah terkirim di atas. Coba ulang dalam 30 detik, atau buka Sheets untuk laporan lengkap.`
        )
        .catch(() => {});
      return;
    }

    ctx
      .reply?.(
        `❌ Error: ${String(hint).slice(0, 300)}\n\nCoba /publish lalu kirim link Drive atau video.`
      )
      .catch(() => {});
  });

  botInstance = bot;
  return bot;
}

export async function startBot() {
  const bot = createBot();
  const me = await bot.telegram.getMe();
  log.info({ username: me.username }, `[Bot] Terhubung sebagai @${me.username}`);

  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Menu utama' },
      { command: 'menu', description: 'Tampilkan menu tombol' },
      { command: 'publish', description: 'Publish konten baru' },
      { command: 'sheet', description: 'Link laporan Sheets' },
      { command: 'cancel', description: 'Batalkan sesi' },
      { command: 'status', description: 'Cek status Post ID' },
      { command: 'ping', description: 'Cek bot online' },
      { command: 'kuota', description: 'Kuota upload harian & sisa sesi' },
      { command: 'republish', description: 'Publish ulang ke target lain' },
      { command: 'retry', description: 'Ulangi akun yang gagal' },
      { command: 'refresh', description: 'Sync status Outstand → Sheets' },
      { command: 'stop', description: 'Lihat/batalkan antrian pending Outstand' },
      { command: 'stuck', description: 'Akun pending >2 jam' },
      { command: 'linkshari', description: 'Link post hari ini (filter: ig/fb/yt/dll)' },
      { command: 'misi', description: 'Lihat misi hari ini' },
    ]);
  } catch (err) {
    log.warn({ err: err.message }, `[Bot] setMyCommands: ${err.message}`);
  }

  bot.launch({ dropPendingUpdates: true });
  log.info('[Bot] Telegram bot started (long polling)');
  return bot;
}
