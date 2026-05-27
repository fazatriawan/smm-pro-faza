import { env } from '../config/env.js';
import { getRuntime } from '../utils/runtimeStore.js';
import { createLogger } from '../utils/logger.js';
import {
  formatPendingReport,
  listPendingToday,
} from './pendingControl.js';
import { safeSendMessage } from '../utils/telegramMarkdown.js';

const log = createLogger('pending-monitor');

/** @type {ReturnType<typeof setInterval> | null} */
let monitorTimer = null;

/** Cegah spam: minimal 25 menit antar notifikasi otomatis. */
let lastNotifyAt = 0;
const MIN_NOTIFY_GAP_MS = 25 * 60_000;

/**
 * Kirim ringkasan antrian pending ke chat notifikasi (jika ada pending).
 */
export async function notifyPendingQueueIfNeeded(reason = '') {
  const chatId = getRuntime('notifyChatId');
  if (!chatId) return;

  const { getBot } = await import('./bot.js');
  const bot = getBot();
  if (!bot) return;

  const data = await listPendingToday();
  if (!data.pending.length) return;

  const now = Date.now();
  const hasStuck = data.pending.some((r) => r.stuck);
  const hasStale = data.pending.some(
    (r) => r.kontenHari && r.kontenHari !== data.today
  );

  if (!hasStuck && !hasStale && now - lastNotifyAt < MIN_NOTIFY_GAP_MS) {
    return;
  }

  let report = formatPendingReport(data);
  if (reason) report = `📡 _${reason}_\n\n` + report;

  try {
    await safeSendMessage(bot.telegram, chatId, report, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
    lastNotifyAt = now;
    log.info(
      { pending: data.pending.length, reason },
      '[PendingMonitor] notified Telegram',
    );
  } catch (err) {
    log.warn({ err: err.message }, `[PendingMonitor] notify failed: ${err.message}`);
  }
}

/**
 * Loop berkala: ingatkan antrian pending + konten batch kemarin.
 */
export function startPendingMonitorLoop() {
  const minutes = Number(env.pendingMonitorMinutes) || 20;
  if (!minutes || monitorTimer) return;

  const ms = minutes * 60_000;
  monitorTimer = setInterval(() => {
    notifyPendingQueueIfNeeded(`cek otomatis tiap ${minutes} menit`).catch(
      (err) => {
        log.warn({ err: err.message }, `[PendingMonitor] loop: ${err.message}`);
      }
    );
  }, ms);

  log.info({ minutes }, '[PendingMonitor] Aktif — notifikasi antrian pending');
}

export function stopPendingMonitorLoop() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
