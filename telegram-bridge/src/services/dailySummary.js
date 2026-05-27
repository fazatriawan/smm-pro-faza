import { env } from '../config/env.js';
import { getSpreadsheetId, getSpreadsheetUrl } from './spreadsheetSetup.js';
import { getDailyTabName } from './sheets.js';
import { getSheetsClient } from '../config/google.js';
import { getBot, getNotifyChat } from './bot.js';
import {
  columnLetterFromIndex,
  isLegacySheetHeader,
  isWideSheetHeader,
  parseWideSheetHeader,
} from '../config/sheetLayout.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('daily-summary');

let lastSummaryDate = '';

/**
 * Kirim ringkasan baris Sheets hari ini (sekali per hari).
 */
export async function maybeSendDailySummary() {
  if (!env.dailySummaryEnabled) return;

  const tabName = getDailyTabName();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: env.timezone,
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  );

  if (hour !== env.dailySummaryHour) return;
  if (lastSummaryDate === tabName) return;
  lastSummaryDate = tabName;

  const chatId = getNotifyChat('default');
  const bot = getBot();
  if (!bot || !chatId) return;

  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName.replace(/'/g, "''")}'!A:ZZ`,
    });
    const rows = res.data.values || [];
    const header = rows[0] || [];
    const colLetter = columnLetterFromIndex(Math.max(header.length, 4));
    const count = Math.max(0, rows.length - 1);
    let live = 0;
    let fail = 0;
    let pending = 0;

    const tallyStatus = (cell) => {
      const st = String(cell || '').toLowerCase();
      if (st.includes('gagal')) fail += 1;
      else if (st.includes('pending')) pending += 1;
      else if (st.includes('live')) live += 1;
    };

    if (isWideSheetHeader(header)) {
      const { instructions } = parseWideSheetHeader(header);
      const statusCols = instructions.map((i) => i.statusIdx);
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').startsWith('REKAP')) continue;
        for (const col of statusCols) {
          const cell = String(rows[i][col] || '').trim();
          if (cell) tallyStatus(cell);
        }
      }
    } else {
      const statusIdx = isLegacySheetHeader(header) ? 7 : 7;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').startsWith('REKAP')) continue;
        tallyStatus(rows[i][statusIdx]);
      }
    }

    await bot.telegram.sendMessage(
      chatId,
      `📊 *Ringkasan harian* (${tabName})\n` +
        `Total baris: ${count}\n` +
        `✅ Live: ${live}\n` +
        `⏳ Pending: ${pending}\n` +
        `❌ Gagal: ${fail}\n\n` +
        getSpreadsheetUrl(spreadsheetId),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    log.warn({ err: err.message }, `[DailySummary] ${err.message}`);
  }
}

export function startDailySummaryLoop() {
  if (!env.dailySummaryEnabled) return;
  setInterval(() => {
    maybeSendDailySummary().catch((err) =>
      log.warn({ err: err.message }, `[DailySummary] ${err.message}`),
    );
  }, 60_000);
  log.info(
    { hour: env.dailySummaryHour, timezone: env.timezone },
    `[DailySummary] Aktif — jam ${env.dailySummaryHour}:00 ${env.timezone}`,
  );
}
