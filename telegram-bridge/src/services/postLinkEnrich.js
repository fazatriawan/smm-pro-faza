import { env } from '../config/env.js';
import { hasConcretePostLink } from '../utils/platformUrl.js';
import { createLogger } from '../utils/logger.js';
import {
  applyPostLinkCache,
  persistAccountUrls,
} from '../utils/postLinkCache.js';
import { scrapeThreadsLatestPostUrls } from './threadsScrape.js';
import { scrapeInstagramLatestPostUrls } from './instagramScrape.js';

const log = createLogger('postLinkEnrich');

/** @type {Map<string, { url: string, at: number }>} */
const scrapeCache = new Map();
const CACHE_MS = 45 * 60_000;

function cacheKey(network, username) {
  return `${(network || '').toLowerCase()}:${String(username || '').replace(/^@/, '').toLowerCase()}`;
}

/**
 * Isi kolom url untuk IG/Threads published yang belum punya permalink dari Outstand.
 * Mutates accounts in place.
 *
 * @param {Array<{ network?: string, username?: string, status?: string, url?: string, platformPostId?: string }>} accounts
 * @param {{ maxScrape?: number }} [opts]
 */
export async function enrichAccountsWithScrapedLinks(accounts, opts = {}) {
  if (!accounts?.length) return accounts;

  await applyPostLinkCache(accounts);

  if (!env.postLinkScrapeEnabled) return accounts;

  const maxScrape = Math.min(
    50,
    Math.max(1, opts.maxScrape ?? env.postLinkScrapeMax)
  );

  /** @type {Array<{ account: object, net: string, user: string, ck: string }>} */
  const queue = [];

  for (const a of accounts) {
    const net = (a.network || '').toLowerCase();
    if (net !== 'threads' && net !== 'instagram') continue;
    if ((a.status || '').toLowerCase() !== 'published') continue;
    if (hasConcretePostLink(net, a.url, a.platformPostId)) continue;

    const user = (a.username || '').replace(/^@/, '').trim();
    if (!user) continue;

    const ck = cacheKey(net, user);
    const hit = scrapeCache.get(ck);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      if (hit.url) a.url = hit.url;
      continue;
    }

    queue.push({ account: a, net, user, ck });
  }

  if (!queue.length) return accounts;

  const threadsQ = queue.filter((q) => q.net === 'threads').slice(0, maxScrape);
  const igQ = queue
    .filter((q) => q.net === 'instagram')
    .slice(0, Math.max(0, maxScrape - threadsQ.length));

  const applyScraped = (items, scraped) => {
    const byUser = new Map(
      scraped.map((s) => [s.username.toLowerCase(), s.url || ''])
    );
    for (const { account, user, ck } of items) {
      const url = byUser.get(user.toLowerCase()) || '';
      scrapeCache.set(ck, { url, at: Date.now() });
      if (url) account.url = url;
    }
  };

  try {
    if (threadsQ.length) {
      const users = threadsQ.map((q) => q.user);
      const scraped = await scrapeThreadsLatestPostUrls(users);
      applyScraped(threadsQ, scraped);
      log.info(
        { network: 'threads', tried: threadsQ.length, found: scraped.filter((s) => s.url).length },
        '[Scrape] Threads post links'
      );
    }
    if (igQ.length) {
      const users = igQ.map((q) => q.user);
      const scraped = await scrapeInstagramLatestPostUrls(users);
      applyScraped(igQ, scraped);
      log.info(
        { network: 'instagram', tried: igQ.length, found: scraped.filter((s) => s.url).length },
        '[Scrape] Instagram post links'
      );
    }
  } catch (err) {
    log.warn({ err: err.message }, `[Scrape] enrich links: ${err.message}`);
  }

  await persistAccountUrls(accounts);
  return accounts;
}
