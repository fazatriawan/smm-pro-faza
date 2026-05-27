import { getSheetsClient } from '../config/google.js';
import { getSpreadsheetId, getSpreadsheetUrl } from './spreadsheetSetup.js';
import { columnLetterFromIndex, getHeaderRow } from '../config/sheetLayout.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('audit');

const DAILY_TAB_RE = /^\d{4}-\d{2}-\d{2}$/;

function quoteTab(tab) {
  return `'${String(tab).replace(/'/g, "''")}'`;
}

function isDailyTabTitle(title) {
  return DAILY_TAB_RE.test(String(title || '').trim());
}

function parseDayKey(s) {
  const t = String(s || '').trim();
  return DAILY_TAB_RE.test(t) ? t : '';
}

function parseAccountCell(s) {
  return String(s || '').replace(/^@/, '').trim();
}

/**
 * List existing daily tabs within [fromDayKey..toDayKey]
 * @param {string} spreadsheetId
 * @param {string} fromDayKey
 * @param {string} toDayKey
 */
async function listDailyTabsBetween(spreadsheetId, fromDayKey, toDayKey) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const titles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) || [];
  return titles
    .map((t) => String(t))
    .filter(isDailyTabTitle)
    .filter((t) => t >= fromDayKey && t <= toDayKey)
    .sort();
}

/**
 * Ensure a plain tab exists (no daily header enforcement).
 * @param {string} spreadsheetId
 * @param {string} tabName
 */
async function ensureTab(spreadsheetId, tabName) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === tabName);
  if (exists) return tabName;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }],
    },
  });
  log.info({ tabName }, '[Audit] Tab created');
  return tabName;
}

async function clearTab(spreadsheetId, tabName) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoteTab(tabName)}!A:ZZ`,
  });
}

/**
 * Read daily tab data rows (A2..lastCol)
 * @param {string} spreadsheetId
 * @param {string} tabName
 */
async function readDailyTabRows(spreadsheetId, tabName) {
  const sheets = getSheetsClient();
  const lastCol = columnLetterFromIndex(getHeaderRow().length);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteTab(tabName)}!A2:${lastCol}`,
  });
  return res.data.values || [];
}

function safeNum(v) {
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build audit report from Sheets tabs starting at fromDayKey.
 * Output: writes two tabs:
 *  - AUDIT-SUMMARY: top offenders (max total posts, max dupes/day)
 *  - AUDIT-DETAIL: per day per account breakdown
 *
 * @param {{ fromDayKey: string, toDayKey?: string }} input
 */
export async function buildAuditFromSheets(input) {
  const fromDayKey = parseDayKey(input.fromDayKey);
  if (!fromDayKey) throw new Error('Tanggal awal tidak valid. Format: YYYY-MM-DD');
  const toDayKey = parseDayKey(input.toDayKey) || fromDayKey; // if not provided, caller should pass today

  const spreadsheetId = await getSpreadsheetId();
  const url = await getSpreadsheetUrl();
  const tabs = await listDailyTabsBetween(spreadsheetId, fromDayKey, toDayKey);
  if (!tabs.length) {
    throw new Error(`Tidak ada tab harian antara ${fromDayKey}..${toDayKey}`);
  }

  // key: day|network|username
  /** @type {Map<string, { day: string, network: string, username: string, count: number, contents: Set<string>, postIds: Set<string> }>} */
  const byDayAccount = new Map();
  /** @type {Map<string, { network: string, username: string, total: number, days: Set<string> }>} */
  const byAccount = new Map();

  for (const tab of tabs) {
    const rows = await readDailyTabRows(spreadsheetId, tab);
    for (const r of rows) {
      const postId = String(r[1] || '').trim();
      const network = String(r[2] || '').trim().toLowerCase();
      const username = parseAccountCell(r[3] || '');
      const content = String(r[6] || '').trim();
      if (!network || !username) continue;
      if (/^REKAP/i.test(postId)) continue;

      const key = `${tab}|${network}|${username.toLowerCase()}`;
      if (!byDayAccount.has(key)) {
        byDayAccount.set(key, {
          day: tab,
          network,
          username,
          count: 0,
          contents: new Set(),
          postIds: new Set(),
        });
      }
      const entry = byDayAccount.get(key);
      entry.count += 1;
      if (content) entry.contents.add(content);
      if (postId) entry.postIds.add(postId);

      const accKey = `${network}|${username.toLowerCase()}`;
      if (!byAccount.has(accKey)) {
        byAccount.set(accKey, {
          network,
          username,
          total: 0,
          days: new Set(),
        });
      }
      const acc = byAccount.get(accKey);
      acc.total += 1;
      acc.days.add(tab);
    }
  }

  // Build detail rows
  const detailHeader = [
    'Hari',
    'Platform',
    'Username',
    'Jumlah upload (baris)',
    'Duplikat (jumlah-1)',
    'Jumlah konten unik',
    'Konten (sample)',
    'Post ID (sample)',
  ];
  const detailRows = [...byDayAccount.values()]
    .sort((a, b) => (a.day + a.network + a.username).localeCompare(b.day + b.network + b.username))
    .map((e) => {
      const dup = Math.max(0, e.count - 1);
      const contents = [...e.contents].slice(0, 3).join(' | ');
      const postIds = [...e.postIds].slice(0, 3).join(', ');
      return [
        e.day,
        e.network,
        `@${e.username}`,
        String(e.count),
        String(dup),
        String(e.contents.size),
        contents,
        postIds,
      ];
    });

  // Summary: top offenders by max dupes in a day and total
  /** @type {Map<string, { network: string, username: string, total: number, maxDaily: number, maxDailyDay: string }>} */
  const summaryByAcc = new Map();
  for (const e of byDayAccount.values()) {
    const accKey = `${e.network}|${e.username.toLowerCase()}`;
    if (!summaryByAcc.has(accKey)) {
      summaryByAcc.set(accKey, {
        network: e.network,
        username: e.username,
        total: 0,
        maxDaily: 0,
        maxDailyDay: '',
      });
    }
    const s = summaryByAcc.get(accKey);
    s.total += e.count;
    if (e.count > s.maxDaily) {
      s.maxDaily = e.count;
      s.maxDailyDay = e.day;
    }
  }

  const summaryHeader = [
    'Platform',
    'Username',
    'Total upload (range)',
    'Max upload dalam 1 hari',
    'Tanggal max',
    'Catatan',
  ];
  const summaryRows = [...summaryByAcc.values()]
    .sort((a, b) => b.maxDaily - a.maxDaily || b.total - a.total)
    .slice(0, 500)
    .map((s) => [
      s.network,
      `@${s.username}`,
      String(s.total),
      String(s.maxDaily),
      s.maxDailyDay,
      s.maxDaily >= 3 ? '⚠️ duplikat berat' : s.maxDaily === 2 ? '⚠️ duplikat' : '',
    ]);

  // Write tabs
  const summaryTab = `AUDIT-SUMMARY ${fromDayKey}`;
  const detailTab = `AUDIT-DETAIL ${fromDayKey}`;
  await ensureTab(spreadsheetId, summaryTab);
  await ensureTab(spreadsheetId, detailTab);
  await clearTab(spreadsheetId, summaryTab);
  await clearTab(spreadsheetId, detailTab);

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteTab(summaryTab)}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [summaryHeader, ...summaryRows] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteTab(detailTab)}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [detailHeader, ...detailRows] },
  });

  return {
    spreadsheetId,
    url,
    tabsScanned: tabs.length,
    rowsDetail: detailRows.length,
    summaryTab,
    detailTab,
    fromDayKey,
    toDayKey,
  };
}

