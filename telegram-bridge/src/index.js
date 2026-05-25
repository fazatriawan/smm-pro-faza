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
    console.log(`[Sheets] Laporan: ${sheet.url} (tab hari ini: ${tab})`);
  } catch (err) {
    console.warn('[Sheets] Startup init skipped:', err.message);
    if (String(err.message).includes('permission')) {
      console.warn(
        '[Sheets] Buat spreadsheet manual di Google Sheets → Share ke client_email (service account) sebagai Editor → isi GOOGLE_SPREADSHEET_ID di .env. Atau aktifkan Google Sheets API di Google Cloud project service account Anda.'
      );
    }
  }

  const ff = probeFfmpeg();
  if (ff.ok) {
    console.log(`[FFmpeg] Siap untuk YouTube (gambar→video): ${ff.path}`);
  } else {
    console.warn(
      '[FFmpeg] Tidak ditemukan — publish YouTube dari gambar akan gagal.\n' +
        '  winget install Gyan.FFmpeg → tutup terminal → npm start lagi'
    );
  }

  const app = createWebhookApp();

  let server;
  try {
    server = await listenServer(app, env.port);
    console.log(`[Server] Webhook listening on http://0.0.0.0:${env.port}`);
    console.log(`[Server] Outstand webhook path: POST /webhook/outstand`);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Server] Port ${env.port} sudah dipakai proses lain (instance lama npm start?).\n` +
          `  PowerShell: Get-NetTCPConnection -LocalPort ${env.port} | Select OwningProcess\n` +
          `  Lalu: taskkill /PID <nomor> /F\n` +
          `  Atau ubah PORT=3001 di .env`
      );
    } else {
      console.error('[Server] Gagal bind port:', err.message);
    }
    process.exit(1);
  }

  try {
    console.log('[Bot] Menghubungkan ke Telegram…');
    await startBot();
    startDailySummaryLoop();
    startTodaySheetAutoRefreshLoop();
  } catch (err) {
    console.error('[Bot] Gagal start:', err.message);
    if (err.response?.error_code === 409) {
      console.error(
        '[Bot] Instance lain sudah jalan (409). Tutup terminal/PM2 lain yang pakai bot token sama.'
      );
    }
    server.close();
    process.exit(1);
  }

  console.log('[App] Siap. Tekan Ctrl+C untuk stop.');

  const shutdown = async (signal) => {
    console.log(`[App] ${signal} — shutting down…`);
    stopTodaySheetAutoRefreshLoop();
    getBot()?.stop(signal);
    server.close();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[App] Fatal startup error:', err);
  process.exit(1);
});
