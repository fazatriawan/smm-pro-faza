const { contextBridge, ipcRenderer, shell } = require('electron');

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
  pickFile: () => ipcRenderer.invoke('pick-file'),
  exportBulkPostReport: (results) => ipcRenderer.invoke('export-bulk-post-report', results),
  amplify: (config) => ipcRenderer.invoke('amplify', config),
  startAutomation: (config) => ipcRenderer.invoke('start-automation', config),
  stopAll: () => ipcRenderer.invoke('stop-all'),
  openScreenshotFolder: () => ipcRenderer.invoke('open-screenshot-folder'),

  // Events
  onLog: (cb) => ipcRenderer.on('log', (_, log) => cb(log)),
  onStatus: (cb) => ipcRenderer.on('status', (_, s) => cb(s)),

  // OAuth
  saveOAuthCredentials: (creds) => ipcRenderer.invoke('save-oauth-credentials', creds),
  connectFacebook: () => ipcRenderer.invoke('connect-facebook'),
  connectTwitter:  () => ipcRenderer.invoke('connect-twitter'),
  connectTikTok:   () => ipcRenderer.invoke('connect-tiktok'),
  connectYoutube:  () => ipcRenderer.invoke('connect-youtube'),
  connectThreads:  () => ipcRenderer.invoke('connect-threads'),
  getOAuthLink: (platform) => ipcRenderer.invoke('get-oauth-link', platform),
  getOAuthAccounts: () => ipcRenderer.invoke('get-oauth-accounts'),
  deleteOAuthAccount: (id) => ipcRenderer.invoke('delete-oauth-account', id),
  onOAuthResult: (cb) => ipcRenderer.on('oauth-result', (_, result) => cb(result)),

  // Bulk Post (queue)
  submitBulkPost: (data) => ipcRenderer.invoke('submit-bulk-post', data),
  pollPostTargets: (ids)  => ipcRenderer.invoke('poll-post-targets', ids),
  uploadMedia: (filePath) => ipcRenderer.invoke('upload-media', filePath),
  openExternal: (url) => shell.openExternal(url),
  generateContent:     (data)    => ipcRenderer.invoke('generate-content', data),
  scrapeNews:          (cfg)     => ipcRenderer.invoke('scrape-news', cfg),
  scrapeTrends:        ()        => ipcRenderer.invoke('scrape-trends'),
  analyzeSentiment:    (data)    => ipcRenderer.invoke('analyze-sentiment', data),
  generateImagenBroll: (data)    => ipcRenderer.invoke('generate-imagen-broll', data),
  downloadBrollImage:  (data)    => ipcRenderer.invoke('download-broll-image', data),
  getYoutubeTrends:    (data)    => ipcRenderer.invoke('get-youtube-trends', data),
});
