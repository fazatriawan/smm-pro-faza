import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env.js';
import { downloadFile } from './drive.js';
import { buildCaptionsByNetwork } from './captionPlatforms.js';
import { buildLivePostUrl } from '../utils/platformUrl.js';
import { varyCaption } from '../utils/captionVariant.js';
import {
  convertDriveImagesToSocialVideo,
  networksNeedingImageToVideo,
  normalizeVideoForTikTok,
  trimVideoStart,
} from './imageToVideo.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('woopsocial');

const BASE_URL = 'https://api.woopsocial.com';

// Cache project ID (fetched once from /v1/projects)
let _projectId = null;

// Cache social accounts (TTL 5 menit) untuk resolve socialAccountId → username
let _accountsCache = null;
let _accountsCacheTime = 0;
const ACCOUNTS_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getCachedAccounts() {
  if (_accountsCache && Date.now() - _accountsCacheTime < ACCOUNTS_CACHE_TTL_MS) {
    return _accountsCache;
  }
  _accountsCache = await listSocialAccounts();
  _accountsCacheTime = Date.now();
  return _accountsCache;
}

async function getProjectId() {
  if (_projectId) return _projectId;
  // Jika env WOOPSOCIAL_PROJECT_ID di-set, pakai langsung tanpa fetch API
  if (env.woopsocialProjectId) {
    _projectId = String(env.woopsocialProjectId);
    log.info({ projectId: _projectId }, '[Woopsocial] Project ID dari env');
    return _projectId;
  }
  const res = await client.get('/v1/projects');
  const body = parseResponseBody(res);
  const projects = Array.isArray(body) ? body : body?.data ?? [];
  if (!projects.length) throw new Error('Woopsocial: tidak ada project ditemukan');
  _projectId = String(projects[0].id);
  log.info({ projectId: _projectId, totalProjects: projects.length }, '[Woopsocial] Project ID cached dari API');
  return _projectId;
}

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${env.woopsocialApiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 120_000,
});

const NETWORK_TO_PLATFORM = {
  instagram: 'INSTAGRAM',
  threads: 'THREADS',
  facebook: 'FACEBOOK',
  twitter: 'X',
  x: 'X',
  tiktok: 'TIKTOK',
  youtube: 'YOUTUBE',
  linkedin: 'LINKEDIN',
};

const PLATFORM_TO_NETWORK = {};
for (const [k, v] of Object.entries(NETWORK_TO_PLATFORM)) {
  if (!PLATFORM_TO_NETWORK[v]) PLATFORM_TO_NETWORK[v] = k;
}

function parseResponseBody(res) {
  const body = res.data;
  if (body?.error_message || body?.error) {
    throw new Error(body.error_message || body.error || 'Woopsocial API error');
  }
  return body;
}

function formatError(err) {
  const data = err.response?.data;
  if (typeof data === 'string') return data;
  if (data?.error_message) return data.error_message;
  if (data?.error) return data.error;
  // Sertakan detail validasi jika ada (Woopsocial sering taruh di errors/details)
  const msg = data?.message || '';
  const details = data?.errors ?? data?.details ?? data?.validationErrors;
  if (details) {
    const detailStr = typeof details === 'string'
      ? details
      : JSON.stringify(details).slice(0, 400);
    return msg ? `${msg} — ${detailStr}` : detailStr;
  }
  if (msg) return msg;
  return err.message;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNetwork(platform) {
  return (
    PLATFORM_TO_NETWORK[(platform || '').toUpperCase()] ||
    (platform || '').toLowerCase()
  );
}

/**
 * postType Woopsocial per-platform. Mengembalikan null jika platform tidak butuh field ini.
 * @param {string} network
 * @param {Array<{mimeType?: string, filename?: string}>} mediaItems
 * @returns {string|null}
 */
function getPostType(network, mediaItems = []) {
  const hasVideo = mediaItems.some(
    (m) =>
      (m.mimeType || '').startsWith('video/') ||
      /\.(mp4|mov|avi|mkv|webm)$/i.test(m.filename || '')
  );
  switch (network) {
    case 'instagram':
      return hasVideo ? 'REEL' : 'POST';
    case 'facebook':
      return hasVideo ? 'VIDEO' : 'IMAGE';
    case 'tiktok':
      return hasVideo ? 'VIDEO' : 'PHOTO';
    default:
      return null; // X, Threads, LinkedIn, YouTube tidak butuh postType
  }
}

function groupAccountsByNetwork(accountIds, allAccounts) {
  const byId = new Map(allAccounts.map((a) => [a.id, a]));
  const seen = new Set();
  const byNet = {};
  for (const id of accountIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = byId.get(id);
    if (!a) continue;
    const net = a.network || 'unknown';
    if (!byNet[net]) byNet[net] = [];
    byNet[net].push(a);
  }
  return byNet;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function listSocialAccounts() {
  const projectId = await getProjectId();
  const res = await client.get('/v1/social-accounts', { params: { limit: 500, projectId } });
  const body = parseResponseBody(res);
  const allRaw = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body)
      ? body
      : body?.items ?? body?.accounts ?? [];

  const connected = allRaw.filter((a) => {
    const s = (a.status || '').toUpperCase();
    return s === 'CONNECTED' || s === 'ACTIVE';
  });

  log.info(
    { total: allRaw.length, connected: connected.length },
    '[Woopsocial] listSocialAccounts: raw dari API'
  );

  return connected
    .map((a) => ({
      id: String(a.id ?? ''),
      network: toNetwork(a.platform),
      username: a.username ?? a.name ?? '',
      pageId: a.pageId ?? a.facebookPageId ?? null,
    }))
    .filter((a) => a.id);
}

// ─── Media ───────────────────────────────────────────────────────────────────

/**
 * Upload media ke Woopsocial — single-step multipart POST ke /v1/media
 * @param {{ buffer: Buffer, filename: string, mimeType: string }} file
 */
export async function uploadMediaBuffer({ buffer, filename, mimeType }) {
  const projectId = await getProjectId();

  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimeType });

  const res = await client.post(`/v1/media?projectId=${projectId}`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 300_000,
  });

  const body = parseResponseBody(res);
  // Response: {"mediaId": "..."}
  const mediaId = String(body.mediaId ?? body.data?.mediaId ?? body.id ?? '');
  if (!mediaId) throw new Error('Woopsocial: media upload tidak mengembalikan mediaId');

  return {
    id: mediaId,
    url: body.url ?? body.publicUrl ?? '',
    filename: body.filename ?? filename,
    mimeType: body.mimeType ?? mimeType,
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
  throw new Error(`Media "${mediaFile.name || 'file'}" tanpa data.`);
}

export async function uploadMediaFromDrive(driveFile) {
  const { buffer, mimeType, name } = await resolveMediaBytes(driveFile);
  const filename = name.includes('.') ? name : `${name}.bin`;
  return uploadMediaBuffer({ buffer, filename, mimeType });
}

export async function uploadAllMediaFromDrive(driveMediaFiles) {
  const items = [];
  for (const file of driveMediaFiles) {
    try {
      const item = await uploadMediaFromDrive(file);
      items.push(item);
    } catch (err) {
      throw new Error(`Upload media "${file.name}" gagal: ${formatError(err)}`);
    }
  }
  return items;
}

/**
 * Upload media — untuk Woopsocial cukup sekali (satu request semua platform).
 * @param {Array<{ id?: string, name?: string, mimeType?: string, buffer?: Buffer }>} driveMediaFiles
 * @param {string[]} socialAccountIds
 */
export async function uploadMediaForTargets(driveMediaFiles, socialAccountIds) {
  const allAccounts = await listSocialAccounts();
  const byNet = groupAccountsByNetwork(socialAccountIds, allAccounts);
  const networks = Object.keys(byNet);

  const hasVideo = driveMediaFiles.some((f) => f.mimeType?.startsWith('video/'));
  const images = driveMediaFiles.filter((f) => f.mimeType?.startsWith('image/'));
  const convertNetworks = networksNeedingImageToVideo(networks, hasVideo, images.length > 0);

  let imageToVideoSilent = false;
  let uploadedMedia = [];

  if (convertNetworks.length) {
    if (!images.length) {
      throw new Error('Platform terpilih butuh video, atau gambar + musik latar (assets/audio/).');
    }
    const primaryNet = convertNetworks.includes('youtube') ? 'youtube' : convertNetworks[0] || 'reel';
    const video = await convertDriveImagesToSocialVideo(images, primaryNet);
    if (video.silent) imageToVideoSilent = true;
    const item = await uploadMediaBuffer({
      buffer: video.buffer,
      filename: video.name,
      mimeType: video.mimeType,
    });
    if (!item.id) throw new Error('Upload video (dari gambar) gagal — Woopsocial tidak mengembalikan mediaId');
    uploadedMedia = [item];
    log.info({ networks: convertNetworks }, `[Image→Video] Video untuk: ${convertNetworks.join(', ')}`);
  } else if (driveMediaFiles.length) {
    // Re-encode video ke 30fps CFR jika TikTok termasuk target
    const hasTikTok = networks.includes('tiktok');
    let filesToUpload = driveMediaFiles;
    let tiktokNormalizedBuffer = null;
    let tiktokNormalizedName = null;
    if (hasTikTok && hasVideo) {
      filesToUpload = await Promise.all(driveMediaFiles.map(async (f) => {
        if (!f.mimeType?.startsWith('video/')) return f;
        log.info({ name: f.name }, '[TikTok] Download + re-encode video ke 30fps CFR');
        // Download dari Drive dulu jika belum ada buffer
        const resolved = f.buffer
          ? { buffer: f.buffer, mimeType: f.mimeType, name: f.name }
          : await downloadFile(f.id);
        const normalized = await normalizeVideoForTikTok(resolved.buffer, resolved.name || f.name || 'video.mp4');
        tiktokNormalizedBuffer = normalized.buffer;
        tiktokNormalizedName = normalized.name;
        // Set buffer agar resolveMediaBytes tidak download ulang saat upload
        return { ...f, buffer: normalized.buffer, name: normalized.name, mimeType: normalized.mimeType };
      }));
    }
    uploadedMedia = await uploadAllMediaFromDrive(filesToUpload);

    // Simpan referensi buffer TikTok untuk dipakai publishBulk membuat varian
    if (tiktokNormalizedBuffer) {
      uploadedMedia._tiktokBuffer = tiktokNormalizedBuffer;
      uploadedMedia._tiktokName = tiktokNormalizedName;
    }
  }

  // Woopsocial satu request — semua network pakai media yang sama
  const byNetwork = {};
  for (const network of networks) {
    byNetwork[network] = uploadedMedia;
  }

  return {
    byNetwork,
    imageToVideoNetworks: convertNetworks,
    imageToVideoSilent,
    youtubeConverted: convertNetworks.includes('youtube'),
    youtubeSilent: imageToVideoSilent,
    tiktokNormalized: uploadedMedia._tiktokBuffer
      ? { buffer: uploadedMedia._tiktokBuffer, name: uploadedMedia._tiktokName }
      : null,
  };
}

// ─── Publish ─────────────────────────────────────────────────────────────────

/**
 * Publish ke semua platform dalam SATU request Woopsocial.
 * @param {{ baseCaption: string, captionsByNetwork?: Record<string,string>, youtubeFields?: object, mediaByNetwork: Record<string,Array>, scheduledAt?: string, socialAccountIds: string[] }} options
 */
const TIKTOK_VARIANT_BATCH = 15;

export async function publishBulk({
  baseCaption,
  captionsByNetwork: captionsByNetworkIn,
  mediaByNetwork,
  scheduledAt,
  socialAccountIds,
  tiktokVideoBuffer = null,
  tiktokVideoName = 'video-tiktok.mp4',
}) {
  const allAccounts = await listSocialAccounts();
  if (!allAccounts.length) throw new Error('Tidak ada akun terhubung di Woopsocial');
  if (!socialAccountIds?.length) throw new Error('Tidak ada akun target yang dipilih');

  const byNet = groupAccountsByNetwork(socialAccountIds, allAccounts);
  const networks = Object.keys(byNet);
  const captionsByNetwork =
    captionsByNetworkIn && Object.keys(captionsByNetworkIn).length
      ? captionsByNetworkIn
      : buildCaptionsByNetwork(baseCaption, networks);

  // Kumpulkan media unik dari semua network
  const seenIds = new Set();
  const allMedia = [];
  for (const net of networks) {
    for (const m of mediaByNetwork[net] ?? []) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        allMedia.push(m);
      }
    }
  }

  const schedule = scheduledAt
    ? { type: 'SCHEDULE_FOR_LATER', scheduledFor: scheduledAt }
    : { type: 'PUBLISH_NOW' };

  const mediaArray = allMedia.length
    ? allMedia.map((m) => ({ type: 'MEDIA_LIBRARY', mediaId: m.id }))
    : [];

  // ─── TikTok video variant: akun > TIKTOK_VARIANT_BATCH dipisah per sub-batch ─
  // Setiap sub-batch TikTok mendapat video yang sedikit di-trim dari awal agar
  // TikTok fingerprint berbeda, menghindari flag "unoriginal content".
  const tiktokAccts = byNet['tiktok'] || [];
  const hasTiktokVariants =
    tiktokVideoBuffer != null && tiktokAccts.length > TIKTOK_VARIANT_BATCH;
  const tiktokVariantIdSet = new Set(hasTiktokVariants ? tiktokAccts.map((a) => a.id) : []);
  if (hasTiktokVariants) {
    const numVariants = Math.ceil(tiktokAccts.length / TIKTOK_VARIANT_BATCH);
    log.info(
      { accounts: tiktokAccts.length, variants: numVariants, batchSize: TIKTOK_VARIANT_BATCH },
      '[TikTok] Video varian aktif'
    );
  }

  // ─── Split request per caption unik (variasi per-akun) ───────────────────
  // Setiap akun mendapat caption yang sedikit berbeda (rotasi hashtag + swap
  // emoji) agar tidak terdeteksi sebagai duplikat oleh platform.
  // Akun dengan caption identik tetap digabung dalam satu API call.
  const captionGroupMap = new Map(); // caption text → { networks[], accounts[] }
  let accountVariantIndex = 0;
  for (const [network, accts] of Object.entries(byNet)) {
    const platform = NETWORK_TO_PLATFORM[network];
    if (!platform) {
      log.warn(`[Woopsocial] Platform "${network}" tidak didukung — dilewati`);
      continue;
    }
    const baseCap = captionsByNetwork[network] || baseCaption;
    const postType = getPostType(network, allMedia);
    for (const acct of accts) {
      if (tiktokVariantIdSet.has(acct.id)) { accountVariantIndex++; continue; }
      const cap = varyCaption(baseCap, accountVariantIndex++);
      if (!captionGroupMap.has(cap)) captionGroupMap.set(cap, { networks: [], accounts: [] });
      const group = captionGroupMap.get(cap);
      if (!group.networks.includes(network)) group.networks.push(network);
      const entry = { platform, socialAccountId: acct.id };
      if (postType !== null) entry.postType = postType;
      if (network === 'tiktok') {
        entry.privacyLevel = 'PUBLIC_TO_EVERYONE';
        entry.allowComment = true;
        entry.allowDuet = true;
        entry.allowStitch = true;
        entry.isYourBrand = false;
        entry.isBrandedContent = false;
        entry.autoAddMusic = false;
      }
      group.accounts.push(entry);
    }
  }

  if (!captionGroupMap.size) {
    throw new Error('Tidak ada platform yang didukung Woopsocial di akun terpilih');
  }

  // ─── Kirim satu API call per group ───────────────────────────────────────
  const allPostIds = [];
  const allSummaryParts = [];
  let batchCallIdx = 0;

  for (const [cap, group] of captionGroupMap) {
    if (!group.accounts.length) continue;
    if (batchCallIdx > 0) await sleep(300);

    const contentItem = { text: cap };
    if (mediaArray.length) contentItem.media = mediaArray;

    const payload = { content: [contentItem], schedule, socialAccounts: group.accounts };
    const postTypeSummary = [...new Set(group.accounts.map((e) => `${e.platform}:${e.postType ?? 'none'}`))];

    log.info(
      {
        networks: group.networks,
        accountCount: group.accounts.length,
        mediaCount: allMedia.length,
        captionLen: cap.length,
        postTypes: postTypeSummary,
        sampleEntry: group.accounts[0],
      },
      '[Woopsocial] publishBulk — kirim ke API'
    );

    let posted = false;
    for (let attempt = 0; attempt < 3 && !posted; attempt++) {
      try {
        if (attempt > 0) await sleep(2000 * attempt);
        const projectId = await getProjectId();
        const res = await client.post(`/v1/posts?projectId=${projectId}`, payload);
        const body = parseResponseBody(res);
        const postId = String(body.data?.id ?? body.id ?? body.post?.id ?? '').trim();
        if (postId) allPostIds.push(postId);
        for (const net of group.networks) {
          allSummaryParts.push(`${net}: ${byNet[net]?.length ?? 0} akun`);
        }
        batchCallIdx++;
        posted = true;
      } catch (err) {
        const status = err.response?.status;
        if (status === 429 && attempt < 2) {
          log.warn({ attempt, networks: group.networks }, `[Woopsocial] 429 rate limit — retry ${attempt + 1}`);
          await sleep(3000 + attempt * 2000);
          continue;
        }
        log.error(
          {
            status,
            responseData: JSON.stringify(err.response?.data ?? {}).slice(0, 800),
            networks: group.networks,
            postTypes: postTypeSummary,
            mediaIds: allMedia.map((m) => m.id),
          },
          '[Woopsocial] publishBulk GAGAL'
        );
        throw new Error(`Publish Woopsocial gagal: ${formatError(err)}`);
      }
    }
  }

  // ─── TikTok variant sub-batches ──────────────────────────────────────────
  if (hasTiktokVariants) {
    const baseCap = captionsByNetwork['tiktok'] || baseCaption;
    const tiktokPostType = getPostType('tiktok', allMedia);

    for (let bStart = 0; bStart < tiktokAccts.length; bStart += TIKTOK_VARIANT_BATCH) {
      const batchAccts = tiktokAccts.slice(bStart, bStart + TIKTOK_VARIANT_BATCH);
      const variantIdx = Math.floor(bStart / TIKTOK_VARIANT_BATCH);

      // Varian 0 = media sudah terupload; varian 1+ = trim baru + upload baru
      let variantMediaArray;
      if (variantIdx === 0) {
        variantMediaArray = mediaArray; // pakai mediaArray asli
      } else {
        const trimOffset = variantIdx * 0.1;
        log.info({ variantIdx, trimOffset }, '[TikTok] Trim video untuk varian');
        if (batchCallIdx > 0) await sleep(300);
        const trimmed = await trimVideoStart(tiktokVideoBuffer, tiktokVideoName, trimOffset);
        const uploaded = await uploadMediaBuffer({
          buffer: trimmed.buffer,
          filename: trimmed.name,
          mimeType: 'video/mp4',
        });
        batchCallIdx++;
        variantMediaArray = [{ type: 'MEDIA_LIBRARY', mediaId: uploaded.id }];
      }

      // Caption groups untuk batch ini
      const batchCaptionMap = new Map();
      for (const acct of batchAccts) {
        const cap = varyCaption(baseCap, accountVariantIndex++);
        if (!batchCaptionMap.has(cap)) batchCaptionMap.set(cap, []);
        const entry = {
          platform: 'TIKTOK',
          socialAccountId: acct.id,
          privacyLevel: 'PUBLIC_TO_EVERYONE',
          allowComment: true,
          allowDuet: true,
          allowStitch: true,
          isYourBrand: false,
          isBrandedContent: false,
          autoAddMusic: false,
        };
        if (tiktokPostType !== null) entry.postType = tiktokPostType;
        batchCaptionMap.get(cap).push(entry);
      }

      for (const [cap, entries] of batchCaptionMap) {
        if (!entries.length) continue;
        if (batchCallIdx > 0) await sleep(300);

        const contentItem = { text: cap };
        if (variantMediaArray.length) contentItem.media = variantMediaArray;
        const payload = { content: [contentItem], schedule, socialAccounts: entries };

        log.info(
          { variant: variantIdx + 1, accountCount: entries.length },
          '[TikTok] Kirim varian ke Woopsocial API'
        );

        let posted = false;
        for (let attempt = 0; attempt < 3 && !posted; attempt++) {
          try {
            if (attempt > 0) await sleep(2000 * attempt);
            const projectId = await getProjectId();
            const res = await client.post(`/v1/posts?projectId=${projectId}`, payload);
            const body = parseResponseBody(res);
            const postId = String(body.data?.id ?? body.id ?? body.post?.id ?? '').trim();
            if (postId) allPostIds.push(postId);
            allSummaryParts.push(`tiktok-v${variantIdx + 1}: ${batchAccts.length} akun`);
            batchCallIdx++;
            posted = true;
          } catch (err) {
            const status = err.response?.status;
            if (status === 429 && attempt < 2) {
              log.warn({ attempt, variant: variantIdx }, `[TikTok] 429 rate limit varian — retry ${attempt + 1}`);
              await sleep(3000 + attempt * 2000);
              continue;
            }
            log.error(
              { status, variant: variantIdx, responseData: JSON.stringify(err.response?.data ?? {}).slice(0, 400) },
              '[TikTok] Varian GAGAL'
            );
            throw new Error(`Publish TikTok varian ${variantIdx + 1} gagal: ${formatError(err)}`);
          }
        }
      }
    }
  }

  return {
    postIds: allPostIds,
    accountCount: socialAccountIds.length,
    uniqueAccountCount: new Set(socialAccountIds).size,
    batchCount: captionGroupMap.size,
    summary: allSummaryParts,
    captionsByNetwork,
  };
}

// ─── Post status ─────────────────────────────────────────────────────────────

function normalizeStatus(raw) {
  const s = (raw || '').toString().toUpperCase();
  if (['PUBLISHED', 'SUCCESS', 'LIVE', 'DONE'].includes(s)) return 'published';
  if (['FAILED', 'ERROR', 'REJECTED'].includes(s)) return 'failed';
  return 'pending';
}

function normalizeSocialAccount(a, accountsById = new Map()) {
  const network = toNetwork(a.platform || a.network || '');
  const info = accountsById.get(String(a.socialAccountId ?? ''));
  const username = a.username ?? a.name ?? a.socialUsername ?? a.handle ?? a.displayName ?? a.accountName ?? info?.username ?? '';
  const platformPostId = a.externalPostId ?? a.platformPostId ?? null;
  const directUrl = a.externalPostUrl ?? a.url ?? a.postUrl ?? null;
  const built = buildLivePostUrl(network, username, platformPostId, directUrl, null);
  return {
    id: String(a.socialAccountId ?? a.id ?? a.socialAccountPostId ?? ''),
    network,
    username,
    status: normalizeStatus(a.deliveryStatus ?? a.status),
    error: a.error ?? a.errorMessage ?? null,
    platformPostId,
    pageId: a.pageId ?? null,
    url: built || directUrl || null,
    publishedAt: a.publishedAt ?? null,
  };
}

function extractCaption(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const content = raw.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      const t = c?.text ?? c?.caption;
      if (t && String(t).trim()) return String(t).trim();
    }
  }
  for (const key of ['caption', 'content', 'text', 'description']) {
    const v = raw[key];
    if (v && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function normalizePost(raw, accountsById = new Map()) {
  if (!raw) return null;
  const accounts = raw.socialAccountPosts ?? raw.socialAccounts ?? raw.accounts ?? raw.targets ?? [];
  return {
    id: String(raw.id ?? raw.postId ?? ''),
    caption: extractCaption(raw),
    publishedAt: raw.publishedAt ?? null,
    scheduledAt: raw.scheduledAt ?? raw.scheduledFor ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    socialAccounts: accounts.map((a) => normalizeSocialAccount(a, accountsById)),
  };
}

export async function getPost(postId) {
  try {
    const res = await client.get(`/v1/posts/${postId}`);
    const body = parseResponseBody(res);
    const raw = body.data ?? body.post ?? body;
    const accounts = await getCachedAccounts();
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    return normalizePost(raw, accountsById);
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

export async function fetchCaptionFromPostIds(postIds) {
  for (const id of (postIds || []).filter(Boolean)) {
    try {
      const res = await client.get(`/v1/posts/${id}`);
      const body = parseResponseBody(res);
      const raw = body.data ?? body.post ?? body;
      const cap = extractCaption(raw);
      if (cap) return cap;
    } catch (err) {
      log.warn({ postId: id }, `[Woopsocial] fetchCaption ${id}: ${err.message}`);
    }
  }
  return '';
}

export async function cancelOutstandPost(postId) {
  const id = String(postId || '').trim();
  if (!id) throw new Error('Post ID kosong');
  try {
    const res = await client.delete(`/v1/posts/${id}`);
    const body = parseResponseBody(res);
    return { success: body.success !== false, message: body.message || 'Post cancelled', attempts: 1 };
  } catch (err) {
    if (err.response?.status === 404) throw new Error(`Post ID tidak ditemukan (\`${id}\`).`);
    if (err.response?.status === 403) throw new Error(`Tidak diizinkan (\`${id}\`) — cek API key.`);
    throw new Error(formatError(err));
  }
}

// ─── Polling ─────────────────────────────────────────────────────────────────

export async function waitForPostsSettled(postIds, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const onProgress = options.onProgress;
  const startMs = Date.now();
  const deadline = startMs + maxWaitMs;
  const latest = new Map();

  while (Date.now() < deadline) {
    let allSettled = true;
    for (const postId of postIds) {
      try {
        const post = await getPost(postId);
        if (post) latest.set(postId, post);
        const accounts = post?.socialAccounts ?? [];
        if (!accounts.length) { allSettled = false; continue; }
        if (accounts.some((a) => a.status === 'pending')) allSettled = false;
      } catch (err) {
        log.warn({ postId }, `[Woopsocial] poll ${postId}: ${err.message}`);
        allSettled = false;
      }
    }

    if (onProgress) {
      const allAcc = [...latest.values()].flatMap((p) => p?.socialAccounts ?? []);
      const toInfo = (a) => ({ username: a.username, network: a.network, error: a.error ?? null });
      onProgress({
        published: allAcc.filter((a) => a.status === 'published').length,
        failed: allAcc.filter((a) => a.status === 'failed').length,
        pending: allAcc.filter((a) => a.status === 'pending').length,
        total: allAcc.length,
        elapsedMs: Date.now() - startMs,
        publishedAccounts: allAcc.filter((a) => a.status === 'published').map(toInfo),
        failedAccounts: allAcc.filter((a) => a.status === 'failed').map(toInfo),
        pendingAccounts: allAcc.filter((a) => a.status === 'pending').map(toInfo),
      });
    }

    if (allSettled && postIds.every((id) => latest.get(id)?.socialAccounts?.length)) break;
    await sleep(intervalMs);
  }

  return postIds.map((id) => latest.get(id) ?? null);
}

const STATUS_ICON = { published: '✅', failed: '❌', pending: '⏳' };

export function formatPostStatusReport(posts, options = {}) {
  const lines = [];
  let published = 0, failed = 0, pending = 0;

  for (const post of posts) {
    if (!post) { lines.push('❓ Post tidak ditemukan di Woopsocial'); continue; }
    if (posts.length > 1) lines.push(`\nPost ID: ${post.id}`);

    for (const acct of post.socialAccounts) {
      const icon = STATUS_ICON[acct.status] ?? '⏳';
      const user = acct.username ? `@${acct.username.replace(/^@/, '')}` : acct.id;
      const net = acct.network || 'unknown';

      if (acct.status === 'published') published += 1;
      else if (acct.status === 'failed') failed += 1;
      else pending += 1;

      let line = `${icon} ${net} ${user}: ${acct.status}`;
      if (acct.status === 'published' && acct.url) line += `\n   🔗 ${acct.url}`;
      if (acct.status === 'failed' && acct.error) line += `\n   ⚠️ ${acct.error}`;
      lines.push(line);
    }
  }

  const header =
    failed > 0 && published === 0 ? '❌ Publish gagal di platform'
      : pending > 0 && published === 0 && failed === 0 ? '⏳ Publish masih diproses Woopsocial'
        : failed > 0 ? '⚠️ Publish sebagian berhasil'
          : published > 0 ? '✅ Post sudah live'
            : '⏳ Status publish belum pasti';

  const summary = `Ringkasan: ${published} live · ${failed} gagal · ${pending} pending`;
  const footer = options.timedOut
    ? '\n\n💡 Masih pending? Cek dashboard Woopsocial atau tunggu sebentar.'
    : failed > 0
      ? '\n\n💡 Jika gagal: reconnect akun di Woopsocial, pastikan IG Business terhubung.'
      : '';

  return `${header}\n${summary}\n${lines.join('\n')}${footer}`;
}

/**
 * Ambil Post ID dari Woopsocial API untuk tab harian tertentu.
 * tabName format: "2026-07-17"
 */
export async function listPostIdsForDailyTab(tabName) {
  const date = tabName || new Date().toISOString().slice(0, 10);
  try {
    const projectId = await getProjectId();
    const res = await client.get('/v1/posts', {
      params: { startDate: date, endDate: date, limit: 500, projectId },
    });
    const body = parseResponseBody(res);
    const posts = Array.isArray(body?.data) ? body.data
      : Array.isArray(body) ? body
      : body?.items ?? body?.posts ?? [];
    return posts.map((p) => String(p.id || '')).filter(Boolean);
  } catch (err) {
    // 405 = endpoint ini tidak didukung Woopsocial, abaikan
    if (err.response?.status !== 405) {
      log.warn({ err: err.message }, `[Woopsocial] listPostIdsForDailyTab: ${err.message}`);
    }
    return [];
  }
}

/**
 * Ambil Post ID N hari terakhir dari Woopsocial API.
 */
export async function listRecentPostIds({ daysBack = 2 } = {}) {
  const end = new Date();
  const start = new Date(Date.now() - Math.max(1, daysBack) * 86_400_000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  try {
    const projectId = await getProjectId();
    const res = await client.get('/v1/posts', {
      params: { startDate, endDate, limit: 500, projectId },
    });
    const body = parseResponseBody(res);
    const posts = Array.isArray(body?.data) ? body.data
      : Array.isArray(body) ? body
      : body?.items ?? body?.posts ?? [];
    return posts.map((p) => String(p.id || '')).filter(Boolean);
  } catch (err) {
    if (err.response?.status !== 405) {
      log.warn({ err: err.message }, `[Woopsocial] listRecentPostIds: ${err.message}`);
    }
    return [];
  }
}
