const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { startAutomation, stopAutomation } = require('../automation/manager');
const { bulkPost, stopBulkPost } = require('../services/bulkPostService');
const { startOAuthServer, setPending } = require('./oauthServer');
const oauthHandlers = require('./oauthHandlers');
const { pushJob }   = require('./queuePublisher');
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

app.whenReady().then(() => {
  createWindow();
  startOAuthServer(mainWindow);

  // Init OAuth handlers dengan kredensial dari electron-store
  const s = store.get('settings', {});
  if (s.supabaseUrl && s.supabaseKey && s.encryptionKey) {
    oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);
  }
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
ipcMain.handle('save-settings', (_, settings) => { store.set('settings', settings); return settings; });

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

ipcMain.handle('connect-tiktok', async () => {
  const s = store.get('settings', {});
  if (!s.tiktokClientKey || !s.tiktokClientSecret) return { success: false, error: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET belum diisi di Pengaturan' };
  if (!s.supabaseUrl || !s.supabaseKey || !s.encryptionKey) return { success: false, error: 'Supabase / Encryption Key belum diisi di Pengaturan' };

  oauthHandlers.init(s.supabaseUrl, s.supabaseKey, s.encryptionKey);
  setPending('tiktok', (code) => oauthHandlers.handleTikTokCallback(code, s.tiktokClientKey, s.tiktokClientSecret));

  const url = oauthHandlers.buildTikTokUrl(s.tiktokClientKey);
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
    const uploadPath  = `uploads/${Date.now()}_${fileName}`;

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
  if (!s.upstashRedisUrl && !scheduledAt) return { success: false, error: 'Upstash Redis URL belum diisi di Pengaturan' };

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
        const jobId = await pushJob(s.upstashRedisUrl, {
          postTargetId: target.id,
          platform:     acc.platform,
          accountId:    acc.id,
          content,
          mediaUrls:    mediaUrls || [],
        });
        results.push({ accountId: acc.id, username: acc.username, platform: acc.platform, success: true, jobId });
      } catch (err) {
        results.push({ accountId: acc.id, username: acc.username, platform: acc.platform, success: false, error: err.message });
      }
    } else {
      results.push({ accountId: acc.id, username: acc.username, platform: acc.platform, success: true, scheduled: scheduledAt });
    }
  }

  return { success: true, postId: post.id, results };
});
