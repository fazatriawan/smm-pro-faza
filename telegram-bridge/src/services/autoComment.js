import { env } from '../config/env.js';
import { publishPostReply } from './outstand.js';
import {
  PLATFORM_CHAR_LIMITS,
  truncateAtSentence,
} from './captionPlatforms.js';
import {
  markAutoCommentSent,
  wasAutoCommentSent,
} from '../utils/autoCommentSent.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auto-comment');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} network
 */
function fixedCommentForNetwork(network) {
  const net = (network || '').toLowerCase();
  const byNet = env.autoCommentTextByNetwork || {};
  const custom = byNet[net];
  if (custom && String(custom).trim()) return String(custom).trim();
  return env.autoCommentText || '';
}

/**
 * Caption yang dipakai saat publish untuk platform ini (dari konteks batch).
 * @param {{ network?: string, postCaption?: string }} acct
 * @param {{ baseCaption?: string, captionsByNetwork?: Record<string, string> } | null | undefined} publishCtx
 */
export function captionForAccount(acct, publishCtx) {
  const net = (acct.network || '').toLowerCase();
  const raw =
    publishCtx?.captionsByNetwork?.[net] ||
    publishCtx?.baseCaption ||
    acct.postCaption ||
    '';
  const limit = PLATFORM_CHAR_LIMITS[net] || 2200;
  return truncateAtSentence(String(raw).trim(), limit);
}

/**
 * @param {{ network?: string, username?: string, postCaption?: string }} acct
 * @param {{ baseCaption?: string, captionsByNetwork?: Record<string, string> } | null | undefined} publishCtx
 */
export function buildAutoCommentContent(acct, publishCtx) {
  const net = (acct.network || '').toLowerCase();
  const caption = captionForAccount(acct, publishCtx);
  const fixed = fixedCommentForNetwork(net);
  const mode = (env.autoCommentMode || 'caption').toLowerCase();
  const user = String(acct.username || '').replace(/^@/, '').trim();

  switch (mode) {
    case 'fixed':
      return fixed;
    case 'suffix':
      if (!fixed) return caption;
      return caption ? `${caption}\n\n${fixed}` : fixed;
    case 'template': {
      const tpl = fixed || env.autoCommentText || '{caption}';
      return tpl
        .replace(/\{caption\}/gi, caption)
        .replace(/\{username\}/gi, user)
        .replace(/\{network\}/gi, net)
        .trim();
    }
    case 'caption':
    default:
      return caption || fixed;
  }
}

/**
 * @param {string} network
 */
function networkAllowed(network) {
  const net = (network || '').toLowerCase();
  const allowed = env.autoCommentNetworks || [];
  if (!allowed.length) return true;
  return allowed.includes(net);
}

/**
 * @param {{ ok: number, fail: number, skip: number, errors: Array<{ username?: string, network?: string, message: string }> }} results
 */
export function formatAutoCommentTelegramReport(results) {
  const { ok, fail, skip, errors } = results;
  if (!ok && !fail) return '';

  let msg = `💬 *Komentar otomatis:* ${ok} terkirim`;
  if (skip) msg += ` · ${skip} dilewati`;
  if (fail) msg += ` · ${fail} gagal`;

  if (errors.length) {
    const lines = errors.slice(0, 5).map((e) => {
      const user = e.username ? `@${e.username.replace(/^@/, '')}` : '—';
      const short = String(e.message || '').slice(0, 120);
      return `• ${e.network || '?'} ${user}: ${short}`;
    });
    msg += '\n\n' + lines.join('\n');
    if (errors.length > 5) msg += `\n_…+${errors.length - 5} lagi_`;
  }
  return msg;
}

/**
 * @param {Array<{ postId?: string, accountId?: string, network?: string, username?: string, status?: string, platformPostId?: string | null, postCaption?: string }>} accounts
 * @param {(text: string) => Promise<void>} [notify]
 * @param {{ resolvePublishContext?: (postId: string) => { baseCaption?: string, captionsByNetwork?: Record<string, string> } | null | undefined }} [options]
 */
export async function runAutoCommentsForPublishedAccounts(
  accounts,
  notify,
  options = {}
) {
  if (!env.autoCommentEnabled) {
    return { enabled: false, ok: 0, fail: 0, skip: 0, errors: [] };
  }

  const resolveCtx = options.resolvePublishContext || (() => null);

  const targets = (accounts || []).filter((a) => {
    if ((a.status || '').toLowerCase() !== 'published') return false;
    if (!a.postId || !a.platformPostId) return false;
    if (!networkAllowed(a.network)) return false;
    const ctx = resolveCtx(a.postId);
    const text = buildAutoCommentContent(a, ctx);
    return Boolean(text);
  });

  if (!targets.length) {
    return { enabled: true, ok: 0, fail: 0, skip: 0, errors: [] };
  }

  if (env.autoCommentDelayMs > 0) {
    await sleep(env.autoCommentDelayMs);
  }

  /** @type {{ ok: number, fail: number, skip: number, errors: Array<{ username?: string, network?: string, message: string }> }} */
  const results = { ok: 0, fail: 0, skip: 0, errors: [] };

  for (const acct of targets) {
    const dedupKey = `${acct.postId}:${acct.accountId || acct.username}`;
    if (await wasAutoCommentSent(dedupKey)) {
      results.skip += 1;
      continue;
    }

    const publishCtx = resolveCtx(acct.postId);
    const content = buildAutoCommentContent(acct, publishCtx);
    if (!content) {
      results.skip += 1;
      continue;
    }

    try {
      await publishPostReply(acct.postId, {
        content,
        platformPostId: String(acct.platformPostId),
        accountUsername: acct.username,
      });
      await markAutoCommentSent(dedupKey);
      results.ok += 1;
      log.info(
        {
          postId: acct.postId,
          network: acct.network,
          username: acct.username,
          mode: env.autoCommentMode,
          len: content.length,
        },
        '[AutoComment] sent'
      );
    } catch (err) {
      results.fail += 1;
      const message = err?.message || String(err);
      results.errors.push({
        username: acct.username,
        network: acct.network,
        message,
      });
      log.warn(
        {
          postId: acct.postId,
          network: acct.network,
          username: acct.username,
          err: message,
        },
        `[AutoComment] failed: ${message}`
      );
    }

    if (env.autoCommentStaggerMs > 0) {
      await sleep(env.autoCommentStaggerMs);
    }
  }

  const report = formatAutoCommentTelegramReport(results);
  if (notify && report) {
    try {
      await notify(report);
    } catch (err) {
      log.warn({ err: err.message }, `[AutoComment] notify: ${err.message}`);
    }
  }

  return { enabled: true, ...results };
}
