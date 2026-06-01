const axios = require('axios');
const { normalizeScraperUsernames } = require('../utils/scraperUsername');

const IG_APP_ID = '936619743392459';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const client = axios.create({
  timeout: 25_000,
  headers: {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
  },
});

const POST_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]{6,15})/gi;

const SHORTCODE_JSON_RE = /"shortcode":"([A-Za-z0-9_-]{6,15})"/gi;

const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));
const RAND = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function shortcodeToPostUrl(code, node) {
  if (!code) return null;
  const isReel =
    node?.product_type === 'clips' ||
    node?.__typename === 'GraphVideo' ||
    node?.media_type === 2;
  const path = isReel ? 'reel' : 'p';
  return `https://www.instagram.com/${path}/${code}/`;
}

function pickFirstShortcodeFromJson(user) {
  const edges =
    user?.edge_owner_to_timeline_media?.edges ||
    user?.edge_felix_video_timeline?.edges ||
    [];
  const node = edges[0]?.node;
  const code = node?.shortcode || node?.code;
  return code ? shortcodeToPostUrl(code, node) : null;
}

/**
 * Metode utama: Instagram web_profile_info API (lebih stabil dari scrape HTML).
 * @param {string} username
 */
async function fetchLatestPostViaApi(username) {
  const res = await client.get('https://www.instagram.com/api/v1/users/web_profile_info/', {
    params: { username },
    headers: {
      'X-IG-App-ID': IG_APP_ID,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
      Accept: '*/*',
    },
    validateStatus: () => true,
  });

  if (res.status === 404) return { notFound: true };
  if (res.status === 401 || res.status === 429) return { blocked: true };
  if (res.status !== 200) return { blocked: true };

  const user = res.data?.data?.user;
  if (!user) return { blocked: true };
  if (user.is_private) return { private: true };

  const url = pickFirstShortcodeFromJson(user);
  if (url) return { url };

  const count = user.edge_owner_to_timeline_media?.count ?? 0;
  if (count === 0) return { empty: true };

  return { blocked: true };
}

function extractLatestPostUrlFromHtml(html) {
  const codes = [];
  for (const m of String(html || '').matchAll(POST_RE)) {
    if (m[1]) codes.push(m[1]);
  }
  for (const m of String(html || '').matchAll(SHORTCODE_JSON_RE)) {
    if (m[1]) codes.push(m[1]);
  }
  const seen = new Set();
  for (const raw of codes) {
    const code = String(raw || '').trim();
    if (!code || seen.has(code)) continue;
    if (!/^[A-Za-z0-9_-]{6,15}$/.test(code) || !/[A-Za-z]/.test(code)) continue;
    seen.add(code);
    return `https://www.instagram.com/p/${code}/`;
  }
  return null;
}

async function fetchLatestPostViaHtml(username) {
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const res = await client.get(profileUrl, { validateStatus: () => true });
  const html = String(res.data || '');

  if (/Page Not Found|Sorry, this page/i.test(html)) return { notFound: true };
  if (/This Account is Private|Akun ini pribadi/i.test(html)) return { private: true };

  const url = extractLatestPostUrlFromHtml(html);
  if (url) return { url };

  if (/login_and_signup|Log in to Instagram/i.test(html)) return { blocked: true };
  return { empty: true };
}

/**
 * @param {string} username
 */
async function resolveInstagramLatestPost(username) {
  try {
    const api = await fetchLatestPostViaApi(username);
    if (api.url || api.private || api.notFound || api.empty) return api;
  } catch {
    /* fallback HTML */
  }
  try {
    return await fetchLatestPostViaHtml(username);
  } catch (err) {
    return { error: err.message };
  }
}

function profileOnlyResult(username) {
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  return {
    username,
    profile_url: profileUrl,
    latest_post: profileUrl,
    status: 'profile_only',
  };
}

async function instagramPostScraper(config, onLog = () => {}) {
  const usernames = normalizeScraperUsernames(config.usernames || [], 'instagram');

  if (!usernames.length) {
    throw new Error('Daftar username kosong (gunakan username atau URL profil Instagram)');
  }

  const scrapePosts = config.profileOnly !== true && config.scrapePosts !== false;

  if (!scrapePosts) {
    onLog({ type: 'info', message: `📋 Mode link profil — generate ${usernames.length} link` });
    const results = usernames.map(profileOnlyResult);
    onLog({ type: 'success', message: `✅ Selesai — ${results.length} link profil digenerate` });
    return {
      success: true,
      results,
      summary: { total: results.length, success: results.length, failed: 0 },
    };
  }

  onLog({ type: 'info', message: `🚀 Scrape link postingan terbaru — ${usernames.length} akun` });

  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
    onLog({ type: 'info', message: `[${i + 1}/${usernames.length}] 🔍 @${username}...` });

    const hit = await resolveInstagramLatestPost(username);

    if (hit.notFound) {
      onLog({ type: 'warn', message: `⚠️ @${username} — profil tidak ditemukan` });
      results.push({
        username,
        profile_url: profileUrl,
        latest_post: 'Profil tidak ditemukan',
        status: 'not_found',
      });
      failed++;
    } else if (hit.private) {
      onLog({ type: 'warn', message: `🔒 @${username} — akun private` });
      results.push({
        username,
        profile_url: profileUrl,
        latest_post: 'Akun private',
        status: 'private',
      });
      failed++;
    } else if (hit.url) {
      onLog({ type: 'success', message: `✅ @${username} → ${hit.url}` });
      results.push({
        username,
        profile_url: profileUrl,
        latest_post: hit.url,
        status: 'success',
      });
      success++;
    } else if (hit.empty) {
      onLog({ type: 'warn', message: `⚠️ @${username} — belum ada postingan` });
      results.push({
        username,
        profile_url: profileUrl,
        latest_post: profileUrl,
        status: 'empty',
      });
      failed++;
    } else if (hit.error) {
      onLog({ type: 'error', message: `❌ @${username} — ${hit.error}` });
      results.push({
        username,
        profile_url: profileUrl,
        latest_post: `Error: ${hit.error}`,
        status: 'error',
      });
      failed++;
    } else {
      onLog({ type: 'warn', message: `⚠️ @${username} — gagal ambil post, simpan link profil` });
      results.push({
        username,
        profile_url: profileUrl,
        latest_post: profileUrl,
        status: 'profile_only',
      });
      failed++;
    }

    if (i < usernames.length - 1) {
      await DELAY(RAND(800, 1400));
    }
  }

  onLog({ type: 'success', message: `🎉 Selesai! Postingan: ${success} | Gagal: ${failed}` });
  return {
    success: true,
    results,
    summary: { total: usernames.length, success, failed },
  };
}

function resultsToCsv(results) {
  const header = 'username,link_profil,latest_post,status';
  const rows = (results || []).map((r) =>
    `"${r.username}","${(r.profile_url || '').replace(/"/g, '""')}","${String(r.latest_post || '').replace(/"/g, '""')}","${r.status}"`
  );
  return [header, ...rows].join('\n');
}

module.exports = { instagramPostScraper, resultsToCsv, resolveInstagramLatestPost };
