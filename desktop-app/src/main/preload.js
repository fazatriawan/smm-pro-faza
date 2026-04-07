const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Akun
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  saveAccount: (account) => ipcRenderer.invoke('save-account', account),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Logs
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),

  // Automation
  startAutomation: (config) => ipcRenderer.invoke('start-automation', config),
  stopAutomation: () => ipcRenderer.invoke('stop-automation'),

  // Event listener
  onAutomationLog: (callback) => {
    ipcRenderer.on('automation-log', (event, log) => callback(log));
  },
  onAutomationStatus: (callback) => {
    ipcRenderer.on('automation-status', (event, status) => callback(status));
  }
});
