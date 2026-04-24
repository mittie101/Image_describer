'use strict';

const { ipcMain }       = require('electron');
const { autoUpdater }   = require('electron-updater');
const { createLogger }  = require('../src/logger');
const { getMainWindow } = require('./state');

const log = createLogger('updater');

function registerUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available', { version: info.version });
    getMainWindow()?.webContents.send('update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('App is up to date');
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded', { version: info.version });
    getMainWindow()?.webContents.send('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error', { message: err.message });
    getMainWindow()?.webContents.send('update-error', { message: err.message });
  });

  ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());
}

module.exports = { registerUpdaterEvents };
