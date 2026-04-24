'use strict';

const path                       = require('path');
const fs                         = require('fs').promises;
const { dialog }                 = require('electron');
const { atomicWriteFile }        = require('../main/storage');
const { getMainWindow }          = require('../main/state');

function register(ipcMain) {

  ipcMain.handle('export-text', async (event, { content, defaultName }) => {
    if (typeof content !== 'string' || typeof defaultName !== 'string')
      return { success: false, error: 'Invalid params' };
    try {
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Export Description', defaultPath: defaultName,
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
      });
      if (result.canceled) return { success: false, canceled: true };
      await atomicWriteFile(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('export-markdown', async (event, { content, defaultName }) => {
    if (typeof content !== 'string' || typeof defaultName !== 'string')
      return { success: false, error: 'Invalid params' };
    try {
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Export as Markdown', defaultPath: defaultName,
        filters: [{ name: 'Markdown Files', extensions: ['md'] }],
      });
      if (result.canceled) return { success: false, canceled: true };
      await atomicWriteFile(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('export-json', async (event, { content, defaultName }) => {
    if (typeof content !== 'string' || typeof defaultName !== 'string')
      return { success: false, error: 'Invalid params' };
    try {
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Export as JSON', defaultPath: defaultName,
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (result.canceled) return { success: false, canceled: true };
      await atomicWriteFile(result.filePath, content, 'utf-8');
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('export-csv', async (event, { content, defaultName }) => {
    if (typeof content !== 'string' || typeof defaultName !== 'string')
      return { success: false, error: 'Invalid params' };
    try {
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Export as CSV', defaultPath: defaultName,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      });
      if (result.canceled) return { success: false, canceled: true };
      await atomicWriteFile(result.filePath, content, 'utf-8');
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('select-image-file', async (event, options = {}) => {
    const filters    = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }];
    const properties = options.multiple ? ['openFile', 'multiSelections'] : ['openFile'];
    const result     = await dialog.showOpenDialog(getMainWindow(), { properties, filters });
    if (result.canceled || !result.filePaths.length) return null;
    const files = await Promise.all(result.filePaths.map(async (filePath) => {
      const buffer   = await fs.readFile(filePath);
      const ext      = path.extname(filePath).toLowerCase().slice(1);
      const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
      const mimeType = mimeMap[ext] || 'image/jpeg';
      return { name: path.basename(filePath), type: mimeType, size: buffer.length, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` };
    }));
    return options.multiple ? files : files[0];
  });

  ipcMain.handle('show-message-box', async (event, options) => {
    if (typeof options !== 'object' || !Array.isArray(options.buttons)) return { response: 2 };
    try {
      return await dialog.showMessageBox(getMainWindow(), {
        type:      options.type || 'question',
        buttons:   options.buttons.slice(0, 5).map(String),
        defaultId: typeof options.defaultId === 'number' ? options.defaultId : 0,
        title:     String(options.title   || '').slice(0, 100),
        message:   String(options.message || '').slice(0, 500),
      });
    } catch { return { response: 2 }; }
  });
}

module.exports = { register };
