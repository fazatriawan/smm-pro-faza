import { env } from '../config/env.js';
import { getSpreadsheetId, getSpreadsheetUrl } from './spreadsheetSetup.js';
import { getDailyTabName } from './sheets.js';
import { getSheetsClient } from '../config/google.js';
import { getBot, getNotifyChat } from './bot.js';
import {
  columnLetterFromIndex,
  getSheetColumnCount,
  SHEET_STATUS_COLUMN_INDEX,
} from '../config/sheetLayout.js';

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
    const colLetter = columnLetterFromIndex(getSheetColumnCount());
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName.replace(/'/g, "''")}'!A:${colLetter}`,
    });
    const rows = res.data.values || [];
    const count = Math.max(0, rows.length - 1);
    let live = 0;
    let fail = 0;
    let pending = 0;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').startsWith('REKAP')) continue;
      const cell = String(rows[i][SHEET_STATUS_COLUMN_INDEX] || '');
      const st = cell.toLowerCase();
      if (st.includes('gagal')) fail += 1;
      else if (st.includes('pending')) pending += 1;
      else if (st.includes('live')) live += 1;
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
    console.warn('[DailySummary]', err.message);
  }
}

export function startDailySummaryLoop() {
  if (!env.dailySummaryEnabled) return;
  setInterval(() => {
    maybeSendDailySummary().catch((err) =>
      console.warn('[DailySummary]', err.message)
    );
  }, 60_000);
  console.log(
    `[DailySummary] Aktif — jam ${env.dailySummaryHour}:00 ${env.timezone}`
  );
}
