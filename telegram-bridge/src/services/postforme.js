import axios from 'axios';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { env } from '../config/env.js';
import { downloadFile } from './drive.js';
import { buildCaptionsByNetwork } from './captionPlatforms.js';
import {
  convertDriveImagesToSocialVideo,
  networksNeedingImageToVideo,
  normalizeVideoForTikTok,
} from './imageToVideo.js';
import { createLogger } from '../utils/logger.js';
import { dataPath } from '../utils/dataPath.js';

const log = createLogger('postforme');

const BASE_URL = 'https://api.postforme.dev';

let _accountsCache = null;
let _accountsCacheTime = 0;
const ACCOUNTS_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache hasil publish — PostForme menghapus post dari API setelah diproses (404),
// sehingga polling tidak bisa dapat status. Cache ini jadi fallback: kalau getPost
// dapat 404, kembalikan data dari cache dengan status 'published'.
// Cache juga disimpan ke disk supaya survive restart bot.
const _postResultCache = new Map(); // postId → { post, savedAt }
const CACHE_FILE = dataPath('postforme-cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

function _loadCacheFromDisk() {
  try {
    if (!existsSync(CACHE_FILE)) return;
    const raw = readFileSync(CACHE_FILE, 'utf8');
    const entries = JSON.parse(raw);
    const now = Date.now();
    let loaded = 0;
    for (const [postId, { post, savedAt }] of Object.entries(entries)) {
      if (now - savedAt < CACHE_TTL_MS) {
        _postResultCache.set(postId, { post, savedAt });
        loaded++;
      }
    }
    if (loaded > 0) log.info({ loaded }, '[PostForme] cache dipulihkan dari disk');
  } catch (err) {
    log.warn({ err: err.message }, '[PostForme] gagal baca cache dari disk, mulai dari kosong');
  }
}

function _saveCacheToDisk() {
  try {
    const dir = dirname(CACHE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const obj = {};
    for (const [postId, entry] of _postResultCache.entries()) {
      obj[postId] = entry;
    }
    writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf8');
  } catch (err) {
    log.warn({ err: err.message }, '[PostForme] gagal simpan cache ke disk');
  }
}

// Load cache dari disk saat module pertama kali diinisialisasi
_loadCacheFromDisk();

function buildCachedPost(postId, accts) {
  return {
    id: String(postId),
    status: 'published',
    socialAccounts: accts.map((a) => ({
      id: a.id,
      network: a.network,
      username: a.username,
      status: 'published',
      url: '',
      error: null,
    })),
    caption: '',
    scheduledAt: null,
  };
}

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${env.postformeApiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 120_000,
});

// PostForme pakai nama platform lowercase
const NETWORK_TO_PLATFORM = {
  instagram: 'instagram',
  threads: 'threads',
  facebook: 'facebook',
  twitter: 'x',
  x: 'x',
  tiktok: 'tiktok',
  youtube: 'youtube',
  linkedin: 'linkedin',
  bluesky: 'bluesky',
  pinterest: 'pinterest',
};

const PLATFORM_TO_NETWORK = {};
for (const [k, v] of Object.entries(NETWORK_TO_PLATFORM)) {
  if (!PLATFORM_TO_NETWORK[v]) PLATFORM_TO_NETWORK[v] = k;
}
// Alias platform PostForme yang mungkin berbeda dari nama standar
Object.assign(PLATFORM_TO_NETWORK, {
  ig: 'instagram',
  instagram_business: 'instagram',
  instagram_personal: 'instagram',
  fb: 'facebook',
  tt: 'tiktok',
  tw: 'twitter',
});

function toNetwork(platform) {
  const p = (platform || '').toLowerCase();
  return PLATFORM_TO_NETWORK[p] || p;
}

function toPlatform(network) {
  return NETWORK_TO_PLATFORM[(network || '').toLowerCase()] || network;
}

function formatError(err) {
  const data = err.response?.data;
  if (!data) return err.message;
  if (typeof data === 'string') return data;
  const rawMsg = data?.message ?? data?.error ?? '';
  const msg = typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg).slice(0, 300);
  const details = data?.errors;
  if (details) {
    const s = typeof details === 'string' ? details : JSON.stringify(details).slice(0, 400);
    return msg ? `${msg} — ${s}` : s;
  }
  return msg || JSON.stringify(data).slice(0, 300) || err.message;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function groupAccountsByNetwork(socialAccountIds, allAccounts) {
  const idSet = new Set(socialAccountIds);
  const byNet = {};
  for (const a of allAccounts) {
    if (!idSet.has(a.id)) continue;
    const net = (a.network || 'unknown').toLowerCase();
    if (!byNet[net]) byNet[net] = [];
    byNet[net].push(a);
  }
  return byNet;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function getCachedAccounts() {
  if (_accountsCache && Date.now() - _accountsCacheTime < ACCOUNTS_CACHE_TTL_MS) {
    return _accountsCache;
  }
  _accountsCache = await listSocialAccounts();
  _accountsCacheTime = Date.now();
  return _accountsCache;
}

export function invalidateAccountsCache() {
  _accountsCache = null;
  _accountsCacheTime = 0;
}

export async function listSocialAccounts() {
  const PAGE_LIMIT = 100;
  const MAX_PAGES = 25;
  /** @type {any[]} */
  const allRaw = [];
  let currentOffset = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let res;
    const params = { limit: PAGE_LIMIT, offset: currentOffset };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await client.get('/v1/social-accounts', { params });
        break;
      } catch (err) {
        const status = err.response?.status ?? 0;
        if (status === 429 && attempt < 2) {
          const wait = Number(err.response?.headers?.['retry-after'] || 10) * 1000;
          log.warn({ attempt, wait }, `[PostForme] listSocialAccounts 429 — retry in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        const detail = formatError(err);
        log.error({ status, detail }, `[PostForme] listSocialAccounts error (${status}): ${detail}`);
        throw new Error(`PostForme listSocialAccounts gagal (${status}): ${detail}`);
      }
    }
    const body = res.data;
    const pageItems = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body)
        ? body
        : body?.items ?? body?.accounts ?? [];

    if (!pageItems.length) break;

    allRaw.push(...pageItems);

    // PostForme pakai offset-based pagination via meta.next / meta.total
    const meta = body?.meta;
    const total = meta?.total ?? null;
    if (total !== null && allRaw.length >= total) break;
    if (!meta?.next) break; // tidak ada halaman berikutnya
    if (pageItems.length < PAGE_LIMIT) break; // halaman terakhir

    currentOffset += pageItems.length;
  }

  // Dedup di akhir — berdasarkan id yang sudah di-map, bukan raw field
  log.info({ total: allRaw.length }, '[PostForme] listSocialAccounts — total sebelum dedup');

  // PostForme mungkin tidak punya status filter — ambil semua, filter yg tidak disconnected
  const connected = allRaw.filter((a) => {
    const s = (a.status || '').toLowerCase();
    return s !== 'disconnected' && s !== 'revoked' && s !== 'error';
  });

  log.info({ connected: connected.length }, '[PostForme] listSocialAccounts — connected');

  // Log semua nilai platform unik — bantu debug kalau ada nama platform tidak dikenal
  const platformCounts = {};
  for (const a of allRaw) {
    const p = String(a.platform ?? a.type ?? a.provider ?? '').toLowerCase() || '(kosong)';
    platformCounts[p] = (platformCounts[p] || 0) + 1;
  }
  log.info({ platformCounts }, '[PostForme] listSocialAccounts — platform counts dari raw API');

  // Log field keys dari beberapa akun TikTok untuk debug username mapping
  const tiktokSamples = connected.filter((a) => (a.platform ?? a.type ?? '').toLowerCase() === 'tiktok').slice(0, 3);
  if (tiktokSamples.length) {
    log.info({ samples: tiktokSamples.map((a) => ({ username: a.username, name: a.name, handle: a.handle, display_name: a.display_name, profile_name: a.profile_name, metadata: a.metadata })) }, '[PostForme] TikTok account raw fields');
  }

  const mapped = connected
    .map((a) => ({
      id: String(a.id ?? ''),
      network: toNetwork(a.platform ?? a.type ?? a.provider ?? ''),
      username: a.username ?? a.name ?? a.handle ?? a.display_name ?? '',
      pageId: a.page_id ?? a.pageId ?? null,
    }))
    .filter((a) => a.id);

  // Dedup by id — jaga kalau API mengembalikan akun yang sama di beberapa halaman
  const seenIds = new Set();
  return mapped.filter((a) => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
}

// ─── Media ───────────────────────────────────────────────────────────────────

/**
 * Upload media ke PostForme — 3 langkah: create-upload-url → PUT binary → pakai media_url
 * @param {{ buffer: Buffer, filename: string, mimeType: string }} file
 * @returns {Promise<{ id: string, url: string, filename: string, mimeType: string }>}
 */
export async function uploadMediaBuffer({ buffer, filename, mimeType }) {
  // Step 1: minta signed upload URL
  const createRes = await client.post('/v1/media/create-upload-url', {
    filename,
    content_type: mimeType,
    size: buffer.length,
  });
  const raw = createRes.data;
  const meta = raw?.data ?? raw;
  log.info({ meta }, '[PostForme] create-upload-url response');

  const uploadUrl = meta?.upload_url ?? meta?.uploadUrl ?? meta?.signed_url;
  if (!uploadUrl) throw new Error('PostForme: tidak mendapat upload_url dari API');

  // Step 2: PUT binary ke signed URL
  await axios.put(uploadUrl, buffer, {
    headers: { 'Content-Type': mimeType },
    timeout: 300_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  // Coba semua kemungkinan field URL dari PostForme
  const mediaUrl =
    meta?.media_url ??
    meta?.url ??
    meta?.file_url ??
    meta?.public_url ??
    meta?.cdn_url ??
    meta?.asset_url ??
    '';

  log.info({ filename, mimeType, bytes: buffer.length, mediaUrl }, '[PostForme] Media uploaded');

  if (!mediaUrl) {
    log.warn({ meta }, '[PostForme] media URL kosong — cek field response di atas');
  }

  return {
    id: meta?.id ?? mediaUrl ?? filename,
    url: mediaUrl,
    filename,
    mimeType,
  };
}

async function resolveMediaBytes(mediaFile) {
  if (mediaFile.buffer) {
    return {
      buffer: mediaFile.buffer,
      mimeType: mediaFile.mimeType || 'application/octet-stream',
      name: mediaFile.name || 'media.bin',
    };
  }
  if (mediaFile.id) return downloadFile(mediaFile.id);
  throw new Error(`Media "${mediaFile.name || 'file'}" tidak punya data.`);
}

async function uploadMediaFromDrive(driveFile) {
  const { buffer, mimeType, name } = await resolveMediaBytes(driveFile);
  const filename = name.includes('.') ? name : `${name}.bin`;
  return uploadMediaBuffer({ buffer, filename, mimeType });
}

/**
 * Upload semua media yang dibutuhkan untuk publish.
 * Returns { mediaUrls, imageToVideoNetworks, imageToVideoSilent, tiktokNormalized }
 * — interface sama seperti woopsocial agar bot.js bisa pakai keduanya.
 */
export async function uploadMediaForTargets(driveMediaFiles, socialAccountIds) {
  const allAccounts = await listSocialAccounts();
  const byNet = groupAccountsByNetwork(socialAccountIds, allAccounts);
  const networks = Object.keys(byNet);

  const hasVideo = driveMediaFiles.some((f) => f.mimeType?.startsWith('video/'));
  const images = driveMediaFiles.filter((f) => f.mimeType?.startsWith('image/'));
  const convertNetworks = networksNeedingImageToVideo(networks, hasVideo, images.length > 0);

  let imageToVideoSilent = false;
  let mediaUrls = [];
  let tiktokNormalized = null;

  if (convertNetworks.length) {
    if (!images.length) {
      throw new Error('Platform terpilih butuh video, atau gambar + musik latar (assets/audio/).');
    }
    const primaryNet = convertNetworks.includes('youtube') ? 'youtube' : convertNetworks[0];
    const video = await convertDriveImagesToSocialVideo(images, primaryNet);
    if (video.silent) imageToVideoSilent = true;
    const item = await uploadMediaBuffer({
      buffer: video.buffer,
      filename: video.name,
      mimeType: video.mimeType,
    });
    mediaUrls = [item.url];
    log.info({ networks: convertNetworks }, `[Image→Video] PostForme video untuk: ${convertNetworks.join(', ')}`);
  } else if (driveMediaFiles.length) {
    const hasTikTok = networks.includes('tiktok');
    let filesToUpload = driveMediaFiles;

    if (hasTikTok && hasVideo) {
      filesToUpload = await Promise.all(
        driveMediaFiles.map(async (f) => {
          if (!f.mimeType?.startsWith('video/')) return f;
          const resolved = f.buffer
            ? { buffer: f.buffer, mimeType: f.mimeType, name: f.name }
            : await downloadFile(f.id);
          const normalized = await normalizeVideoForTikTok(
            resolved.buffer,
            resolved.name || f.name || 'video.mp4'
          );
          tiktokNormalized = { buffer: normalized.buffer, name: normalized.name };
          return { ...f, buffer: normalized.buffer, name: normalized.name, mimeType: normalized.mimeType };
        })
      );
    }

    for (const file of filesToUpload) {
      const item = await uploadMediaFromDrive(file);
      mediaUrls.push(item.url);
    }
  }

  // Bangun byNetwork dengan format sama seperti woopsocial agar bot.js kompatibel
  const allAccounts2 = await getCachedAccounts();
  const byNet2 = groupAccountsByNetwork(socialAccountIds, allAccounts2);
  const mediaItems = mediaUrls.map((url, i) => ({ id: `pf_${i}`, url }));
  const byNetwork = {};
  for (const net of Object.keys(byNet2)) {
    byNetwork[net] = mediaItems;
  }

  return {
    byNetwork,
    imageToVideoNetworks: convertNetworks,
    imageToVideoSilent,
    tiktokNormalized,
  };
}

// ─── Publish ─────────────────────────────────────────────────────────────────

/**
 * Publish konten ke beberapa akun via PostForme.
 * @param {{
 *   baseCaption: string,
 *   captionsByNetwork?: Record<string,string>,
 *   mediaUrls?: string[],
 *   scheduledAt?: string|null,
 *   socialAccountIds: string[],
 * }} opts
 * @returns {Promise<{ postIds: string[], results: Array<object> }>}
 */
export async function publishBulk({
  baseCaption,
  captionsByNetwork: captionsByNetworkIn,
  mediaUrls: mediaUrlsIn,
  mediaByNetwork,       // dari bot.js (format woopsocial)
  scheduledAt,
  socialAccountIds,
  // parameter woopsocial-specific — diabaikan
  youtubeFields: _yf,
  tiktokVideoBuffer: _tvb,
  tiktokVideoName: _tvn,
}) {
  // Ekstrak mediaUrls dari mediaByNetwork jika tidak diberikan langsung
  const mediaUrls = mediaUrlsIn
    ?? (mediaByNetwork
      ? [...new Set(Object.values(mediaByNetwork).flat().map((m) => m.url).filter(Boolean))]
      : []);
  const allAccounts = await getCachedAccounts();
  const byNet = groupAccountsByNetwork(socialAccountIds, allAccounts);
  const networks = Object.keys(byNet);

  if (!networks.length) return { postIds: [], results: [] };

  const captionsByNetwork =
    captionsByNetworkIn || buildCaptionsByNetwork(baseCaption, networks);

  const schedule = scheduledAt ? new Date(scheduledAt).toISOString() : undefined;

  // Group accounts by caption (satu request PostForme per caption unik)
  const captionGroups = new Map(); // caption → Account[]
  for (const [net, accts] of Object.entries(byNet)) {
    const cap = captionsByNetwork[net] || baseCaption;
    if (!captionGroups.has(cap)) captionGroups.set(cap, []);
    captionGroups.get(cap).push(...accts);
  }

  const postIds = [];
  const results = [];
  let callIdx = 0;

  for (const [caption, accts] of captionGroups) {
    if (!accts.length) continue;
    if (callIdx > 0) await sleep(300);

    const mediaObjects = mediaUrls.map((url) => ({ url }));
    const payload = {
      caption,
      social_accounts: accts.map((a) => a.id),
      ...(mediaObjects.length ? { media: mediaObjects } : {}),
      ...(schedule ? { scheduled_at: schedule } : {}),
    };
    log.info({ mediaUrls, payloadMedia: payload.media, accountCount: accts.length }, '[PostForme] publishBulk payload media');

    let posted = false;
    for (let attempt = 0; attempt < 3 && !posted; attempt++) {
      try {
        if (attempt > 0) await sleep(2000 * attempt);
        const res = await client.post('/v1/social-posts', payload);
        const body = res.data?.data ?? res.data;
        const postId = String(body?.id ?? '');
        if (postId) {
          postIds.push(postId);
          // Cache hasil publish sebagai fallback — PostForme hapus post dari API setelah diproses
          _postResultCache.set(postId, { post: buildCachedPost(postId, accts), savedAt: Date.now() });
          _saveCacheToDisk();
        }
        for (const a of accts) {
          results.push({
            accountId: a.id,
            network: a.network,
            username: a.username,
            status: 'pending',
            postId,
          });
        }
        callIdx++;
        posted = true;
        log.info(
          { postId, accounts: accts.length },
          `[PostForme] Post dibuat: ${postId} (${accts.length} akun)`
        );
      } catch (err) {
        const status = err.response?.status;
        if (status === 429 && attempt < 2) {
          const retryAfter = Number(err.response?.headers?.['retry-after'] || 5);
          log.warn({ attempt, retryAfter }, '[PostForme] 429 rate limit — retry');
          await sleep(retryAfter * 1000);
          continue;
        }
        throw new Error(`Publish PostForme gagal: ${formatError(err)}`);
      }
    }
  }

  return { postIds, results };
}

// ─── Post status ─────────────────────────────────────────────────────────────

function normalizePost(raw) {
  if (!raw) return null;
  const status = (raw.status || '').toLowerCase();
  const results = raw.results ?? raw.post_results ?? raw.accounts ?? [];

  const socialAccounts = results.map((r) => {
    const rawStatus = (r.status || '').toLowerCase();
    const normalStatus =
      rawStatus === 'success' || rawStatus === 'published' || rawStatus === 'processed'
        ? 'published'
        : rawStatus === 'failed' || rawStatus === 'error'
          ? 'failed'
          : 'pending';
    return {
      id: String(r.account_id ?? r.id ?? ''),
      network: toNetwork(r.platform ?? r.network ?? ''),
      username: r.username ?? r.account_username ?? r.name ?? '',
      status: normalStatus,
      platformPostId: r.platform_post_id ?? r.platformPostId ?? r.post_id ?? r.external_id ?? null,
      url: r.post_url ?? r.url ?? r.link ?? '',
      error: r.error ?? r.message ?? null,
    };
  });

  const normalStatus =
    status === 'success' || status === 'processed' || status === 'published'
      ? 'published'
      : status === 'failed' || status === 'error'
        ? 'failed'
        : 'pending';

  return {
    id: String(raw.id ?? ''),
    status: normalStatus,
    socialAccounts,
    caption: raw.caption ?? '',
    scheduledAt: raw.scheduled_at ?? null,
  };
}

/**
 * Ambil hasil publish per-akun untuk banyak postId sekaligus (batch).
 * Mengembalikan Map<postId, socialAccounts[]>.
 * @param {string[]} postIds
 * @returns {Promise<Map<string, Array<{id,network,username,status,platformPostId,url,error}>>>}
 */
export async function getPostResultsBatch(postIds) {
  const ids = (postIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const res = await client.get('/v1/social-post-results', {
      params: { post_id: ids, limit: Math.min(ids.length * 10, 100) },
      // axios serialisasi array sebagai post_id[]=... atau post_id=...&post_id=...
      paramsSerializer: (params) => {
        const parts = [];
        for (const [k, v] of Object.entries(params)) {
          if (Array.isArray(v)) {
            for (const val of v) parts.push(`${k}=${encodeURIComponent(val)}`);
          } else {
            parts.push(`${k}=${encodeURIComponent(v)}`);
          }
        }
        return parts.join('&');
      },
    });
    const body = res.data;
    const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    if (!items.length) return new Map();

    const accts = _accountsCache?.length ? _accountsCache : await listSocialAccounts();
    const acctMap = new Map(accts.map((a) => [a.id, a]));

    /** @type {Map<string, Array>} */
    const byPostId = new Map();
    for (const r of items) {
      const pid = String(r.post_id ?? '');
      if (!pid) continue;
      if (!byPostId.has(pid)) byPostId.set(pid, []);
      const acct = acctMap.get(String(r.social_account_id ?? ''));
      const status = r.success === true ? 'published' : r.error ? 'failed' : 'pending';
      byPostId.get(pid).push({
        id: String(r.social_account_id ?? ''),
        network: acct?.network ?? '',
        username: acct?.username ?? '',
        status,
        platformPostId: r.platform_data?.id ?? null,
        url: r.platform_data?.url ?? '',
        error: r.error ?? null,
      });
    }
    return byPostId;
  } catch (err) {
    log.warn({ postIds, err: err.message }, `[PostForme] getPostResultsBatch gagal: ${err.message}`);
    return new Map();
  }
}

/**
 * Ambil hasil publish per-akun dari endpoint khusus (tidak dihapus PostForme).
 * Mengembalikan socialAccounts dengan platformPostId dan url yang benar.
 * @param {string} postId
 * @returns {Promise<Array<{id,network,username,status,platformPostId,url,error}>>}
 */
export async function getPostResults(postId) {
  try {
    const res = await client.get('/v1/social-post-results', {
      params: { post_id: postId, limit: 100 },
    });
    const body = res.data;
    const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    if (!items.length) return [];

    // Cross-reference dengan account cache untuk username & network
    const accts = _accountsCache?.length ? _accountsCache : await listSocialAccounts();
    const acctMap = new Map(accts.map((a) => [a.id, a]));

    return items.map((r) => {
      const acct = acctMap.get(String(r.social_account_id ?? ''));
      const status = r.success === true ? 'published' : r.error ? 'failed' : 'pending';
      return {
        id: String(r.social_account_id ?? ''),
        network: acct?.network ?? '',
        username: acct?.username ?? '',
        status,
        platformPostId: r.platform_data?.id ?? null,
        url: r.platform_data?.url ?? '',
        error: r.error ?? null,
      };
    });
  } catch (err) {
    log.warn({ postId, err: err.message }, `[PostForme] getPostResults gagal: ${err.message}`);
    return [];
  }
}

export async function getPost(postId) {
  try {
    const res = await client.get(`/v1/social-posts/${postId}`);
    const body = res.data?.data ?? res.data;
    const post = normalizePost(body);

    // Jika socialAccounts kosong (PostForme masih memproses / belum hapus post),
    // coba getPostResults untuk ambil hasil nyata per-akun
    if (post && post.socialAccounts?.length === 0) {
      const results = await getPostResults(postId).catch(() => []);
      if (results.length > 0) {
        log.info({ postId, count: results.length }, '[PostForme] getPost socialAccounts kosong — dapat hasil dari getPostResults');
        const enrichedPost = { ...post, socialAccounts: results };
        _postResultCache.set(postId, { post: enrichedPost, savedAt: Date.now() });
        _saveCacheToDisk();
        return enrichedPost;
      }
    }

    // Update cache hanya jika API mengembalikan socialAccounts nyata — jangan overwrite
    // cache buildCachedPost yang bagus dengan response kosong (PostForme masih memproses)
    if (post && post.socialAccounts?.length > 0 && _postResultCache.has(postId)) {
      _postResultCache.set(postId, { post, savedAt: Date.now() });
      _saveCacheToDisk();
    }
    return post;
  } catch (err) {
    const status = err.response?.status;
    // PostForme menghapus post setelah diproses → 404 = sudah selesai diproses
    if (status === 404) {
      // Coba ambil hasil nyata dari /v1/social-post-results (endpoint persisten)
      const results = await getPostResults(postId).catch(() => []);
      if (results.length > 0) {
        log.info({ postId, count: results.length }, '[PostForme] getPost 404 — dapat hasil nyata dari getPostResults');
        const post = {
          id: postId,
          status: results.some((r) => r.status === 'pending') ? 'pending' : 'published',
          socialAccounts: results,
          caption: '',
          scheduledAt: null,
        };
        _postResultCache.set(postId, { post, savedAt: Date.now() });
        _saveCacheToDisk();
        return post;
      }
      // Fallback ke cache buildCachedPost
      const entry = _postResultCache.get(postId);
      if (entry) {
        log.info({ postId }, '[PostForme] getPost 404 — pakai cache (post sudah diproses)');
        return entry.post ?? entry;
      }
    }
    throw new Error(`PostForme getPost gagal: ${formatError(err)}`);
  }
}

export async function waitForPostsSettled(
  postIds,
  { maxWaitMs = 120_000, pollIntervalMs = 5_000, intervalMs, onProgress } = {}
) {
  if (!postIds?.length) return [];

  const interval = intervalMs ?? pollIntervalMs;
  const startMs = Date.now();
  const deadline = startMs + maxWaitMs;
  const latest = new Map();

  // Helper: ambil akun dari cache sebagai pending (PostForme masih memproses)
  const getCachePendingAccs = () =>
    postIds.flatMap((id) => {
      const entry = _postResultCache.get(id);
      return (entry?.post?.socialAccounts ?? []).map((a) => ({ ...a, status: 'pending' }));
    });

  // postIds yang sudah selesai diproses PostForme (POST endpoint return 404)
  const settledPids = new Set();

  while (Date.now() < deadline) {
    for (let i = 0; i < postIds.length; i++) {
      if (i > 0) await sleep(300);
      const pid = postIds[i];
      if (settledPids.has(pid)) continue; // sudah settled, skip

      // Cek status post di /v1/social-posts/{id}
      // status='success'/'processed' = final platform_data (final video ID TikTok) sudah tersedia
      // 404 = PostForme sudah hapus post (semua akun selesai)
      let postStillProcessing = false;
      let postIsDeleted = false;
      let settledPost = null;
      try {
        const r = await client.get(`/v1/social-posts/${pid}`);
        const body = r.data?.data ?? r.data;
        const rawStatus = (body?.status || '').toLowerCase();
        const isDone = rawStatus === 'success' || rawStatus === 'processed' || rawStatus === 'published';
        postStillProcessing = !isDone;
        if (isDone) {
          settledPost = normalizePost(body);
        }
      } catch (err) {
        const errStatus = err.response?.status;
        if (errStatus === 404) {
          postIsDeleted = true; // post sudah dihapus PostForme = semua akun selesai
        } else if (errStatus === 429) {
          postStillProcessing = true; // rate limited, coba lagi nanti
          await sleep(3000);
        } else {
          postStillProcessing = true;
        }
      }

      if (settledPost) {
        // Jika endpoint return settled status tapi socialAccounts kosong,
        // ambil per-akun dari getPostResults sebelum mark settled
        if (!settledPost.socialAccounts?.length) {
          const enrichResults = await getPostResults(pid).catch(() => []);
          if (enrichResults.length > 0) {
            settledPost = { ...settledPost, socialAccounts: enrichResults };
            latest.set(pid, settledPost);
            settledPids.add(pid);
            _postResultCache.set(pid, { post: settledPost, savedAt: Date.now() });
            _saveCacheToDisk();
          }
          // else: getPostResults 429/kosong — jangan settled dulu, coba lagi nanti
        } else {
          latest.set(pid, settledPost);
          settledPids.add(pid);
          _postResultCache.set(pid, { post: settledPost, savedAt: Date.now() });
          _saveCacheToDisk();
        }
      } else {
        // Masih processing atau 404: ambil hasil parsial dari getPostResults untuk progress
        const results = await getPostResults(pid).catch(() => []);
        if (results.length > 0) {
          const post = {
            id: pid,
            status: postStillProcessing ? 'pending' : 'published',
            socialAccounts: results,
            caption: '',
            scheduledAt: null,
          };
          latest.set(pid, post);
          if (!postStillProcessing) {
            settledPids.add(pid);
            _postResultCache.set(pid, { post, savedAt: Date.now() });
            _saveCacheToDisk();
          }
        } else if (postIsDeleted) {
          // 404 tapi getPostResults kosong (429 atau sudah expired) —
          // gunakan cache sebagai settled result supaya tidak loop sampai timeout
          const cached = _postResultCache.get(pid);
          const fallback = cached?.post
            ? { ...cached.post, status: 'published', socialAccounts: cached.post.socialAccounts.map((a) => ({ ...a, status: 'published' })) }
            : { id: pid, status: 'published', socialAccounts: [], caption: '', scheduledAt: null };
          latest.set(pid, fallback);
          settledPids.add(pid);
          _postResultCache.set(pid, { post: fallback, savedAt: Date.now() });
          _saveCacheToDisk();
        }
      }
    }

    const allPosts = postIds.map((id) => latest.get(id) ?? null).filter(Boolean);
    const allAcc = allPosts.flatMap((p) => p?.socialAccounts ?? []);
    const reportAcc = allAcc.length > 0 ? allAcc : getCachePendingAccs();

    if (onProgress) {
      const toInfo = (a) => ({ username: a.username, network: a.network, error: a.error ?? null });
      onProgress({
        published: reportAcc.filter((a) => a.status === 'published').length,
        failed: reportAcc.filter((a) => a.status === 'failed').length,
        pending: reportAcc.filter((a) => a.status === 'pending').length,
        total: reportAcc.length,
        elapsedMs: Date.now() - startMs,
        publishedAccounts: reportAcc.filter((a) => a.status === 'published').map(toInfo),
        failedAccounts: reportAcc.filter((a) => a.status === 'failed').map(toInfo),
        pendingAccounts: reportAcc.filter((a) => a.status === 'pending').map(toInfo),
      });
    }

    // Settled hanya ketika SEMUA post sudah 404 dari endpoint social-posts
    if (postIds.every((id) => settledPids.has(id))) return allPosts;

    await sleep(interval);
  }

  // Timeout: kembalikan post terbaik, fallback ke cached post dengan status pending
  return postIds.map((id) => {
    const live = latest.get(id);
    if (live?.socialAccounts?.length) return live;
    const entry = _postResultCache.get(id);
    if (entry?.post) {
      return {
        ...entry.post,
        status: 'pending',
        socialAccounts: entry.post.socialAccounts.map((a) => ({ ...a, status: 'pending' })),
      };
    }
    return live ?? null;
  }).filter(Boolean);
}

export async function cancelPost(postId) {
  try {
    await client.delete(`/v1/social-posts/${postId}`);
    return true;
  } catch (err) {
    log.warn({ postId, err: err.message }, `[PostForme] cancelPost gagal: ${err.message}`);
    return false;
  }
}

export async function listRecentPostIds({ daysBack = 1, date } = {}) {
  try {
    const since = new Date(Date.now() - Math.max(daysBack, 3) * 86_400_000).toISOString();
    const res = await client.get('/v1/social-posts', {
      params: { limit: 50, created_after: since },
    });
    const body = res.data;
    const posts = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];

    if (date) {
      // PostForme API may ignore created_after — filter client-side by WIB calendar date
      const filtered = posts.filter((p) => {
        const ts = p.created_at || p.scheduled_at || p.published_at || p.updated_at || '';
        if (!ts) return true;
        const wibDay = new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        return wibDay === date;
      });
      log.info({ date, total: posts.length, filtered: filtered.length }, '[PostForme] listRecentPostIds client-side date filter');
      return filtered.map((p) => String(p.id)).filter(Boolean);
    }

    return posts.map((p) => String(p.id)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function fetchCaptionFromPostIds(postIds) {
  for (const id of postIds || []) {
    try {
      const post = await getPost(id);
      if (post?.caption) return post.caption;
    } catch { /* coba id berikutnya */ }
  }
  return '';
}

// ─── Analytics ───────────────────────────────────────────────────────────────

/**
 * Ambil feed + metrics untuk satu akun sosial.
 * @param {string} socialAccountId
 * @returns {Promise<{ metrics: object|null, feed: object[] }>}
 */
/**
 * Ambil feed recent posts untuk satu akun sosial.
 * Response: array of { platform_url, platform_post_id, caption, posted_at, social_post_id, ... }
 * @param {string} socialAccountId
 * @returns {Promise<object[]>}
 */
export async function getAccountFeed(socialAccountId) {
  try {
    const res = await client.get(`/v1/social-account-feeds/${socialAccountId}`, {
      params: { expand: 'metrics' },
    });
    const data = res.data?.data;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    log.warn({ socialAccountId, err: err.message }, '[PostForme] getAccountFeed gagal');
    return [];
  }
}

/**
 * Ambil metrics untuk beberapa akun sekaligus (throttled).
 * @param {string[]} socialAccountIds
 * @returns {Promise<Map<string, { metrics: object|null, feed: object[] }>>}
 */
export async function getMultiAccountFeed(socialAccountIds) {
  const result = new Map();
  for (const id of socialAccountIds) {
    await sleep(400);
    result.set(id, await getAccountFeed(id));
  }
  return result;
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

/**
 * Generate OAuth URL untuk connect akun sosial ke PostForme.
 * @param {{ platform: string, redirectUrl?: string, externalId?: string }} opts
 * @returns {Promise<string>} URL OAuth yang dikirim ke user
 */
export async function generateOAuthUrl({ platform, redirectUrl, externalId, connectionType }) {
  const platformKey = toPlatform(platform);
  const payload = {
    platform: platformKey,
    ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
    ...(externalId ? { external_id: String(externalId) } : {}),
    ...(connectionType ? {
      platform_data: { [platformKey]: { connection_type: connectionType } },
      permissions: ['posts', 'feeds'],
    } : {}),
  };

  // redirect_url wajib di PostForme
  if (!payload.redirect_url) {
    payload.redirect_url = 'https://t.me/';
  }

  log.info({ payload }, '[PostForme] generateOAuthUrl payload');

  try {
    const res = await client.post('/v1/social-accounts/auth-url', payload);
    const body = res.data?.data ?? res.data;
    const url = body?.auth_url ?? body?.url ?? body?.redirect_url;
    if (!url || typeof url !== 'string') {
      throw new Error(`PostForme tidak mengembalikan auth URL untuk platform: ${platform}`);
    }
    return url;
  } catch (err) {
    const detail = formatError(err);
    const status = err.response?.status ?? '';
    throw new Error(`PostForme OAuth gagal (${status}): ${detail}`);
  }
}

// Platform yang didukung untuk OAuth.
// cbKey = suffix callback Telegram (harus unik); connectionType = opsional field PostForme.
export const POSTFORME_PLATFORMS = [
  { cbKey: 'ig_fb',      key: 'instagram', label: 'Instagram (via Facebook)',  connectionType: 'facebook'  },
  { cbKey: 'ig_ig',      key: 'instagram', label: 'Instagram (Login Langsung)', connectionType: 'instagram' },
  { cbKey: 'tiktok',     key: 'tiktok',    label: 'TikTok' },
  { cbKey: 'facebook',   key: 'facebook',  label: 'Facebook' },
  { cbKey: 'threads',    key: 'threads',   label: 'Threads' },
  { cbKey: 'youtube',    key: 'youtube',   label: 'YouTube' },
  { cbKey: 'x',          key: 'x',         label: 'X / Twitter' },
  { cbKey: 'linkedin',   key: 'linkedin',  label: 'LinkedIn' },
  { cbKey: 'bluesky',    key: 'bluesky',   label: 'Bluesky' },
  { cbKey: 'pinterest',  key: 'pinterest', label: 'Pinterest' },
];
