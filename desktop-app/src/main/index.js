const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { startAutomation, stopAutomation } = require('../automation/manager');

const store = new Store();
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    title: 'SMM Pro Desktop'
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC Handlers ─────────────────────────────────────────────────────────

// Akun Management
ipcMain.handle('get-accounts', () => store.get('accounts', []));

ipcMain.handle('save-account', (event, account) => {
  const accounts = store.get('accounts', []);
  const existing = accounts.findIndex(a => a.id === account.id);
  if (existing >= 0) {
    accounts[existing] = account;
  } else {
    account.id = Date.now().toString();
    accounts.push(account);
  }
  store.set('accounts', accounts);
  return accounts;
});

ipcMain.handle('delete-account', (event, accountId) => {
  const accounts = store.get('accounts', []).filter(a => a.id !== accountId);
  store.set('accounts', accounts);
  return accounts;
});

// Settings
ipcMain.handle('get-settings', () => store.get('settings', {
  headless: false,
  delayMin: 3,
  delayMax: 10,
  maxActionsPerHour: 30,
  restBetweenAccounts: 60
}));

ipcMain.handle('save-settings', (event, settings) => {
  store.set('settings', settings);
  return settings;
});

// Logs
ipcMain.handle('get-logs', () => store.get('logs', []));

ipcMain.handle('clear-logs', () => {
  store.set('logs', []);
  return [];
});

// Automation
ipcMain.handle('start-automation', async (event, config) => {
  try {
    const settings = store.get('settings', {});
    await startAutomation(config, settings, (log) => {
      // Kirim log ke renderer
      mainWindow.webContents.send('automation-log', log);
      // Simpan log
      const logs = store.get('logs', []);
      logs.unshift({ ...log, timestamp: new Date().toISOString() });
      store.set('logs', logs.slice(0, 500)); // Simpan 500 log terakhir
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-automation', () => {
  stopAutomation();
  return { success: true };
});
