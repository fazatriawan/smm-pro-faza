import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

const _envFile = process.env.ENV_FILE
  ? path.resolve(rootDir, process.env.ENV_FILE)
  : path.join(rootDir, '.env');
dotenv.config({ path: _envFile });

function requireEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name, fallback = '') {
  return (process.env[name] ?? fallback).trim();
}

/** Shared with spreadsheet-analyzer: C:\projects\spreadsheet-analyzer\service_account.json */
const DEFAULT_SERVICE_ACCOUNT =
  process.platform === 'win32'
    ? 'C:/projects/spreadsheet-analyzer/service_account.json'
    : './credentials/service-account.json';

function resolveServiceAccountPath(rootDir) {
  const configured =
    optionalEnv('GOOGLE_SERVICE_ACCOUNT_PATH') ||
    optionalEnv('GOOGLE_SERVICE_ACCOUNT_FILE') ||
    DEFAULT_SERVICE_ACCOUNT;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(rootDir, configured);
}

const OUTSTAND_PLACEHOLDERS = new Set([
  'your_outstand_api_key',
  'your_outstand_api_key_here',
]);

function requireOutstandApiKey() {
  const key = requireEnv('OUTSTAND_API_KEY');
  if (OUTSTAND_PLACEHOLDERS.has(key.toLowerCase())) {
    throw new Error(
      'OUTSTAND_API_KEY masih teks contoh dari .env.example.\n' +
        'Buka https://www.outstand.so/app → dashboard → API Keys → copy key asli ke telegram-bridge/.env'
    );
  }
  if (key.length < 24) {
    throw new Error('OUTSTAND_API_KEY terlalu pendek — pastikan sudah paste key asli dari Outstand.');
  }
  return key;
}

const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|aac|ogg|flac)$/i;

function resolveImageToVideoAudioPath(rootDir) {
  const configured =
    optionalEnv('IMAGE_TO_VIDEO_AUDIO_PATH') ||
    optionalEnv('YOUTUBE_IMAGE_AUDIO_PATH');
  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.resolve(rootDir, configured);
    if (fs.existsSync(resolved)) return resolved;
    console.warn(`[Env] Path musik tidak ditemukan: ${resolved}`);
  }

  const audioDir = path.join(rootDir, 'assets/audio');
  if (fs.existsSync(audioDir)) {
    const found = fs
      .readdirSync(audioDir)
      .filter((f) => AUDIO_EXTENSIONS.test(f))
      .sort()[0];
    if (found) return path.join(audioDir, found);
  }

  return '';
}

const IMAGE_TO_VIDEO_NETWORKS_DEFAULT = [
  'youtube',
  'instagram',
  'threads',
  'facebook',
  'tiktok',
];

function parseImageToVideoNetworks() {
  const raw =
    optionalEnv('IMAGE_TO_VIDEO_NETWORKS') ||
    'youtube,instagram,threads,facebook,tiktok';
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : IMAGE_TO_VIDEO_NETWORKS_DEFAULT;
}

const imageToVideoDurationSec = Math.max(
  3,
  Math.min(
    60,
    Number(
      process.env.IMAGE_TO_VIDEO_DURATION_SEC ||
        process.env.YOUTUBE_IMAGE_VIDEO_DURATION_SEC ||
        15
    ) || 15
  )
);

const imageToVideoAudioPath = resolveImageToVideoAudioPath(rootDir);

const publisherChoice = optionalEnv('DEFAULT_PUBLISHER', 'woopsocial');

function parseDurationByNetwork() {
  const raw = optionalEnv('IMAGE_TO_VIDEO_DURATION_BY_NETWORK');
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

export const env = {
  dataDir: path.resolve(rootDir, optionalEnv('DATA_DIR', 'data')),
  port: Number(process.env.PORT || 3000),
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  woopsocialApiKey: optionalEnv('WOOPSOCIAL_API_KEY'),
  woopsocialProjectId: optionalEnv('WOOPSOCIAL_PROJECT_ID'),
  postformeApiKey: optionalEnv('POSTFORME_API_KEY'),
  postformeRedirectUrl: optionalEnv('POSTFORME_REDIRECT_URL'),
  publisher: publisherChoice,
  anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY'),
  geminiApiKey: optionalEnv('GEMINI_API_KEY'),
  tokenplusApiKey: optionalEnv('TOKENPLUS_API_KEY'),
  tokenplusModel: optionalEnv('TOKENPLUS_MODEL') || 'gpt-5.6-luna',
  openaiApiKey: optionalEnv('OPENAI_API_KEY'),
  openaiModel: optionalEnv('OPENAI_MODEL') || 'gpt-4o-mini',
  /** Kosong = buat spreadsheet otomatis, ID disimpan di data/runtime.json */
  googleSpreadsheetId: optionalEnv('GOOGLE_SPREADSHEET_ID'),
  /** Parent bank konten (ID stabil). Bisa URL — di-parse otomatis. */
  googleDriveFolderId: optionalEnv('GOOGLE_DRIVE_FOLDER_ID'),
  googleDriveParentId: optionalEnv('GOOGLE_DRIVE_PARENT_FOLDER_ID'),
  /** manual = pilih folder di Telegram | latest = folder terbaru | date = nama = tanggal hari ini */
  googleDriveDailyMode: optionalEnv('GOOGLE_DRIVE_DAILY_MODE', 'manual'),
  timezone: optionalEnv('TZ', 'Asia/Jakarta'),
  /** Email Gmail Anda — sheet auto-create di-share supaya bisa dibuka di browser */
  googleSheetShareEmail: optionalEnv('GOOGLE_SHEET_SHARE_EMAIL'),
  googleServiceAccountPath: resolveServiceAccountPath(rootDir),
  telegramAllowedChatIds: optionalEnv('TELEGRAM_ALLOWED_CHAT_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  outstandWebhookSecret: optionalEnv('OUTSTAND_WEBHOOK_SECRET'),
  postformeWebhookSecret: optionalEnv('POSTFORME_WEBHOOK_SECRET'),
  googleSheetTab: optionalEnv('GOOGLE_SHEET_TAB', 'Sheet1'),
  outstandAccountBatchSize: Math.max(
    1,
    Number(process.env.OUTSTAND_ACCOUNT_BATCH_SIZE || 50)
  ),
  /** Maks akun IG per request Outstand — lebih dari ini di-split otomatis (0 = tidak dibatasi). */
  igPublishSplitSize: Math.max(0, Number(process.env.IG_PUBLISH_SPLIT_SIZE || 10)),
  /** Maks akun Threads per request Outstand — lebih dari ini di-split otomatis (0 = tidak dibatasi). */
  threadsPublishSplitSize: Math.max(0, Number(process.env.THREADS_PUBLISH_SPLIT_SIZE || 10)),
  outstandBaseUrl: 'https://api.outstand.so',
  /** Gambar → video + musik (YouTube, IG, Threads, Facebook) */
  imageToVideoAudioPath,
  imageToVideoDurationSec,
  imageToVideoNetworks: parseImageToVideoNetworks(),
  imageToVideoAllowSilent:
    optionalEnv('IMAGE_TO_VIDEO_ALLOW_SILENT') !== 'false' &&
    optionalEnv('YOUTUBE_IMAGE_ALLOW_SILENT', 'true').toLowerCase() !== 'false',
  /** Alias lama */
  youtubeImageAudioPath: imageToVideoAudioPath,
  youtubeImageVideoDurationSec: imageToVideoDurationSec,
  youtubePublishAsShorts:
    optionalEnv('YOUTUBE_PUBLISH_AS_SHORTS', 'true').toLowerCase() !== 'false',
  youtubeImageAllowSilent:
    optionalEnv('IMAGE_TO_VIDEO_ALLOW_SILENT') !== 'false' &&
    optionalEnv('YOUTUBE_IMAGE_ALLOW_SILENT', 'true').toLowerCase() !== 'false',
  /** Opsional — jika winget install FFmpeg tapi belum di PATH */
  ffmpegPath: optionalEnv('FFMPEG_PATH'),
  imageToVideoDurationByNetwork: parseDurationByNetwork(),
  maxDriveFileMb: Math.max(0, Number(process.env.MAX_DRIVE_FILE_MB || 0)),
  dailySummaryEnabled:
    optionalEnv('DAILY_SUMMARY_ENABLED', 'true').toLowerCase() !== 'false',
  dailySummaryHour: Math.min(
    23,
    Math.max(0, Number(process.env.DAILY_SUMMARY_HOUR || 22))
  ),
  /**
   * Perkiraan upload/hari untuk SATU Google Cloud project (semua akun pakai pool ini).
   * videos.insert ≈100 unit (sejak Des 2025); default project ≈10.000 unit/hari → ~100 upload.
   * Bukan "per akun". Outstand pakai project mereka — Anda tidak bisa naikkan lewat .env ini.
   */
  youtubeProjectUploadsPerDay: Math.max(
    1,
    Number(process.env.YOUTUBE_PROJECT_UPLOADS_PER_DAY || 100)
  ),
  /** Ukuran batch untuk hitung "sesi lagi" di /kuota (bukan limit Outstand). */
  quotaDefaultBatchSize: Math.max(
    1,
    Number(process.env.QUOTA_DEFAULT_BATCH_SIZE || 25)
  ),
  quotaYoutubeBatchSize: Math.max(
    1,
    Number(process.env.QUOTA_YOUTUBE_BATCH_SIZE || 8)
  ),
  /** Tampilan saja — limit akun Outstand (0 = tidak ditampilkan). */
  outstandAccountLimit: Math.max(
    0,
    Number(process.env.OUTSTAND_ACCOUNT_LIMIT || 500)
  ),
  /** Tab harian Sheets disimpan N hari — lebih lama dihapus via /cleanup (0 = nonaktif). */
  sheetTabRetentionDays: Math.max(
    0,
    Number(process.env.SHEET_TAB_RETENTION_DAYS || 30)
  ),
  /** Telegraf handler timeout (default 90s terlalu pendek untuk batch besar). */
  telegramHandlerTimeoutMs: Math.max(
    90_000,
    Number(process.env.TELEGRAM_HANDLER_TIMEOUT_MS || 600_000)
  ),
  publishPollMinMs: Math.max(
    15_000,
    Number(process.env.PUBLISH_POLL_MIN_MS || 45_000)
  ),
  publishPollPerAccountMs: Math.max(
    200,
    Number(process.env.PUBLISH_POLL_PER_ACCOUNT_MS || 500)
  ),
  publishPollMaxMs: Math.max(
    60_000,
    Number(process.env.PUBLISH_POLL_MAX_MS || 300_000)
  ),
  publishLargeBatchThreshold: Math.max(
    10,
    Number(process.env.PUBLISH_LARGE_BATCH_THRESHOLD || 40)
  ),
  publishLargeBatchPollMs: Math.max(
    60_000,
    Number(process.env.PUBLISH_LARGE_BATCH_POLL_MS || 120_000)
  ),
  maxReusePerAccount: Math.max(
    1,
    Number(process.env.MAX_RANDOM_REUSE_PER_ACCOUNT || 1)
  ),
  /** Refresh seluruh tab hari ini dari Outstand (menit). 0 = mati. */
  sheetAutoRefreshMinutes: Math.max(
    0,
    Number(process.env.SHEET_AUTO_REFRESH_MINUTES || 20)
  ),
  /** Notifikasi otomatis antrian pending ke Telegram (menit). 0 = mati. */
  pendingMonitorMinutes: Math.max(
    0,
    Number(process.env.PENDING_MONITOR_MINUTES || 20)
  ),
  /** Scan Outstand untuk Post ID tak terduga (menit). 0 = mati. */
  unexpectedPostMonitorMinutes: Math.max(
    0,
    Number(process.env.UNEXPECTED_POST_MONITOR_MINUTES || 10)
  ),
  /** Window scan (hari) saat cari post tak terduga. Default 2 hari. */
  unexpectedPostScanDays: Math.max(
    1,
    Number(process.env.UNEXPECTED_POST_SCAN_DAYS || 2)
  ),
  /**
   * Bot peer — untuk /kirim command.
   * Set PEER_BOT_ARI_TOKEN, PEER_BOT_ARI_CHAT_ID, dst. di .env
   */
  peerBots: ['ARI', 'ADAM', 'JUNDAN'].flatMap((n) => {
    const token  = optionalEnv(`PEER_BOT_${n}_TOKEN`);
    const chatId = optionalEnv(`PEER_BOT_${n}_CHAT_ID`);
    return token && chatId ? [{ name: n.toLowerCase(), label: n[0] + n.slice(1).toLowerCase(), token, chatId }] : [];
  }),
};
