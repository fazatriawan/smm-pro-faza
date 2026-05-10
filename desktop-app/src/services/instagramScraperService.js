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
  if (!account) throw new Error('Pilih akun Instagram terlebih dahulu');
  if (!usernames || usernames.length === 0) throw new Error('Daftar username kosong');

  const safeName = account.username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `instagram_${safeName}`);

  onLog({ type: 'info', message: `🚀 Memulai scraper dengan akun @${account.username}` });
  onLog({ type: 'info', message: `📋 Total target: ${usernames.length} username` });

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
      throw new Error(`Akun @${account.username} belum login di Instagram. Jalankan session login dulu.`);
    }
    onLog({ type: 'success', message: `✅ Login terdeteksi untuk @${account.username}` });

    const results = [];
    let success = 0, failed = 0;

    for (let i = 0; i < usernames.length; i++) {
      const username = usernames[i].replace('@', '').trim();
      if (!username) continue;

      onLog({ type: 'info', message: `[${i + 1}/${usernames.length}] 🔍 Mengunjungi @${username}...` });

      try {
        await page.goto(`https://www.instagram.com/${username}/`, {
          waitUntil: 'networkidle2',
          timeout: 20000,
        });
        await DELAY(RAND(2500, 4000));

        // Cek apakah profil ditemukan
        const notFound = await page.$('h2[class*="error"]') ||
          (await page.title()).includes('Page Not Found');
        if (notFound) {
          onLog({ type: 'warn', message: `⚠️ @${username} — profil tidak ditemukan` });
          results.push({ username, latest_post: 'Profil tidak ditemukan', status: 'not_found' });
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
          results.push({ username, latest_post: 'Akun private', status: 'private' });
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
          results.push({ username, latest_post: postUrl, status: 'success' });
          success++;
        } else {
          onLog({ type: 'warn', message: `⚠️ @${username} — tidak ada postingan` });
          results.push({ username, latest_post: 'Tidak ada postingan', status: 'empty' });
          failed++;
        }
      } catch (err) {
        onLog({ type: 'error', message: `❌ @${username} — ${err.message}` });
        results.push({ username, latest_post: `Error: ${err.message}`, status: 'error' });
        failed++;
      }

      // Jeda antar username
      if (i < usernames.length - 1) {
        const jeda = RAND(2000, 4000);
        onLog({ type: 'info', message: `⏳ Jeda ${(jeda / 1000).toFixed(1)}s...` });
        await DELAY(jeda);
      }
    }

    onLog({ type: 'success', message: `🎉 Selesai! Berhasil: ${success} | Gagal: ${failed}` });
    return { success: true, results, summary: { total: usernames.length, success, failed } };

  } finally {
    if (browser) await browser.close();
  }
}

function exportToCsv(results, filePath) {
  const header = 'username,latest_post,status';
  const rows = results.map(r =>
    `"${r.username}","${r.latest_post.replace(/"/g, '""')}","${r.status}"`
  );
  fs.writeFileSync(filePath, [header, ...rows].join('\n'), 'utf-8');
}

module.exports = { instagramScraper, exportToCsv };
