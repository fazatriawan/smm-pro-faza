import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env.js';
import { downloadFile } from './drive.js';
import { buildCaptionsByNetwork } from './captionPlatforms.js';
import { buildLivePostUrl } from '../utils/platformUrl.js';
import {
  convertDriveImagesToSocialVideo,
  networksNeedingImageToVideo,
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
  const res = await client.get('/v1/projects');
  const body = parseResponseBody(res);
  const projects = Array.isArray(body) ? body : body?.data ?? [];
  if (!projects.length) throw new Error('Woopsocial: tidak ada project ditemukan');
  _projectId = String(projects[0].id);
  log.info({ projectId: _projectId }, '[Woopsocial] Project ID cached');
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
  // Woopsocial mengembalikan semua akun di setiap page (tidak ada pagination nyata).
  // Satu request dengan limit besar sudah cukup.
  const res = await client.get('/v1/social-accounts', { params: { limit: 500 } });
  const body = parseResponseBody(res);
  const accounts = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body)
      ? body
      : body?.items ?? body?.accounts ?? [];

  return accounts
    .filter((a) => {
      const s = (a.status || '').toUpperCase();
      return s === 'CONNECTED' || s === 'ACTIVE';
    })
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
    uploadedMedia = await uploadAllMediaFromDrive(driveMediaFiles);
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
  };
}

// ─── Publish ─────────────────────────────────────────────────────────────────

/**
 * Publish ke semua platform dalam SATU request Woopsocial.
 * @param {{ baseCaption: string, captionsByNetwork?: Record<string,string>, youtubeFields?: object, mediaByNetwork: Record<string,Array>, scheduledAt?: string, socialAccountIds: string[] }} options
 */
export async function publishBulk({
  baseCaption,
  captionsByNetwork: captionsByNetworkIn,
  mediaByNetwork,
  scheduledAt,
  socialAccountIds,
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

  // ─── Split request per caption unik ───────────────────────────────────────
  // Threads limit 500 char, Instagram bisa 2200 char.
  // Network dengan caption berbeda → API call terpisah agar masing-masing
  // mendapat teks yang sesuai dan tidak kena validation error lintas-platform.
  const captionGroupMap = new Map(); // caption text → { networks[], accounts[] }
  for (const [network, accts] of Object.entries(byNet)) {
    const platform = NETWORK_TO_PLATFORM[network];
    if (!platform) {
      log.warn(`[Woopsocial] Platform "${network}" tidak didukung — dilewati`);
      continue;
    }
    const cap = captionsByNetwork[network] || baseCaption;
    if (!captionGroupMap.has(cap)) captionGroupMap.set(cap, { networks: [], accounts: [] });
    const group = captionGroupMap.get(cap);
    group.networks.push(network);
    const postType = getPostType(network, allMedia);
    for (const acct of accts) {
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

  for (const [cap, group] of captionGroupMap) {
    if (!group.accounts.length) continue;

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

    try {
      const res = await client.post('/v1/posts', payload);
      const body = parseResponseBody(res);
      const postId = String(body.data?.id ?? body.id ?? body.post?.id ?? '').trim();
      if (postId) allPostIds.push(postId);
      for (const net of group.networks) {
        allSummaryParts.push(`${net}: ${byNet[net]?.length ?? 0} akun`);
      }
    } catch (err) {
      log.error(
        {
          status: err.response?.status,
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
    const res = await client.get('/v1/posts', {
      params: { startDate: date, endDate: date, limit: 500 },
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
    const res = await client.get('/v1/posts', {
      params: { startDate, endDate, limit: 500 },
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
