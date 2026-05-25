import { env } from './config/env.js';
import { createWebhookApp } from './server/webhook.js';
import { startBot, getBot } from './services/bot.js';
import { startDailySummaryLoop } from './services/dailySummary.js';
import {
  startTodaySheetAutoRefreshLoop,
  stopTodaySheetAutoRefreshLoop,
} from './services/sheets.js';
import { ensureSpreadsheetReady } from './services/spreadsheetSetup.js';
import { probeFfmpeg } from './services/imageToVideo.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('app');

/**
 * @param {import('express').Express} app
 * @param {number} port
 */
function listenServer(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}

async function main() {
  try {
    const sheet = await ensureSpreadsheetReady();
    const { ensureDailySheetTab, getDailyTabName } = await import(
      './services/sheets.js'
    );
    const tab = await ensureDailySheetTab(sheet.id, getDailyTabName());
    log.info({ url: sheet.url, tab }, '[Sheets] Laporan siap');
  } catch (err) {
    log.warn({ err: err?.message }, '[Sheets] Startup init skipped');
    if (String(err.message).includes('permission')) {
      log.warn(
        '[Sheets] Buat spreadsheet manual di Google Sheets → Share ke client_email (service account) sebagai Editor → isi GOOGLE_SPREADSHEET_ID di .env. Atau aktifkan Google Sheets API di Google Cloud project service account Anda.',
      );
    }
  }

  const ff = probeFfmpeg();
  if (ff.ok) {
    log.info({ path: ff.path }, '[FFmpeg] Siap untuk YouTube (gambar→video)');
  } else {
    log.warn(
      '[FFmpeg] Tidak ditemukan — publish YouTube dari gambar akan gagal.\n' +
        '  winget install Gyan.FFmpeg → tutup terminal → npm start lagi',
    );
  }

  const app = createWebhookApp();

  let server;
  try {
    server = await listenServer(app, env.port);
    log.info({ port: env.port }, `[Server] Webhook listening on http://0.0.0.0:${env.port}`);
    log.info('[Server] Outstand webhook path: POST /webhook/outstand');
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      log.error(
        { port: env.port },
        `[Server] Port ${env.port} sudah dipakai proses lain (instance lama npm start?).\n` +
          `  PowerShell: Get-NetTCPConnection -LocalPort ${env.port} | Select OwningProcess\n` +
          `  Lalu: taskkill /PID <nomor> /F\n` +
          `  Atau ubah PORT=3001 di .env`,
      );
    } else {
      log.error({ err: err?.message }, '[Server] Gagal bind port');
    }
    process.exit(1);
  }

  try {
    log.info('[Bot] Menghubungkan ke Telegram…');
    await startBot();
    startDailySummaryLoop();
    startTodaySheetAutoRefreshLoop();
  } catch (err) {
    log.error({ err: err?.message, code: err?.response?.error_code }, '[Bot] Gagal start');
    if (err.response?.error_code === 409) {
      log.error(
        '[Bot] Instance lain sudah jalan (409). Tutup terminal/PM2 lain yang pakai bot token sama.',
      );
    }
    server.close();
    process.exit(1);
  }

  log.info('[App] Siap. Tekan Ctrl+C untuk stop.');

  const shutdown = async (signal) => {
    log.info({ signal }, `[App] ${signal} — shutting down…`);
    stopTodaySheetAutoRefreshLoop();
    getBot()?.stop(signal);
    server.close();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.fatal({ err: err?.message, stack: err?.stack }, '[App] Fatal startup error');
  process.exit(1);
});
