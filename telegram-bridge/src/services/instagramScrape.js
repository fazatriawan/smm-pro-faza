import axios from 'axios';

const client = axios.create({
  timeout: 25_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});

const POST_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]{6,15})/gi;

const SHORTCODE_JSON_RE = /"shortcode":"([A-Za-z0-9_-]{6,15})"/gi;

/**
 * @param {string} html
 */
export function instagramHtmlLooksBlocked(html) {
  const s = String(html || '');
  if (s.length < 500) return true;
  if (/login_and_signup|Log in to Instagram|loginForm/i.test(s)) return true;
  if (!/"shortcode":/i.test(s) && !/instagram\.com\/(?:p|reel)\//i.test(s)) {
    return true;
  }
  return false;
}

/**
 * @param {string} username
 * @returns {Promise<{ url: string, blocked?: boolean }>}
 */
export async function scrapeInstagramLatestPostUrl(username) {
  const handle = String(username || '').replace(/^@/, '').trim();
  if (!handle) return { url: '' };

  const profileUrl = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  const res = await client.get(profileUrl);
  const html = String(res.data || '');
  if (instagramHtmlLooksBlocked(html)) {
    return { url: '', blocked: true };
  }
  const codes = [];

  for (const m of html.matchAll(POST_RE)) {
    if (m[1]) codes.push(m[1]);
  }
  for (const m of html.matchAll(SHORTCODE_JSON_RE)) {
    if (m[1]) codes.push(m[1]);
  }

  const seen = new Set();
  for (const raw of codes) {
    const code = String(raw || '').trim();
    if (!code || seen.has(code)) continue;
    if (!/^[A-Za-z0-9_-]{6,15}$/.test(code) || !/[A-Za-z]/.test(code)) continue;
    seen.add(code);
    return { url: `https://www.instagram.com/p/${code}/` };
  }
  return { url: '' };
}

/**
 * @param {string[]} usernames
 * @returns {Promise<Array<{ username: string, url: string, blocked?: boolean }>>}
 */
export async function scrapeInstagramLatestPostUrls(usernames = []) {
  const out = [];
  const list = (usernames || [])
    .map((u) => String(u || '').replace(/^@/, '').trim())
    .filter(Boolean);

  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    const result = await scrapeInstagramLatestPostUrl(u).catch(() => ({
      url: '',
    }));
    out.push({
      username: u,
      url: result.url || '',
      blocked: Boolean(result.blocked),
    });
    if (i < list.length - 1) {
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
    }
  }
  return out;
}
