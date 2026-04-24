'use strict';

const { app, ipcMain }          = require('electron');
const { close: closeLogger }    = require('./src/logger');
const path                      = require('path');
const fs                        = require('fs').promises;

// ── Shared state & storage (imported early so modules share the same instance)
const { setHistoryImagesDir, setBatchQueueImagesDir } = require('./main/state');
const { seedUserModelsFile, loadModelPricing, setModelsUserPath } = require('./main/models');
const { createWindow }          = require('./main/window');
const { registerUpdaterEvents } = require('./main/updater');

// ── IPC domain registrations
const ipcApiKeys     = require('./ipc/api-keys');
const ipcGeneration  = require('./ipc/generation');
const ipcSettings    = require('./ipc/settings');
const ipcHistory     = require('./ipc/history');
const ipcBatch       = require('./ipc/batch');
const ipcTemplates   = require('./ipc/templates');
const ipcStats       = require('./ipc/stats');
const ipcExport      = require('./ipc/export');
const ipcDiagnostics = require('./ipc/diagnostics');

// ── Register all IPC handlers
ipcApiKeys.register(ipcMain);
ipcGeneration.register(ipcMain);
ipcSettings.register(ipcMain);
ipcHistory.register(ipcMain);
ipcBatch.register(ipcMain);
ipcTemplates.register(ipcMain);
ipcStats.register(ipcMain);
ipcExport.register(ipcMain);
ipcDiagnostics.register(ipcMain);
registerUpdaterEvents();

// ── App lifecycle
app.whenReady().then(async () => {
  const userData = app.getPath('userData');

  const historyDir = path.join(userData, 'history-images');
  const batchDir   = path.join(userData, 'batch-queue-images');
  const modelsPath = path.join(userData, 'models.json');

  try {
    await fs.mkdir(historyDir, { recursive: true });
    await fs.mkdir(batchDir,   { recursive: true });
    setHistoryImagesDir(historyDir);
    setBatchQueueImagesDir(batchDir);
  } catch (e) {
    require('./src/logger').createLogger('main').error('Could not create image directories', { message: e.message });
  }

  setModelsUserPath(modelsPath);
  await seedUserModelsFile();
  await loadModelPricing();

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  const { BrowserWindow } = require('electron');
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  closeLogger();
});
