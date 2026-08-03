import { NETWORK_ALIASES } from './randomAccountPick.js';
import {
  accountLooksLiveOnPlatform,
  isRateLimitMaybeLiveError,
} from './accountDayUsage.js';

export { accountLooksLiveOnPlatform, isRateLimitMaybeLiveError };
/** @deprecated */
export const isIgRateLimitMaybeLiveError = isRateLimitMaybeLiveError;

export const RETRY_ACTION = {
  RETRY_NOW: 'retry_now',
  WAIT: 'wait',
  /** Rate limit — post sering sudah live meski Outstand "failed" (semua platform). */
  RATE_LIMIT_MAYBE_LIVE: 'rate_limit_maybe_live',
  /** @deprecated */
  IG_MAYBE_LIVE: 'rate_limit_maybe_live',
  FIX_ACCOUNT: 'fix_account',
  QUOTA_TOMORROW: 'quota_tomorrow',
};

function resolveAlias(token) {
  const key = String(token || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return NETWORK_ALIASES[key] || null;
}

/**
 * @param {string} [error]
 */
export function classifyRetryError(error) {
  const raw = String(error || '').toLowerCase();
  if (!raw) {
    return {
      action: RETRY_ACTION.RETRY_NOW,
      hint: 'Bisa dicoba publish ulang.',
    };
  }

  if (
    /quota|resource_exhausted|upload limit/i.test(raw) &&
    /youtube|video upload/i.test(raw)
  ) {
    return {
      action: RETRY_ACTION.QUOTA_TOMORROW,
      hint: 'Kuota YouTube project habis — coba besok (setelah reset) atau batch YT lebih kecil.',
    };
  }

  if (/too many actions|reached_active_user_cap/i.test(raw)) {
    return {
      action: RETRY_ACTION.RATE_LIMIT_MAYBE_LIVE,
      hint:
        'TikTok mengembalikan error tapi post *sering sudah terbit* di profil. Cek manual dulu; jangan retry jika sudah live.',
    };
  }

  if (/rate limit|429|throttl|spam|try again later/i.test(raw)) {
    return {
      action: RETRY_ACTION.WAIT,
      hint:
        'Rate limit — tunggu 30–60 menit, cek profil/platform, retry hanya jika belum live.',
    };
  }

  if (
    /access token|validating access|session|not allowed|not a confirm|oauth|disconnect|invalid.*token|expired|login/i.test(
      raw
    )
  ) {
    return {
      action: RETRY_ACTION.FIX_ACCOUNT,
      hint: 'Reconnect akun di Outstand + verifikasi email/HP di Instagram.',
    };
  }

  // Threads / IG: "User access is restricted", "Account is restricted", dll.
  // Tetap masuk FIX_ACCOUNT supaya pengganti bisa ditawarkan.
  if (/user access|access is restricted|account.*restrict|restricted/i.test(raw)) {
    return {
      action: RETRY_ACTION.FIX_ACCOUNT,
      hint: 'Akun ke-restrict di platform — perlu verifikasi/banding di app, atau pakai akun lain.',
    };
  }

  if (/permission|business|page not|not linked/i.test(raw)) {
    return {
      action: RETRY_ACTION.FIX_ACCOUNT,
      hint: 'Pastikan akun IG Business + Page Facebook terhubung di Outstand.',
    };
  }

  return {
    action: RETRY_ACTION.RETRY_NOW,
    hint: 'Bisa dicoba publish ulang dengan media yang sama.',
  };
}

/**
 * @param {string} text
 */
export function parseRetryCommand(text) {
  let raw = String(text || '')
    .replace(/^\/retry(@\w+)?\s*/i, '')
    .trim();

  const send = /\b(kirim|send)\b/i.test(raw);
  raw = raw.replace(/\b(kirim|send)\b/gi, '').trim();

  /** @type {string | null} */
  let network = null;
  /** @type {string[]} */
  const postIds = [];

  /** @type {string[]} */
  const usernames = [];

  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    if (part.startsWith('@')) {
      usernames.push(part.slice(1));
      continue;
    }
    const alias = resolveAlias(part);
    if (alias) {
      network = alias;
      continue;
    }
    if (looksLikeOutstandPostId(part)) {
      postIds.push(part);
      continue;
    }
    if (/^[a-z0-9._]{4,}$/i.test(part)) {
      usernames.push(part);
    }
  }

  return { send, network, postIds, usernames };
}

/** Post ID Outstand biasanya pendek (mis. 1dHcG, ew0Tr). Konsisten dengan isValidOutstandPostId. */
function looksLikeOutstandPostId(part) {
  return (
    part.length >= 3 &&
    part.length <= 16 &&
    /^[a-zA-Z0-9]+$/.test(part)
  );
}

/**
 * @param {Array<{ network?: string, username?: string, accountId?: string, status?: string, error?: string, platformPostId?: string, url?: string }>} accounts
 */
export function buildRetryPlan(accounts) {
  const failedRaw = accounts.filter(
    (a) => (a.status || '').toLowerCase() === 'failed'
  );
  const skippedLive = failedRaw.filter(accountLooksLiveOnPlatform);
  const failed = failedRaw.filter((a) => !accountLooksLiveOnPlatform(a));

  /** @type {Array<typeof failed[0] & { action: string, hint: string }>} */
  const retryNow = [];
  /** @type {typeof retryNow} */
  const wait = [];
  /** @type {typeof retryNow} */
  const rateLimitMaybeLive = [];
  /** @type {typeof retryNow} */
  const fix = [];
  /** @type {typeof retryNow} */
  const quota = [];

  for (const a of failed) {
    const c = classifyRetryError(a.error);
    const row = { ...a, action: c.action, hint: c.hint };
    if (c.action === RETRY_ACTION.RETRY_NOW) retryNow.push(row);
    else if (c.action === RETRY_ACTION.RATE_LIMIT_MAYBE_LIVE)
      rateLimitMaybeLive.push(row);
    else if (c.action === RETRY_ACTION.WAIT) wait.push(row);
    else if (c.action === RETRY_ACTION.FIX_ACCOUNT) fix.push(row);
    else quota.push(row);
  }

  return {
    failed,
    skippedLive,
    retryNow,
    rateLimitMaybeLive,
    igMaybeLive: rateLimitMaybeLive,
    wait,
    fix,
    quota,
  };
}

const NET_SHORT = {
  instagram: 'IG',
  facebook: 'FB',
  threads: 'TH',
  youtube: 'YT',
  x: 'X',
  tiktok: 'TT',
};

/**
 * @param {ReturnType<typeof buildRetryPlan>} plan
 * @param {string} [postIdLine]
 */
export function formatRetryPlanReport(plan, postIdLine = '') {
  let skippedPrefix = '';
  if (plan.skippedLive?.length) {
    const lines = plan.skippedLive
      .slice(0, 8)
      .map((a) => {
        const net = NET_SHORT[(a.network || '').toLowerCase()] || a.network || '?';
        const user = (a.username || '').replace(/^@/, '').replace(/[_*`[\]]/g, '\\$&');
        return `• ${net} @${user}`;
      });
    skippedPrefix =
      `ℹ️ *${plan.skippedLive.length} akun* ditandai gagal di Outstand tapi sudah ada link live — *tidak* di-retry otomatis.\n` +
      `${lines.join('\n')}` +
      (plan.skippedLive.length > 8 ? `\n_…+${plan.skippedLive.length - 8} lain_` : '') +
      '\n\n';
    if (!plan.failed.length) {
      return (
        skippedPrefix +
        (postIdLine ? `Post ID: ${postIdLine}\n` : '') +
        'Cek pending: `/links` · Sheets: `/synctoday`'
      );
    }
  }

  if (!plan.failed.length) {
    const skipped = plan.skippedLive || [];
    if (skipped.length) {
      const lines = skipped.slice(0, 15).map((a) => {
        const net = (a.network || '').toLowerCase();
        const user = (a.username || '').replace(/^@/, '').replace(/[_*`[\]]/g, '\\$&');
        return `• ${net} @${user}`;
      });
      const more = skipped.length > 15 ? `\n_…+${skipped.length - 15} lagi_` : '';
      return (
        `ℹ️ *${skipped.length} akun ditandai "gagal" oleh Outstand* — tapi terdeteksi sudah LIVE (punya URL/platformPostId).\n\n` +
        lines.join('\n') +
        more +
        '\n\n' +
        (postIdLine ? `Post ID: ${postIdLine}\n` : '') +
        '_Sheets akan otomatis benerin statusnya saat `/refresh`. Cek profil platform untuk verifikasi._\n\n' +
        '⚠️ *Jangan* retry akun-akun ini — risiko double post tinggi.'
      );
    }
    return (
      '✅ Tidak ada akun *gagal* pada batch ini.\n\n' +
      (postIdLine ? `Post ID: ${postIdLine}\n` : '') +
      'Cek pending: `/links` · Sheets: `/syncsheet`'
    );
  }

  const lines = [
    `🔄 *Retry publish gagal* — ${plan.failed.length} akun`,
    postIdLine ? `Post ID: ${postIdLine}` : '',
    '',
  ].filter(Boolean);

  const shortErr = (s) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > 100 ? t.slice(0, 100) + '…' : t;
  };
  const escMd = (s) => String(s || '').replace(/[_*`[\]]/g, '\\$&');

  const section = (title, items, emoji) => {
    if (!items.length) return;
    lines.push(`${emoji} *${title}* (${items.length}):`);
    for (const a of items.slice(0, 15)) {
      const net = NET_SHORT[(a.network || '').toLowerCase()] || a.network || '?';
      const user = (a.username || '').replace(/^@/, '');
      const err = shortErr(a.error);
      lines.push(
        `• ${net} @${escMd(user)}\n  _${a.hint}_` +
          (err ? `\n  └ \`${escMd(err)}\`` : '')
      );
    }
    if (items.length > 15) {
      lines.push(`_…+${items.length - 15} akun lain_`);
    }
    lines.push('');
  };

  section('Bisa diulang sekarang', plan.retryNow, '✅');
  section(
    'Cek profil dulu — jangan retry jika sudah live',
    plan.rateLimitMaybeLive || plan.igMaybeLive || [],
    '⚠️'
  );
  section('Tunggu dulu (rate limit)', plan.wait, '⏳');
  section('Perbaiki akun dulu', plan.fix, '🔧');
  section('Kuota / besok', plan.quota, '📅');

  const canRetry = plan.retryNow.length;
  if (canRetry > 0) {
    lines.push(`*Publish ulang:* tombol di bawah atau \`/retry kirim\` (${canRetry} akun)`);
  } else if (
    (plan.rateLimitMaybeLive?.length || plan.igMaybeLive?.length || 0) +
      plan.wait.length >
    0
  ) {
    lines.push(
      '_Tidak ada retry otomatis untuk rate limit — cek profil/platform dulu, baru publish manual jika benar-benar belum ada post._'
    );
  } else {
    lines.push(
      '_Tidak ada yang aman untuk diulang otomatis. Perbaiki akun/kuota lalu publish manual._'
    );
  }

  return (skippedPrefix + lines.join('\n')).trim();
}

/**
 * ID akun yang boleh dipublish ulang (retry now + wait jika includeWait).
 * @param {ReturnType<typeof buildRetryPlan>} plan
 * @param {{ includeWait?: boolean }} [options]
 */
export function collectRetryAccountIds(plan, options = {}) {
  const ids = plan.retryNow.map((a) => a.accountId).filter(Boolean);
  if (options.includeWait) {
    ids.push(...plan.wait.map((a) => a.accountId).filter(Boolean));
  }
  return [...new Set(ids)];
}

/**
 * Retry hanya ke username tertentu (mis. yeseniamandiri).
 * @param {string[]} retryIds
 * @param {Array<{ accountId?: string, username?: string }>} accounts
 * @param {string[]} usernames
 */
export function filterRetryIdsByUsernames(retryIds, accounts, usernames) {
  if (!usernames?.length) return retryIds;
  const want = new Set(usernames.map((u) => u.replace(/^@/, '').toLowerCase()));
  const idByUser = new Map(
    accounts
      .filter((a) => a.accountId)
      .map((a) => [(a.username || '').replace(/^@/, '').toLowerCase(), a.accountId])
  );
  return [...want]
    .map((u) => idByUser.get(u))
    .filter((id) => id && retryIds.includes(id));
}

/**
 * Cegah retry ke akun yang sudah live atau sudah banyak attempt hari ini.
 * @param {string[]} retryIds
 * @param {Record<string, { published?: number, total?: number, username?: string }>} usageByAccountId
 */
export function applyRetrySafetyFilter(retryIds, usageByAccountId) {
  /** @type {Array<{ id: string, username: string, reason: string }>} */
  const blocked = [];
  const allowed = [];

  for (const id of retryIds) {
    const u = usageByAccountId[id];
    if (!u) {
      allowed.push(id);
      continue;
    }
    if ((u.published || 0) >= 1) {
      blocked.push({
        id,
        username: u.username || id,
        reason: 'sudah live hari ini (Outstand/Sheets)',
      });
      continue;
    }
    if ((u.total || 0) >= 2) {
      blocked.push({
        id,
        username: u.username || id,
        reason: `sudah ${u.total}× attempt hari ini — risiko double post`,
      });
      continue;
    }
    allowed.push(id);
  }

  return { allowed, blocked };
}

/**
 * @param {Array<{ username?: string, reason?: string }>} blocked
 */
export function formatRetryBlockedNotice(blocked) {
  if (!blocked.length) return '';
  const lines = blocked.slice(0, 10).map(
    (b) => `• @${(b.username || '').replace(/^@/, '')} — _${b.reason}_`
  );
  return (
    `⛔ *Dilewati (${blocked.length}):*\n${lines.join('\n')}` +
    (blocked.length > 10 ? `\n_…+${blocked.length - 10} akun_` : '') +
    '\n\n_Cek profil IG sebelum retry manual._\n\n'
  );
}
