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
  getCachedAccounts,
  publishBulk,
  uploadMediaForTargets,
  waitForPostsSettled,
  getPost,
  fetchCaptionFromPostIds,
  listRecentPostIds,
  cancelOutstandPost,
} from './publisher.js';
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
  isStaleMediaBatch,
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
  rewriteDailyTabFromAccounts,
  deleteOldDailyTabs,
  upsertPublishEventRow,
  registerPublishContext,
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
  replyCancelResults,
  buildOutstandCancelSupportDraft,
  isPostIdCancelled,
  markPostIdCancelled,
  parseStopCommandArgs,
  markPostIdsStoppedLocally,
  formatLocalStopMarkResults,
} from './pendingControl.js';
import {
  markPostIdsKnown,
  checkForUnexpectedPosts,
} from './unexpectedPostMonitor.js';
import {
  collectTodayPublishLinks,
  syncTodayToSheet,
  getPublishedAccountIdsToday,
  getTouchedAccountIdsToday,
  getTodayAccountUsageCounts,
  clearPublishedTodayCache,
} from './todayPublish.js';
import { buildAuditFromSheets } from './audit.js';
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
  sendTelegramDocument,
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
  fillShortageFromExcludedPool,
} from '../utils/randomAccountPick.js';
import {
  looksLikeNamedPick,
  parseNamedPickCommand,
  resolveNamedPick,
  buildNamedPickLabel,
  formatNamedPickSummary,
  formatNamedPickHelp,
} from '../utils/namedAccountPick.js';
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
  classifyRetryError,
  RETRY_ACTION,
} from '../utils/retryPublish.js';
import {
  computePublishPollPlan,
  formatPollWaitHint,
  formatLargeBatchFollowUp,
} from '../utils/publishPoll.js';
import {
  countTargetsByNetwork,
  analyzeInstructionCompletion,
  formatInstructionResultLines,
} from '../utils/publishInstruction.js';
import {
  parseAkunCommandArgs,
  buildAccountIssueMap,
  buildTodayFailureMap,
  formatCekAkunReport,
  issueBadge,
} from '../utils/accountHealth.js';
import {
  loadSkipList,
  addToSkipList,
  removeFromSkipList,
  clearSkipList,
  resolveSkipIds,
} from '../utils/skipList.js';
import {
  loadGroups,
  createGroup,
  removeFromGroup,
  deleteGroup,
  resolveGroupAccountIds,
  getGroup,
} from '../utils/accountGroups.js';
import {
  saveCaption,
  getCaption,
  deleteCaption,
  listCaptions,
} from '../utils/captionLibrary.js';
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
  const rows = [
    [Markup.button.callback('✍️ Caption sendiri (tanpa AI)', 'tone:manual')],
    ...Object.entries(CAPTION_TONES).map(([key, t]) => [
      Markup.button.callback(t.label, `tone:${key}`),
    ]),
    [Markup.button.callback('⏭ Judul folder saja (tanpa AI)', 'tone:skip')],
  ];
  return Markup.inlineKeyboard(rows);
}

/**
 * @param {Error | { message?: string }} err
 */
function isAIUnavailableError(err) {
  const raw = String(err?.message || err || '').toLowerCase();
  return (
    /403|401|forbidden|dunning|api key|gemini|generativelanguage|quota|resource_exhausted|anthropic|overloaded|rate.?limit|billing/i.test(
      raw
    )
  );
}
/** @deprecated alias lama */
const isGeminiUnavailableError = isAIUnavailableError;

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} [reason]
 */
async function promptManualCaption(ctx, reason) {
  updateSession(ctx.chat.id, { step: 'awaiting_manual_caption', captionTone: undefined });
  let msg =
    '✍️ *Caption manual* (tanpa AI)\n\n' +
    'Kirim *satu pesan* teks caption. Bot akan menyesuaikan panjang per platform (IG/Threads/FB/YT).\n\n' +
    '_Setelah preview, masih bisa *Edit Caption* sebelum Send Now._';
  if (reason) {
    msg = `${reason}\n\n${msg}`;
  }
  await safeReply(ctx, msg, { parse_mode: 'Markdown' });
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {string[]} accountIds
 * @param {string} label
 * @param {string[]} networks
 */
async function applyManualCaptionAndShowPreview(ctx, text, accountIds, label, networks) {
  const session = getSession(ctx.chat.id);
  const caption = String(text || '').trim();
  if (!caption) {
    await promptManualCaption(ctx, '❌ Caption kosong.');
    return;
  }

  const required = session.missionBriefing?.requiredHashtags || [];
  const captionsByNetwork = buildCaptionsByNetwork(caption, networks, required);
  const hasYoutube = networks.includes('youtube');
  const youtubeFields = hasYoutube
    ? buildYoutubePostFields(captionsByNetwork.youtube || caption)
    : undefined;

  updateSession(ctx.chat.id, {
    caption,
    captionsByNetwork,
    youtubeFields: youtubeFields || undefined,
    captionTone: undefined,
    step: 'ready',
  });
  await showReadyPreview(ctx, accountIds, label, networks);
}

/**
 * Caption sederhana tanpa panggilan Gemini (folder / misi).
 * @param {import('telegraf').Context} ctx
 * @param {string[]} accountIds
 * @param {string} label
 * @param {string[]} networks
 */
async function applyDefaultCaptionWithoutAi(ctx, accountIds, label, networks) {
  const session = getSession(ctx.chat.id);
  const theme =
    [session.folderName, session.driveRootName].filter(Boolean).join(' — ') ||
    'Konten';
  let base = `Update — ${theme}`;
  const hook = session.missionBriefing?.openingHook;
  if (hook && String(hook).trim()) {
    base = String(hook).trim().slice(0, 400);
  }
  await applyManualCaptionAndShowPreview(ctx, base, accountIds, label, networks);
}

async function showTonePicker(ctx, label) {
  await safeReply(
    ctx,
    `🎨 *Caption* untuk *${escapeMarkdown(label)}*\n\n` +
      `• *Caption sendiri* — ketik teks (Gemini tidak dipakai)\n` +
      `• *Judul folder saja* — caption singkat otomatis tanpa AI\n` +
      `• Tombol lain — buat caption pakai Gemini (butuh API aktif)`,
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
    preview += `Gaya AI: ${escapeMarkdown(getToneLabel(session.captionTone))}\n`;
  } else {
    preview += `_Caption manual / tanpa AI_\n`;
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

  try {
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
  } catch (err) {
    log.warn({ err: err.message }, `[Bot] AI caption: ${err.message}`);
    const hint = isAIUnavailableError(err)
      ? '⚠️ *Caption AI tidak bisa dipakai* (API/billing/quota).'
      : `⚠️ Caption AI gagal: ${escapeMarkdown(String(err.message || err).slice(0, 120))}`;
    await promptManualCaption(ctx, hint);
  }
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
  let accounts;
  try {
    accounts = await getCachedAccounts();
  } catch (err) {
    log.error({ err: err.message }, `[Bot] showTargetPicker: gagal muat akun: ${err.message}`);
    await safeReply(ctx, `❌ Gagal memuat daftar akun: ${err.message}`);
    return;
  }

  if (!accounts.length) {
    await ctx.reply(
      'Belum ada akun di Woopsocial.\nHubungkan dulu di dashboard → Social Accounts.'
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

  try {
    await ctx.reply(
      '🎯 Pilih target publish:\n' +
        '• *Semua akun* — satu tombol\n' +
        '• *Pilih beberapa* — centang manual\n' +
        '• *Acak* — ketik mis. `ig 22 fb 22` (22 IG + 22 FB acak)',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
    );
  } catch (err) {
    log.warn({ err: err.message }, `[Bot] showTargetPicker Markdown gagal, coba plain`);
    await ctx.reply(
      'Pilih target publish:',
      Markup.inlineKeyboard(rows)
    );
  }
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
  try {
    const skipUsernames = loadSkipList();
    if (skipUsernames.length) {
      const allAccounts = await listSocialAccounts();
      const skipIds = resolveSkipIds(skipUsernames, allAccounts);
      exclude = [...new Set([...exclude, ...skipIds])];
    }
  } catch (err) {
    log.warn({ err: err.message }, `[Bot] exclude skip list: ${err.message}`);
  }
  return exclude;
}

async function handleRandomAccountPick(ctx, text) {
  const forceRe = /\b(force|ulang|paksa|all)\b/i;
  const force = forceRe.test(text);
  let cleanText = text.replace(forceRe, '').trim();

  // Dukungan dari:namagrup — ganti akun pool dengan grup tertentu
  let groupFilter = null;
  const grupMatch = cleanText.match(/\bdari:(\S+)/i);
  if (grupMatch) {
    groupFilter = grupMatch[1];
    cleanText = cleanText.replace(grupMatch[0], '').trim();
  }

  // Stagger delay: delay 5m / delay 10menit / delay 30s
  let staggerMs = 0;
  const delayMatch = cleanText.match(/\bdelay\s+(\d+)\s*(m|mnt|menit|min|s|detik|sec|jam|h|hour)?\b/i);
  if (delayMatch) {
    const val = Number(delayMatch[1]);
    const unit = (delayMatch[2] || 'm').toLowerCase();
    staggerMs = unit.startsWith('s') || unit.startsWith('d')
      ? val * 1000
      : unit.startsWith('j') || unit.startsWith('h')
        ? val * 3_600_000
        : val * 60_000;
    cleanText = cleanText.replace(delayMatch[0], '').trim();
  }

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
      ? '⏳ Memilih akun acak (mode *force* — termasuk yang sudah post hari ini, boleh dobel)…'
      : '⏳ Memilih akun acak (lewati yang sudah post hari ini)…',
    { parse_mode: 'Markdown' }
  );

  let accounts = await listSocialAccounts();

  // Filter ke grup jika dari:namagrup dipakai
  if (groupFilter) {
    const groupIds = resolveGroupAccountIds(groupFilter, accounts);
    if (!groupIds.length) {
      await safeReply(ctx, `❌ Grup *${groupFilter}* tidak ditemukan atau kosong.\nBuat: \`/grup buat ${groupFilter} @acc1 @acc2\``, { parse_mode: 'Markdown' });
      return;
    }
    accounts = accounts.filter((a) => groupIds.includes(a.id));
    await safeReply(ctx, `📁 Pool dari grup *${groupFilter}*: ${accounts.length} akun`, { parse_mode: 'Markdown' });
  }

  const exclude = force ? [] : await getExcludeIdsForRandomPick(ctx.chat.id);
  // Saat mode force: buka cap reuse agar pool terbatas tetap bisa memenuhi
  // jumlah yang user minta (mis. minta 44 Threads tapi stok 39 → 5 akun
  // dipakai 2×). Saat mode normal, hormati cap default dari env.
  const maxReusePerAccount = force
    ? Math.max(2, env.maxReusePerAccount)
    : env.maxReusePerAccount;
  const result = pickRandomAccounts(accounts, parsed.counts, {
    excludeAccountIds: exclude,
    maxReusePerAccount,
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
      ? ` · ${result.accountIds.length - uniqueCount} pengulangan (maks ${maxReusePerAccount}×/akun)`
      : '') +
    (force
      ? `\n⚡ _Mode *force* — termasuk akun yang sudah post hari ini, boleh dobel sampai ${maxReusePerAccount}×/akun._`
      : exclude.length
        ? `\n_Lewati ${exclude.length} akun yang sudah dipakai / sudah live hari ini._`
        : '') +
    (sample ? `\nContoh: ${sample}${result.picked.length > 8 ? '…' : ''}` : '');

  if (result.warnings.length) {
    msg += `\n\n⚠️ ${result.warnings.join('\n')}`;
  }

  await safeReply(ctx, msg, { parse_mode: 'Markdown' });

  // Tawarkan: kalau ada shortage (mis. Threads minta 6 hanya dapat 1 karena
  // kuota sisa), tanya user mau isi sisa dari akun yang sudah dipakai hari
  // ini? Tidak auto — user harus konfirmasi.
  const shortages = (result.shortages || []).filter((s) => s.missing > 0);
  if (!force && shortages.length) {
    updateSession(ctx.chat.id, {
      pendingFillShortage: {
        baseAccountIds: result.accountIds,
        shortages,
        label: result.label,
        at: Date.now(),
      },
      step: 'selecting_targets',
    });

    const lines = shortages.map((s) => {
      const lab = getNetworkShortLabel(s.network);
      return `• *${lab}*: kurang *${s.missing}* akun (stok ${s.skippedUsed} sudah dipakai hari ini)`;
    });
    await safeReply(
      ctx,
      `📌 *Saran isi sisa slot?*\n` +
        lines.join('\n') +
        `\n\nMau aku tambah pengganti dari akun yang sudah pernah post hari ini?\n` +
        `_Bot tidak akan auto — silakan pilih._\n` +
        `Catatan: ini akan posting 2× ke beberapa akun. Hanya lakukan kalau memang perlu.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔥 Ya, isi sisa', 'randomfill:yes')],
          [Markup.button.callback('Lanjut tanpa isi', 'randomfill:skip')],
        ]),
      }
    );
    return;
  }

  updateSession(ctx.chat.id, {
    step: 'selecting_targets',
    publishStaggerMs: staggerMs > 0 ? staggerMs : undefined,
  });
  if (staggerMs > 0) {
    const minLabel = staggerMs >= 3_600_000
      ? `${Math.round(staggerMs / 3_600_000)} jam`
      : staggerMs >= 60_000
        ? `${Math.round(staggerMs / 60_000)} menit`
        : `${Math.round(staggerMs / 1000)} detik`;
    await safeReply(ctx, `⏱ Stagger aktif: delay *${minLabel}* antar platform.`, { parse_mode: 'Markdown' });
  }
  await finalizeTargetSelection(ctx, result.accountIds, result.label);
}

/**
 * Pisahkan bagian manual (/pick) dan random (+ random ig 1 threads 1).
 * @param {string} text
 * @returns {{ manualPart: string, randomCounts: Record<string, number> }}
 */
function splitPickAndRandom(text) {
  const lines = text.split('\n');
  let splitIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\+/.test(line) || /^\/random\b/i.test(line)) {
      splitIdx = i;
      break;
    }
  }

  if (splitIdx < 0) return { manualPart: text, randomCounts: {} };

  const manualPart = lines.slice(0, splitIdx).join('\n').trim();
  // Kumpulkan semua baris setelah "+", plus teks inline pada baris "+"
  const plusLineInline = lines[splitIdx].trim().replace(/^\+\s*/, '').replace(/^random\s*/i, '').replace(/^\/random\s*/i, '').trim();
  const afterLines = lines.slice(splitIdx + 1).join(' ').replace(/^\/random\s*/i, '').replace(/^random\s*/i, '').trim();
  const combinedRandom = [plusLineInline, afterLines].filter(Boolean).join(' ').trim();

  const parsed = combinedRandom ? parseRandomPickCommand(combinedRandom) : null;
  return { manualPart, randomCounts: parsed?.counts || {} };
}

async function handleNamedAccountPick(ctx, text) {
  // Pisah bagian manual dan "+ random ..."
  const { manualPart, randomCounts } = splitPickAndRandom(text);
  const hasRandom = Object.keys(randomCounts).length > 0;

  const parsed = parseNamedPickCommand(manualPart);
  if (!parsed && !hasRandom) {
    await safeReply(ctx, formatNamedPickHelp(), { parse_mode: 'Markdown' });
    return;
  }

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

  await safeReply(ctx, '⏳ Mencocokkan akun by name…', { parse_mode: 'Markdown' });

  const accounts = await listSocialAccounts();

  // Resolve akun manual (jika ada)
  const manualResult = parsed ? resolveNamedPick(accounts, parsed) : { accountIds: [], picked: [], notFound: [], ambiguous: [] };
  const manualIds = new Set(manualResult.accountIds);

  // Tambah akun random (jika ada bagian "+")
  let randomResult = { accountIds: [], warnings: [] };
  if (hasRandom) {
    const excludeIds = await getExcludeIdsForRandomPick(ctx.chat.id);
    // Exclude akun manual yang sudah dipilih agar random tidak tumpang tindih
    const randomExclude = [...new Set([...excludeIds, ...manualResult.accountIds])];
    randomResult = pickRandomAccounts(accounts, randomCounts, {
      excludeAccountIds: randomExclude,
      maxReusePerAccount: env.maxReusePerAccount,
    });
  }

  const combinedIds = [...new Set([...manualResult.accountIds, ...randomResult.accountIds])];

  if (!combinedIds.length) {
    let msg = '❌ Tidak ada akun yang valid.\n\n';
    if (parsed) msg += formatNamedPickSummary(manualResult, buildNamedPickLabel(manualResult.picked), { force: parsed.force });
    if (hasRandom && randomResult.warnings.length) msg += '\n\n*Random:*\n' + randomResult.warnings.join('\n');
    if (!manualResult.notFound.length && !manualResult.ambiguous.length && !hasRandom) msg += '\n\n' + formatNamedPickHelp();
    await safeReply(ctx, msg, { parse_mode: 'Markdown' });
    return;
  }

  // Tampilkan ringkasan
  const manualLabel = parsed ? buildNamedPickLabel(manualResult.picked) : '';
  if (parsed && manualResult.accountIds.length) {
    await safeReply(
      ctx,
      formatNamedPickSummary(manualResult, manualLabel, { force: parsed.force }),
      { parse_mode: 'Markdown' }
    );
  }
  if (hasRandom && randomResult.accountIds.length) {
    const escU = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');
    const randAccounts = accounts.filter((a) => randomResult.accountIds.includes(a.id));
    const sample = randAccounts.slice(0, 6).map((a) => escU((a.username || a.id).replace(/^@/, ''))).join(', ');
    await safeReply(
      ctx,
      `🎲 *Random tambahan: ${randomResult.accountIds.length} akun*\n${sample}${randAccounts.length > 6 ? ', …' : ''}` +
        (randomResult.warnings.length ? `\n\n⚠️ ${randomResult.warnings.join('\n')}` : ''),
      { parse_mode: 'Markdown' }
    );
  }

  // Label gabungan untuk preview publish
  const netCounts = {};
  for (const id of combinedIds) {
    const a = accounts.find((x) => x.id === id);
    if (!a) continue;
    const net = (a.network || 'other').toLowerCase();
    netCounts[net] = (netCounts[net] || 0) + 1;
  }
  const combinedLabel =
    `Pick+Random (${combinedIds.length}): ` +
    Object.entries(netCounts)
      .map(([net, n]) => `${NETWORK_LABELS[net] || net} ${n}`)
      .join(', ');

  updateSession(ctx.chat.id, {
    step: 'selecting_targets',
    pickForce: parsed?.force || undefined,
  });
  await finalizeTargetSelection(ctx, combinedIds, combinedLabel);
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
    const unselectedCount = accounts.filter((a) => !selected.has(a.id)).length;
    if (unselectedCount > 0) {
      rows.push([
        Markup.button.callback(
          `🎲 Tambah sisa secara acak (${unselectedCount})`,
          `acctrand:${network}`
        ),
      ]);
    }
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
    const unselectedCount = accounts.filter((a) => !selected.has(a.id)).length;
    if (unselectedCount > 0) {
      rows.push([
        Markup.button.callback(
          `🎲 Tambah sisa secara acak (${unselectedCount})`,
          'acctrand:__multi__'
        ),
      ]);
    }
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
    const unselectedCount = accounts.filter((a) => !selected.has(a.id)).length;
    if (unselectedCount > 0) {
      rows.push([
        Markup.button.callback(
          `🎲 Tambah sisa secara acak (${unselectedCount})`,
          'acctrand:__multi__'
        ),
      ]);
    }
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

    if (!hasSubs && entry.media.length === 1) {
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

  // Hard lock: jika ada publish lain sedang berjalan untuk chat ini, tolak.
  // `publishingSince` di-set di sini lalu di-clear di akhir / catch block.
  if (session.publishingSince && Date.now() - session.publishingSince < 15 * 60_000) {
    await ctx
      .reply(
        '⏳ Masih mempublish batch sebelumnya. Tunggu sampai laporan keluar atau ketik /cancel kalau yakin batch lama sudah selesai.'
      )
      .catch(() => {});
    return;
  }

  if (
    session.step !== 'ready' &&
    session.step !== 'awaiting_schedule' &&
    session.step !== 'publishing'
  ) {
    await ctx.reply('Sesi tidak valid. Ketik /publish untuk mulai lagi.');
    return;
  }

  updateSession(ctx.chat.id, {
    step: 'publishing',
    publishingSince: Date.now(),
  });

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
      updateSession(ctx.chat.id, { step: 'idle', publishingSince: undefined });
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
    updateSession(ctx.chat.id, { step: 'idle', publishingSince: undefined });
    return;
  }

  const staleNow = getStaleMediaReason(session);
  if (staleNow && staleNow.reason !== 'no-media') {
    await safeReply(ctx, formatStaleMediaNotice(staleNow, session), {
      parse_mode: 'Markdown',
    });
    clearSessionContent(ctx.chat.id);
    updateSession(ctx.chat.id, { step: 'awaiting_media', publishingSince: undefined });
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
    updateSession(ctx.chat.id, { step: 'selecting_targets', publishingSince: undefined });
    return;
  }

  const uniqueTargets = [...new Set(session.selectedAccountIds)];
  if (uniqueTargets.length < session.selectedAccountIds.length) {
    updateSession(ctx.chat.id, { selectedAccountIds: uniqueTargets });
  }

  const validation = await validateBeforePublish({
    mediaFiles: session.mediaFiles,
    selectedAccountIds: session.selectedAccountIds,
    caption: session.caption,
    folderName: session.folderName,
    targetLabel: session.targetLabel,
  });
  if (!validation.ok) {
    await ctx.reply(`❌ Tidak bisa publish:\n${validation.errors.join('\n')}`);
    updateSession(ctx.chat.id, { step: 'idle', publishingSince: undefined });
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

    // Snapshot semua field session yang masih dibutuhkan SETELAH publishBulk
    // (record sheets, mark used, scheduling refresh, follow-up poll).
    // Tanpa snapshot: clearSessionContent menghapus session.* lebih cepat
    // dari pemakaian → expectedAccountIds undefined → Sheets tidak ter-record
    // dengan benar dan markAccountsUsedForToday tidak mengisi exclude list
    // sehingga /random berikutnya bisa memilih akun yang sama lagi.
    const poolAccounts = await listSocialAccounts();
    const instructionTargets = countTargetsByNetwork(
      session.selectedAccountIds || [],
      poolAccounts
    );

    const snapshot = {
      selectedAccountIds: [...(session.selectedAccountIds || [])],
      mediaFiles: session.mediaFiles ? [...session.mediaFiles] : [],
      caption: session.caption || '',
      folderName: session.folderName || '',
      folderId: session.folderId || '',
      targetLabel: session.targetLabel || targetInfo,
      mediaFilesDay: session.mediaFilesDay || getWibDayKey(),
      mediaFilesSetAt: session.mediaFilesSetAt || nowIsoUtc(),
      idempotencyKey: session.lastPublishKey || '',
      instructionTargets,
      publishStaggerMs: session.publishStaggerMs || 0,
    };

    const {
      byNetwork: mediaByNetwork,
      imageToVideoNetworks,
      imageToVideoSilent,
    } = await uploadMediaForTargets(
      snapshot.mediaFiles,
      snapshot.selectedAccountIds
    );

    // Buffer sudah diterima Woopsocial — bebaskan segera supaya GC bisa collect
    for (const f of snapshot.mediaFiles) { f.buffer = undefined; }
    const _liveSess = getSession(chatId);
    if (_liveSess.mediaFiles) { for (const f of _liveSess.mediaFiles) { f.buffer = undefined; } }
    if (_liveSess.pendingReplacement?.mediaFiles) { for (const f of _liveSess.pendingReplacement.mediaFiles) { f.buffer = undefined; } }

    const allMediaIds = Object.values(mediaByNetwork)
      .flat()
      .map((m) => m.id);

    // Stagger: jika delay set, publish per-network dengan scheduledAt berbeda
    let result;
    if (snapshot.publishStaggerMs > 0 && !scheduledAt) {
      const netGroups = {};
      for (const id of snapshot.selectedAccountIds) {
        const a = poolAccounts.find((ac) => ac.id === id);
        if (!a) continue;
        const net = (a.network || 'unknown').toLowerCase();
        if (!netGroups[net]) netGroups[net] = [];
        netGroups[net].push(id);
      }
      const netEntries = Object.entries(netGroups);
      const allPostIds = [];
      let batchIdx = 0;
      for (const [, ids] of netEntries) {
        const batchScheduledAt = batchIdx === 0
          ? undefined
          : new Date(Date.now() + batchIdx * snapshot.publishStaggerMs).toISOString();
        const batchResult = await publishBulk({
          baseCaption: snapshot.caption,
          captionsByNetwork: session.captionsByNetwork,
          youtubeFields: session.youtubeFields,
          mediaByNetwork,
          scheduledAt: batchScheduledAt,
          socialAccountIds: ids,
        });
        allPostIds.push(...(batchResult.postIds || []));
        batchIdx++;
      }
      if (netEntries.length > 1) {
        const minLabel = snapshot.publishStaggerMs >= 3_600_000
          ? `${Math.round(snapshot.publishStaggerMs / 3_600_000)} jam`
          : `${Math.round(snapshot.publishStaggerMs / 60_000)} menit`;
        await ctx.reply(`⏱ Stagger: ${netEntries.length} platform dikirim dengan jeda *${minLabel}* per platform.`, { parse_mode: 'Markdown' });
      }
      result = { postIds: allPostIds, accountCount: snapshot.selectedAccountIds.length };
    } else {
      result = await publishBulk({
        baseCaption: snapshot.caption,
        captionsByNetwork: session.captionsByNetwork,
        youtubeFields: session.youtubeFields,
        mediaByNetwork,
        scheduledAt,
        socialAccountIds: snapshot.selectedAccountIds,
      });
    }

    const lastPublish = {
      mediaFiles: snapshot.mediaFiles,
      caption: snapshot.caption,
      folderName: snapshot.folderName,
      folderId: snapshot.folderId,
      targetLabel: targetInfo,
      postIds: result.postIds,
      selectedAccountIds: snapshot.selectedAccountIds,
      mediaFilesDay: snapshot.mediaFilesDay,
      instructionTargets: snapshot.instructionTargets,
      savedAt: nowIsoUtc(),
    };

    savePublishArchive(ctx.chat.id, lastPublish);

    // ANTI-DUPLIKAT: catat akun yang dipakai SEGERA setelah publishBulk
    // berhasil (jangan tunggu polling selesai), plus invalidate cache
    // "touched today" supaya /random berikutnya tidak memilih akun yang sama.
    markAccountsUsedForToday(ctx.chat.id, snapshot.selectedAccountIds);
    clearPublishedTodayCache();
    clearQuotaCache();

    // Catat Post ID baru sebagai "milik bot" supaya monitor "post tak terduga"
    // tidak salah alarm.
    markPostIdsKnown(result.postIds || []);

    // Kosongkan media/caption di sesi aktif supaya /random atau /republish
    // tidak bisa pakai konten batch ini lagi tanpa /publish + Drive baru.
    // Lock `publishing` SENGAJA dipertahankan sampai polling selesai supaya
    // double-tap Send Now tidak men-trigger submit baru.
    clearSessionContent(ctx.chat.id);
    updateSession(ctx.chat.id, {
      step: 'publishing',
      lastPublish,
      outstandPostIds: result.postIds,
      outstandMediaIds: allMediaIds,
    });

    log.info(
      {
        folder: snapshot.folderName,
        files: snapshot.mediaFiles.map((f) => f.name),
        postIds: result.postIds,
        accounts: snapshot.selectedAccountIds.length,
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
          `Status live akan muncul setelah waktu jadwal. Cek Woopsocial dashboard jika perlu.`
      );
      return;
    }

    const baseStatusText =
      `📤 Request diterima Woopsocial\n` +
      `Target: ${targetInfo}\n` +
      `Post ID: ${postIdLine}` +
      (imageToVideoNetworks?.length
        ? `\n🎬 Video dari gambar (${env.imageToVideoDurationSec}s${imageToVideoSilent ? ', tanpa musik' : ''}): ${imageToVideoNetworks.join(', ')}`
        : '') +
      `\n\n⏳ Mengecek status publish (${formatPollWaitHint(result.accountCount)})…`;

    const statusMsg = await ctx.reply(baseStatusText);

    // Capture sebelum handler Telegraf timeout — ctx.telegram tetap valid
    // bahkan setelah handler selesai, ctx.reply tidak.
    const chatId = ctx.chat.id;
    const telegram = ctx.telegram;
    const bgCtx = {
      chat: { id: chatId },
      reply: (text, opts) => telegram.sendMessage(chatId, text, opts),
      telegram,
    };

    const escU = (s) => String(s || '').replace(/_/g, '\\_');
    const fmtAccList = (accs, limit = 10) => {
      if (!accs?.length) return '';
      const shown = accs.slice(0, limit);
      const extra = accs.length > limit ? `\n  _…+${accs.length - limit} lagi_` : '';
      // Tidak pakai @ agar Telegram tidak auto-link nama yang mengandung spasi
      return '\n' + shown.map((a) => `  ${getNetworkShortLabel(a.network) || a.network} ${escU(a.username)}`).join('\n') + extra;
    };

    // Detach — handler Telegraf selesai di sini, polling jalan di background
    void (async () => {
      let lastEditMs = 0;
      let lastSheetRefreshMs = 0;
      const SHEET_REFRESH_INTERVAL_MS = 30_000;

      const pollPlan = computePublishPollPlan(result.accountCount);
      // Konversi gambar→video butuh lebih lama — minimal 3 menit jika ada platform video
      const hasVideoConversion = imageToVideoNetworks?.length > 0;
      // Woopsocial memproses delivery secara async — beri waktu minimal 4 menit
      const effectiveMaxWaitMs = Math.max(pollPlan.maxWaitMs, 4 * 60_000);
      const posts = await waitForPostsSettled(result.postIds, {
        maxWaitMs: effectiveMaxWaitMs,
        intervalMs: 3_000,
        onProgress: ({ published, failed, pending, elapsedMs, publishedAccounts, failedAccounts, pendingAccounts }) => {
          const now = Date.now();

          // Update Sheets setiap 30 detik selama polling
          if (now - lastSheetRefreshMs >= SHEET_REFRESH_INTERVAL_MS && (published > 0 || failed > 0)) {
            lastSheetRefreshMs = now;
            refreshPublishResultsInSheet({
              postIds: result.postIds,
              expectedAccountIds: snapshot.selectedAccountIds,
              baseCaption: snapshot.caption,
              folderName: snapshot.folderName,
              targetLabel: snapshot.targetLabel,
            }).catch(() => {});
          }

          if (now - lastEditMs < 4_000) return;
          lastEditMs = now;
          const sec = Math.round(elapsedMs / 1000);

          const lines = [
            `📤 Request diterima Woopsocial`,
            `Target: ${targetInfo}`,
            `Post ID: ${postIdLine}`,
            ``,
            `⏳ *Publish berjalan…* (${sec}s)`,
            `✅ ${published} selesai · ❌ ${failed} gagal · ⏳ ${pending} pending`,
          ];
          if (publishedAccounts?.length) lines.push(``, `*✅ Selesai:*${fmtAccList(publishedAccounts)}`);
          if (failedAccounts?.length) lines.push(``, `*❌ Gagal:*${fmtAccList(failedAccounts)}`);
          if (pendingAccounts?.length) lines.push(``, `*⏳ Pending:*${fmtAccList(pendingAccounts)}`);

          telegram
            .editMessageText(chatId, statusMsg.message_id, undefined, lines.join('\n'), { parse_mode: 'Markdown' })
            .catch(() => {});
        },
      });
      const summary = summarizePublishResults(posts, snapshot.caption);

      // Update pesan segera setelah polling selesai — beri tahu user bot masih kerja
      {
        const allAccs = (posts || []).flatMap((p) => p?.socialAccounts ?? []);
        const pubAccs = allAccs.filter((a) => a.status === 'published');
        const failAccs = allAccs.filter((a) => a.status === 'failed');
        const pendAccs = allAccs.filter((a) => a.status === 'pending');
        const postPollLines = [
          `📤 Request diterima Woopsocial`,
          `Target: ${targetInfo}`,
          `Post ID: ${postIdLine}`,
          ``,
          `📊 *Menyimpan ke Sheets…*`,
          `✅ ${summary.published} selesai · ❌ ${summary.failed} gagal · ⏳ ${summary.pending} pending`,
        ];
        if (pubAccs.length) postPollLines.push(``, `*✅ Selesai:*${fmtAccList(pubAccs)}`);
        if (failAccs.length) postPollLines.push(``, `*❌ Gagal:*${fmtAccList(failAccs)}`);
        if (pendAccs.length) postPollLines.push(``, `*⏳ Pending (masih proses):*${fmtAccList(pendAccs)}`);
        telegram.editMessageText(chatId, statusMsg.message_id, undefined, postPollLines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
      }

      // Update pesan ke "Selesai" — tidak tunggu Sheets supaya user langsung tahu
      telegram.editMessageText(
        chatId, statusMsg.message_id, undefined,
        `📤 Request diterima Woopsocial\nTarget: ${targetInfo}\nPost ID: ${postIdLine}\n\n` +
          `✅ *Selesai* — ✅ ${summary.published} live · ❌ ${summary.failed} gagal · ⏳ ${summary.pending} pending\n` +
          (summary.pending > 0 ? `_${summary.pending} akun masih proses — notifikasi otomatis dalam 5 mnt._` : ``),
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      // Kirim laporan + kuota ke user segera (tidak tunggu Sheets)
      const reportText =
        formatTelegramPublishReport(summary, postIdLine) +
        formatLargeBatchFollowUp(summary, pollPlan, postIdLine) +
        (summary.pending > 0 ? '\n\n_Webhook akan update jika masih pending._' : '');
      try {
        await replyTelegramLong(bgCtx, reportText);
      } catch (tgErr) {
        log.error({ err: tgErr?.message, stack: tgErr?.stack }, `[Bot] telegram report: ${tgErr?.message || tgErr}`);
        await telegram.sendMessage(
          chatId,
          `✅ Publish selesai (${summary.published} live · ${summary.failed} gagal · ${summary.pending} pending).\n` +
            `Laporan detail ada di Google Sheets (pesan Telegram terlalu panjang).`
        );
      }

      try {
        const quota = await buildDailyQuotaStatus({ chatId, session: getSession(chatId), forceRefresh: true });
        await telegram.sendMessage(chatId, formatDailyQuotaCompact(quota));
      } catch (quotaErr) {
        log.warn({ err: quotaErr.message }, `[Bot] quota after publish: ${quotaErr.message}`);
      }

      if (summary.pending > 0) {
        schedulePublishStatusFollowUp(bgCtx, {
          chatId,
          postIds: result.postIds,
          expectedAccountIds: snapshot.selectedAccountIds,
          baseCaption: snapshot.caption,
          initialSummary: summary,
          snapshot,
        });
      }

      if (summary.failed > 0) await offerAutoRetryIfAny(bgCtx, { summary, postIds: result.postIds });
      await offerReplacementAccountsIfAny(bgCtx, { summary, snapshot, result });

      updateSession(chatId, { step: 'idle', publishingSince: undefined });

      // Cek berkala tiap 5 menit — langsung kirim notif saat semua selesai
      // Max 12 kali = 60 menit monitoring. Set segera, tidak tunggu Sheets.
      if (result.postIds?.length && (summary.pending > 0 || summary.failed > 0)) {
        const doPeriodicCheck = (attempt) => {
          if (attempt > 12) return;
          setTimeout(async () => {
            try {
              const updatedPosts = await Promise.all(
                result.postIds.map((pid) => getPost(pid).catch(() => null))
              );
              const valid = updatedPosts.filter(Boolean);
              if (!valid.length) { doPeriodicCheck(attempt + 1); return; }

              const s = summarizePublishResults(valid, snapshot.caption);

              const allAccs = valid.flatMap((p) => p?.socialAccounts ?? []);
              const pubAccs = allAccs.filter((a) => a.status === 'published');
              const failAccs = allAccs.filter((a) => a.status === 'failed');
              const pendAccs = allAccs.filter((a) => a.status === 'pending');

              if (s.pending === 0) {
                // Semua sudah settle — kirim notif final lalu berhenti
                const lines = [
                  failAccs.length
                    ? `⚠️ *Publish selesai* — ✅ ${s.published} live · ❌ ${s.failed} gagal`
                    : `🎉 *Semua ${s.published} akun berhasil publish!*`,
                  `Post ID: ${result.postIds.join(', ')}`,
                ];
                if (failAccs.length) {
                  lines.push(``, `*❌ Gagal:*${fmtAccList(failAccs)}`);
                  lines.push(``, `_Cek: \`/cekakun\` · Retry: \`/retry\`_`);
                } else {
                  lines.push(`_Cek link: \`/links ${result.postIds[0]}\`_`);
                }
                await telegram.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
                return; // berhenti — tidak jadwalkan lagi
              }

              // Masih pending — kirim update dan jadwalkan cek berikutnya
              const min = attempt * 5;
              const lines = [
                `🔄 *Update +${min} menit* — Post ${result.postIds.join(', ')}`,
                `✅ ${s.published} live · ❌ ${s.failed} gagal · ⏳ ${s.pending} pending`,
              ];
              if (pubAccs.length) lines.push(``, `*✅ Selesai:*${fmtAccList(pubAccs)}`);
              if (failAccs.length) lines.push(``, `*❌ Gagal:*${fmtAccList(failAccs)}`);
              if (pendAccs.length) lines.push(``, `*⏳ Pending:*${fmtAccList(pendAccs)}`);
              lines.push(``, `_Cek link: \`/links ${result.postIds[0]}\`_`);
              await telegram.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
              doPeriodicCheck(attempt + 1);
            } catch { doPeriodicCheck(attempt + 1); }
          }, 5 * 60_000);
        };
        doPeriodicCheck(1);
      }

      // Sheets recording jalan di background — tidak block laporan ke user
      if (result.postIds?.length) {
        void (async () => {
          try {
            const sheetResult = await recordPublishResultsToSheet({
              postIds: result.postIds,
              posts,
              expectedAccountIds: snapshot.selectedAccountIds,
              baseCaption: snapshot.caption,
              folderName: snapshot.folderName,
              targetLabel: snapshot.targetLabel,
              mediaFiles: snapshot.mediaFiles,
              idempotencyKey: snapshot.idempotencyKey,
            });
            scheduleSheetRefresh(result.postIds, snapshot.selectedAccountIds, snapshot.caption, {
              folderName: snapshot.folderName,
              targetLabel: snapshot.targetLabel,
              mediaFiles: snapshot.mediaFiles,
              mediaFilesDay: snapshot.mediaFilesDay,
              idempotencyKey: snapshot.idempotencyKey,
            });
            if (sheetResult.recorded > 0) {
              const rows = sheetResult.rowCount ?? sheetResult.recorded;
              const instr = sheetResult.instructionCount ?? 1;
              await telegram.sendMessage(
                chatId,
                `📊 Sheets tersimpan: *${rows} baris* · *${instr} instruksi*\n` +
                  `Tab: ${sheetResult.tabName} · ${sheetResult.summary.statusSummary}\n` +
                  `${sheetResult.spreadsheetUrl}`
              );
            } else {
              // recorded=0: data tidak tertulis — fallback sync otomatis
              log.warn({ postIds: result.postIds }, '[Sheets] recorded=0 setelah publish — fallback syncToday');
              try {
                const fallback = await syncTodayToSheet();
                await telegram.sendMessage(
                  chatId,
                  `📊 Sheets disinkron ulang: *${fallback.recorded} baris* (tab ${fallback.tabName})\n${fallback.spreadsheetUrl}`
                );
              } catch (fbErr) {
                log.error({ err: fbErr?.message }, `[Sheets] fallback sync: ${fbErr?.message}`);
                await telegram.sendMessage(
                  chatId,
                  `⚠️ Sheets belum terisi — ketik */refresh* untuk sync manual.`
                ).catch(() => {});
              }
            }
          } catch (sheetErr) {
            log.error({ err: sheetErr?.message }, `[Sheets] background record: ${sheetErr?.message}`);
            telegram.sendMessage(chatId, `⚠️ Gagal catat Sheets: ${sheetErr.message}`).catch(() => {});
          }
        })();
      }
    })().catch((err) => {
      log.error({ err: err?.message, stack: err?.stack }, `[Bot] background publish: ${err?.message || err}`);
      telegram.sendMessage(chatId, `❌ Publish error: ${err.message}`).catch(() => {});
      updateSession(chatId, { step: 'idle', publishingSince: undefined });
    });
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
    updateSession(ctx.chat.id, {
      step: 'idle',
      publishingSince: undefined,
    });
  }
}

/**
 * Poll Outstand setelah publish untuk update status pending → live secara otomatis ke Telegram.
 * Sheets sudah di-refresh oleh scheduleSheetRefresh; ini khusus untuk notifikasi Telegram.
 */
const FOLLOW_UP_DELAYS_MS = [90_000, 240_000, 480_000];

/**
 * Setelah publish selesai: tawarkan retry untuk akun yang gagal (retryNow saja).
 * Tidak auto-publish — user harus klik tombol konfirmasi.
 */
async function offerAutoRetryIfAny(ctx, { summary, postIds }) {
  try {
    const accounts = summary?.sheetAccounts || [];
    const failed = accounts.filter((a) => a.status === 'failed');
    if (!failed.length) return;

    const plan = buildRetryPlan(failed);
    const retryIds = collectRetryAccountIds(plan, { includeWait: false });
    if (!retryIds.length) return;

    const escUser = (s) => String(s || '').replace(/_/g, '\\_');
    const sample = plan.retryNow.slice(0, 8).map((a) => {
      const net = getNetworkShortLabel(a.network) || (a.network || '?').toUpperCase();
      return { net, username: a.username || a.accountId || '', hint: a.hint || '' };
    });

    updateSession(ctx.chat.id, {
      pendingAutoRetry: { postIds, retryIds, failedSample: sample, at: Date.now() },
    });

    const sampleLines = sample
      .map((s) => `• ${s.net} @${escUser(s.username)}${s.hint ? ` — ${s.hint}` : ''}`)
      .join('\n');
    const more = plan.retryNow.length > 8 ? `\n_…+${plan.retryNow.length - 8} lagi_` : '';
    const fixNote =
      plan.fix.length
        ? `\n⚠️ ${plan.fix.length} akun perlu reconnect (tidak di-retry).`
        : '';

    await safeReply(
      ctx,
      `🔄 *${retryIds.length} akun gagal bisa di-retry*\n\n` +
        `${sampleLines}${more}${fixNote}\n\n` +
        `_Retry hanya untuk error sementara (bukan token/permission)._`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🔄 Retry ${retryIds.length} akun`, 'autoretry:yes')],
          [Markup.button.callback('Lewati', 'autoretry:skip')],
        ]),
      }
    );
  } catch (err) {
    log.warn({ err: err?.message }, `[Bot] offerAutoRetryIfAny: ${err?.message}`);
  }
}

/**
 * Setelah instruksi publish settled: laporkan kekurangan vs target (ig 44 → harus 44 live)
 * dan tawarkan akun pengganti — hanya publish setelah user klik tombol.
 *
 * @param {import('telegraf').Context} ctx
 * @param {{ summary: any, snapshot?: any, result?: any, source?: string }} input
 */
async function offerReplacementAccountsIfAny(ctx, input) {
  const { summary, snapshot = {}, result = {}, source = 'publish' } = input;
  const session = getSession(ctx.chat.id);
  const last = session.lastPublish || {};
  const instructionTargets =
    snapshot.instructionTargets || last.instructionTargets || null;
  if (!instructionTargets || !Object.keys(instructionTargets).length) return;

  const expectedAccountIds =
    snapshot.selectedAccountIds || last.selectedAccountIds || [];
  const postIds = result.postIds || last.postIds || [];
  const postKey = [...postIds].sort().join('|');
  if (!postKey) return;

  if (session.replacementOfferedKey === postKey && session.pendingReplacement) {
    return;
  }

  const accounts = summary?.sheetAccounts || [];
  const analysis = analyzeInstructionCompletion(
    accounts,
    instructionTargets,
    expectedAccountIds
  );

  if (!analysis.settled) {
    return;
  }

  if (!analysis.totalShortage) return;

  const resultLines = formatInstructionResultLines(
    analysis,
    getNetworkShortLabel
  );
  const escUser = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');
  const failedSample = analysis.failedAccounts
    .slice(0, 10)
    .map((a) => `❌ ${getNetworkShortLabel(a.network)} @${escUser(a.username)}`)
    .join('\n');

  const mediaFiles =
    snapshot.mediaFiles?.length ? snapshot.mediaFiles : last.mediaFiles;
  if (!mediaFiles?.length) return;

  const mediaFilesDay =
    snapshot.mediaFilesDay || last.mediaFilesDay || '';
  const mediaFilesSetAt =
    snapshot.mediaFilesSetAt || last.savedAt || '';
  const batchStale = isStaleMediaBatch({
    mediaFiles,
    mediaFilesDay,
    mediaFilesSetAt,
  });
  const archiveStale = getArchiveStaleReason(
    last?.mediaFiles?.length ? last : null
  );

  if (batchStale.stale || archiveStale) {
    const day =
      batchStale.prevDay ||
      archiveStale?.prevDay ||
      mediaFilesDay ||
      '?';
    await safeReply(
      ctx,
      `🛑 *Tidak bisa melengkapi dengan media lama*\n` +
        `Batch konten: *${day}* (bukan hari ini).\n\n` +
        `Kalau @abrorsoeka dll. baru posting konten lama tanpa Anda suruh, ` +
        `biasanya *antrian Outstand* dari hari itu yang baru selesai — ` +
        `bukan publish baru dari bot.\n\n` +
        `• Batalkan antrian lama: \`/stop 3d ig ya\`\n` +
        `• Konten hari ini: \`/publish\` + media baru, lalu publish lagi\n\n` +
        `_Tombol "Lengkapi" tidak ditawarkan untuk media batch kemarin._`,
      { parse_mode: 'Markdown' }
    );
    updateSession(ctx.chat.id, { pendingReplacement: undefined });
    return;
  }

  updateSession(ctx.chat.id, {
    replacementOfferedKey: postKey,
    pendingReplacement: {
      byNetwork: analysis.shortageByNetwork,
      instructionTargets,
      mediaFiles,
      caption: snapshot.caption || last.caption || '',
      folderName: snapshot.folderName || last.folderName || '',
      folderId: snapshot.folderId || last.folderId || '',
      mediaFilesDay,
      mediaFilesSetAt,
      originalPostIds: postIds,
      targetLabel: snapshot.targetLabel || last.targetLabel || '',
      at: Date.now(),
    },
  });

  /** @type {import('telegraf').InlineKeyboardButton[][]} */
  const buttons = [];
  const totalShort = analysis.totalShortage;
  if (Object.keys(analysis.shortageByNetwork).length > 1) {
    buttons.push([
      Markup.button.callback(
        `✅ Lengkapi semua (+${totalShort} akun)`,
        'replace:yes:all'
      ),
    ]);
  }
  for (const [net, count] of Object.entries(analysis.shortageByNetwork)) {
    buttons.push([
      Markup.button.callback(
        `✅ ${getNetworkShortLabel(net)} +${count}`,
        `replace:yes:${net}`
      ),
    ]);
  }
  buttons.push([Markup.button.callback('Lewati', 'replace:skip')]);

  const header =
    source === 'refresh'
      ? '📋 *Instruksi selesai (setelah /refresh)*'
      : source === 'followup'
        ? '📋 *Instruksi selesai — perlu dilengkapi*'
        : '📋 *Instruksi selesai — perlu dilengkapi*';

  await safeReply(
    ctx,
    `${header}\n\n` +
      `${resultLines.join('\n')}\n\n` +
      (failedSample ? `*Akun gagal:*\n${failedSample}\n\n` : '') +
      `Bot bisa posting *media yang sama* ke akun lain (sudah pernah post hari ini) ` +
      `supaya jumlah live = target instruksi.\n` +
      `_Tidak auto-publish — pilih tombol di bawah untuk setuju._\n` +
      `Hasil pengganti tercatat di Sheets sebagai instruksi baru.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    }
  );
}

/**
 * @param {import('telegraf').Context} ctx
 * @param {NonNullable<import('../utils/session.js').PublishSession['pendingReplacement']>} pending
 * @param {string} networkFilter satu network atau `all`
 */
async function startReplacementPublish(ctx, pending, networkFilter) {
  const shortages =
    networkFilter === 'all'
      ? Object.entries(pending.byNetwork || {}).map(([network, missing]) => ({
          network,
          missing,
        }))
      : [
          {
            network: networkFilter,
            missing: pending.byNetwork?.[networkFilter] || 0,
          },
        ];

  const needTotal = shortages.reduce((s, x) => s + (x.missing || 0), 0);
  if (!needTotal) {
    await ctx.reply('Tidak ada kekurangan untuk platform ini.');
    return;
  }

  if (!pending.mediaFiles?.length) {
    await ctx.reply(
      '❌ Media batch instruksi tidak tersimpan. Ulangi /publish dengan media baru.'
    );
    updateSession(ctx.chat.id, { pendingReplacement: undefined });
    return;
  }

  const batchStale = isStaleMediaBatch({
    mediaFiles: pending.mediaFiles,
    mediaFilesDay: pending.mediaFilesDay,
    mediaFilesSetAt: pending.mediaFilesSetAt,
  });
  if (batchStale.stale) {
    await safeReply(
      ctx,
      formatStaleMediaNotice(batchStale, {
        mediaFiles: pending.mediaFiles,
        mediaFilesDay: pending.mediaFilesDay,
        folderName: pending.folderName,
      }) +
        `\n\n_Publish pengganti dibatalkan._\n` +
        `Ketik \`/publish\` dengan konten hari ini.`,
      { parse_mode: 'Markdown' }
    );
    updateSession(ctx.chat.id, { pendingReplacement: undefined });
    return;
  }

  const session = getSession(ctx.chat.id);
  if (session.publishingSince && Date.now() - session.publishingSince < 15 * 60_000) {
    await ctx.reply('⏳ Tunggu publish lain selesai dulu.');
    return;
  }

  const accounts = await listSocialAccounts();
  const excludeIds = await getExcludeIdsForRandomPick(ctx.chat.id);
  const { added, summary: fillSummary } = fillShortageFromExcludedPool(
    accounts,
    shortages.filter((s) => s.missing > 0),
    {
      excludeAccountIds: excludeIds,
      maxReusePerAccount: Math.max(2, env.maxReusePerAccount),
    }
  );

  if (!added.length) {
    await ctx.reply(
      `❌ Tidak ada akun pengganti di pool untuk: ${shortages.map((s) => getNetworkShortLabel(s.network)).join(', ')}`
    );
    return;
  }

  const escUser = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');
  const sample = added
    .slice(0, 8)
    .map((a) => `@${escUser((a.username || a.id).replace(/^@/, ''))}`)
    .join(', ');
  const fillLines = fillSummary
    .map(
      (s) =>
        `${getNetworkShortLabel(s.network)}: ${s.filled}/${s.requested}`
    )
    .join(', ');

  await safeReply(
    ctx,
    `🔁 *Pengganti disetujui*\n` +
      `Isi: ${fillLines}\n` +
      `Akun: ${sample}${added.length > 8 ? '…' : ''}\n\n` +
      `⏳ Publish melengkapi instruksi…`,
    { parse_mode: 'Markdown' }
  );

  const newByNetwork = { ...pending.byNetwork };
  for (const s of fillSummary) {
    const left = (newByNetwork[s.network] || 0) - s.filled;
    if (left <= 0) delete newByNetwork[s.network];
    else newByNetwork[s.network] = left;
  }

  const label =
    networkFilter === 'all'
      ? `Lengkapi instruksi (+${added.length})`
      : `Pengganti ${getNetworkShortLabel(networkFilter)} (+${added.length})`;

  updateSession(ctx.chat.id, {
    mediaFiles: pending.mediaFiles,
    mediaFilesSetAt: nowIsoUtc(),
    mediaFilesDay: pending.mediaFilesDay,
    mediaSourceLabel: label,
    caption: pending.caption,
    captionsByNetwork: undefined,
    youtubeFields: undefined,
    folderName: pending.folderName,
    folderId: pending.folderId,
    selectedAccountIds: added.map((a) => a.id),
    targetLabel: label,
    instructionTargets: countTargetsByNetwork(
      added.map((a) => a.id),
      accounts
    ),
    step: 'ready',
    lastPublishKey: undefined,
    lastPublishAt: undefined,
    replacementOfferedKey: undefined,
    pendingReplacement: Object.keys(newByNetwork).length
      ? { ...pending, byNetwork: newByNetwork, at: Date.now() }
      : undefined,
  });

  await runPublish(ctx);
}

function schedulePublishStatusFollowUp(ctx, input) {
  const {
    chatId,
    postIds,
    expectedAccountIds,
    baseCaption,
    initialSummary,
    snapshot,
  } = input;
  if (!postIds?.length) return;

  /** @type {Map<string, string>} */
  const lastStatusById = new Map();
  for (const a of initialSummary?.sheetAccounts || []) {
    lastStatusById.set(a.accountId || `${a.network}:${a.username}`, a.status || 'pending');
  }

  let stopped = false;
  let replacementOffered = false;

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
                ? `\n  [lihat post](${c.url})`
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
          if (!replacementOffered && snapshot?.instructionTargets) {
            replacementOffered = true;
            try {
              await offerReplacementAccountsIfAny(ctx, {
                summary: { sheetAccounts: accounts },
                snapshot,
                result: { postIds },
                source: 'followup',
              });
            } catch (err) {
              log.warn(
                { err: err.message },
                `[FollowUp] replacement offer: ${err.message}`
              );
            }
          }
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
      caption: session.caption,
      folderName: session.folderName,
      targetLabel: session.targetLabel,
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
    looksLikeNamedPick(text)
  ) {
    await handleNamedAccountPick(ctx, text);
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

  if (session.step === 'awaiting_manual_caption') {
    if (!session.selectedAccountIds?.length) {
      await ctx.reply('Sesi kadaluarsa. Ketik /publish lagi.');
      return;
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
    await applyManualCaptionAndShowPreview(
      ctx,
      text,
      session.selectedAccountIds,
      session.targetLabel || 'Target',
      networks
    );
    return;
  }

  if (session.step === 'awaiting_caption_edit') {
    if (!session.selectedAccountIds?.length) {
      updateSession(ctx.chat.id, { step: 'selecting_targets', caption: text });
      await ctx.reply('Caption disimpan. Pilih target platform:');
      await showTargetPicker(ctx);
      return;
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
    await applyManualCaptionAndShowPreview(
      ctx,
      text,
      session.selectedAccountIds,
      session.targetLabel || 'Target',
      networks
    );
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
      const args = (ctx.message.text || '')
        .replace(/^\/status(@\w+)?\s*/i, '')
        .trim();

      if (args) {
        const postId = args.split(/[\s,]+/)[0];
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

      updateSession(ctx.chat.id, { step: 'awaiting_status_id' });
      await ctx.reply(
        '🔍 Kirim *Post ID* Outstand (satu ID per pesan).\n' +
          'Bisa juga langsung: `/status ghy7x`.\n' +
          'ID ada di pesan setelah publish.',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  bot.command('ping', async (ctx) => {
    const hasStopMark =
      typeof parseStopCommandArgs === 'function' &&
      typeof markPostIdsStoppedLocally === 'function';
    await ctx.reply(
      `🏓 Bot online · tab ${getDailyTabName()} · WIB` +
        (hasStopMark ? '\n✅ stop v2 (ID case-sensitive + /stop mark)' : '')
    );
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

      const dupes = buildDuplicateAccountSummary(
        annotateAccountsWithDayAttempts(filteredAccounts)
      );
      let dupeNote = '';
      if (dupes.length) {
        dupeNote =
          `\n\n⚠️ ${dupes.length} akun posting >1× hari ini` +
          (dupes.length > 8 ? ` (top 8 di bawah)` : '') +
          ':\n' +
          dupes
            .slice(0, 8)
            .map((d) => {
              const konten = d.contentSummary
                ? ` — ${String(d.contentSummary).slice(0, 60)}`
                : '';
              return `• @${d.username} ${d.count}× (${d.network})${konten}`;
            })
            .join('\n') +
          '\n\nREKAP lengkap: /synctoday';
      }

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
        ? `${data.tabName} · ${filterLabel} · ${filteredAccounts.length} akun`
        : `${data.tabName} · ${data.postIds.length} batch`;

      const footer =
        `📋 ${headerLabel}\n` +
        `${counts.live} live · ${counts.failed} gagal · ${counts.pending} pending` +
        dupeNote +
        (filterSet.size
          ? `\n\nFilter: /linkshari ig · /linkshari fb · semua: /linkshari`
          : `\n\nFilter: /linkshari ig · /linkshari fb · Sheets: /synctoday`);

      if (report.length >= 1800) {
        await sendTelegramDocument(
          ctx,
          report,
          Math.ceil(report.length / 3500),
          'linkshari'
        );
        await safeReply(ctx, footer.slice(0, 3200), { parse_mode: 'Markdown' });
      } else {
        await replyTelegramLong(ctx, report);
        await safeReply(ctx, footer.slice(0, 3200), { parse_mode: 'Markdown' });
      }
    } catch (err) {
      const code = err?.response?.error_code ?? err?.code;
      const msg = String(err?.message || err);
      if (/too long/i.test(msg)) {
        await ctx
          .reply(
            '✅ File link (.txt) biasanya sudah terkirim di atas.\n' +
              'Isi lengkap ada di file — chat Telegram tidak muat satu pesan.\n' +
              'Ringkasan: buka file atau cek Google Sheets.'
          )
          .catch(() => {});
        return;
      }
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
    // Step 1: fetch dari Outstand saja (cepat ~5-10 detik)
    const data = await collectTodayPublishLinks();

    if (!data.postIds.length) {
      throw new Error(
        `Tidak ada post untuk tab ${data.tabName} (${env.timezone}). Cek Woopsocial dashboard.`
      );
    }

    const { meta, tabName, postIds, accounts } = data;

    if (!accounts.length) {
      await ctx.reply(
        `⚠️ *${tabName}* — ${postIds.length} post ditemukan tapi Outstand API tidak merespons.\nData lama di Sheets tidak diubah. Coba lagi nanti.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Step 2: balas user segera — tidak tunggu Sheets
    await ctx.reply(
      `✅ *${tabName}* — ${postIds.length} post\n` +
        `${meta.published} live · ${meta.failed} gagal · ${meta.pending} pending\n` +
        `📊 Menyimpan ke Sheets…`,
      { parse_mode: 'Markdown' }
    );

    // Step 3: tulis Sheets di background — tidak blokir user
    void (async () => {
      try {
        const result = await rewriteDailyTabFromAccounts({
          timestamp: nowIsoUtc(),
          postId: postIds.join(', '),
          youtubeTitle: meta.youtubeTitle,
          accounts,
        });
        const dupeLine = result.duplicateAccounts
          ? `\n⚠️ *${result.duplicateAccounts} akun* posting >1× — lihat baris REKAP di atas tab.`
          : '';
        await ctx.reply(
          `📊 Sheets *${tabName}* tersimpan: ${result.recorded} baris` +
            dupeLine +
            `\n\n_Gagal yang sudah live di IG akan berubah jadi Live jika Outstand sudah kirim link._\n` +
            `${result.spreadsheetUrl}`,
          { parse_mode: 'Markdown' }
        );

        // Tawaran pengganti akun (setelah Sheets selesai)
        const session = getSession(ctx.chat.id);
        const last = session.lastPublish;
        if (last?.instructionTargets && last?.mediaFiles?.length && !getArchiveStaleReason(last)) {
          const expected = new Set(last.selectedAccountIds || []);
          const batchAccounts = (result.accounts || accounts).filter((a) =>
            expected.has(a.accountId)
          );
          await offerReplacementAccountsIfAny(ctx, {
            summary: { sheetAccounts: batchAccounts },
            snapshot: last,
            result: { postIds: last.postIds || [] },
            source: 'refresh',
          }).catch((err) => log.warn({ err: err.message }, `[Refresh] replacement: ${err.message}`));
        }
      } catch (sheetErr) {
        await ctx.reply(`⚠️ Gagal simpan Sheets: ${sheetErr.message}`).catch(() => {});
      }
    })();
  }

  async function runSyncTodayCommand(ctx) {
    await ctx.reply(
      `⏳ Mengambil status terbaru Outstand → Sheets (*${getDailyTabName()}*)…`,
      { parse_mode: 'Markdown' }
    );
    try {
      await Promise.race([
        replySyncTodayResult(ctx),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Outstand API lambat, coba lagi dalam 1 menit.')),
            90_000
          )
        ),
      ]);
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  }

  bot.command('synctoday', runSyncTodayCommand);
  bot.command('refresh', runSyncTodayCommand);

  bot.command('recover', async (ctx) => {
    const raw = String(ctx.message?.text || '')
      .replace(/^\/recover(@\w+)?\s*/i, '')
      .trim();
    const ids = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!ids.length) {
      await ctx.reply(
        'Format: `/recover <postId1>, <postId2>, ...`\n\nContoh:\n`/recover 155877927924269056, 155877929518104576`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply(`⏳ Mengambil data dari Woopsocial untuk ${ids.length} post ID…`);

    try {
      const allAccounts = [];
      let firstTs = null;
      for (const id of ids) {
        const post = await Promise.race([
          getPost(id),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25_000)),
        ]).catch((err) => {
          log.warn({ postId: id }, `[recover] getPost ${id}: ${err.message}`);
          return null;
        });
        if (!post) continue;
        if (!firstTs) firstTs = post.publishedAt || post.scheduledAt || post.createdAt;
        const { sheetAccounts } = summarizePublishResults([post]);
        allAccounts.push(...sheetAccounts);
      }

      if (!allAccounts.length) {
        await ctx.reply('❌ Tidak ada data akun dari Woopsocial. Post ID mungkin sudah kedaluwarsa atau API tidak tersedia.');
        return;
      }

      const ts = firstTs || new Date().toISOString();
      registerPublishContext(ids, [], '', ts, { folderName: 'Recovery' });

      await upsertPublishEventRow({
        timestamp: ts,
        postId: ids.join(', '),
        accounts: allAccounts,
      });

      await ctx.reply(
        `✅ Recovery selesai\n` +
          `Post ID: ${ids.length} IDs\n` +
          `Akun: ${allAccounts.length}\n\n` +
          `Data sudah ditambahkan ke spreadsheet tab hari ini.`
      );
    } catch (err) {
      log.error({ err: err.message }, `[recover] error: ${err.message}`);
      await ctx.reply(`❌ Recovery gagal: ${err.message}`);
    }
  });

  bot.command('scanpost', async (ctx) => {
    await ctx.reply('⏳ Scan Outstand untuk post tak terduga…');
    try {
      await checkForUnexpectedPosts();
      await ctx.reply(
        '✅ Scan selesai. Kalau ada post tak terduga, notifikasi sudah dikirim di atas. ' +
          'Kalau hening, semua post hari-hari terakhir dibuat oleh bot ini.'
      );
    } catch (err) {
      await ctx.reply(`❌ Scan gagal: ${err.message}`).catch(() => {});
    }
  });

  bot.command('audit', async (ctx) => {
    const raw = String(ctx.message.text || '')
      .replace(/^\/audit(@\w+)?\s*/i, '')
      .trim();
    const from = (raw.split(/\s+/)[0] || '').trim();
    const to = (raw.split(/\s+/)[1] || '').trim();

    if (!from) {
      await ctx.reply(
        'Format:\n' +
          '`/audit 2026-05-21` (scan sampai hari ini)\n' +
          '`/audit 2026-05-21 2026-05-27` (range spesifik)\n\n' +
          'Hasilnya membuat 2 tab baru: `AUDIT-SUMMARY <from>` dan `AUDIT-DETAIL <from>`.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const today = getWibDayKey();
    await ctx.reply('⏳ Audit duplikat dari Sheets… (bisa 1–3 menit)');
    try {
      const result = await buildAuditFromSheets({
        fromDayKey: from,
        toDayKey: to || today,
      });
      await safeReply(
        ctx,
        `✅ Audit selesai\n` +
          `Range: *${result.fromDayKey}..${result.toDayKey}*\n` +
          `Tab discan: *${result.tabsScanned}*\n` +
          `Baris detail: *${result.rowsDetail}*\n\n` +
          `📌 Hasil:\n` +
          `• *${result.summaryTab}* (top offender)\n` +
          `• *${result.detailTab}* (per akun per hari)\n\n` +
          `${result.url}`,
        { parse_mode: 'Markdown', disable_web_page_preview: true }
      );
    } catch (err) {
      await ctx.reply(`❌ Audit gagal: ${err.message}`).catch(() => {});
    }
  });

  const handleStopCommand = async (ctx) => {
    const firstLine = String(ctx.message.text || '').split(/\r?\n/)[0] || '';
    const rawArgs = firstLine.replace(/^\/stop(@\w+)?\s*/i, '').trim();
    const parsed = parseStopCommandArgs(rawArgs);
    const daysBack = parsed.daysMatch
      ? Math.min(14, Math.max(1, Number(parsed.daysMatch[1]) || 0))
      : 0;

    let network = null;
    if (!parsed.stuckOnly) {
      const cleaned = parsed.rest
        .replace(/\b(\d+)\s*d\b/g, ' ')
        .replace(/\b(yes|ya|kirim|confirm|batalkan|stuck|mark)\b/g, ' ')
        .replace(/(^|\s)\/\w+(\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const { networks, invalid } = parseNetworkFilter(cleaned);
      if (invalid.length) {
        await ctx.reply(
          `Platform tidak dikenal: ${invalid.join(', ')}\n\n` +
            'Contoh:\n' +
            '• `/stop` — lihat antrian\n' +
            '• `/stop ghy7x ya` — cancel Post ID (huruf besar/kecil ikuti asli)\n' +
            '• `/stop mark ghy7x O39Av` — blok retry di bot (kalau API 500)\n' +
            '• `/stop ig ya` · `/stop stuck ya`',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      if (networks.length === 1) network = networks[0];
    }

    if (parsed.localMark && parsed.postIds.length) {
      await safeReply(ctx, formatLocalStopMarkResults(parsed.postIds), {
        parse_mode: 'Markdown',
      });
      clearPublishedTodayCache();
      return;
    }

    if (parsed.doCancel && parsed.postIds.length) {
      await ctx.reply(
        `⏳ Membatalkan ${parsed.postIds.length} Post ID di Outstand…`
      );
      const results = await cancelPendingPostIds(parsed.postIds);
      clearPublishedTodayCache();
      await replyCancelResults(ctx, results);
      await runSyncTodayCommand(ctx).catch(() => {});
      return;
    }

    await ctx.reply('⏳ Mengecek antrian pending di Outstand…');

    try {
      const data = daysBack
        ? await listPendingRecent({
            daysBack,
            network: network || undefined,
            stuckOnly: parsed.stuckOnly,
          })
        : await listPendingToday({
            network: network || undefined,
            stuckOnly: parsed.stuckOnly,
          });

      if (!data.pending.length) {
        await safeReply(ctx, formatPendingReport(data), { parse_mode: 'Markdown' });
        return;
      }

      const byPost = groupPendingByPostId(data);
      const postIds = [...byPost.keys()].filter((id) => id !== '(tanpa-id)');
      updateSession(ctx.chat.id, { pendingStopPostIds: postIds });

      if (!parsed.doCancel) {
        await safeReply(
          ctx,
          formatPendingReport(data) +
            (daysBack ? `\n\n🔎 Mode scan: *${daysBack} hari terakhir*` : '') +
            '\n\n⚠️ *Batalkan semua batch di atas?*\n' +
            '• Tombol di bawah, atau `/stop ya`\n' +
            (postIds.length <= 4
              ? `• Langsung: \`/stop ${postIds.join(' ')} ya\`\n`
              : '') +
            '• Kalau API 500: `/stop mark POST_ID` (blok retry di bot)\n' +
            '_Post yang sudah live tidak terhapus dari profil._',
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

      const results = await cancelPendingPostIds(postIds);
      clearPublishedTodayCache();
      await replyCancelResults(ctx, results);
      await runSyncTodayCommand(ctx).catch(() => {});
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  };
  bot.command('stop', handleStopCommand);

  bot.action('stop:confirm', async (ctx) => {
    await ack(ctx, 'Membatalkan…');
    const session = getSession(ctx.chat.id);
    let postIds = session.pendingStopPostIds || [];
    if (!postIds.length) {
      try {
        const data = await listPendingToday({});
        const byPost = groupPendingByPostId(data);
        postIds = [...byPost.keys()].filter((id) => id !== '(tanpa-id)');
      } catch {
        /* ignore */
      }
    }
    if (!postIds.length) {
      await ctx.reply(
        'Daftar kosong. Ketik `/stop` dulu, atau:\n`/stop ghy7x O39Av ya`',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    const results = await cancelPendingPostIds(postIds);
    clearPublishedTodayCache();
    updateSession(ctx.chat.id, { pendingStopPostIds: undefined });
    await replyCancelResults(ctx, results);
    await runSyncTodayCommand(ctx).catch(() => {});
  });

  bot.action('stop:abort', async (ctx) => {
    await ack(ctx);
    updateSession(ctx.chat.id, { pendingStopPostIds: undefined });
    await ctx.reply('Dibatalkan. Antrian Outstand tidak diubah.');
  });

  bot.command('stopsupport', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const args = (ctx.message.text || '')
      .replace(/^\/stopsupport(@\w+)?\s*/i, '')
      .trim();
    const postIds = args
      ? args.split(/[\s,]+/).filter(Boolean)
      : session.pendingStopPostIds || [];
    if (!postIds.length) {
      await ctx.reply(
        'Kirim Post ID:\n`/stopsupport ghy7x, O39Av`\n\n' +
          'Atau jalankan `/stop` dulu lalu `/stopsupport` tanpa argumen.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    await ctx.reply('⏳ Menyusun draft email support…');
    try {
      const draft = await buildOutstandCancelSupportDraft(postIds);
      await replyTelegramLong(
        ctx,
        `📧 *Salin ke support@outstand.so:*\n\n\`\`\`\n${draft}\n\`\`\``
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  bot.command('antrian', async (ctx) => {
    const args = (ctx.message.text || '').replace(/^\/antrian(@\w+)?\s*/i, '').trim();
    ctx.message.text = `/stop${args ? ' ' + args : ''}`;
    await handleStopCommand(ctx);
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

  bot.command('debuglinks', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const args = (ctx.message.text || '')
      .replace(/^\/debuglinks(@\w+)?\s*/i, '')
      .trim();
    const postIds = args
      ? args.split(/[\s,]+/).filter(Boolean)
      : session.lastPublish?.postIds || session.outstandPostIds || [];

    if (!postIds.length) {
      await ctx.reply(
        '🔍 Debug URL IG & Threads dari Outstand:\n`/debuglinks <postId>`\n\nContoh: `/debuglinks QFXny`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply('⏳ Mengambil raw data dari Outstand…');
    try {
      for (const postId of postIds.slice(0, 3)) {
        const post = await getPost(postId);
        const accts = (post?.socialAccounts ?? []).filter(
          (a) => ['instagram', 'threads'].includes((a.network || '').toLowerCase())
        );

        if (!accts.length) {
          await ctx.reply(`Post \`${postId}\` — tidak ada akun IG/Threads.`, { parse_mode: 'Markdown' });
          continue;
        }

        const lines = [`🔍 *Debug links — Post \`${postId}\`*`, ''];
        for (const a of accts) {
          const net = (a.network || '').toUpperCase().slice(0, 2);
          const st = a.status === 'published' ? '✅' : a.status === 'failed' ? '❌' : '⏳';
          const pid = a.platformPostId || '—';
          const url = a.url || '—';
          const isProfile =
            (a.network === 'instagram' && !/\/p\/|\/reel\/|\/tv\//i.test(url)) ||
            (a.network === 'threads' && !/\/post\//i.test(url));
          const urlType = !a.url ? '🚫 kosong' : isProfile ? '👤 profil (bukan post!)' : '🔗 post';
          lines.push(`${st} *${net}* @${a.username}`);
          lines.push(`  platform\\_id: \`${pid}\``);
          lines.push(`  url: ${urlType}`);
          if (a.url) lines.push(`  ${a.url}`);
          lines.push('');
        }

        await replyTelegramLong(ctx, lines.join('\n'), { parse_mode: 'Markdown' });
      }
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  bot.command('cleanup', async (ctx) => {
    const args = (ctx.message.text || '').replace(/^\/cleanup(@\w+)?\s*/i, '').trim();
    const dryRun = /^(preview|dry|cek)$/i.test(args);
    const customDays = args && !dryRun ? parseInt(args, 10) : null;
    const retentionDays = customDays > 0 ? customDays : (env.sheetTabRetentionDays || 30);

    await ctx.reply(
      `🧹 ${dryRun ? 'Preview' : 'Menghapus'} tab Sheets lebih lama dari ${retentionDays} hari…`,
      { parse_mode: 'Markdown' }
    );
    try {
      const result = await deleteOldDailyTabs({ retentionDays, dryRun });
      const lines = [];
      if (result.deleted.length) {
        lines.push(`${dryRun ? '🗑 Akan dihapus' : '✅ Dihapus'} (${result.deleted.length}):\n${result.deleted.map((t) => `• ${t}`).join('\n')}`);
      } else {
        lines.push(`✅ Tidak ada tab yang perlu dihapus (retensi ${retentionDays} hari).`);
      }
      if (result.kept.length) {
        lines.push(`📅 Disimpan: ${result.kept.length} tab`);
      }
      await ctx.reply(lines.join('\n\n'));
    } catch (err) {
      await ctx.reply(`❌ Cleanup gagal: ${err.message}`);
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

  bot.command('pick', async (ctx) => {
    const session = getSession(ctx.chat.id);
    const args = (ctx.message.text || '').replace(/^\/pick(?:@\w+)?\s*/i, '').trim();

    if (!session.mediaFiles?.length) {
      await ctx.reply(
        'Kirim *media* dulu (link Drive / foto / broadcast misi), lalu tempel daftar akun:\n' +
          '`/pick ig: user1, user2`\n' +
          'atau multi-baris `fb: @Nama Lengkap` …',
        { parse_mode: 'Markdown', ...mainMenuKeyboard() }
      );
      return;
    }

    if (!args) {
      updateSession(ctx.chat.id, { step: 'selecting_targets' });
      await ctx.reply(formatNamedPickHelp(), { parse_mode: 'Markdown' });
      return;
    }

    await handleNamedAccountPick(ctx, args);
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

  bot.action('autoretry:yes', async (ctx) => {
    await ctx.answerCbQuery('Memulai retry…').catch(() => {});
    const session = getSession(ctx.chat.id);
    const pending = session.pendingAutoRetry;
    if (!pending?.retryIds?.length) {
      await ctx.reply('Sesi retry sudah kadaluarsa. Gunakan `/retry` manual.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    updateSession(ctx.chat.id, { pendingAutoRetry: undefined });
    await handleRetryPublish(ctx, {
      send: true,
      postIds: pending.postIds || [],
      forcedRetryIds: pending.retryIds,
    });
  });

  bot.action('autoretry:skip', async (ctx) => {
    await ctx.answerCbQuery('Dilewati').catch(() => {});
    updateSession(ctx.chat.id, { pendingAutoRetry: undefined });
    await ctx.reply('Oke, retry dilewati. Gunakan `/retry` kapan saja jika berubah pikiran.', {
      parse_mode: 'Markdown',
    });
  });

  /**
   * Ambil Map failures hari ini langsung dari Outstand (best-effort, tidak throw).
   * @returns {Promise<Map<string, { error: string, failedCount: number }>>}
   */
  async function getTodayFailuresById() {
    try {
      const usageCounts = await getTodayAccountUsageCounts();
      const map = new Map();
      for (const [accountId, counts] of Object.entries(usageCounts)) {
        if ((counts.failed || 0) > 0) {
          map.set(accountId, {
            error:
              counts.failed > 1
                ? `Gagal ${counts.failed}× publish hari ini`
                : 'Gagal publish hari ini',
            failedCount: counts.failed,
          });
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  bot.command('akun', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/akun(@\w+)?\s*/i, '').trim();
      const { filterText } = parseAkunCommandArgs(args);
      const netFilter = filterText ? (parseNetworkFilter(filterText).networks[0] || null) : null;

      await ctx.reply('⏳ Mengambil daftar akun…');

      const accounts = await listSocialAccounts();
      const filtered = netFilter
        ? accounts.filter((a) => (a.network || '').toLowerCase() === netFilter)
        : accounts;

      const failuresById = await getTodayFailuresById();
      const issueMap = buildAccountIssueMap(filtered, { failuresById });

      const byNetwork = new Map();
      for (const a of filtered) {
        const net = (a.network || 'other').toLowerCase();
        if (!byNetwork.has(net)) byNetwork.set(net, []);
        byNetwork.get(net).push(a);
      }

      const lines = [
        `📋 *Daftar Akun* (${filtered.length}${netFilter ? ' · ' + netFilter.toUpperCase() : ''})`,
        '',
      ];

      if (!filtered.length) {
        lines.push(netFilter ? `Tidak ada akun ${netFilter}.` : 'Belum ada akun terhubung di Outstand.');
        lines.push('🟡 gagal publish hari ini · 🔴 token/nonaktif');
        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
        return;
      }

      // Tampilkan SEMUA akun per platform dalam pesan terpisah
      const headerMsg = lines.join('\n') + '🟡 gagal publish hari ini · 🔴 token/nonaktif';
      await ctx.reply(headerMsg, { parse_mode: 'Markdown' });

      for (const [net, accs] of byNetwork) {
        const netLabel = getNetworkShortLabel(net) || net.toUpperCase();
        const bad = accs.filter((a) => issueMap.get(a.id)?.worst);
        const netLines = [
          `*${netLabel}* — ${accs.length} akun${bad.length ? ` · ${bad.length} ⚠️` : ' ✅'}`,
          '',
        ];
        for (const a of accs) {
          const entry = issueMap.get(a.id);
          const badge = issueBadge(entry?.worst);
          const user = (a.username || a.id).replace(/^@/, '').replace(/_/g, '\\_');
          netLines.push(`• @${user}${badge}`);
        }
        await ctx.reply(netLines.join('\n'), { parse_mode: 'Markdown' });
      }

      if (!netFilter) {
        await ctx.reply('_Filter per platform: `/akun ig` · `/akun fb` · `/akun yt`_', {
          parse_mode: 'Markdown',
        });
      }
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /akun: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  bot.command('cekakun', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/cekakun(@\w+)?\s*/i, '').trim();
      const { filterText } = parseAkunCommandArgs(args);
      const netFilter = filterText ? (parseNetworkFilter(filterText).networks[0] || null) : null;

      await ctx.reply('⏳ Memeriksa kesehatan akun…');

      const accounts = await listSocialAccounts();
      const filtered = netFilter
        ? accounts.filter((a) => (a.network || '').toLowerCase() === netFilter)
        : accounts;

      const failuresById = await getTodayFailuresById();
      const tabName = getDailyTabName();

      const report = formatCekAkunReport(filtered, { failuresById, tabName });
      await replyTelegramLong(ctx, report, { parse_mode: 'Markdown' });
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /cekakun: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
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

  bot.action(/^acctrand:(.+)$/, async (ctx) => {
    const network = ctx.match[1].toLowerCase();
    await ack(ctx);
    const session = getSession(ctx.chat.id);
    if (!session.accountPickNetwork) {
      await ctx.reply('Sesi kadaluarsa. Ulangi dari target picker.');
      return;
    }

    const selected = new Set(session.accountPickSelected || []);
    const [allAccounts, excludeIds] = await Promise.all([
      listSocialAccounts(),
      getExcludeIdsForRandomPick(ctx.chat.id),
    ]);

    const excludeSet = new Set(excludeIds);
    const pool =
      network === '__multi__'
        ? allAccounts.filter((a) => !selected.has(a.id) && !excludeSet.has(a.id))
        : allAccounts.filter(
            (a) =>
              (a.network || '').toLowerCase() === network &&
              !selected.has(a.id) &&
              !excludeSet.has(a.id)
          );

    if (!pool.length) {
      await ctx.reply(
        '⚠️ Tidak ada akun tersisa yang bisa ditambahkan\n' +
          '(semua sudah tercentang, sudah dipakai hari ini, atau ada di skip-list).'
      );
      return;
    }

    // Shuffle dan tambahkan semua ke selection
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (const a of shuffled) selected.add(a.id);

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

  bot.action('randomfill:yes', async (ctx) => {
    await ack(ctx, 'Mengisi sisa…');
    const session = getSession(ctx.chat.id);
    const pending = session.pendingFillShortage;
    if (!pending || Date.now() - pending.at > 30 * 60_000) {
      await ctx.reply('⌛ Saran sudah kadaluarsa. Ulangi `/random` jika perlu.');
      updateSession(ctx.chat.id, { pendingFillShortage: undefined });
      return;
    }

    const accounts = await listSocialAccounts();
    const excludeIds = await getExcludeIdsForRandomPick(ctx.chat.id);
    const { added, summary } = fillShortageFromExcludedPool(
      accounts,
      pending.shortages,
      {
        excludeAccountIds: excludeIds,
        maxReusePerAccount: env.maxReusePerAccount,
      }
    );

    if (!added.length) {
      await ctx.reply(
        '⚠️ Tidak ada akun pengganti yang tersedia (pool excluded kosong).\n' +
          'Lanjut dengan akun terpilih awal.'
      );
      const baseIds = pending.baseAccountIds || [];
      updateSession(ctx.chat.id, {
        pendingFillShortage: undefined,
        step: 'selecting_targets',
      });
      await finalizeTargetSelection(ctx, baseIds, pending.label);
      return;
    }

    const combinedIds = [...pending.baseAccountIds, ...added.map((a) => a.id)];
    const filledLines = summary
      .filter((s) => s.filled > 0)
      .map((s) => `• *${getNetworkShortLabel(s.network)}*: +${s.filled} akun`);
    const escUser = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');
    const samplePicks = added
      .slice(0, 6)
      .map((a) => `@${escUser((a.username || a.id).replace(/^@/, ''))}`)
      .join(', ');

    await safeReply(
      ctx,
      `🔥 *Tambahan ${added.length} akun pengganti* (force, sudah pernah post hari ini):\n` +
        filledLines.join('\n') +
        (samplePicks ? `\nContoh: ${samplePicks}${added.length > 6 ? '…' : ''}` : '') +
        `\n\nTotal target sekarang: *${combinedIds.length}* akun.`,
      { parse_mode: 'Markdown' }
    );

    updateSession(ctx.chat.id, {
      pendingFillShortage: undefined,
      step: 'selecting_targets',
    });
    await finalizeTargetSelection(ctx, combinedIds, `${pending.label} + fill ${added.length}`);
  });

  bot.action('randomfill:skip', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.chat.id);
    const pending = session.pendingFillShortage;
    if (!pending) {
      await ctx.reply('Saran sudah tidak ada.');
      return;
    }
    updateSession(ctx.chat.id, {
      pendingFillShortage: undefined,
      step: 'selecting_targets',
    });
    await finalizeTargetSelection(ctx, pending.baseAccountIds, pending.label);
  });

  bot.action(/^replace:yes:(.+)$/, async (ctx) => {
    const network = ctx.match[1].toLowerCase();
    await ack(ctx, `Mencari pengganti ${network}…`);
    const session = getSession(ctx.chat.id);
    const pending = session.pendingReplacement;
    if (!pending || Date.now() - pending.at > 30 * 60_000) {
      await ctx.reply('⌛ Saran pengganti kadaluarsa. Ulangi /publish atau /refresh.');
      updateSession(ctx.chat.id, { pendingReplacement: undefined });
      return;
    }

    await startReplacementPublish(ctx, pending, network);
  });

  bot.action('replace:skip', async (ctx) => {
    await ack(ctx);
    updateSession(ctx.chat.id, { pendingReplacement: undefined });
    await ctx.reply('Oke, tidak menambah akun pengganti.');
  });

  bot.action(/^tone:(.+)$/, async (ctx) => {
    const toneKey = ctx.match[1];
    await ack(ctx);
    const session = getSession(ctx.chat.id);
    if (!session.selectedAccountIds?.length) {
      await ctx.reply('Sesi kadaluarsa. /publish lagi.');
      return;
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
    const label = session.targetLabel || 'Target';
    const ids = session.selectedAccountIds;

    if (toneKey === 'change') {
      await showTonePicker(ctx, label);
      return;
    }

    if (toneKey === 'manual') {
      await promptManualCaption(ctx);
      return;
    }

    if (toneKey === 'skip') {
      await applyDefaultCaptionWithoutAi(ctx, ids, label, networks);
      return;
    }

    updateSession(ctx.chat.id, { captionTone: toneKey, caption: undefined });
    await generateCaptionAndShowPreview(ctx, ids, label, networks);
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
  bot.action(/^action:(preview|send|schedule|edit)$/, handleAction);

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

  // ── /laporan ──────────────────────────────────────────────────────────────
  bot.command('laporan', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/laporan(@\w+)?\s*/i, '').trim();
      const { networks: filterNets } = parseNetworkFilter(args);

      await ctx.reply('⏳ Mengambil data performa hari ini dari Outstand…');

      const usageCounts = await getTodayAccountUsageCounts();
      const tabName = getDailyTabName();
      const escUser = (s) => String(s || '').replace(/_/g, '\\_');

      /** @type {Record<string, { published: number, pending: number, failed: number, failedAccounts: Array<{ username: string, failed: number }> }>} */
      const byNetwork = {};
      for (const counts of Object.values(usageCounts)) {
        const net = (counts.network || 'unknown').toLowerCase();
        if (filterNets.length && !filterNets.includes(net)) continue;
        if (!byNetwork[net]) byNetwork[net] = { published: 0, pending: 0, failed: 0, failedAccounts: [] };
        byNetwork[net].published += counts.published || 0;
        byNetwork[net].pending += counts.pending || 0;
        byNetwork[net].failed += counts.failed || 0;
        if ((counts.failed || 0) > 0) {
          byNetwork[net].failedAccounts.push({ username: counts.username || '?', failed: counts.failed });
        }
      }

      const lines = [`📊 *Laporan ${tabName}*${filterNets.length ? ' · ' + filterNets.map((n) => n.toUpperCase()).join(', ') : ''}`, ''];

      let totalPub = 0, totalPend = 0, totalFail = 0;
      const sortedNets = Object.entries(byNetwork).sort(([a], [b]) => a.localeCompare(b));

      if (!sortedNets.length) {
        lines.push('_Belum ada data publish hari ini._');
      } else {
        for (const [net, stats] of sortedNets) {
          const label = getNetworkShortLabel(net) || net.toUpperCase();
          const total = stats.published + stats.pending + stats.failed;
          const pct = total > 0 ? Math.round((stats.published / total) * 100) : 0;
          lines.push(`*${label}* — ✅ ${stats.published} · ⏳ ${stats.pending} · ❌ ${stats.failed} _(${pct}% live)_`);
          totalPub += stats.published;
          totalPend += stats.pending;
          totalFail += stats.failed;
        }

        lines.push('');
        const grandTotal = totalPub + totalPend + totalFail;
        const grandPct = grandTotal > 0 ? Math.round((totalPub / grandTotal) * 100) : 0;
        lines.push(`*Total* — ✅ ${totalPub} · ⏳ ${totalPend} · ❌ ${totalFail} _(${grandPct}% live)_`);
      }

      // Akun gagal terbanyak
      const allFailed = Object.values(usageCounts)
        .filter((c) => (c.failed || 0) > 0 && (!filterNets.length || filterNets.includes((c.network || '').toLowerCase())))
        .sort((a, b) => b.failed - a.failed)
        .slice(0, 12);

      if (allFailed.length) {
        lines.push('', '*Akun gagal:*');
        for (const c of allFailed) {
          const net = getNetworkShortLabel(c.network) || (c.network || '?').toUpperCase();
          lines.push(`• ${net} @${escUser(c.username)} — ❌ ${c.failed}×`);
        }
      }

      if (totalFail > 0) {
        lines.push('', '_Gunakan `/cekakun` untuk analisis masalah akun._');
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /laporan: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /skip ─────────────────────────────────────────────────────────────────
  bot.command('skip', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/skip(@\w+)?\s*/i, '').trim();
      const escUser = (s) => String(s || '').replace(/_/g, '\\_');

      // /skip reset | /skip clear
      if (/^(reset|clear|hapus)$/i.test(args)) {
        clearSkipList();
        await ctx.reply('✅ Daftar skip dikosongkan. Semua akun kembali bisa dipilih.').catch(() => {});
        return;
      }

      // /skip del @user | /skip remove @user
      const delMatch = args.match(/^(del|remove|hapus)\s+(.+)/i);
      if (delMatch) {
        const tokens = delMatch[2].split(/[\s,]+/).filter(Boolean);
        const { removed, notFound } = removeFromSkipList(tokens);
        const lines = [];
        if (removed.length) lines.push(`✅ Dihapus dari skip: ${removed.map((u) => `@${escUser(u)}`).join(', ')}`);
        if (notFound.length) lines.push(`⚠️ Tidak ada di daftar: ${notFound.map((u) => `@${escUser(u)}`).join(', ')}`);
        await ctx.reply(lines.join('\n') || 'Tidak ada yang dihapus.').catch(() => {});
        return;
      }

      // /skip (tanpa arg) → tampilkan daftar
      if (!args) {
        const list = loadSkipList();
        if (!list.length) {
          await ctx.reply(
            '📋 *Daftar skip kosong.*\n\n' +
              'Tambah akun: `/skip @username1 @username2`\n' +
              'Hapus satu: `/skip del @username`\n' +
              'Kosongkan: `/skip reset`\n\n' +
              '_Akun di daftar ini tidak akan terpilih saat `/random`._',
            { parse_mode: 'Markdown' }
          );
        } else {
          const userLines = list.map((u) => `• @${escUser(u)}`).join('\n');
          await ctx.reply(
            `📋 *Akun di-skip (${list.length})*:\n\n${userLines}\n\n` +
              '_Akun ini tidak dipilih saat `/random` atau `/publish` otomatis._\n' +
              'Hapus: `/skip del @username` · Reset: `/skip reset`',
            { parse_mode: 'Markdown' }
          );
        }
        return;
      }

      // /skip @user1 @user2 → tambah ke daftar
      const tokens = args.split(/[\s,]+/).filter(Boolean);
      const { added, existing, list } = addToSkipList(tokens);

      const lines = [];
      if (added.length) lines.push(`✅ Ditambah ke skip: ${added.map((u) => `@${escUser(u)}`).join(', ')}`);
      if (existing.length) lines.push(`ℹ️ Sudah ada di daftar: ${existing.map((u) => `@${escUser(u)}`).join(', ')}`);
      lines.push(`\n📋 Total di-skip: *${list.length} akun*`);
      lines.push('_Akun ini tidak akan dipilih saat `/random`._');

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /skip: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /simulasi ─────────────────────────────────────────────────────────────
  bot.command('simulasi', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/simulasi(@\w+)?\s*/i, '').trim();
      if (!args) {
        await ctx.reply(
          '🔍 *Simulasi random pick* — preview akun yang akan dipilih tanpa publish.\n\n' +
            'Contoh: `/simulasi ig 22 fb 30`\n' +
            'Sama persis dengan `/random` tapi tidak ada konfirmasi kirim.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const parsed = parseRandomPickCommand(args);
      if (!parsed?.counts || !Object.keys(parsed.counts).length) {
        await ctx.reply('Format tidak dikenal. Contoh: `/simulasi ig 22 fb 30`', { parse_mode: 'Markdown' });
        return;
      }

      await ctx.reply('⏳ Mensimulasikan pemilihan akun…');

      const accounts = await listSocialAccounts();
      const exclude = await getExcludeIdsForRandomPick(ctx.chat.id);
      const result = pickRandomAccounts(accounts, parsed.counts, {
        excludeAccountIds: exclude,
        maxReusePerAccount: env.maxReusePerAccount,
      });

      const escUser = (s) => String(s || '').replace(/_/g, '\\_');
      const byNet = {};
      for (const a of result.accountIds.map((id) => accounts.find((ac) => ac.id === id)).filter(Boolean)) {
        const net = (a.network || 'other').toLowerCase();
        if (!byNet[net]) byNet[net] = [];
        byNet[net].push(a);
      }

      const lines = [
        `🔍 *Simulasi — ${result.accountIds.length} akun terpilih*`,
        `_(exclude: ${exclude.length} akun sudah dipakai hari ini + skip list)_`,
        '',
      ];

      for (const [net, accs] of Object.entries(byNet)) {
        const label = getNetworkShortLabel(net) || net.toUpperCase();
        lines.push(`*${label}* (${accs.length}):`);
        for (const a of accs) {
          lines.push(`• @${escUser(a.username || a.id)}`);
        }
        lines.push('');
      }

      if (result.warnings?.length) {
        lines.push('⚠️ ' + result.warnings.join('\n⚠️ '));
      }

      lines.push('_Ini hanya simulasi — tidak ada yang dikirim._');
      await replyTelegramLong(ctx, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /simulasi: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /jadwal list ──────────────────────────────────────────────────────────
  bot.command('jadwal', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/jadwal(@\w+)?\s*/i, '').trim();

      if (args !== 'list' && args !== 'daftar') {
        await ctx.reply(
          '📅 *Jadwal*\n\n' +
            '`/jadwal list` — lihat semua post terjadwal\n\n' +
            '_Untuk jadwalkan publish baru: `/publish` → pilih akun → tekan tombol "📅 Schedule"._',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      await ctx.reply('⏳ Mengambil daftar post terjadwal dari Outstand…');

      const postIds = await listRecentPostIds({ daysBack: 7 });
      const now = Date.now();
      const scheduled = [];

      for (const id of postIds.slice(0, 30)) {
        try {
          const post = await getPost(id);
          if (!post?.scheduledAt) continue;
          const schedMs = new Date(post.scheduledAt).getTime();
          if (schedMs > now) {
            scheduled.push({ id, scheduledAt: post.scheduledAt, post });
          }
        } catch { /* skip */ }
      }

      if (!scheduled.length) {
        await ctx.reply('📅 Tidak ada post terjadwal yang belum tayang.');
        return;
      }

      scheduled.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

      const lines = [`📅 *${scheduled.length} post terjadwal*`, ''];
      for (const { id, scheduledAt, post } of scheduled) {
        const wib = formatWibDateTime(scheduledAt);
        const accs = post.socialAccounts || [];
        const nets = [...new Set(accs.map((a) => getNetworkShortLabel(a.network) || a.network))].join(', ');
        lines.push(`• \`${id}\` — ${wib}`);
        lines.push(`  ${nets} · ${accs.length} akun`);
        lines.push(`  _Batalkan: \`/stop ${id}\`_`);
        lines.push('');
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /jadwal: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /riwayat ──────────────────────────────────────────────────────────────
  bot.command('riwayat', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/riwayat(@\w+)?\s*/i, '').trim();
      const days = Math.min(30, Math.max(1, Number(args) || 7));

      await ctx.reply(`⏳ Membaca data ${days} hari terakhir dari Sheets…`);

      const { getSheetsClient } = await import('../config/google.js');
      const { getSpreadsheetId } = await import('./spreadsheetSetup.js');
      const { isWideSheetHeader, parseWideSheetHeader, isLegacySheetHeader } = await import('../config/sheetLayout.js');

      const spreadsheetId = await getSpreadsheetId();
      const sheets = getSheetsClient();
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      const allTabs = (meta.data.sheets || []).map((s) => s.properties.title || '');

      // Tab harian format YYYY-MM-DD
      const today = getWibDayKey();
      const dayTabs = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(Date.now() - i * 86_400_000);
        const key = getWibDayKey(d);
        if (allTabs.includes(key)) dayTabs.push(key);
      }

      if (!dayTabs.length) {
        await ctx.reply(`Tidak ada tab Sheets untuk ${days} hari terakhir.`);
        return;
      }

      const summary = {};
      for (const tab of dayTabs) {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${tab.replace(/'/g, "''")}'!A:ZZ`,
        });
        const rows = res.data.values || [];
        const header = rows[0] || [];
        let pub = 0, fail = 0, pend = 0;

        const tally = (cell) => {
          const st = String(cell || '').toLowerCase();
          if (st.includes('live') || st.includes('published')) pub++;
          else if (st.includes('gagal') || st.includes('failed')) fail++;
          else if (st.includes('pending')) pend++;
        };

        if (isWideSheetHeader(header)) {
          const { instructions } = parseWideSheetHeader(header);
          const statusCols = instructions.map((i) => i.statusIdx);
          for (let i = 1; i < rows.length; i++) {
            if (String(rows[i][0] || '').startsWith('REKAP')) continue;
            for (const col of statusCols) tally(rows[i][col]);
          }
        } else {
          for (let i = 1; i < rows.length; i++) {
            if (String(rows[i][0] || '').startsWith('REKAP')) continue;
            tally(rows[i][7]);
          }
        }
        summary[tab] = { pub, fail, pend };
      }

      const lines = [`📈 *Riwayat ${days} hari terakhir*`, ''];
      let totalPub = 0, totalFail = 0;

      for (const tab of dayTabs) {
        const s = summary[tab];
        const total = s.pub + s.fail + s.pend;
        const pct = total > 0 ? Math.round((s.pub / total) * 100) : 0;
        const bar = pct >= 90 ? '🟢' : pct >= 70 ? '🟡' : '🔴';
        const isToday = tab === today ? ' _(hari ini)_' : '';
        lines.push(`${bar} \`${tab}\`${isToday} — ✅${s.pub} ❌${s.fail} ⏳${s.pend} _(${pct}%)_`);
        totalPub += s.pub;
        totalFail += s.fail;
      }

      const grandTotal = totalPub + totalFail;
      const grandPct = grandTotal > 0 ? Math.round((totalPub / grandTotal) * 100) : 0;
      lines.push('', `*${dayTabs.length} hari* — ✅ ${totalPub} total live · ❌ ${totalFail} gagal _(${grandPct}%)_`);

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /riwayat: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /topakun ──────────────────────────────────────────────────────────────
  bot.command('topakun', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/topakun(@\w+)?\s*/i, '').trim();
      const { networks: filterNets } = parseNetworkFilter(args);

      await ctx.reply('⏳ Mengambil data performa akun hari ini…');

      const usageCounts = await getTodayAccountUsageCounts();
      const escUser = (s) => String(s || '').replace(/_/g, '\\_');

      const entries = Object.entries(usageCounts)
        .filter(([, c]) => {
          if (filterNets.length && !filterNets.includes((c.network || '').toLowerCase())) return false;
          return (c.published || 0) + (c.failed || 0) > 0;
        })
        .map(([id, c]) => ({
          id,
          username: c.username || id,
          network: c.network || 'unknown',
          published: c.published || 0,
          failed: c.failed || 0,
          total: (c.published || 0) + (c.failed || 0) + (c.pending || 0),
          pct: ((c.published || 0) + (c.failed || 0) + (c.pending || 0)) > 0
            ? Math.round(((c.published || 0) / ((c.published || 0) + (c.failed || 0) + (c.pending || 0))) * 100)
            : 0,
        }));

      if (!entries.length) {
        await ctx.reply('Belum ada data publish hari ini.');
        return;
      }

      const best = [...entries].sort((a, b) => b.pct - a.pct || b.published - a.published).slice(0, 10);
      const worst = [...entries].filter((e) => e.failed > 0).sort((a, b) => b.failed - a.failed || a.pct - b.pct).slice(0, 10);

      const lines = [
        `🏆 *Top Akun ${getDailyTabName()}*${filterNets.length ? ' · ' + filterNets.map((n) => n.toUpperCase()).join(', ') : ''}`,
        '',
        `*✅ Terbaik (${best.length}):*`,
      ];

      for (const e of best) {
        const net = getNetworkShortLabel(e.network) || e.network.toUpperCase();
        const bar = e.pct === 100 ? '🟢' : e.pct >= 80 ? '🟡' : '🔴';
        lines.push(`${bar} ${net} @${escUser(e.username)} — ${e.pct}% (${e.published}/${e.total})`);
      }

      if (worst.length) {
        lines.push('', `*❌ Sering gagal (${worst.length}):*`);
        for (const e of worst) {
          const net = getNetworkShortLabel(e.network) || e.network.toUpperCase();
          lines.push(`🔴 ${net} @${escUser(e.username)} — ${e.failed}× gagal (${e.pct}% live)`);
        }
        lines.push('', '_Akun sering gagal → cek `/cekakun` · tambah ke skip: `/skip @username`_');
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /topakun: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /grup ─────────────────────────────────────────────────────────────────
  bot.command('grup', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/grup(@\w+)?\s*/i, '').trim();
      const escUser = (s) => String(s || '').replace(/_/g, '\\_');

      if (!args || args === 'list' || args === 'daftar') {
        const groups = loadGroups();
        const keys = Object.keys(groups);
        if (!keys.length) {
          await ctx.reply(
            '📁 *Belum ada grup akun.*\n\n' +
              'Buat grup: `/grup buat fashion @acc1 @acc2`\n' +
              'Hapus: `/grup hapus fashion`\n' +
              'Pakai di random: `/random dari:fashion 10`',
            { parse_mode: 'Markdown' }
          );
          return;
        }
        const lines = [`📁 *Grup akun (${keys.length}):*`, ''];
        for (const key of keys) {
          const g = groups[key];
          lines.push(`• *${escUser(g.name)}* — ${g.usernames.length} akun`);
          if (g.usernames.length <= 5) {
            lines.push(`  ${g.usernames.map((u) => `@${escUser(u)}`).join(', ')}`);
          } else {
            lines.push(`  ${g.usernames.slice(0, 4).map((u) => `@${escUser(u)}`).join(', ')} …+${g.usernames.length - 4}`);
          }
        }
        lines.push('', '_Pakai: `/random dari:namagrup 10`_');
        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
        return;
      }

      // /grup buat <nama> @acc1 @acc2
      const buatMatch = args.match(/^buat\s+(\S+)\s+([\s\S]+)/i);
      if (buatMatch) {
        const name = buatMatch[1];
        const userTokens = buatMatch[2].split(/[\s,]+/).filter((t) => t.startsWith('@') || /^\w/.test(t));
        const group = createGroup(name, userTokens);
        await ctx.reply(
          `✅ Grup *${escUser(group.name)}* dibuat/diperbarui.\n${group.usernames.length} akun: ${group.usernames.slice(0, 6).map((u) => `@${escUser(u)}`).join(', ')}${group.usernames.length > 6 ? ` …+${group.usernames.length - 6}` : ''}`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // /grup hapus <nama>
      const hapusMatch = args.match(/^(hapus|delete|del)\s+(\S+)/i);
      if (hapusMatch) {
        const deleted = deleteGroup(hapusMatch[2]);
        await ctx.reply(deleted ? `✅ Grup *${escUser(hapusMatch[2])}* dihapus.` : `⚠️ Grup tidak ditemukan.`, { parse_mode: 'Markdown' });
        return;
      }

      // /grup <nama> — lihat isi grup
      const group = getGroup(args.split(/\s+/)[0]);
      if (group) {
        const lines = [`📁 *Grup: ${escUser(group.name)}* (${group.usernames.length} akun)`, ''];
        for (const u of group.usernames) lines.push(`• @${escUser(u)}`);
        lines.push('', `_Hapus: \`/grup hapus ${group.name}\`_`);
        lines.push(`_Pakai: \`/random dari:${group.name} 10\`_`);
        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
        return;
      }

      await ctx.reply(
        'Perintah tidak dikenal.\n\n`/grup list` · `/grup buat nama @acc1 @acc2` · `/grup hapus nama`',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /grup: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /lib (caption library) ────────────────────────────────────────────────
  bot.command('lib', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/lib(@\w+)?\s*/i, '').trim();
      const session = getSession(ctx.chat.id);
      const escUser = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');

      if (!args || args === 'list' || args === 'daftar') {
        const captions = listCaptions();
        if (!captions.length) {
          await ctx.reply(
            '📚 *Library caption kosong.*\n\n' +
              'Simpan caption aktif: `/lib simpan nama-caption`\n' +
              'Pakai caption tersimpan: `/lib pakai nama-caption`\n' +
              'Hapus: `/lib hapus nama-caption`',
            { parse_mode: 'Markdown' }
          );
          return;
        }
        const lines = [`📚 *Caption library (${captions.length}):*`, ''];
        for (const c of captions) {
          const preview = c.caption.slice(0, 60).replace(/\n/g, ' ');
          lines.push(`• *${escUser(c.name)}* — _${escUser(preview)}${c.caption.length > 60 ? '…' : ''}_`);
        }
        lines.push('', '_Pakai: `/lib pakai nama-caption`_');
        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
        return;
      }

      // /lib simpan <nama>
      const simpanMatch = args.match(/^simpan\s+(.+)/i);
      if (simpanMatch) {
        const name = simpanMatch[1].trim();
        const caption = session.caption;
        if (!caption) {
          await ctx.reply('❌ Belum ada caption di sesi. Buat caption dulu lewat `/publish`.');
          return;
        }
        saveCaption(name, caption);
        await ctx.reply(`✅ Caption disimpan sebagai *${escUser(name)}*.\nGunakan: \`/lib pakai ${name}\``, { parse_mode: 'Markdown' });
        return;
      }

      // /lib pakai <nama>
      const pakaiMatch = args.match(/^pakai\s+(.+)/i);
      if (pakaiMatch) {
        const name = pakaiMatch[1].trim();
        const saved = getCaption(name);
        if (!saved) {
          await ctx.reply(`❌ Caption *${escUser(name)}* tidak ditemukan. Lihat daftar: \`/lib\``, { parse_mode: 'Markdown' });
          return;
        }
        if (!session.selectedAccountIds?.length) {
          await ctx.reply('❌ Belum ada akun terpilih. Mulai dari `/publish` dulu.');
          return;
        }
        const accounts = await listSocialAccounts();
        const selected = accounts.filter((a) => session.selectedAccountIds.includes(a.id));
        const networks = [...new Set(selected.map((a) => (a.network || '').toLowerCase()).filter(Boolean))];
        const captionsByNetwork = buildCaptionsByNetwork(saved.caption, networks);
        updateSession(ctx.chat.id, {
          caption: saved.caption,
          captionsByNetwork,
          captionTone: undefined,
          step: 'ready',
        });
        await ctx.reply(`✅ Caption *${escUser(name)}* dipakai.\n\n_${escUser(saved.caption.slice(0, 100))}${saved.caption.length > 100 ? '…' : ''}_`, { parse_mode: 'Markdown' });
        const label = session.targetLabel || `${session.selectedAccountIds.length} akun`;
        await showReadyPreview(ctx, session.selectedAccountIds, label, networks);
        return;
      }

      // /lib hapus <nama>
      const hapusMatch = args.match(/^(hapus|delete|del)\s+(.+)/i);
      if (hapusMatch) {
        const deleted = deleteCaption(hapusMatch[2].trim());
        await ctx.reply(deleted ? `✅ Caption *${escUser(hapusMatch[2].trim())}* dihapus.` : '⚠️ Caption tidak ditemukan.', { parse_mode: 'Markdown' });
        return;
      }

      await ctx.reply(
        '📚 *Caption Library*\n\n' +
          '`/lib` — lihat daftar\n' +
          '`/lib simpan nama` — simpan caption sesi aktif\n' +
          '`/lib pakai nama` — gunakan caption tersimpan\n' +
          '`/lib hapus nama` — hapus caption',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /lib: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /duplikat ─────────────────────────────────────────────────────────────
  bot.command('duplikat', async (ctx) => {
    try {
      const session = getSession(ctx.chat.id);
      const last = session.lastPublish || loadPublishArchive(ctx.chat.id);
      if (!last?.mediaFiles?.length) {
        await ctx.reply(
          '❌ Tidak ada data publish tersimpan.\n\n' +
            '`/duplikat` menggunakan media & caption dari publish terakhir ke akun baru.\n' +
            'Selesaikan satu publish dulu, lalu `/duplikat`.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      // Duplikat = republish ke target baru menggunakan data publish lama
      await ctx.reply(
        '♻️ *Duplikat publish*\n\n' +
          `Media: *${escapeMarkdown(last.folderName || 'Publish terakhir')}*\n` +
          `Caption tersimpan dari sesi sebelumnya.\n\n` +
          'Pilih target baru:',
        { parse_mode: 'Markdown' }
      );
      updateSession(ctx.chat.id, {
        mediaFiles: last.mediaFiles,
        mediaFilesDay: last.mediaFilesDay || getWibDayKey(),
        mediaFilesSetAt: last.savedAt || new Date().toISOString(),
        caption: last.caption,
        captionsByNetwork: last.captionsByNetwork,
        youtubeFields: last.youtubeFields,
        folderName: last.folderName,
        folderId: last.folderId,
        step: 'selecting_targets',
      });
      await showTargetPicker(ctx);
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /duplikat: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  // ── /autostop ─────────────────────────────────────────────────────────────
  bot.command('autostop', async (ctx) => {
    try {
      const args = (ctx.message.text || '').replace(/^\/autostop(@\w+)?\s*/i, '').trim();
      const maxAgeHours = Math.max(1, Number(args) || 6);

      await ctx.reply(`⏳ Mencari antrian pending lebih dari ${maxAgeHours} jam…`);

      const postIds = await listRecentPostIds({ daysBack: 3 });
      const cutoffMs = Date.now() - maxAgeHours * 3_600_000;
      const stale = [];

      for (const id of postIds.slice(0, 40)) {
        try {
          const post = await getPost(id);
          if (!post) continue;
          const createdMs = post.createdAt ? new Date(post.createdAt).getTime() : NaN;
          if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
          const pending = (post.socialAccounts || []).filter(
            (a) => (a.status || '').toLowerCase() === 'pending'
          );
          if (pending.length > 0) {
            stale.push({ id, pending: pending.length, createdAt: post.createdAt });
          }
        } catch { /* skip */ }
      }

      if (!stale.length) {
        await ctx.reply(`✅ Tidak ada antrian pending lebih dari ${maxAgeHours} jam.`);
        return;
      }

      const lines = [
        `⚠️ *${stale.length} Post ID dengan pending > ${maxAgeHours} jam:*`,
        '',
      ];
      for (const s of stale) {
        const wib = formatWibDateTime(s.createdAt);
        lines.push(`• \`${s.id}\` — ${s.pending} akun pending · dibuat ${wib}`);
      }
      lines.push('', '_Batalkan semua? Ketik `/autostop cancel` untuk konfirmasi._');
      lines.push('_Atau batalkan satu: `/stop [PostID]`_');

      updateSession(ctx.chat.id, {
        pendingAutoStop: stale.map((s) => s.id),
      });

      await ctx.reply(lines.join('\n'), {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🛑 Batalkan semua (${stale.length})`, 'autostop:cancel')],
          [Markup.button.callback('Biarkan saja', 'autostop:skip')],
        ]),
      });
    } catch (err) {
      log.error({ err: err?.message }, `[Bot] /autostop: ${err?.message}`);
      await ctx.reply(`❌ ${err.message}`).catch(() => {});
    }
  });

  bot.action('autostop:cancel', async (ctx) => {
    await ctx.answerCbQuery('Membatalkan…').catch(() => {});
    const session = getSession(ctx.chat.id);
    const ids = session.pendingAutoStop || [];
    if (!ids.length) {
      await ctx.reply('Tidak ada yang perlu dibatalkan.');
      return;
    }
    updateSession(ctx.chat.id, { pendingAutoStop: undefined });
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await cancelOutstandPost(id);
        markPostIdCancelled(id);
        ok++;
      } catch {
        fail++;
      }
    }
    await ctx.reply(
      `🛑 Selesai: ${ok} dibatalkan${fail ? ` · ${fail} gagal (sudah live/error Outstand)` : ''}.`
    );
  });

  bot.action('autostop:skip', async (ctx) => {
    await ctx.answerCbQuery('Dibiarkan').catch(() => {});
    updateSession(ctx.chat.id, { pendingAutoStop: undefined });
    await ctx.reply('Oke, antrian dibiarkan.');
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
      { command: 'akun', description: 'Daftar semua akun (filter: ig/fb/yt/dll)' },
      { command: 'cekakun', description: 'Cek akun bermasalah hari ini' },
      { command: 'laporan', description: 'Performa publish hari ini per platform' },
      { command: 'riwayat', description: 'Laporan mingguan Sheets (contoh: /riwayat 7)' },
      { command: 'topakun', description: 'Ranking akun terbaik/terburuk hari ini' },
      { command: 'simulasi', description: 'Preview akun yg dipilih tanpa publish' },
      { command: 'jadwal', description: 'Lihat post terjadwal (/jadwal list)' },
      { command: 'skip', description: 'Blacklist akun dari random pick' },
      { command: 'grup', description: 'Kelola grup akun per niche' },
      { command: 'lib', description: 'Caption library — simpan & pakai ulang' },
      { command: 'duplikat', description: 'Duplikat publish terakhir ke target baru' },
      { command: 'autostop', description: 'Batalkan antrian pending lama (def: >6 jam)' },
      { command: 'scanpost', description: 'Scan post tak terduga di Outstand' },
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
