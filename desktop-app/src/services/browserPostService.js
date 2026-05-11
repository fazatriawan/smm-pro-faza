/**
 * browserPostService.js
 * Post konten ke platform sosial media via browser session (tanpa OAuth/API registration).
 * Menggunakan Puppeteer dengan profil browser yang sudah tersimpan dari Automasi Robot.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const os = require('os');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const DELAY = ms => new Promise(r => setTimeout(r, ms));
const RAND  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

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

// Type text slowly (humanlike)
async function typeSlowly(page, selector, text, delay = 40) {
  await page.click(selector);
  await page.keyboard.type(text, { delay });
}

// ── INSTAGRAM (via web) ──────────────────────────────────────────────────────

async function postToInstagram(account, content, settings, onLog) {
  const { caption, mediaPath } = content;
  const dir = getBrowserDir('instagram', account.username);

  onLog({ type: 'info', message: `📤 Membuka Instagram untuk @${account.username}...` });

  const browser = await launchBrowser(dir, settings.headless || false);
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'id-ID,id;q=0.9' });
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await DELAY(2000);

    // Check login
    if (page.url().includes('accounts/login') || page.url().includes('challenge')) {
      throw new Error(`@${account.username} belum login di Instagram. Buka Automasi Robot → Login dulu.`);
    }

    if (!mediaPath) {
      throw new Error('Instagram membutuhkan media (foto/video). Caption saja tidak bisa.');
    }

    if (!fs.existsSync(mediaPath)) {
      throw new Error(`File tidak ditemukan: ${mediaPath}`);
    }

    onLog({ type: 'info', message: '🔍 Mencari tombol buat postingan...' });

    // Click the create/new post button (SVG icon or link)
    const createSelectors = [
      'svg[aria-label="New post"]',
      'a[href="/create/"]',
      '[aria-label="New post"]',
      'svg[aria-label="Posting baru"]',
    ];

    let clicked = false;
    for (const sel of createSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        await page.click(sel);
        clicked = true;
        break;
      } catch {}
    }

    if (!clicked) {
      // Try clicking via navigation
      await page.goto('https://www.instagram.com/create/select/', { waitUntil: 'networkidle2', timeout: 20000 });
    }

    await DELAY(2000);

    // Upload file
    onLog({ type: 'info', message: '📁 Mengupload media...' });
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) throw new Error('Tidak bisa menemukan input file. Instagram mungkin mengubah UI-nya.');
    await fileInput.uploadFile(mediaPath);
    await DELAY(3000);

    // Click "Next" buttons (usually 2-3 times to get to caption)
    for (let i = 0; i < 3; i++) {
      const nextSelectors = [
        'button:has-text("Next")',
        'div[role="button"]:has-text("Next")',
        '//button[contains(text(),"Next")]',
        '//div[@role="button"][contains(text(),"Next")]',
      ];
      let nextClicked = false;
      for (const sel of nextSelectors) {
        try {
          if (sel.startsWith('//')) {
            const [el] = await page.$x(sel);
            if (el) { await el.click(); nextClicked = true; break; }
          } else {
            await page.click(sel);
            nextClicked = true;
            break;
          }
        } catch {}
      }
      if (nextClicked) await DELAY(1500);
    }

    // Type caption
    if (caption) {
      onLog({ type: 'info', message: '✏️ Mengetik caption...' });
      const captionSelectors = [
        'div[aria-label="Write a caption..."]',
        'textarea[aria-label="Write a caption..."]',
        'div[contenteditable="true"]',
      ];
      for (const sel of captionSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 3000 });
          await page.click(sel);
          await page.keyboard.type(caption, { delay: RAND(30, 60) });
          break;
        } catch {}
      }
      await DELAY(1000);
    }

    // Click Share
    onLog({ type: 'info', message: '🚀 Mempublish postingan...' });
    const shareSelectors = [
      '//button[contains(text(),"Share")]',
      '//div[@role="button"][contains(text(),"Share")]',
      'button:has-text("Share")',
    ];
    let shared = false;
    for (const sel of shareSelectors) {
      try {
        if (sel.startsWith('//')) {
          const [el] = await page.$x(sel);
          if (el) { await el.click(); shared = true; break; }
        } else {
          await page.click(sel);
          shared = true;
          break;
        }
      } catch {}
    }

    if (!shared) throw new Error('Tombol Share tidak ditemukan. Instagram mungkin mengubah UI-nya.');

    await DELAY(4000);
    onLog({ type: 'success', message: `✅ Berhasil posting ke Instagram @${account.username}` });
    return { success: true };
  } finally {
    await browser.close();
  }
}

// ── TWITTER/X (via web) ──────────────────────────────────────────────────────

async function postToTwitter(account, content, settings, onLog) {
  const { caption, mediaPath } = content;
  const dir = getBrowserDir('twitter', account.username);

  onLog({ type: 'info', message: `📤 Membuka Twitter/X untuk @${account.username}...` });

  const browser = await launchBrowser(dir, settings.headless || false);
  try {
    const page = await browser.newPage();
    await page.goto('https://x.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await DELAY(2000);

    if (page.url().includes('login') || page.url().includes('i/flow/login')) {
      throw new Error(`@${account.username} belum login di Twitter/X. Buka Automasi Robot → Login dulu.`);
    }

    // Click compose button
    onLog({ type: 'info', message: '✍️ Membuka compose tweet...' });
    const composeSelectors = [
      'a[href="/compose/tweet"]',
      '[data-testid="SideNav_NewTweet_Button"]',
      'a[aria-label="Post"]',
    ];
    for (const sel of composeSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 4000 });
        await page.click(sel);
        break;
      } catch {}
    }
    await DELAY(1500);

    // Type tweet text
    const tweetText = caption?.slice(0, 280) || ''; // Twitter limit 280 chars
    if (tweetText) {
      onLog({ type: 'info', message: `✏️ Mengetik tweet (${tweetText.length}/280 karakter)...` });
      const textareaSelectors = [
        '[data-testid="tweetTextarea_0"]',
        'div[contenteditable="true"][role="textbox"]',
        '.public-DraftEditorPlaceholder-root',
      ];
      for (const sel of textareaSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 3000 });
          await page.click(sel);
          await page.keyboard.type(tweetText, { delay: RAND(30, 60) });
          break;
        } catch {}
      }
    }

    // Attach media if provided
    if (mediaPath && fs.existsSync(mediaPath)) {
      onLog({ type: 'info', message: '📎 Melampirkan media...' });
      const fileInput = await page.$('input[data-testid="fileInput"]') || await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.uploadFile(mediaPath);
        await DELAY(3000);
      }
    }

    // Click Post/Tweet button
    onLog({ type: 'info', message: '🚀 Memposting tweet...' });
    const postSelectors = [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
      '//span[text()="Post"]',
      '//span[text()="Tweet"]',
    ];
    let posted = false;
    for (const sel of postSelectors) {
      try {
        if (sel.startsWith('//')) {
          const [el] = await page.$x(sel);
          if (el) { await el.click(); posted = true; break; }
        } else {
          await page.waitForSelector(sel, { timeout: 3000 });
          await page.click(sel);
          posted = true;
          break;
        }
      } catch {}
    }

    if (!posted) throw new Error('Tombol Post tidak ditemukan. Coba lagi atau periksa login.');
    await DELAY(3000);
    onLog({ type: 'success', message: `✅ Berhasil tweet dari @${account.username}` });
    return { success: true };
  } finally {
    await browser.close();
  }
}

// ── FACEBOOK (via web) ───────────────────────────────────────────────────────

async function postToFacebook(account, content, settings, onLog) {
  const { caption, mediaPath } = content;
  const dir = getBrowserDir('facebook', account.username);

  onLog({ type: 'info', message: `📤 Membuka Facebook untuk @${account.username}...` });

  const browser = await launchBrowser(dir, settings.headless || false);
  try {
    const page = await browser.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    await DELAY(2000);

    if (page.url().includes('login')) {
      throw new Error(`@${account.username} belum login di Facebook. Buka Automasi Robot → Login dulu.`);
    }

    // Click "What's on your mind" / Buat Postingan
    onLog({ type: 'info', message: '✍️ Membuka composer...' });
    const composeSelectors = [
      '[data-testid="status-attachment-mentions-input"]',
      '[aria-label="What\'s on your mind"]',
      '[aria-label="Apa yang Anda pikirkan"]',
      'div[role="button"][tabindex="0"]:not([aria-label])',
    ];
    for (const sel of composeSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 4000 });
        await page.click(sel);
        break;
      } catch {}
    }
    await DELAY(1500);

    if (caption) {
      onLog({ type: 'info', message: '✏️ Mengetik caption...' });
      await page.keyboard.type(caption, { delay: RAND(30, 50) });
      await DELAY(1000);
    }

    // Attach photo if mediaPath
    if (mediaPath && fs.existsSync(mediaPath)) {
      onLog({ type: 'info', message: '📎 Melampirkan media...' });
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.uploadFile(mediaPath);
        await DELAY(3000);
      }
    }

    // Click Post button
    onLog({ type: 'info', message: '🚀 Memposting...' });
    const postSelectors = [
      '[aria-label="Post"]',
      '[aria-label="Posting"]',
      '//div[@aria-label="Post"]',
      '//div[@aria-label="Posting"]',
    ];
    let posted = false;
    for (const sel of postSelectors) {
      try {
        if (sel.startsWith('//')) {
          const [el] = await page.$x(sel);
          if (el) { await el.click(); posted = true; break; }
        } else {
          await page.waitForSelector(sel, { timeout: 3000 });
          await page.click(sel);
          posted = true;
          break;
        }
      } catch {}
    }

    if (!posted) throw new Error('Tombol Post tidak ditemukan. Coba lagi atau periksa login.');
    await DELAY(3000);
    onLog({ type: 'success', message: `✅ Berhasil posting ke Facebook @${account.username}` });
    return { success: true };
  } finally {
    await browser.close();
  }
}

// ── TIKTOK (via web) ─────────────────────────────────────────────────────────

async function postToTikTok(account, content, settings, onLog) {
  const { caption, mediaPath } = content;
  const dir = getBrowserDir('tiktok', account.username);

  onLog({ type: 'info', message: `📤 Membuka TikTok untuk @${account.username}...` });

  if (!mediaPath || !fs.existsSync(mediaPath)) {
    throw new Error('TikTok membutuhkan file video. Caption saja tidak bisa.');
  }

  const browser = await launchBrowser(dir, settings.headless || false);
  try {
    const page = await browser.newPage();
    await page.goto('https://www.tiktok.com/upload', { waitUntil: 'networkidle2', timeout: 30000 });
    await DELAY(2000);

    if (page.url().includes('login')) {
      throw new Error(`@${account.username} belum login di TikTok. Buka Automasi Robot → Login dulu.`);
    }

    onLog({ type: 'info', message: '📁 Mengupload video...' });
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) throw new Error('Upload form tidak ditemukan di TikTok. Coba buka manual.');
    await fileInput.uploadFile(mediaPath);
    await DELAY(5000); // Video processing takes time

    if (caption) {
      onLog({ type: 'info', message: '✏️ Mengetik caption...' });
      const captionSel = '[data-text="true"]';
      try {
        await page.waitForSelector(captionSel, { timeout: 10000 });
        await page.click(captionSel);
        await page.keyboard.type(caption.slice(0, 2200), { delay: RAND(20, 40) });
      } catch { onLog({ type: 'warn', message: '⚠️ Caption field tidak ditemukan, posting tanpa caption' }); }
    }

    await DELAY(2000);

    // Click Post
    onLog({ type: 'info', message: '🚀 Memposting ke TikTok...' });
    const postSelectors = [
      'button[data-e2e="post-post"]',
      '//button[contains(@class,"upload-btn")]',
      '//button[text()="Post"]',
    ];
    let posted = false;
    for (const sel of postSelectors) {
      try {
        if (sel.startsWith('//')) {
          const [el] = await page.$x(sel);
          if (el) { await el.click(); posted = true; break; }
        } else {
          await page.waitForSelector(sel, { timeout: 3000 });
          await page.click(sel);
          posted = true;
          break;
        }
      } catch {}
    }

    if (!posted) throw new Error('Tombol Post tidak ditemukan di TikTok. UI mungkin berubah.');
    await DELAY(5000);
    onLog({ type: 'success', message: `✅ Berhasil upload ke TikTok @${account.username}` });
    return { success: true };
  } finally {
    await browser.close();
  }
}

// ── DISPATCHER ───────────────────────────────────────────────────────────────

async function browserPost(config, settings, onLog) {
  const { account, caption, mediaPath } = config;
  if (!account) throw new Error('Pilih akun terlebih dahulu');

  switch (account.platform) {
    case 'instagram': return postToInstagram(account, { caption, mediaPath }, settings, onLog);
    case 'twitter':   return postToTwitter(account, { caption, mediaPath }, settings, onLog);
    case 'facebook':  return postToFacebook(account, { caption, mediaPath }, settings, onLog);
    case 'tiktok':    return postToTikTok(account, { caption, mediaPath }, settings, onLog);
    default:
      throw new Error(`Platform ${account.platform} belum didukung untuk Browser Post. Gunakan Automasi Robot atau Bulk Post.`);
  }
}

module.exports = { browserPost };
