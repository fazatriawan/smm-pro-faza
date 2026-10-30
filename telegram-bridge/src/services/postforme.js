import axios from 'axios';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { env } from '../config/env.js';
import { downloadFile } from './drive.js';
import { buildCaptionsByNetwork } from './captionPlatforms.js';
import { generateCaptionVariations } from './ai.js';
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
let _accountsInflight = null;
const ACCOUNTS_CACHE_TTL_MS = 15 * 60 * 1000;

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
  if (_accountsInflight) return _accountsInflight;
  _accountsInflight = listSocialAccounts()
    .then((data) => {
      _accountsCache = data;
      _accountsCacheTime = Date.now();
      _accountsInflight = null;
      return data;
    })
    .catch((err) => {
      _accountsInflight = null;
      throw err;
    });
  return _accountsInflight;
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
  const fbSamples = connected.filter((a) => (a.platform ?? a.type ?? '').toLowerCase() === 'facebook').slice(0, 3);
  if (fbSamples.length) {
    log.info({ samples: fbSamples.map((a) => ({ id: a.id, username: a.username, name: a.name, page_id: a.page_id, pageId: a.pageId, user_id: a.user_id, platform_id: a.platform_id, external_id: a.external_id })) }, '[PostForme] Facebook account raw fields');
  }

  const mapped = connected
    .map((a) => {
      const network = toNetwork(a.platform ?? a.type ?? a.provider ?? '');
      const pageId = network === 'facebook'
        ? (a.page_id ?? a.pageId ?? a.user_id ?? a.platform_id ?? a.external_id ?? null)
        : (a.page_id ?? a.pageId ?? null);
      const externalId = String(a.external_id ?? a.platform_id ?? a.provider_id ?? '');
      return {
        id: String(a.id ?? ''),
        externalId: externalId || undefined,
        network,
        username: a.username ?? a.name ?? a.handle ?? a.display_name ?? '',
        // handle: TikTok real username (bisa berbeda dari display name yang ada spasi)
        handle: a.handle ?? null,
        pageId,
      };
    })
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
  let createRes;
  try {
    createRes = await client.post('/v1/media/create-upload-url', {
      filename,
      content_type: mimeType,
      size: buffer.length,
    });
  } catch (err) {
    throw new Error(`Upload media gagal: ${formatError(err)}`);
  }
  const raw = createRes.data;
  const meta = raw?.data ?? raw;
  log.info({ meta }, '[PostForme] create-upload-url response');

  const uploadUrl = meta?.upload_url ?? meta?.uploadUrl ?? meta?.signed_url;
  if (!uploadUrl) throw new Error('PostForme: tidak mendapat upload_url dari API');

  // Step 2: PUT binary ke signed URL — retry pada 524/timeout (Cloudflare proxy)
  for (let putAttempt = 0; putAttempt < 3; putAttempt++) {
    try {
      await axios.put(uploadUrl, buffer, {
        headers: { 'Content-Type': mimeType },
        timeout: 300_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      break;
    } catch (putErr) {
      const putStatus = putErr.response?.status;
      const isRetryable =
        putStatus === 524 || putStatus === 502 || putStatus === 503 || putStatus === 504 ||
        putErr.code === 'ECONNRESET' || putErr.code === 'ETIMEDOUT' || putErr.code === 'ECONNABORTED';
      if (isRetryable && putAttempt < 2) {
        log.warn({ attempt: putAttempt + 1, status: putStatus, code: putErr.code }, '[PostForme] PUT media timeout — retry');
        await sleep(5000 * (putAttempt + 1));
        continue;
      }
      throw new Error(`Upload binary ke signed URL gagal: ${putErr.message}`);
    }
  }

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
export async function uploadMediaForTargets(driveMediaFiles, socialAccountIds, opts = {}) {
  const { carouselMode = false } = opts;
  const allAccounts = await listSocialAccounts();
  const byNet = groupAccountsByNetwork(socialAccountIds, allAccounts);
  const networks = Object.keys(byNet);

  const hasVideo = driveMediaFiles.some((f) => f.mimeType?.startsWith('video/'));
  const images = driveMediaFiles.filter((f) => f.mimeType?.startsWith('image/'));
  // Carousel mode: upload gambar langsung tanpa konversi ke video
  const convertNetworks = carouselMode
    ? []
    : networksNeedingImageToVideo(networks, hasVideo, images.length > 0);

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

  // Semua platform: kirim max 5 akun per PostForme call dengan variasi caption per kelompok.
  // TikTok: jeda 1 menit antar kelompok. Platform lain: jeda 300ms.
  const VARIATION_CHUNK_SIZE = 5;
  const TIKTOK_CHUNK_DELAY_MS = 60_000;

  const postIds = [];
  const results = [];
  let callIdx = 0;

  for (const [caption, accts] of captionGroups) {
    if (!accts.length) continue;

    const subBatches = Array.from(
      { length: Math.ceil(accts.length / VARIATION_CHUNK_SIZE) },
      (_, i) => accts.slice(i * VARIATION_CHUNK_SIZE, (i + 1) * VARIATION_CHUNK_SIZE)
    );
    if (!subBatches.length) continue;

    // Generate variasi caption untuk semua kelompok (1 AI call, hasilnya di-cache)
    const captionVariants = await generateCaptionVariations(caption, subBatches.length)
      .catch(() => Array(subBatches.length).fill(caption));

    for (let bi = 0; bi < subBatches.length; bi++) {
      const bAccts = subBatches[bi];
      const prevHasTiktok = bi > 0 && subBatches[bi - 1].some((a) => (a.network || '').toLowerCase() === 'tiktok');
      const curHasTiktok  = bAccts.some((a) => (a.network || '').toLowerCase() === 'tiktok');

      if (callIdx > 0 || bi > 0) {
        await sleep(prevHasTiktok && curHasTiktok ? TIKTOK_CHUNK_DELAY_MS : 300);
      }

      const mediaObjects = mediaUrls.map((url) => ({ url }));
      const payload = {
        caption: captionVariants[bi] ?? caption,
        social_accounts: bAccts.map((a) => a.id),
        ...(mediaObjects.length ? { media: mediaObjects } : {}),
        ...(schedule ? { scheduled_at: schedule } : {}),
      };
      if (bi === 0) {
        log.info({ mediaUrls, payloadMedia: payload.media, accountCount: bAccts.length }, '[PostForme] publishBulk payload media');
      }
      if (subBatches.length > 1) {
        log.info({ chunk: bi + 1, total: subBatches.length, accounts: bAccts.length, network: bAccts[0]?.network }, '[PostForme] caption variant chunk');
      }

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
            _postResultCache.set(postId, { post: buildCachedPost(postId, bAccts), savedAt: Date.now() });
            _saveCacheToDisk();
          }
          for (const a of bAccts) {
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
            { postId, accounts: bAccts.length },
            `[PostForme] Post dibuat: ${postId} (${bAccts.length} akun)`
          );
        } catch (err) {
          const status = err.response?.status;
          if (status === 429 && attempt < 2) {
            const retryAfter = Number(err.response?.headers?.['retry-after'] || 5);
            log.warn({ attempt, retryAfter }, '[PostForme] 429 rate limit — retry');
            await sleep(retryAfter * 1000);
            continue;
          }
          // Retry pada 524/502/503/504 (Cloudflare gateway timeout dari PostForme)
          if ((status === 524 || status === 502 || status === 503 || status === 504) && attempt < 2) {
            log.warn({ attempt, status }, '[PostForme] gateway timeout — retry');
            await sleep(5000 * (attempt + 1));
            continue;
          }
          throw new Error(`Publish PostForme gagal: ${formatError(err)}`);
        }
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
    const PAGE_SIZE = 100; // PostForme max limit=100
    const CHUNK_SIZE = 20; // NestJS terima repeated key: post_id=val1&post_id=val2
    const paramsSerializer = (params) => {
      const parts = [];
      for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) {
          // NestJS style: post_id=val1&post_id=val2 (tanpa brackets)
          for (const val of v) parts.push(`${k}=${encodeURIComponent(val)}`);
        } else {
          parts.push(`${k}=${encodeURIComponent(v)}`);
        }
      }
      return parts.join('&');
    };

    const allItems = [];
    // Coba semua ID sekaligus dulu; kalau 400, coba per-chunk
    const chunks = [];
    if (ids.length <= CHUNK_SIZE) {
      chunks.push(ids);
    } else {
      // Coba batch besar dulu sekali
      try {
        let page = 1;
        while (true) {
          const res = await client.get('/v1/social-post-results', {
            params: { post_id: ids, limit: PAGE_SIZE, page },
            paramsSerializer,
          });
          const body = res.data;
          const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
          allItems.push(...items);
          if (items.length < PAGE_SIZE) break;
          page++;
          if (page > 10) break;
        }
      } catch (batchErr) {
        const status = batchErr?.response?.status ?? 0;
        if (status === 400 || status === 422) {
          // Batch ditolak — fallback ke chunk kecil
          const errBody = batchErr?.response?.data;
          log.warn({ count: ids.length, errBody }, `[PostForme] getPostResultsBatch ${status} — fallback chunk ${CHUNK_SIZE}`);
          for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE));
        } else {
          throw batchErr;
        }
      }
      // Batch 200 tapi kosong — API mungkin abaikan filter untuk banyak ID; fallback ke chunk
      if (!allItems.length && !chunks.length) {
        log.warn({ count: ids.length }, '[PostForme] getPostResultsBatch batch kosong — fallback chunk kecil');
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE));
      }
    }

    // Proses chunk yang perlu di-fetch
    for (const chunk of chunks) {
      try {
        let page = 1;
        while (true) {
          const res = await client.get('/v1/social-post-results', {
            params: { post_id: chunk, limit: PAGE_SIZE, page },
            paramsSerializer,
          });
          const body = res.data;
          const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
          allItems.push(...items);
          if (items.length < PAGE_SIZE) break;
          page++;
          if (page > 10) break;
        }
      } catch (chunkErr) {
        const chunkStatus = chunkErr?.response?.status ?? 0;
        if (chunkStatus === 400 || chunkStatus === 404) {
          // Post mungkin sudah dihapus PostForme — skip chunk ini, lanjut ke cache fallback
          log.warn({ chunkSize: chunk.length, status: chunkStatus }, `[PostForme] chunk ${chunkStatus} — skip (post mungkin sudah dihapus)`);
        } else {
          throw chunkErr;
        }
      }
    }

    if (!allItems.length) {
      // API tidak punya hasil — cek cache disk (PostForme hapus data setelah diproses)
      const fromCache = new Map();
      for (const id of ids) {
        const entry = _postResultCache.get(id);
        if (entry?.post?.socialAccounts?.length) {
          fromCache.set(id, entry.post.socialAccounts);
        }
      }
      if (fromCache.size > 0) {
        log.info({ count: fromCache.size, total: ids.length }, '[PostForme] getPostResultsBatch kosong — pakai cache disk');
        return fromCache;
      }
      return new Map();
    }

    const accts = await getCachedAccounts();
    const acctMap = new Map(accts.map((a) => [a.id, a]));

    /** @type {Map<string, Array>} */
    const byPostId = new Map();
    for (const r of allItems) {
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
    // Deduplikasi per post: satu entri per social_account_id (ambil status terbaik)
    // API bisa mengembalikan akun yang sama berkali-kali via pagination
    // Tiebreaker saat status sama: pilih entry yang punya url/platformPostId
    const _rank = { published: 3, failed: 2, pending: 1 };
    for (const [pid, accList] of byPostId) {
      const best = new Map();
      for (const acc of accList) {
        const key = acc.id || `${acc.network}:${acc.username}`;
        const existing = best.get(key);
        const newRank = _rank[acc.status] ?? 1;
        const oldRank = existing ? (_rank[existing.status] ?? 1) : -1;
        const newHasUrl = !!(acc.url || acc.platformPostId);
        const oldHasUrl = !!(existing?.url || existing?.platformPostId);
        if (!existing || newRank > oldRank || (newRank === oldRank && newHasUrl && !oldHasUrl)) {
          best.set(key, acc);
        }
      }
      byPostId.set(pid, [...best.values()]);
    }

    // Untuk postId yang tidak ada di hasil API, tambahkan dari cache disk
    for (const id of ids) {
      if (!byPostId.has(id)) {
        const entry = _postResultCache.get(id);
        if (entry?.post?.socialAccounts?.length) {
          byPostId.set(id, entry.post.socialAccounts);
        }
      }
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
    const accts = await getCachedAccounts();
    const acctMap = new Map(accts.map((a) => [a.id, a]));
    // Secondary: external_id / platform_id fallback (kalau social_account_id pakai format berbeda)
    const acctByExternal = new Map(accts.filter((a) => a.externalId).map((a) => [a.externalId, a]));

    let mismatches = 0;
    const mapped = items.map((r) => {
      const sid = String(r.social_account_id ?? '');
      const acct = acctMap.get(sid) ?? acctByExternal.get(sid);
      if (!acct) mismatches++;
      const status = r.success === true ? 'published' : r.error ? 'failed' : 'pending';
      return {
        id: sid,
        network: acct?.network ?? r.network ?? '',
        username: acct?.username ?? r.username ?? r.account_username ?? '',
        status,
        platformPostId: r.platform_data?.id ?? null,
        url: r.platform_data?.url ?? '',
        error: r.error ?? null,
      };
    });
    if (mismatches > 0) {
      log.warn({
        postId,
        total: items.length,
        mismatches,
        sampleSocialIds: items.slice(0, 3).map((r) => r.social_account_id),
        sampleCacheIds: accts.slice(0, 3).map((a) => a.id),
      }, '[PostForme] getPostResults: social_account_id tidak cocok dengan cache — username/network mungkin kosong');
    }
    return mapped;
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
    // Satu batch call untuk semua account results — ganti N individual getPostResults calls
    let batchResults = new Map();
    try {
      batchResults = await getPostResultsBatch(postIds);
    } catch (batchErr) {
      const bs = batchErr?.response?.status;
      log.warn({ status: bs }, '[PostForme] waitForPostsSettled batch error — tunggu interval');
      await sleep(interval);
      continue;
    }

    // Update latest dengan hasil batch
    for (const [pid, socialAccounts] of batchResults) {
      if (!socialAccounts.length) continue;
      const existing = latest.get(pid);
      latest.set(pid, {
        id: pid,
        status: 'pending',
        socialAccounts,
        caption: existing?.caption ?? '',
        scheduledAt: null,
      });
    }

    // Cek settlement status per post (404 = PostForme hapus = semua selesai).
    // Saat 429, langsung keluar loop — jangan tunggu 3s per post.
    let rateLimited = false;
    for (const pid of postIds) {
      if (settledPids.has(pid) || rateLimited) continue;
      await sleep(150);
      try {
        const r = await client.get(`/v1/social-posts/${pid}`);
        const body = r.data?.data ?? r.data;
        const rawStatus = (body?.status || '').toLowerCase();
        const isDone = rawStatus === 'success' || rawStatus === 'processed' || rawStatus === 'published';
        if (isDone) {
          // batchResults seringkali kosong (endpoint batch mungkin tidak support filter) —
          // ambil hasil nyata per-post dari getPostResults sebelum simpan ke cache
          let accs = batchResults.get(pid) ?? latest.get(pid)?.socialAccounts ?? [];
          if (!accs.length) {
            accs = await getPostResults(pid).catch(() => []);
          }
          const settled = {
            id: pid, status: 'published',
            socialAccounts: accs.map((a) => ({ ...a, status: a.status === 'failed' ? 'failed' : 'published' })),
            caption: '', scheduledAt: null,
          };
          latest.set(pid, settled);
          settledPids.add(pid);
          _postResultCache.set(pid, { post: settled, savedAt: Date.now() });
          _saveCacheToDisk();
        }
      } catch (err) {
        const errStatus = err.response?.status;
        if (errStatus === 404) {
          const cached = _postResultCache.get(pid);
          // Coba getPostResults dulu untuk data nyata — lebih baik dari cache kosong
          let accs = batchResults.get(pid) ?? cached?.post?.socialAccounts ?? [];
          if (!accs.length) {
            accs = await getPostResults(pid).catch(() => []);
          }
          const fallback = {
            id: pid, status: 'published',
            socialAccounts: accs.map((a) => ({ ...a, status: 'published' })),
            caption: '', scheduledAt: null,
          };
          latest.set(pid, fallback);
          settledPids.add(pid);
          _postResultCache.set(pid, { post: fallback, savedAt: Date.now() });
          _saveCacheToDisk();
        } else if (errStatus === 429) {
          rateLimited = true; // skip sisa post — tunggu interval
        }
        // error lain: lanjut ke post berikutnya
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

    if (postIds.every((id) => settledPids.has(id))) {
      return postIds.map((id) => latest.get(id)).filter(Boolean);
    }

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

/**
 * Resolve URL TikTok format /video/{id} ke /@username/video/{id} dengan mengikuti redirect.
 * Return URL yang sudah ada @username, atau null kalau gagal/diblokir.
 * @param {string} shortUrl
 * @returns {Promise<string|null>}
 */
export async function resolveTikTokVideoUrl(shortUrl, { timeout = 8000 } = {}) {
  if (!shortUrl || shortUrl.includes('/@')) return null;
  if (!/tiktok\.com\/video\/\d+/i.test(shortUrl)) return null;
  try {
    const res = await axios.get(shortUrl, {
      maxRedirects: 0,
      timeout,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    });
    const loc = String(res.headers?.location ?? '');
    const m = loc.match(/tiktok\.com\/@([^/?#]+)\/video\/(\d+)/i);
    if (m) return `https://www.tiktok.com/@${m[1]}/video/${m[2]}`;
  } catch (err) {
    // axios melempar error untuk 3xx kalau maxRedirects: 0 — ambil Location dari error response
    const loc = String(err.response?.headers?.location ?? '');
    const m = loc.match(/tiktok\.com\/@([^/?#]+)\/video\/(\d+)/i);
    if (m) return `https://www.tiktok.com/@${m[1]}/video/${m[2]}`;
  }
  return null;
}

/**
 * Batch-resolve URL TikTok /video/{id} secara parallel (max 5 concurrent, timeout 6s/akun).
 * Return Map: shortUrl → resolvedUrl (atau shortUrl asli kalau gagal).
 * @param {string[]} urls
 * @returns {Promise<Map<string, string>>}
 */
export async function batchResolveTikTokUrls(urls) {
  const toResolve = urls.filter((u) => /tiktok\.com\/video\/\d+/i.test(u) && !u.includes('/@'));
  const result = new Map(urls.map((u) => [u, u]));
  if (!toResolve.length) return result;

  const CONCURRENCY = 5;
  const failed = [];

  for (let i = 0; i < toResolve.length; i += CONCURRENCY) {
    const batch = toResolve.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(batch.map((u) => resolveTikTokVideoUrl(u)));
    for (let j = 0; j < batch.length; j++) {
      if (resolved[j]) result.set(batch[j], resolved[j]);
      else failed.push(batch[j]);
    }
  }

  // Retry sekali untuk yang gagal dengan timeout lebih panjang
  if (failed.length) {
    await new Promise((r) => setTimeout(r, 1000));
    for (let i = 0; i < failed.length; i += CONCURRENCY) {
      const batch = failed.slice(i, i + CONCURRENCY);
      const retried = await Promise.all(batch.map((u) => resolveTikTokVideoUrl(u, { timeout: 12000 })));
      for (let j = 0; j < batch.length; j++) {
        if (retried[j]) result.set(batch[j], retried[j]);
      }
    }
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
  { cbKey: 'tiktok_biz', key: 'tiktok',    label: 'TikTok Business', connectionType: 'business' },
  { cbKey: 'facebook',   key: 'facebook',  label: 'Facebook' },
  { cbKey: 'threads',    key: 'threads',   label: 'Threads' },
  { cbKey: 'youtube',    key: 'youtube',   label: 'YouTube' },
  { cbKey: 'x',          key: 'x',         label: 'X / Twitter' },
  { cbKey: 'linkedin',   key: 'linkedin',  label: 'LinkedIn' },
  { cbKey: 'bluesky',    key: 'bluesky',   label: 'Bluesky' },
  { cbKey: 'pinterest',  key: 'pinterest', label: 'Pinterest' },
];
