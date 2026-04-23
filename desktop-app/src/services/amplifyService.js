const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-extra');

async function amplify(config, settings, onLog) {
  const { accounts, targetUrls, actions, commentTemplates, platform } = config;
  const delay = () => (settings.delayMin + Math.random() * (settings.delayMax - settings.delayMin)) * 1000;

  onLog({ type: 'info', message: `Memulai amplifikasi ${platform} — ${accounts.length} akun, ${targetUrls.length} URL, ${actions.length} aksi` });

  const maxConcurrent = settings.maxConcurrent || 1;

  for (let i = 0; i < accounts.length; i += maxConcurrent) {
    const chunk = accounts.slice(i, i + maxConcurrent);

    await Promise.all(chunk.map(async (account, chunkIndex) => {
      const actualIndex = i + chunkIndex;
      const username = account.username;
      onLog({ type: 'info', message: `[${actualIndex+1}/${accounts.length}] Akun: ${account.label || username}` });

    if (!username) {
      onLog({ type: 'error', message: 'Username kosong, melewati akun ini.' });
      return;
    }

    const safeName = username.replace(/[^a-zA-Z0-9._-]/g, '_');
    const profileDir = path.join(os.homedir(), '.smm-pro-profiles', `${platform}_${safeName}`);
    const headless = settings && settings.headless !== undefined ? settings.headless : false;

    let browser;
    try {
      browser = await puppeteer.launch({
        headless,
        userDataDir: profileDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-notifications'
        ]
      });

      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      try {
        const cookiePath = path.join(os.homedir(), '.smm-pro-cookies', `${platform}_${safeName}.json`);
        if (fs.existsSync(cookiePath)) {
          const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
          await page.setCookie(...cookies);
        }
      } catch (e) {}

      for (const url of targetUrls) {
        onLog({ type: 'info', message: `Membuka URL: ${url}` });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);

        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl.includes('challenge')) {
          onLog({ type: 'warn', message: 'Akun sepertinya belum login atau terkena challenge. Pastikan sudah di Warm Up. Beberapa aksi mungkin gagal.' });
        }

        for (const action of actions) {
          try {
            await performBrowserAction(page, platform, action, commentTemplates, actualIndex, onLog);
            onLog({ type: 'success', message: `✅ ${action} berhasil di ${url.slice(0, 50)}` });
          } catch (err) {
            onLog({ type: 'error', message: `❌ ${action} gagal: ${err.message}` });
          }
          const waitTime = delay();
          onLog({ type: 'info', message: `⏳ Random delay ${Math.round(waitTime/1000)} detik sebelum aksi selanjutnya...` });
          await sleep(waitTime);
        }
      }

    } catch (err) {
      onLog({ type: 'error', message: `Gagal memproses akun ${username}: ${err.message}` });
    } finally {
      if (browser) await browser.close();
    }
    }));

    if (i + maxConcurrent < accounts.length) {
      const rest = settings.restBetweenAccounts * 1000;
      onLog({ type: 'info', message: `Mengerjakan batch berikutnya. Istirahat ${settings.restBetweenAccounts} detik...` });
      await sleep(rest);
    }
  }

  onLog({ type: 'success', message: '🎉 Amplifikasi selesai!' });
}

async function performBrowserAction(page, platform, action, commentTemplates, index, onLog) {
  switch (platform) {
    case 'youtube': return await youtubeAction(page, action, commentTemplates, index, onLog);
    case 'facebook': return await facebookAction(page, action, commentTemplates, index, onLog);
    case 'instagram': return await instagramAction(page, action, commentTemplates, index, onLog);
    case 'twitter': return await twitterAction(page, action, commentTemplates, index, onLog);
    case 'threads': return await threadsAction(page, action, commentTemplates, index, onLog);
    default: throw new Error(`Platform ${platform} belum didukung`);
  }
}

// ─── YOUTUBE ──────────────────────────────────────────────────────────────
async function youtubeAction(page, action, commentTemplates, index, onLog) {
  switch (action) {
    case 'like':
      await page.evaluate(() => {
        const btn = document.querySelector('like-button-view-model button');
        if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
      });
      break;
    case 'dislike':
      await page.evaluate(() => {
        const btn = document.querySelector('dislike-button-view-model button');
        if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
      });
      break;
    case 'comment':
      await page.evaluate(() => window.scrollBy(0, 500));
      await sleep(2000);
      const ytComment = getComment(commentTemplates, index);
      const clicked = await page.evaluate(() => {
         const box = document.querySelector('#simple-box');
         if(box) { box.click(); return true; }
         return false;
      });
      if(clicked) {
         await sleep(1000);
         await page.type('#contenteditable-root', ytComment, {delay: 30});
         await sleep(500);
         await page.evaluate(() => {
           const btn = document.querySelector('#submit-button');
           if(btn) btn.click();
         });
         await sleep(2000);
      } else {
         throw new Error('Kolom komentar tidak ditemukan');
      }
      break;
    case 'subscribe':
      await page.evaluate(() => {
        const btn = document.querySelector('#subscribe-button button');
        if (btn && btn.innerText.toLowerCase().includes('subscribe')) btn.click();
      });
      break;
    case 'save':
      await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Save to playlist"], button[aria-label="Simpan"]');
        if (btn) btn.click();
      });
      await sleep(1000);
      await page.evaluate(() => {
         const wl = Array.from(document.querySelectorAll('tp-yt-paper-checkbox')).find(e => e.innerText.includes('Watch later') || e.innerText.includes('Tonton Nanti'));
         if(wl && wl.getAttribute('aria-checked') !== 'true') wl.click();
      });
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk YouTube`);
  }
}

// ─── FACEBOOK ─────────────────────────────────────────────────────────────
async function facebookAction(page, action, commentTemplates, index, onLog) {
  await page.evaluate(() => window.scrollBy(0, 300));
  await sleep(1500);

  switch (action) {
    case 'like':
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"]'));
        const like = btns.find(b => {
          const l = (b.getAttribute('aria-label') || '').toLowerCase();
          return l === 'suka' || l === 'like';
        });
        if (like) like.click();
      });
      break;
    case 'comment':
      const fbComment = getComment(commentTemplates, index);
      const commented = await page.evaluate(async () => {
         const btns = Array.from(document.querySelectorAll('div[role="button"]'));
         const cBtn = btns.find(b => {
           const l = (b.getAttribute('aria-label') || '').toLowerCase();
           return l === 'komentari' || l === 'comment';
         });
         if(cBtn) cBtn.click();
         return !!cBtn;
      });
      await sleep(1500);
      const boxFound = await page.evaluate(() => {
         const boxes = Array.from(document.querySelectorAll('div[role="textbox"]'));
         const box = boxes.find(b => b.getAttribute('contenteditable') === 'true');
         if(box) { box.focus(); return true; }
         return false;
      });
      if(boxFound) {
         await page.keyboard.type(fbComment, {delay: 30});
         await sleep(500);
         await page.keyboard.press('Enter');
         await sleep(1500);
      } else {
         throw new Error('Area komentar tidak ditemukan');
      }
      break;
    case 'share':
      const shared = await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const btns = Array.from(document.querySelectorAll('div[role="button"]'));
        const share = btns.find(b => {
          const l = (b.getAttribute('aria-label') || '').toLowerCase();
          return l === 'bagikan' || l === 'share' || l === 'kirim' || l === 'send';
        });
        if (share) {
          share.click();
          await sleep(1500);
          const options = Array.from(document.querySelectorAll('div[role="menuitem"], span[role="button"]'));
          const now = options.find(o => {
             const t = (o.innerText || '').toLowerCase();
             return t.includes('bagikan sekarang') || t.includes('share now') || t.includes('bagikan ke kronologi');
          });
          if (now) { now.click(); return true; }
        }
        return false;
      });
      if (!shared) throw new Error('Tombol share tidak ditemukan');
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Facebook`);
  }
}

// ─── INSTAGRAM ────────────────────────────────────────────────────────────
async function instagramAction(page, action, commentTemplates, index, onLog) {
  switch (action) {
    case 'like':
      await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const like = svgs.find(s => /^suka$|^like$/i.test(s.getAttribute('aria-label')));
        if (like) {
           const btn = like.closest('button, div[role="button"], span[role="button"]') || like;
           btn.click();
        }
      });
      break;
    case 'comment':
      const igComment = getComment(commentTemplates, index);
      await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const cIcon = svgs.find(s => /^komentar$|^comment$/i.test(s.getAttribute('aria-label')));
        if(cIcon) {
           const btn = cIcon.closest('button, div[role="button"], span[role="button"]') || cIcon;
           btn.click();
        }
      });
      await sleep(1500);
      const box = await page.$('textarea');
      if (box) {
         await box.type(igComment, {delay: 30});
         await sleep(500);
         await page.keyboard.press('Enter');
         await sleep(1500);
      } else {
         throw new Error('Textarea komentar tidak ditemukan');
      }
      break;
    case 'save':
      await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const save = svgs.find(s => /^simpan$|^save$/i.test(s.getAttribute('aria-label')));
        if (save) {
           const btn = save.closest('button, div[role="button"], span[role="button"]') || save;
           btn.click();
        }
      });
      break;
    case 'repost':
      onLog({ type: 'warn', message: 'Repost Instagram kurang stabil via web, mencoba mengklik tombol share...' });
      await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const share = svgs.find(s => /^bagikan$|^share$/i.test(s.getAttribute('aria-label')));
        if (share) {
           const btn = share.closest('button, div[role="button"], span[role="button"]') || share;
           btn.click();
        }
      });
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Instagram`);
  }
}

// ─── TWITTER ──────────────────────────────────────────────────────────────
async function twitterAction(page, action, commentTemplates, index, onLog) {
  switch (action) {
    case 'like':
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="like"]');
        if (btn) btn.click();
      });
      break;
    case 'retweet':
      await page.evaluate(async () => {
        const btn = document.querySelector('[data-testid="retweet"]');
        if (btn) {
           btn.click();
           await new Promise(r => setTimeout(r, 1000));
           const confirm = document.querySelector('[data-testid="retweetConfirm"]');
           if (confirm) confirm.click();
        }
      });
      await sleep(1000);
      break;
    case 'comment':
      const twComment = getComment(commentTemplates, index);
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="reply"]');
        if (btn) btn.click();
      });
      await sleep(1500);
      const typed = await page.evaluate(async (txt) => {
         const box = document.querySelector('[data-testid="tweetTextarea_0"]');
         if(box) {
            box.focus();
            return true;
         }
         return false;
      }, twComment);
      if (typed) {
         await page.keyboard.type(twComment, {delay: 30});
         await sleep(500);
         await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="tweetButton"]');
            if (btn) btn.click();
         });
         await sleep(1500);
      } else {
         throw new Error('Textarea reply tidak ditemukan');
      }
      break;
    case 'bookmark':
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="bookmark"]');
        if (btn) btn.click();
      });
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Twitter`);
  }
}

// ─── THREADS ──────────────────────────────────────────────────────────────
async function threadsAction(page, action, commentTemplates, index, onLog) {
  switch (action) {
    case 'like':
      await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const like = svgs.find(s => s.getAttribute('aria-label').toLowerCase() === 'like' || s.getAttribute('aria-label').toLowerCase() === 'suka');
        if (like) {
           const btn = like.closest('div[role="button"], button') || like;
           btn.click();
        }
      });
      break;
    case 'comment':
    case 'reply':
      const thComment = getComment(commentTemplates, index);
      await page.evaluate(() => {
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const rep = svgs.find(s => s.getAttribute('aria-label').toLowerCase() === 'reply' || s.getAttribute('aria-label').toLowerCase() === 'balas');
        if (rep) {
           const btn = rep.closest('div[role="button"], button') || rep;
           btn.click();
        }
      });
      await sleep(1500);
      const box = await page.evaluate(() => {
         const b = document.querySelector('div[contenteditable="true"]');
         if(b) { b.focus(); return true; }
         return false;
      });
      if(box) {
         await page.keyboard.type(thComment, {delay: 30});
         await sleep(500);
         await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
            const post = btns.find(b => (b.innerText||'').toLowerCase() === 'post' || (b.innerText||'').toLowerCase() === 'posting');
            if (post) post.click();
         });
         await sleep(1500);
      } else {
         throw new Error('Kolom reply tidak ditemukan');
      }
      break;
    case 'repost':
      await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        const rp = svgs.find(s => s.getAttribute('aria-label').toLowerCase() === 'repost' || s.getAttribute('aria-label').toLowerCase() === 'bagikan ulang');
        if (rp) {
           const btn = rp.closest('div[role="button"], button') || rp;
           btn.click();
           await sleep(1000);
           const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
           const confirm = btns.find(b => (b.innerText||'').toLowerCase() === 'repost' || (b.innerText||'').toLowerCase() === 'bagikan ulang');
           if (confirm) confirm.click();
        }
      });
      await sleep(1000);
      break;
    default:
      throw new Error(`Aksi ${action} tidak tersedia untuk Threads`);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────
function getComment(templates, index) {
  if (!templates || templates.length === 0) return 'Bagus!';
  return templates[index % templates.length];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { amplify };
