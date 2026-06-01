/**
 * @param {object} a
 */
export function extractFacebookPageId(a) {
  if (!a || typeof a !== 'object') return null;
  const candidates = [
    a.network_unique_id,
    a.network_data?.page_id,
    a.network_data?.pageId,
    a.pageId,
    a.page_id,
    a.platformUserId,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (/^\d+$/.test(s)) return s;
  }
  return null;
}

/**
 * @param {object} obj
 * @param {number} [depth]
 */
export function deepFindFacebookUrl(obj, depth = 0) {
  if (!obj || depth > 10) return null;

  if (typeof obj === 'string') {
    const s = obj.trim();
    if (
      /^https?:\/\//i.test(s) &&
      /facebook\.com/i.test(s) &&
      !/fbcdn\.net/i.test(s)
    ) {
      return s;
    }
    return null;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindFacebookUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (/url|link|permalink|share/i.test(key) && typeof value === 'string') {
        const s = value.trim();
        if (
          /^https?:\/\//i.test(s) &&
          /facebook\.com/i.test(s) &&
          !/fbcdn\.net/i.test(s)
        ) {
          return s;
        }
      }
      const found = deepFindFacebookUrl(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Cari URL posting Threads di objek Outstand (bukan profil).
 * @param {object} obj
 * @param {number} [depth]
 */
export function deepFindThreadsPostUrl(obj, depth = 0) {
  if (!obj || depth > 12) return null;

  if (typeof obj === 'string') {
    const s = obj.trim();
    if (
      /^https?:\/\//i.test(s) &&
      /threads\.(net|com)/i.test(s) &&
      /\/post\/[A-Za-z0-9_-]+/i.test(s)
    ) {
      return s.replace(/threads\.net/gi, 'threads.com');
    }
    return null;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindThreadsPostUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (/url|link|permalink|share|post/i.test(key) && typeof value === 'string') {
        const s = value.trim();
        if (
          /^https?:\/\//i.test(s) &&
          /threads\.(net|com)/i.test(s) &&
          /\/post\//i.test(s)
        ) {
          return s.replace(/threads\.net/gi, 'threads.com');
        }
      }
      const found = deepFindThreadsPostUrl(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * @param {object} a raw Outstand social account row
 */
export function pickSocialAccountUrl(a) {
  const candidates = [
    a.url,
    a.postUrl,
    a.permalink,
    a.permalinkUrl,
    a.link,
    a.shareUrl,
    a.publishedUrl,
    a.platformUrl,
    a.platform_post_url,
    a.facebookUrl,
    a.post?.url,
    a.metadata?.url,
    a.metadata?.permalink,
    a.metadata?.shareUrl,
    a.network_data?.permalink,
    a.network_data?.url,
    a.network_data?.post_url,
    a.network_data?.permalink_url,
    a.network_data?.share_url,
    a.threadsUrl,
    a.threads_post_url,
  ];

  /** @type {string | null} */
  let threadsProfileFallback = null;

  for (const c of candidates) {
    const s = String(c || '').trim();
    if (!/^https?:\/\//i.test(s)) continue;

    if (/threads\.(net|com)/i.test(s)) {
      if (/\/post\//i.test(s)) {
        return s.replace(/threads\.net/gi, 'threads.com');
      }
      if (!threadsProfileFallback) threadsProfileFallback = s;
      continue;
    }

    if (/instagram\.com/i.test(s)) {
      if (/(?:\/p\/|\/reel\/|\/tv\/)/i.test(s)) return s;
      continue;
    }

    if (/facebook\.com/i.test(s)) return s;
    return s;
  }

  const threadsDeep = deepFindThreadsPostUrl(a);
  if (threadsDeep) return threadsDeep;

  const fbDeep = deepFindFacebookUrl(a);
  if (fbDeep) return fbDeep;

  // Jangan kembalikan profil Threads — kolom Link harus posting atau kosong.
  return null;
}
