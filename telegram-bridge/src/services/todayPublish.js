import { env } from '../config/env.js';
import { nowIsoUtc } from '../utils/wibTime.js';
import { getPost, listPostIdsForDailyTab } from './outstand.js';
import {
  getDailyTabName,
  readPostIdsFromDailyTab,
  rewriteDailyTabFromAccounts,
} from './sheets.js';
import {
  reconcileSheetAccounts,
  shouldExcludeAccountFromNewPublishToday,
} from '../utils/accountDayUsage.js';
import { normalizeOutstandStatus } from '../utils/postStatus.js';
import {
  mergeSheetAccounts,
  summarizePublishResults,
  summarizeSheetAccounts,
} from './publishResult.js';

const FETCH_CHUNK = 5;

/** @type {{ at: number, ids: string[] } | null} */
let publishedTodayCache = null;
const PUBLISHED_CACHE_MS = 5 * 60_000;

/**
 * ID akun yang sudah dapat slot hari ini (live atau antrian pending).
 */
export async function getTouchedAccountIdsToday() {
  if (
    publishedTodayCache &&
    Date.now() - publishedTodayCache.at < PUBLISHED_CACHE_MS
  ) {
    return publishedTodayCache.ids;
  }

  const { accounts } = await collectTodayPublishLinks();
  const ids = [
    ...new Set(
      accounts.filter((a) => shouldExcludeAccountFromNewPublishToday(a))
        .map((a) => a.accountId)
        .filter(Boolean)
    ),
  ];

  publishedTodayCache = { at: Date.now(), ids };
  return ids;
}

export function clearPublishedTodayCache() {
  publishedTodayCache = null;
}

/** @deprecated Gunakan getTouchedAccountIdsToday */
export async function getPublishedAccountIdsToday() {
  return getTouchedAccountIdsToday();
}

/**
 * Hitung berapa kali tiap akun sudah dapat post hari ini (live/pending/gagal).
 */
export async function getTodayAccountUsageCounts() {
  const { accounts } = await collectTodayPublishLinks();
  /** @type {Record<string, { network: string, username: string, published: number, pending: number, failed: number, total: number }>} */
  const byId = {};

  for (const a of accounts) {
    const id = a.accountId;
    if (!id) continue;
    if (!byId[id]) {
      byId[id] = {
        network: (a.network || '').toLowerCase(),
        username: a.username || '',
        published: 0,
        pending: 0,
        failed: 0,
        total: 0,
      };
    }
    const st = normalizeOutstandStatus(a.status);
    if (st === 'published') byId[id].published += 1;
    else if (st === 'failed') byId[id].failed += 1;
    else byId[id].pending += 1;
    byId[id].total += 1;
  }

  return byId;
}

/**
 * @param {string[]} postIds
 */
async function fetchAccountsForPostIds(postIds) {
  /** @type {Array<object>} */
  const accounts = [];

  for (let i = 0; i < postIds.length; i += FETCH_CHUNK) {
    const chunk = postIds.slice(i, i + FETCH_CHUNK);
    const posts = await Promise.all(
      chunk.map((id) =>
        getPost(id).catch((err) => {
          console.warn(`[Today] getPost ${id}:`, err.message);
          return null;
        })
      )
    );
    for (const post of posts) {
      if (!post) continue;
      accounts.push(...summarizePublishResults([post]).sheetAccounts);
    }
  }

  return accounts;
}

/**
 * Kumpulkan semua Post ID + status akun untuk hari ini (Outstand API + Sheets).
 * @param {{ tabName?: string }} [options]
 */
export async function collectTodayPublishLinks(options = {}) {
  const tabName = options.tabName || getDailyTabName();

  const fromSheet = await readPostIdsFromDailyTab(tabName).catch((err) => {
    console.warn('[Today] read sheet:', err.message);
    return [];
  });

  let fromApi = [];
  try {
    fromApi = await listPostIdsForDailyTab(tabName);
  } catch (err) {
    console.warn('[Today] list Outstand posts:', err.message);
  }

  const postIds = [...new Set([...fromSheet, ...fromApi])];
  const rawAccounts = postIds.length ? await fetchAccountsForPostIds(postIds) : [];
  const accounts = reconcileSheetAccounts(rawAccounts);
  const meta = summarizeSheetAccounts(accounts);

  return { tabName, postIds, accounts, meta };
}

/**
 * Ambil status terbaru semua post hari ini dari Outstand → tulis ulang Sheets.
 * Dipakai otomatis (timer) dan manual (/synctoday, /refresh).
 */
export async function refreshTodaySheetFromOutstand() {
  return syncTodayToSheet();
}

/**
 * Tulis / perbarui satu baris rekap hari ini di Google Sheets.
 */
export async function syncTodayToSheet() {
  const data = await collectTodayPublishLinks();

  if (!data.postIds.length) {
    throw new Error(
      `Tidak ada post untuk tab ${data.tabName} (${env.timezone}). Cek Outstand dashboard.`
    );
  }

  const ts = nowIsoUtc();
  const result = await rewriteDailyTabFromAccounts({
    timestamp: ts,
    postId: data.postIds.join(', '),
    youtubeTitle: data.meta.youtubeTitle,
    accounts: data.accounts,
  });

  return { ...data, ...result };
}
