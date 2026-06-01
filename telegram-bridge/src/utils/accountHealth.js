import { classifyRetryError, RETRY_ACTION } from './retryPublish.js';
import { getNetworkShortLabel } from './randomAccountPick.js';
import { normalizeUsernameToken } from './namedAccountPick.js';

/** @typedef {'ok' | 'warn' | 'bad'} HealthLevel */

/**
 * @typedef {{ level: HealthLevel, code: string, label: string, action?: string }} AccountIssue
 */

const AKUN_CHECK_WORDS = /\b(check|cek|health|reconnect|sehat)\b/i;

/**
 * @param {string} text
 */
export function parseAkunCommandArgs(text) {
  const raw = String(text || '').trim();
  const deepCheck = AKUN_CHECK_WORDS.test(raw);
  const filterText = raw.replace(AKUN_CHECK_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return { filterText, deepCheck };
}

/**
 * @param {object} raw
 */
export function mapListAccountFields(raw) {
  const isActiveRaw = raw?.isActive;
  const isActive =
    isActiveRaw === undefined || isActiveRaw === null
      ? true
      : isActiveRaw === 1 ||
        isActiveRaw === true ||
        String(isActiveRaw).toLowerCase() === 'true';

  return {
    isActive,
    accountType: raw?.accountType ? String(raw.accountType) : undefined,
    profilePictureUrl: raw?.profile_picture_url || raw?.profilePictureUrl,
  };
}

/**
 * @param {{ isActive?: boolean }} account
 */
export function summarizeListConnection(account) {
  if (account.isActive === false) {
    return {
      level: 'bad',
      code: 'inactive',
      label: 'Nonaktif di Outstand',
      action: 'Reconnect akun di dashboard Outstand.',
    };
  }
  return null;
}

/**
 * @param {{ healthy?: boolean, error?: string, errorCode?: string }} data
 */
export function summarizeHealthApi(data) {
  if (!data || data.healthy === true) return null;

  const err = [data.error, data.errorCode].filter(Boolean).join(' ');
  const raw = err.toLowerCase();

  if (/unauthorized|expired|invalid.*token|reauth|disconnect/i.test(raw)) {
    return {
      level: 'bad',
      code: 'token',
      label: 'Token perlu reconnect',
      action: 'Disconnect + connect ulang di Outstand.',
    };
  }

  if (/permission|scope|not allowed|business/i.test(raw)) {
    return {
      level: 'bad',
      code: 'permission',
      label: 'Permission kurang',
      action: 'Reconnect & centang semua izin (IG Business, FB Page).',
    };
  }

  return {
    level: 'warn',
    code: 'unhealthy',
    label: err ? err.slice(0, 80) : 'Health check gagal',
    action: 'Cek di Outstand → reconnect jika perlu.',
  };
}

/**
 * @param {string} [error]
 */
export function summarizePublishFailure(error) {
  const raw = String(error || '').trim();
  if (!raw) return null;

  if (
    /unable to fetch (?:video|image|media) file from url/i.test(raw) ||
    /failed to upload facebook video/i.test(raw)
  ) {
    return {
      level: 'warn',
      code: 'fb_media',
      label: 'Facebook gagal terima media (Outstand→FB)',
      action:
        'Bukan reconnect per akun — masalah Outstand/Meta BYOK. Hubungi support Outstand.',
    };
  }

  if (/failed to upload facebook photo/i.test(raw)) {
    if (/unable to fetch/i.test(raw)) {
      return {
        level: 'warn',
        code: 'fb_media',
        label: 'Facebook gagal terima media (Outstand→FB)',
        action:
          'Bukan reconnect per akun — masalah Outstand/Meta BYOK. Hubungi support Outstand.',
      };
    }
    return {
      level: 'warn',
      code: 'fb_photo',
      label: 'Upload foto Facebook gagal (400)',
      action:
        'Sering masalah media/URL yang sama. Coba 1 akun manual di Outstand; laporkan ke support.',
    };
  }

  const c = classifyRetryError(raw);
  if (c.action === RETRY_ACTION.FIX_ACCOUNT) {
    return {
      level: 'bad',
      code: 'publish_auth',
      label: c.hint.slice(0, 90),
      action: 'Reconnect di Outstand.',
    };
  }

  if (c.action === RETRY_ACTION.QUOTA_TOMORROW) {
    return {
      level: 'warn',
      code: 'quota',
      label: c.hint.slice(0, 90),
      action: 'Coba besok atau batch lebih kecil.',
    };
  }

  if (c.action === RETRY_ACTION.RATE_LIMIT_MAYBE_LIVE) {
    return {
      level: 'warn',
      code: 'rate_limit',
      label: 'Rate limit — mungkin sudah live',
      action: 'Cek profil dulu sebelum retry.',
    };
  }

  return {
    level: 'warn',
    code: 'publish_failed',
    label: raw.replace(/\s+/g, ' ').slice(0, 70),
    action: 'Lihat detail di /status + Post ID.',
  };
}

/**
 * @param {AccountIssue[]} issues
 */
export function pickWorstIssue(issues) {
  const list = (issues || []).filter(Boolean);
  if (!list.length) return null;
  const rank = { bad: 3, warn: 2, ok: 1 };
  return list.sort((a, b) => (rank[b.level] || 0) - (rank[a.level] || 0))[0];
}

/**
 * @param {AccountIssue | null | undefined} issue
 */
export function issueBadge(issue) {
  if (!issue || issue.level === 'ok') return '';
  if (issue.level === 'bad') return ' 🔴';
  return ' 🟡';
}

/**
 * @param {Array<{ id: string, network?: string, username?: string, isActive?: boolean }>} accounts
 * @param {{ healthById?: Map<string, object>, failuresById?: Map<string, { error?: string, failedCount?: number }> }} ctx
 */
export function buildAccountIssueMap(accounts, ctx = {}) {
  /** @type {Map<string, { worst: AccountIssue | null, issues: AccountIssue[] }>} */
  const map = new Map();

  for (const a of accounts || []) {
    const issues = [];
    const listIssue = summarizeListConnection(a);
    if (listIssue) issues.push(listIssue);

    const healthRaw = ctx.healthById?.get(a.id);
    const healthIssue = summarizeHealthApi(healthRaw);
    if (healthIssue) issues.push(healthIssue);

    const fail = ctx.failuresById?.get(a.id);
    if (fail?.error) {
      const pub = summarizePublishFailure(fail.error);
      if (pub) issues.push(pub);
    }

    map.set(a.id, { worst: pickWorstIssue(issues), issues });
  }

  return map;
}

/**
 * @param {Array<{ account: { network?: string, username?: string }, issue: AccountIssue }>} rows
 */
export function groupAttentionRows(rows) {
  /** @type {Map<string, { issue: AccountIssue, accounts: typeof rows[0]['account'][] }>} */
  const byCode = new Map();

  for (const row of rows) {
    const key = `${row.issue.level}:${row.issue.code}`;
    if (!byCode.has(key)) {
      byCode.set(key, { issue: row.issue, accounts: [] });
    }
    byCode.get(key).accounts.push(row.account);
  }

  const rank = { bad: 3, warn: 2 };
  return [...byCode.values()].sort(
    (a, b) => (rank[b.issue.level] || 0) - (rank[a.issue.level] || 0)
  );
}

/**
 * @param {typeof accounts[0][]} sample
 * @param {number} total
 */
function formatUsernameSample(sample, total) {
  const names = sample
    .slice(0, 4)
    .map((a) => `@${normalizeUsernameToken(a.username || a.id)}`);
  const rest = total - names.length;
  if (rest > 0) return `${names.join(', ')} … +${rest} lagi`;
  return names.join(', ');
}

/**
 * @param {Array<{ id: string, network?: string, username?: string }>} accounts
 * @param {Map<string, { worst: AccountIssue | null, issues: AccountIssue[] }>} issueMap
 * @param {{ maxDetailRows?: number }} [opts]
 */
export function formatHealthAttentionBlock(accounts, issueMap, opts = {}) {
  const maxDetailRows = opts.maxDetailRows ?? 8;

  /** @type {Array<{ account: typeof accounts[0], issue: AccountIssue }>} */
  const rows = [];
  for (const a of accounts) {
    const entry = issueMap.get(a.id);
    if (entry?.worst && entry.worst.level !== 'ok') {
      rows.push({ account: a, issue: entry.worst });
    }
  }

  if (!rows.length) {
    return '🟢 *Semua akun terlihat OK* (daftar + health check).\n';
  }

  const reconnect = rows.filter((r) => r.issue.level === 'bad');
  const publishWarn = rows.filter((r) => r.issue.level === 'warn');
  const groups = groupAttentionRows(rows);

  const lines = [
    `⚠️ *Catatan (${rows.length} akun)*`,
    '',
  ];

  if (publishWarn.length && !reconnect.length) {
    lines.push(
      '_🟡 = gagal publish hari ini di Sheets/Outstand — bukan berarti token expired._',
      '_Kalau `/akun fb check` tanpa 🔴, reconnect tidak perlu._',
      '',
    );
  }

  if (groups.length > 1 || rows.length >= 6) {
    lines.push('*Ringkasan masalah:*', '');
    for (const { issue, accounts: groupAccounts } of groups) {
      const icon = issue.level === 'bad' ? '🔴' : '🟡';
      lines.push(
        `${icon} *${issue.label}* — ${groupAccounts.length} akun`,
        `   ${formatUsernameSample(groupAccounts, groupAccounts.length)}`
      );
      if (issue.action) lines.push(`   _${issue.action}_`);
      lines.push('');
    }
  }

  const detailRows = rows.slice(0, maxDetailRows);
  if (rows.length <= maxDetailRows && groups.length <= 1) {
    for (const { account, issue } of detailRows) {
      const net = getNetworkShortLabel(account.network);
      const user = normalizeUsernameToken(account.username || account.id);
      lines.push(
        `• *${net}* @${user}${issue.level === 'bad' ? ' 🔴' : ' 🟡'} — ${issue.label}`
      );
      if (issue.action) lines.push(`  _${issue.action}_`);
    }
  } else if (rows.length > maxDetailRows) {
    lines.push(
      `_Detail per akun: lihat tanda 🟡/🔴 di daftar bawah (${rows.length} akun)._`,
      '',
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * @param {Array<{ accountId?: string, network?: string, username?: string, status?: string, error?: string }>} todayAccounts
 */
export function buildTodayFailureMap(todayAccounts) {
  /** @type {Map<string, { error: string, failedCount: number }>} */
  const map = new Map();

  for (const row of todayAccounts || []) {
    if ((row.status || '').toLowerCase() !== 'failed') continue;
    const id = row.accountId;
    if (!id) continue;
    const prev = map.get(id);
    const err = String(row.error || '').trim();
    map.set(id, {
      error: err || prev?.error || '',
      failedCount: (prev?.failedCount || 0) + 1,
    });
  }

  return map;
}

/**
 * Ringkasan khusus /cekakun (fokus masalah, bukan full list).
 * @param {Array<{ id: string, network?: string, username?: string, isActive?: boolean }>} accounts
 * @param {{ healthById?: Map<string, object>, failuresById?: Map<string, { error?: string, failedCount?: number }>, tabName?: string }} ctx
 */
export function formatCekAkunReport(accounts, ctx = {}) {
  const issueMap = buildAccountIssueMap(accounts, {
    healthById: ctx.healthById,
    failuresById: ctx.failuresById,
  });

  const failedToday = [...(ctx.failuresById?.entries() || [])].length;
  const lines = [
    '🔍 *Cek kesehatan akun*',
    ctx.tabName ? `_Tab Sheets: ${ctx.tabName}_` : '',
    `_Diperiksa: ${accounts.length} akun_`,
    failedToday
      ? `_Gagal publish hari ini: ${failedToday} akun unik_`
      : '_Belum ada gagal hari ini di Sheets/Outstand_',
    '',
  ].filter(Boolean);

  lines.push(formatHealthAttentionBlock(accounts, issueMap));

  lines.push(
    '*Legenda:*',
    '🔴 — reconnect / token / nonaktif di Outstand',
    '🟡 — gagal publish hari ini atau masalah media (mis. FB URL)',
    '',
    'Perintah:',
    '• `/akun` — daftar lengkap + tanda',
    '• `/akun fb check` — daftar FB + health token',
    '• `/cekakun ig` — cek health platform tertentu',
  );

  return lines.join('\n');
}
