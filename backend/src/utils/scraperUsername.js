/**
 * Normalisasi input baris (username, @user, atau URL profil) → handle bersih.
 */

const IG_SKIP_SEGMENTS = new Set(['p', 'reel', 'tv', 'stories', 'explore', 'accounts', 'direct']);

function stripQueryHash(s) {
  return String(s || '').split('?')[0].split('#')[0].trim();
}

/**
 * @param {string} line
 * @returns {string}
 */
function normalizeInstagramUsername(line) {
  let s = stripQueryHash(line).replace(/^@/, '');
  if (!s) return '';

  if (/instagram\.com\/(p|reel|tv)\//i.test(s)) return '';

  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, '')) && !u.hostname.includes('instagram.com')) {
        return '';
      }
      const parts = u.pathname.split('/').filter(Boolean);
      if (!parts.length) return '';
      const head = parts[0].toLowerCase();
      if (IG_SKIP_SEGMENTS.has(head)) return '';
      return parts[0].replace(/^@/, '');
    }
  } catch {
    /* plain text */
  }

  if (s.includes('instagram.com/')) {
    const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
    if (m?.[1] && !IG_SKIP_SEGMENTS.has(m[1].toLowerCase())) return m[1];
    return '';
  }

  return s.split('/').filter(Boolean).pop()?.replace(/^@/, '') || '';
}

/**
 * @param {string} line
 * @returns {string}
 */
function normalizeThreadsUsername(line) {
  let s = stripQueryHash(line).replace(/^@/, '');
  if (!s) return '';

  if (/threads\.(?:com|net)\/.*\/post\//i.test(s)) return '';

  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      const atPart = parts.find((p) => p.startsWith('@'));
      if (atPart) return atPart.replace(/^@/, '');
      if (parts[0]?.toLowerCase() === 'post') return '';
      return (parts[0] || '').replace(/^@/, '');
    }
  } catch {
    /* plain text */
  }

  if (/threads\.(?:com|net)\/@/i.test(s)) {
    const m = s.match(/threads\.(?:com|net)\/@([A-Za-z0-9._]+)/i);
    if (m?.[1]) return m[1];
  }

  return s.split('/').filter(Boolean).pop()?.replace(/^@/, '') || '';
}

/**
 * @param {string[]} lines
 * @param {'instagram'|'threads'} platform
 */
function normalizeScraperUsernames(lines, platform) {
  const fn = platform === 'threads' ? normalizeThreadsUsername : normalizeInstagramUsername;
  const seen = new Set();
  const out = [];
  for (const line of lines || []) {
    const handle = fn(line);
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(handle);
  }
  return out;
}

module.exports = {
  normalizeInstagramUsername,
  normalizeThreadsUsername,
  normalizeScraperUsernames,
};
