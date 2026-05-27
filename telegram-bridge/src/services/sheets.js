import { getSheetsClient } from '../config/google.js';
import { env } from '../config/env.js';
import { buildLivePostUrl } from '../utils/platformUrl.js';
import { getSpreadsheetId, getSpreadsheetUrl } from './spreadsheetSetup.js';
import {
  PLATFORM_LABELS,
  PLATFORM_COLUMNS,
  PLATFORM_SORT_ORDER,
  getHeaderRow,
  getSheetColumnCount,
  columnLetterFromIndex,
  SHEET_STATUS_COLUMN_INDEX,
} from '../config/sheetLayout.js';
import {
  summarizePublishResults,
  mergeSheetAccounts,
  shortenPublishError,
  formatWebhookNotify,
  buildSheetAccountsFromTargets,
  summarizeSheetAccounts,
} from './publishResult.js';
import { getPost, listSocialAccounts } from './outstand.js';
import {
  annotateAccountsWithDayAttempts,
  annotateNewAccountsAgainstDayHistory,
  buildDuplicateAccountSummary,
  buildDuplicateRekapSheetRows,
} from '../utils/accountDayUsage.js';
import { formatWibDateTime, getWibDayKey } from '../utils/wibTime.js';
import { buildContentLabel, shortenContentLabel } from '../utils/contentLabel.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sheets');
import { reconcileSheetAccounts } from '../utils/accountDayUsage.js';
import {
  sheetHttpLinkCell,
  sheetNoteForAccount,
  sheetPlatformLinkCell,
  isValidOutstandPostId,
  sheetStatusLabel,
} from '../utils/postStatus.js';

/** @type {Map<string, { postIds: string[], expectedAccountIds: string[], baseCaption: string, contentLabel?: string, folderName?: string, targetLabel?: string, mediaFilesDay?: string, timestamp: string }>} */
const publishContextByPostId = new Map();

const SHEET_BATCH_REFRESH_DELAYS_MS = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  120 * 60_000,
];

/** @type {ReturnType<typeof setInterval> | null} */
let todaySheetAutoRefreshTimer = null;

function splitPostIds(postId) {
  return String(postId || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} postIds
 * @param {string[]} expectedAccountIds
 * @param {string} baseCaption
 * @param {string} [timestamp]
 * @param {{ folderName?: string, targetLabel?: string, mediaFiles?: Array<{ name?: string }>, contentLabel?: string, mediaFilesDay?: string }} [meta]
 */
export function registerPublishContext(
  postIds,
  expectedAccountIds,
  baseCaption,
  timestamp,
  meta = {}
) {
  const ts = timestamp || new Date().toISOString();
  const contentLabel =
    meta.contentLabel ||
    buildContentLabel({
      folderName: meta.folderName,
      caption: baseCaption,
      mediaFiles: meta.mediaFiles,
      targetLabel: meta.targetLabel,
    });
  const entry = {
    postIds: postIds.filter(Boolean),
    expectedAccountIds: expectedAccountIds.filter(Boolean),
    baseCaption,
    contentLabel,
    folderName: meta.folderName || '',
    targetLabel: meta.targetLabel || '',
    mediaFilesDay: meta.mediaFilesDay || '',
    timestamp: ts,
  };
  for (const id of entry.postIds) {
    publishContextByPostId.set(id, entry);
  }
}

/**
 * @param {Array<object>} accounts
 * @param {{ baseCaption?: string, contentLabel?: string, folderName?: string, targetLabel?: string }} [event]
 */
function attachContentLabelsToAccounts(accounts, event = {}) {
  const fallbackLabel =
    event.contentLabel ||
    buildContentLabel({
      folderName: event.folderName,
      caption: event.baseCaption,
      targetLabel: event.targetLabel,
    });

  return accounts.map((acc) => {
    const ctx = acc.postId ? getPublishContext(acc.postId) : null;
    const label =
      acc.contentLabel ||
      ctx?.contentLabel ||
      (acc.postCaption
        ? buildContentLabel({ caption: acc.postCaption, folderName: ctx?.folderName })
        : '') ||
      fallbackLabel ||
      shortenContentLabel(ctx?.baseCaption || event.baseCaption || '');

    const mediaFilesDay = ctx?.mediaFilesDay || '';
    const todayDay = getWibDayKey();
    const staleBatch =
      mediaFilesDay && todayDay && mediaFilesDay !== todayDay;
    const finalLabel = staleBatch
      ? `⚠️${mediaFilesDay} ${shortenContentLabel(label, 95)}`
      : shortenContentLabel(label, 110);

    return {
      ...acc,
      contentLabel: finalLabel,
      mediaFilesDay: mediaFilesDay || undefined,
      kontenHari: mediaFilesDay || undefined,
    };
  });
}

/**
 * @param {string} postId
 */
function getPublishContext(postId) {
  return publishContextByPostId.get(postId) || null;
}

/**
 * @param {string[]} postIds
 */
async function fetchPostsFresh(postIds) {
  return (
    await Promise.all(
      postIds.map((id) =>
        getPost(id).catch((err) => {
          log.warn({ postId: id, err: err.message }, `[Sheets] getPost ${id}: ${err.message}`);
          return null;
        })
      )
    )
  ).filter(Boolean);
}

async function resolveAccountsForSheetWrite(accounts, postIds) {
  if (!accounts.length) return accounts;
  try {
    const { collectTodayPublishLinks } = await import('./todayPublish.js');
    const today = await collectTodayPublishLinks();
    const existing = (today.accounts || []).filter(
      (a) => !postIds.includes(a.postId || '')
    );
    return annotateNewAccountsAgainstDayHistory(existing, accounts);
  } catch (err) {
    log.warn({ err: err.message }, `[Sheets] day attempt annotate: ${err.message}`);
    return annotateAccountsWithDayAttempts(accounts);
  }
}

/**
 * @param {Array<{ network?: string, username?: string }>} accounts
 */
function sortAccountsForSheet(accounts) {
  const order = PLATFORM_SORT_ORDER;
  return [...accounts].sort((a, b) => {
    const netA = (a.network || '').toLowerCase();
    const netB = (b.network || '').toLowerCase();
    const ia = order.indexOf(netA);
    const ib = order.indexOf(netB);
    const ra = ia === -1 ? 99 : ia;
    const rb = ib === -1 ? 99 : ib;
    if (ra !== rb) return ra - rb;
    return (a.username || '').localeCompare(b.username || '', 'id');
  });
}

/**
 * Satu baris = satu posting. Kolom per platform (@ + Link berdampingan).
 * Hanya kolom platform terkait yang diisi; diurutkan per platform (FB → IG → …).
 */
function buildPublishEventRows(event) {
  const fallbackPostId = splitPostIds(event.postId || '')[0] || '';
  const ytTitle = event.youtubeTitle || '';
  const annotated = (event.accounts || []).some((a) => a.attemptToday != null)
    ? event.accounts
    : annotateAccountsWithDayAttempts(event.accounts || []);
  const sorted = sortAccountsForSheet(annotated);

  return sorted.map((acc) => {
    const colKey = mapNetworkToColumnKey(acc.network);
    const user = (acc.username || '').replace(/^@/, '');
    const st = acc.status || 'pending';
    const accountName = user;
    const liveUrl = buildLivePostUrl(
      acc.network,
      accountName,
      acc.platformPostId,
      acc.url,
      acc.pageId
    );
    const note = sheetNoteForAccount(acc, event.timestamp);
    const platformLabel = PLATFORM_LABELS[colKey] || colKey || '';
    const attempt = acc.attemptToday ?? 1;
    const duplikat = acc.isDuplicate ? `⚠️ ${attempt}×` : '';
    const konten = acc.contentLabel || '';

    const platformCells = PLATFORM_COLUMNS.flatMap((c) => {
      if (c.key !== colKey) return ['', ''];
      return [
        user ? `@${user}` : '',
        sheetPlatformLinkCell(acc, liveUrl),
      ];
    });

    return [
      formatWibDateTime(acc.rowTimestamp || event.timestamp),
      acc.postId || fallbackPostId,
      platformLabel,
      user ? `@${user}` : '',
      String(attempt),
      duplikat,
      konten,
      sheetStatusLabel(st, acc, event.timestamp),
      sheetHttpLinkCell(liveUrl, st),
      note,
      colKey === 'youtube' ? ytTitle : '',
      ...platformCells,
    ];
  });
}

/**
 * Hapus semua baris data (sisakan header) — hindari campur format lama.
 */
async function clearDailyTabDataRows(spreadsheetId, tabName) {
  const sheets = getSheetsClient();
  const colLetter = columnLetterFromIndex(getSheetColumnCount());
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoteTab(tabName)}!A2:${colLetter}`,
  });
}

/**
 * @param {string} spreadsheetId
 * @param {string} tabName
 */
async function getSheetIdByTitle(spreadsheetId, tabName) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  if (sheet?.properties?.sheetId == null) {
    throw new Error(`Tab tidak ditemukan: ${tabName}`);
  }
  return sheet.properties.sheetId;
}

/**
 * @param {string} spreadsheetId
 * @param {string} tabName
 * @param {string[]} postIds
 */
async function findSheetRowsByPostIds(spreadsheetId, tabName, postIds) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteTab(tabName)}!B:B`,
  });
  const rows = res.data.values || [];
  const needles = new Set(postIds.map((id) => id.trim()).filter(Boolean));
  /** @type {number[]} */
  const indices = [];

  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i][0] || '').trim();
    const cellIds = splitPostIds(cell);
    if (cellIds.some((id) => needles.has(id)) || needles.has(cell)) {
      indices.push(i + 1);
    }
  }
  return indices;
}

/**
 * @param {string} spreadsheetId
 * @param {string} tabName
 * @param {string[]} postIds
 */
async function deleteRowsForPostIds(spreadsheetId, tabName, postIds) {
  const rowIndices = await findSheetRowsByPostIds(spreadsheetId, tabName, postIds);
  if (!rowIndices.length) return 0;

  const sheetId = await getSheetIdByTitle(spreadsheetId, tabName);
  const sheets = getSheetsClient();
  const requests = rowIndices
    .sort((a, b) => b - a)
    .map((rowIndex) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowIndex - 1,
          endIndex: rowIndex,
        },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  return rowIndices.length;
}

/**
 * Hapus baris lama untuk Post ID ini, tulis satu baris per akun.
 * @param {{ timestamp: string, postId?: string, youtubeTitle?: string, statusSummary?: string, errorNotes?: string, accounts: Array<object> }} event
 */
export async function upsertPublishEventRow(event) {
  const spreadsheetId = await getSpreadsheetId();
  const tabName = await ensureDailySheetTab(
    spreadsheetId,
    getDailyTabName(event.timestamp)
  );
  const sheets = getSheetsClient();
  const colLetter = columnLetterFromIndex(getSheetColumnCount());

  const postIds = [
    ...new Set(
      [
        ...splitPostIds(event.postId || ''),
        ...event.accounts
          .map((a) => a.postId)
          .filter(Boolean),
      ].filter(Boolean)
    ),
  ];

  const accountsForRows = attachContentLabelsToAccounts(
    await resolveAccountsForSheetWrite(event.accounts || [], postIds),
    event
  );
  const rows = buildPublishEventRows({ ...event, accounts: accountsForRows });
  if (!rows.length) {
    return {
      tabName,
      spreadsheetUrl: getSpreadsheetUrl(spreadsheetId),
      updated: false,
      rowCount: 0,
    };
  }

  const deleted =
    !event.skipDelete && postIds.length
      ? await deleteRowsForPostIds(spreadsheetId, tabName, postIds)
      : 0;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteTab(tabName)}!A:${colLetter}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  log.info(
    { tabName, rows: rows.length, deleted },
    `[Sheets] ${rows.length} baris (${deleted} baris lama dihapus) tab ${tabName}`,
  );

  return {
    tabName,
    spreadsheetUrl: getSpreadsheetUrl(spreadsheetId),
    updated: deleted > 0,
    rowCount: rows.length,
    deletedRows: deleted,
    deduped: false,
  };
}

/**
 * Kosongkan tab harian lalu tulis ulang semua baris (format rapi, @ + Link berdampingan).
 * @param {{ timestamp: string, postId?: string, youtubeTitle?: string, accounts: Array<object> }} event
 */
export async function rewriteDailyTabFromAccounts(event) {
  const spreadsheetId = await getSpreadsheetId();
  const tabName = await ensureDailySheetTab(
    spreadsheetId,
    getDailyTabName(event.timestamp)
  );
  await clearDailyTabDataRows(spreadsheetId, tabName);

  const colCount = getSheetColumnCount();
  const annotated = attachContentLabelsToAccounts(
    annotateAccountsWithDayAttempts(event.accounts || []),
    event
  );
  const dupes = buildDuplicateAccountSummary(annotated);
  const rekapRows = buildDuplicateRekapSheetRows(dupes, colCount);
  const dataRows = buildPublishEventRows({ ...event, accounts: annotated });
  const allRows = [...rekapRows, ...dataRows];

  if (!allRows.length) {
    return {
      tabName,
      spreadsheetUrl: getSpreadsheetUrl(spreadsheetId),
      recorded: 0,
      duplicateAccounts: dupes.length,
    };
  }

  const sheets = getSheetsClient();
  const colLetter = columnLetterFromIndex(colCount);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteTab(tabName)}!A:${colLetter}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: allRows },
  });

  log.info(
    { tabName, rows: dataRows.length, dupes: dupes.length },
    `[Sheets] rewrite tab ${tabName}: ${dataRows.length} baris data` +
      (dupes.length ? `, ${dupes.length} akun duplikat` : ''),
  );

  return {
    tabName,
    spreadsheetUrl: getSpreadsheetUrl(spreadsheetId),
    recorded: dataRows.length,
    duplicateAccounts: dupes.length,
    rowCount: allRows.length,
  };
}

/**
 * Ambil status semua akun dari Outstand (tanpa menulis Sheets).
 * @param {{ postIds: string[], expectedAccountIds?: string[], baseCaption?: string }} input
 */
export async function fetchPublishAccountStatuses({
  postIds,
  expectedAccountIds,
  baseCaption = '',
}) {
  const ids = (postIds || []).filter(Boolean);
  if (!ids.length) {
    throw new Error('Post ID kosong');
  }

  const ctx = getPublishContext(ids[0]);
  const expected =
    expectedAccountIds?.length
      ? expectedAccountIds
      : ctx?.expectedAccountIds || [];
  const caption = baseCaption || ctx?.baseCaption || '';

  const resolvedPosts = await fetchPostsFresh(ids);
  const allAccounts = await listSocialAccounts();

  let accounts;
  if (expected.length) {
    accounts = buildSheetAccountsFromTargets(
      allAccounts,
      expected,
      resolvedPosts
    );
  } else {
    accounts = summarizePublishResults(resolvedPosts, caption).sheetAccounts;
  }

  const meta = summarizeSheetAccounts(mergeSheetAccounts(accounts), caption);
  return {
    accounts,
    meta,
    postIds: ids,
    postIdLine: ids.join(', '),
  };
}

export async function refreshPublishResultsInSheet({
  postIds,
  expectedAccountIds,
  baseCaption = '',
  timestamp,
  replaceWholeTab = false,
  folderName,
  targetLabel,
  contentLabel,
}) {
  const ids = (postIds || []).filter(Boolean);
  if (!ids.length) {
    throw new Error('Post ID kosong');
  }

  const ctx = getPublishContext(ids[0]);
  const ts = timestamp || ctx?.timestamp || new Date().toISOString();

  const { accounts: rawAccounts, meta } = await fetchPublishAccountStatuses({
    postIds: ids,
    expectedAccountIds,
    baseCaption,
  });
  const accounts = reconcileSheetAccounts(rawAccounts);
  const postId = ids.join(', ');

  const spreadsheetId = await getSpreadsheetId();
  const tabName = await ensureDailySheetTab(
    spreadsheetId,
    getDailyTabName(ts)
  );

  if (replaceWholeTab) {
    await clearDailyTabDataRows(spreadsheetId, tabName);
  }

  const result = await upsertPublishEventRow({
    timestamp: ts,
    postId,
    youtubeTitle: meta.youtubeTitle,
    statusSummary: meta.statusSummary,
    errorNotes: meta.errorNotes,
    accounts,
    baseCaption,
    folderName,
    targetLabel,
    contentLabel,
    skipDelete: replaceWholeTab,
  });

  return {
    recorded: accounts.length,
    ...result,
    summary: {
      ...meta,
      sheetAccounts: accounts,
      published: meta.published,
      failed: meta.failed,
      pending: meta.pending,
    },
  };
}

/**
 * @param {string[]} postIds
 * @param {string[]} expectedAccountIds
 * @param {string} baseCaption
 */
export function scheduleSheetRefresh(
  postIds,
  expectedAccountIds,
  baseCaption,
  meta = {}
) {
  const ids = postIds.filter(Boolean);
  if (!ids.length) return;

  registerPublishContext(ids, expectedAccountIds, baseCaption, undefined, meta);

  for (const delayMs of SHEET_BATCH_REFRESH_DELAYS_MS) {
    setTimeout(() => {
      refreshPublishResultsInSheet({
        postIds: ids,
        expectedAccountIds,
        baseCaption,
        folderName: meta.folderName,
        targetLabel: meta.targetLabel,
        contentLabel: meta.contentLabel,
      }).catch((err) => {
        log.error(
          { delayMin: delayMs / 60000, err: err.message },
          `[Sheets] batch refresh +${delayMs / 60000}m: ${err.message}`,
        );
      });
    }, delayMs);
  }

  for (const delayMs of [15 * 60_000, 60 * 60_000]) {
    setTimeout(() => {
      refreshTodaySheetQuietly(`+${delayMs / 60000}m`).catch((err) => {
        log.error(
          { delayMin: delayMs / 60000, err: err.message },
          `[Sheets] today refresh +${delayMs / 60000}m: ${err.message}`,
        );
      });
    }, delayMs);
  }
}

/**
 * Refresh seluruh tab hari ini (semua Post ID) — status Gagal→Live ikut terbarui.
 * @param {string} [reason]
 */
export async function refreshTodaySheetQuietly(reason = '') {
  const { refreshTodaySheetFromOutstand } = await import('./todayPublish.js');
  const result = await refreshTodaySheetFromOutstand();
  log.info(
    { tabName: result.tabName, reason, recorded: result.recorded },
    `[Sheets] Tab ${result.tabName} disinkronkan` +
      (reason ? ` (${reason})` : '') +
      ` · ${result.recorded} baris`,
  );
  return result;
}

/**
 * Timer berkala: sync tab hari ini dari Outstand (semua platform).
 */
export function startTodaySheetAutoRefreshLoop() {
  const minutes = env.sheetAutoRefreshMinutes;
  if (!minutes || todaySheetAutoRefreshTimer) return;

  const ms = minutes * 60_000;
  todaySheetAutoRefreshTimer = setInterval(() => {
    refreshTodaySheetQuietly(`auto ${minutes}m`).catch((err) => {
      log.error({ err: err.message }, `[Sheets] auto refresh: ${err.message}`);
    });
  }, ms);

  log.info(
    { minutes },
    `[Sheets] Auto-refresh tab harian setiap ${minutes} menit (semua Post ID hari ini)`,
  );
}

export function stopTodaySheetAutoRefreshLoop() {
  if (todaySheetAutoRefreshTimer) {
    clearInterval(todaySheetAutoRefreshTimer);
    todaySheetAutoRefreshTimer = null;
  }
}

export function getDailyTabName(isoTimestamp) {
  const d = isoTimestamp ? new Date(isoTimestamp) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(d)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, /** @type {Record<string,string>} */ ({}));

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeNetwork(network) {
  const n = (network || '').toLowerCase().trim();
  if (n === 'twitter') return 'x';
  return n;
}

function mapNetworkToColumnKey(network) {
  const n = normalizeNetwork(network);
  return PLATFORM_COLUMNS.find((c) => c.key === n)?.key || n || null;
}

function quoteTab(tabName) {
  return `'${tabName.replace(/'/g, "''")}'`;
}

/**
 * Post ID dari kolom B tab harian (baris yang sudah pernah dicatat).
 * @param {string} [tabName] default: hari ini (TZ env)
 */
export async function readPostIdsFromDailyTab(tabName) {
  const tab = tabName || getDailyTabName();
  const spreadsheetId = await getSpreadsheetId();
  await ensureDailySheetTab(spreadsheetId, tab);

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteTab(tab)}!B2:B2000`,
  });

  const ids = new Set();
  for (const row of res.data.values || []) {
    const cell = String(row[0] || '').trim();
    if (!cell || cell.startsWith('REKAP')) continue;
    for (const id of splitPostIds(cell)) {
      if (isValidOutstandPostId(id)) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Post ID dari baris terakhir tab harian (hindari /retry tanpa arg menggabung semua batch hari ini).
 * @param {string} [tabName]
 */
export async function readLatestPostIdsFromDailyTab(tabName) {
  const tab = tabName || getDailyTabName();
  const spreadsheetId = await getSpreadsheetId();
  await ensureDailySheetTab(spreadsheetId, tab);

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteTab(tab)}!B2:B2000`,
  });

  const rows = res.data.values || [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const cell = String(rows[i][0] || '').trim();
    if (!cell || cell.startsWith('REKAP')) continue;
    const ids = splitPostIds(cell).filter((id) => isValidOutstandPostId(id));
    if (ids.length) return ids;
  }
  return [];
}

export async function ensureDailySheetTab(spreadsheetId, tabName) {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const exists = meta.data.sheets?.some((s) => s.properties?.title === tabName);
  const header = getHeaderRow();
  const lastCol = columnLetterFromIndex(header.length);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    log.info({ tabName }, `[Sheets] Tab baru: ${tabName}`);
  }

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteTab(tabName)}!A1:${lastCol}1`,
  });
  const currentHeader = headerRes.data.values?.[0] || [];
  if (currentHeader.join('|') !== header.join('|')) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteTab(tabName)}!A1:${lastCol}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] },
    });
    log.info({ tabName }, `[Sheets] Header tab ${tabName} diperbarui`);
  }

  return tabName;
}

/** @deprecated Gunakan upsertPublishEventRow / refreshPublishResultsInSheet */
export async function appendPublishEventRow(event) {
  return upsertPublishEventRow(event);
}

/**
 * @param {{ postIds: string[], posts?: Array<object>, expectedAccountIds?: string[], timestamp?: string, baseCaption?: string }} input
 */
export async function recordPublishResultsToSheet({
  postIds,
  posts: _posts,
  expectedAccountIds,
  timestamp,
  baseCaption,
  folderName,
  targetLabel,
  mediaFiles,
  contentLabel,
}) {
  const ids = (postIds || []).filter(Boolean);
  const ts = timestamp || new Date().toISOString();
  const meta = { folderName, targetLabel, mediaFiles, contentLabel };

  if (expectedAccountIds?.length) {
    registerPublishContext(ids, expectedAccountIds, baseCaption || '', ts, meta);
  }

  return refreshPublishResultsInSheet({
    postIds: ids,
    expectedAccountIds,
    baseCaption,
    timestamp: ts,
    folderName,
    targetLabel,
    contentLabel:
      contentLabel ||
      buildContentLabel({
        folderName,
        caption: baseCaption,
        mediaFiles,
        targetLabel,
      }),
  });
}

/** @deprecated */
export async function recordPublishedPostsToSheet(input) {
  return recordPublishResultsToSheet(input);
}

/**
 * @param {object} payload
 * @param {(text: string) => Promise<void>} [notify]
 */
export async function recordWebhookToSheet(payload, notify) {
  const event = payload?.event;
  if (event !== 'post.published' && event !== 'post.error') {
    return { recorded: 0 };
  }

  const postId = payload.data?.postId || '';
  if (!postId) return { recorded: 0 };

  const ctx = getPublishContext(postId);
  const postIds = ctx?.postIds?.length ? ctx.postIds : [postId];

  try {
    const result = await refreshPublishResultsInSheet({
      postIds,
      expectedAccountIds: ctx?.expectedAccountIds,
      baseCaption: ctx?.baseCaption || '',
      timestamp: ctx?.timestamp || payload.timestamp,
    });

    refreshTodaySheetQuietly('webhook').catch((err) => {
      log.warn({ err: err.message }, `[Sheets] webhook full-tab refresh: ${err.message}`);
    });

    if (notify) {
      const ctxStale =
        ctx?.mediaFilesDay && ctx.mediaFilesDay !== getWibDayKey();
      let notifyText = formatWebhookNotify(result.summary, postIds.join(', '));
      if (ctxStale && event === 'post.published') {
        notifyText +=
          `\n\n⚠️ *Konten batch ${ctx.mediaFilesDay}* baru live dari antrian — ` +
          `bukan folder hari ini. Cek profil & batalkan sisa antrian: \`/stop\``;
      }
      await notify(notifyText);
    }

    return {
      recorded: result.recorded,
      tabName: result.tabName,
      summary: result.summary,
      updated: result.updated,
    };
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, `[Sheets] webhook refresh: ${err?.message || err}`);
    return { recorded: 0 };
  }
}
