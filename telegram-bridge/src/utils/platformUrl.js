/**
 * @param {string} s
 */
function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
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
    case 'instagram':
      if (/^\d+$/.test(id) && id.length > 12) {
        return `https://www.instagram.com/reel/${id}/`;
      }
      return `https://www.instagram.com/p/${id}/`;
    case 'threads':
      return handle
        ? `https://www.threads.net/@${encodeURIComponent(handle)}/post/${id}`
        : `https://www.threads.net/post/${id}`;
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
