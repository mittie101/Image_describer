'use strict';

const { app, dialog, shell } = require('electron');
const { atomicWriteFile }    = require('../main/storage');
const { store }              = require('../main/storage');
const { getMainWindow }      = require('../main/state');
const { PROVIDERS }          = require('../main/config');
const { hasApiKeyForProvider } = require('../main/api-keys');
const { activeRequests }     = require('../main/state');

function buildDiagnostics() {
  const settings      = store.get('settings', {});
  const stats         = store.get('stats', {});
  const providerStatus = {};
  for (const p of PROVIDERS) providerStatus[p] = hasApiKeyForProvider(p);
  return {
    appVersion:      app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion:     process.versions.node,
    platform:        process.platform,
    arch:            process.arch,
    providerStatus, settings, stats,
    historyCount:    store.get('history',   []).length,
    templateCount:   store.get('templates', []).length,
    activeRequests:  activeRequests.size,
  };
}

function register(ipcMain) {

  ipcMain.handle('load-main-app', async () => {
    const win = getMainWindow();
    if (!win) return { success: false, error: 'Window not ready' };
    win.loadFile('src/index.html');
    return { success: true };
  });

  ipcMain.handle('load-setup', async () => {
    const win = getMainWindow();
    if (!win) return { success: false, error: 'Window not ready' };
    win.loadFile('src/setup.html');
    return { success: true };
  });

  ipcMain.handle('open-external', async (event, url) => {
    const allowedUrls = [
      'https://platform.openai.com/api-keys',
      'https://platform.openai.com/docs/pricing',
      'https://openai.com',
      'https://console.anthropic.com/settings/keys',
      'https://console.anthropic.com',
      'https://aistudio.google.com/app/apikey',
      'https://aistudio.google.com',
    ];
    try {
      const parsedUrl = new URL(url);
      const allowed   = allowedUrls.some(a => {
        const p = new URL(a);
        return parsedUrl.protocol === p.protocol &&
               parsedUrl.hostname === p.hostname &&
               parsedUrl.pathname === p.pathname;
      });
      if (!allowed) return { success: false, error: 'URL not allowed' };
      await shell.openExternal(url);
      return { success: true };
    } catch { return { success: false, error: 'Invalid URL' }; }
  });

  ipcMain.handle('get-diagnostics', async () => buildDiagnostics());

  ipcMain.handle('export-diagnostics', async () => {
    try {
      const content = JSON.stringify(buildDiagnostics(), null, 2);
      const result  = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Export Diagnostics', defaultPath: `diagnostics-${Date.now()}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (result.canceled) return { success: false, canceled: true };
      await atomicWriteFile(result.filePath, content, 'utf-8');
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });
}

module.exports = { register, buildDiagnostics };
