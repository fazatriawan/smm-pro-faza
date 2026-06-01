const axios = require('axios');

const client = axios.create({
  timeout: 25_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
  },
});

const POST_RE =
  /https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[^\/?#\s]+\/post\/[A-Za-z0-9_-]{6,20}/gi;

const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));
const RAND = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function threadsProfileUrl(username) {
  return `https://www.threads.com/@${encodeURIComponent(username)}`;
}

function threadsHtmlLooksBlocked(html) {
  const s = String(html || '');
  if (s.length < 500) return true;
  if (/Log in to Threads|login_and_signup|accounts\/login/i.test(s)) return true;
  if (!/threads\.(?:net|com)\/@[^/"'\s]+\/post\//i.test(s)) return true;
  return false;
}

function extractLatestPostUrl(html) {
  const matches = [...String(html || '').matchAll(POST_RE)].map((m) => m[0]);
  const seen = new Set();
  for (const m of matches) {
    const s = String(m || '').trim().replace('threads.net', 'threads.com');
    if (!s || seen.has(s)) continue;
    seen.add(s);
    return s;
  }
  return null;
}

function profileOnlyResult(username) {
  const profileUrl = threadsProfileUrl(username);
  return {
    username,
    profile_url: profileUrl,
    latest_post: profileUrl,
    status: 'profile_only',
  };
}

/**
 * @param {{ usernames: string[], scrapePosts?: boolean, accountId?: string }} config
 * @param {(log: { type: string, message: string }) => void} onLog
 */
async function threadsPostScraper(config, onLog = () => {}) {
  const usernames = (config.usernames || [])
    .map((u) => String(u).replace(/^@/, '').trim())
    .filter(Boolean);

  if (!usernames.length) {
    throw new Error('Daftar username kosong');
  }

  const scrapePosts = config.scrapePosts !== false && Boolean(config.accountId);

  if (!scrapePosts) {
    onLog({ type: 'info', message: `📋 Mode tanpa login — generate ${usernames.length} link profil Threads` });
    const results = usernames.map(profileOnlyResult);
    onLog({ type: 'success', message: `✅ Selesai — ${results.length} link profil digenerate` });
    return {
      success: true,
      results,
      summary: { total: results.length, success: results.length, failed: 0 },
    };
  }

  onLog({ type: 'info', message: `🚀 Memulai scrape Threads — ${usernames.length} username` });

  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];
    const profileUrl = threadsProfileUrl(username);
    onLog({ type: 'info', message: `[${i + 1}/${usernames.length}] 🔍 Mengunjungi @${username}...` });

    try {
      const res = await client.get(profileUrl);
      const html = String(res.data || '');

      if (/Page Not Found|Halaman Tidak Ditemukan|Sorry, this page|tidak ditemukan/i.test(html)) {
        onLog({ type: 'warn', message: `⚠️ @${username} — profil tidak ditemukan` });
        results.push({
          username,
          profile_url: profileUrl,
          latest_post: 'Profil tidak ditemukan',
          status: 'not_found',
        });
        failed++;
        continue;
      }

      if (/This profile is private|Akun ini pribadi|private account/i.test(html)) {
        onLog({ type: 'warn', message: `🔒 @${username} — akun private` });
        results.push({
          username,
          profile_url: profileUrl,
          latest_post: 'Akun private',
          status: 'private',
        });
        failed++;
        continue;
      }

      if (threadsHtmlLooksBlocked(html)) {
        onLog({
          type: 'warn',
          message: `⚠️ @${username} — Threads memblokir scrape, simpan link profil`,
        });
        results.push({
          username,
          profile_url: profileUrl,
          latest_post: profileUrl,
          status: 'profile_only',
        });
        failed++;
        continue;
      }

      const postUrl = extractLatestPostUrl(html);
      if (postUrl) {
        onLog({ type: 'success', message: `✅ @${username} → ${postUrl}` });
        results.push({
          username,
          profile_url: profileUrl,
          latest_post: postUrl,
          status: 'success',
        });
        success++;
      } else {
        onLog({ type: 'warn', message: `⚠️ @${username} — tidak ada postingan, simpan link profil` });
        results.push({
          username,
          profile_url: profileUrl,
          latest_post: profileUrl,
          status: 'empty',
        });
        failed++;
      }
    } catch (err) {
      onLog({ type: 'error', message: `❌ @${username} — ${err.message}` });
      results.push({
        username,
        profile_url: profileUrl,
        latest_post: `Error: ${err.message}`,
        status: 'error',
      });
      failed++;
    }

    if (i < usernames.length - 1) {
      await DELAY(RAND(350, 650));
    }
  }

  onLog({ type: 'success', message: `🎉 Selesai! Berhasil: ${success} | Gagal: ${failed}` });
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

module.exports = { threadsPostScraper, resultsToCsv };
