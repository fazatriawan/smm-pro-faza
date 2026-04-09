const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { startAutomation, stopAutomation } = require('../automation/manager');
const { bulkPost } = require('../services/bulkPostService');
const { amplify } = require('../services/amplifyService');

const store = new Store({ encryptionKey: 'smm-pro-secret-2024' });
let mainWindow;
let isRunning = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'SMM Pro Desktop'
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);
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

// ─── BULK POST ─────────────────────────────────────────────────────────────
ipcMain.handle('bulk-post', async (_, config) => {
  if (isRunning) return { success: false, error: 'Sedang ada proses yang berjalan' };
  isRunning = true;
  try {
    const settings = store.get('settings', {});
    await bulkPost(config, settings, addLog);
    isRunning = false;
    return { success: true };
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
    await amplify(config, settings, addLog);
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
  isRunning = false;
  return { success: true };
});
