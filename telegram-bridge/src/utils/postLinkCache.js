import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractInstagramShortcodeFromUrl,
  isInvalidInstagramShortcode,
} from './platformUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../data/post-links.json');

/** @type {Record<string, string> | null} */
let memory = null;

function normalizeUser(username) {
  return String(username || '').replace(/^@/, '').trim().toLowerCase();
}

/**
 * @param {string} urlOrCode
 * @param {string} [network]
 */
export function validatePostLinkInput(urlOrCode, network = 'instagram') {
  const raw = String(urlOrCode || '').trim();
  if (!raw) return { ok: false, reason: 'Link/shortcode kosong' };

  const net = (network || '').toLowerCase();
  if (/^SHORTCODE/i.test(raw) || /^PLACEHOLDER/i.test(raw)) {
    return {
      ok: false,
      reason: 'Masih placeholder — ganti dengan shortcode asli dari URL Instagram',
    };
  }

  if (net === 'instagram') {
    const m = raw.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/i);
    const code = m?.[1] || (/^https?:\/\//i.test(raw) ? '' : raw.replace(/\//g, ''));
    if (!code) {
      return { ok: false, reason: 'Format tidak dikenali — pakai shortcode atau URL /p/…' };
    }
    if (isInvalidInstagramShortcode(code)) {
      return { ok: false, reason: 'Placeholder SHORTCODE — ganti shortcode asli dari profil IG' };
    }
    if (!/^[A-Za-z0-9_-]{6,15}$/.test(code) || !/[A-Za-z]/.test(code)) {
      return { ok: false, reason: `Shortcode tidak valid: ${code}` };
    }
    return { ok: true };
  }

  if (net === 'threads') {
    if (/threads\.(?:net|com)\/@[^/?#]+\/post\/[A-Za-z0-9_-]+/i.test(raw)) {
      return { ok: true };
    }
    if (!/^https?:\/\//i.test(raw)) {
      const code = raw.replace(/\//g, '');
      if (isInvalidInstagramShortcode(code)) {
        return { ok: false, reason: 'Placeholder — ganti code asli dari URL Threads /post/…' };
      }
      if (/^[A-Za-z0-9_-]{6,20}$/.test(code)) return { ok: true };
    }
    return {
      ok: false,
      reason: 'Threads: pakai URL threads.com/@user/post/CODE atau code saja',
    };
  }

  return { ok: true };
}

/**
 * @param {{ socialAccounts?: Array<{ network?: string, username?: string }> }} post
 * @param {string} username
 */
export function networkForPostUsername(post, username) {
  const u = normalizeUser(username);
  const acct = (post?.socialAccounts || []).find(
    (a) => normalizeUser(a.username || a.nickname) === u
  );
  return (acct?.network || 'instagram').toLowerCase();
}

/**
 * @param {string} [postId]
 * @param {string} network
 * @param {string} username
 */
export function postLinkCacheKey(postId, network, username) {
  const pid = String(postId || '').trim() || '_';
  const net = (network || '').toLowerCase();
  const user = normalizeUser(username);
  return `${pid}:${net}:${user}`;
}

async function loadAll() {
  if (memory) return memory;
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    memory = JSON.parse(raw);
    if (!memory || typeof memory !== 'object') memory = {};
  } catch {
    memory = {};
  }
  return memory;
}

async function persist() {
  if (!memory) return;
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(memory, null, 2), 'utf8');
}

/**
 * @param {string} postId
 * @param {string} network
 * @param {string} username
 * @param {string} urlOrCode
 */
export async function savePostLink(postId, network, username, urlOrCode) {
  let url = String(urlOrCode || '').trim();
  if (!url) return '';

  const net = (network || 'instagram').toLowerCase();
  const user = normalizeUser(username);

  const check = validatePostLinkInput(url, net);
  if (!check.ok) {
    throw new Error(check.reason || 'Link tidak valid');
  }

  if (!/^https?:\/\//i.test(url)) {
    const code = url.replace(/\//g, '');
    if (net === 'threads') {
      url = user
        ? `https://www.threads.com/@${encodeURIComponent(user)}/post/${code}`
        : `https://www.threads.com/post/${code}`;
    } else {
      url = `https://www.instagram.com/p/${code}/`;
    }
  }
  const all = await loadAll();
  all[postLinkCacheKey(postId, network, username)] = url;
  await persist();
  return url;
}

/**
 * @param {string} postId
 * @param {string} network
 * @param {string} username
 */
export async function getPostLink(postId, network, username) {
  const all = await loadAll();
  return all[postLinkCacheKey(postId, network, username)] || '';
}

/**
 * Terapkan link tersimpan (manual/scrape) ke daftar akun sebelum tulis Sheets.
 * @param {Array<{ postId?: string, network?: string, username?: string, url?: string, status?: string }>} accounts
 */
function cachedUrlIsUsable(network, url) {
  const net = (network || '').toLowerCase();
  const u = String(url || '').trim();
  if (!u) return false;
  if (net === 'instagram' && /instagram\.com\/(?:p|reel)\//i.test(u)) {
    const code = extractInstagramShortcodeFromUrl(u);
    return Boolean(code) && !isInvalidInstagramShortcode(code);
  }
  if (net === 'threads' && /threads\.(?:net|com)/i.test(u)) {
    return /\/post\/[A-Za-z0-9_-]+/i.test(u);
  }
  return true;
}

export async function applyPostLinkCache(accounts) {
  if (!accounts?.length) return accounts;
  const all = await loadAll();
  let changed = false;
  for (const a of accounts) {
    const key = postLinkCacheKey(a.postId, a.network, a.username);
    const cached = all[key];
    if (!cached) continue;
    if (!cachedUrlIsUsable(a.network, cached)) {
      delete all[key];
      changed = true;
      continue;
    }
    a.url = cached;
  }
  if (changed) await persist();
  return accounts;
}

/** Hapus entri placeholder dari data/post-links.json */
export async function purgeInvalidPostLinkCache() {
  const all = await loadAll();
  let removed = 0;
  for (const [key, url] of Object.entries(all)) {
    const net = key.split(':')[1] || 'instagram';
    if (!cachedUrlIsUsable(net, url)) {
      delete all[key];
      removed += 1;
    }
  }
  if (removed) await persist();
  return removed;
}

/**
 * Simpan URL konkret yang sudah ada di akun (setelah scrape berhasil).
 * @param {Array<{ postId?: string, network?: string, username?: string, url?: string }>} accounts
 */
export async function persistAccountUrls(accounts) {
  if (!accounts?.length) return;
  const all = await loadAll();
  let changed = false;
  for (const a of accounts) {
    const url = String(a.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const key = postLinkCacheKey(a.postId, a.network, a.username);
    if (all[key] !== url) {
      all[key] = url;
      changed = true;
    }
  }
  if (changed) await persist();
}
