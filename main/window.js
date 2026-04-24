'use strict';

const { BrowserWindow } = require('electron');
const { autoUpdater }   = require('electron-updater');
const path              = require('path');
const { hasApiKey }     = require('./api-keys');
const { buildConnectSrc } = require('./providers');
const { setMainWindow } = require('./state');

function createWindow() {
  const win = new BrowserWindow({
    width:     1400,
    height:    900,
    minWidth:  1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      enableRemoteModule: false,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
    icon:            path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#0f0f0f',
    show:            false,
  });

  setMainWindow(win);

  win.once('ready-to-show', () => win.show());

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self'; " +
          "img-src 'self' data: blob:; " +
          `connect-src ${buildConnectSrc()}; ` +
          "font-src 'self';",
        ],
      },
    });
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  if (!hasApiKey()) {
    win.loadFile('src/setup.html');
  } else {
    win.loadFile('src/index.html');
  }

  if (require('electron').app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

module.exports = { createWindow };
