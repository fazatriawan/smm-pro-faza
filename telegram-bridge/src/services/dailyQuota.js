import { env } from '../config/env.js';
import { PLATFORM_LABELS } from '../config/sheetLayout.js';
import { listSocialAccounts } from './outstand.js';
import { collectTodayPublishLinks, getTodayAccountUsageCounts } from './todayPublish.js';
import { getDailyTabName } from './sheets.js';

const DISPLAY_ORDER = [
  'youtube',
  'instagram',
  'facebook',
  'threads',
  'x',
  'tiktok',
  'linkedin',
  'pinterest',
  'bluesky',
];

/** @type {{ at: number, data: object } | null} */
let quotaCache = null;
const QUOTA_CACHE_MS = 3 * 60_000;

function normalizeNetwork(network) {
  const n = (network || '').toLowerCase().trim();
  return n === 'twitter' ? 'x' : n;
}

function parseQuotaBatchByNetwork() {
  const raw = process.env.QUOTA_BATCH_BY_NETWORK;
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

function batchSizeForNetwork(network) {
  const custom = parseQuotaBatchByNetwork();
  const key = normalizeNetwork(network);
  if (custom[key] != null) {
    const n = Number(custom[key]);
    if (n > 0) return n;
  }
  if (key === 'youtube') return env.quotaYoutubeBatchSize;
  return env.quotaDefaultBatchSize;
}

/**
 * @param {Array<{ network?: string }>} accounts
 */
function countConnectedByNetwork(accounts) {
  /** @type {Record<string, number>} */
  const map = {};
  for (const a of accounts) {
    const net = normalizeNetwork(a.network);
    if (!net) continue;
    map[net] = (map[net] || 0) + 1;
  }
  return map;
}

/**
 * @param {Array<{ network?: string, accountId?: string, status?: string }>} accounts
 */
function tallyTodayByNetwork(accounts) {
  /** @type {Record<string, { published: Set<string>, failed: Set<string>, pending: Set<string> }>} */
  const byNet = {};
  for (const a of accounts) {
    const net = normalizeNetwork(a.network);
    const id = a.accountId;
    if (!net || !id) continue;
    if (!byNet[net]) {
      byNet[net] = {
        published: new Set(),
        failed: new Set(),
        pending: new Set(),
      };
    }
    const st = (a.status || '').toLowerCase();
    if (st === 'published') byNet[net].published.add(id);
    else if (st === 'failed') byNet[net].failed.add(id);
    else byNet[net].pending.add(id);
  }
  return byNet;
}

function sessionsRemaining(remaining, batchSize) {
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / Math.max(1, batchSize));
}

export function clearQuotaCache() {
  quotaCache = null;
}

/**
 * @param {Array<{ network?: string, id: string }>} connectedList
 * @param {Record<string, { network: string, username: string, total: number }>} usageCounts
 */
function summarizeCoverageByNetwork(connectedList, usageCounts) {
  /** @type {Record<string, { connected: number, zero: number, one: number, multi: number, multiUsers: string[] }>} */
  const out = {};

  for (const a of connectedList) {
    const net = (a.network || '').toLowerCase();
    if (!out[net]) {
      out[net] = { connected: 0, zero: 0, one: 0, multi: 0, multiUsers: [] };
    }
    out[net].connected += 1;
  }

  for (const net of Object.keys(out)) {
    let one = 0;
    let multi = 0;
    const multiUsers = [];
    for (const [id, u] of Object.entries(usageCounts)) {
      if (u.network !== net) continue;
      if (u.total >= 2) {
        multi += 1;
        multiUsers.push(`@${(u.username || id).replace(/^@/, '')} (${u.total}×)`);
      } else if (u.total === 1) {
        one += 1;
      }
    }
    const usedIdsOnNet = Object.entries(usageCounts)
      .filter(([, u]) => u.network === net)
      .length;
    out[net].one = one;
    out[net].multi = multi;
    out[net].multiUsers = multiUsers.slice(0, 8);
    out[net].zero = Math.max(0, out[net].connected - usedIdsOnNet);
  }

  return out;
}

/**
 * @param {{ chatId?: number, session?: { usedAccountsTab?: string, usedAccountIdsToday?: string[] }, forceRefresh?: boolean }} [options]
 */
export async function buildDailyQuotaStatus(options = {}) {
  const { chatId, session, forceRefresh = false } = options;
  const tabName = getDailyTabName();

  if (
    !forceRefresh &&
    quotaCache &&
    Date.now() - quotaCache.at < QUOTA_CACHE_MS
  ) {
    return applySessionOverlay(quotaCache.data, tabName, session);
  }

  const [connectedList, today, usageCounts] = await Promise.all([
    listSocialAccounts(),
    collectTodayPublishLinks({ tabName }).catch(() => ({
      tabName,
      postIds: [],
      accounts: [],
      meta: { published: 0, failed: 0, pending: 0 },
    })),
    getTodayAccountUsageCounts().catch(() => ({})),
  ]);

  const connectedByNet = countConnectedByNetwork(connectedList);
  const todayByNet = tallyTodayByNetwork(today.accounts);

  const networks = [
    ...new Set([...DISPLAY_ORDER, ...Object.keys(connectedByNet)]),
  ].filter((n) => connectedByNet[n] || todayByNet[n]);

  const platforms = networks.map((net) => {
    const connected = connectedByNet[net] || 0;
    const tallies = todayByNet[net];
    const published = tallies?.published.size || 0;
    const failed = tallies?.failed.size || 0;
    const pending = tallies?.pending.size || 0;
    const batchSize = batchSizeForNetwork(net);
    const label = PLATFORM_LABELS[net] || net;

    if (net === 'youtube') {
      const maxUploads = env.youtubeProjectUploadsPerDay;
      const usedUploads = published;
      const remainingUploads = Math.max(0, maxUploads - usedUploads);
      const remainingAccounts = Math.max(0, connected - published);
      return {
        network: net,
        label,
        kind: 'project_pool',
        connected,
        published,
        failed,
        pending,
        maxUploads,
        usedUploads,
        remainingUploads,
        remainingAccounts,
        batchSize,
        sessionsRemaining: sessionsRemaining(remainingUploads, batchSize),
        accountSessionsRemaining: sessionsRemaining(
          remainingAccounts,
          batchSize
        ),
      };
    }

    const remainingAccounts = Math.max(0, connected - published);
    return {
      network: net,
      label,
      kind: 'per_account',
      connected,
      published,
      failed,
      pending,
      maxUploads: connected,
      usedUploads: published,
      remainingUploads: remainingAccounts,
      remainingAccounts,
      batchSize,
      sessionsRemaining: sessionsRemaining(remainingAccounts, batchSize),
    };
  });

  const coverageByNetwork = summarizeCoverageByNetwork(
    connectedList,
    usageCounts
  );

  const base = {
    tabName,
    timezone: env.timezone,
    postBatchCount: today.postIds?.length || 0,
    totalPublishedToday: today.meta?.published ?? 0,
    connectedTotal: connectedList.length,
    platforms,
    coverageByNetwork,
    outstandAccountLimit: env.outstandAccountLimit,
    outstandConnectedHint: connectedList.length,
  };

  quotaCache = { at: Date.now(), data: base };
  return applySessionOverlay(base, tabName, session);
}

/**
 * @param {object} status
 * @param {string} tabName
 * @param {object} [session]
 */
function applySessionOverlay(status, tabName, session) {
  const botUsedToday =
    session?.usedAccountsTab === tabName && session?.usedAccountIdsToday?.length
      ? session.usedAccountIdsToday.length
      : 0;
  return { ...status, botSessionUsedAccounts: botUsedToday };
}

/**
 * @param {Awaited<ReturnType<typeof buildDailyQuotaStatus>>} status
 * @param {{ compact?: boolean }} [options]
 */
export function formatDailyQuotaReport(status, options = {}) {
  const { compact = false } = options;
  const lines = [
    `📊 *Kuota harian* — ${status.tabName} (${status.timezone})`,
  ];

  if (!compact) {
    lines.push(
      `Batch Outstand hari ini: ${status.postBatchCount} · Live total: ${status.totalPublishedToday}`,
      `Akun terhubung: ${status.connectedTotal}${
        status.outstandAccountLimit
          ? ` / ${status.outstandAccountLimit}`
          : ''
      }`,
      ''
    );
  }

  for (const p of status.platforms) {
    if (p.kind === 'project_pool') {
      const recommendSessions = Math.min(
        p.sessionsRemaining,
        p.accountSessionsRemaining
      );
      lines.push(
        `*${p.label}*`,
        `├ Kuota API project (semua akun YT): *${p.usedUploads}* / ${p.maxUploads} upload`,
        `│  └ Masih bisa ±*${p.sessionsRemaining}* batch @ ${p.batchSize} sebelum kuota API habis (bukan batas tetap 12/hari)`,
        `├ Akun Anda: live *${p.published}* / ${p.connected} · belum live ≈ *${p.remainingAccounts}*`,
        `│  └ Perkiraan batch untuk habiskan akun: ≈ *${p.accountSessionsRemaining}*× \`/random yt ${p.batchSize}\``,
        `└ *Rekomendasi hari ini:* ≈ *${recommendSessions}* batch YT (yang lebih kecil: kuota API vs sisa akun)`
      );
    } else {
      lines.push(
        `*${p.label}* (target ~1 post/akun)`,
        `├ Live: *${p.published}* / ${p.connected} akun`,
        `├ Sisa akun: *${p.remainingAccounts}* · ≈ *${p.sessionsRemaining}* sesi (@ ${p.batchSize}/sesi)`
      );
      if (p.failed > 0 || p.pending > 0) {
        lines.push(`└ Gagal ${p.failed} · pending ${p.pending}`);
      }
    }
    lines.push('');
  }

  if (status.botSessionUsedAccounts > 0) {
    lines.push(
      `🤖 Sesi bot: *${status.botSessionUsedAccounts}* akun sudah dipilih hari ini (random/publish).`
    );
  }

  const igCov = status.coverageByNetwork?.instagram;
  if (igCov?.connected) {
    lines.push(
      '',
      `*Distribusi Instagram hari ini:*`,
      `├ Belum dapat post: *${igCov.zero}* akun`,
      `├ Sudah 1×: *${igCov.one}* akun`,
      `└ Sudah 2×+: *${igCov.multi}* akun` +
        (igCov.multiUsers.length
          ? `\n   _${igCov.multiUsers.join(', ')}_`
          : '')
    );
  }

  lines.push(
    '',
    '_1 akun = 1 post/hari (target order). Batas IG asli ~6/hari — dobel di bot biasanya dari random reuse batch lama._',
    'Perbarui: /kuota'
  );

  return lines.join('\n').trim();
}

/**
 * Satu baris ringkas setelah publish.
 * @param {Awaited<ReturnType<typeof buildDailyQuotaStatus>>} status
 */
export function formatDailyQuotaCompact(status) {
  const parts = status.platforms
    .filter((p) => p.connected > 0)
    .slice(0, 4)
    .map((p) => {
      if (p.kind === 'project_pool') {
        const batches = Math.min(
          p.sessionsRemaining,
          p.accountSessionsRemaining
        );
        return `${p.label} API ${p.usedUploads}/${p.maxUploads} · ≈${batches} batch lagi (${p.remainingAccounts} akun)`;
      }
      return `${p.label} ${p.published}/${p.connected} (≈${p.sessionsRemaining} sesi)`;
    });
  return `📊 Sisa hari ini: ${parts.join(' · ')}\nDetail: /kuota`;
}
