const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const os = require('os');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const DELAY = (ms) => new Promise(r => setTimeout(r, ms));
const RAND = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function instagramScraper(config, settings, onLog) {
  const { account, usernames } = config;
  if (!usernames || usernames.length === 0) throw new Error('Daftar username kosong');

  const cleanUsernames = usernames.map(u => u.replace('@', '').trim()).filter(u => u);

  // Mode tanpa login: langsung generate link profil, tidak perlu browser
  if (!account) {
    onLog({ type: 'info', message: `📋 Mode tanpa login — generate ${cleanUsernames.length} link profil` });
    const results = cleanUsernames.map(username => ({
      username,
      profile_url: `https://www.instagram.com/${username}/`,
      latest_post: `https://www.instagram.com/${username}/`,
      status: 'profile_only',
    }));
    onLog({ type: 'success', message: `✅ Selesai — ${results.length} link profil digenerate` });
    return {
      success: true,
      results,
      summary: { total: results.length, success: results.length, failed: 0 },
    };
  }

  // Mode dengan login: scraping postingan terbaru
  const safeName = account.username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `instagram_${safeName}`);

  onLog({ type: 'info', message: `🚀 Memulai scraper dengan akun @${account.username}` });
  onLog({ type: 'info', message: `📋 Total target: ${cleanUsernames.length} username` });

  const headless = settings.headless !== undefined ? settings.headless : false;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless,
      userDataDir: profileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-notifications',
        '--lang=id-ID,id',
      ],
      defaultViewport: { width: 1280, height: 800 },
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'id-ID,id;q=0.9' });

    // Cek status login
    onLog({ type: 'info', message: '🔐 Mengecek status login...' });
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await DELAY(2000);

    const isLoginPage = page.url().includes('accounts/login') || page.url().includes('challenge');
    if (isLoginPage) {
      // Fallback ke mode profil saja
      onLog({ type: 'warn', message: `⚠️ @${account.username} belum login — beralih ke mode link profil` });
      await browser.close();
      browser = null;

      const results = cleanUsernames.map(username => ({
        username,
        profile_url: `https://www.instagram.com/${username}/`,
        latest_post: `https://www.instagram.com/${username}/`,
        status: 'profile_only',
      }));
      onLog({ type: 'info', message: `📋 ${results.length} link profil digenerate (tanpa login)` });
      return {
        success: true,
        results,
        summary: { total: results.length, success: results.length, failed: 0 },
      };
    }

    onLog({ type: 'success', message: `✅ Login terdeteksi untuk @${account.username}` });

    const results = [];
    let success = 0, failed = 0;

    for (let i = 0; i < cleanUsernames.length; i++) {
      const username = cleanUsernames[i];

      onLog({ type: 'info', message: `[${i + 1}/${cleanUsernames.length}] 🔍 Mengunjungi @${username}...` });

      const profileUrl = `https://www.instagram.com/${username}/`;

      try {
        await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await DELAY(RAND(2500, 4000));

        // Cek profil tidak ditemukan
        const notFound = await page.$('h2[class*="error"]') ||
          (await page.title()).includes('Page Not Found');
        if (notFound) {
          onLog({ type: 'warn', message: `⚠️ @${username} — profil tidak ditemukan` });
          results.push({ username, profile_url: profileUrl, latest_post: 'Profil tidak ditemukan', status: 'not_found' });
          failed++;
          continue;
        }

        // Cek akun private
        const isPrivate = await page.evaluate(() => {
          const texts = Array.from(document.querySelectorAll('h2, p, span')).map(el => el.textContent);
          return texts.some(t => t.includes('This Account is Private') || t.includes('Akun ini pribadi'));
        });
        if (isPrivate) {
          onLog({ type: 'warn', message: `🔒 @${username} — akun private` });
          results.push({ username, profile_url: profileUrl, latest_post: 'Akun private', status: 'private' });
          failed++;
          continue;
        }

        // Ambil link postingan terbaru
        const postUrl = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          const postLinks = anchors
            .map(a => a.getAttribute('href'))
            .filter(href => href && (href.includes('/p/') || href.includes('/reel/')));
          const unique = [...new Set(postLinks)];
          return unique.length > 0 ? 'https://www.instagram.com' + unique[0] : null;
        });

        if (postUrl) {
          onLog({ type: 'success', message: `✅ @${username} → ${postUrl}` });
          results.push({ username, profile_url: profileUrl, latest_post: postUrl, status: 'success' });
          success++;
        } else {
          onLog({ type: 'warn', message: `⚠️ @${username} — tidak ada postingan, simpan link profil` });
          results.push({ username, profile_url: profileUrl, latest_post: profileUrl, status: 'empty' });
          failed++;
        }
      } catch (err) {
        onLog({ type: 'error', message: `❌ @${username} — ${err.message}` });
        results.push({ username, profile_url: profileUrl, latest_post: `Error: ${err.message}`, status: 'error' });
        failed++;
      }

      // Jeda antar username
      if (i < cleanUsernames.length - 1) {
        const jeda = RAND(2000, 4000);
        onLog({ type: 'info', message: `⏳ Jeda ${(jeda / 1000).toFixed(1)}s...` });
        await DELAY(jeda);
      }
    }

    onLog({ type: 'success', message: `🎉 Selesai! Berhasil: ${success} | Gagal: ${failed}` });
    return { success: true, results, summary: { total: cleanUsernames.length, success, failed } };

  } finally {
    if (browser) await browser.close();
  }
}

function exportToCsv(results, filePath) {
  const header = 'username,link_profil,latest_post,status';
  const rows = results.map(r =>
    `"${r.username}","${(r.profile_url || '').replace(/"/g, '""')}","${r.latest_post.replace(/"/g, '""')}","${r.status}"`
  );
  fs.writeFileSync(filePath, [header, ...rows].join('\n'), 'utf-8');
}

module.exports = { instagramScraper, exportToCsv };
