const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // API Key Management
  hasApiKey: () => ipcRenderer.invoke('has-api-key'),
  setApiKey: (apiKey) => ipcRenderer.invoke('set-api-key', apiKey),
  setApiKeyForProvider: (provider, apiKey) => ipcRenderer.invoke('set-api-key-for-provider', { provider, apiKey }),
  deleteApiKey: () => ipcRenderer.invoke('delete-api-key'),
  deleteApiKeyForProvider: (provider) => ipcRenderer.invoke('delete-api-key-for-provider', provider),
  testApiKey: (apiKey) => ipcRenderer.invoke('test-api-key', apiKey),
  getApiProvider: () => ipcRenderer.invoke('get-api-provider'),
  getProviderStatus: () => ipcRenderer.invoke('get-provider-status'),
  getAvailableModels: () => ipcRenderer.invoke('get-available-models'),
  refreshModelPricing: (url) => ipcRenderer.invoke('refresh-model-pricing', { url }),

  // Navigation
  loadMainApp: () => ipcRenderer.invoke('load-main-app'),
  loadSetup: () => ipcRenderer.invoke('load-setup'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // AI Generation
  generateDescription: (params) => ipcRenderer.invoke('generate-description', params),
  generateRedbubblePitch: (params) => ipcRenderer.invoke('generate-redbubble-pitch', params),
  generateEtsyListing: (params) => ipcRenderer.invoke('generate-etsy-listing', params),
  cancelRequest: (requestId) => ipcRenderer.invoke('cancel-request', requestId),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveHistoryItem: (item) => ipcRenderer.invoke('save-history-item', item),
  getHistoryImage: (imagePath) => ipcRenderer.invoke('get-history-image', imagePath),
  deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  exportHistory: () => ipcRenderer.invoke('export-history'),
  importHistory: () => ipcRenderer.invoke('import-history'),
  tagHistoryItem: (id, tags) => ipcRenderer.invoke('tag-history-item', { id, tags }),

  // Batch Queue Persistence
  saveBatchQueue: (items) => ipcRenderer.invoke('save-batch-queue', items),
  getBatchQueue: () => ipcRenderer.invoke('get-batch-queue'),
  clearBatchQueue: () => ipcRenderer.invoke('clear-batch-queue'),

  // Templates
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  saveTemplate: (template) => ipcRenderer.invoke('save-template', template),
  deleteTemplate: (id) => ipcRenderer.invoke('delete-template', id),

  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),
  updateStats: (delta) => ipcRenderer.invoke('update-stats', delta),

  // Export
  exportText: (params) => ipcRenderer.invoke('export-text', params),
  exportMarkdown: (params) => ipcRenderer.invoke('export-markdown', params),
  exportJson: (params) => ipcRenderer.invoke('export-json', params),
  exportCsv: (params) => ipcRenderer.invoke('export-csv', params),
  selectImageFile: (options) => ipcRenderer.invoke('select-image-file', options),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

  // Diagnostics
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),

  // Auto-updater — returns unsubscribe disposer to prevent listener accumulation
  onUpdateAvailable: (callback) => {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },
  onUpdateError: (callback) => {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },
  onProviderCooldown: (callback) => {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('provider-cooldown', handler);
    return () => ipcRenderer.removeListener('provider-cooldown', handler);
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onStreamChunk: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('stream-chunk', handler);
    return () => ipcRenderer.removeListener('stream-chunk', handler);
  },
});
