const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const os = require('os');

puppeteer.use(StealthPlugin());

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
      browser = await puppeteer.launch({
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
    case 'youtube':
      await loginYouTube(page, account, onLog);
      break;
    case 'threads':
      await loginThreads(page, account, onLog);
      break;
    default:
      throw new Error(`Platform ${platform} belum didukung`);
  }
}

async function loginYouTube(page, account, onLog) {
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"]', account.username);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.fill('input[type="password"]', account.password);
  await page.keyboard.press('Enter');
  try { await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }); } catch {}
  if (page.url().includes('challenge') || page.url().includes('signin/v2/challenge')) {
    onLog({ type: 'warn', message: '🔐 Terdeteksi 2FA Google...' });
    await handle2FA(page, account, onLog);
    try { await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }); } catch {}
  }
  await page.goto('https://www.youtube.com', { waitUntil: 'networkidle' });
  onLog({ type: 'success', message: '✅ Login YouTube berhasil!' });
}

async function loginThreads(page, account, onLog) {
  await page.goto('https://www.threads.net/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('input[autocomplete="username"]', account.username);
  await page.waitForTimeout(500);
  await page.fill('input[type="password"]', account.password);
  await page.waitForTimeout(500);
  await page.click('div[role="button"]:has-text("Log in"), button:has-text("Log in")');
  try { await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }); } catch {}
  onLog({ type: 'success', message: '✅ Login Threads berhasil!' });
}

async function handle2FA(page, account, onLog) {
  const { twoFAType, twoFactorSecret } = account;

  if (twoFAType === 'totp' && twoFactorSecret) {
    onLog({ type: 'info', message: '🔐 Mendeteksi 2FA TOTP, generate kode...' });
    try {
      const totp = generateTOTP(twoFactorSecret);
      onLog({ type: 'info', message: `🔑 Kode 2FA: ${totp}` });

      // Coba isi kode 2FA otomatis
      const codeInput = await page.waitForSelector(
        'input[name="approvals_code"], input[id="approvals_code"], input[placeholder*="code"], input[placeholder*="kode"], input[type="tel"]',
        { timeout: 10000 }
      ).catch(() => null);

      if (codeInput) {
        await codeInput.fill(totp);
        await page.waitForTimeout(500);
        const submitBtn = await page.$('button[type="submit"], button:has-text("Lanjutkan"), button:has-text("Continue")');
        if (submitBtn) await submitBtn.click();
        onLog({ type: 'success', message: '✅ Kode 2FA berhasil diisi otomatis!' });
      }
    } catch (err) {
      onLog({ type: 'warn', message: `2FA error: ${err.message}` });
    }
  } else if (twoFAType === 'email') {
    onLog({ type: 'warn', message: '⚠️ 2FA Email/SMS terdeteksi — silakan isi kode secara manual di browser yang terbuka. App akan menunggu 60 detik...' });
    await page.waitForTimeout(60000);
  }
}

function generateTOTP(secret) {
  // Implementasi TOTP sederhana
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanSecret = secret.toUpperCase().replace(/\s/g, '');
  
  let bits = '';
  for (const char of cleanSecret) {
    const val = base32Chars.indexOf(char);
    if (val >= 0) bits += val.toString(2).padStart(5, '0');
  }
  
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30);
  
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  timeBuffer.writeUInt32BE(timeStep & 0xffffffff, 4);
  
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha1', Buffer.from(bytes));
  hmac.update(timeBuffer);
  const hash = hmac.digest();
  
  const offset = hash[hash.length - 1] & 0xf;
  const code = ((hash[offset] & 0x7f) << 24) |
               ((hash[offset + 1] & 0xff) << 16) |
               ((hash[offset + 2] & 0xff) << 8) |
               (hash[offset + 3] & 0xff);
  
  return String(code % 1000000).padStart(6, '0');
}

async function loginFacebook(page, account, onLog) {
  await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle' });
  await page.fill('#email', account.username);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.fill('#pass', account.password);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.click('[name="login"]');
  
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
  } catch {}

  // Handle 2FA jika ada
  if (page.url().includes('checkpoint') || page.url().includes('two_step') || page.url().includes('login')) {
    onLog({ type: 'warn', message: '🔐 Terdeteksi halaman verifikasi...' });
    await handle2FA(page, account, onLog);
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
    } catch {}
  }

  if (page.url().includes('login') && !page.url().includes('facebook.com/') ) {
    throw new Error('Login Facebook gagal — cek username/password');
  }
  onLog({ type: 'success', message: '✅ Login Facebook berhasil!' });
}

async function loginInstagram(page, account, onLog) {
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('input[name="username"]', account.username);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.fill('input[name="password"]', account.password);
  await page.waitForTimeout(500 + Math.random() * 500);
  await page.click('button[type="submit"]');

  try {
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
  } catch {}

  // Handle 2FA
  if (page.url().includes('challenge') || page.url().includes('two_factor')) {
    onLog({ type: 'warn', message: '🔐 Terdeteksi 2FA Instagram...' });
    await handle2FA(page, account, onLog);
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
    } catch {}
  }

  onLog({ type: 'success', message: '✅ Login Instagram berhasil!' });
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
    case 'youtube':
      await performYouTubeAction(page, action, commentTemplates, onLog);
      break;
    case 'threads':
      await performThreadsAction(page, action, commentTemplates, onLog);
      break;
  }
}

async function performFacebookAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('[aria-label="Suka"], [aria-label="Like"], [aria-label="Sukai"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '👍 Like Facebook berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const commentBox = await page.waitForSelector('[aria-label="Tulis komentar…"], [aria-label="Write a comment…"], [aria-label="Tinggalkan komentar"]', { timeout: 5000 });
        await commentBox.click();
        await page.waitForTimeout(800);
        await page.keyboard.type(comment, { delay: 60 + Math.random() * 60 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        onLog({ type: 'success', message: `💬 Komentar Facebook "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Kolom komentar tidak ditemukan' });
      }
      break;

    case 'share':
      try {
        const shareBtn = await page.waitForSelector('[aria-label="Bagikan"], [aria-label="Share"], [aria-label="Kirim"]', { timeout: 5000 });
        await shareBtn.click();
        await page.waitForTimeout(1000);
        const shareNow = await page.$('[aria-label="Bagikan sekarang"], [aria-label="Share now"]');
        if (shareNow) await shareNow.click();
        onLog({ type: 'success', message: '↗ Share Facebook berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol share tidak ditemukan' });
      }
      break;

    case 'scroll':
      await scrollPage(page, onLog);
      break;

    case 'add_friend':
      try {
        const addBtn = await page.waitForSelector('[aria-label="Tambah teman"], [aria-label="Add Friend"], [aria-label="Tambahkan sebagai teman"]', { timeout: 5000 });
        await addBtn.click();
        onLog({ type: 'success', message: '👤 Permintaan pertemanan dikirim!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol tambah teman tidak ditemukan' });
      }
      break;

    case 'follow_page':
      try {
        const followBtn = await page.waitForSelector('[aria-label="Ikuti"], [aria-label="Follow"], [aria-label="Sukai Halaman"]', { timeout: 5000 });
        await followBtn.click();
        onLog({ type: 'success', message: '📌 Follow Page berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol follow page tidak ditemukan' });
      }
      break;
  }
}

async function performInstagramAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('svg[aria-label="Suka"], svg[aria-label="Like"], svg[aria-label="Unlike"]', { timeout: 5000 });
        const ariaLabel = await likeBtn.getAttribute('aria-label');
        if (ariaLabel === 'Unlike' || ariaLabel === 'Sudah Suka') {
          onLog({ type: 'warn', message: 'Sudah di-like sebelumnya' });
        } else {
          await likeBtn.click();
          onLog({ type: 'success', message: '❤️ Like Instagram berhasil!' });
        }
      } catch {
        onLog({ type: 'warn', message: 'Tombol like tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const commentBox = await page.waitForSelector('textarea[aria-label="Tambahkan komentar…"], textarea[aria-label="Add a comment…"]', { timeout: 5000 });
        await commentBox.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(comment, { delay: 60 + Math.random() * 60 });
        await page.waitForTimeout(500);
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
        onLog({ type: 'warn', message: 'Tombol follow tidak ditemukan atau sudah follow' });
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

    case 'story_view':
      try {
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
        const story = await page.$('div[role="button"] canvas, div[role="button"] img[alt*="story"]');
        if (story) {
          await story.click();
          await page.waitForTimeout(3000 + Math.random() * 2000);
          onLog({ type: 'success', message: '👁 Lihat Story Instagram berhasil!' });
        }
      } catch {
        onLog({ type: 'warn', message: 'Story tidak ditemukan' });
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
        const likeBtn = await page.waitForSelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '❤️ Like TikTok berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like TikTok tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const commentBox = await page.waitForSelector('[data-e2e="comment-input"], [data-e2e="comment-text"]', { timeout: 5000 });
        await commentBox.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(comment, { delay: 60 + Math.random() * 60 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        onLog({ type: 'success', message: `💬 Komentar TikTok "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Kolom komentar TikTok tidak ditemukan' });
      }
      break;

    case 'share':
      try {
        const shareBtn = await page.waitForSelector('[data-e2e="share-icon"], [data-e2e="browse-share-icon"]', { timeout: 5000 });
        await shareBtn.click();
        onLog({ type: 'success', message: '↗ Share TikTok berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol share TikTok tidak ditemukan' });
      }
      break;

    case 'follow':
      try {
        const followBtn = await page.waitForSelector('[data-e2e="follow-button"], [data-e2e="browse-follow-button"]', { timeout: 5000 });
        await followBtn.click();
        onLog({ type: 'success', message: '✅ Follow TikTok berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol follow TikTok tidak ditemukan atau sudah follow' });
      }
      break;

    case 'save':
      try {
        const saveBtn = await page.waitForSelector('[data-e2e="undefined-icon"], [aria-label="Tambahkan ke Favorit"]', { timeout: 5000 });
        await saveBtn.click();
        onLog({ type: 'success', message: '🔖 Favorit TikTok berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol favorit TikTok tidak ditemukan' });
      }
      break;

    case 'scroll':
      await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'networkidle' });
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
        await page.waitForTimeout(800);
        const confirmRt = await page.waitForSelector('[data-testid="retweetConfirm"]', { timeout: 5000 });
        await confirmRt.click();
        onLog({ type: 'success', message: '🔄 Retweet Twitter berhasil!' });
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
        await page.keyboard.type(comment, { delay: 60 + Math.random() * 60 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+Enter');
        onLog({ type: 'success', message: `💬 Reply Twitter "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Tombol reply tidak ditemukan' });
      }
      break;

    case 'bookmark':
      try {
        const bookmarkBtn = await page.waitForSelector('[data-testid="bookmark"]', { timeout: 5000 });
        await bookmarkBtn.click();
        onLog({ type: 'success', message: '🔖 Bookmark Twitter berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol bookmark tidak ditemukan' });
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

    case 'scroll':
      await scrollPage(page, onLog);
      break;
  }
}

async function performYouTubeAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('button[aria-label*="like this video"], button[aria-label*="Suka video"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '👍 Like YouTube berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like YouTube tidak ditemukan' });
      }
      break;

    case 'dislike':
      try {
        const dislikeBtn = await page.waitForSelector('button[aria-label*="dislike this video"], button[aria-label*="Tidak suka"]', { timeout: 5000 });
        await dislikeBtn.click();
        onLog({ type: 'success', message: '👎 Dislike YouTube berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol dislike YouTube tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        await page.waitForSelector('#comments', { timeout: 10000 });
        await page.evaluate(() => document.querySelector('#comments').scrollIntoView());
        await page.waitForTimeout(1000);
        const commentBox = await page.waitForSelector('#simplebox-placeholder, [aria-label="Tambahkan komentar…"]', { timeout: 5000 });
        await commentBox.click();
        await page.waitForTimeout(800);
        await page.keyboard.type(comment, { delay: 60 + Math.random() * 60 });
        await page.waitForTimeout(500);
        const submitBtn = await page.waitForSelector('#submit-button', { timeout: 5000 });
        await submitBtn.click();
        onLog({ type: 'success', message: `💬 Komentar YouTube "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Kolom komentar YouTube tidak ditemukan' });
      }
      break;

    case 'subscribe':
      try {
        const subBtn = await page.waitForSelector('button[aria-label*="Subscribe"], button[aria-label*="Berlangganan"]', { timeout: 5000 });
        await subBtn.click();
        onLog({ type: 'success', message: '🔔 Subscribe YouTube berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol subscribe tidak ditemukan atau sudah subscribe' });
      }
      break;

    case 'save':
      try {
        const saveBtn = await page.waitForSelector('button[aria-label*="Save"], button[aria-label*="Simpan"]', { timeout: 5000 });
        await saveBtn.click();
        await page.waitForTimeout(500);
        const saveToPlaylist = await page.$('tp-yt-paper-checkbox');
        if (saveToPlaylist) await saveToPlaylist.click();
        onLog({ type: 'success', message: '📋 Save YouTube berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol save tidak ditemukan' });
      }
      break;

    case 'scroll':
      await scrollPage(page, onLog);
      break;
  }
}

async function performThreadsAction(page, action, commentTemplates, onLog) {
  switch (action) {
    case 'like':
      try {
        const likeBtn = await page.waitForSelector('svg[aria-label="Like"], div[aria-label="Like"]', { timeout: 5000 });
        await likeBtn.click();
        onLog({ type: 'success', message: '❤️ Like Threads berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol like Threads tidak ditemukan' });
      }
      break;

    case 'comment':
      try {
        const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const replyBtn = await page.waitForSelector('svg[aria-label="Reply"], div[aria-label="Reply"]', { timeout: 5000 });
        await replyBtn.click();
        await page.waitForTimeout(1000);
        await page.keyboard.type(comment, { delay: 60 + Math.random() * 60 });
        await page.waitForTimeout(500);
        const postBtn = await page.waitForSelector('div[role="button"]:has-text("Post"), button:has-text("Post")', { timeout: 5000 });
        await postBtn.click();
        onLog({ type: 'success', message: `💬 Reply Threads "${comment}" berhasil!` });
      } catch {
        onLog({ type: 'warn', message: 'Kolom reply Threads tidak ditemukan' });
      }
      break;

    case 'repost':
      try {
        const repostBtn = await page.waitForSelector('svg[aria-label="Repost"], div[aria-label="Repost"]', { timeout: 5000 });
        await repostBtn.click();
        await page.waitForTimeout(500);
        const confirmRepost = await page.$('div[role="button"]:has-text("Repost")');
        if (confirmRepost) await confirmRepost.click();
        onLog({ type: 'success', message: '🔄 Repost Threads berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol repost Threads tidak ditemukan' });
      }
      break;

    case 'follow':
      try {
        const followBtn = await page.waitForSelector('div[role="button"]:has-text("Follow"), button:has-text("Follow")', { timeout: 5000 });
        await followBtn.click();
        onLog({ type: 'success', message: '✅ Follow Threads berhasil!' });
      } catch {
        onLog({ type: 'warn', message: 'Tombol follow Threads tidak ditemukan' });
      }
      break;

    case 'scroll':
      await scrollPage(page, onLog);
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

async function takeScreenshot(page, label, action, onLog) {
  try {
    // Buat folder Screenshots/YYYY-MM-DD di Desktop
    const today = new Date().toISOString().split('T')[0];
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const screenshotDir = path.join(desktopPath, 'SMM-Pro-Screenshots', today);

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // Nama file: platform_akun_aksi_waktu.png
    const time = new Date().toTimeString().slice(0,8).replace(/:/g, '-');
    const safeName = (label || 'akun').replace(/[@\s\/\:*?"<>|]/g, '_');
    const filename = `${safeName}_${action}_${time}.png`;
    const filepath = path.join(screenshotDir, filename);

    await page.screenshot({
      path: filepath,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 720 }
    });

    onLog({ type: 'success', message: `📸 Screenshot disimpan: SMM-Pro-Screenshots/${today}/${filename}` });
    return filepath;
  } catch (err) {
    onLog({ type: 'warn', message: `Screenshot gagal: ${err.message}` });
    return null;
  }
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
