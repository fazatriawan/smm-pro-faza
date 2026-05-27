/**
 * @param {string} s
 */
function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

/** Canonical domain Threads (threads.net redirect ke threads.com). */
export function normalizeThreadsUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  return s.replace(/threads\.net/gi, 'threads.com');
}

/** URL profil saja, tanpa `/post/{code}` — bukan link posting. */
export function isThreadsProfileOnlyUrl(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (!/threads\.(net|com)/i.test(s)) return false;
  return !/\/post\//i.test(s);
}

/** URL posting Threads yang valid. */
export function isThreadsPostUrl(url) {
  const s = String(url || '').trim();
  return (
    /^https?:\/\//i.test(s) &&
    /threads\.(net|com)/i.test(s) &&
    /\/post\/[A-Za-z0-9_-]+/i.test(s)
  );
}

/** Instagram profil saja (bukan /p/ /reel/). */
function isInstagramProfileOnlyUrl(url) {
  const s = String(url || '').trim();
  if (!/instagram\.com/i.test(s)) return false;
  return !/(?:\/p\/|\/reel\/|\/tv\/)/i.test(s);
}

/**
 * Alphabet base64-url yang dipakai Instagram untuk derive shortcode dari
 * numeric media_id. URL public Instagram (`/p/{shortcode}/`) HARUS pakai
 * shortcode, bukan numeric media_id.
 */
const IG_BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Convert numeric Instagram media_id ke shortcode (base64-url encoding).
 *
 * Outstand mengirim `platformPostId` sebagai numeric snowflake (mis.
 * `18096868406136282`). Bot lama pakai langsung di URL `/reel/{id}/`, yang
 * **tidak valid** dan tidak resolve di browser. Fungsi ini convert ke
 * shortcode supaya URL `https://www.instagram.com/p/{shortcode}/` bisa di-buka.
 *
 * Support format `{mediaId}_{userId}` — bagian sebelum underscore yang dipakai.
 *
 * @param {string | number | bigint} mediaId numeric media_id Instagram
 * @returns {string} shortcode atau '' kalau tidak bisa convert
 */
export function instagramMediaIdToShortcode(mediaId) {
  try {
    const raw = String(mediaId ?? '').trim();
    if (!raw) return '';
    const numPart = raw.split('_')[0];
    if (!/^\d+$/.test(numPart)) return '';
    let id = BigInt(numPart);
    if (id <= 0n) return '';
    let shortcode = '';
    while (id > 0n) {
      const remainder = Number(id % 64n);
      shortcode = IG_BASE64_ALPHABET[remainder] + shortcode;
      id = id / 64n;
    }
    return shortcode;
  } catch {
    return '';
  }
}

/**
 * Apakah string `id` cocok bentuk shortcode Instagram
 * (huruf+angka+_-, 6-15 char, **bukan murni numeric**)?
 * @param {string} id
 */
function looksLikeInstagramShortcode(id) {
  const s = String(id || '').trim();
  if (!s) return false;
  if (!/^[A-Za-z0-9_-]{6,15}$/.test(s)) return false;
  if (/^\d+$/.test(s)) return false; // murni numeric = pasti media_id
  return /[A-Za-z]/.test(s); // shortcode selalu punya huruf
}

const FB_SHARE_R_RE =
  /(?:web\.|www\.|m\.)?facebook\.com\/share\/r\/([a-zA-Z0-9_-]+)/i;

/**
 * @param {string} raw
 */
function facebookShareRUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(FB_SHARE_R_RE);
  if (m?.[1]) return `https://web.facebook.com/share/r/${m[1]}/`;
  if (
    /^[a-zA-Z0-9_-]{6,32}$/.test(s) &&
    !/^\d+$/.test(s) &&
    /[a-zA-Z]/.test(s)
  ) {
    return `https://web.facebook.com/share/r/${s}/`;
  }
  return '';
}

/**
 * Username/slug valid di path facebook.com/{slug}/posts/...
 * @param {string} handle
 */
function isFacebookPathSlug(handle) {
  const h = String(handle || '').replace(/^@/, '').trim();
  return h.length > 0 && /^[a-zA-Z0-9._-]+$/.test(h) && !/\s/.test(h);
}

/**
 * @param {string} handle
 */
function isNumericId(handle) {
  return /^\d+$/.test(String(handle || '').trim());
}

/**
 * @param {string} [directUrl]
 * @param {string} [platformPostId]
 * @param {string} [username]
 * @param {string} [pageId]
 */
export function buildFacebookPostUrl(
  platformPostId,
  username,
  directUrl,
  pageId
) {
  for (const raw of [directUrl, platformPostId]) {
    const s = String(raw || '').trim();
    if (!s) continue;

    const shareUrl = facebookShareRUrl(s);
    if (shareUrl) return shareUrl;

    if (isHttpUrl(s) && /facebook\.com/i.test(s)) {
      return s;
    }
  }

  const id = String(platformPostId || '').trim();
  if (!id) return '';

  const shareFromId = facebookShareRUrl(id);
  if (shareFromId) return shareFromId;

  if (isHttpUrl(id) && /facebook\.com/i.test(id)) return id;

  const handle = String(username || '')
    .replace(/^@/, '')
    .trim();
  const page = String(pageId || '').trim();

  if (/^\d+_\d+$/.test(id)) {
    const [pageNum, story] = id.split('_');
    const share = facebookShareRUrl(story);
    if (share) return share;
    return `https://www.facebook.com/permalink.php?story_fbid=${story}&id=${pageNum}`;
  }

  if (/^\d+$/.test(id)) {
    if (isNumericId(page)) {
      return `https://www.facebook.com/permalink.php?story_fbid=${id}&id=${page}`;
    }
    if (isNumericId(handle)) {
      return `https://www.facebook.com/permalink.php?story_fbid=${id}&id=${handle}`;
    }
    if (isFacebookPathSlug(handle)) {
      return `https://www.facebook.com/${handle}/posts/${id}`;
    }
    // Tanpa page id — permalink.php saja sering "Not Found"
    return '';
  }

  if (isFacebookPathSlug(handle)) {
    return `https://www.facebook.com/${handle}/posts/${encodeURIComponent(id)}`;
  }

  return '';
}

/**
 * @param {string} network
 * @param {string} username
 * @param {string | null | undefined} platformPostId
 * @param {string} [directUrl] dari API Outstand
 * @param {string} [pageId] ID halaman Facebook (numerik) jika ada
 */
export function buildLivePostUrl(
  network,
  username,
  platformPostId,
  directUrl,
  pageId
) {
  const fromApi = String(directUrl || '').trim();
  if (isHttpUrl(fromApi)) {
    const net = (network || '').toLowerCase();
    if (net === 'facebook') {
      const share = facebookShareRUrl(fromApi);
      if (share) return share;
      if (/facebook\.com/i.test(fromApi)) return fromApi;
    } else if (net === 'threads') {
      if (isThreadsPostUrl(fromApi)) return normalizeThreadsUrl(fromApi);
      // Profil saja — jangan pakai; lanjut derive dari platformPostId.
    } else if (net === 'instagram') {
      if (!isInstagramProfileOnlyUrl(fromApi)) return fromApi;
    } else {
      return fromApi;
    }
  }

  if (!platformPostId) return '';

  const id = String(platformPostId).trim();
  if (isHttpUrl(id)) {
    const net = (network || '').toLowerCase();
    if (net === 'facebook' && /facebook\.com/i.test(id)) {
      return facebookShareRUrl(id) || id;
    }
    return id;
  }

  const handle = (username || '').replace(/^@/, '').trim();
  const net = (network || '').toLowerCase();

  switch (net) {
    case 'instagram': {
      // Instagram public URL HARUS pakai shortcode (`/p/{shortcode}/`), bukan
      // numeric media_id. URL `/reel/{numericId}/` tidak resolve di browser.
      // Catatan: `/p/{shortcode}/` works untuk post foto, carousel, video,
      // maupun reel — Instagram redirect otomatis.
      if (looksLikeInstagramShortcode(id)) {
        return `https://www.instagram.com/p/${id}/`;
      }
      const shortcode = instagramMediaIdToShortcode(id);
      if (shortcode) {
        return `https://www.instagram.com/p/${shortcode}/`;
      }
      // Tidak bisa derive shortcode → fallback ke profile (lebih baik dari URL
      // mati). Tanpa username juga, return '' supaya kolom Link di Sheets blank.
      return handle ? `https://www.instagram.com/${handle}/` : '';
    }
    case 'threads': {
      if (looksLikeInstagramShortcode(id)) {
        return handle
          ? `https://www.threads.com/@${encodeURIComponent(handle)}/post/${id}`
          : `https://www.threads.com/post/${id}`;
      }
      const derived = instagramMediaIdToShortcode(id);
      if (derived && looksLikeInstagramShortcode(derived)) {
        return handle
          ? `https://www.threads.com/@${encodeURIComponent(handle)}/post/${derived}`
          : `https://www.threads.com/post/${derived}`;
      }
      return '';
    }
    case 'tiktok':
      return handle
        ? `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${id}`
        : `https://www.tiktok.com/video/${id}`;
    case 'facebook':
      return buildFacebookPostUrl(id, handle, directUrl, pageId);
    case 'youtube':
      if (id.length === 11 && /^[a-zA-Z0-9_-]+$/.test(id)) {
        return `https://www.youtube.com/watch?v=${id}`;
      }
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    case 'x':
    case 'twitter':
      return handle
        ? `https://x.com/${encodeURIComponent(handle)}/status/${id}`
        : `https://x.com/i/web/status/${id}`;
    case 'linkedin':
      return id.startsWith('urn:')
        ? `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}`
        : `https://www.linkedin.com/posts/${id}`;
    case 'pinterest':
      return `https://www.pinterest.com/pin/${id}/`;
    default:
      return isHttpUrl(id) ? id : '';
  }
}
