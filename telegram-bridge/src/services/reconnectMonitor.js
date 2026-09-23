import { env } from '../config/env.js';
import { listSocialAccounts } from './publisher.js';
import { getBot, getNotifyChat } from './bot.js';
import { getDailyTabName } from './sheets.js';
import { getWibDayKey } from '../utils/wibTime.js';
import { createLogger } from '../utils/logger.js';
import { loadTokenIssues } from '../utils/tokenIssues.js';

const log = createLogger('reconnect-monitor');

let lastNotifyDate = '';

/**
 * Cek akun yang perlu reconnect dan kirim notifikasi ke Telegram.
 * Dipanggil sekali per hari pada jam yang dikonfigurasi.
 *
 * Dua sumber sinyal digabung karena tidak ada satupun yang cukup sendirian:
 * - `isActive === false` dari listSocialAccounts() — hanya terisi di adapter
 *   Woopsocial. PostForMe tidak mengembalikan field ini sama sekali, jadi untuk
 *   publisher itu bagian ini selalu kosong (lihat postforme.js listSocialAccounts).
 * - token-issues.js — akun yang publish-nya benar-benar gagal dengan error
 *   token/permission (dicatat syncTokenIssuesFromSummary di bot.js tiap publish).
 *   Ini yang menangkap kasus dashboard publisher masih bilang "connected" padahal
 *   refresh token sudah mati di TikTok/Meta.
 */
export async function maybeSendReconnectAlert() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: env.timezone,
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  );

  const alertHour = Math.max(
    0,
    Math.min(23, Number(process.env.RECONNECT_ALERT_HOUR || 8))
  );

  if (hour !== alertHour) return;

  const today = getWibDayKey();
  if (lastNotifyDate === today) return;
  lastNotifyDate = today;

  const bot = getBot();
  const chatId = getNotifyChat('default');
  if (!bot || !chatId) return;

  try {
    const accounts = await listSocialAccounts();
    const inactive = accounts
      .filter((a) => a.isActive === false)
      .map((a) => ({ id: a.id, network: a.network, username: a.username, error: '' }));

    const inactiveIds = new Set(inactive.map((a) => a.id));
    const tokenIssueAccounts = loadTokenIssues()
      .filter((t) => !inactiveIds.has(t.accountId))
      .map((t) => ({ id: t.accountId, network: t.network, username: t.username, error: t.error }));

    const combined = [...inactive, ...tokenIssueAccounts];
    if (!combined.length) return;

    const NET_LABEL = {
      instagram: 'IG', facebook: 'FB', threads: 'Threads',
      youtube: 'YT', x: 'X', tiktok: 'TT',
    };

    const escUser = (s) => String(s || '').replace(/_/g, '\\_');
    const lines = [
      `🔴 *${combined.length} akun perlu reconnect* (${getDailyTabName()})`,
      '',
    ];

    const byNet = {};
    for (const a of combined) {
      const net = (a.network || 'other').toLowerCase();
      if (!byNet[net]) byNet[net] = [];
      byNet[net].push(a);
    }

    for (const [net, accs] of Object.entries(byNet)) {
      const label = NET_LABEL[net] || net.toUpperCase();
      lines.push(`*${label}* (${accs.length}):`);
      for (const a of accs.slice(0, 10)) {
        const errNote = a.error ? ` — _${a.error.slice(0, 60).replace(/_/g, '\\_')}_` : '';
        lines.push(`• @${escUser(a.username || a.id)}${errNote}`);
      }
      if (accs.length > 10) lines.push(`  _…+${accs.length - 10} lagi_`);
    }

    lines.push('', '_Reconnect di dashboard publisher aktif → Social Accounts. Status "connected" di dashboard tidak menjamin token masih hidup._');
    lines.push('_Cek semua: `/cekakun`_');

    await bot.telegram.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'Markdown',
    });
    log.info({ count: combined.length }, `[ReconnectMonitor] Alert dikirim: ${combined.length} akun`);
  } catch (err) {
    log.warn({ err: err.message }, `[ReconnectMonitor] ${err.message}`);
  }
}

export function startReconnectMonitor() {
  const alertHour = Number(process.env.RECONNECT_ALERT_HOUR || 8);
  setInterval(() => {
    maybeSendReconnectAlert().catch((err) =>
      log.warn({ err: err.message }, `[ReconnectMonitor] ${err.message}`)
    );
  }, 60_000);
  log.info({ hour: alertHour }, `[ReconnectMonitor] Aktif — jam ${alertHour}:00 ${env.timezone}`);
}
