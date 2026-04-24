/**
 * src/services/api.js
 * Single point of contact for all IPC calls to the main process.
 * Keeps renderer code free of raw window.electronAPI references.
 */

'use strict';

/* eslint-disable no-undef */ // window is the global in renderer context

const api = {
  // ---- Settings ----
  getSettings: ()         => window.electronAPI.getSettings(),
  saveSettings: (s)       => window.electronAPI.saveSettings(s),

  // ---- API Keys ----
  hasApiKey: ()                    => window.electronAPI.hasApiKey(),
  setApiKey: (key)                 => window.electronAPI.setApiKey(key),
  deleteApiKey: ()                 => window.electronAPI.deleteApiKey(),
  getApiProvider: ()               => window.electronAPI.getApiProvider(),
  testApiKey: (key)                => window.electronAPI.testApiKey(key),
  getProviderStatus: ()            => window.electronAPI.getProviderStatus(),
  setApiKeyForProvider: (p, k)     => window.electronAPI.setApiKeyForProvider(p, k),
  deleteApiKeyForProvider: (p)     => window.electronAPI.deleteApiKeyForProvider(p),

  // ---- Models ----
  getAvailableModels: ()           => window.electronAPI.getAvailableModels(),
  refreshModelPricing: (url)       => window.electronAPI.refreshModelPricing(url),

  // ---- Generation ----
  generateDescription: (params)        => window.electronAPI.generateDescription(params),
  generateRedbubblePitch: (params)     => window.electronAPI.generateRedbubblePitch(params),
  generateEtsyListing: (params)        => window.electronAPI.generateEtsyListing(params),
  cancelRequest: (id)                  => window.electronAPI.cancelRequest(id),
  onStreamChunk: (cb)                  => window.electronAPI.onStreamChunk(cb),

  // ---- History ----
  getHistory: ()                   => window.electronAPI.getHistory(),
  saveHistoryItem: (item)          => window.electronAPI.saveHistoryItem(item),
  deleteHistoryItem: (id)          => window.electronAPI.deleteHistoryItem(id),
  clearHistory: ()                 => window.electronAPI.clearHistory(),
  getHistoryImage: (p)             => window.electronAPI.getHistoryImage(p),
  tagHistoryItem: (id, tags)       => window.electronAPI.tagHistoryItem(id, tags),
  exportHistory: ()                => window.electronAPI.exportHistory(),
  importHistory: ()                => window.electronAPI.importHistory(),

  // ---- Stats ----
  getStats: ()                     => window.electronAPI.getStats(),
  updateStats: (delta)             => window.electronAPI.updateStats(delta),

  // ---- Templates ----
  getTemplates: ()                 => window.electronAPI.getTemplates(),
  saveTemplate: (t)                => window.electronAPI.saveTemplate(t),
  deleteTemplate: (name)           => window.electronAPI.deleteTemplate(name),

  // ---- Batch Queue ----
  saveBatchQueue: (items)          => window.electronAPI.saveBatchQueue(items),
  getBatchQueue: ()                => window.electronAPI.getBatchQueue(),
  clearBatchQueue: ()              => window.electronAPI.clearBatchQueue(),

  // ---- Export ----
  exportText: (p)                  => window.electronAPI.exportText(p),
  exportMarkdown: (p)              => window.electronAPI.exportMarkdown(p),
  exportJson: (p)                  => window.electronAPI.exportJson(p),
  exportCsv: (p)                   => window.electronAPI.exportCsv(p),

  // ---- Diagnostics ----
  getDiagnostics: ()               => window.electronAPI.getDiagnostics(),
  exportDiagnostics: ()            => window.electronAPI.exportDiagnostics(),

  // ---- File selection ----
  selectImageFile: (opts)          => window.electronAPI.selectImageFile(opts),

  // ---- Navigation ----
  loadMainApp: ()                  => window.electronAPI.loadMainApp(),
  loadSetup: ()                    => window.electronAPI.loadSetup(),
  openExternal: (url)              => window.electronAPI.openExternal(url),
  showMessageBox: (opts)           => window.electronAPI.showMessageBox(opts),

  // ---- Auto-updater ----
  onUpdateAvailable: (cb)          => window.electronAPI.onUpdateAvailable(cb),
  onUpdateDownloaded: (cb)         => window.electronAPI.onUpdateDownloaded(cb),
  onUpdateError: (cb)              => window.electronAPI.onUpdateError(cb),
  onProviderCooldown: (cb)         => window.electronAPI.onProviderCooldown(cb),
  installUpdate: ()                => window.electronAPI.installUpdate(),
};
