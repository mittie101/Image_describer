'use strict';

const { store }              = require('../main/storage');
const { validateSettings }   = require('../src/validators');

function register(ipcMain) {
  ipcMain.handle('get-settings', async () => {
    return store.get('settings', {
      autoCompress: true, compressionQuality: 0.8, maxImageSize: 1536,
      exportFormat: 'txt', concurrency: 2, defaultModel: null,
    });
  });

  ipcMain.handle('save-settings', async (event, settings) => {
    if (!validateSettings(settings)) return { success: false, error: 'Invalid settings' };
    store.set('settings', settings);
    return { success: true };
  });
}

module.exports = { register };
