import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getSheetsClient } from '../config/google.js';
import { env } from '../config/env.js';
import { buildLivePostUrl } from '../utils/platformUrl.js';
import { getSpreadsheetId, getSpreadsheetUrl } from './spreadsheetSetup.js';
import {
  PLATFORM_LABELS,
  PLATFORM_COLUMNS,
  PLATFORM_SORT_ORDER,
  WIDE_ROW_HEADERS,
  buildWideHeaderRow,
  getWideBaseHeaderRow,
  getSheetColumnCount,
  columnLetterFromIndex,
  isLegacySheetHeader,
  isWideSheetHeader,
  parseWideSheetHeader,
} from '../config/sheetLayout.js';
import { shortKey } from '../utils/idempotency.js';
import {
  summarizePublishResults,
  mergeSheetAccounts,
  shortenPublishError,
  formatWebhookNotify,
  buildSheetAccountsFromTargets,
  summarizeSheetAccounts,
} from './publishResult.js';
import { getPost, listSocialAccounts } from './publisher.js';
import {
  annotateAccountsWithDayAttempts,
  annotateNewAccountsAgainstDayHistory,
  buildDuplicateAccountSummary,
  buildDuplicateRekapSheetRows,
} from '../utils/accountDayUsage.js';
import { formatWibDateTime, formatWibTimeShort, getWibDayKey } from '../utils/wibTime.js';
import { buildContentLabel, shortenContentLabel } from '../utils/contentLabel.js';
import { createLogger } from '../utils/logger.js';
import { withSheetLock } from '../utils/sheetMutex.js';
import { resolveConflictTabs } from './sheetConflict.js';

const log = createLogger('sheets');
import { reconcileSheetAccounts } from '../utils/accountDayUsage.js';
import {
  sheetHttpLinkCell,
  sheetNoteForAccount,
  sheetPlatformLinkCell,
  isValidOutstandPostId,
  sheetStatusLabel,
} from '../utils/postStatus.js';

/** @type {Map<string, { postIds: string[], expectedAccountIds: string[], baseCaption: string, contentLabel?: string, folderName?: string, targetLabel?: string, mediaFilesDay?: string, timestamp: string, instructionId?: string, instructionLabel?: string, idempotencyKey?: string }>} */
const publishContextByPostId = new Map();

const CONTEXT_FILE = join(process.cwd(), 'data', 'publish-contexts.json');

function loadPublishContextsFromDisk() {
  try {
    const raw = readFileSync(CONTEXT_FILE, 'utf8');
    const data = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (data.date !== today) return;
    let loaded = 0;
    for (const [postId, ctx] of Object.entries(data.contexts || {})) {
      publishContextByPostId.set(postId, ctx);
      loaded++;
    }
    if (loaded) log.info({ loaded }, '[Sheets] Publish contexts loaded from disk');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn({ err: err.message }, '[Sheets] Could not load publish contexts from disk');
    }
  }
}

function savePublishContextsToDisk() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const contexts = Object.fromEntries(publishContextByPostId.entries());
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    writeFileSync(CONTEXT_FILE, JSON.stringify({ date: today, contexts }), 'utf8');
  } catch (err) {
    log.warn({ err: err.message }, '[Sheets] Could not save publish contexts to disk');
  }
}

loadPublishContextsFromDisk();

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
  const instructionId =
    meta.idempotencyKey ||
    meta.instructionId ||
    [...postIds].sort().join('|') ||
    ts;
  const entry = {
    postIds: postIds.filter(Boolean),
    expectedAccountIds: expectedAccountIds.filter(Boolean),
    baseCaption,
    contentLabel,
    folderName: meta.folderName || '',
    targetLabel: meta.targetLabel || '',
    mediaFilesDay: meta.mediaFilesDay || '',
    timestamp: ts,
    instructionId,
    instructionLabel:
      meta.instructionLabel ||
      buildInstructionLabel(ts, null, meta.idempotencyKey),
    idempotencyKey: meta.idempotencyKey || '',
  };
  for (const id of entry.postIds) {
    publishContextByPostId.set(id, entry);
  }
  savePublishContextsToDisk();
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

function buildInstructionLabel(timestamp, seq, idempotencyKey) {
  const time = formatWibTimeShort(timestamp) || '??:??';
  const seqPart = seq != null ? `#${seq} ` : '';
  const keyPart = idempotencyKey ? ` (${shortKey(idempotencyKey)})` : '';
  return `${seqPart}${time} WIB${keyPart}`.trim();
}

function enrichAccountsWithInstruction(accounts) {
  return accounts.map((acc) => {
    const ctx = acc.postId ? getPublishContext(acc.postId) : null;
    const ts = ctx?.timestamp || acc.rowTimestamp || new Date().toISOString();
    const instructionId =
      ctx?.instructionId || acc.instructionId || acc.postId || String(ts);
    const instructionSort = new Date(ts).getTime() || 0;
    return {
      ...acc,
      instructionId,
      instructionLabel:
        ctx?.instructionLabel ||
        acc.instructionLabel ||
        buildInstructionLabel(ts, null, ctx?.idempotencyKey),
      instructionSort,
    };
  });
}

/**
 * Layout lebar: satu baris = satu akun (platform + username).
 * Tiap instruksi publish (beda waktu) = blok kolom Konten / Status / Link / Post ID.
 */
function buildWideSheetFromAccounts(event) {
  const annotated = (event.accounts || []).some((a) => a.attemptToday != null)
    ? event.accounts
    : annotateAccountsWithDayAttempts(event.accounts || []);
  const enriched = enrichAccountsWithInstruction(annotated);

  /** @type {Map<string, { id: string, label: string, sort: number }>} */
  const instructionMap = new Map();
  for (const acc of enriched) {
    if (!instructionMap.has(acc.instructionId)) {
      const ctx = acc.postId ? getPublishContext(acc.postId) : null;
      instructionMap.set(acc.instructionId, {
        id: acc.instructionId,
        label: acc.instructionLabel,
        sort: acc.instructionSort || 0,
        idempotencyKey: ctx?.idempotencyKey || '',
      });
    }
  }

  const instructions = [...instructionMap.values()]
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((inst, idx) => {
      const keyForLabel =
        inst.idempotencyKey ||
        (/^[a-f0-9]{64}$/i.test(inst.id) ? inst.id : '');
      return {
        ...inst,
        seq: idx + 1,
        headerPrefix: buildInstructionLabel(
          new Date(inst.sort || Date.now()).toISOString(),
          idx + 1,
          keyForLabel
        ),
      };
    });

  /** @type {Map<string, { network: string, username: string, attemptToday: number, isDuplicate: boolean, byInstruction: Map<string, object> }>} */
  const rowMap = new Map();

  for (const acc of enriched) {
    const colKey = mapNetworkToColumnKey(acc.network);
    const user = (acc.username || '').replace(/^@/, '');
    const rowKey = `${colKey}:${user.toLowerCase()}`;
    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, {
        network: colKey,
        username: user,
        attemptToday: acc.attemptToday ?? 1,
        isDuplicate: !!acc.isDuplicate,
        byInstruction: new Map(),
      });
    }
    const row = rowMap.get(rowKey);
    if ((acc.attemptToday ?? 1) > row.attemptToday) {
      row.attemptToday = acc.attemptToday;
      row.isDuplicate = !!acc.isDuplicate;
    }
    row.byInstruction.set(acc.instructionId, acc);
  }

  const sortedRows = [...rowMap.values()].sort((a, b) => {
    const order = PLATFORM_SORT_ORDER;
    const ia = order.indexOf(a.network);
    const ib = order.indexOf(b.network);
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.username.localeCompare(b.username, 'id');
  });

  const headerRow = buildWideHeaderRow(instructions);
  const dataRows = sortedRows.map((row) => {
    const platformLabel = PLATFORM_LABELS[row.network] || row.network || '';
    const attempt = row.attemptToday ?? 1;
    const duplikat = row.isDuplicate ? `⚠️ ${attempt}×` : '';
    const cells = [
      platformLabel,
      row.username ? `@${row.username}` : '',
      String(attempt),
      duplikat,
    ];

    for (const inst of instructions) {
      const acc = row.byInstruction.get(inst.id);
      if (!acc) {
        cells.push('', '', '', '');
        continue;
      }
      const accountName = row.username;
      const st = acc.status || 'pending';
      const liveUrl = buildLivePostUrl(
        acc.network,
        accountName,
        acc.platformPostId,
        acc.url,
        acc.pageId
      );
      cells.push(
        acc.contentLabel || '',
        sheetStatusLabel(st, acc, event.timestamp),
        sheetHttpLinkCell(liveUrl, st),
        acc.postId || splitPostIds(event.postId || '')[0] || ''
      );
    }
    return cells;
  });

  return { headerRow, dataRows, instructionCount: instructions.length };
}

/**
 * Baca akun instruksi sebelumnya langsung dari baris wide sheet — tanpa API Woopsocial.
 * Ini menggantikan collectTodayPublishLinks() di dalam mergeTodayAccountsForWideSheet
 * supaya data pagi tidak hilang ketika API tidak tersedia saat publish malam.
 * @param {string} tabName
 * @param {Set<string>} excludeIds  post-ID instruksi baru yg tidak perlu dibaca ulang
 */
async function readPriorAccountsFromWideSheet(tabName, excludeIds) {
  const { header, rows } = await readDailyTabHeaderAndRows(tabName);
  if (!isWideSheetHeader(header)) return [];

  const { instructions } = parseWideSheetHeader(header);
  if (!instructions.length) return [];

  const labelToNetwork = Object.fromEntries(
    Object.entries(PLATFORM_LABELS).map(([k, v]) => [v.toLowerCase(), k])
  );

  // Deduplikasi instruksi: pakai key dari prefix (mis. "#1 15:37 WIB (3463b355f9b1)")
  // Skip instruksi tanpa key — itu ghost column dari bug duplikasi.
  const seenKeys = new Set();
  const validInstructions = [];
  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];
    const keyMatch = inst.prefix.match(/\(([a-f0-9]{8,})\)/i);
    const key = keyMatch ? keyMatch[1].toLowerCase() : null;
    if (!key) continue; // ghost instruction, lewati
    if (seenKeys.has(key)) continue; // duplikat, lewati
    seenKeys.add(key);

    // Ambil waktu nyata dari prefix ("#1 15:37 WIB …") untuk rowTimestamp
    const timeMatch = inst.prefix.match(/(\d{1,2}):(\d{2})\s*WIB/i);
    let rowTimestamp = null;
    if (timeMatch) {
      const d = new Date();
      d.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
      rowTimestamp = d.toISOString();
    }

    validInstructions.push({ ...inst, instructionId: key, rowTimestamp });
  }

  const accounts = [];
  for (const row of rows) {
    if (String(row[0] || '').startsWith('REKAP')) continue;
    const platformLabel = String(row[0] || '').trim();
    const network = labelToNetwork[platformLabel.toLowerCase()] || '';
    const username = String(row[1] || '').trim().replace(/^@/, '');
    if (!network || !username) continue;

    for (const inst of validInstructions) {
      const rawPostId = String(row[inst.postIdIdx] || '').trim();
      if (!rawPostId) continue;

      const cellPostIds = splitPostIds(rawPostId);
      if (cellPostIds.some((id) => excludeIds.has(id))) continue;

      const statusCell = String(row[inst.statusIdx] || '').trim();
      const linkCell = String(row[inst.linkIdx] || '').trim();
      const postId = cellPostIds[0] || rawPostId;
      const status = statusCell.includes('✅')
        ? 'published'
        : statusCell.includes('❌')
          ? 'failed'
          : 'pending';
      const url = /^https?:\/\//i.test(linkCell) ? linkCell : '';

      accounts.push({
        network,
        username,
        postId,
        instructionId: inst.instructionId,
        instructionLabel: inst.prefix,
        rowTimestamp: inst.rowTimestamp,
        status,
        url,
      });
    }
  }
  return accounts;
}

async function mergeTodayAccountsForWideSheet(newAccounts, newPostIds, tabName) {
  const ids = new Set((newPostIds || []).filter(Boolean));
  const tab = tabName || getDailyTabName();
  try {
    const others = await readPriorAccountsFromWideSheet(tab, ids);
    log.info({ count: others.length, tab }, '[Sheets] prior accounts read from sheet for merge');
    return reconcileSheetAccounts([...others, ...(newAccounts || [])]);
  } catch (err) {
    log.warn({ err: err.message }, `[Sheets] merge today: ${err.message}`);
    return reconcileSheetAccounts(newAccounts || []);
  }
}

/**
 * @deprecated Format lama — satu baris per posting.
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
async function clearDailyTabDataRows(spreadsheetId, tabName, colCount) {
  const sheets = getSheetsClient();
  const colLetter = columnLetterFromIndex(colCount || getSheetColumnCount());
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
  return withSheetLock(spreadsheetId, async () => {
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
  });
}

/**
 * Hapus baris lama untuk Post ID ini, tulis satu baris per akun.
 * @param {{ timestamp: string, postId?: string, youtubeTitle?: string, statusSummary?: string, errorNotes?: string, accounts: Array<object> }} event
 */
export async function upsertPublishEventRow(event) {
  const spreadsheetId = await getSpreadsheetId();
  return withSheetLock(spreadsheetId, () =>
    upsertPublishEventRowLocked(event, spreadsheetId)
  );
}

/**
 * @param {object} event
 * @param {string} spreadsheetId
 */
async function upsertPublishEventRowLocked(event, spreadsheetId) {
  const tabName = getDailyTabName(event.timestamp);

  const postIds = [
    ...new Set(
      [
        ...splitPostIds(event.postId || ''),
        ...(event.accounts || []).map((a) => a.postId).filter(Boolean),
      ].filter(Boolean)
    ),
  ];

  const resolved = attachContentLabelsToAccounts(
    await resolveAccountsForSheetWrite(event.accounts || [], postIds),
    event
  );
  const merged = await mergeTodayAccountsForWideSheet(resolved, postIds, tabName);

  return writeWideDailyTab({
    ...event,
    accounts: merged,
    tabName,
    spreadsheetId,
  });
}

/**
 * Kosongkan tab harian lalu tulis ulang semua baris (format rapi, @ + Link berdampingan).
 * @param {{ timestamp: string, postId?: string, youtubeTitle?: string, accounts: Array<object> }} event
 */
export async function rewriteDailyTabFromAccounts(event) {
  const spreadsheetId = await getSpreadsheetId();
  return withSheetLock(spreadsheetId, async () => {
    const tabName = getDailyTabName(event.timestamp);
    const annotated = attachContentLabelsToAccounts(
      annotateAccountsWithDayAttempts(event.accounts || []),
      event
    );
    return writeWideDailyTab({
      ...event,
      accounts: annotated,
      tabName,
      spreadsheetId,
    });
  });
}

/**
 * Tulis tab harian format lebar (instruksi = blok kolom).
 * @param {{ timestamp: string, accounts: Array<object>, tabName: string, spreadsheetId: string, postId?: string }} event
 */
async function writeWideDailyTab(event) {
  const { spreadsheetId, tabName } = event;
  const { headerRow, dataRows, instructionCount } = buildWideSheetFromAccounts(
    event
  );

  await ensureDailySheetTabCore(spreadsheetId, tabName, headerRow);
  await clearDailyTabDataRows(spreadsheetId, tabName, headerRow.length);

  const annotated = event.accounts || [];
  const dupes = buildDuplicateAccountSummary(annotated);
  const colCount = headerRow.length;
  const rekapRows = buildDuplicateRekapSheetRows(dupes, colCount);
  const allRows = [...rekapRows, ...dataRows];

  if (!allRows.length) {
    return {
      tabName,
      spreadsheetUrl: getSpreadsheetUrl(spreadsheetId),
      recorded: 0,
      duplicateAccounts: dupes.length,
      instructionCount: 0,
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
    { tabName, rows: dataRows.length, instructions: instructionCount, dupes: dupes.length },
    `[Sheets] tab ${tabName}: ${dataRows.length} baris akun, ${instructionCount} instruksi` +
      (dupes.length ? `, ${dupes.length} akun duplikat` : ''),
  );

  return {
    tabName,
    spreadsheetUrl: getSpreadsheetUrl(spreadsheetId),
    recorded: dataRows.length,
    duplicateAccounts: dupes.length,
    rowCount: allRows.length,
    instructionCount,
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
  const tabName = getDailyTabName(ts);

  const result = await withSheetLock(spreadsheetId, async () => {
    await ensureDailySheetTabCore(spreadsheetId, tabName);

    if (replaceWholeTab) {
      await clearDailyTabDataRows(spreadsheetId, tabName);
    }

    return upsertPublishEventRowLocked(
      {
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
      },
      spreadsheetId
    );
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
  const spreadsheetId = await getSpreadsheetId();
  await cleanupSheetConflictTabs(spreadsheetId).catch((err) => {
    log.warn({ err: err.message }, `[Sheets] cleanup conflict: ${err.message}`);
  });

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
async function readDailyTabHeaderAndRows(tabName) {
  const tab = tabName || getDailyTabName();
  const spreadsheetId = await getSpreadsheetId();
  // Jangan panggil ensureDailySheetTab di sini — fungsi itu acquire withSheetLock,
  // yang menyebabkan deadlock saat readDailyTabHeaderAndRows dipanggil dari dalam
  // withSheetLock (misal: mergeTodayAccountsForWideSheet → collectTodayPublishLinks).
  // Tab sudah dijamin ada oleh ensureDailySheetTabCore sebelum write dilakukan.
  const sheets = getSheetsClient();
  try {
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteTab(tab)}!A1:ZZ1`,
    });
    const header = headerRes.data.values?.[0] || [];
    const lastCol = columnLetterFromIndex(Math.max(header.length, WIDE_ROW_HEADERS.length));
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteTab(tab)}!A2:${lastCol}2000`,
    });
    return { header, rows: res.data.values || [], tab, spreadsheetId };
  } catch (err) {
    // Tab belum ada (tab baru hari ini) → kembalikan kosong
    if (
      err?.code === 400 ||
      String(err?.message || '').includes('Unable to parse range')
    ) {
      return { header: [], rows: [], tab, spreadsheetId };
    }
    throw err;
  }
}

function collectPostIdsFromDailyRows(header, rows) {
  const ids = new Set();

  if (isWideSheetHeader(header)) {
    const { instructions } = parseWideSheetHeader(header);
    const postIdCols = instructions.map((i) => i.postIdIdx);
    for (const row of rows) {
      if (String(row[0] || '').startsWith('REKAP')) continue;
      for (const col of postIdCols) {
        const cell = String(row[col] || '').trim();
        for (const id of splitPostIds(cell)) {
          if (isValidOutstandPostId(id)) ids.add(id);
        }
      }
    }
    return [...ids];
  }

  for (const row of rows) {
    const cell = String(row[1] ?? row[0] ?? '').trim();
    if (!cell || cell.startsWith('REKAP')) continue;
    for (const id of splitPostIds(cell)) {
      if (isValidOutstandPostId(id)) ids.add(id);
    }
  }
  return [...ids];
}

export async function readPostIdsFromDailyTab(tabName) {
  const { header, rows } = await readDailyTabHeaderAndRows(tabName);
  return collectPostIdsFromDailyRows(header, rows);
}

/**
 * Post ID instruksi terakhir (kolom Post ID paling kanan yang terisi).
 * @param {string} [tabName]
 */
export async function readLatestPostIdsFromDailyTab(tabName) {
  const { header, rows } = await readDailyTabHeaderAndRows(tabName);

  if (isWideSheetHeader(header)) {
    const { instructions } = parseWideSheetHeader(header);
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0] || '').startsWith('REKAP')) continue;
      for (let j = instructions.length - 1; j >= 0; j--) {
        const cell = String(rows[i][instructions[j].postIdIdx] || '').trim();
        const ids = splitPostIds(cell).filter((id) => isValidOutstandPostId(id));
        if (ids.length) return ids;
      }
    }
    return [];
  }

  for (let i = rows.length - 1; i >= 0; i--) {
    const cell = String(rows[i][1] ?? rows[i][0] ?? '').trim();
    if (!cell || cell.startsWith('REKAP')) continue;
    const ids = splitPostIds(cell).filter((id) => isValidOutstandPostId(id));
    if (ids.length) return ids;
  }
  return [];
}

async function ensureDailySheetTabCore(spreadsheetId, tabName, headerRow) {
  await resolveConflictTabs(spreadsheetId, { tabName });

  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const exists = meta.data.sheets?.some((s) => s.properties?.title === tabName);
  const header = headerRow?.length ? headerRow : getWideBaseHeaderRow();

  if (!exists) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      });
      log.info({ tabName }, `[Sheets] Tab baru: ${tabName}`);
    } catch (err) {
      const retryMeta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title',
      });
      const nowExists = retryMeta.data.sheets?.some(
        (s) => s.properties?.title === tabName
      );
      if (!nowExists) throw err;
      await resolveConflictTabs(spreadsheetId, { tabName });
    }
  }

  const lastCol = columnLetterFromIndex(header.length);
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteTab(tabName)}!A1:ZZ1`,
  });
  const currentHeader = headerRes.data.values?.[0] || [];
  const needsUpdate =
    currentHeader.join('|') !== header.join('|') ||
    isLegacySheetHeader(currentHeader);

  if (needsUpdate) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteTab(tabName)}!A1:${lastCol}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] },
    });
    log.info({ tabName, cols: header.length }, `[Sheets] Header tab ${tabName} diperbarui`);
  }

  return tabName;
}

export async function ensureDailySheetTab(spreadsheetId, tabName, headerRow) {
  return withSheetLock(spreadsheetId, () =>
    ensureDailySheetTabCore(spreadsheetId, tabName, headerRow)
  );
}

export async function cleanupSheetConflictTabs(spreadsheetId) {
  return withSheetLock(spreadsheetId, () => resolveConflictTabs(spreadsheetId));
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
  idempotencyKey,
}) {
  const ids = (postIds || []).filter(Boolean);
  const ts = timestamp || new Date().toISOString();
  const meta = {
    folderName,
    targetLabel,
    mediaFiles,
    contentLabel,
    idempotencyKey,
  };

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
/**
 * Hapus tab harian (format YYYY-MM-DD) yang lebih lama dari retentionDays.
 * Tab non-tanggal (Sheet1, REKAP, dll) tidak tersentuh.
 * @param {{ retentionDays?: number, dryRun?: boolean }} [options]
 * @returns {Promise<{ deleted: string[], kept: string[], skipped: string[] }>}
 */
export async function deleteOldDailyTabs(options = {}) {
  const retentionDays = Math.max(1, options.retentionDays ?? env.sheetTabRetentionDays ?? 30);
  const dryRun = options.dryRun ?? false;

  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const allSheets = meta.data.sheets ?? [];
  const cutoffDate = getDailyTabName(
    new Date(Date.now() - retentionDays * 86_400_000).toISOString()
  );
  const DAILY_TAB_RE = /^\d{4}-\d{2}-\d{2}$/;

  const toDelete = [];
  const kept = [];
  const skipped = [];

  for (const sheet of allSheets) {
    const title = sheet.properties?.title ?? '';
    if (!DAILY_TAB_RE.test(title)) { skipped.push(title); continue; }
    if (title >= cutoffDate) { kept.push(title); continue; }
    toDelete.push({ title, sheetId: sheet.properties.sheetId });
  }

  // Pastikan minimal 1 tab tersisa di spreadsheet
  const totalAfter = allSheets.length - toDelete.length;
  if (totalAfter < 1 && toDelete.length) toDelete.shift();

  if (!dryRun && toDelete.length) {
    const CHUNK = 20;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const chunk = toDelete.slice(i, i + CHUNK);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: chunk.map(({ sheetId }) => ({ deleteSheet: { sheetId } })),
        },
      });
    }
  }

  return {
    deleted: toDelete.map((s) => s.title),
    kept,
    skipped,
  };
}

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
