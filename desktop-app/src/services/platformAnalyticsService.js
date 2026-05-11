const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');
const path = require('path');
const os = require('os');

puppeteer.use(StealthPlugin());

const DELAY = ms => new Promise(r => setTimeout(r, ms));

// Parse angka dari format "1.2K", "12,345", "1.2M", "1.2 jt", "10 rb"
function parseCount(str) {
  if (!str) return null;
  str = String(str).trim().replace(/\s+/g, '').replace(/,/g, '.');

  // Indonesian: 1,2 jt = 1.2M, 10 rb = 10K
  if (/jt/i.test(str)) return Math.round(parseFloat(str) * 1_000_000);
  if (/rb/i.test(str)) return Math.round(parseFloat(str) * 1_000);

  // English/standard
  const n = parseFloat(str);
  if (/[Kk]/.test(str)) return Math.round(n * 1_000);
  if (/[Mm]/.test(str)) return Math.round(n * 1_000_000);
  if (/[Bb]/.test(str)) return Math.round(n * 1_000_000_000);
  return isNaN(n) ? null : Math.round(n);
}

function formatCount(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'K';
  return n.toLocaleString('id-ID');
}

function getBrowserDir(platform, username) {
  const safe = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(os.homedir(), '.smm-pro-profiles', `${platform}_${safe}`);
}

async function launchBrowser(profileDir, headless = false) {
  return puppeteer.launch({
    headless,
    userDataDir: profileDir,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-notifications',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
}

// ── Generic text-based stat extraction ──────────────────────────────────────

async function extractTextStats(page, patterns) {
  return page.evaluate((patterns) => {
    const body = document.body?.innerText || '';
    const result = {};
    for (const [key, regexes] of Object.entries(patterns)) {
      for (const re of regexes) {
        const m = body.match(new RegExp(re, 'i'));
        if (m) { result[key] = m[1]; break; }
      }
    }
    return result;
  }, patterns);
}

// ── INSTAGRAM ───────────────────────────────────────────────────────────────

async function scrapeInstagram(account, settings, onLog) {
  const dir = getBrowserDir('instagram', account.username);
  onLog({ type: 'info', message: `📊 Instagram: mengunjungi @${account.username}...` });

  const browser = await launchBrowser(dir, settings.headless || false);
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'id-ID,id;q=0.9' });
    await page.goto(`https://www.instagram.com/${account.username}/`, {
      waitUntil: 'networkidle2', timeout: 25000,
    });
    await DELAY(2500);

    // Try span[title] approach (most reliable on IG web)
    const rawStats = await page.evaluate(() => {
      // span with title attributes usually have the exact counts
      const spans = Array.from(document.querySelectorAll('span[title]'));
      const nums = spans.filter(s => /^[\d,.]+[KMBjtrb]?$/i.test(s.getAttribute('title')?.trim()));

      // Also try meta description
      const meta = document.querySelector('meta[name="description"]')?.content || '';

      // Generic text extraction
      const txt = document.body?.innerText || '';
      return { nums: nums.map(s => s.getAttribute('title')), meta, txt: txt.slice(0, 3000) };
    });

    let followers = null, following = null, posts = null;

    // Instagram stat order in span[title]: Posts, Followers, Following
    if (rawStats.nums.length >= 3) {
      posts     = parseCount(rawStats.nums[0]);
      followers = parseCount(rawStats.nums[1]);
      following = parseCount(rawStats.nums[2]);
    }

    // Fallback: text patterns
    if (followers === null) {
      const txt = rawStats.txt;
      const fMatch  = txt.match(/([\d,.]+\s*(?:jt|rb|[KMB])?)\s*(?:Followers|Pengikut)/i);
      const foMatch = txt.match(/([\d,.]+\s*(?:jt|rb|[KMB])?)\s*(?:Following|Mengikuti)/i);
      const pMatch  = txt.match(/([\d,.]+\s*(?:jt|rb|[KMB])?)\s*(?:Posts|Postingan)/i);
      if (fMatch)  followers = parseCount(fMatch[1]);
      if (foMatch) following = parseCount(foMatch[1]);
      if (pMatch)  posts     = parseCount(pMatch[1]);
    }

    const result = {
      platform: 'instagram', username: account.username,
      profileUrl: `https://www.instagram.com/${account.username}/`,
      followers, following, posts,
      extra: {},
      scrapedAt: new Date().toISOString(),
    };

    onLog({ type: 'success', message: `✅ Instagram @${account.username}: ${formatCount(followers)} followers · ${formatCount(posts)} posts` });
    return result;
  } finally {
    await browser.close();
  }
}

// ── TWITTER/X ────────────────────────────────────────────────────────────────

async function scrapeTwitter(account, settings, onLog) {
  const dir = getBrowserDir('twitter', account.username);
  onLog({ type: 'info', message: `📊 Twitter: mengunjungi @${account.username}...` });

  const browser = await launchBrowser(dir, settings.headless || false);
  try {
    const page = await browser.newPage();
    await page.goto(`https://twitter.com/${account.username}`, {
      waitUntil: 'networkidle2', timeout: 25000,
    });
    await DELAY(3000);

    const raw = await page.evaluate(() => {
      const txt = document.body?.innerText || '';
      // Find links with "following" and "followers" text — Twitter uses <a> with count
      const links = Array.from(document.querySelectorAll('a[href*="following"], a[href*="followers"]'));
      const statLinks = links.map(l => l.innerText?.trim());
      return { txt: txt.slice(0, 4000), statLinks };
    });

    let followers = null, following = null;

    // Try href links first (most reliable)
    for (const text of raw.statLinks) {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const count = parseCount(lines[0]);
        const label = lines[1].toLowerCase();
        if (label.includes('follow') && !label.includes('ers')) following = count;
        if (label.includes('followers')) followers = count;
      }
    }

    // Fallback text patterns
    if (followers === null) {
      const fMatch  = raw.txt.match(/([\d,.]+\s*[KMB]?)\s*Followers/i);
      const foMatch = raw.txt.match(/([\d,.]+\s*[KMB]?)\s*Following/i);
      if (fMatch)  followers = parseCount(fMatch[1]);
      if (foMatch) following = parseCount(foMatch[1]);
    }

    const result = {
      platform: 'twitter', username: account.username,
      profileUrl: `https://twitter.com/${account.username}`,
      followers, following, posts: null,
      extra: {},
      scrapedAt: new Date().toISOString(),
    };

    onLog({ type: 'success', message: `✅ Twitter @${account.username}: ${formatCount(followers)} followers` });
    return result;
  } finally {
    await browser.close();
  }
}

// ── TIKTOK ──────────────────────────────────────────────────────────────────

async function scrapeTikTok(account, settings, onLog) {
  const dir = getBrowserDir('tiktok', account.username);
  onLog({ type: 'info', message: `📊 TikTok: mengunjungi @${account.username}...` });

  const browser = await launchBrowser(dir, settings.headless || false);
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'id-ID,id;q=0.9' });
    await page.goto(`https://www.tiktok.com/@${account.username}`, {
      waitUntil: 'networkidle2', timeout: 25000,
    });
    await DELAY(3000);

    const raw = await page.evaluate(() => {
      const txt = document.body?.innerText || '';
      // TikTok profile shows: "X Following · X Followers · X Likes"
      return { txt: txt.slice(0, 4000) };
    });

    const txt = raw.txt;
    const foMatch = txt.match(/([\d,.]+\s*[KMBjtrb]?)\s*Following/i);
    const fMatch  = txt.match(/([\d,.]+\s*[KMBjtrb]?)\s*Followers/i);
    const lMatch  = txt.match(/([\d,.]+\s*[KMBjtrb]?)\s*Likes/i);

    const result = {
      platform: 'tiktok', username: account.username,
      profileUrl: `https://www.tiktok.com/@${account.username}`,
      followers: fMatch ? parseCount(fMatch[1]) : null,
      following: foMatch ? parseCount(foMatch[1]) : null,
      posts: null,
      extra: { likes: lMatch ? parseCount(lMatch[1]) : null },
      scrapedAt: new Date().toISOString(),
    };

    onLog({ type: 'success', message: `✅ TikTok @${account.username}: ${formatCount(result.followers)} followers · ${formatCount(result.extra.likes)} likes` });
    return result;
  } finally {
    await browser.close();
  }
}

// ── YOUTUBE via RSS (tanpa API key) ─────────────────────────────────────────

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SMM-Pro-Desktop/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Try to resolve YouTube channel ID from various URL formats
async function resolveYouTubeChannelId(input) {
  // Already a channel ID
  if (/^UC[\w-]{22}$/.test(input)) return input;

  // Extract from URL
  const channelIdMatch = input.match(/channel\/(UC[\w-]{22})/);
  if (channelIdMatch) return channelIdMatch[1];

  // For handle-based URLs, need to scrape the channel page
  let handle = input.replace(/^.*youtube\.com\/@?/, '').replace(/\/$/, '');
  if (!handle) return null;

  const page = await fetchText(`https://www.youtube.com/@${handle}`);
  const idMatch = page.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/);
  return idMatch?.[1] || null;
}

async function scrapeYouTube(account, settings, onLog) {
  onLog({ type: 'info', message: `📊 YouTube: mengambil data @${account.username} via RSS...` });

  try {
    const channelId = await resolveYouTubeChannelId(account.youtubeChannelId || account.username);
    if (!channelId) throw new Error('Channel ID YouTube tidak ditemukan. Isi youtubeChannelId di data akun.');

    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const xml = await fetchText(rssUrl);

    // Parse subscriber count from channel page
    const channelPage = await fetchText(`https://www.youtube.com/channel/${channelId}`);
    const subMatch = channelPage.match(/"subscriberCountText"\s*:\s*\{[^}]*"simpleText"\s*:\s*"([^"]+)"/);
    const subsRaw = subMatch?.[1] || null;

    // Parse video count from RSS
    const videoMatches = xml.match(/<entry>/g);
    const videoCount = videoMatches ? videoMatches.length : null;

    // Latest video title & URL
    const titleMatch = xml.match(/<media:title>(.*?)<\/media:title>/);
    const latestTitle = titleMatch?.[1] || '';
    const linkMatch = xml.match(/<link rel="alternate" href="([^"]+)"/);
    const latestVideoUrl = linkMatch?.[1] || '';

    const result = {
      platform: 'youtube', username: account.username,
      profileUrl: `https://www.youtube.com/channel/${channelId}`,
      followers: subsRaw ? parseCount(subsRaw) : null,
      following: null,
      posts: videoCount,
      extra: { channelId, latestTitle, latestVideoUrl, subsRaw },
      scrapedAt: new Date().toISOString(),
    };

    onLog({ type: 'success', message: `✅ YouTube @${account.username}: ${subsRaw || '?'} subscribers · ${videoCount || '?'} videos di RSS` });
    return result;
  } catch (err) {
    onLog({ type: 'warn', message: `⚠️ YouTube scrape fallback: ${err.message}` });
    return {
      platform: 'youtube', username: account.username,
      profileUrl: `https://www.youtube.com/@${account.username}`,
      followers: null, following: null, posts: null,
      extra: { error: err.message },
      scrapedAt: new Date().toISOString(),
    };
  }
}

// ── MAIN: scrape by platform ─────────────────────────────────────────────────

async function scrapeAnalytics(account, settings, onLog) {
  try {
    switch (account.platform) {
      case 'instagram': return await scrapeInstagram(account, settings, onLog);
      case 'twitter':   return await scrapeTwitter(account, settings, onLog);
      case 'tiktok':    return await scrapeTikTok(account, settings, onLog);
      case 'youtube':   return await scrapeYouTube(account, settings, onLog);
      default:
        onLog({ type: 'warn', message: `⚠️ Platform ${account.platform} belum didukung untuk analytics scraping` });
        return {
          platform: account.platform, username: account.username,
          profileUrl: null, followers: null, following: null, posts: null,
          extra: {}, scrapedAt: new Date().toISOString(),
        };
    }
  } catch (err) {
    onLog({ type: 'error', message: `❌ Gagal scrape ${account.platform} @${account.username}: ${err.message}` });
    return {
      platform: account.platform, username: account.username,
      profileUrl: null, followers: null, following: null, posts: null,
      extra: { error: err.message }, scrapedAt: new Date().toISOString(),
    };
  }
}

module.exports = { scrapeAnalytics, formatCount };
