const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const nodeFetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { startAutomation, stopAutomation } = require('../automation/manager');
const { bulkPost, stopBulkPost } = require('../services/bulkPostService');
const { instagramScraper, exportToCsv } = require('../services/instagramScraperService');
const { huntUsername } = require('../services/usernameHunterService');
const { searchOpenverse, searchGiphy, searchUnsplash, searchPexels, downloadPhoto, searchGoogleNews, fetchReddit } = require('../services/stockPhotoService');
const { startOAuthServer, setPending } = require('./oauthServer');
const oauthHandlers = require('./oauthHandlers');
const { pushJob, initQueue } = require('./queuePublisher');
const { createClient } = require('@supabase/supabase-js');

const store = new Store({ encryptionKey: 'smm-pro-secret-2024' });
let mainWindow;
let isRunning = false;

// Desktop sync configuration
const DESKTOP_API_KEY = 'smm-pro-desktop-sync-2024';

async function syncAccountsToBackend(accounts) {
  try {
    const settings = store.get('settings', {});
    const apiUrl = settings.apiUrl || 'https://smm-pro-faza.onrender.com';
    const userId = store.get('userId');
    if (!userId) return;

    const res = await nodeFetch(`${apiUrl}/api/accounts/sync-desktop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-desktop-api-key': DESKTOP_API_KEY
      },
      body: JSON.stringify({ userId, accounts })
    });

    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[Sync] Failed to sync accounts:', err.message);
  }
}

async function deleteAccountFromBackend(platform, username) {
  try {
    const settings = store.get('settings', {});
    const apiUrl = settings.apiUrl || 'https://smm-pro-faza.onrender.com';
    const userId = store.get('userId');
    if (!userId) return;

    await nodeFetch(`${apiUrl}/api/accounts/sync-desktop/${userId}/${platform}/${username}`, {
      method: 'DELETE',
      headers: { 'x-desktop-api-key': DESKTOP_API_KEY }
    });
  } catch (err) {
    console.error('[Sync] Failed to delete account:', err.message);
  }
}

async function fetchAccountsFromBackend() {
  try {
    const settings = store.get('settings', {});
    const apiUrl = settings.apiUrl || 'https://smm-pro-faza.onrender.com';
    const userId = store.get('userId');
    if (!userId) return [];

    const res = await nodeFetch(`${apiUrl}/api/accounts/sync-desktop/${userId}`, {
      headers: { 'x-desktop-api-key': DESKTOP_API_KEY }
    });

    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const data = await res.json();
    return data || [];
  } catch (err) {
    console.error('[Sync] Failed to fetch accounts:', err.message);
    return [];
  }
}

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
ipcMain.handle('get-accounts', async () => {
  const localAccounts = store.get('accounts', []);
  try {
    // Try to fetch from backend and merge
    const backendAccounts = await fetchAccountsFromBackend();
    const oauthAccounts = backendAccounts
      .filter(a => a.loginType === 'oauth')
      .map(a => ({
        id: a._id,
        platform: a.platform,
        username: a.platformUsername || a.platformUserId,
        label: a.label,
        accessToken: a.accessToken,
        refreshToken: a.refreshToken,
        loginType: 'oauth'
      }));

    // Fetch automation accounts from backend (including decrypted password)
    const automationAccounts = backendAccounts
      .filter(a => a.loginType === 'automation')
      .map(a => ({
        id: a._id,
        platform: a.platform,
        username: a.platformUsername || a.platformUserId,
        label: a.label,
        password: a.automationData?.password,
        cookies: a.automationData?.cookies,
        userAgent: a.automationData?.userAgent,
        loginType: 'automation'
      }));

    // Merge priority: backend automation > local automation > backend oauth
    const merged = [...localAccounts.filter(a => !automationAccounts.find(o => o.username === a.username && o.platform === a.platform) && !oauthAccounts.find(o => o.username === a.username && o.platform === a.platform))];
    return [...merged, ...automationAccounts, ...oauthAccounts];
  } catch (err) {
    return localAccounts;
  }
});

ipcMain.handle('save-account', async (_, account) => {
  const accounts = store.get('accounts', []);
  const idx = accounts.findIndex(a => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else { account.id = Date.now().toString(); accounts.push(account); }
  store.set('accounts', accounts);

  // Sync automation accounts to backend
  const automationAccounts = accounts.filter(a => !a.accessToken); // automation = no OAuth token
  await syncAccountsToBackend(automationAccounts);

  return accounts;
});

ipcMain.handle('delete-account', async (_, id) => {
  const accounts = store.get('accounts', []);
  const deleted = accounts.find(a => a.id === id);
  const filtered = accounts.filter(a => a.id !== id);
  store.set('accounts', filtered);

  // Sync delete to backend
  if (deleted) {
    await deleteAccountFromBackend(deleted.platform, deleted.username);
  }

  return filtered;
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
  apiUrl: 'https://smm-pro-faza.onrender.com',
  userId: ''
}));
ipcMain.handle('save-settings', (_, settings) => {
  store.set('settings', settings);
  if (settings.supabaseUrl && settings.supabaseKey && settings.encryptionKey) {
    initQueue(createClient(settings.supabaseUrl, settings.supabaseKey), settings.encryptionKey, addLog);
  }
  return settings;
});

// ─── YOUTUBE VIDEO INFO ────────────────────────────────────────────────────
ipcMain.handle('fetch-youtube-info', async (_, url) => {
  const settings = store.get('settings', {});
  const apiKey = settings.youtubeApiKey;

  // Extract video ID
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  const videoId = match ? match[1] : null;
  if (!videoId) return { success: false, error: 'URL YouTube tidak valid' };

  // Try YouTube Data API v3 if key exists
  if (apiKey) {
    try {
      const res = await nodeFetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`);
      const data = await res.json();
      if (data.items?.[0]?.snippet) {
        const s = data.items[0].snippet;
        return {
          success: true,
          title: s.title,
          description: s.description,
          channelName: s.channelTitle,
          context: `${s.title}\n${(s.description || '').slice(0, 300)}`
        };
      }
    } catch (err) {
      // Fallback to oEmbed
    }
  }

  // Fallback to oEmbed (title only, no API key needed)
  try {
    const res = await nodeFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    const data = await res.json();
    return {
      success: true,
      title: data.title,
      description: '',
      channelName: data.author_name || '',
      context: data.title || ''
    };
  } catch (err) {
    return { success: false, error: 'Gagal mengambil info video' };
  }
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

// ─── INSTAGRAM SCRAPER ────────────────────────────────────────────────────
ipcMain.handle('instagram-scraper', async (_, config) => {
  if (isRunning) return { success: false, error: 'Sedang ada proses yang berjalan' };
  isRunning = true;
  try {
    const settings = store.get('settings', {});
    const result = await instagramScraper(config, settings, addLog);
    isRunning = false;
    return result;
  } catch (err) {
    isRunning = false;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('instagram-scraper-export', async (_, results) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Simpan Hasil Scraping',
      defaultPath: `hasil_instagram_${new Date().toISOString().slice(0,10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!filePath) return { success: false, error: 'Dibatalkan' };
    exportToCsv(results, filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── USERNAME HUNTER ───────────────────────────────────────────────────────
ipcMain.handle('username-hunt', async (_, config) => {
  try {
    const result = await huntUsername(config, addLog);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('username-hunt-export', async (_, { username, results }) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Simpan Hasil Username Hunt',
      defaultPath: `username_hunt_${username}_${new Date().toISOString().slice(0,10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!filePath) return { success: false, error: 'Dibatalkan' };
    const header = 'platform,kategori,url,status,http_code';
    const rows = results.map(r =>
      `"${r.platform}","${r.cat || ''}","${r.url}","${r.status}","${r.httpCode || ''}"`
    );
    fs.writeFileSync(filePath, [header, ...rows].join('\n'), 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── STOCK PHOTOS ──────────────────────────────────────────────────────────
ipcMain.handle('search-stock-photos', async (_, { query, source, page = 1, perPage = 20 }) => {
  try {
    const settings = store.get('settings', {});
    let result;
    if (source === 'pexels') {
      result = await searchPexels(query, page, perPage, settings.pexelsApiKey);
    } else if (source === 'unsplash') {
      result = await searchUnsplash(query, page, perPage, settings.unsplashApiKey);
    } else if (source === 'giphy') {
      result = await searchGiphy(query, page - 1, perPage, settings.giphyApiKey);
    } else {
      // Default: Openverse — gratis, tanpa API key
      result = await searchOpenverse(query, page, perPage);
    }
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fetch-news-rss', async (_, { query, lang = 'id', country = 'ID' }) => {
  try {
    const items = await searchGoogleNews(query, lang, country);
    return { success: true, items };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fetch-reddit', async (_, { query, subreddit = '', sort = 'hot', limit = 15 }) => {
  try {
    const posts = await fetchReddit(query, subreddit, sort, limit);
    return { success: true, posts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-stock-photo', async (_, { url, filename }) => {
  try {
    const filePath = await downloadPhoto(url, filename);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── AMPLIFIKASI ───────────────────────────────────────────────────────────
ipcMain.handle('amplify', async (_, config) => {
  if (isRunning) return { success: false, error: 'Sedang ada proses yang berjalan' };
  isRunning = true;
  try {
    const settings = store.get('settings', {});

    // Generate AI comments if enabled
    if (config.aiConfig?.useAI && config.actions.includes('comment')) {
      addLog({ type: 'info', message: '[AI] Generating comments via Gemini...' });
      const generatedComments = await generateAICommentsForAmplify(config, settings);
      config.commentTemplates = generatedComments;
      addLog({ type: 'info', message: `[AI] Generated ${generatedComments.length} unique comments` });
    }

    config.mode = 'amplify'; // Paksa mode amplify agar manager.js tahu
    await startAutomation(config, settings, addLog);
    isRunning = false;
    return { success: true };
  } catch (err) {
    isRunning = false;
    return { success: false, error: err.message };
  }
});

async function generateAICommentsForAmplify(config, settings) {
  const geminiKey = settings.geminiApiKey;
  if (!geminiKey) throw new Error('Gemini API Key belum diatur di Pengaturan');

  const accountCount = config.accounts?.length || 1;
  const aiConfig = config.aiConfig;

  const toneMap = {
    pro: 'mendukung penuh, memuji, dan merekomendasikan konten ini',
    kontra: 'kritis, menyanggah, atau menunjukkan kekurangan dengan sopan',
    netral: 'netral, memberikan pendapat seimbang'
  };

  const styleMap = {
    santai: 'santai dan friendly, seperti ngobrol sama teman di social media',
    formal: 'formal dan profesional, seperti review resmi',
    kritis: 'kritis dan analitis, menyoroti detail',
    lucu: 'lucu dan menghibur dengan humor ringan Indonesia',
    pendek: 'singkat dan padat, maksimal 5-10 kata saja'
  };

  const tone = toneMap[aiConfig.tone] || toneMap.netral;
  const style = styleMap[aiConfig.style] || styleMap.santai;
  const context = aiConfig.contentContext || '';
  const contentType = aiConfig.contentType || 'other';

  const contentTypeGuide = {
    standup_comedy: 'stand up comedy — fokus pada humor, punchline, delivery, komika, materi lucu',
    tutorial: 'tutorial/edukasi — fokus pada cara penjelasan, langkah-langkah, manfaat, tips',
    review: 'review produk — fokus pada fitur, kelebihan/kekurangan, harga, rekomendasi',
    vlog: 'vlog/lifestyle — fokus pada aktivitas, pengalaman, tempat, momen seru',
    music: 'musik/entertainment — fokus pada lagu, suara, lirik, performance, artis',
    gaming: 'gaming — fokus pada gameplay, strategi, grafik, karakter, skill',
    news: 'berita/informasi — fokus pada fakta, opini, isu terkini, analisis',
    motivasi: 'motivasi/inspirasi — fokus pada quotes, kisah sukses, semangat hidup',
    cooking: 'masak/kuliner — fokus pada resep, rasa, tampilan makanan, teknik',
    sports: 'olahraga — fokus pada teknik, hasil pertandingan, atlet, strategi',
    other: 'konten umum'
  };

  const systemPrompt = `Kamu adalah generator komentar social media AI. TUGAS UTAMAMU adalah membuat komentar yang SANGAT SPESIFIK dan RELEVAN dengan konten yang diberikan.

ATURAN PENTING:
1. SELALU analisis judul/topik konten TERLEBIH DAHULU sebelum membuat komentar.
2. JANGAN PERNAH membuat komentar tentang hal yang tidak disebutkan di judul/konteks.
3. JANGAN membuat komentar generic seperti "konten edukatif", "info penting", "berbobot", "tutorialnya bagus" kecuali memang spesifik.
4. Komentar harus terlihat seperti reaksi PENONTON ASLI yang baru saja menonton video tersebut.
5. Gunakan referensi spesifik dari judul/konteks dalam komentar.`;

  const contentTypeHint = contentTypeGuide[contentType]
    ? `JENIS KONTEN: ${contentTypeGuide[contentType]}. Buat komentar yang sesuai.`
    : '';

  const contextHint = context
    ? `JUDUL/KONTEKS SPESIFIK: "${context}". Setiap komentar HARUS merujuk langsung ke konten ini.`
    : '';

  const userPrompt = `Buat ${accountCount} komentar BERBEDA-BEDA dan NATURAL.

${contentTypeHint}
${contextHint}

TONE/NARASI: ${tone}
GAYA PENULISAN: ${style}

Persyaratan PENTING:
- Setiap komentar HARUS terlihat ditulis oleh orang berbeda
- Gunakan variasi bahasa: formal, semi-formal, gaul Indonesia
- Variasi panjang: ada yang 1 kata, ada yang 1-2 kalimat
- Sertakan emoji secukupnya (tidak berlebihan)
- Jangan ada komentar yang mirip satu sama lain
- Terlihat natural, bukan seperti bot
- Campur bahasa Indonesia dan sedikit bahasa Inggris (natural)
- Sesuaikan dengan tone dan gaya yang diminta
- Komentar HARUS spesifik ke konten yang disebutkan, jangan generic

Format output (HANYA komentar, tanpa nomor, tanpa penjelasan):
[komentar 1]
[komentar 2]
...dst`;

  const res = await nodeFetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 2500 }
    })
  });

  const data = await res.json();
  if (!data.candidates?.[0]) throw new Error('Respons Gemini kosong');

  const raw = data.candidates[0].content.parts[0].text;
  const comments = raw.split('\n')
    .map(c => c.trim())
    .filter(c => c && !c.startsWith('[') && c.length > 1);

  // Ensure we have enough comments
  const fallbacks = ['Mantap! 👍', 'Keren banget 🔥', 'Nice! 👌', 'Oke lah 👍', 'Sip', 'Bagus!', 'Mantul! ✨'];
  while (comments.length < accountCount) {
    comments.push(fallbacks[comments.length % fallbacks.length]);
  }

  return comments.slice(0, accountCount);
}

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

// ─── AI CAPTION VARIATIONS ────────────────────────────────────────────────────
ipcMain.handle('generate-caption-variations', async (_, { topic, tone, platform, model } = {}) => {
  const s = store.get('settings', {});
  if (!s.geminiApiKey) {
    return { success: false, error: 'Gemini API Key belum diisi di Pengaturan' };
  }
  const systemPrompt = `Bertindaklah sebagai Social Media Copywriter top tier untuk Indonesia. Buatkan 5 variasi caption untuk konten media sosial.

Aturan:
- Setiap variasi harus unik, engaging, dan sesuai tone yang diminta
- Sertakan CTA (call-to-action) yang jelas
- Hashtag relevan di akhir setiap caption
- Panjang optimal untuk ${platform || 'Instagram'} (150-300 karakter per variasi)
- Gunakan bahasa Indonesia yang santai dan kekinian

Kembalikan response MURNI dalam format JSON:
{
  "variations": [
    { "id": 1, "text": "...", "hashtags": ["..."] },
    { "id": 2, "text": "...", "hashtags": ["..."] },
    ...
  ]
}`;
  const userPrompt = `Topik: ${topic || 'Konten umum'}\nTone: ${tone || 'Santai dan friendly'}\nPlatform: ${platform || 'Instagram'}\n\nBuatkan 5 variasi caption.`;

  try {
    const text = await callGemini(s.geminiApiKey, model, systemPrompt, userPrompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'Respons Gemini bukan JSON valid', raw: text };
    const result = JSON.parse(jsonMatch[0]);
    return { success: true, variations: result.variations || [] };
  } catch (err) {
    return { success: false, error: err.message };
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
    const raw   = await callGemini(s.geminiApiKey, 'gemini-flash-latest', systemPrompt, userPrompt);
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
