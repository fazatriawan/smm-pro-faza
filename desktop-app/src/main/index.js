const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const nodeFetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { startAutomation, stopAutomation } = require('../automation/manager');
const { bulkPost, stopBulkPost } = require('../services/bulkPostService');
const { startOAuthServer, setPending } = require('./oauthServer');
const oauthHandlers = require('./oauthHandlers');
const { pushJob, initQueue } = require('./queuePublisher');
const { createClient } = require('@supabase/supabase-js');

const store = new Store({ encryptionKey: 'smm-pro-secret-2024' });
let mainWindow;
let isRunning = false;

function createWindow() {
  const fs = require('fs');
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  const iconOpts = fs.existsSync(iconPath) ? { icon: iconPath } : {};

  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'SMM Pro Desktop',
    ...iconOpts
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

// ─── SCHEDULED POST DISPATCHER ────────────────────────────────────────────────
async function dispatchScheduledPosts() {
  const s = store.get('settings', {});
  if (!s.supabaseUrl || !s.supabaseKey) return;

  try {
    const supabase = createClient(s.supabaseUrl, s.supabaseKey);

    // Find posts that are due
    const { data: posts } = await supabase
      .from('posts')
      .select('id, content, media_urls')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString());

    if (!posts || posts.length === 0) return;

    for (const post of posts) {
      const { data: targets } = await supabase
        .from('post_targets')
        .select('id, account_id, platform')
        .eq('post_id', post.id)
        .eq('status', 'pending');

      if (!targets || targets.length === 0) continue;

      // Mark post as dispatching so it doesn't get picked up again
      await supabase.from('posts').update({ status: 'publishing' }).eq('id', post.id);

      for (const target of targets) {
        try {
          await pushJob(null, {
            postTargetId: target.id,
            platform:     target.platform,
            accountId:    target.account_id,
            content:      post.content,
            mediaUrls:    post.media_urls || [],
          });
          addLog({ type: 'info', message: `📅 Scheduled post dispatched: ${target.platform}` });
        } catch (err) {
          addLog({ type: 'error', message: `❌ Gagal dispatch scheduled post (${target.platform}): ${err.message}` });
        }
      }
    }
  } catch (_) {
    // silent — don't crash the app if Supabase is unreachable
  }
}

app.whenReady().then(() => {
  createWindow();
  startOAuthServer(mainWindow);

  // Init OAuth handlers dan queue dengan kredensial dari electron-store
  const s = store.get('settings', {});
  if (s.supabaseUrl && s.supabaseKey && s.encryptionKey) {
    oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);
    initQueue(createClient(s.supabaseUrl, s.supabaseKey), s.encryptionKey, addLog);
  }

  // Start scheduled post dispatcher — check every 60 seconds
  setInterval(dispatchScheduledPosts, 60 * 1000);
  setTimeout(dispatchScheduledPosts, 5000); // first run 5s after startup
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ─── ACCOUNTS ─────────────────────────────────────────────────────────────
ipcMain.handle('get-accounts', () => store.get('accounts', []));
ipcMain.handle('save-account', (_, account) => {
  const accounts = store.get('accounts', []);
  const idx = accounts.findIndex(a => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else { account.id = Date.now().toString(); accounts.push(account); }
  store.set('accounts', accounts);
  return accounts;
});
ipcMain.handle('delete-account', (_, id) => {
  const accounts = store.get('accounts', []).filter(a => a.id !== id);
  store.set('accounts', accounts);
  return accounts;
});
ipcMain.handle('clear-cookies', (_, id) => {
  const accounts = store.get('accounts', []);
  const idx = accounts.findIndex(a => a.id === id);
  if (idx >= 0) { accounts[idx].cookies = null; store.set('accounts', accounts); }
  return accounts;
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => store.get('settings', {
  headless: false, delayMin: 3, delayMax: 10,
  restBetweenAccounts: 30, maxActionsPerHour: 30,
  apiUrl: 'https://smm-pro-faza.onrender.com'
}));
ipcMain.handle('save-settings', (_, settings) => {
  store.set('settings', settings);
  if (settings.supabaseUrl && settings.supabaseKey && settings.encryptionKey) {
    initQueue(createClient(settings.supabaseUrl, settings.supabaseKey), settings.encryptionKey, addLog);
  }
  return settings;
});

// ─── LOGS ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-logs', () => store.get('logs', []));
ipcMain.handle('clear-logs', () => { store.set('logs', []); return []; });

function addLog(log) {
  const logs = store.get('logs', []);
  logs.unshift({ ...log, timestamp: new Date().toISOString() });
  store.set('logs', logs.slice(0, 1000));
  if (mainWindow) mainWindow.webContents.send('log', log);
}

// ─── FILE PICKER ───────────────────────────────────────────────────────────
ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'avi', 'webm'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const fs = require('fs');
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  const videoExts = ['.mp4', '.mov', '.avi', '.webm'];
  const type = videoExts.includes(ext) ? 'video' : 'image';
  const stat = fs.statSync(filePath);
  return { path: filePath, type, size: stat.size };
});

// ─── EXPORT BULK POST REPORT ───────────────────────────────────────────────
ipcMain.handle('export-bulk-post-report', async (_, results) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Bulk Post Report',
    defaultPath: `bulk-post-report-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (!filePath) return { success: false, error: 'Dibatalkan' };
  const fs = require('fs');
  const headers = ['No', 'Platform', 'Username', 'Status', 'Pesan', 'Link Postingan', 'Screenshot', 'Waktu'];
  const rows = results.map((r, i) => [
    i + 1, r.platform || '', r.username || '', r.status || '', (r.message || '').replace(/,/g, ';'), r.url || '', r.screenshot || '', r.timestamp || ''
  ]);
  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  fs.writeFileSync(filePath, csv, 'utf-8');
  return { success: true, message: `Report disimpan: ${filePath}` };
});

// ─── BULK POST ─────────────────────────────────────────────────────────────
ipcMain.handle('bulk-post', async (_, config) => {
  if (isRunning) return { success: false, error: 'Sedang ada proses yang berjalan' };
  isRunning = true;
  try {
    const settings = store.get('settings', {});
    const results = await bulkPost(config, settings, addLog);
    isRunning = false;
    return { success: true, results };
  } catch (err) {
    isRunning = false;
    return { success: false, error: err.message };
  }
});

// ─── AMPLIFIKASI ───────────────────────────────────────────────────────────
ipcMain.handle('amplify', async (_, config) => {
  if (isRunning) return { success: false, error: 'Sedang ada proses yang berjalan' };
  isRunning = true;
  try {
    const settings = store.get('settings', {});
    config.mode = 'amplify'; // Paksa mode amplify agar manager.js tahu
    await startAutomation(config, settings, addLog);
    isRunning = false;
    return { success: true };
  } catch (err) {
    isRunning = false;
    return { success: false, error: err.message };
  }
});

// ─── AUTOMATION & WARMUP ───────────────────────────────────────────────────
ipcMain.handle('start-automation', async (_, config) => {
  if (isRunning) return { success: false, error: 'Sedang ada proses yang berjalan' };
  isRunning = true;
  try {
    const settings = store.get('settings', {});
    await startAutomation(config, settings, addLog);
    isRunning = false;
    return { success: true };
  } catch (err) {
    isRunning = false;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-screenshot-folder', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const today = new Date().toISOString().split('T')[0];
  const folderPath = path.join(os.homedir(), 'Desktop', 'SMM-Pro-Screenshots', today);
  // Buat folder jika belum ada
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  shell.openPath(folderPath);
  return { success: true };
});

ipcMain.handle('stop-all', () => {
  stopAutomation();
  stopBulkPost();
  isRunning = false;
  return { success: true };
});

// ─── OAUTH ────────────────────────────────────────────────────────────────────
ipcMain.handle('save-oauth-credentials', (_, creds) => {
  const settings = store.get('settings', {});
  store.set('settings', { ...settings, ...creds });
  oauthHandlers.init(creds.supabaseUrl, creds.supabaseKey, creds.encryptionKey);
  if (creds.supabaseUrl && creds.supabaseKey && creds.encryptionKey) {
    initQueue(createClient(creds.supabaseUrl, creds.supabaseKey), creds.encryptionKey, addLog);
  }
  return { success: true };
});

ipcMain.handle('connect-twitter', async () => {
  const s = store.get('settings', {});
  if (!s.twClientId || !s.twClientSecret) return { success: false, error: 'TW_CLIENT_ID / TW_CLIENT_SECRET belum diisi di Pengaturan' };
  if (!s.supabaseUrl || !s.supabaseKey || !s.encryptionKey) return { success: false, error: 'Supabase / Encryption Key belum diisi di Pengaturan' };

  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);
  setPending('twitter', (code) => oauthHandlers.handleTwitterCallback(code, s.twClientId, s.twClientSecret));

  const url = oauthHandlers.buildTwitterUrl(s.twClientId);
  shell.openExternal(url);
  return { success: true };
});

// Shared TikTok PKCE state — prevent double-generation from connect + copy-link
let _tiktokOAuthUrl      = null;
let _tiktokCodeVerifier  = null;

function buildTikTokOAuth(s) {
  // Reuse existing pair if still pending
  if (_tiktokOAuthUrl && _tiktokCodeVerifier) return { url: _tiktokOAuthUrl, codeVerifier: _tiktokCodeVerifier };
  const { url, codeVerifier } = oauthHandlers.buildTikTokUrl(s.tiktokClientKey);
  _tiktokOAuthUrl     = url;
  _tiktokCodeVerifier = codeVerifier;
  const capturedVerifier = codeVerifier;
  setPending('tiktok', async (code) => {
    try {
      const result = await oauthHandlers.handleTikTokCallback(code, s.tiktokClientKey, s.tiktokClientSecret, capturedVerifier);
      _tiktokOAuthUrl = null; _tiktokCodeVerifier = null;
      return result;
    } catch (err) {
      _tiktokOAuthUrl = null; _tiktokCodeVerifier = null; // clear on error so next retry generates fresh PKCE
      throw err;
    }
  });
  return { url, codeVerifier };
}

ipcMain.handle('connect-tiktok', async () => {
  const s = store.get('settings', {});
  if (!s.tiktokClientKey || !s.tiktokClientSecret) return { success: false, error: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET belum diisi di Pengaturan' };
  if (!s.supabaseUrl || !s.supabaseKey || !s.encryptionKey) return { success: false, error: 'Supabase / Encryption Key belum diisi di Pengaturan' };
  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);
  const { url } = buildTikTokOAuth(s);
  shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('connect-youtube', async () => {
  const s = store.get('settings', {});
  if (!s.ytClientId || !s.ytClientSecret) return { success: false, error: 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET belum diisi di Pengaturan' };
  if (!s.supabaseUrl || !s.supabaseKey || !s.encryptionKey) return { success: false, error: 'Supabase / Encryption Key belum diisi di Pengaturan' };

  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);
  setPending('youtube', (code) => oauthHandlers.handleYoutubeCallback(code, s.ytClientId, s.ytClientSecret));

  const url = oauthHandlers.buildYoutubeUrl(s.ytClientId);
  shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('connect-threads', async () => {
  const s = store.get('settings', {});
  if (!s.threadsAppId || !s.threadsAppSecret) return { success: false, error: 'THREADS_APP_ID / THREADS_APP_SECRET belum diisi di Pengaturan' };
  if (!s.supabaseUrl || !s.supabaseKey || !s.encryptionKey) return { success: false, error: 'Supabase / Encryption Key belum diisi di Pengaturan' };

  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);
  setPending('threads', (code) => oauthHandlers.handleThreadsCallback(code, s.threadsAppId, s.threadsAppSecret));

  const url = oauthHandlers.buildThreadsUrl(s.threadsAppId);
  shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('connect-facebook', async () => {
  const s = store.get('settings', {});
  if (!s.fbAppId || !s.fbAppSecret) {
    return { success: false, error: 'FB_APP_ID / FB_APP_SECRET belum diisi di Pengaturan' };
  }
  if (!s.supabaseUrl || !s.supabaseKey || !s.encryptionKey) {
    return { success: false, error: 'Supabase URL / Key / Encryption Key belum diisi di Pengaturan' };
  }

  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);

  setPending('facebook', (code) =>
    oauthHandlers.handleFacebookCallback(code, s.fbAppId, s.fbAppSecret)
  );

  const url = oauthHandlers.buildFacebookUrl(s.fbAppId);
  shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('get-oauth-link', async (_, platform) => {
  const s = store.get('settings', {});
  if (!s.supabaseUrl || !s.supabaseKey || !s.encryptionKey)
    return { success: false, error: 'Supabase / Encryption Key belum diisi di Pengaturan' };

  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);

  let url;
  switch (platform) {
    case 'facebook':
      if (!s.fbAppId || !s.fbAppSecret) return { success: false, error: 'FB_APP_ID / FB_APP_SECRET belum diisi' };
      setPending('facebook', (code) => oauthHandlers.handleFacebookCallback(code, s.fbAppId, s.fbAppSecret));
      url = oauthHandlers.buildFacebookUrl(s.fbAppId);
      break;
    case 'twitter':
      if (!s.twClientId || !s.twClientSecret) return { success: false, error: 'TW_CLIENT_ID / TW_CLIENT_SECRET belum diisi' };
      url = oauthHandlers.buildTwitterUrl(s.twClientId);
      setPending('twitter', (code) => oauthHandlers.handleTwitterCallback(code, s.twClientId, s.twClientSecret));
      break;
    case 'tiktok':
      if (!s.tiktokClientKey || !s.tiktokClientSecret) return { success: false, error: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET belum diisi' };
      url = buildTikTokOAuth(s).url;
      break;
    case 'youtube':
      if (!s.ytClientId || !s.ytClientSecret) return { success: false, error: 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET belum diisi' };
      setPending('youtube', (code) => oauthHandlers.handleYoutubeCallback(code, s.ytClientId, s.ytClientSecret));
      url = oauthHandlers.buildYoutubeUrl(s.ytClientId);
      break;
    case 'threads':
      if (!s.threadsAppId || !s.threadsAppSecret) return { success: false, error: 'THREADS_APP_ID / THREADS_APP_SECRET belum diisi' };
      setPending('threads', (code) => oauthHandlers.handleThreadsCallback(code, s.threadsAppId, s.threadsAppSecret));
      url = oauthHandlers.buildThreadsUrl(s.threadsAppId);
      break;
    default:
      return { success: false, error: `Platform tidak dikenal: ${platform}` };
  }

  return { success: true, url };
});

ipcMain.handle('get-oauth-accounts', async () => {
  const s = store.get('settings', {});
  if (!s.supabaseUrl || !s.supabaseKey) return [];
  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey || '');
  return oauthHandlers.getOAuthAccounts();
});

ipcMain.handle('delete-oauth-account', async (_, id) => {
  await oauthHandlers.deleteOAuthAccount(id);
  return { success: true };
});

// ─── UPLOAD MEDIA ke Supabase Storage ────────────────────────────────────────
ipcMain.handle('upload-media', async (_, filePath) => {
  const s = store.get('settings', {});
  if (!s.supabaseUrl || !s.supabaseKey) {
    return { success: false, error: 'Supabase belum dikonfigurasi di Pengaturan' };
  }

  try {
    const fs   = require('fs');
    const supabase = createClient(s.supabaseUrl, s.supabaseKey);

    const fileName   = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const ext        = path.extname(fileName).toLowerCase();

    const mimeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif',  '.webp': 'image/webp',
      '.mp4': 'video/mp4',  '.mov': 'video/quicktime',
      '.avi': 'video/avi',  '.webm': 'video/webm',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const safeName    = path.basename(fileName, ext)
      .replace(/[^\w\s-]/g, '')   // hapus emoji & karakter non-ASCII
      .replace(/\s+/g, '_')       // spasi → underscore
      .replace(/_+/g, '_')        // dedupe underscore
      .slice(0, 80) || 'file';    // maks 80 karakter, fallback 'file'
    const uploadPath  = `uploads/${Date.now()}_${safeName}${ext}`;

    const { error } = await supabase.storage
      .from('media')
      .upload(uploadPath, fileBuffer, { contentType, upsert: false });

    if (error) return { success: false, error: error.message };

    const { data } = supabase.storage.from('media').getPublicUrl(uploadPath);
    return { success: true, url: data.publicUrl };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── BULK POST (queue) ────────────────────────────────────────────────────────
ipcMain.handle('submit-bulk-post', async (_, { content, mediaUrls, accountIds, scheduledAt }) => {
  const s = store.get('settings', {});
  if (!s.supabaseUrl || !s.supabaseKey) return { success: false, error: 'Supabase belum dikonfigurasi di Pengaturan' };

  const supabase = createClient(s.supabaseUrl, s.supabaseKey);

  // Ambil data akun
  const { data: accs, error: accErr } = await supabase
    .from('social_accounts')
    .select('id, platform, username')
    .in('id', accountIds);
  if (accErr) return { success: false, error: accErr.message };

  // Buat record post
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .insert({
      content,
      media_urls:   mediaUrls || [],
      scheduled_at: scheduledAt || null,
      status:       scheduledAt ? 'scheduled' : 'publishing',
    })
    .select()
    .single();
  if (postErr) return { success: false, error: postErr.message };

  const results = [];

  for (const acc of accs) {
    // Buat post_target
    const { data: target, error: targetErr } = await supabase
      .from('post_targets')
      .insert({
        post_id:    post.id,
        account_id: acc.id,
        platform:   acc.platform,
        status:     'pending',
      })
      .select()
      .single();

    if (targetErr) {
      results.push({ accountId: acc.id, username: acc.username, platform: acc.platform, success: false, error: targetErr.message });
      continue;
    }

    // Push ke queue jika bukan scheduled
    if (!scheduledAt) {
      try {
        const jobId = await pushJob(null, {
          postTargetId: target.id,
          platform:     acc.platform,
          accountId:    acc.id,
          content,
          mediaUrls:    mediaUrls || [],
        });
        results.push({ accountId: acc.id, username: acc.username, platform: acc.platform, success: true, jobId, postTargetId: target.id });
      } catch (err) {
        results.push({ accountId: acc.id, username: acc.username, platform: acc.platform, success: false, error: err.message });
      }
    } else {
      results.push({ accountId: acc.id, username: acc.username, platform: acc.platform, success: true, scheduled: scheduledAt, postTargetId: target.id });
    }
  }

  return { success: true, postId: post.id, results };
});

// ─── GEMINI HELPER ───────────────────────────────────────────────────────────
async function callGemini(apiKey, model, systemPrompt, userPrompt) {
  const mdl = model || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${apiKey}`;
  const res  = await nodeFetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents:          [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig:  { maxOutputTokens: 2000, temperature: 0.8 },
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || 'Gemini API error';
    if (res.status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Kuota Gemini habis. Aktifkan billing di aistudio.google.com atau buat API key baru di project berbeda.');
    }
    throw new Error(msg);
  }
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── AI CONTENT GENERATOR ────────────────────────────────────────────────────
function buildContentPrompts(tema, data, contentType) {
  if (contentType === 'gambar') {
    const systemPrompt = `Bertindaklah sebagai Social Media Strategist dan Desainer Konten Carousel/Infografis untuk Instagram dan TikTok di Indonesia. Keahlian Anda adalah mengubah berita atau informasi menjadi konten carousel yang menarik, informatif, dan viral di kalangan Gen Z dan Milenial Indonesia.

Tujuan Konten: Mengedukasi masyarakat secara visual, ringkas, dan berbasis data. Tone bahasa santai, smart-casual, menggunakan istilah kekinian Indonesia.

Kembalikan response MURNI dalam format JSON dengan key berikut:
- judul: judul konten carousel
- hook_visual: teks hook untuk slide pertama (maks 8 kata, harus bikin penasaran/klik)
- slides: array 5-7 slide, masing-masing { nomor, judul_slide, isi (2-3 kalimat padat), deskripsi_visual_inggris (deskripsi gambar pendukung slide dalam Bahasa Inggris, tanpa teks) }
- caption: caption Instagram/TikTok siap pakai
- hashtag: array string
- prompt_cover_inggris: deskripsi gambar cover carousel dalam Bahasa Inggris untuk generate di AI image generator, tanpa teks/tulisan, estetis, ratio 1:1

Jangan ada teks lain selain JSON.`;
    const userPrompt = `Tema yang dipilih: ${tema}\nReferensi Data/Berita: ${data}\n\nBuatkan 1 ide konten carousel/infografis yang komprehensif sesuai format JSON.`;
    return { systemPrompt, userPrompt };
  }

  // default: video
  const systemPrompt = `Bertindaklah sebagai Social Media Strategist dan Copywriter TikTok/Instagram Reels top tier di Indonesia. Keahlian utama Anda adalah mengubah berita formal atau informasi menjadi konten video pendek (di bawah 60 detik) yang viral, engaging, dan sangat disukai oleh Gen Z serta Milenial. Anda paham cara membuat hook 3 detik pertama yang mematikan agar penonton tidak scroll.

Tujuan Konten: Mengedukasi masyarakat secara elegan, logis, dan berbasis data. Tone bahasa santai, smart-casual, menggunakan istilah kekinian Indonesia (guys, fyi, jujurly—tapi tidak cringe), dan tidak kaku.

Kembalikan response MURNI dalam format JSON dengan key berikut: judul, hook, visual, script, cta, caption, hashtag (array string), prompt_gambar_inggris (deskripsi singkat dalam Bahasa Inggris untuk generate gambar B-roll pendukung konten, tanpa teks/tulisan, realistis, estetis, cocok untuk TikTok/Reels 9:16). Jangan ada teks lain selain JSON.`;
  const userPrompt = `Tema yang dipilih: ${tema}\nReferensi Data/Berita: ${data}\n\nBuatkan 1 ide konten video pendek yang komprehensif sesuai format JSON.`;
  return { systemPrompt, userPrompt };
}

ipcMain.handle('generate-content', async (_, { tema, data, model, contentType }) => {
  const s = store.get('settings', {});
  const { systemPrompt, userPrompt } = buildContentPrompts(tema, data, contentType || 'video');

  // Return prompts even without API key so user can copy them
  if (!s.geminiApiKey) {
    return { success: false, error: 'Gemini API Key belum diisi di Pengaturan', systemPrompt, userPrompt };
  }

  try {
    const text = await callGemini(s.geminiApiKey, model, systemPrompt, userPrompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'Respons Gemini bukan JSON valid', raw: text, systemPrompt, userPrompt };
    const result = JSON.parse(jsonMatch[0]);
    return { success: true, result, systemPrompt, userPrompt };
  } catch (err) {
    return { success: false, error: err.message, systemPrompt, userPrompt };
  }
});

// ─── SCRAPE NEWS (RSS) ───────────────────────────────────────────────────────
ipcMain.handle('scrape-news', async (_, { sources, keyword, limit = 5 } = {}) => {
  const RSS_FEEDS = {
    antara:  'https://www.antaranews.com/rss/terkini.xml',
    detik:   'https://rss.detik.com/index.php/detikcom',
    kompas:  'https://rss.kompas.com/api/main_index',
    tempo:   'https://rss.tempo.co/',
    tribun:  'https://www.tribunnews.com/rss',
    cnn:     'https://www.cnnindonesia.com/rss',
  };

  const kw = keyword?.toLowerCase() || '';
  const selected = (sources || Object.keys(RSS_FEEDS)).filter(s => RSS_FEEDS[s]);
  const articles = [];

  for (const src of selected) {
    try {
      const res  = await nodeFetch(RSS_FEEDS[src], { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
      const xml  = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      for (const [, body] of items) {
        const title = (body.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || body.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
        const link  = (body.match(/<link>(.*?)<\/link>/))?.[1]?.trim();
        const pubDate = (body.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim();
        const description = (body.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || body.match(/<description>(.*?)<\/description>/))?.[1]?.replace(/<[^>]+>/g,'').trim();
        if (!title) continue;
        if (kw && !title.toLowerCase().includes(kw) && !(description||'').toLowerCase().includes(kw)) continue;
        articles.push({ source: src, title, link, pubDate, description });
        if (articles.length >= limit * selected.length) break;
      }
    } catch (e) { /* skip source on error */ }
  }

  const sorted = articles.sort((a, b) => {
    if (!a.pubDate) return 1;
    if (!b.pubDate) return -1;
    return new Date(b.pubDate) - new Date(a.pubDate);
  }).slice(0, limit * 3);

  return { success: true, articles: sorted };
});

// ─── SCRAPE GOOGLE TRENDS INDONESIA ─────────────────────────────────────────
ipcMain.handle('scrape-trends', async () => {
  try {
    const res   = await nodeFetch('https://trends.google.com/trending/rss?geo=ID', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 10000,
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const xml   = await res.text();
    const items = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<ht:news_item_title><!\[CDATA\[(.*?)\]\]><\/ht:news_item_title>|<title>(.*?)<\/title>/g)]
      .map(m => (m[1] || m[2] || m[3])?.trim()).filter(Boolean)
      .filter(t => !['Google Trends', 'Trending Searches in Indonesia'].includes(t));
    return { success: true, trends: items.slice(0, 25) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── SENTIMENT ANALYSIS ──────────────────────────────────────────────────────
ipcMain.handle('analyze-sentiment', async (_, { texts }) => {
  const s = store.get('settings', {});
  if (!s.geminiApiKey) return { success: false, error: 'Gemini API Key belum diisi' };

  const systemPrompt = 'Kamu adalah analis sentimen teks berbahasa Indonesia. Selalu kembalikan HANYA JSON valid, tanpa teks lain.';
  const userPrompt   = `Analisis sentimen dari daftar teks berita/judul berikut. Klasifikasikan setiap item sebagai "positif", "negatif", atau "netral".

Teks:
${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Kembalikan JSON: { "results": [{ "text": "...", "sentiment": "positif|negatif|netral", "score": 0.0-1.0, "reason": "alasan singkat" }], "summary": { "positif": N, "negatif": N, "netral": N } }`;

  try {
    const raw   = await callGemini(s.geminiApiKey, 'gemini-2.0-flash', systemPrompt, userPrompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { success: false, error: 'Respons tidak valid' };
    return { success: true, ...JSON.parse(match[0]) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IMAGEN B-ROLL GENERATOR ─────────────────────────────────────────────────
ipcMain.handle('generate-imagen-broll', async (_, { prompt }) => {
  const s = store.get('settings', {});
  if (!s.geminiApiKey) return { success: false, error: 'Gemini API Key belum diisi di Pengaturan' };
  if (!prompt?.trim()) return { success: false, error: 'Prompt kosong' };

  // AI Studio API keys use generateContent with responseModalities, not predict endpoint
  const model = 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${s.geminiApiKey}`;
  const fullPrompt = `Generate a photorealistic vertical 9:16 B-roll image (no text, no watermarks, no UI elements): ${prompt.trim()}`;

  try {
    const res = await nodeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json.error?.message || 'Gemini image API error';
      if (res.status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
        return { success: false, error: 'Kuota habis. Cek billing di aistudio.google.com.' };
      }
      return { success: false, error: msg };
    }
    const parts = json.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData?.data);
    if (!imgPart) return { success: false, error: 'Tidak ada gambar dikembalikan. Pastikan API key aktif dan model didukung.' };
    return { success: true, base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || 'image/png' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── YOUTUBE TRENDS ──────────────────────────────────────────────────────────
async function fetchYoutubeTrends(apiKey, categoryId) {
  const params = new URLSearchParams({
    part: 'snippet,statistics',
    chart: 'mostPopular',
    regionCode: 'ID',
    maxResults: '10',
    key: apiKey,
  });
  if (categoryId) params.set('videoCategoryId', String(categoryId));
  const res  = await nodeFetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'YouTube API error');
  return (json.items || []).map(v => ({
    judul:        v.snippet.title,
    nama_channel: v.snippet.channelTitle,
    views:        parseInt(v.statistics?.viewCount || '0', 10),
    url_video:    `https://www.youtube.com/watch?v=${v.id}`,
  }));
}

ipcMain.handle('get-youtube-trends', async (_, { categoryId } = {}) => {
  const s = store.get('settings', {});
  if (!s.youtubeApiKey) return { success: false, error: 'YouTube API Key belum diisi di Pengaturan' };
  try {
    const videos = await fetchYoutubeTrends(s.youtubeApiKey, categoryId);
    return { success: true, videos };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── DOWNLOAD B-ROLL IMAGE ────────────────────────────────────────────────────
ipcMain.handle('download-broll-image', async (_, { base64, mimeType }) => {
  try {
    const ext = (mimeType || 'image/png').split('/')[1] || 'png';
    const filename = `broll_${Date.now()}.${ext}`;
    const savePath = path.join(app.getPath('downloads'), filename);
    fs.writeFileSync(savePath, Buffer.from(base64, 'base64'));
    shell.showItemInFolder(savePath);
    return { success: true, path: savePath, filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── OPEN EXTERNAL URL ────────────────────────────────────────────────────────
ipcMain.handle('open-external', async (_, url) => {
  await shell.openExternal(url);
});

// ─── POLL POST TARGETS ────────────────────────────────────────────────────────
ipcMain.handle('poll-post-targets', async (_, postTargetIds) => {
  const s = store.get('settings', {});
  if (!s.supabaseUrl || !s.supabaseKey) return { success: false };
  const supabase = createClient(s.supabaseUrl, s.supabaseKey);
  const { data, error } = await supabase
    .from('post_targets')
    .select('id, status, platform_post_id, post_url, error_message, platform')
    .in('id', postTargetIds);
  if (error) return { success: false };
  return { success: true, targets: data };
});
