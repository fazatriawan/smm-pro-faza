import axios from 'axios';
import { env } from '../config/env.js';
import { downloadFile } from './drive.js';
import {
  buildCaptionsByNetwork,
  buildYoutubePostFields,
} from './captionPlatforms.js';
import { buildLivePostUrl } from '../utils/platformUrl.js';
import { normalizeOutstandStatus } from '../utils/postStatus.js';
import {
  extractFacebookPageId,
  pickSocialAccountUrl,
} from '../utils/outstandAccount.js';
import {
  convertDriveImagesToSocialVideo,
  networksNeedingImageToVideo,
} from './imageToVideo.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('outstand');

const client = axios.create({
  baseURL: env.outstandBaseUrl,
  headers: {
    Authorization: `Bearer ${env.outstandApiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 120_000,
});

function parseResponseBody(res) {
  const body = res.data;
  if (body?.success === false) {
    throw new Error(body.error || body.message || 'Outstand API error');
  }
  return body;
}

/**
 * Fetch all connected social accounts.
 */
export async function listSocialAccounts() {
  const accounts = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await client.get('/v1/social-accounts', {
      params: { limit, offset },
    });
    const body = parseResponseBody(res);
    const batch = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body)
        ? body
        : body?.items ?? body?.accounts ?? [];
    if (!batch.length) break;
    accounts.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return accounts.map((a) => ({
    id: String(a.id ?? a.accountId ?? ''),
    network: (a.network ?? a.provider ?? '').toLowerCase(),
    username: a.username ?? a.nickname ?? a.name ?? '',
    pageId: extractFacebookPageId(a),
  })).filter((a) => a.id);
}

/**
 * @param {{ buffer: Buffer, filename: string, mimeType: string }} file
 */
export async function uploadMediaBuffer({ buffer, filename, mimeType }) {
  const initRes = await client.post('/v1/media/upload', {
    filename,
    content_type: mimeType,
  });
  const body = parseResponseBody(initRes);
  const init = body.data ?? body;
  const mediaId = init.id;
  const uploadUrl = init.upload_url;

  if (!mediaId || !uploadUrl) {
    throw new Error('Outstand media upload did not return id or upload_url');
  }

  await axios.put(uploadUrl, buffer, {
    headers: { 'Content-Type': mimeType },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 300_000,
  });

  const confirmRes = await client.post(`/v1/media/${mediaId}/confirm`, {
    size: buffer.length,
  });
  const confirmed = parseResponseBody(confirmRes);
  const data = confirmed.data ?? confirmed;
  const url = data.url ?? data.public_url;
  const filenameOut = data.filename ?? filename;

  if (!url) {
    const detailRes = await client.get(`/v1/media/${mediaId}`);
    const detail = parseResponseBody(detailRes);
    const d = detail.data ?? detail;
    return {
      id: String(d.id ?? mediaId),
      url: d.url,
      filename: d.filename ?? filenameOut,
    };
  }

  return {
    id: String(data.id ?? mediaId),
    url,
    filename: filenameOut,
  };
}

/**
 * @param {{ id?: string, buffer?: Buffer, name?: string, mimeType?: string }} mediaFile
 */
async function resolveMediaBytes(mediaFile) {
  if (mediaFile.buffer) {
    return {
      buffer: mediaFile.buffer,
      mimeType: mediaFile.mimeType || 'application/octet-stream',
      name: mediaFile.name || 'media.bin',
    };
  }
  if (mediaFile.id) {
    return downloadFile(mediaFile.id);
  }
  throw new Error(`Media "${mediaFile.name || 'file'}" tanpa data.`);
}

export async function uploadMediaFromDrive(driveFile) {
  const { buffer, mimeType, name } = await resolveMediaBytes(driveFile);
  const filename = name.includes('.') ? name : `${name}.bin`;
  return uploadMediaBuffer({ buffer, filename, mimeType });
}

/** @typedef {{ id: string, url: string, filename: string }} OutstandMediaRef */

function formatOutstandError(err) {
  const data = err.response?.data;
  if (typeof data === 'string') return data;
  if (data?.error) return data.error;
  if (data?.message) return data.message;
  return err.message;
}

/** @returns {Promise<OutstandMediaRef[]>} */
export async function uploadAllMediaFromDrive(driveMediaFiles) {
  /** @type {OutstandMediaRef[]} */
  const items = [];
  for (const file of driveMediaFiles) {
    try {
      const item = await uploadMediaFromDrive(file);
      if (!item.url) {
        throw new Error('Outstand tidak mengembalikan URL media setelah upload');
      }
      items.push(item);
    } catch (err) {
      throw new Error(
        `Upload media "${file.name}" gagal: ${formatOutstandError(err)}`
      );
    }
  }
  return items;
}

/**
 * Upload media per platform — gambar bisa di-render sekali jadi MP4 + musik.
 * @param {Array<{ id: string, name: string, mimeType: string }>} driveMediaFiles
 * @param {string[]} socialAccountIds
 */
export async function uploadMediaForTargets(driveMediaFiles, socialAccountIds) {
  const allAccounts = await listSocialAccounts();
  const byNet = groupAccountsByNetwork(socialAccountIds, allAccounts);
  const networks = Object.keys(byNet);

  const hasVideo = driveMediaFiles.some((f) =>
    f.mimeType?.startsWith('video/')
  );
  const images = driveMediaFiles.filter((f) =>
    f.mimeType?.startsWith('image/')
  );

  const convertNetworks = networksNeedingImageToVideo(
    networks,
    hasVideo,
    images.length > 0
  );

  /** @type {Record<string, OutstandMediaRef[]>} */
  const byNetwork = {};
  let imageToVideoSilent = false;
  /** @type {OutstandMediaRef[] | null} */
  let sharedReelItem = null;

  if (convertNetworks.length) {
    if (!images.length) {
      throw new Error(
        'Platform terpilih butuh video, atau gambar + musik latar (assets/audio/).'
      );
    }
    const primaryNet = convertNetworks.includes('youtube')
      ? 'youtube'
      : convertNetworks[0] || 'reel';
    const video = await convertDriveImagesToSocialVideo(images, primaryNet);
    if (video.silent) imageToVideoSilent = true;
    sharedReelItem = await uploadMediaBuffer({
      buffer: video.buffer,
      filename: video.name,
      mimeType: video.mimeType,
    });
    if (!sharedReelItem.url) {
      throw new Error('Upload video (dari gambar) gagal');
    }
    if (images.length > 1) {
      log.info(
        { count: images.length, networks: convertNetworks },
        `[Image→Video] Carousel ${images.length} gambar → video untuk: ${convertNetworks.join(', ')}`,
      );
    } else {
      log.info(
        { networks: convertNetworks },
        `[Image→Video] Satu video untuk: ${convertNetworks.join(', ')}`,
      );
    }
  }

  for (const network of networks) {
    if (convertNetworks.includes(network)) {
      byNetwork[network] = [sharedReelItem];
    } else {
      byNetwork[network] = await uploadAllMediaFromDrive(driveMediaFiles);
    }
  }

  return {
    byNetwork,
    imageToVideoNetworks: convertNetworks,
    imageToVideoSilent,
    /** @deprecated */
    youtubeConverted: convertNetworks.includes('youtube'),
    youtubeSilent: imageToVideoSilent,
  };
}

function buildContainerMedia(mediaItems) {
  return mediaItems.map((m) => ({
    id: m.id,
    url: m.url,
    filename: m.filename,
  }));
}

function groupAccountsByNetwork(accountIds, allAccounts) {
  const byId = new Map(allAccounts.map((a) => [a.id, a]));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Record<string, Array<typeof allAccounts[0]>>} */
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

/**
 * Publish ke akun terpilih — satu request Outstand per platform (caption beda limit).
 * @param {{ baseCaption: string, captionsByNetwork?: Record<string, string>, youtubeFields?: { title: string, description: string, tags?: string[] }, mediaByNetwork: Record<string, OutstandMediaRef[]>, scheduledAt?: string, socialAccountIds: string[] }} options
 */
export async function publishBulk({
  baseCaption,
  captionsByNetwork: captionsByNetworkIn,
  youtubeFields,
  mediaByNetwork,
  scheduledAt,
  socialAccountIds,
}) {
  const allAccounts = await listSocialAccounts();
  if (!allAccounts.length) {
    throw new Error('No social accounts connected in Outstand');
  }

  if (!socialAccountIds?.length) {
    throw new Error('Tidak ada akun target yang dipilih');
  }

  const accountIds = [...socialAccountIds];
  const byNet = groupAccountsByNetwork(accountIds, allAccounts);
  const networks = Object.keys(byNet);
  const captionsByNetwork =
    captionsByNetworkIn && Object.keys(captionsByNetworkIn).length
      ? captionsByNetworkIn
      : buildCaptionsByNetwork(baseCaption, networks);

  const postIds = [];
  const summary = [];

  for (const [network, accts] of Object.entries(byNet)) {
    let caption = captionsByNetwork[network] || baseCaption;
    const accountRefs = accts.map((a) => a.id);

    const networkMedia = mediaByNetwork[network] ?? [];
    const containerMedia = buildContainerMedia(networkMedia);
    const payload = {
      containers: [
        {
          content: caption,
          ...(containerMedia.length ? { media: containerMedia } : {}),
        },
      ],
      accounts: accountRefs,
    };
    if (scheduledAt) payload.scheduledAt = scheduledAt;

    if (network === 'youtube' && containerMedia.length) {
      const yt =
        youtubeFields || buildYoutubePostFields(captionsByNetwork.youtube || baseCaption);
      caption = yt.description;
      payload.containers[0].content = yt.description;
      payload.youtube = {
        isShort: env.youtubePublishAsShorts,
        privacyStatus: 'public',
        title: yt.title,
        ...(yt.tags?.length ? { tags: yt.tags } : {}),
      };
    }

    try {
      const res = await client.post('/v1/posts/', payload);
      const body = parseResponseBody(res);
      const post = body.post ?? body.data?.post ?? body.data;
      const postId = post?.id ?? post?.postId;
      if (postId) postIds.push(postId);
      summary.push(`${network}: ${accts.length} akun`);
    } catch (err) {
      throw new Error(
        `Publish ${network} gagal (${accts.length} akun): ${formatOutstandError(err)}`
      );
    }
  }

  return {
    postIds,
    accountCount: accountIds.length,
    uniqueAccountCount: new Set(accountIds).size,
    batchCount: networks.length,
    summary,
    captionsByNetwork,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSocialAccount(a) {
  const network = (a.network ?? '').toLowerCase();
  const pageId = extractFacebookPageId(a);
  const platformPostId =
    a.platformPostId ??
    a.postId ??
    a.platform_post_id ??
    a.facebookPostId ??
    null;
  const username = a.username ?? a.nickname ?? a.name ?? '';
  const directUrl = pickSocialAccountUrl(a);
  const url =
    directUrl ||
    (network === 'facebook' && platformPostId
      ? buildLivePostUrl(
          network,
          username,
          platformPostId,
          directUrl,
          pageId
        )
      : null);

  return {
    id: a.id,
    network,
    username,
    status: normalizeOutstandStatus(a.status),
    error: a.error ?? null,
    platformPostId,
    pageId,
    url,
    publishedAt: a.publishedAt ?? null,
  };
}

function extractPostCaption(raw) {
  if (!raw || typeof raw !== 'object') return '';

  const containers = raw.containers ?? raw.data?.containers;
  if (Array.isArray(containers)) {
    for (const c of containers) {
      const text = c?.content ?? c?.caption ?? c?.text;
      if (text && String(text).trim()) return String(text).trim();
    }
  }

  for (const key of ['caption', 'content', 'text', 'description', 'body']) {
    const v = raw[key];
    if (v && String(v).trim()) return String(v).trim();
  }

  const yt = raw.youtube ?? raw.youtubeFields;
  if (yt?.description && String(yt.description).trim()) {
    return String(yt.description).trim();
  }

  return '';
}

/**
 * Ambil caption teks dari post Outstand yang sudah pernah dibuat.
 * @param {string[]} postIds
 */
export async function fetchCaptionFromPostIds(postIds) {
  for (const id of (postIds || []).filter(Boolean)) {
    try {
      const res = await client.get(`/v1/posts/${id}`);
      const body = parseResponseBody(res);
      const raw = body.post ?? body.data?.post ?? body.data ?? body;
      const cap = extractPostCaption(raw);
      if (cap) return cap;
    } catch (err) {
      log.warn({ postId: id, err: err.message }, `[Outstand] fetchCaption ${id}: ${err.message}`);
    }
  }
  return '';
}

function normalizePost(post) {
  if (!post) return null;
  const accounts =
    post.socialAccounts ??
    post.accounts ??
    post.postTargets ??
    post.targets ??
    [];
  return {
    id: post.id ?? post.postId,
    caption: extractPostCaption(post),
    publishedAt: post.publishedAt ?? null,
    scheduledAt: post.scheduledAt ?? null,
    createdAt:
      post.createdAt ??
      post.created_at ??
      post.updatedAt ??
      post.updated_at ??
      null,
    socialAccounts: accounts.map((a) => normalizeSocialAccount(a)),
  };
}

/**
 * @param {ReturnType<typeof normalizePost>} post
 */
async function enrichPostWithAccountDirectory(post) {
  if (!post?.socialAccounts?.length) return post;

  let directory = [];
  try {
    directory = await listSocialAccounts();
  } catch {
    return post;
  }

  const byId = new Map(directory.map((d) => [d.id, d]));

  for (const acct of post.socialAccounts) {
    const dir = byId.get(acct.id);
    if (!acct.pageId && dir?.pageId) acct.pageId = dir.pageId;

    if (!acct.url && acct.network === 'facebook' && acct.platformPostId) {
      acct.url = buildLivePostUrl(
        acct.network,
        acct.username,
        acct.platformPostId,
        acct.url,
        acct.pageId || dir?.pageId
      );
    }
  }

  return post;
}

/** @param {string} postId */
export async function getPost(postId) {
  const res = await client.get(`/v1/posts/${postId}`);
  const body = parseResponseBody(res);
  const raw = body.post ?? body.data?.post ?? body.data;
  const post = normalizePost(raw);
  return enrichPostWithAccountDirectory(post);
}

function dailyTabForIso(iso) {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(d)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, /** @type {Record<string,string>} */ ({}));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Semua Post ID Outstand yang dibuat pada tab harian tertentu (TZ env).
 * @param {string} targetTab YYYY-MM-DD
 */
export async function listPostIdsForDailyTab(targetTab) {
  const ids = [];
  const seen = new Set();
  let offset = 0;
  const limit = 50;

  for (let page = 0; page < 30; page++) {
    const res = await client.get('/v1/posts', { params: { limit, offset } });
    const body = parseResponseBody(res);
    const batch = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.posts)
        ? body.posts
        : (body?.items ?? []);

    if (!batch.length) break;

    let stopPaging = false;
    for (const raw of batch) {
      const ts =
        raw.createdAt ??
        raw.created_at ??
        raw.publishedAt ??
        raw.scheduledAt ??
        raw.updatedAt;
      if (!ts) continue;

      const tab = dailyTabForIso(ts);
      if (tab < targetTab) {
        stopPaging = true;
        break;
      }
      if (tab !== targetTab) continue;

      const id = String(raw.id ?? raw.postId ?? '').trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }

    if (stopPaging || batch.length < limit) break;
    offset += limit;
  }

  return ids;
}

/**
 * Poll until each account is published/failed or timeout.
 * @param {string[]} postIds
 * @param {{ maxWaitMs?: number, intervalMs?: number }} [options]
 */
export async function waitForPostsSettled(postIds, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const deadline = Date.now() + maxWaitMs;
  /** @type {Map<string, ReturnType<typeof normalizePost>>} */
  const latest = new Map();

  while (Date.now() < deadline) {
    let allSettled = true;

    for (const postId of postIds) {
      try {
        const post = await getPost(postId);
        if (post) latest.set(postId, post);
        const accounts = post?.socialAccounts ?? [];
        if (!accounts.length) {
          allSettled = false;
          continue;
        }
        if (accounts.some((a) => a.status === 'pending')) {
          allSettled = false;
        }
      } catch (err) {
        log.warn({ postId, err: err.message }, `[Outstand] poll ${postId}: ${err.message}`);
        allSettled = false;
      }
    }

    if (allSettled && postIds.every((id) => latest.get(id)?.socialAccounts?.length)) {
      break;
    }
    await sleep(intervalMs);
  }

  return postIds.map((id) => latest.get(id) ?? null);
}

const STATUS_ICON = {
  published: '✅',
  failed: '❌',
  pending: '⏳',
};

/**
 * Human-readable Telegram report after polling (or timeout).
 * @param {Array<ReturnType<typeof normalizePost> | null>} posts
 * @param {{ timedOut?: boolean }} [options]
 */
export function formatPostStatusReport(posts, options = {}) {
  const lines = [];
  let published = 0;
  let failed = 0;
  let pending = 0;

  for (const post of posts) {
    if (!post) {
      lines.push('❓ Post tidak ditemukan di Outstand');
      continue;
    }

    if (posts.length > 1) {
      lines.push(`\nPost ID: ${post.id}`);
    }

    for (const acct of post.socialAccounts) {
      const icon = STATUS_ICON[acct.status] ?? '⏳';
      const user = acct.username ? `@${acct.username.replace(/^@/, '')}` : acct.id;
      const net = acct.network || 'unknown';

      if (acct.status === 'published') published += 1;
      else if (acct.status === 'failed') failed += 1;
      else pending += 1;

      let line = `${icon} ${net} ${user}: ${acct.status}`;
      if (acct.status === 'published' && acct.platformPostId) {
        const url = buildLivePostUrl(
          net,
          acct.username,
          acct.platformPostId,
          acct.url,
          acct.pageId
        );
        if (url) line += `\n   🔗 ${url}`;
      }
      if (acct.status === 'failed' && acct.error) {
        line += `\n   ⚠️ ${acct.error}`;
      }
      lines.push(line);
    }
  }

  const header =
    failed > 0 && published === 0
      ? '❌ Publish gagal di platform'
      : pending > 0 && published === 0 && failed === 0
        ? '⏳ Publish masih diproses Outstand'
        : failed > 0
          ? '⚠️ Publish sebagian berhasil'
          : published > 0
            ? '✅ Post sudah live'
            : '⏳ Status publish belum pasti';

  const summary = `Ringkasan: ${published} live · ${failed} gagal · ${pending} pending`;
  const footer = options.timedOut
    ? '\n\n💡 Masih pending? Cek dashboard Outstand atau tunggu webhook. Token kadaluarsa = reconnect akun.'
    : failed > 0
      ? '\n\n💡 Jika gagal: reconnect akun di Outstand, pastikan IG Business + Page terhubung, video format MP4.'
      : '';

  return `${header}\n${summary}\n${lines.join('\n')}${footer}`;
}
