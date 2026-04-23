const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const os = require('os');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { loginToPlatform } = require('../automation/manager');

// Gunakan plugin stealth untuk menghindari deteksi
puppeteer.use(StealthPlugin());

let isRunning = false;
let activeBrowsers = [];

async function bulkPost(config, settings, onLog) {
  const { accounts, caption, mediaPath, platforms } = config;

  isRunning = true;
  onLog({ type: 'info', message: `Memulai bulk post ke ${accounts.length} akun (${(platforms || []).join(', ')})` });

  const results = [];

  const maxConcurrent = settings.maxConcurrent || 1;

  for (let i = 0; i < accounts.length; i += maxConcurrent) {
    if (!isRunning) {
      onLog({ type: 'warn', message: '⏹ Bulk post dihentikan oleh pengguna.' });
      break;
    }
    const chunk = accounts.slice(i, i + maxConcurrent);
    
    await Promise.all(chunk.map(async (account, chunkIndex) => {
      if (!account || !isRunning) return; // Cegah crash jika data akun kosong atau dihentikan
      const actualIndex = i + chunkIndex;
      const platform = account.platform;
      const timestamp = new Date().toISOString();
      onLog({ type: 'info', message: `[${actualIndex+1}/${accounts.length}] Posting ke: ${account.label || account.username} (${platform})` });

    try {
      let postResult = null;
      switch (platform) {
        case 'facebook':
          postResult = await postToFacebook(account, caption, mediaPath, onLog, settings, actualIndex, accounts.length);
          break;
        case 'instagram':
          postResult = await postToInstagram(account, caption, mediaPath, onLog, settings, actualIndex, accounts.length);
          break;
        case 'youtube':
          postResult = await postToYouTube(account, caption, mediaPath, onLog, settings, actualIndex, accounts.length);
          break;
        case 'twitter':
          postResult = await postToTwitter(account, caption, mediaPath, onLog, settings, actualIndex, accounts.length);
          break;
        case 'threads':
          postResult = await postToThreads(account, caption, mediaPath, onLog, settings, actualIndex, accounts.length);
          break;
        case 'tiktok':
          onLog({ type: 'warn', message: 'TikTok posting via API belum tersedia, skip...' });
          results.push({ platform, username: account.label || account.username, status: 'skip', message: 'TikTok belum didukung', timestamp });
          return;
        default:
          onLog({ type: 'warn', message: `Platform ${platform} belum didukung` });
          results.push({ platform, username: account.label || account.username, status: 'skip', message: `Platform ${platform} belum didukung`, timestamp });
          return;
      }

      onLog({ type: 'success', message: `✅ Berhasil posting ke ${account.label || account.username}` });
      results.push({ platform, username: account.label || account.username, status: 'success', message: 'Berhasil', url: postResult?.url || '', screenshot: postResult?.screenshot || '', timestamp });

    } catch (err) {
      const errMsg = err ? (err.message || String(err)) : 'Unknown error';
      onLog({ type: 'error', message: `❌ Gagal posting ke ${account.label || account.username}: ${errMsg}` });
      results.push({ platform, username: account.label || account.username, status: 'error', message: errMsg, timestamp });
    }
    })); // Akhir dari batch Promise.all

    // Jeda antar batch (kecuali batch terakhir)
    if (i + maxConcurrent < accounts.length && isRunning) {
      const dMin = settings.delayMin || 3;
      const dMax = settings.delayMax || 10;
      const delayMs = (dMin + Math.random() * (dMax - dMin)) * 1000;
      onLog({ type: 'info', message: `⏳ Random delay ${Math.round(delayMs/1000)} detik antar-batch agar terlihat natural...` });
      await sleep(delayMs);
    }
  }

  isRunning = false;
  onLog({ type: 'success', message: '🎉 Status Bulk post selesai / berhenti!' });
  return results;
}

async function postToFacebook(account, caption, mediaPath, onLog, settings, index, total) {
  const tag = `[${index+1}/${total}] [FB]`;
  const username = account.username;
  if (!username) throw new Error('Username akun tidak ada');

  const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `facebook_${safeName}`);
  const headless = settings && settings.headless !== undefined ? settings.headless : false;

  onLog({ type: 'info', message: `${tag} Membuka browser automasi: ${username}...` });

  const browser = await puppeteer.launch({
    headless,
    userDataDir: profileDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-notifications'
    ]
  });

  activeBrowsers.push(browser);
  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    // Tutup tab tambahan sisa sesi sebelumnya untuk menghemat beban RAM
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch (e) {}
    }

    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const cookiePath = path.join(os.homedir(), '.smm-pro-cookies', `facebook_${safeName}.json`);
    // Load cookies jika sebelumnya pernah login di mode Warm Up / Automasi
    try {
      if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        await page.setCookie(...cookies);
      }
    } catch (e) {}

    await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });

    // Validasi apabila user belum login sama sekali
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('checkpoint') || currentUrl.includes('two_factor')) {
      onLog({ type: 'info', message: `${tag} Akun belum login. Mencoba login otomatis...` });
      try {
        await loginToPlatform(page, 'facebook', account, onLog, tag);
        const cookies = await page.cookies();
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf8');
        await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (err) {
        throw new Error(`Gagal login otomatis: ${err.message}`);
      }
    }

    onLog({ type: 'info', message: 'Mencari kolom buat postingan (What\'s on your mind)...' });
    await sleep(3000); // Tunggu beranda termuat sempurna

    // Upload media lebih dulu jika ada
    if (mediaPath) {
      onLog({ type: 'info', message: 'Melampirkan media...' });
      try {
        await page.waitForSelector('div[role="dialog"] input[type="file"], input[type="file"][accept*="image"], input[type="file"][accept*="video"]', { timeout: 15000 });
        const fileInputs = await page.$$('div[role="dialog"] input[type="file"], input[type="file"][accept*="image"], input[type="file"][accept*="video"]');
        if (fileInputs.length > 0) {
          await fileInputs[fileInputs.length - 1].uploadFile(mediaPath);
          onLog({ type: 'info', message: 'Media sedang diunggah, tunggu sebentar...' });
          await sleep(8000); // Tunggu media selesai di-render sebagai thumbnail
        }
      } catch (e) {
        onLog({ type: 'warn', message: 'Input file media tidak ditemukan. Postingan mungkin hanya teks.' });
      }
    }

    onLog({ type: 'info', message: 'Menulis caption...' });
    let textboxFound = false;
    for (let i = 0; i < 5; i++) {
      // Cari input teks di dalam dialog postingan untuk menghindari salah fokus
      const textboxes = await page.$$('div[role="dialog"] div[role="textbox"][contenteditable="true"], div[role="textbox"][contenteditable="true"]');
      for (const box of textboxes) {
        const isTarget = await box.evaluate(el => {
          const r = el.getBoundingClientRect();
          const isVisible = r.width > 20 && r.height > 10; // Pastikan terlihat jelas
          // Abaikan Search Bar Facebook
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const isSearch = ariaLabel.includes('search') || ariaLabel.includes('cari');
          return isVisible && !isSearch;
        });
        
        if (isTarget) {
          try {
            await box.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await sleep(500);
            
            // Fokus dan klik tepat di elemen <p> untuk Lexical editor Facebook
            await box.evaluate(el => {
              const p = el.querySelector('p');
              if (p) p.click();
              else el.click();
              el.focus();
            });
            await sleep(500);
            await page.keyboard.type(caption, { delay: 30 }); // Ketik langsung
            
            // Fallback: Jika Lexical FB menolak keyboard.type, paksa tempel teks
            const textLength = await box.evaluate(el => el.innerText.trim().length);
            if (textLength === 0) {
              await box.evaluate((el, text) => {
                el.focus();
                const p = el.querySelector('p');
                if (p) {
                   p.focus();
                   document.execCommand('insertText', false, text);
                } else {
                   document.execCommand('insertText', false, text);
                }
              }, caption);
            }
            
            textboxFound = true;
            break;
          } catch (e) {}
        }
      }

      if (textboxFound) break;
      await sleep(2000);
    }

    if (!textboxFound) throw new Error('Area teks caption tidak ditemukan di dialog posting.');

    await sleep(2000);

    onLog({ type: 'info', message: 'Menekan tombol Kirim...' });
    let postClicked = false;
    
    // Coba hingga 20 kali (60 detik ekstra) sambil menunggu tombol Kirim menyala jika upload lambat
    for (let i = 0; i < 20; i++) {
      postClicked = await page.evaluate(async () => {
        // Helper: Pastikan tombol benar-benar terlihat dan aktif
        const isInteractable = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false; // Abaikan elemen tersembunyi
          if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return false; // Abaikan jika disabled
          
          // Cek via computed style untuk memastikan tidak disembunyikan via CSS
          const style = window.getComputedStyle(el);
          if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;
          
          return true;
        };

        // Strategi 1: Cari di seluruh dokumen
        const allButtons = Array.from(document.querySelectorAll('div[role="button"], button'));
        const validBtns = allButtons.filter(el => {
          const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          return (label === 'kirim' || label === 'post' || label === 'posting');
        });
        
        for (const btn of validBtns) {
          if (isInteractable(btn)) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.click();
            return true;
          }
        }

        // Strategi 2 (Fallback): cari berdasarkan teks di dalam span daun di seluruh dokumen
        const allSpans = Array.from(document.querySelectorAll('span'));
        const validSpans = allSpans.filter(el => {
          const text = (el.innerText || '').trim().toLowerCase();
          return (text === 'kirim' || text === 'post' || text === 'posting') && el.children.length === 0;
        });

        for (const span of validSpans) {
          const clickable = span.closest('div[role="button"], button') || span;
          if (isInteractable(clickable)) {
            clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
            clickable.click();
            return true;
          }
        }
        return false;
      });
      
      if (postClicked) break;
      onLog({ type: 'info', message: 'Tombol kirim masih memuat/disabled, mencoba lagi...' });
      await sleep(3000);
    }

    if (!postClicked) {
      throw new Error('Tombol Kirim (Post) tidak ditemukan atau belum aktif (mungkin upload belum selesai).');
    }

    onLog({ type: 'info', message: 'Menunggu proses publikasi...' });
    
    let postUrl = '';
    // Coba cari notifikasi pop-up "Lihat postingan" (View post) selama 5 detik pertama
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      postUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => {
          const text = (a.innerText || '').trim().toLowerCase();
          return text === 'lihat postingan' || text === 'view post';
        });
        return target ? target.href : '';
      });
      if (postUrl) break;
    }

    // Fallback: Jika tidak ada notifikasi, pergi ke profil pengguna dan ambil post teratas
    if (!postUrl) {
      onLog({ type: 'info', message: 'Notifikasi tidak muncul, menuju ke profil untuk mengambil link...' });
      try {
        // Pergi ke halaman profil (FB akan otomatis redirect facebook.com/me ke profil user)
        await page.goto('https://www.facebook.com/me', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(5000); // Tunggu profil termuat

        // Scroll sedikit untuk memicu loading feed/postingan
        await page.evaluate(() => window.scrollBy(0, 800));
        await sleep(3000);

        postUrl = await page.evaluate(() => {
          // Cari elemen post (article)
          const posts = Array.from(document.querySelectorAll('div[role="article"]'));
          if (posts.length === 0) return '';
          
          // Ambil post pertama (teratas)
          const firstPost = posts[0];
          
          // Cari semua link di dalam post pertama
          const links = Array.from(firstPost.querySelectorAll('a[role="link"], a'));
          
          // Cari link yang mengandung ID post (biasanya memiliki /posts/, /videos/, atau fbid=) pada timestamp
          const postLink = links.find(a => {
            const href = (a.href || '').toLowerCase();
            return (href.includes('/posts/') || href.includes('/videos/') || href.includes('fbid=')) && 
                   !href.includes('&comment_id=') && 
                   !href.includes('hovercard');
          });

          return postLink ? postLink.href : '';
        });
      } catch (err) {
        onLog({ type: 'warn', message: 'Gagal menavigasi ke profil untuk mengambil link.' });
      }
    }

    if (postUrl) onLog({ type: 'success', message: `🔗 Link postingan didapatkan: ${postUrl}` });
    else onLog({ type: 'warn', message: 'Link postingan gagal diambil otomatis, tapi postingan berhasil.' });

    const screenshotPath = await takeScreenshot(page, username, 'facebook', 'post', onLog);
    await sleep(3000); // Jeda sebelum browser ditutup
    
    return { success: true, url: postUrl, screenshot: screenshotPath };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {}
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
  }
}

async function postToInstagram(account, caption, mediaPath, onLog, settings, index, total) {
  const tag = `[${index+1}/${total}] [IG]`;
  const username = account.username;
  if (!username) throw new Error('Username akun tidak ada');
  if (!mediaPath) throw new Error('Instagram mewajibkan file media (gambar/video)');

  const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `instagram_${safeName}`);
  const headless = settings && settings.headless !== undefined ? settings.headless : false;

  onLog({ type: 'info', message: `${tag} Membuka browser automasi: ${username}...` });

  const browser = await puppeteer.launch({
    headless,
    userDataDir: profileDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-notifications'
    ]
  });

  activeBrowsers.push(browser);
  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    // Tutup tab tambahan sisa sesi sebelumnya untuk menghemat beban RAM
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch (e) {}
    }

    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const cookiePath = path.join(os.homedir(), '.smm-pro-cookies', `instagram_${safeName}.json`);
    try {
      if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        await page.setCookie(...cookies);
      }
    } catch (e) {}

    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('/accounts/login') || currentUrl.includes('/challenge')) {
      onLog({ type: 'info', message: `${tag} Akun belum login. Mencoba login otomatis...` });
      try {
        await loginToPlatform(page, 'instagram', account, onLog, tag);
        const cookies = await page.cookies();
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf8');
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (err) {
        throw new Error(`Gagal login otomatis: ${err.message}`);
      }
    }

    // Dismiss popup "Turn on Notifications" jika muncul
    try {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const dismissBtns = buttons.filter(b => /not now|nanti saja/i.test((b.innerText || '').trim()));
        if (dismissBtns.length > 0) dismissBtns[0].click();
      });
    } catch (e) {}

    await sleep(2000);

    onLog({ type: 'info', message: 'Mencari menu Buat Postingan (Create)...' });
    
    const createClicked = await page.evaluate(async () => {
      const svgs = Array.from(document.querySelectorAll('svg'));
      const createSvg = svgs.find(svg => {
        const label = (svg.getAttribute('aria-label') || '').toLowerCase();
        return label.includes('new post') || label.includes('postingan baru') || label === 'create' || label === 'buat';
      });
      if (createSvg) {
        const btn = createSvg.closest('a, button, div[role="button"], div[role="link"]');
        if (btn) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!createClicked) {
      throw new Error('Menu Buat Postingan tidak ditemukan (kemungkinan UI Instagram belum sepenuhnya dimuat).');
    }

    await sleep(2000); // Tunggu modal Postingan muncul

    // Coba deteksi menu dropdown "Post" jika IG menampilkannya
    await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const dropdownItems = Array.from(document.querySelectorAll('a, button, div[role="button"], span'));
      const postOption = dropdownItems.find(el => {
         const text = (el.innerText || '').trim().toLowerCase();
         return text === 'post' || text === 'postingan';
      });
      if (postOption) {
        postOption.click();
        await sleep(1000);
      }
    });

    onLog({ type: 'info', message: 'Melampirkan media...' });
    try {
      await page.waitForSelector('input[type="file"]', { timeout: 15000 });
      const fileInputs = await page.$$('input[type="file"]');
      await fileInputs[fileInputs.length - 1].uploadFile(mediaPath);
    } catch (e) {
      throw new Error('Input unggah file tidak ditemukan di modal Instagram (Timeout).');
    }
    await sleep(3500); // Tunggu preview gambar/video muncul

    onLog({ type: 'info', message: 'Melewati tahapan edit/crop...' });
    let atFinalStep = false;
    for (let i = 0; i < 3; i++) {
      await sleep(2000);
      const isFinal = await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return false;
        
        const buttons = Array.from(dialog.querySelectorAll('div[role="button"], button'));
        const shareBtn = buttons.find(b => /^(share|bagikan)$/i.test((b.innerText || '').trim()));
        
        if (shareBtn) return true; // Sudah di tahap caption (ada tombol Share)

        const nextBtn = buttons.find(b => /^(next|selanjutnya)$/i.test((b.innerText || '').trim()));
        if (nextBtn) {
          nextBtn.click();
        }
        return false;
      });
      
      if (isFinal) {
        atFinalStep = true;
        break;
      }
    }

    if (!atFinalStep) {
      throw new Error('Gagal mencapai tahap penulisan caption di modal Instagram.');
    }

    onLog({ type: 'info', message: 'Menulis caption...' });
    const textboxFound = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return false;
      const textboxes = Array.from(dialog.querySelectorAll('div[role="textbox"], [contenteditable="true"]'));
      const target = textboxes.find(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (target) {
        target.focus();
        return true;
      }
      return false;
    });

    if (!textboxFound) throw new Error('Area penulisan caption tidak ditemukan.');

    await sleep(1000);
    await page.keyboard.type(caption, { delay: 30 }); // Ketik perlahan seperti manusia
    await sleep(2000);

    // Fallback ketik paksa untuk Instagram jika keyboard.type ditolak
    const textLengthIG = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if(!dialog) return 0;
      const target = Array.from(dialog.querySelectorAll('div[role="textbox"], [contenteditable="true"]')).find(el => el.getBoundingClientRect().width > 0);
      return target ? target.innerText.trim().length : 0;
    });
    if (textLengthIG === 0) {
      await page.evaluate((text) => {
        const dialog = document.querySelector('div[role="dialog"]');
        if(!dialog) return;
        const target = Array.from(dialog.querySelectorAll('div[role="textbox"], [contenteditable="true"]')).find(el => el.getBoundingClientRect().width > 0);
        if(target) { target.focus(); document.execCommand('insertText', false, text); }
      }, caption);
    }

    onLog({ type: 'info', message: 'Membagikan postingan...' });
    const sharedIG = await page.evaluate(() => {
      const isInteractable = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return false;
        const style = window.getComputedStyle(el);
        return !(style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none');
      };
      const dialog = document.querySelector('div[role="dialog"]');
      if(!dialog) return false;
      const buttons = Array.from(dialog.querySelectorAll('div[role="button"], button'));
      const shareBtn = buttons.find(b => /^(share|bagikan)$/i.test((b.innerText || '').trim()));
      if (shareBtn && isInteractable(shareBtn)) { shareBtn.click(); return true; }
      return false;
    });
    if(!sharedIG) throw new Error('Tombol bagikan tidak dapat diklik atau belum aktif.');

    onLog({ type: 'info', message: 'Mengunggah konten, tunggu sebentar...' });
    await sleep(15000); // Beri jeda cukup panjang untuk upload video/gambar beresolusi tinggi ke server IG

    // Tarik URL Instagram
    let postUrl = '';
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      postUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => {
          const text = (a.innerText || '').trim().toLowerCase();
          return text === 'view post' || text === 'lihat postingan';
        });
        return target ? target.href : '';
      });
      if (postUrl) break;
    }
    
    if (!postUrl) {
      onLog({ type: 'info', message: 'Notifikasi tidak muncul, mengambil link dari profil Instagram...' });
      try {
        const cleanUser = username.replace('@', '');
        await page.goto(`https://www.instagram.com/${cleanUser}/`, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        postUrl = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href^="/p/"]'));
          return links.length > 0 ? links[0].href : '';
        });
      } catch(e) {}
    }

    if (postUrl) onLog({ type: 'success', message: `🔗 Link postingan didapatkan: ${postUrl}` });
    else onLog({ type: 'warn', message: 'Link postingan gagal diambil otomatis, tapi postingan berhasil.' });

    const screenshotPath = await takeScreenshot(page, username, 'instagram', 'post', onLog);
    return { success: true, url: postUrl, screenshot: screenshotPath };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {}
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
  }
}

async function postToYouTube(account, caption, mediaPath, onLog, settings, index, total) {
  const tag = `[${index+1}/${total}] [YT]`;
  const username = account.username;
  if (!username) throw new Error('Username akun tidak ada');
  if (!mediaPath) throw new Error('YouTube membutuhkan video');

  const isVideo = ['.mp4', '.mov', '.avi', '.webm', '.m4v'].some(ext => mediaPath.toLowerCase().includes(ext));
  if (!isVideo) throw new Error('YouTube hanya menerima video');

  const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `youtube_${safeName}`);
  const headless = settings && settings.headless !== undefined ? settings.headless : false;

  onLog({ type: 'info', message: `${tag} Membuka browser automasi: ${username}...` });

  const browser = await puppeteer.launch({
    headless,
    userDataDir: profileDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-notifications'
    ]
  });

  activeBrowsers.push(browser);
  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    // Tutup tab tambahan sisa sesi sebelumnya untuk menghemat beban RAM
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch (e) {}
    }

    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const cookiePath = path.join(os.homedir(), '.smm-pro-cookies', `youtube_${safeName}.json`);
    try {
      if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        await page.setCookie(...cookies);
      }
    } catch (e) {}

    // Masuk langsung ke halaman upload (akan otomatis redirect ke YouTube Studio)
    await page.goto('https://www.youtube.com/upload', { waitUntil: 'networkidle2', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('ServiceLogin')) {
      onLog({ type: 'info', message: `${tag} Akun belum login. Mencoba login otomatis...` });
      try {
        await loginToPlatform(page, 'youtube', account, onLog, tag);
        const cookies = await page.cookies();
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf8');
        await page.goto('https://www.youtube.com/upload', { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (err) {
        throw new Error(`Gagal login otomatis: ${err.message}`);
      }
    }

    onLog({ type: 'info', message: 'Mencari input file video...' });
    try {
      await page.waitForSelector('input[type="file"]', { timeout: 15000 });
      const fileInputs = await page.$$('input[type="file"]');
      onLog({ type: 'info', message: 'Melampirkan video...' });
      await fileInputs[fileInputs.length - 1].uploadFile(mediaPath);
    } catch (e) {
      throw new Error('Input unggah video tidak ditemukan di YouTube Studio (Timeout).');
    }

    onLog({ type: 'info', message: 'Menunggu editor video muncul...' });
    await sleep(8000); // Tunggu sampai editor selesai loading

    onLog({ type: 'info', message: 'Menulis judul dan deskripsi...' });
    // Potong caption untuk judul karena YouTube membatasi judul max 100 karakter
    const title = caption.length > 95 ? caption.substring(0, 95) + '...' : caption;

    const filled = await page.evaluate(async (titleText, descText) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const textboxes = Array.from(document.querySelectorAll('#textbox[contenteditable="true"]'));
      if (textboxes.length >= 2) {
        // Isi Title (Index 0)
        textboxes[0].focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, titleText);
        await sleep(1000);
        // Isi Description (Index 1)
        textboxes[1].focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, descText);
        return true;
      }
      return false;
    }, title, caption);

    if (!filled) {
      onLog({ type: 'warn', message: 'Gagal menemukan kolom judul/deskripsi, melanjutkan dengan default name...' });
    }

    await sleep(2000);

    onLog({ type: 'info', message: 'Mengatur opsi penonton (Bukan untuk anak-anak)...' });
    await page.evaluate(() => {
      const notForKids = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
      if (notForKids) notForKids.click();
    });

    await sleep(2000);

    onLog({ type: 'info', message: 'Melewati tahapan (Next)...' });
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const nextBtn = document.querySelector('#next-button');
        if (nextBtn && !nextBtn.disabled && nextBtn.getAttribute('aria-disabled') !== 'true') {
          nextBtn.click();
        }
      });
      await sleep(2000);
    }

    onLog({ type: 'info', message: 'Mengatur visibilitas menjadi Publik...' });
    await page.evaluate(() => {
      const publicRadio = document.querySelector('tp-yt-paper-radio-button[name="PUBLIC"]');
      if (publicRadio) publicRadio.click();
    });

    await sleep(2000);

    // Ekstrak URL YouTube yang diberikan modal upload sebelum klik Done
    let postUrl = await page.evaluate(() => {
      const urlLink = document.querySelector('a.ytcp-video-info');
      return urlLink ? urlLink.href : '';
    });

    onLog({ type: 'info', message: 'Menekan tombol Publikasikan...' });
    const published = await page.evaluate(() => {
      const isInteractable = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return false;
        const style = window.getComputedStyle(el);
        return !(style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none');
      };
      const doneBtn = document.querySelector('#done-button');
      if (doneBtn && isInteractable(doneBtn)) {
        doneBtn.click();
        return true;
      }
      return false;
    });

    if (!published) {
      throw new Error('Tombol Publikasikan tidak dapat diklik (mungkin video masih diproses atau error validasi UI).');
    }

    onLog({ type: 'info', message: 'Menunggu proses publikasi di background...' });
    await sleep(15000); // Beri waktu lebih lama karena upload video ke server YouTube butuh waktu ekstra sebelum browser bisa ditutup aman

    if (postUrl) onLog({ type: 'success', message: `🔗 Link postingan didapatkan: ${postUrl}` });
    else onLog({ type: 'warn', message: 'Link postingan gagal diambil otomatis, tapi postingan berhasil.' });

    const screenshotPath = await takeScreenshot(page, username, 'youtube', 'post', onLog);
    return { success: true, url: postUrl, screenshot: screenshotPath };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {}
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
  }
}

async function postToTwitter(account, caption, mediaPath, onLog, settings, index, total) {
  const tag = `[${index+1}/${total}] [TW]`;
  const username = account.username;
  if (!username) throw new Error('Username akun tidak ada');

  const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `twitter_${safeName}`);
  const headless = settings && settings.headless !== undefined ? settings.headless : false;

  onLog({ type: 'info', message: `${tag} Membuka browser automasi: ${username}...` });

  const browser = await puppeteer.launch({
    headless,
    userDataDir: profileDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-notifications'
    ]
  });

  activeBrowsers.push(browser);
  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    // Tutup tab tambahan sisa sesi sebelumnya untuk menghemat beban RAM
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch (e) {}
    }

    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const cookiePath = path.join(os.homedir(), '.smm-pro-cookies', `twitter_${safeName}.json`);
    try {
      if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        await page.setCookie(...cookies);
      }
    } catch (e) {}

    await page.goto('https://twitter.com/home', { waitUntil: 'networkidle2', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/logout') || currentUrl.includes('flow/login')) {
      onLog({ type: 'info', message: `${tag} Akun belum login. Mencoba login otomatis...` });
      try {
        await loginToPlatform(page, 'twitter', account, onLog, tag);
        const cookies = await page.cookies();
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf8');
        await page.goto('https://twitter.com/home', { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (err) {
        throw new Error(`Gagal login otomatis: ${err.message}`);
      }
    }

    await sleep(3000);

    onLog({ type: 'info', message: 'Mencari area penulisan tweet...' });
    
    const textboxFound = await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      let textbox = document.querySelector('[data-testid="tweetTextarea_0"]');
      
      if (!textbox) {
        const composeBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
        if (composeBtn) {
          composeBtn.click();
          await sleep(1500);
          textbox = document.querySelector('[data-testid="tweetTextarea_0"]');
        }
      }
      
      if (textbox) {
        textbox.focus();
        textbox.click();
        return true;
      }
      return false;
    });

    if (!textboxFound) throw new Error('Area penulisan tweet tidak ditemukan di halaman utama.');

    await sleep(1000);
    await page.keyboard.type(caption, { delay: 30 }); // Ketik layaknya manusia
    await sleep(1500);

    // Fallback ketik paksa untuk Twitter/X
    const textLengthX = await page.evaluate(() => {
      const textbox = document.querySelector('[data-testid="tweetTextarea_0"]');
      return textbox ? textbox.innerText.trim().length : 0;
    });
    if (textLengthX === 0) {
      await page.evaluate((text) => {
        const textbox = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (textbox) { textbox.focus(); document.execCommand('insertText', false, text); }
      }, caption);
    }

    if (mediaPath) {
      onLog({ type: 'info', message: 'Melampirkan media...' });
      try {
        await page.waitForSelector('input[type="file"]', { timeout: 15000 });
        const fileInputs = await page.$$('input[type="file"]');
        if (fileInputs.length > 0) {
          await fileInputs[fileInputs.length - 1].uploadFile(mediaPath);
          onLog({ type: 'info', message: 'Media sedang diunggah, tunggu sebentar...' });
          await sleep(6000); // Waktu untuk preview media (video butuh lebih lama)
        }
      } catch (e) {
        onLog({ type: 'warn', message: 'Input file media tidak ditemukan. Postingan mungkin hanya teks.' });
      }
    }

    onLog({ type: 'info', message: 'Membagikan tweet...' });
    
    const tweetClicked = await page.evaluate(async () => {
      const isInteractable = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return false;
        const style = window.getComputedStyle(el);
        return !(style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none');
      };
      const btn = document.querySelector('[data-testid="tweetButtonInline"]') || document.querySelector('[data-testid="tweetButton"]');
      if (btn && isInteractable(btn)) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!tweetClicked) {
      throw new Error('Tombol Post tidak ditemukan atau belum aktif (mungkin upload belum selesai atau teks terlalu panjang).');
    }

    onLog({ type: 'info', message: 'Menunggu proses publikasi...' });
    await sleep(6000); // Berikan jeda agar tweet tereksekusi sebelum browser ditutup

    // Tarik URL Twitter/X
    let postUrl = '';
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      postUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => {
          const text = (a.innerText || '').trim().toLowerCase();
          return text === 'view' || text === 'lihat';
        });
        return target ? target.href : '';
      });
      if (postUrl) break;
    }
    
    if (!postUrl) {
      onLog({ type: 'info', message: 'Notifikasi tidak muncul, mengambil link dari profil Twitter/X...' });
      try {
        const cleanUser = username.replace('@', '');
        await page.goto(`https://twitter.com/${cleanUser}`, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        postUrl = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/status/"]'));
          const postLinks = links.filter(a => !a.href.includes('/photo/') && !a.href.includes('/analytics'));
          return postLinks.length > 0 ? postLinks[0].href : '';
        });
      } catch(e) {}
    }

    if (postUrl) onLog({ type: 'success', message: `🔗 Link postingan didapatkan: ${postUrl}` });
    else onLog({ type: 'warn', message: 'Link postingan gagal diambil otomatis, tapi postingan berhasil.' });

    const screenshotPath = await takeScreenshot(page, username, 'twitter', 'post', onLog);
    return { success: true, url: postUrl, screenshot: screenshotPath };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {}
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
  }
}

async function postToThreads(account, caption, mediaPath, onLog, settings, index, total) {
  const tag = `[${index+1}/${total}] [TH]`;
  const username = account.username;
  if (!username) throw new Error('Username akun tidak ada');

  const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `threads_${safeName}`);
  const headless = settings && settings.headless !== undefined ? settings.headless : false;

  onLog({ type: 'info', message: `${tag} Membuka browser automasi: ${username}...` });

  const browser = await puppeteer.launch({
    headless,
    userDataDir: profileDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-notifications'
    ]
  });

  activeBrowsers.push(browser);
  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    // Tutup tab tambahan sisa sesi sebelumnya untuk menghemat beban RAM
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch (e) {}
    }

    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const cookiePath = path.join(os.homedir(), '.smm-pro-cookies', `threads_${safeName}.json`);
    try {
      if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        await page.setCookie(...cookies);
      }
    } catch (e) {}

    await page.goto('https://www.threads.net/', { waitUntil: 'networkidle2', timeout: 30000 });

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      onLog({ type: 'info', message: `${tag} Akun belum login. Mencoba login otomatis...` });
      try {
        await loginToPlatform(page, 'threads', account, onLog, tag);
        const cookies = await page.cookies();
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf8');
        await page.goto('https://www.threads.net/', { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (err) {
        throw new Error(`Gagal login otomatis: ${err.message}`);
      }
    }

    await sleep(3000);

    onLog({ type: 'info', message: 'Mencari tombol Buat Utas (Create)...' });

    const createClicked = await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const createBtns = Array.from(document.querySelectorAll('svg, div[role="button"], button'));
      const target = createBtns.find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        const text = (el.innerText || '').toLowerCase();
        return label === 'create' || label === 'buat' || text.includes('start a thread') || text.includes('mulai utas');
      });

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);
        target.click();
        return true;
      }
      return false;
    });

    if (!createClicked) throw new Error('Tombol Buat Utas tidak ditemukan di halaman utama Threads.');

    await sleep(2000);

    onLog({ type: 'info', message: 'Menulis caption...' });
    
    const textboxFound = await page.evaluate(() => {
      const textboxes = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
      const target = textboxes.find(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      
      if (target) {
        target.focus();
        return true;
      }
      return false;
    });

    if (!textboxFound) throw new Error('Area penulisan caption tidak ditemukan.');

    await sleep(1000);
    // Karena Threads memakai internal Lexical Editor yang rentan bug saat `keyboard.type` biasa, kita type sangat lambat
    await page.keyboard.type(caption, { delay: 40 });
    await sleep(1500);

    // Fallback ketik paksa untuk Threads
    const textLengthTh = await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('div[contenteditable="true"]')).find(el => el.getBoundingClientRect().width > 0);
      return target ? target.innerText.trim().length : 0;
    });
    if (textLengthTh === 0) {
      await page.evaluate((text) => {
        const target = Array.from(document.querySelectorAll('div[contenteditable="true"]')).find(el => el.getBoundingClientRect().width > 0);
        if (target) { target.focus(); document.execCommand('insertText', false, text); }
      }, caption);
    }

    if (mediaPath) {
      onLog({ type: 'info', message: 'Melampirkan media...' });
      try {
        await page.waitForSelector('input[type="file"]', { timeout: 15000 });
        const fileInputs = await page.$$('input[type="file"]');
        if (fileInputs.length > 0) {
          await fileInputs[fileInputs.length - 1].uploadFile(mediaPath);
          onLog({ type: 'info', message: 'Media sedang diunggah, tunggu sebentar...' });
          await sleep(6000); // Tunggu preview muncul di antarmuka Threads
        }
      } catch (e) {
        onLog({ type: 'warn', message: 'Input file media tidak ditemukan. Postingan mungkin hanya teks.' });
      }
    }

    onLog({ type: 'info', message: 'Membagikan utas...' });

    const postClicked = await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
      const target = buttons.find(el => {
        const text = (el.innerText || '').trim().toLowerCase();
        // Tombol harus aktif
        return (text === 'post' || text === 'posting') && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
      });

      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (!postClicked) {
      throw new Error('Tombol Posting tidak dapat diklik atau tidak ditemukan (mungkin upload video belum selesai).');
    }

    onLog({ type: 'info', message: 'Menunggu proses publikasi...' });
    await sleep(8000); // Jeda sebelum browser ditutup agar Threads API sempat merespons

    // Tarik URL Threads
    let postUrl = '';
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      postUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => {
          const text = (a.innerText || '').trim().toLowerCase();
          return text === 'view' || text === 'lihat';
        });
        return target ? target.href : '';
      });
      if (postUrl) break;
    }
    
    if (!postUrl) {
      onLog({ type: 'info', message: 'Notifikasi tidak muncul, mengambil link dari profil Threads...' });
      try {
        const cleanUser = username.startsWith('@') ? username : `@${username}`;
        await page.goto(`https://www.threads.net/${cleanUser}`, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        postUrl = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
          return links.length > 0 ? links[0].href : '';
        });
      } catch(e) {}
    }

    if (postUrl) onLog({ type: 'success', message: `🔗 Link postingan didapatkan: ${postUrl}` });
    else onLog({ type: 'warn', message: 'Link postingan gagal diambil otomatis, tapi postingan berhasil.' });

    const screenshotPath = await takeScreenshot(page, username, 'threads', 'post', onLog);
    return { success: true, url: postUrl, screenshot: screenshotPath };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {}
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
  }
}

async function takeScreenshot(page, username, platform, action, onLog) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const screenshotDir = path.join(desktopPath, 'SMM-Pro-Screenshots', today);
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const time = new Date().toTimeString().slice(0,8).replace(/:/g, '-');
    const safeName = (username || 'akun').replace(/[@\s\/\:*?"<>|]/g, '_');
    const filename = `${platform}_${safeName}_${action}_${time}.png`;
    const filepath = path.join(screenshotDir, filename);
    await page.screenshot({ path: filepath });
    if (onLog) onLog({ type: 'success', message: `📸 Screenshot bukti disimpan: SMM-Pro-Screenshots/${today}/${filename}` });
    return filepath;
  } catch (err) {
    if (onLog) onLog({ type: 'warn', message: `Screenshot gagal: ${err.message}` });
    return '';
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function stopBulkPost() {
  isRunning = false;
  activeBrowsers.forEach(b => {
    try { b.close(); } catch (e) {}
  });
  activeBrowsers = [];
}

module.exports = { bulkPost, stopBulkPost };
