import { PLATFORM_LABELS } from '../config/sheetLayout.js';

/** URL live umum semua platform (untuk deteksi sudah terbit). */
export const LIVE_POST_URL_RE =
  /instagram\.com|facebook\.com|fb\.watch|threads\.net|youtube\.com|youtu\.be|tiktok\.com|linkedin\.com|twitter\.com|x\.com|pinterest\.com|bsky\.app/i;

/**
 * Error API yang sering berarti post tetap terbit (semua platform, terutama Meta/IG).
 * @param {string} [error]
 */
export function isRateLimitMaybeLiveError(error) {
  return /too many actions|rate limit|429|throttl|spam|try again later/i.test(
    String(error || '')
  );
}

/**
 * @param {{ status?: string, platformPostId?: string, url?: string, error?: string }} account
 */
export function accountLooksLiveOnPlatform(account) {
  const st = (account.status || '').toLowerCase();
  if (st === 'published') return true;
  if (account.platformPostId) return true;
  if (LIVE_POST_URL_RE.test(String(account.url || ''))) return true;
  if (st === 'failed' && isRateLimitMaybeLiveError(account.error)) return true;
  return false;
}

/**
 * Outstand kadang tetap "failed" padahal link live sudah ada — Sheets ikut diperbaiki.
 * @param {object} account
 */
export function reconcileSheetAccountStatus(account) {
  const st = (account.status || '').toLowerCase();
  const hasLiveProof =
    account.platformPostId ||
    LIVE_POST_URL_RE.test(String(account.url || ''));

  if (st === 'published') return account;

  // Pending tanpa link = tetap pending (jangan disamakan dengan gagal)
  if (st === 'pending' && !hasLiveProof) return account;

  if (!accountLooksLiveOnPlatform(account) && !hasLiveProof) return account;

  return {
    ...account,
    status: 'published',
    error: undefined,
  };
}

/**
 * @param {Array<object>} accounts
 */
export function reconcileSheetAccounts(accounts) {
  return accounts.map(reconcileSheetAccountStatus);
}

/**
 * @param {{ network?: string, username?: string, accountId?: string, status?: string, error?: string, platformPostId?: string, url?: string }} account
 */
export function shouldExcludeAccountFromNewPublishToday(account) {
  const st = (account.status || '').toLowerCase();
  if (st === 'published' || st === 'pending') return true;
  if (accountLooksLiveOnPlatform(account)) return true;
  return false;
}

export function accountDayKey(account) {
  const net = (account.network || 'unknown').toLowerCase();
  const user = (account.username || account.accountId || '')
    .replace(/^@/, '')
    .toLowerCase();
  return `${net}:${user}`;
}

/**
 * Urutkan kronologis lalu set attemptToday + isDuplicate (semua platform).
 * @param {Array<object>} accounts
 */
export function annotateAccountsWithDayAttempts(accounts) {
  const sorted = [...accounts].sort((a, b) => {
    const ta = Date.parse(a.rowTimestamp || '') || 0;
    const tb = Date.parse(b.rowTimestamp || '') || 0;
    if (ta !== tb) return ta - tb;
    return (a.postId || '').localeCompare(b.postId || '');
  });

  /** @type {Map<string, number>} */
  const counts = new Map();

  return sorted.map((acc) => {
    const key = accountDayKey(acc);
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    return {
      ...acc,
      attemptToday: n,
      isDuplicate: n > 1,
    };
  });
}

/**
 * Ringkasan akun dengan >1 posting hari ini (untuk baris REKAP di Sheets).
 * @param {Array<{ network?: string, username?: string, attemptToday?: number, isDuplicate?: boolean }>} accounts
 */
export function buildDuplicateAccountSummary(accounts) {
  /** @type {Map<string, { network: string, username: string, count: number, contents: Set<string> }>} */
  const byKey = new Map();

  for (const a of accounts) {
    if (!a.isDuplicate && (a.attemptToday || 0) <= 1) continue;
    const key = accountDayKey(a);
    const net = (a.network || '').toLowerCase();
    const user = (a.username || '').replace(/^@/, '');
    const prev = byKey.get(key);
    const count = Math.max(prev?.count || 0, a.attemptToday || 1);
    const contents = prev?.contents || new Set();
    const label = String(a.contentLabel || a.postCaption || '').trim();
    if (label) contents.add(label);
    byKey.set(key, { network: net, username: user, count, contents });
  }

  return [...byKey.values()]
    .filter((x) => x.count >= 2)
    .map((x) => ({
      network: x.network,
      username: x.username,
      count: x.count,
      contentSummary: [...x.contents].slice(0, 3).join(' │ '),
    }))
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
}

/**
 * Hitung Ke-# / Duplikat untuk baris baru dengan riwayat hari ini.
 * @param {Array<object>} existingAccounts
 * @param {Array<object>} newAccounts
 */
export function annotateNewAccountsAgainstDayHistory(
  existingAccounts,
  newAccounts
) {
  const withoutDupes = existingAccounts.filter(
    (a) =>
      !newAccounts.some(
        (n) =>
          n.postId === a.postId &&
          n.accountId === a.accountId &&
          accountDayKey(n) === accountDayKey(a)
      )
  );
  const combined = [...withoutDupes, ...newAccounts];
  const annotated = annotateAccountsWithDayAttempts(combined);
  const stamp = new Set(
    newAccounts.map(
      (a) => `${accountDayKey(a)}|${a.postId}|${a.accountId || ''}`
    )
  );
  return annotated.filter((a) =>
    stamp.has(`${accountDayKey(a)}|${a.postId}|${a.accountId || ''}`)
  );
}

export function buildDuplicateRekapSheetRows(dupes, colCount) {
  if (!dupes.length) return [];

  const pad = (cells) => {
    const row = [...cells];
    while (row.length < colCount) row.push('');
    return row.slice(0, colCount);
  };

  const rows = [
    pad([
      'REKAP — Akun posting >1× hari ini',
      '',
      '',
      `${dupes.length} akun`,
      '',
      '⚠️ DOBEL',
      '',
      '',
      '',
    ]),
    pad(['Platform', 'Akun', 'Total', 'Duplikat', 'Konten (lihat baris data)', '', '', '', '']),
  ];

  for (const d of dupes.slice(0, 40)) {
    const label = PLATFORM_LABELS[d.network] || d.network;
    rows.push(
      pad([
        'REKAP',
        '',
        label,
        `@${d.username}`,
        String(d.count),
        `⚠️ ${d.count}×`,
        d.contentSummary || '—',
        '',
      ])
    );
  }

  rows.push(pad(['', '', '', '', '', '', '', '', '']));
  return rows;
}
