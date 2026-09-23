import { env } from '../config/env.js';
import { nowIsoUtc } from '../utils/wibTime.js';
import { createLogger } from '../utils/logger.js';
import { getPost, getPostResultsBatch, listPostIdsForDailyTab, getActivePublisher } from './publisher.js';

const log = createLogger('today-publish');
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
const FETCH_TIMEOUT_MS = 25_000;

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

  // PostForme: pakai batch query ke /v1/social-post-results — 1 request untuk semua postId
  // menghindari rate limit dari N request parallel
  if (getActivePublisher() === 'postforme') {
    try {
      const batchResults = await getPostResultsBatch(postIds);
      for (const [postId, socialAccounts] of batchResults) {
        if (!socialAccounts.length) continue;
        const syntheticPost = { id: postId, status: 'published', socialAccounts, caption: '', scheduledAt: null };
        const sheetAccs = summarizePublishResults([syntheticPost]).sheetAccounts;
        // Pastikan postId tersimpan di setiap akun untuk keperluan sheet
        for (const a of sheetAccs) { if (!a.postId) a.postId = postId; }
        accounts.push(...sheetAccs);
      }
    } catch (err) {
      log.warn({ err: err.message }, `[Today] getPostResultsBatch gagal: ${err.message}`);
    }
    // Akun yang tidak ada di batch (postId lama tanpa results) — coba getPost satu per satu
    const coveredPostIds = new Set(accounts.map((a) => a.postId).filter(Boolean));
    const missing = postIds.filter((id) => !coveredPostIds.has(id));
    for (const id of missing) {
      const post = await getPost(id).catch((err) => {
        log.warn({ postId: id, err: err.message }, `[Today] getPost ${id}: ${err.message}`);
        return null;
      });
      if (post) accounts.push(...summarizePublishResults([post]).sheetAccounts);
    }
    return accounts;
  }

  // Woopsocial: pakai parallel chunk seperti sebelumnya
  for (let i = 0; i < postIds.length; i += FETCH_CHUNK) {
    const chunk = postIds.slice(i, i + FETCH_CHUNK);
    const posts = await Promise.all(
      chunk.map((id) =>
        Promise.race([
          getPost(id),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)
          ),
        ]).catch((err) => {
          log.warn({ postId: id, err: err.message }, `[Today] getPost ${id}: ${err.message}`);
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
 * Kumpulkan semua Post ID + status akun untuk hari ini (publisher API + Sheets + arsip).
 * @param {{ tabName?: string, sheetsOnly?: boolean, extraPostIds?: string[] }} [options]
 */
export async function collectTodayPublishLinks(options = {}) {
  const tabName = options.tabName || getDailyTabName();

  // PostForme: skip sheet — API is source of truth for today's posts.
  // Old post IDs from previous days can pollute the Sheet tab when accumulated
  // across runs; skipping the sheet read breaks that loop and lets rewrite clear them.
  const fromSheet = getActivePublisher() === 'postforme'
    ? []
    : await Promise.race([
        readPostIdsFromDailyTab(tabName),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)
        ),
      ]).catch((err) => {
        log.warn({ err: err.message }, `[Today] read sheet: ${err.message}`);
        return [];
      });

  let fromApi = [];
  if (!options.sheetsOnly) {
    try {
      fromApi = await Promise.race([
        listPostIdsForDailyTab(tabName),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      log.warn({ err: err.message }, `[Today] list publisher posts: ${err.message}`);
    }
  }

  const extra = (options.extraPostIds || []).filter(Boolean);
  if (extra.length) {
    log.info({ count: extra.length }, '[Today] extra post IDs dari arsip');
  }

  const postIds = [...new Set([...fromSheet, ...fromApi, ...extra])];
  log.info({ tabName, fromSheet: fromSheet.length, fromApi: fromApi.length, extra: extra.length, postIds }, '[Today] postIds final');
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
      `Tidak ada post untuk tab ${data.tabName} (${env.timezone}). Cek dashboard publisher.`
    );
  }

  if (!data.accounts.length) {
    throw new Error(
      `Publisher API tidak tersedia — status akun tidak bisa diambil. Sheets tidak diubah.`
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
