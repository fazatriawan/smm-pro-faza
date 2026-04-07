const { chromium } = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth');

chromium.use(StealthPlugin());

let isRunning = false;
let currentBrowser = null;

async function startAutomation(config, settings, onLog) {
  if (isRunning) throw new Error('Automasi sedang berjalan');
  isRunning = true;

  const {
    accounts,
    platform,
    actions,
    targetUrls,
    durationPerAccount,
    commentTemplates
  } = config;

  const {
    headless = false,
    delayMin = 3,
    delayMax = 10,
    restBetweenAccounts = 60
  } = settings;

  onLog({ type: 'info', message: `Memulai automasi ${platform} untuk ${accounts.length} akun` });

  for (let i = 0; i < accounts.length; i++) {
    if (!isRunning) {
      onLog({ type: 'warn', message: 'Automasi dihentikan oleh pengguna' });
      break;
    }

    const account = accounts[i];
    onLog({ type: 'info', message: `[${i+1}/${accounts.length}] Memproses akun: ${account.username}` });

    let browser = null;
    let context = null;

    try {
      // Buka browser
      browser = await chromium.launch({
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      });
      currentBrowser = browser;

      // Buat context dengan data tersimpan jika ada
      const contextOptions = {
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'id-ID',
        timezoneId: 'Asia/Jakarta'
      };

      if (account.cookies) {
        contextOptions.storageState = JSON.parse(account.cookies);
      }

      context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      // Login jika belum ada cookies
      if (!account.cookies) {
        onLog({ type: 'info', message: `Login ke ${platform}...` });
        await loginToPlatform(page, platform, account, onLog);

        // Simpan cookies setelah login
        const storageState = await context.storageState();
        account.cookies = JSON.stringify(storageState);
        onLog({ type: 'success', message: `Login berhasil! Cookies disimpan.` });
      } else {
        onLog({ type: 'info', message: `Menggunakan sesi tersimpan...` });
      }

      // Jalankan aksi
      const startTime = Date.now();
      const maxDuration = (durationPerAccount || 5) * 60 * 1000;

      for (const targetUrl of targetUrls) {
        if (!isRunning) break;
        if (Date.now() - startTime > maxDuration) {
          onLog({ type: 'warn', message: `Waktu ${durationPerAccount} menit habis untuk akun ini` });
          break;
        }

        onLog({ type: 'info', message: `Membuka URL: ${targetUrl}` });

        for (const action of actions) {
          if (!isRunning) break;

          try {
            await performAction(page, platform, action, targetUrl, commentTemplates, onLog);
            
            // Jeda random antar aksi
            const delay = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
            onLog({ type: 'info', message: `Menunggu ${Math.round(delay/1000)} detik...` });
            await page.waitForTimeout(delay);
          } catch (actionErr) {
            onLog({ type: 'error', message: `Aksi ${action} gagal: ${actionErr.message}` });
          }
        }
      }

      onLog({ type: 'success', message: `Selesai untuk akun: ${account.username}` });

    } catch (err) {
      onLog({ type: 'error', message: `Error pada akun ${account.username}: ${err.message}` });
      
      // Hapus cookies jika login gagal
      if (err.message.includes('Login')) {
        account.cookies = null;
      }
    } finally {
      if (browser) await browser.close();
      currentBrowser = null;
    }

    // Jeda antar akun
    if (i < accounts.length - 1 && isRunning) {
      onLog({ type: 'info', message: `Istirahat ${restBetweenAccounts} detik sebelum akun berikutnya...` });
      await sleep(restBetweenAccounts * 1000);
    }
  }

  isRunning = false;
  onLog({ type: 'success', message: '✅ Semua akun selesai diproses!' });
}

async function loginToPlatform(page, platform, account, onLog) {
  switch (platform) {
    case 'facebook':
      await loginFacebook(page, account, onLog);
      break;
    case 'instagram':
      await loginInstagram(page, account, onLog);
      break;
    case 'tiktok':
      await loginTikTok(page, account, onLog);
      break;
    case 'twitter':
      await loginTwitter(page, account, onLog);
      break;
    default:
      throw new Error(`Platform ${platform} belum didukung`);
  }
}

async function loginFacebook(page, account, onLog) {
  await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle' });
  await page.fill('#email', account.username);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.fill('#pass', account.password);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.click('[name="login"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });

  if (page.url().includes('login') || page.url().includes('checkpoint')) {
    throw new Error('Login Facebook gagal — cek username/password atau ada verifikasi');
  }
  onLog({ type: 'success', message: 'Login Facebook berhasil!' });
}

async function loginInstagram(page, account, onLog) {
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('input[name="username"]', account.username);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.fill('input[name="password"]', account.password);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });

  if (page.url().includes('challenge') || page.url().includes('login')) {
    throw new Error('Login Instagram gagal — cek username/password atau ada verifikasi 2FA');
  }
  onLog({ type: 'success', message: 'Login Instagram berhasil!' });
}

async function loginTikTok(page, account, onLog) {
  await page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('input[name="username"]', account.username);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.fill('input[type="password"]', account.password);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  onLog({ type: 'success', message: 'Login TikTok berhasil!' });
}

async function loginTwitter(page, account, onLog) {
  await page.goto('https://twitter.com/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('input[autocomplete="username"]', account.username);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await page.fill('input[name="password"]', account.password);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.click('[data-testid="LoginForm_Login_Button"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  onLog({ type: 'success', message: 'Login Twitter berhasil!' });
}

async function performAction(page, platform, action, targetUrl, commentTemplates, onLog) {
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000 + Math.random() * 1000);

  switch (platform) {
    case 'facebook':
      await performFacebookAction(page, action, commentTemplates, onLog);
      break;
    case 'instagram':
      await performInstagramAction(page, action, commentTemplates, onLog);
      break;
    case 'tiktok':
      await performTikTokAction(page, action, commentTemplates, onLog);
      break;
    case 'twitter':
      await performTwitterAction(page, action, commentTemplates, onLog);
      break;
  }
}

async function performFacebookAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('[aria-label="Suka"], [aria-label="Like"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '👍 Like berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const commentBox = await page.waitForSelector('[aria-label="Tulis komentar…"], [aria-label="Write a comment…"]', { timeout: 5000 });
        await commentBox.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(comment, { delay: 50 + Math.random() * 50 });
        await page.keyboard.press('Enter');
        onLog({ type: 'success', message: `💬 Komentar "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Kolom komentar tidak ditemukan' });
      }
      break;

    case 'share':
      try {
        const shareBtn = await page.waitForSelector('[aria-label="Bagikan"], [aria-label="Share"]', { timeout: 5000 });
        await shareBtn.click();
        await page.waitForTimeout(1000);
        const shareToFeed = await page.waitForSelector('[aria-label="Bagikan sekarang"], [aria-label="Share now"]', { timeout: 5000 });
        await shareToFeed.click();
        onLog({ type: 'success', message: '🔄 Share berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol share tidak ditemukan' });
      }
      break;

    case 'scroll':
      await scrollPage(page, onLog);
      break;

    case 'add_friend':
      try {
        const addBtn = await page.waitForSelector('[aria-label="Tambah teman"], [aria-label="Add Friend"]', { timeout: 5000 });
        await addBtn.click();
        onLog({ type: 'success', message: '👤 Permintaan pertemanan dikirim!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol tambah teman tidak ditemukan' });
      }
      break;
  }
}

async function performInstagramAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('svg[aria-label="Suka"], svg[aria-label="Like"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '❤️ Like Instagram berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const commentBox = await page.waitForSelector('textarea[aria-label="Tambahkan komentar…"], textarea[aria-label="Add a comment…"]', { timeout: 5000 });
        await commentBox.click();
        await page.keyboard.type(comment, { delay: 50 + Math.random() * 50 });
        await page.keyboard.press('Enter');
        onLog({ type: 'success', message: `💬 Komentar Instagram "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Kolom komentar tidak ditemukan' });
      }
      break;

    case 'follow':
      try {
        const followBtn = await page.waitForSelector('button:has-text("Ikuti"), button:has-text("Follow")', { timeout: 5000 });
        await followBtn.click();
        onLog({ type: 'success', message: '✅ Follow Instagram berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol follow tidak ditemukan' });
      }
      break;

    case 'save':
      try {
        const saveBtn = await page.waitForSelector('svg[aria-label="Simpan"], svg[aria-label="Save"]', { timeout: 5000 });
        await saveBtn.click();
        onLog({ type: 'success', message: '🔖 Save Instagram berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol save tidak ditemukan' });
      }
      break;

    case 'scroll':
      await scrollPage(page, onLog);
      break;
  }
}

async function performTikTokAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('[data-e2e="like-icon"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '❤️ Like TikTok berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like TikTok tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const commentBox = await page.waitForSelector('[data-e2e="comment-input"]', { timeout: 5000 });
        await commentBox.click();
        await page.keyboard.type(comment, { delay: 50 + Math.random() * 50 });
        await page.keyboard.press('Enter');
        onLog({ type: 'success', message: `💬 Komentar TikTok "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Kolom komentar TikTok tidak ditemukan' });
      }
      break;

    case 'follow':
      try {
        const followBtn = await page.waitForSelector('[data-e2e="follow-button"]', { timeout: 5000 });
        await followBtn.click();
        onLog({ type: 'success', message: '✅ Follow TikTok berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol follow TikTok tidak ditemukan' });
      }
      break;

    case 'scroll':
      await scrollPage(page, onLog);
      break;
  }
}

async function performTwitterAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('[data-testid="like"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '❤️ Like Twitter berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like Twitter tidak ditemukan' });
      }
      break;

    case 'retweet':
      try {
        const rtBtn = await page.waitForSelector('[data-testid="retweet"]', { timeout: 5000 });
        await rtBtn.click();
        await page.waitForTimeout(500);
        const confirmRt = await page.waitForSelector('[data-testid="retweetConfirm"]', { timeout: 5000 });
        await confirmRt.click();
        onLog({ type: 'success', message: '🔄 Retweet berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol retweet tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const replyBtn = await page.waitForSelector('[data-testid="reply"]', { timeout: 5000 });
        await replyBtn.click();
        await page.waitForTimeout(1000);
        await page.keyboard.type(comment, { delay: 50 + Math.random() * 50 });
        await page.keyboard.press('Control+Enter');
        onLog({ type: 'success', message: `💬 Reply Twitter "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Tombol reply tidak ditemukan' });
      }
      break;

    case 'follow':
      try {
        const followBtn = await page.waitForSelector('[data-testid="follow"]', { timeout: 5000 });
        await followBtn.click();
        onLog({ type: 'success', message: '✅ Follow Twitter berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol follow tidak ditemukan' });
      }
      break;
  }
}

async function scrollPage(page, onLog) {
  onLog({ type: 'info', message: '📜 Scrolling halaman...' });
  const scrollTimes = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < scrollTimes; i++) {
    await page.mouse.wheel(0, 300 + Math.random() * 300);
    await page.waitForTimeout(500 + Math.random() * 1000);
  }
  onLog({ type: 'success', message: `Scroll ${scrollTimes}x selesai` });
}

function stopAutomation() {
  isRunning = false;
  if (currentBrowser) {
    currentBrowser.close().catch(() => {});
    currentBrowser = null;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { startAutomation, stopAutomation };
