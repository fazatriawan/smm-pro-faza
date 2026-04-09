const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Accounts
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  saveAccount: (a) => ipcRenderer.invoke('save-account', a),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  clearCookies: (id) => ipcRenderer.invoke('clear-cookies', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // Logs
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),

  // Features
  bulkPost: (config) => ipcRenderer.invoke('bulk-post', config),
  amplify: (config) => ipcRenderer.invoke('amplify', config),
  startAutomation: (config) => ipcRenderer.invoke('start-automation', config),
  stopAll: () => ipcRenderer.invoke('stop-all'),
  openScreenshotFolder: () => ipcRenderer.invoke('open-screenshot-folder'),

  // Events
  onLog: (cb) => ipcRenderer.on('log', (_, log) => cb(log)),
  onStatus: (cb) => ipcRenderer.on('status', (_, s) => cb(s)),
});
