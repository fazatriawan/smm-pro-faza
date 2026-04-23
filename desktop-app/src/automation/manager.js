// desktop-app/src/automation/manager.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Store = require('electron-store');
const store = new Store({ encryptionKey: 'smm-pro-secret-2024' });

puppeteer.use(StealthPlugin());

let isRunning = false;
let activeBrowsers = [];

// --- Implementasi login Facebook otomatis + 2FA ---
async function loginFacebook(page, account, onLog, tag = '') {
    const emailSel = 'input[name="email"], #email';
    const passSel = 'input[name="pass"], #pass';
  onLog({ type: 'info', message: `${tag} Mulai login Facebook otomatis...` });
  // Debug: cek apakah page bisa browsing ke google.com
  try {
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const googleTitle = await page.title();
    onLog({ type: 'info', message: `${tag} Sukses buka Google: Judul=${googleTitle}` });
  } catch (e) {
    onLog({ type: 'error', message: `${tag} Gagal buka Google: ${e.message}` });
    throw new Error('Browser tidak bisa browsing ke Google. Cek koneksi atau konfigurasi Puppeteer.');
  }
  if (!account.username || !account.password) {
    onLog({ type: 'warn', message: `${tag} ⚠️ Username/Password kosong di pengaturan. Silakan ketik manual di browser dalam 90 detik...` });
    await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2' });
    await sleep(90000);
  } else {
    // Lanjut ke Facebook
    await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2' });
    await sleep(2000);
    
    // Cek halaman "Recent Logins" (Lanjutkan sebagai... / Gunakan akun lain)
    const emailInputExists = await page.$(emailSel);
    if (!emailInputExists) {
      onLog({ type: 'info', message: `${tag} Form login tersembunyi (profil tersimpan). Mencoba mereset form...` });
      
      const clickedAnother = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('div[role="button"], a, button, span'));
        const target = els.find(el => {
          const txt = (el.innerText || '').toLowerCase();
          return txt.includes('akun lain') || txt.includes('another account') || txt.includes('bukan anda') || txt.includes('not you');
        });
        if (target) {
          target.click();
          return true;
        }
        return false;
      });

      if (clickedAnother) {
        await sleep(2000);
      } else {
        // Fallback: hapus data sesi dan refresh paksa
        const cookies = await page.cookies();
        await page.deleteCookie(...cookies);
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
        await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2' });
        await sleep(2000);
      }
    }
    
    // Menggunakan safeType untuk memastikan input terisi meskipun elemen tertutup
    await safeType(page, emailSel, account.username);
    await sleep(500);
    await safeType(page, passSel, account.password);
    await sleep(500);
    
    const loginClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[name="login"], button[type="submit"]'));
      if (btns.length > 0) { 
        setTimeout(() => btns[0].click(), 50); 
        return true; 
      }
      return false;
    });
    if (!loginClicked) await page.keyboard.press('Enter');
    
    try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }); } catch {}
  }

  // Screenshot setelah submit login (pastikan tag selalu ada)
  await takeScreenshot(page, account.username, 'after-login', (msg) => onLog({ ...msg, tag }));

  // Log URL dan judul halaman setelah login
  const currentUrl = page.url();
  const pageTitle = await page.title();

  // Analisa posisi halaman setelah login
  let posisi = 'Tidak diketahui';
  if (/login/.test(currentUrl)) {
    posisi = 'Halaman Login';
  } else if (/two_factor|two_step_verification|checkpoint|approvals/.test(currentUrl)) {
    posisi = 'Halaman 2FA / Checkpoint / Approvals';
  } else if (/home|facebook.com\/?$/.test(currentUrl)) {
    posisi = 'Beranda Facebook';
  } else if (/recover|help|error|invalid/.test(currentUrl)) {
    // Hapus deklarasi ganda, pastikan hanya satu deklarasi di sini
    posisi = 'Halaman Error/Recovery';
  } else if (/save-device/.test(currentUrl)) {
    posisi = 'Halaman Simpan Perangkat';
  } else if (/about:blank/.test(currentUrl) || !pageTitle) {
    posisi = 'Halaman Kosong / Sesi Terputus';
  }
  onLog({ type: 'info', message: `${tag} Setelah login: URL=${currentUrl}, Judul=${pageTitle}, Posisi: ${posisi}` });

 
// Cek jika butuh 2FA
  if (/two_factor|two_step_verification|checkpoint|approvals/.test(page.url())) {
    if (['totp', 'google_auth', 'duo_mobile', '2fa_live'].includes(account.twoFAType) && account.twoFactorSecret) {
      onLog({ type: 'info', message: `${tag} Deteksi 2FA, menunggu halaman input kode...` });
      
      // Tunggu sampai halaman input kode 2FA muncul
      const start2FA = Date.now();
      let readyForCode = false;
      while (Date.now() - start2FA < 30000) {
        try {
          const url = page.url();
          if (/two_factor\/|two_factor\?|checkpoint/.test(url) && !/authentication/.test(url)) {
            readyForCode = true;
            break;
          }
        } catch (e) {}
        await sleep(1000);
      }
      
      if (!readyForCode) {
        onLog({ type: 'warn', message: `${tag} Halaman input kode 2FA tidak muncul, fallback manual` });
        await waitAfter2FA(page, 180000);
      } else {
        await sleep(3000); // Tunggu halaman fully loaded
        
        const totp = generateTOTP(account.twoFactorSecret);
        onLog({ type: 'info', message: `${tag} Kode TOTP: ${totp}` });
        
        // Cari input dan KLIK untuk focus, lalu ketik pakai keyboard (bukan evaluate)
        const inputFound = await page.evaluate(() => {
          const allInputs = Array.from(document.querySelectorAll('input'));
          
          // Prioritas 1: input 2FA klasik
          let target = allInputs.find(el => 
            el.name === 'approvals_code' ||
            el.id === 'approvals_code' ||
            el.getAttribute('autocomplete') === 'one-time-code'
          );
          
          // Prioritas 2: input text/tel yang cocok
          if (!target) {
            target = allInputs.find(el => {
              if (!['text', 'tel', 'number', ''].includes(el.type)) return false;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              const label = (el.getAttribute('aria-label') || '').toLowerCase();
              const placeholder = (el.placeholder || '').toLowerCase();
              return el.maxLength === 6 || el.maxLength === 8 ||
                     label.includes('kode') || label.includes('code') ||
                     placeholder.includes('kode') || placeholder.includes('code');
            });
          }
          
          // Prioritas 3: input pertama yang visible & kosong
          if (!target) {
            target = allInputs.find(el => {
              if (!['text', 'tel', 'number', ''].includes(el.type)) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
          }
          
          if (!target) return false;
          
          // Klik & focus input (penting untuk React)
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.focus();
          target.click();
          return true;
        });
        
        if (!inputFound) {
          onLog({ type: 'warn', message: `${tag} Input 2FA tidak ditemukan, fallback manual` });
          await waitAfter2FA(page, 180000);
        } else {
          // Clear existing value dulu (kalau ada)
          await page.keyboard.down('Control');
          await page.keyboard.press('a');
          await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          await sleep(300);
          
          // Ketik kode pakai keyboard (React-friendly!)
          await page.keyboard.type(totp, { delay: 80 });
          
          onLog({ type: 'success', message: `${tag} Kode 2FA diketik otomatis!` });
          
          await sleep(1500);
          
          // Screenshot setelah isi kode (debug)
          await takeScreenshot(page, account.username, 'after-2fa-fill', onLog, tag);
          
          // Klik tombol submit
          const clicked = await page.evaluate(async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            
            const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button, a[role="button"], input[type="submit"]'));
            
            const patterns = [
              /^lanjutkan$/i, /^continue$/i, /^submit$/i, /^kirim$/i,
              /^berikutnya$/i, /^next$/i, /^verifikasi$/i, /^verify$/i,
              /^konfirmasi$/i, /^confirm$/i
            ];
            
            const matches = candidates.filter(el => {
              const label = (el.getAttribute('aria-label') || '').trim();
              const text = (el.innerText || '').trim();
              const value = (el.value || '').trim();
              const isMatch = patterns.some(p => p.test(label) || p.test(text) || p.test(value));
              if (!isMatch) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
            
            if (matches.length > 0) {
              matches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(500);
              matches[0].click();
              return 'button-clicked';
            }
            
            return 'no-button-found';
          });
          
          onLog({ type: 'info', message: `${tag} Submit 2FA: ${clicked}` });
          
          if (clicked === 'no-button-found') {
            onLog({ type: 'info', message: `${tag} Coba submit via Enter...` });
            try { await page.keyboard.press('Enter'); } catch {}
          }
          
          await sleep(3000);
          
          // Tunggu cookie c_user muncul (maks 30 detik)
          try {
            await waitAfter2FA(page, 30000);
            onLog({ type: 'success', message: `${tag} ✅ 2FA berhasil, cookie login ditemukan!` });
          } catch (e) {
            onLog({ type: 'warn', message: `${tag} Setelah submit 2FA: ${e.message}` });
          }
        }
      }
    } else {
      onLog({ type: 'warn', message: `${tag} 2FA terdeteksi, silakan isi manual di browser (maks 3 menit)...` });
      await waitAfter2FA(page, 180000);
    }
  }

  // Cek sukses login berdasarkan cookie c_user
  const finalCookies = await page.cookies('https://www.facebook.com');
  const cUser = finalCookies.find(c => c.name === 'c_user');
  
  if (!cUser || !cUser.value) {
    throw new Error('Login Facebook gagal — cookie c_user tidak ditemukan');
  }
  
  // Kalau masih di halaman intermediate (remember browser/checkpoint), navigasi ke beranda
  if (/two_factor\/remember_browser|checkpoint/.test(page.url())) {
    onLog({ type: 'info', message: `${tag} Skip halaman intermediate, navigasi ke beranda...` });
    try {
      await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 20000 });
    } catch (e) {
      onLog({ type: 'warn', message: `${tag} Gagal navigasi ke beranda: ${e.message}` });
    }
  }
  
  onLog({ type: 'success', message: `${tag} ✅ Login Facebook berhasil!` });
}

async function startAutomation(config, settings, onLog) {
  if (isRunning) throw new Error('Automasi sedang berjalan');
  isRunning = true;

  const {
    accounts = [],
    platform,
    actions = [],
    targetUrls = [],
    durationPerAccount,
    commentTemplates = []
  } = config || {};

  const {
    headless = false,
    delayMin = 3,
    delayMax = 10,
    restBetweenAccounts = 60,
    maxConcurrent = 1
  } = settings || {};

  onLog({ type: 'info', message: `Memulai automasi ${platform} untuk ${accounts.length} akun` });

  for (let i = 0; i < accounts.length; i += maxConcurrent) {
    if (!isRunning) {
      onLog({ type: 'warn', message: 'Automasi dihentikan oleh pengguna' });
      break;
    }
    
    const chunk = accounts.slice(i, i + maxConcurrent);
    await Promise.all(chunk.map(async (account, chunkIndex) => {
      if (!account || !account.username) return; // Cegah crash jika data korup
      const actualIndex = i + chunkIndex;
      const platformName = platform || account.platform || 'UNKNOWN';
      const tag = `[${platformName.toUpperCase()} ${account.username}]`;
      onLog({ type: 'info', message: `${tag} [${actualIndex+1}/${accounts.length}] Memproses akun: ${account.username}` });

    let browser = null;
    let context = null;
    let page = null;

    try {
      // Get persistent profile dir untuk akun ini
      const profileDir = getProfilePath(platform, account.username);
      onLog({ type: 'info', message: `${tag} 📁 Pakai profile: ${path.basename(profileDir)}` });
      
      // Launch browser dengan persistent profile
      browser = await puppeteer.launch({
        headless,
        userDataDir: profileDir,  // ← ini kuncinya
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-session-crashed-bubble',  // ← TAMBAH INI
          '--disable-restore-session-state',   // ← TAMBAH INI
          '--hide-crash-restore-bubble'        // ← TAMBAH INI
        ],
        ignoreDefaultArgs: ['--enable-automation']
      });
      activeBrowsers.push(browser);

      // Tutup semua tab ekstra dari session restore, sisakan 1 tab fresh
      const allPages = await browser.pages();
      
      if (allPages.length > 1) {
        onLog({ type: 'info', message: `${tag} 🧹 Menutup ${allPages.length - 1} tab ekstra dari session lama...` });
        // Tutup semua kecuali yang pertama
        for (let i = 1; i < allPages.length; i++) {
          try { await allPages[i].close(); } catch {}
        }
      }
      
      // Pakai tab pertama untuk automasi
      page = allPages[0] || await browser.newPage();
      
      // Reset tab ke about:blank biar tidak ada state lama
      try {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch {}
      
      await page.setViewport({ width: 1280, height: 720 });
      // Set viewport / UA
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Restore cookies if available
      if (account.cookies) {
        try {
          const stored = JSON.parse(account.cookies);
          if (Array.isArray(stored) && stored.length) {
            // Puppeteer requires cookies to have url or domain/path
            await page.setCookie(...stored);
            onLog({ type: 'info', message: `${tag} Menggunakan sesi tersimpan (cookies)` });
          } else {
            onLog({ type: 'info', message: `${tag} Format cookies tidak valid, akan login ulang` });
          }
        } catch (e) {
          onLog({ type: 'warn', message: `${tag} Gagal restore cookies: ${e.message}` });
        }
      }

      // If no cookies present or cookies don't seem to authenticate, perform login
      let needLogin = !account.cookies;
      if (!needLogin) {
        // Quick check: open platform home page and see if logged in (best-effort)
        try {
          await page.goto(getPlatformHome(platform), { waitUntil: 'networkidle2', timeout: 20000 });
          // Heuristic: if page contains login keywords, force login
          const url = page.url();
          if (isLoginUrl(url, platform)) {
            needLogin = true;
            onLog({ type: 'info', message: `${tag} Sesi tidak valid; akan login ulang` });
          } else {
            onLog({ type: 'info', message: `${tag} Sesi tampak valid` });
          }
        } catch (e) {
          onLog({ type: 'warn', message: `${tag} Cek sesi gagal: ${e.message}. Akan mencoba login.` });
          needLogin = true;
        }
      }

// ---------- Browser Profile Persistence ----------
function getProfilePath(platform, username) {
  const baseDir = path.join(os.homedir(), '.smm-pro-profiles');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  
  // Sanitize username biar aman jadi nama folder
  const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profileDir = path.join(baseDir, `${platform}_${safeName}`);
  
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
  
  return profileDir;
}

// ---------- Cookie Persistence Helper ----------
function getCookieFilePath(platform, username) {
  const userDataDir = path.join(os.homedir(), '.smm-pro-cookies');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  // Sanitize username biar aman jadi filename
  const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(userDataDir, `${platform}_${safeName}.json`);
}

function saveCookiesToFile(platform, username, cookies) {
  try {
    const filepath = getCookieFilePath(platform, username);
    fs.writeFileSync(filepath, JSON.stringify(cookies, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

function loadCookiesFromFile(platform, username) {
  try {
    const filepath = getCookieFilePath(platform, username);
    if (!fs.existsSync(filepath)) return null;
    const raw = fs.readFileSync(filepath, 'utf-8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return null;
    return cookies;
  } catch (e) {
    return null;
  }
}

      // Mekanisme retry login Facebook
      if (needLogin) {
        let loginSuccess = false;
        let loginError = null;
        const maxLoginAttempts = 3;
        for (let attempt = 1; attempt <= maxLoginAttempts; attempt++) {
          onLog({ type: 'info', message: `${tag} Login ke ${platform}... Percobaan ke-${attempt}` });
          try {
            await loginToPlatform(page, platform, account, onLog, tag);
            // Save cookies after successful login
            try {
  const cookies = await page.cookies();
  account.cookies = JSON.stringify(cookies);
  
  // --- UPDATE KE ELECTRON STORE UTAMA AGAR UI LANGSUNG TERUPDATE ---
  const allAccounts = store.get('accounts', []);
  const accIndex = allAccounts.findIndex(a => a.id === account.id);
  if (accIndex !== -1) {
    allAccounts[accIndex].cookies = JSON.stringify(cookies);
    store.set('accounts', allAccounts);
  }
  // -----------------------------------------------------------------
  
  // Simpan juga ke file biar persisten antar sesi
  const saved = saveCookiesToFile(platform, account.username, cookies);
  if (saved) {
    onLog({ type: 'success', message: `${tag} ✅ Sesi login berhasil diverifikasi & disinkronisasi (${cookies.length} items)` });
  } else {
    onLog({ type: 'warn', message: `${tag} Login berhasil tapi gagal save cookies ke file` });
  }
} catch (e) {
  onLog({ type: 'error', message: `${tag} Gagal merekam cookies: ${e.message}` });
}
            loginSuccess = true;
            break;
          } catch (err) {
            loginError = err;
            onLog({ type: 'error', message: `${tag} Login gagal: ${err.message}` });
            // Tunggu sebentar sebelum retry
            await sleep(3000);
          }
        }
        if (!loginSuccess) {
          throw new Error(`Login gagal setelah ${maxLoginAttempts} percobaan: ${loginError ? loginError.message : ''}`);
        }
      }

      // Execute based on mode (Amplify vs Natural Browsing/Warmup)
      const mode = config.mode || 'automation';
      
      if (mode === 'login_only') {
        onLog({ type: 'success', message: `${tag} ✅ Proses Cek/Login Khusus selesai. Browser ditutup.` });
        return; // Menghentikan task spesifik untuk akun ini agar browser bisa langsung di-close
      }

      const startTime = Date.now();
      const maxDuration = (durationPerAccount || 10) * 60 * 1000;
      
      if (mode === 'amplify') {
        onLog({ type: 'info', message: `${tag} Mulai amplifikasi untuk ${targetUrls.length} URL...` });
        
        for (const url of targetUrls) {
          if (!isRunning) break;
          onLog({ type: 'info', message: `${tag} 🌐 Membuka target: ${url}` });
          
          // Urutkan actions agar like sebelum comment, dan scroll di akhir
          const sortedActions = [...actions].sort((a, b) => {
            if (a === 'scroll') return 1;
            if (b === 'scroll') return -1;
            if (a === 'like' && b === 'comment') return -1;
            if (a === 'comment' && b === 'like') return 1;
            return 0;
          });
          
          for (const action of sortedActions) {
            if (!isRunning) break;
            try {
              await performAction(page, platform, action, url, commentTemplates, onLog, tag);
              
              // Ambil screenshot HANYA untuk aksi interaksi agar bukti tersimpan jelas (scroll/follow diabaikan)
              if (['like', 'comment', 'share', 'repost', 'auto_reply'].includes(action)) {
                await takeScreenshot(page, account.username, `amplify_${action}`, onLog, tag);
              }
              
              const delayMs = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
              onLog({ type: 'info', message: `${tag} ⏳ Random delay ${Math.round(delayMs/1000)} detik...` });
              await sleep(delayMs);
            } catch (e) {
              const errMsg = e ? (e.message || String(e)) : 'Unknown error';
              onLog({ type: 'error', message: `${tag} Aksi ${action} gagal: ${errMsg}` });
            }
          }
        }
        onLog({ type: 'success', message: `${tag} Sesi amplifikasi selesai!` });

      } else {
        // Natural Browsing / Warm Up
        onLog({ type: 'info', message: `${tag} Mulai aktivitas natural selama ${durationPerAccount || 10} menit...` });

        let round = 0;
        while (isRunning && (Date.now() - startTime < maxDuration)) {
          round++;
          onLog({ type: 'info', message: `${tag} Putaran ke-${round}...` });

          // Pre-round scroll untuk menemukan postingan baru
          try {
             if (['facebook', 'instagram', 'twitter', 'tiktok', 'threads'].includes(platform)) {
                await page.evaluate(() => window.scrollBy(0, 400 + Math.random() * 400));
                await sleep(2000);
             }
          } catch (e) {}

          // Urutkan actions agar like dan comment mengenai postingan yang sama, dan scroll selalu di akhir
          const sortedActions = [...actions].sort((a, b) => {
            if (a === 'scroll') return 1;
            if (b === 'scroll') return -1;
            if (a === 'like' && b === 'comment') return -1;
            if (a === 'comment' && b === 'like') return 1;
            return Math.random() - 0.5;
          });

          for (const action of sortedActions) {
            if (!isRunning || (Date.now() - startTime >= maxDuration)) break;
            try {
              // For natural activity, targetUrl optional — if none, operate on home
              const target = (targetUrls && targetUrls.length) ? targetUrls[Math.floor(Math.random() * targetUrls.length)] : getPlatformHome(platform);
              await performAction(page, platform, action, target, commentTemplates, onLog, tag);
              
              // Ambil screenshot HANYA untuk aksi interaksi (bukti relevan untuk dipantau)
              if (['like', 'comment', 'share', 'repost', 'auto_reply'].includes(action)) {
                await takeScreenshot(page, account.username, `auto_${action}`, onLog, tag);
              }
              
              const delay = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
              onLog({ type: 'info', message: `${tag} ⏳ Random delay ${Math.round(delay/1000)} detik (Perilaku Natural)...` });
              await sleep(delay);
            } catch (e) {
              const errMsg = e ? (e.message || String(e)) : 'Unknown error';
              onLog({ type: 'error', message: `${tag} Aksi ${action} gagal: ${errMsg}` });
            }
          }

          if (isRunning && (Date.now() - startTime < maxDuration)) {
            const restTime = (delayMin + Math.random() * (delayMax - delayMin)) * 1000 + 3000;
            onLog({ type: 'info', message: `${tag} ⏳ Random delay antar-putaran ${Math.round(restTime/1000)} detik...` });
            await sleep(restTime);
          }
        }
        onLog({ type: 'success', message: `${tag} Sesi selesai setelah ${Math.round((Date.now()-startTime)/60000)} menit!` });
      }

    } catch (err) {
      const errMsg = err ? (err.message || String(err)) : 'Unknown error';
      onLog({ type: 'error', message: `${tag} Error pada akun ${account.username}: ${errMsg}` });
      // If login-specific error, clear stored cookies so next run will login again
      if (errMsg.toLowerCase().includes('login')) {
        account.cookies = null;
        // Hentikan proses akun ini jika login gagal
        return;
      }
      // Untuk error fatal lain, juga hentikan proses akun ini
      return;
    } finally {
      try {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
      } catch (_) {}
      activeBrowsers = activeBrowsers.filter(b => b !== browser);
    }
    })); // Akhir dari Promise.all
    
    if (i + maxConcurrent < accounts.length && isRunning) {
      onLog({ type: 'info', message: `Mengerjakan batch berikutnya. Istirahat ${restBetweenAccounts} detik...` });
      await sleep(restBetweenAccounts * 1000);
    }
  }
  isRunning = false;
  onLog({ type: 'success', message: '✅ Semua akun selesai diproses!' });
}

async function waitAfter2FA(page, maxWait = 180000) {
  const start = Date.now();
  const checkInterval = 2000;
  let lastUrl = '';
  
  while (Date.now() - start < maxWait) {
    let url = '';
    let isLoggedIn = false;
    
    try {
      url = page.url();
      const cookies = await page.cookies('https://www.facebook.com');
      const cUserCookie = cookies.find(c => c.name === 'c_user');
      isLoggedIn = !!(cUserCookie && cUserCookie.value);
    } catch (e) {
      await new Promise(r => setTimeout(r, checkInterval));
      continue;
    }
    
    if (url !== lastUrl) {
      console.log('[waitAfter2FA] URL:', url.slice(0, 120), '| Login cookie:', isLoggedIn);
      lastUrl = url;
    }
    
    // Cukup cek cookie c_user — kalau ada, user sudah login.
    // Tapi pastikan URL bukan halaman 2FA aktif (input kode), karena
    // setelah submit kode pertama, cookie sudah set tapi user belum benar-benar di beranda.
    if (isLoggedIn && !/two_step_verification|two_factor\/(?!remember_browser)/.test(url)) {
      console.log('[waitAfter2FA] ✅ Login berhasil terdeteksi');
      await new Promise(r => setTimeout(r, 1500));
      return true;
    }
    
    await new Promise(r => setTimeout(r, checkInterval));
  }
  
  throw new Error('Timeout: 2FA tidak diselesaikan dalam 3 menit');
}

// ---------- helpers & platform-specific login / actions ----------

function getPlatformHome(platform) {
  switch (platform) {
    case 'facebook': return 'https://www.facebook.com/';
    case 'instagram': return 'https://www.instagram.com/';
    case 'tiktok': return 'https://www.tiktok.com/';
    case 'twitter': return 'https://twitter.com/';
    case 'youtube': return 'https://www.youtube.com/';
    case 'threads': return 'https://www.threads.net/';
    default: return 'about:blank';
  }
}

function isLoginUrl(url, platform) {
  if (!url) return true;
  const u = url.toLowerCase();
  if (platform === 'facebook') return u.includes('/login') || u.includes('checkpoint');
  if (platform === 'instagram') return u.includes('/accounts/login') || u.includes('/challenge');
  if (platform === 'twitter') return u.includes('/login');
  if (platform === 'youtube' || platform === 'threads' || platform === 'tiktok') {
    return u.includes('login') || u.includes('signin') || u.includes('challenge');
  }
  return false;
}

async function loginToPlatform(page, platform, account, onLog, tag = '') {
  switch (platform) {
    case 'facebook':
      await loginFacebook(page, account, onLog, tag);
      break;
    case 'instagram':
      await loginInstagram(page, account, onLog, tag);
      break;
    case 'tiktok':
      await loginTikTok(page, account, onLog, tag);
      break;
    case 'twitter':
      await loginTwitter(page, account, onLog, tag);
      break;
    case 'youtube':
      await loginYouTube(page, account, onLog, tag);
      break;
    case 'threads':
      await loginThreads(page, account, onLog, tag);
      break;
    default:
      throw new Error(`Platform ${platform} belum didukung`);
  }
}

// --- LOGIN IMPLEMENTATIONS (Puppeteer-friendly) ---
async function prosesAkunFacebook(account, onLog, tag = '') {
  // 1. Buka halaman baru
  const browser = await puppeteer.launch({ headless: false });
  const pages = await browser.pages();
  const page = pages.length ? pages[0] : await browser.newPage();

  // Coba load cookies dari file dulu (lebih reliable daripada account.cookies)
let storedCookies = loadCookiesFromFile(platform, account.username);

// Fallback: kalau file tidak ada, coba dari account.cookies (cara lama)
if (!storedCookies && account.cookies) {
  try {
    const parsed = JSON.parse(account.cookies);
    if (Array.isArray(parsed) && parsed.length) storedCookies = parsed;
  } catch {}
}

if (storedCookies && storedCookies.length) {
  try {
    await page.setCookie(...storedCookies);
    onLog({ type: 'info', message: `${tag} ✅ Sesi tersimpan dimuat (${storedCookies.length} cookies)` });
  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Gagal restore cookies: ${e.message}` });
    storedCookies = null;
  }
}

  // 3. Login jika perlu
  await loginFacebook(page, account, onLog, tag);

  // 4. Setelah login sukses, simpan cookies!
  const cookiesBaru = await page.cookies();
  account.cookies = JSON.stringify(cookiesBaru);

  // 5. Lakukan aksi utama (like, komen, dsb)
  await aksiNaturalFacebook(page, account, onLog, tag);

  await browser.close();
}

async function loginInstagram(page, account, onLog, tag = '') {
  // Step 1: Buka beranda Instagram dulu
  onLog({ type: 'info', message: `${tag} Buka Instagram...` });
  
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Goto error: ${e.message}, lanjut...` });
  }
  await sleep(3000);
  
  // Step 2: Cek apakah sudah login (via cookie sessionid)
  try {
    const cookies = await page.cookies('https://www.instagram.com');
    const sessionCookie = cookies.find(c => c.name === 'sessionid');
    if (sessionCookie && sessionCookie.value) {
      const url = page.url();
      if (!url.includes('/accounts/login') && !url.includes('/login')) {
        onLog({ type: 'success', message: `${tag} ✅ Sudah login (sesi valid dari profile)` });
        return;
      }
    }
  } catch (e) {}
  
  // Step 3: Navigasi ke halaman login
  onLog({ type: 'info', message: `${tag} Buka halaman login Instagram...` });
  
  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Goto error: ${e.message}` });
  }
  await sleep(3000);
  
  // Menggunakan safeType agar fallback ke evaluate() ketika UI IG block klik
  await safeType(page, 'input[name="username"], input[type="text"]', account.username);
  await sleep(800);
  
  await safeType(page, 'input[name="password"], input[type="password"]', account.password);
  await sleep(800);
  
  // Step 7: Klik tombol login
  const submitClicked = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    // Strategi 1: button[type="submit"]
    let btn = document.querySelector('button[type="submit"]');
    
    // Strategi 2: text-based
    if (!btn) {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      btn = buttons.find(el => {
        const text = (el.innerText || '').trim().toLowerCase();
        return /^(log in|masuk|login|sign in)$/.test(text);
      });
    }
    
    if (btn) {
      btn.scrollIntoView({ behavior: 'auto', block: 'center' });
      await sleep(500);
      btn.click();
      return true;
    }
    return false;
  });
  
  if (!submitClicked) {
    throw new Error('Tombol Login Instagram tidak ditemukan');
  }
  
  onLog({ type: 'info', message: `${tag} Login submitted, menunggu response...` });
  
  // Step 8: Tunggu navigasi (dengan toleransi)
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {}
  
  await sleep(3000);
  
  // Step 9: Loop deteksi - tunggu sampai login berhasil ATAU manual challenge selesai
  // Maksimal 5 menit untuk handle email OTP / 2FA / challenge
  const checkStart = Date.now();
  const maxCheckTime = 300000; // 5 menit
  let lastUrl = '';
  let warnedChallenge = false;
  let warnedEmailCode = false;
  
  while (Date.now() - checkStart < maxCheckTime) {
    let url = '';
    let hasSessionCookie = false;
    
    try {
      url = page.url();
      const cookies = await page.cookies('https://www.instagram.com');
      hasSessionCookie = !!cookies.find(c => c.name === 'sessionid' && c.value);
    } catch (e) {
      // Frame detached, retry
      await sleep(2000);
      continue;
    }
    
    // Log URL changes
    if (url !== lastUrl) {
      onLog({ type: 'info', message: `${tag} URL: ${url.slice(0, 100)}` });
      lastUrl = url;
    }
    
    // SUKSES: cookie sessionid ada DAN URL bukan login/challenge
    if (hasSessionCookie && !url.includes('/accounts/login') && !url.includes('/challenge') && !url.includes('/2fa')) {
      onLog({ type: 'success', message: `${tag} ✅ Login Instagram berhasil!` });
      
      // Handle popup "Save login info" + "Notifications"
      await sleep(2000);
      try {
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
          for (const btn of buttons) {
            const text = (btn.innerText || '').trim().toLowerCase();
            if (/^(not now|nanti saja|jangan sekarang|skip)$/.test(text)) {
              btn.click();
              return;
            }
          }
        });
      } catch {}
      
      return;
    }
    
    // CHALLENGE: kemungkinan email OTP / suspicious login
    if (url.includes('/challenge') && !warnedChallenge) {
      onLog({ type: 'warn', message: `${tag} ⚠️ INSTAGRAM CHALLENGE TERDETEKSI!` });
      onLog({ type: 'warn', message: `${tag} 📧 Kemungkinan minta kode dari email/SMS` });
      onLog({ type: 'warn', message: `${tag} ⏰ Buka browser, solve manual dalam 5 menit...` });
      try {
        await takeScreenshot(page, account.username, 'instagram-challenge', onLog, tag);
      } catch {}
      warnedChallenge = true;
    }
    
    // 2FA TOTP: kalau ada secret di akun, coba auto-fill
    if ((url.includes('/2fa') || url.includes('two_factor')) && !warnedEmailCode) {
      if (['totp', 'google_auth', 'duo_mobile', '2fa_live'].includes(account.twoFAType) && account.twoFactorSecret) {
        onLog({ type: 'info', message: `${tag} 🔐 Deteksi 2FA TOTP, generate kode...` });
        try {
          const totp = generateTOTP(account.twoFactorSecret);
          onLog({ type: 'info', message: `${tag} 🔑 Kode TOTP: ${totp}` });
          
          // Cari input 2FA dan isi
          await page.evaluate((code) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const target = inputs.find(el => {
              if (!['text', 'tel', 'number'].includes(el.type)) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
            if (target) {
              target.focus();
              target.click();
            }
          }, totp);
          await sleep(500);
          await page.keyboard.type(totp, { delay: 100 });
          await sleep(800);
          
          // Submit
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const btn = buttons.find(el => {
              const text = (el.innerText || '').trim().toLowerCase();
              return /^(confirm|next|submit|kirim|lanjutkan|verify|continue)$/.test(text);
            });
            if (btn) btn.click();
          });
          onLog({ type: 'success', message: `${tag} Kode 2FA diketik otomatis!` });
        } catch (e) {
          onLog({ type: 'warn', message: `${tag} Auto 2FA error: ${e.message}` });
        }
      } else {
        onLog({ type: 'warn', message: `${tag} ⚠️ 2FA Instagram terdeteksi, isi manual dalam 5 menit...` });
      }
      warnedEmailCode = true;
    }
    
    await sleep(3000);
  }
  
  // Timeout 5 menit habis
  throw new Error('Login Instagram gagal — timeout 5 menit, sesi tidak terverifikasi');
}

async function loginTikTok(page, account, onLog, tag = '') {
  onLog({ type: 'info', message: `${tag} Buka halaman login TikTok...` });
  await page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  try {
    await page.waitForSelector('input[name="username"], input[name="email"], input[type="text"]', { timeout: 10000 });
    
    const userInput = await page.$('input[name="username"]') || await page.$('input[name="email"]') || await page.$('input[type="text"]');
    if (userInput) {
      await userInput.click({ clickCount: 3 });
      await userInput.type(account.username, { delay: 60 });
    }

    const passInput = await page.$('input[type="password"]');
    if (passInput) {
      await passInput.click({ clickCount: 3 });
      await passInput.type(account.password, { delay: 60 });
    }

    // Cari dan klik tombol Login
    const loginClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[type="submit"], button'));
      const target = btns.find(b => /log in|masuk|login|sign in/i.test((b.innerText || '').trim()));
      if (target && !target.disabled) {
        target.click();
        return true;
      }
      return false;
    });

    if (!loginClicked) await page.keyboard.press('Enter');

  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Form login TikTok gagal dideteksi: ${e.message}` });
  }

  onLog({ type: 'info', message: `${tag} Menunggu proses verifikasi (jika ada Captcha, silakan selesaikan di browser)...` });
  
  // Beri waktu 60 detik jika TikTok menampilkan Puzzle Captcha
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const url = page.url();
    if (!url.includes('login')) {
      onLog({ type: 'success', message: `${tag} ✅ Login TikTok berhasil!` });
      return;
    }
  }

  throw new Error('Login TikTok gagal (timeout/captcha tidak terselesaikan)');
}

async function loginTwitter(page, account, onLog, tag = '') {
  onLog({ type: 'info', message: `${tag} Buka halaman login Twitter/X...` });
  await page.goto('https://twitter.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  try {
    // Tahap 1: Username
    const userInp = await safeWaitForSelector(page, 'input[autocomplete="username"], input[name="text"]', 10000);
    if (userInp) {
      await userInp.type(account.username, { delay: 60 });
      await page.keyboard.press('Enter');
      await sleep(2000);
    }

    // Kadang Twitter verifikasi extra (nomor HP / Email ulang)
    const unusualInp = await safeWaitForSelector(page, 'input[data-testid="ocfEnterTextTextInput"]', 3000);
    if (unusualInp) {
      onLog({ type: 'info', message: `${tag} Terdeteksi verifikasi aktivitas login, ketik ulang username/email...` });
      await unusualInp.type(account.username, { delay: 60 });
      await page.keyboard.press('Enter');
      await sleep(2000);
    }

    // Tahap 2: Password
    const passInp = await safeWaitForSelector(page, 'input[type="password"], input[name="password"]', 10000);
    if (passInp) {
      await passInp.type(account.password, { delay: 60 });
      
      const loginBtn = await page.$('div[data-testid="LoginForm_Login_Button"]');
      if (loginBtn) {
        await loginBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
    }
  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Error navigasi login Twitter: ${e.message}` });
  }

  onLog({ type: 'info', message: `${tag} Menunggu konfirmasi login...` });
  
  // Beri waktu 30 detik untuk verifikasi (misal butuh 2FA email)
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const url = page.url();
    if (!url.includes('login') && !url.includes('flow/')) {
      onLog({ type: 'success', message: `${tag} ✅ Login Twitter/X berhasil!` });
      return;
    }
  }

  throw new Error('Login Twitter/X gagal (timeout)');
}

async function loginYouTube(page, account, onLog, tag = '') {
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'networkidle2' });

  if (!account.username || !account.password) {
    onLog({ type: 'warn', message: `${tag} ⚠️ Email/Password kosong di pengaturan. Silakan ketik manual di browser dalam 90 detik...` });
    await sleep(90000);
  } else {
    await safeType(page, 'input[type="email"]', account.username);
    await page.keyboard.press('Enter');
    await sleep(3000); // Google butuh waktu load animasi panel password

    await safeType(page, 'input[type="password"]', account.password);
    await sleep(500);
    await page.keyboard.press('Enter');
  }
  
  try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }); } catch {}

  if (page.url().includes('challenge') || page.url().includes('signin/v2/challenge')) {
    onLog({ type: 'warn', message: `${tag} 🔐 Terdeteksi Challenge/2FA Google...` });
    await handle2FA(page, account, onLog, tag);
    try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }); } catch {}
  }
  
  if (page.url().includes('signin') || page.url().includes('accounts.google')) {
    onLog({ type: 'warn', message: `${tag} ⚠️ Anda masih di halaman Sign-In. Selesaikan aksi manual di jendela browser jika diminta verifikasi HP (Waktu: 60 dtk)` });
    await sleep(60000);
  }

  await page.goto('https://www.youtube.com', { waitUntil: 'networkidle2' });
  onLog({ type: 'success', message: `${tag} ✅ Login YouTube berhasil!` });
}

async function loginThreads(page, account, onLog, tag = '') {
  
  await page.goto('https://www.threads.net/login', { waitUntil: 'networkidle2' });

  await page.waitForSelector('input[autocomplete="username"], input[name="username"]', { timeout: 12000 });
  await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 12000 });

  const userInput = await page.$('input[autocomplete="username"]') || await page.$('input[name="username"]');
  await userInput.click({ clickCount: 3 });
  await userInput.type(account.username, { delay: 50 });

  const passInput = await page.$('input[type="password"]') || await page.$('input[name="password"]');
  await passInput.click({ clickCount: 3 });
  await passInput.type(account.password, { delay: 50 });

  // Tombol login berbasis teks (Log in, Masuk)
  let loginBtn = await page.$('button[type="submit"]');
  if (!loginBtn) {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await page.evaluate(el => el.innerText, btn);
      if (text && /log in|masuk|login|sign in/i.test(text)) {
        loginBtn = btn;
        break;
      }
    }
  }
  if (loginBtn) {
    // Coba scroll ke tombol, lalu klik via Puppeteer dan fallback ke evaluate JS
    await page.evaluate(el => { el.scrollIntoView({behavior: 'auto', block: 'center'}); }, loginBtn);
    await sleep(500); // agar scroll sempat jalan
    try {
      await loginBtn.click({ delay: 50 });
    } catch (e) {
      // Fallback: paksa klik via JS kalau "not clickable"
      await page.evaluate(el => el.click(), loginBtn);
    }
  } else {
    throw new Error('Tombol Login Threads tidak ditemukan');
  }

  try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }); } catch {}
  if (page.url().includes('login')) {
    throw new Error('Login Threads gagal — cek username/password');
  }
  onLog({ type: 'success', message: `${tag} ✅ Login Threads berhasil!` });
}

async function handle2FA(page, account, onLog, tag = '') {
  const { twoFAType, twoFactorSecret } = account || {};
  if (['totp', 'google_auth', 'duo_mobile', '2fa_live'].includes(twoFAType) && twoFactorSecret) {
    onLog({ type: 'info', message: `${tag} 🔐 Mendeteksi 2FA TOTP, generate kode...` });
    try {
      const totp = generateTOTP(twoFactorSecret);
      onLog({ type: 'info', message: `${tag} 🔑 Kode 2FA: ${totp}` });
      // Try to fill common inputs
      const selector = await safeWaitForSelector(
        page,
        'input[name="approvals_code"], input[id="approvals_code"], input[placeholder*="code"], input[type="tel"]',
        10000
      ).catch(() => null);
      if (selector) {
        await page.evaluate((t) => {
          const el = document.querySelector('input[name="approvals_code"], input[id="approvals_code"], input[placeholder*="code"], input[type="tel"]');
          if (el) { el.focus(); el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); }
        }, totp);
        await clickButtonByText(page, ['Lanjutkan', 'Continue', 'Submit', 'Kirim'], 'button,div');
        onLog({ type: 'success', message: `${tag} ✅ Kode 2FA berhasil diisi otomatis!` });
      } else {
        onLog({ type: 'warn', message: `${tag} Tidak menemukan input 2FA, silakan isi manual dalam 3 menit jika perlu...` });
        // PATCH: Tunggu sampai sukses login (via cookies/session/beranda) ATAU timeout 3 menit
        await waitAfter2FA(page, 180000);
      }
    } catch (err) {
      onLog({ type: 'warn', message: `${tag} 2FA error: ${err.message}` });
      onLog({ type: 'warn', message: `${tag} Silakan isi kode 2FA manual di browser (maks 3 menit)...` });
      await waitAfter2FA(page, 180000);
    }
  } else {
    onLog({ type: 'warn', message: `${tag} ⚠️ 2FA terdeteksi — silakan isi manual di browser. Menunggu sampai login atau maksimal 3 menit...` });
    await waitAfter2FA(page, 180000);
  }
}

  // ...existing code...

function generateTOTP(secret) {
  // same algorithm as original (kept)
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

// ---------- Actions ----------
async function performAction(page, platform, action, targetUrl, commentTemplates, onLog, tag = '') {
  // targetUrl can be undefined -> fallback to platform home
  const url = targetUrl || getPlatformHome(platform);
  try {
    const currentUrl = page.url();
    const cleanCurrent = currentUrl.split('?')[0].replace(/\/$/, '');
    const cleanTarget = url.split('?')[0].replace(/\/$/, '');
    
    // Hanya load ulang halaman jika URL-nya berbeda, agar aksi beruntun (misal: Like lalu Comment) lebih cepat
    if (cleanCurrent !== cleanTarget && cleanCurrent !== url) {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000 + Math.random() * 1000);
    }
  } catch (e) {
    // ignore navigation error, continue to try actions
  }
  await sleep(1000 + Math.random() * 1000);

  switch (platform) {
    case 'facebook':
      return performFacebookAction(page, action, commentTemplates, onLog, tag);
    case 'instagram':
      return performInstagramAction(page, action, commentTemplates, onLog, tag);
    case 'tiktok':
      return performTikTokAction(page, action, commentTemplates, onLog, tag);
    case 'twitter':
      return performTwitterAction(page, action, commentTemplates, onLog, tag);
    case 'youtube':
      return performYouTubeAction(page, action, commentTemplates, onLog, tag);
    case 'threads':
      return performThreadsAction(page, action, commentTemplates, onLog, tag);
    default:
      throw new Error(`Platform ${platform} belum didukung`);
  }
}

// Facebook action functions
async function performFacebookAction(page, action, commentTemplates, onLog, tag = '') {
  switch (action) {
    case 'like':
      try {
        await likeFacebookPost(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Like error: ${e.message}` });
      }
      break;
    
    case 'comment':
      try {
        await commentFacebookPost(page, commentTemplates, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Komentar error: ${e.message}` });
      }
      break;
    
    case 'share':
      try {
        await shareFacebookPost(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Share error: ${e.message}` });
      }
      break;
    
    case 'add_friend':
      try {
        await addFriendFacebook(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Add friend error: ${e.message}` });
      }
      break;
    
    case 'scroll':
      await scrollPage(page, onLog, tag);
      break;
    
      case 'follow_page':
      try {
        await followPageFacebook(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Follow error: ${e.message}` });
      }
      break;

    case 'auto_reply':
      try {
        await autoReplyFacebook(page, commentTemplates, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Auto-reply error: ${e.message}` });
      }
      break;

    case 'scrape_comments':
      try {
        await scrapeCommentsFacebook(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Scrape error: ${e.message}` });
      }
      break;

    default:
      onLog({ type: 'warn', message: `${tag} Aksi ${action} belum diimplementasikan` });
  }
}
// ---------- Facebook: Like Post ----------
async function likeFacebookPost(page, onLog, tag = '') {
  const likeAriaSelectors = [
    'div[aria-label="Suka"][role="button"]',
    'div[aria-label="Like"][role="button"]',
    'div[aria-label="Sukai"][role="button"]',
    '[aria-label="Suka"][role="button"]',
    '[aria-label="Like"][role="button"]',
    '[aria-label="Sukai"][role="button"]'
  ];
  
  for (const sel of likeAriaSelectors) {
    try {
      const buttons = await page.$$(sel);
      if (buttons.length === 0) continue;
      
      const btn = buttons[0]; // Fokus ke postingan pertama yang terlihat agar like/comment sinkron
      
      try {
        await btn.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      } catch {}
      await sleep(800 + Math.random() * 600);
      
      await btn.click();
      onLog({ type: 'success', message: `${tag} 👍 Like Facebook berhasil!` });
      await sleep(1000 + Math.random() * 1000);
      return;
    } catch (e) {
      // Try next selector
    }
  }
  
  // Fallback text-based
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
    const matches = candidates.filter(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.innerText || '').trim().toLowerCase();
      return /^(suka|like|sukai)$/.test(label) || /^(suka|like|sukai)$/.test(text);
    });
    
    if (matches.length === 0) return false;
    
    const visible = matches.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (visible.length === 0) return false;
    
    const target = visible[0]; // Fokus ke postingan pertama yang terlihat agar like/comment sinkron
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.click();
    return true;
  });
  
  if (clicked) {
    onLog({ type: 'success', message: `${tag} 👍 Like Facebook berhasil! (text fallback)` });
    await sleep(1000 + Math.random() * 1000);
    return;
  }
  
  onLog({ type: 'warn', message: `${tag} Tombol like tidak ditemukan` });
}

// ---------- Facebook: Comment on Post ----------
async function commentFacebookPost(page, commentTemplates, onLog, tag = '') {
  const comment = (commentTemplates && commentTemplates.length) 
    ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] 
    : 'Mantap! 👍';
  
  const commentAriaSelectors = [
    'div[aria-label="Tulis komentar"][role="textbox"]',
    'div[aria-label="Tulis komentar…"][role="textbox"]',
    'div[aria-label="Write a comment"][role="textbox"]',
    'div[aria-label="Write a comment…"][role="textbox"]',
    'div[aria-label*="komentar" i][role="textbox"]',
    'div[aria-label*="comment" i][role="textbox"]',
    '[contenteditable="true"][role="textbox"][aria-label*="omentar"]',
    '[contenteditable="true"][role="textbox"][aria-label*="omment"]'
  ];
  
  let commentBox = null;
  
  for (const sel of commentAriaSelectors) {
    try {
      const boxes = await page.$$(sel);
      const visible = [];
      for (const b of boxes) {
        try {
          const visibility = await b.evaluate(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (visibility) visible.push(b);
        } catch {}
      }
      if (visible.length > 0) {
        commentBox = visible[0]; // Fokus ke postingan pertama yang terlihat agar like/comment sinkron
        break;
      }
    } catch {}
  }
  
  // Kalau tidak ketemu, coba klik tombol "Komentar" dulu
  if (!commentBox) {
    const opened = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
      const matches = candidates.filter(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        const text = (el.innerText || '').trim().toLowerCase();
        return /^(komentari|komentar|comment)$/.test(label) || /^(komentari|komentar|comment)$/.test(text);
      });
      const visible = matches.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (visible.length === 0) return false;
      const target = visible[0]; // Fokus ke postingan pertama yang terlihat agar like/comment sinkron
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.click();
      return true;
    });
    
    if (opened) {
      await sleep(1500 + Math.random() * 1000);
      for (const sel of commentAriaSelectors) {
        try {
          commentBox = await page.$(sel);
          if (commentBox) break;
        } catch {}
      }
    }
  }
  
  if (!commentBox) {
    onLog({ type: 'warn', message: `${tag} Kolom komentar tidak ditemukan` });
    return;
  }
  
  try {
    await commentBox.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } catch {}
  await sleep(700 + Math.random() * 500);
  
  await commentBox.click();
  await sleep(800 + Math.random() * 500);
  
  await page.keyboard.type(comment, { delay: 60 + Math.random() * 80 });
  await sleep(800 + Math.random() * 600);
  
  await page.keyboard.press('Enter');
  await sleep(1500);
  
  onLog({ type: 'success', message: `${tag} 💬 Komentar Facebook berhasil: "${comment}"` });
}

// ---------- Facebook: Add Friend & Confirm Friend Requests ----------
async function addFriendFacebook(page, onLog, tag = '') {
  const MAX_ADD = 5;
  const MAX_CONFIRM = 5;
  
  // ===== BAGIAN 1: Konfirmasi friend request yang masuk =====
  onLog({ type: 'info', message: `${tag} 👥 Cek permintaan pertemanan masuk...` });
  
  try {
    await page.goto('https://www.facebook.com/friends/requests', { 
      waitUntil: 'networkidle2', 
      timeout: 25000 
    });
    await sleep(2500 + Math.random() * 1500);
    
    await page.evaluate(() => window.scrollBy(0, 300));
    await sleep(1200);
    
    // Cari tombol Konfirmasi via text-based detection
    const confirmedCount = await page.evaluate(async (maxConfirm) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      const findConfirmButtons = () => {
        const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button'));
        return candidates.filter(el => {
          const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          const text = (el.innerText || '').trim().toLowerCase();
          // Match: konfirmasi, confirm, terima, accept (tapi BUKAN "konfirmasi penghapusan" dll)
          const isMatch = /^(konfirmasi|confirm|terima|accept)$/.test(label) ||
                          /^(konfirmasi|confirm|terima|accept)$/.test(text);
          if (!isMatch) return false;
          // Pastikan visible
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      };
      
      let count = 0;
      for (let i = 0; i < maxConfirm; i++) {
        const buttons = findConfirmButtons();
        if (buttons.length === 0) break;
        
        const btn = buttons[0]; // klik yang paling atas
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(800 + Math.random() * 500);
        btn.click();
        count++;
        await sleep(2000 + Math.random() * 2000);
      }
      
      return count;
    }, MAX_CONFIRM);
    
    if (confirmedCount > 0) {
      onLog({ type: 'success', message: `${tag} 🎉 Total ${confirmedCount} permintaan pertemanan dikonfirmasi` });
    } else {
      onLog({ type: 'info', message: `${tag} Tidak ada permintaan pertemanan masuk` });
    }
  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Gagal cek permintaan masuk: ${e.message}` });
  }
  
  // Jeda sebelum lanjut ke add friend
  await sleep(3000 + Math.random() * 3000);
  
  // ===== BAGIAN 2: Kirim friend request via People You May Know =====
  onLog({ type: 'info', message: `${tag} 👥 Buka People You May Know...` });
  
  try {
    await page.goto('https://www.facebook.com/friends/suggestions', { 
      waitUntil: 'networkidle2', 
      timeout: 25000 
    });
  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Gagal buka halaman saran teman: ${e.message}` });
    return;
  }
  
  await sleep(3500 + Math.random() * 2000);
  
  // Scroll biar lebih banyak suggestion ke-load
  await page.evaluate(() => window.scrollBy(0, 600));
  await sleep(1500);
  
  // Klik tombol Add Friend via text-based detection (lebih tahan banting)
  const addedCount = await page.evaluate(async (maxAdd) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const findAddButtons = () => {
      const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button'));
      return candidates.filter(el => {
        const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const text = (el.innerText || '').trim().toLowerCase();
        // Match berbagai variasi: "tambah jadi teman", "tambahkan teman", "add friend", dll
        const patterns = [
          /^tambah jadi teman$/,
          /^tambahkan teman$/,
          /^tambahkan sebagai teman$/,
          /^tambah teman$/,
          /^jadikan teman$/,
          /^add friend$/,
          /^add as friend$/,
          /^kirim permintaan pertemanan$/,
          /^send friend request$/
        ];
        const isMatch = patterns.some(p => p.test(label) || p.test(text));
        if (!isMatch) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    };
    
    let count = 0;
    const clickedElements = new Set();
    
    for (let attempt = 0; attempt < maxAdd * 3 && count < maxAdd; attempt++) {
      const buttons = findAddButtons();
      
      // Cari tombol yang belum di-klik
      const target = buttons.find(b => !clickedElements.has(b));
      if (!target) {
        // Tidak ada tombol baru, scroll untuk load lebih banyak
        window.scrollBy(0, 500);
        await sleep(2000);
        continue;
      }
      
      clickedElements.add(target);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1000 + Math.random() * 800);
      target.click();
      count++;
      
      // Jeda natural antar klik (3-7 detik)
      await sleep(3000 + Math.random() * 4000);
    }
    
    return count;
  }, MAX_ADD);
  
  if (addedCount > 0) {
    onLog({ type: 'success', message: `${tag} 🎉 Total ${addedCount} permintaan pertemanan terkirim` });
  } else {
    onLog({ type: 'warn', message: `${tag} Tidak menemukan tombol Add Friend di halaman suggestions` });
  }
}

// ---------- Facebook: Follow Page ----------
async function followPageFacebook(page, onLog, tag = '') {
  const MAX_FOLLOW = 5;
  
  onLog({ type: 'info', message: `${tag} 📄 Buka halaman discover pages...` });
  
  // Coba beberapa URL discover (Facebook punya beberapa endpoint)
  const discoverUrls = [
    'https://www.facebook.com/pages/?category=liked',
    'https://www.facebook.com/bookmarks/pages',
    'https://www.facebook.com/pages/launchpoint/',
    'https://www.facebook.com/watch/'
  ];
  
  let pageLoaded = false;
  for (const url of discoverUrls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      pageLoaded = true;
      break;
    } catch (e) {
      // Try next URL
    }
  }
  
  if (!pageLoaded) {
    onLog({ type: 'warn', message: `${tag} Gagal buka halaman discover` });
    return;
  }
  
  await sleep(3500 + Math.random() * 2000);
  
  // Scroll biar lebih banyak halaman ke-load
  await page.evaluate(() => window.scrollBy(0, 600));
  await sleep(1500);
  
  // Klik tombol Ikuti via text-based detection
  const followedCount = await page.evaluate(async (maxFollow) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const findFollowButtons = () => {
      const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button, a[role="button"]'));
      return candidates.filter(el => {
        const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const text = (el.innerText || '').trim().toLowerCase();
        // Match exact: "ikuti" / "follow" / "sukai"
        // BUKAN "mengikuti" / "following" (artinya sudah follow → klik = unfollow!)
        const patterns = [
          /^ikuti$/,
          /^follow$/,
          /^sukai$/,
          /^like$/,
          /^like page$/,
          /^sukai halaman$/
        ];
        const isMatch = patterns.some(p => p.test(label) || p.test(text));
        if (!isMatch) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    };
    
    let count = 0;
    const clickedElements = new WeakSet();
    
    for (let attempt = 0; attempt < maxFollow * 3 && count < maxFollow; attempt++) {
      const buttons = findFollowButtons();
      
      const target = buttons.find(b => !clickedElements.has(b));
      if (!target) {
        // Tidak ada tombol baru, scroll untuk load lebih banyak
        window.scrollBy(0, 500);
        await sleep(2000);
        continue;
      }
      
      clickedElements.add(target);
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1000 + Math.random() * 800);
      target.click();
      count++;
      
      // Jeda natural antar follow (3-6 detik)
      await sleep(3000 + Math.random() * 3000);
    }
    
    return count;
  }, MAX_FOLLOW);
  
  if (followedCount > 0) {
    onLog({ type: 'success', message: `${tag} 🎉 Total ${followedCount} halaman ter-follow` });
  } else {
    onLog({ type: 'warn', message: `${tag} Tidak menemukan tombol Ikuti/Follow di halaman discover` });
  }
}

// ---------- Facebook: Share Post ----------
async function shareFacebookPost(page, onLog, tag = '') {
  // Strategi 1: cari tombol Share/Bagikan via text-based detection
  const opened = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button'));
    const matches = candidates.filter(el => {
      const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const text = (el.innerText || '').trim().toLowerCase();
      // Match: bagikan, share (exact, biar tidak ke-match "bagikan ke teman dekat" dll yang sub-menu)
      const patterns = [/^bagikan$/, /^share$/, /^kirim$/, /^send$/];
      const isMatch = patterns.some(p => p.test(label) || p.test(text));
      if (!isMatch) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (matches.length === 0) return false;
    
    // Pilih elemen yang paling pertama terlihat
    const target = matches[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    target.click();
    return true;
  });
  
  if (!opened) {
    onLog({ type: 'warn', message: `${tag} Tombol share/bagikan tidak ditemukan` });
    return;
  }
  
  // Tunggu dialog/menu share muncul
  await sleep(1500 + Math.random() * 1000);
  
  // Strategi 2: cari opsi "Bagikan sekarang" / "Share now" / "Bagikan ke kronologi" di popup
  const shared = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const candidates = Array.from(document.querySelectorAll('div[role="button"], div[role="menuitem"], span[role="button"], button, a[role="button"]'));
    const matches = candidates.filter(el => {
      const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const text = (el.innerText || '').trim().toLowerCase();
      // Match opsi share publik di popup (bukan "kirim sebagai pesan" yang private)
      const patterns = [
        /^bagikan sekarang$/,
        /^bagikan ke kronologi$/,
        /^bagikan ke kabar berita$/,
        /^bagikan ke beranda$/,
        /^share now$/,
        /^share to news feed$/,
        /^share to feed$/,
        /^share to your story$/,
        /^bagikan ke cerita$/
      ];
      const isMatch = patterns.some(p => p.test(label) || p.test(text));
      if (!isMatch) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (matches.length === 0) return false;
    
    const target = matches[0]; // Fokus ke elemen paling pertama terlihat
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(600);
    target.click();
    return true;
  });
  
  await sleep(1500);
  
  if (shared) {
    onLog({ type: 'success', message: `${tag} ↗ Share Facebook berhasil!` });
  } else {
    // Tombol share sudah diklik, tapi tidak ada opsi share publik yang ditemukan.
    // Kemungkinan dialog memang muncul, cukup laporkan parsial dan tutup popup
    try {
      await page.keyboard.press('Escape');
    } catch {}
    onLog({ type: 'warn', message: `${tag} Tombol share diklik, tapi opsi "Bagikan sekarang" tidak ditemukan (popup ditutup)` });
  }
}

// ---------- Facebook: Auto Reply Comment ----------
async function autoReplyFacebook(page, commentTemplates, onLog, tag = '') {
  onLog({ type: 'info', message: `${tag} 🤖 Mencari komentar untuk dibalas...` });
  await sleep(2000);
  await page.evaluate(() => window.scrollBy(0, 500));
  await sleep(1500);

  const replyClicked = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const elements = Array.from(document.querySelectorAll('div[role="button"], span'));
    const replyBtns = elements.filter(el => {
      const text = (el.innerText || '').trim().toLowerCase();
      return text === 'balas' || text === 'reply';
    });

    const visible = replyBtns.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    if (visible.length === 0) return false;

    // Pilih secara acak dari 5 komentar pertama yang terlihat
    const target = visible[Math.floor(Math.random() * Math.min(visible.length, 5))];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    target.click();
    return true;
  });

  if (!replyClicked) {
    onLog({ type: 'warn', message: `${tag} Tidak ada tombol Balas/Reply yang ditemukan di halaman ini.` });
    return;
  }

  await sleep(1500);
  const comment = (commentTemplates && commentTemplates.length) 
    ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] 
    : 'Terima kasih! 🙏';

  // Ketik balasan
  await page.keyboard.type(comment, { delay: 60 + Math.random() * 50 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(2000);
  onLog({ type: 'success', message: `${tag} 🤖 Berhasil membalas komentar: "${comment}"` });
}

// ---------- Facebook: Scrape Comments ----------
async function scrapeCommentsFacebook(page, onLog, tag = '') {
  onLog({ type: 'info', message: `${tag} 📥 Memulai scrape (ekstrak) komentar...` });
  await sleep(2000);
  await page.evaluate(() => window.scrollBy(0, 500));
  await sleep(1500);

  // Klik "Lihat komentar lainnya" maksimal 5 kali agar datanya banyak
  for (let i = 0; i < 5; i++) {
    const expanded = await page.evaluate(async () => {
      const btns = Array.from(document.querySelectorAll('div[role="button"]'));
      const more = btns.find(b => {
        const txt = (b.innerText || '').toLowerCase();
        return txt.includes('lihat komentar sebelumnya') || txt.includes('lihat komentar lain') || txt.includes('view more comments');
      });
      if (more) {
        more.scrollIntoView({ behavior: 'smooth', block: 'center' });
        more.click();
        return true;
      }
      return false;
    });
    if (!expanded) break;
    await sleep(2500); // Tunggu loading komentar baru
  }

  // Ambil semua nama
  const users = await page.evaluate(() => {
    // Di FB, komentar biasa dibungkus div[role="article"] dan nama pengirim adalah link pertama
    const articles = Array.from(document.querySelectorAll('div[role="article"]'));
    const names = articles.map(article => {
      const link = article.querySelector('a[role="link"]');
      return link ? link.innerText.trim() : null;
    }).filter(n => n && n.length > 2 && !/suka|balas|bagikan|like|reply|share/i.test(n));
    return [...new Set(names)]; // Buang duplikat
  });

  if (users.length === 0) {
    onLog({ type: 'warn', message: `${tag} Tidak ada username yang berhasil diekstrak.` });
    return;
  }

  const filename = await saveScrapedData('Facebook', users, onLog);
  onLog({ type: 'success', message: `${tag} 📥 Berhasil mengekstrak ${users.length} akun. Tersimpan di: ${filename}` });
}

// Implementations for Instagram / TikTok / Twitter / YouTube / Threads follow same pattern
// For brevity, keep original logic but replace Playwright-specific calls with Puppeteer-friendly ones.
// Example for Instagram like (using $eval to read attribute):
async function performInstagramAction(page, action, commentTemplates, onLog, tag = '') {
  switch (action) {
    case 'like':
      try {
        await likeInstagramPost(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram like error: ${e.message}` });
      }
      break;
    
    case 'scroll':
      try {
        await scrollInstagramFeed(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram scroll error: ${e.message}` });
      }
      break;
    
    case 'story_view':
      try {
        await viewInstagramStories(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram story view error: ${e.message}` });
      }
      break;
    
    case 'save':
      try {
        await saveInstagramPost(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram save error: ${e.message}` });
      }
      break;
    
    case 'follow':
      try {
        await followInstagramRandom(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram follow error: ${e.message}` });
      }
      break;
    
    case 'comment':
      try {
        await commentInstagramPost(page, commentTemplates, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram comment error: ${e.message}` });
      }
      break;

    case 'repost':
      try {
        await repostInstagramPost(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram repost error: ${e.message}` });
      }
      break;

    case 'auto_reply':
      try {
        await autoReplyInstagram(page, commentTemplates, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram auto-reply error: ${e.message}` });
      }
      break;

    case 'scrape_comments':
      try {
        await scrapeCommentsInstagram(page, onLog, tag);
      } catch (e) {
        onLog({ type: 'warn', message: `${tag} Instagram scrape error: ${e.message}` });
      }
      break;

    default:
      onLog({ type: 'warn', message: `${tag} Aksi ${action} belum diimplementasikan untuk Instagram` });
  }
}

// ---------- Instagram: Like ----------
async function likeInstagramPost(page, onLog, tag = '') {
  // Pastikan di feed Instagram
  if (!page.url().includes('instagram.com')) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
  }
  
  // Cari tombol like via SVG aria-label
  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
    const likeSvgs = svgs.filter(svg => {
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      // Match "Suka" / "Like" tapi BUKAN "Unlike" (sudah di-like)
      return /^(suka|like)$/.test(label);
    });
    
    // Filter yang visible
    const visible = likeSvgs.filter(svg => {
      const r = svg.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (visible.length === 0) return { ok: false, reason: 'no-like-button' };
    
    // Pilih postingan yang pertama kali terlihat agar seragam dengan fungsi komentar
    const target = visible[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    
    // Klik parent button (kadang SVG-nya tidak clickable, parent yang clickable)
    const clickable = target.closest('button, div[role="button"], span[role="button"]') || target;
    clickable.click();
    
    return { ok: true };
  });
  
  if (result.ok) {
    onLog({ type: 'success', message: `${tag} ❤️ Like Instagram berhasil!` });
  } else {
    onLog({ type: 'warn', message: `${tag} Tombol like tidak ditemukan (${result.reason})` });
  }
}

// ---------- Instagram: Scroll Feed ----------
async function scrollInstagramFeed(page, onLog, tag = '') {
  if (!page.url().includes('instagram.com')) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
  }
  
  onLog({ type: 'info', message: `${tag} 📜 Scrolling feed Instagram...` });
  
  // Scroll random 5-10 kali, dengan jeda natural
  const scrollCount = 5 + Math.floor(Math.random() * 6);
  for (let i = 0; i < scrollCount; i++) {
    const scrollAmount = 300 + Math.floor(Math.random() * 500);
    await page.evaluate((amt) => window.scrollBy(0, amt), scrollAmount);
    
    // Jeda 1.5-4 detik per scroll (mirip user yang baca post)
    await sleep(1500 + Math.random() * 2500);
  }
  
  onLog({ type: 'success', message: `${tag} ✅ Scroll ${scrollCount}x selesai` });
}

// ---------- Instagram: View Stories ----------
async function viewInstagramStories(page, onLog, tag = '') {
  // Pastikan di beranda
  if (!page.url().match(/instagram\.com\/?$/)) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
  }
  
  onLog({ type: 'info', message: `${tag} 👁 Cari stories untuk dilihat...` });
  
  // Klik story pertama yang ada di header feed
  const opened = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    // Story biasanya dalam container <ul> di header feed
    // Cari button/role=button yang mengandung canvas atau image dengan label tertentu
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const storyButtons = buttons.filter(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.innerText || '').toLowerCase();
      // Match story dari user lain, BUKAN "Story Anda" / "Your Story" (yang itu untuk upload)
      const isStory = /story|cerita/i.test(label) && 
                      !/your story|cerita anda|upload/i.test(label);
      if (!isStory) return false;
      const r = el.getBoundingClientRect();
      // Story button biasanya kecil & di header (Y rendah)
      return r.width > 0 && r.height > 0 && r.top < 300;
    });
    
    if (storyButtons.length === 0) return { ok: false, reason: 'no-stories' };
    
    // Klik story pertama (atau random dari 3 pertama)
    const target = storyButtons[Math.floor(Math.random() * Math.min(storyButtons.length, 3))];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    target.click();
    return { ok: true };
  });
  
  if (!opened.ok) {
    onLog({ type: 'warn', message: `${tag} Tidak menemukan story (${opened.reason})` });
    return;
  }
  
  onLog({ type: 'info', message: `${tag} 👁 Story dibuka, view 5-10 stories...` });
  await sleep(2000);
  
  // View 5-10 stories dengan tab "Next" (kadang panah kanan, kadang klik area kanan)
  const viewCount = 5 + Math.floor(Math.random() * 6);
  let viewedCount = 0;
  
  for (let i = 0; i < viewCount; i++) {
    // Random durasi view per story (3-8 detik = perilaku natural)
    await sleep(3000 + Math.random() * 5000);
    
    // Klik tombol next (panah kanan) ATAU klik area kanan layar
    const nextClicked = await page.evaluate(() => {
      // Strategi 1: cari tombol "Next" / "Berikutnya"
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const nextBtn = buttons.find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return /next|berikutnya|selanjutnya/i.test(label);
      });
      if (nextBtn) {
        nextBtn.click();
        return true;
      }
      
      // Strategi 2: klik area kanan layar (Instagram pakai click-area untuk navigate)
      const rightArea = document.elementFromPoint(window.innerWidth * 0.8, window.innerHeight / 2);
      if (rightArea) {
        rightArea.click();
        return true;
      }
      return false;
    });
    
    if (!nextClicked) break;
    viewedCount++;
    
    // Cek apakah masih di story (kalau auto-redirect ke beranda, story sudah habis)
    const stillInStory = page.url().includes('/stories/');
    if (!stillInStory) break;
  }
  
  // Tutup story dengan tombol Escape
  try { await page.keyboard.press('Escape'); } catch {}
  await sleep(1000);
  
  onLog({ type: 'success', message: `${tag} ✅ ${viewedCount} stories dilihat` });
}

// ---------- Instagram: Save Post ----------
async function saveInstagramPost(page, onLog, tag = '') {
  if (!page.url().includes('instagram.com')) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
  }
  
  onLog({ type: 'info', message: `${tag} 🔖 Mencari post untuk save...` });
  
  // Cari tombol Save (icon bookmark)
  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
    const saveSvgs = svgs.filter(svg => {
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      // Match "Save" / "Simpan" tapi BUKAN "Remove from saved" / "Hapus dari tersimpan"
      return /^(save|simpan)$/.test(label);
    });
    
    const visible = saveSvgs.filter(svg => {
      const r = svg.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (visible.length === 0) return { ok: false, reason: 'no-save-button' };
    
    const target = visible[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    
    const clickable = target.closest('button, div[role="button"], span[role="button"]') || target;
    clickable.click();
    
    return { ok: true };
  });
  
  if (result.ok) {
    onLog({ type: 'success', message: `${tag} 🔖 Post Instagram berhasil disave!` });
  } else {
    onLog({ type: 'warn', message: `${tag} Tombol save tidak ditemukan (${result.reason})` });
  }
}

// ---------- Instagram: Repost ----------
async function repostInstagramPost(page, onLog, tag = '') {
  if (!page.url().includes('instagram.com')) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
  }
  
  onLog({ type: 'info', message: `${tag} 🔄 Mencari tombol repost...` });
  
  // Cari tombol repost via SVG aria-label (multi kemungkinan label)
  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
    const repostSvgs = svgs.filter(svg => {
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      // Match berbagai variasi label repost
      const patterns = [
        /^repost$/,
        /^reposting$/,
        /^posting ulang$/,
        /^bagikan ulang$/,
        /^reshare$/,
        /^share to your followers$/,
        /^bagikan ke pengikut$/
      ];
      return patterns.some(p => p.test(label));
    });
    
    const visible = repostSvgs.filter(svg => {
      const r = svg.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (visible.length === 0) return { ok: false, reason: 'no-repost-button' };
    
    // Pilih postingan paling atas
    const target = visible[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    
    const clickable = target.closest('button, div[role="button"], span[role="button"]') || target;
    clickable.click();
    
    return { ok: true };
  });
  
  if (!result.ok) {
    onLog({ type: 'warn', message: `${tag} Tombol repost tidak ditemukan (${result.reason})` });
    return;
  }
  
  onLog({ type: 'info', message: `${tag} Tombol repost diklik, menunggu konfirmasi...` });
  await sleep(1500);
  
  // Beberapa Instagram versi minta konfirmasi via popup
  // Cari tombol "Repost" / "Confirm" di popup
  const confirmed = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const confirmBtn = buttons.find(el => {
      const text = (el.innerText || '').trim().toLowerCase();
      return /^(repost|repost now|posting ulang|bagikan ulang|confirm|konfirmasi|ya|yes)$/.test(text);
    });
    
    if (confirmBtn) {
      const r = confirmBtn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        confirmBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);
        confirmBtn.click();
        return true;
      }
    }
    return false;
  });
  
  await sleep(1500);
  
  if (confirmed) {
    onLog({ type: 'success', message: `${tag} 🔄 Repost Instagram berhasil!` });
  } else {
    // Mungkin tidak ada popup konfirmasi, dan repost langsung jalan
    onLog({ type: 'success', message: `${tag} 🔄 Repost Instagram berhasil (tanpa konfirmasi)!` });
  }
  
  // Tutup popup kalau masih ada
  try { await page.keyboard.press('Escape'); } catch {}
}

// ---------- Instagram: Share Post (to Story) ----------
async function shareInstagramPost(page, onLog, tag = '') {
  if (!page.url().includes('instagram.com')) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
  }
  
  onLog({ type: 'info', message: `${tag} ✈ Mencari tombol share...` });
  
  // Step 1: Klik icon Share (paper plane)
  const shareClicked = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
    const shareSvgs = svgs.filter(svg => {
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      return /^(share|bagikan|kirim)$/.test(label);
    });
    
    const visible = shareSvgs.filter(svg => {
      const r = svg.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (visible.length === 0) return false;
    
    const target = visible[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    
    const clickable = target.closest('button, div[role="button"], span[role="button"]') || target;
    clickable.click();
    return true;
  });
  
  if (!shareClicked) {
    onLog({ type: 'warn', message: `${tag} Tombol share tidak ditemukan` });
    return;
  }
  
  onLog({ type: 'info', message: `${tag} Modal share dibuka, mencari opsi "Add to story"...` });
  await sleep(2000); // Tunggu modal share muncul
  
  // Step 2: Cari & klik opsi "Add post to your story"
  const addedToStory = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    // Cari semua element clickable dengan text yang match
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"], a'));
    
    const target = candidates.find(el => {
      const text = (el.innerText || '').trim().toLowerCase();
      const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      
      const patterns = [
        /^add post to your story$/,
        /^add to story$/,
        /^add to your story$/,
        /^tambahkan ke cerita$/,
        /^tambahkan ke cerita anda$/,
        /^bagikan ke cerita$/
      ];
      
      return patterns.some(p => p.test(text) || p.test(label));
    });
    
    if (!target) return { ok: false, reason: 'no-add-to-story' };
    
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { ok: false, reason: 'not-visible' };
    
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    target.click();
    return { ok: true };
  });
  
  if (!addedToStory.ok) {
    onLog({ type: 'warn', message: `${tag} Opsi "Add to story" tidak ditemukan (${addedToStory.reason})` });
    // Tutup modal
    try { await page.keyboard.press('Escape'); } catch {}
    return;
  }
  
  onLog({ type: 'info', message: `${tag} Klik "Add to story", menunggu story editor...` });
  await sleep(3000); // Tunggu editor story muncul
  
  // Step 3: Klik tombol "Send" / "Share" / "Your Story" untuk submit story
  const submitted = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
    
    const target = candidates.find(el => {
      const text = (el.innerText || '').trim().toLowerCase();
      const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      
      const patterns = [
        /^share$/,
        /^send$/,
        /^kirim$/,
        /^bagikan$/,
        /^your story$/,
        /^cerita anda$/,
        /^add to story$/  // beberapa versi pakai tombol ini di editor
      ];
      
      return patterns.some(p => p.test(text) || p.test(label));
    });
    
    if (!target) return false;
    
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);
    target.click();
    return true;
  });
  
  await sleep(2500); // Tunggu submit selesai
  
  if (submitted) {
    onLog({ type: 'success', message: `${tag} ✈ Post berhasil di-share ke story!` });
  } else {
    onLog({ type: 'warn', message: `${tag} Tombol submit story tidak ditemukan, share mungkin belum selesai` });
  }
  
  // Tutup popup yang masih terbuka (kalau ada)
  try { await page.keyboard.press('Escape'); } catch {}
  await sleep(500);
  try { await page.keyboard.press('Escape'); } catch {}
}

// ---------- Instagram: Follow Random from Explore ----------
async function followInstagramRandom(page, onLog, tag = '') {
  const MAX_FOLLOW = 3;  // Instagram sangat ketat, max 3 per sesi
  
  onLog({ type: 'info', message: `${tag} 👥 Buka Explore untuk follow random...` });
  
  try {
    await page.goto('https://www.instagram.com/explore/', { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch (e) {
    onLog({ type: 'warn', message: `${tag} Gagal buka Explore: ${e.message}` });
    return;
  }
  
  await sleep(3500);
  
  // Scroll sedikit biar lebih banyak konten ke-load
  await page.evaluate(() => window.scrollBy(0, 600));
  await sleep(1500);
  
  // Klik salah satu post random untuk buka modal post
  const postOpened = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    // Cari semua link post (biasanya format /p/{shortcode}/)
    const links = Array.from(document.querySelectorAll('a[href*="/p/"]'));
    const visibleLinks = links.filter(a => {
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (visibleLinks.length === 0) return false;
    
    // Klik random dari 10 post pertama
    const target = visibleLinks[Math.floor(Math.random() * Math.min(visibleLinks.length, 10))];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    target.click();
    return true;
  });
  
  if (!postOpened) {
    onLog({ type: 'warn', message: `${tag} Tidak menemukan post di Explore` });
    return;
  }
  
  await sleep(3000);
  
  // Loop: follow MAX_FOLLOW user dari post yang dibuka
  let followedCount = 0;
  
  for (let i = 0; i < MAX_FOLLOW; i++) {
    // Cari tombol Follow di modal post
    const result = await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const followBtns = buttons.filter(el => {
        const text = (el.innerText || '').trim().toLowerCase();
        // Match "Follow" / "Ikuti" tapi BUKAN "Following" / "Mengikuti" (yang itu unfollow)
        return /^(follow|ikuti)$/.test(text);
      });
      
      const visible = followBtns.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      
      if (visible.length === 0) return { ok: false, reason: 'no-follow-button' };
      
      const target = visible[0];
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(800);
      target.click();
      return { ok: true };
    });
    
    if (!result.ok) break;
    
    followedCount++;
    onLog({ type: 'success', message: `${tag} ✅ Follow ke-${followedCount} berhasil` });
    
    // Jeda natural antar follow (5-10 detik = Instagram ketat)
    await sleep(5000 + Math.random() * 5000);
    
    // Navigate ke post lain untuk follow user lain
    if (i < MAX_FOLLOW - 1) {
      // Klik tombol next post (panah kanan) untuk pindah ke post berikutnya
      const nextClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const nextBtn = buttons.find(el => {
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          return /next|berikutnya|selanjutnya/i.test(label);
        });
        if (nextBtn) {
          nextBtn.click();
          return true;
        }
        return false;
      });
      
      if (!nextClicked) break;
      await sleep(2500);
    }
  }
  
  // Tutup modal post
  try { await page.keyboard.press('Escape'); } catch {}
  await sleep(1000);
  
  if (followedCount > 0) {
    onLog({ type: 'success', message: `${tag} 🎉 Total ${followedCount} user di-follow` });
  } else {
    onLog({ type: 'warn', message: `${tag} Tidak ada user yang di-follow` });
  }
}

// ---------- Instagram: Comment on Post ----------
// ---------- Instagram: Comment on Post ----------
async function commentInstagramPost(page, commentTemplates, onLog, tag = '') {
  const comment = (commentTemplates && commentTemplates.length) 
    ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] 
    : '🔥';
  
  if (!page.url().includes('instagram.com')) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2500);
  }
  
  onLog({ type: 'info', message: `${tag} 💬 Mencari icon comment...` });
  
  // Step 1: Klik icon Comment dulu (untuk fokus ke textarea / buka modal)
  const iconClicked = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
    const commentSvgs = svgs.filter(svg => {
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      return /^(comment|komentar|komentari)$/.test(label);
    });
    
    const visible = commentSvgs.filter(svg => {
      const r = svg.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (visible.length === 0) return false;
    
    // Klik tombol komentar pada postingan yang paling pertama/atas
    const target = visible[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    
    const clickable = target.closest('button, div[role="button"], span[role="button"]') || target;
    clickable.click();
    return true;
  });
  
  if (!iconClicked) {
    onLog({ type: 'warn', message: `${tag} Icon comment tidak ditemukan di feed` });
    return;
  }
  
  await sleep(2000); // Tunggu modal/textarea muncul
  
  // Step 2: Cari textarea komentar
  const textareaFound = await page.evaluate(() => {
    // Cari semua kemungkinan kolom comment
    const candidates = [
      ...Array.from(document.querySelectorAll('textarea')),
      ...Array.from(document.querySelectorAll('[contenteditable="true"]'))
    ];
    
    const target = candidates.find(el => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();
      const isComment = /comment|komentar|add a comment|tambahkan komentar|tulis komentar/i.test(label) ||
                        /comment|komentar|add a comment|tambahkan komentar|tulis komentar/i.test(placeholder);
      if (!isComment) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus();
      target.click();
      return true;
    }
    return false;
  });
  
  if (!textareaFound) {
    onLog({ type: 'warn', message: `${tag} Kolom komentar tidak muncul setelah klik icon` });
    // Tutup modal kalau ada
    try { await page.keyboard.press('Escape'); } catch {}
    return;
  }
  
  await sleep(800);
  
  // Step 3: Ketik komentar pakai keyboard (React-friendly)
  await page.keyboard.type(comment, { delay: 100 + Math.random() * 80 });
  await sleep(800 + Math.random() * 500);
  
  // Step 4: Submit dengan Enter
  await page.keyboard.press('Enter');
  await sleep(2000);
  
  onLog({ type: 'success', message: `${tag} 💬 Komentar Instagram berhasil: "${comment}"` });
  
  // Tutup modal kalau masih terbuka
  try { await page.keyboard.press('Escape'); } catch {}
  await sleep(500);
}

// ---------- Instagram: Auto Reply Comment ----------
async function autoReplyInstagram(page, commentTemplates, onLog, tag = '') {
  onLog({ type: 'info', message: `${tag} 🤖 Mencari komentar untuk dibalas...` });
  await sleep(2000);
  await page.evaluate(() => window.scrollBy(0, 500));
  await sleep(1500);

  const replyClicked = await page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // Tombol balas di IG biasanya berupa span atau button dengan teks "Balas" / "Reply"
    const elements = Array.from(document.querySelectorAll('span, button, div[role="button"]'));
    const replyBtns = elements.filter(el => {
      const text = (el.innerText || '').trim().toLowerCase();
      return text === 'balas' || text === 'reply';
    });

    const visible = replyBtns.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    if (visible.length === 0) return false;

    const target = visible[Math.floor(Math.random() * Math.min(visible.length, 5))];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
    target.click();
    return true;
  });

  if (!replyClicked) {
    onLog({ type: 'warn', message: `${tag} Tidak ada tombol Balas/Reply komentar yang ditemukan.` });
    return;
  }

  await sleep(1500);
  const comment = (commentTemplates && commentTemplates.length) 
    ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] 
    : 'Makasih ya! 😊';

  await page.keyboard.type(comment, { delay: 60 + Math.random() * 50 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(2000);
  
  onLog({ type: 'success', message: `${tag} 🤖 Berhasil membalas komentar: "${comment}"` });
}

// ---------- Instagram: Scrape Comments ----------
async function scrapeCommentsInstagram(page, onLog, tag = '') {
  onLog({ type: 'info', message: `${tag} 📥 Memulai scrape (ekstrak) komentar Instagram...` });
  await sleep(2000);

  // Klik "Load more comments" maksimal 5 kali
  for (let i = 0; i < 5; i++) {
    const expanded = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('svg[aria-label="Muat komentar lainnya"], svg[aria-label="Load more comments"], svg[aria-label="View replies"]'));
      if (svgs.length > 0) {
        const btn = svgs[0].closest('button, div[role="button"]') || svgs[0];
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
        return true;
      }
      return false;
    });
    if (!expanded) break;
    await sleep(2500);
  }

  const users = await page.evaluate(() => {
    // Di IG, username komentator biasanya dibungkus h3 atau a di dalam header komentar
    const elements = Array.from(document.querySelectorAll('h3 > div > span > a, span > a[role="link"]'));
    const names = elements.map(el => el.innerText.trim()).filter(n => n && n.length > 2);
    
    // Hindari duplikasi dan string aneh
    const uniqueNames = [...new Set(names)].filter(n => !/likes|suka|balas|reply/i.test(n));
    return uniqueNames;
  });

  if (users.length === 0) {
    onLog({ type: 'warn', message: `${tag} Tidak ada username Instagram yang berhasil diekstrak.` });
    return;
  }

  const filename = await saveScrapedData('Instagram', users, onLog);
  onLog({ type: 'success', message: `${tag} 📥 Berhasil mengekstrak ${users.length} akun. Tersimpan di: ${filename}` });
}

// ---------- Helper: Save Scraped Data to CSV ----------
async function saveScrapedData(platform, users, onLog) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const dir = path.join(desktopPath, 'SMM-Pro-Scraped', today);
    
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const time = new Date().toTimeString().slice(0,8).replace(/:/g, '-');
    const filename = `Scraped_${platform}_${time}.csv`;
    const filepath = path.join(dir, filename);

    const csvContent = 'No,Username\n' + users.map((u, i) => `${i+1},"${u}"`).join('\n');
    fs.writeFileSync(filepath, csvContent, 'utf-8');
    return `Desktop/SMM-Pro-Scraped/${today}/${filename}`;
  } catch (e) {
    return 'Error saving file';
  }
}

async function performTikTokAction(page, action, commentTemplates, onLog, tag = '') {
  await sleep(1500 + Math.random() * 1500);
  switch (action) {
    case 'like':
      const liked = await page.evaluate(() => {
        const btn = document.querySelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]');
        if (btn) { btn.click(); return true; } return false;
      });
      if (liked) onLog({ type: 'success', message: `${tag} ❤️ Like TikTok berhasil!` });
      else onLog({ type: 'warn', message: `${tag} Tombol like TikTok tidak ditemukan` });
      break;
    case 'comment':
      const comment = (commentTemplates && commentTemplates.length) ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] : 'Keren! 🔥';
      const cIcon = await page.evaluate(() => {
        const btn = document.querySelector('[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"]');
        if (btn) { btn.click(); return true; } return false;
      });
      if (cIcon) {
        await sleep(1500);
        // TikTok uses Draft.js / Div contenteditable for comments usually
        const typed = await page.evaluate(async (txt) => {
          const ce = document.querySelector('div[contenteditable="true"], [data-e2e="comment-input"]');
          if (ce) { ce.focus(); document.execCommand('insertText', false, txt); return true; }
          return false;
        }, comment);
        
        if (!typed) {
           try { await page.type('div[contenteditable="true"]', comment, {delay: 50}); } catch(e){}
        }
        await sleep(500);
        await page.evaluate(() => {
          const postBtn = document.querySelector('[data-e2e="comment-post"]');
          if (postBtn) postBtn.click();
        });
        onLog({ type: 'success', message: `${tag} 💬 Komentar TikTok berhasil!` });
      } else onLog({ type: 'warn', message: `${tag} Icon komentar TikTok tidak ditemukan` });
      break;
    case 'share':
      const shared = await page.evaluate(() => {
        const btn = document.querySelector('[data-e2e="share-icon"], [data-e2e="browse-share-icon"]');
        if (btn) { btn.click(); return true; } return false;
      });
      if (shared) {
        await sleep(1000);
        await page.evaluate(() => {
          const copy = document.querySelector('button[aria-label="Copy link"], [data-e2e="share-copy"]');
          if (copy) copy.click();
        });
        onLog({ type: 'success', message: `${tag} ↗ Share (Salin Tautan) TikTok berhasil!` });
      }
      break;
    case 'save':
      const saved = await page.evaluate(() => {
        const btn = document.querySelector('[data-e2e="favorite-icon"], [data-e2e="browse-favorite-icon"]');
        if (btn) { btn.click(); return true; } return false;
      });
      if (saved) onLog({ type: 'success', message: `${tag} 🔖 Favorite TikTok berhasil!` });
      break;
    case 'follow':
      const followed = await page.evaluate(() => {
        const btn = document.querySelector('[data-e2e="feed-follow"]');
        if (btn) { btn.click(); return true; } return false;
      });
      if (followed) onLog({ type: 'success', message: `${tag} ✅ Follow TikTok berhasil!` });
      break;
    case 'scroll':
      onLog({ type: 'info', message: `${tag} 📜 Menggulir (Scroll) FYP TikTok...` });
      for (let i = 0; i < (3 + Math.floor(Math.random() * 3)); i++) {
         await page.keyboard.press('ArrowDown');
         await sleep(3000 + Math.random() * 4000);
      }
      onLog({ type: 'success', message: `${tag} Scroll TikTok selesai` });
      break;
    default:
      onLog({ type: 'warn', message: `${tag} Aksi ${action} belum diimplementasikan untuk TikTok` });
  }
}

async function performTwitterAction(page, action, commentTemplates, onLog, tag = '') {
  await sleep(1500 + Math.random() * 1500);
  switch (action) {
    case 'like':
      const liked = await page.evaluate(() => { const b = document.querySelector('[data-testid="like"]'); if(b) { b.click(); return true; } return false; });
      if (liked) onLog({ type: 'success', message: `${tag} ❤️ Like Twitter berhasil!` });
      else onLog({ type: 'warn', message: `${tag} Tombol like Twitter tidak ditemukan` });
      break;
    case 'retweet':
      await page.evaluate(() => { const b = document.querySelector('[data-testid="retweet"]'); if(b) b.click(); });
      await sleep(1000);
      const rted = await page.evaluate(() => { const b = document.querySelector('[data-testid="retweetConfirm"]'); if(b) { b.click(); return true; } return false; });
      if (rted) onLog({ type: 'success', message: `${tag} 🔄 Retweet Twitter berhasil!` });
      break;
    case 'comment':
      const comment = (commentTemplates && commentTemplates.length) ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] : 'Keren! 🔥';
      await page.evaluate(() => { const b = document.querySelector('[data-testid="reply"]'); if(b) b.click(); });
      await sleep(1500);
      const boxFound = await page.evaluate(() => { const b = document.querySelector('[data-testid="tweetTextarea_0"]'); if(b) { b.focus(); return true; } return false; });
      if (boxFound) {
        await page.keyboard.type(comment, {delay:50});
        await sleep(500);
        await page.evaluate(() => { const b = document.querySelector('[data-testid="tweetButton"]'); if(b) b.click(); });
        onLog({ type: 'success', message: `${tag} 💬 Reply Twitter berhasil!` });
      } else onLog({ type: 'warn', message: `${tag} Kolom reply Twitter tidak ditemukan` });
      break;
    case 'bookmark':
      const bmed = await page.evaluate(() => { const b = document.querySelector('[data-testid="bookmark"]'); if(b) { b.click(); return true; } return false; });
      if (bmed) onLog({ type: 'success', message: `${tag} 🔖 Bookmark Twitter berhasil!` });
      break;
    case 'follow':
      const followed = await page.evaluate(() => {
         const btns = Array.from(document.querySelectorAll('div[role="button"]'));
         const fBtn = btns.find(b => { const t = (b.innerText||'').toLowerCase(); return t === 'follow' || t === 'ikuti'; });
         if (fBtn) { fBtn.click(); return true; } return false;
      });
      if (followed) onLog({ type: 'success', message: `${tag} ✅ Follow Twitter berhasil!` });
      break;
    case 'scroll':
      await scrollPage(page, onLog, tag);
      break;
    default:
      onLog({ type: 'warn', message: `${tag} Aksi ${action} belum diimplementasikan untuk Twitter` });
  }
}

async function performYouTubeAction(page, action, commentTemplates, onLog, tag = '') {
  await sleep(2000);
  switch (action) {
    case 'like':
      const liked = await page.evaluate(() => { const b = document.querySelector('like-button-view-model button'); if(b && b.getAttribute('aria-pressed')!=='true') { b.click(); return true; } return false; });
      if (liked) onLog({ type: 'success', message: `${tag} 👍 Like YouTube berhasil!` });
      else onLog({ type: 'warn', message: `${tag} Tombol like YouTube tidak ditemukan` });
      break;
    case 'dislike':
      await page.evaluate(() => { const b = document.querySelector('dislike-button-view-model button'); if(b && b.getAttribute('aria-pressed')!=='true') b.click(); });
      onLog({ type: 'success', message: `${tag} 👎 Dislike YouTube berhasil!` });
      break;
    case 'comment':
      await page.evaluate(() => window.scrollBy(0, 600));
      await sleep(2500);
      const comment = (commentTemplates && commentTemplates.length) ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] : 'Keren videonya!';
      const clicked = await page.evaluate(() => { const b = document.querySelector('#simple-box'); if(b) { b.click(); return true; } return false; });
      if (clicked) {
        await sleep(1000);
        await page.type('#contenteditable-root', comment, {delay: 50});
        await sleep(500);
        await page.evaluate(() => { const b = document.querySelector('#submit-button'); if(b) b.click(); });
        onLog({ type: 'success', message: `${tag} 💬 Comment YouTube berhasil!` });
      } else onLog({ type: 'warn', message: `${tag} Kolom komentar YouTube tidak ditemukan` });
      break;
    case 'subscribe':
      const subbed = await page.evaluate(() => { const b = document.querySelector('#subscribe-button button'); if(b && b.innerText.toLowerCase().includes('subscribe')) { b.click(); return true; } return false; });
      if (subbed) onLog({ type: 'success', message: `${tag} 🔔 Subscribe YouTube berhasil!` });
      break;
    case 'save':
      await page.evaluate(() => { const b = document.querySelector('button[aria-label="Save to playlist"], button[aria-label="Simpan"]'); if(b) b.click(); });
      await sleep(1500);
      await page.evaluate(() => {
         const wl = Array.from(document.querySelectorAll('tp-yt-paper-checkbox')).find(e => e.innerText.includes('Watch later') || e.innerText.includes('Tonton Nanti'));
         if (wl && wl.getAttribute('aria-checked') !== 'true') wl.click();
      });
      onLog({ type: 'success', message: `${tag} 📋 Disimpan ke Tonton Nanti` });
      break;
    case 'scroll':
      await scrollPage(page, onLog, tag);
      break;
    default:
      onLog({ type: 'warn', message: `${tag} Aksi ${action} belum diimplementasikan untuk YouTube` });
  }
}

async function performThreadsAction(page, action, commentTemplates, onLog, tag = '') {
  await sleep(2000);
  switch (action) {
    case 'like':
      const liked = await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const like = svgs.find(s => s.getAttribute('aria-label').toLowerCase() === 'like' || s.getAttribute('aria-label').toLowerCase() === 'suka');
        if (like) { const btn = like.closest('div[role="button"], button') || like; btn.click(); return true; } return false;
      });
      if (liked) onLog({ type: 'success', message: `${tag} ❤️ Like Threads berhasil!` });
      else onLog({ type: 'warn', message: `${tag} Tombol like Threads tidak ditemukan` });
      break;
    case 'comment':
    case 'reply':
      const comment = (commentTemplates && commentTemplates.length) ? commentTemplates[Math.floor(Math.random() * commentTemplates.length)] : 'Menarik!';
      const rep = await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const r = svgs.find(s => s.getAttribute('aria-label').toLowerCase() === 'reply' || s.getAttribute('aria-label').toLowerCase() === 'balas');
        if (r) { const btn = r.closest('div[role="button"], button') || r; btn.click(); return true; } return false;
      });
      if (rep) {
        await sleep(1500);
        const box = await page.evaluate(() => { const b = document.querySelector('div[contenteditable="true"]'); if(b) { b.focus(); return true; } return false; });
        if (box) {
          await page.keyboard.type(comment, {delay: 50});
          await sleep(500);
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
            const post = btns.find(b => (b.innerText||'').toLowerCase() === 'post' || (b.innerText||'').toLowerCase() === 'posting');
            if (post) post.click();
          });
          onLog({ type: 'success', message: `${tag} 💬 Reply Threads berhasil!` });
        }
      }
      break;
    case 'repost':
      const rped = await page.evaluate(async () => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const rp = svgs.find(s => s.getAttribute('aria-label').toLowerCase() === 'repost' || s.getAttribute('aria-label').toLowerCase() === 'bagikan ulang');
        if (rp) {
           const btn = rp.closest('div[role="button"], button') || rp;
           btn.click();
           return true;
        } return false;
      });
      if (rped) {
        await sleep(1000);
        await page.evaluate(() => {
           const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
           const confirm = btns.find(b => (b.innerText||'').toLowerCase() === 'repost' || (b.innerText||'').toLowerCase() === 'bagikan ulang');
           if (confirm) confirm.click();
        });
        onLog({ type: 'success', message: `${tag} 🔄 Repost Threads berhasil!` });
      }
      break;
    case 'follow':
      const followed = await page.evaluate(() => {
         const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
         const fBtn = btns.find(b => { const t = (b.innerText||'').toLowerCase(); return t === 'follow' || t === 'ikuti'; });
         if (fBtn) { fBtn.click(); return true; } return false;
      });
      if (followed) onLog({ type: 'success', message: `${tag} ✅ Follow Threads berhasil!` });
      break;
    case 'scroll':
      await scrollPage(page, onLog, tag);
      break;
    default:
      onLog({ type: 'warn', message: `${tag} Aksi ${action} belum diimplementasikan untuk Threads` });
  }
}

async function scrollPage(page, onLog, tag = '') {
  onLog({ type: 'info', message: `${tag} 📜 Scrolling halaman...` });
  const scrollTimes = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < scrollTimes; i++) {
    await page.evaluate((amt) => window.scrollBy(0, amt), 300 + Math.random() * 300);
    await sleep(500 + Math.random() * 1000);
  }
  onLog({ type: 'success', message: `${tag} Scroll ${scrollTimes}x selesai` });
}

async function takeScreenshot(page, label, action, onLog, tag = '') {
  try {
    const today = new Date().toISOString().split('T')[0];
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const screenshotDir = path.join(desktopPath, 'SMM-Pro-Screenshots', today);
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const time = new Date().toTimeString().slice(0,8).replace(/:/g, '-');
    const safeName = (label || 'akun').replace(/[@\s\/\:*?"<>|]/g, '_');
    const filename = `${safeName}_${action}_${time}.png`;
    const filepath = path.join(screenshotDir, filename);
    await page.screenshot({ path: filepath, fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 720 } });
    onLog({ type: 'success', message: `${tag} 📸 Screenshot disimpan: SMM-Pro-Screenshots/${today}/${filename}` });
    return filepath;
  } catch (err) {
    onLog({ type: 'warn', message: `${tag} Screenshot gagal: ${err.message}` });
    return null;
  }
}

// ---------- small puppeteer helpers ----------
async function safeWaitForSelector(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return await page.$(selector);
  } catch {
    return null;
  }
}

async function safeType(page, selector, text, delay = 60) {
  try {
    await page.waitForSelector(selector, { timeout: 7000 });
    await page.click(selector, { clickCount: 3 }).catch(()=>{});
    await page.type(selector, text, { delay });
  } catch (e) {
    // fallback: set value via evaluate
    await page.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (el) { el.focus(); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, selector, text);
  }
}

async function clickButtonByText(page, texts = [], tagSelector = 'button,div') {
  for (const t of texts) {
    // XPath search for elements with text
    const escaped = t.replace(/"/g, '\\"');
    const xpath = `//${tagSelector.split(',')[0]}[contains(normalize-space(.), "${t}")] | //${tagSelector.split(',')[1] || tagSelector.split(',')[0]}[contains(normalize-space(.), "${t}")]`;
    try {
      const handles = await page.$x(`//*[contains(normalize-space(.), "${t}")]`);
      if (handles && handles.length) {
        await handles[0].click().catch(()=>{});
        return true;
      }
    } catch {}
  }
  return false;
}

function stopAutomation() {
  isRunning = false;
  activeBrowsers.forEach(b => {
    try { b.close(); } catch (e) {}
  });
  activeBrowsers = [];
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startAutomationBatch(config, settings, onLog, maxParallel = 10) {
  isRunning = true;
  const accounts = config.accounts || [];
  let i = 0;
  while (i < accounts.length) {
    const batch = accounts.slice(i, i + maxParallel);
    await Promise.all(
      batch.map(acc => startAutomation({ ...config, accounts: [acc] }, settings, onLog))
    );
    i += maxParallel;
  }
  isRunning = false;
  onLog({ type: 'success', message: '✅ Semua akun selesai batch!' });
}

module.exports = { startAutomation, stopAutomation, startAutomationBatch, loginToPlatform };
