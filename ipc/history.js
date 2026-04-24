'use strict';

const path                          = require('path');
const fs                            = require('fs').promises;
const { createLogger }              = require('../src/logger');
const { store, atomicWriteFile }    = require('../main/storage');
const { getHistoryImagesDir }       = require('../main/state');
const { validateHistoryItem, validateImagePath } = require('../src/validators');
const { checkIpcRateLimit }         = require('../main/rate-limit');

const log = createLogger('history');
const MAX_HISTORY_ITEMS = 500;

async function deleteHistoryImageFile(imagePath) {
  const dir = getHistoryImagesDir();
  if (!imagePath || !validateImagePath(imagePath) || !dir) return;
  try { await fs.unlink(path.join(dir, imagePath)); } catch (_) {}
}

function register(ipcMain) {

  ipcMain.handle('get-history', async () => {
    if (!checkIpcRateLimit('get-history', 10)) return [];
    try {
      const history = store.get('history', []);
      if (history.length > MAX_HISTORY_ITEMS) {
        const removed = history.splice(MAX_HISTORY_ITEMS);
        for (const item of removed) await deleteHistoryImageFile(item.imagePath);
        store.set('history', history);
      }
      return history;
    } catch (error) {
      log.error('Failed to load history', { message: error.message });
      store.set('history', []);
      return [];
    }
  });

  ipcMain.handle('save-history-item', async (event, item) => {
    if (!validateHistoryItem(item)) return { success: false, error: 'Invalid history item' };
    const dir = getHistoryImagesDir();
    let imagePath = null;

    if (item.image && typeof item.image === 'string' && item.image.startsWith('data:image/')) {
      try {
        const match = item.image.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match && dir) {
          const ext  = match[1] === 'jpeg' ? 'jpg' : match[1];
          imagePath  = `${item.id}.${ext}`;
          await atomicWriteFile(path.join(dir, imagePath), Buffer.from(match[2], 'base64'));
        }
      } catch (err) {
        log.warn('Failed to save history image to disk', { message: err.message });
        imagePath = null;
      }
    }

    const metadata = {
      id: item.id, timestamp: item.timestamp, description: item.description,
      style: item.style, detail: item.detail, model: item.model,
      provider: item.provider || null, cost: item.cost,
      imagePath, imageAvailable: imagePath !== null,
    };

    const history = store.get('history', []);
    history.unshift(metadata);
    if (history.length > MAX_HISTORY_ITEMS) {
      const removed = history.splice(MAX_HISTORY_ITEMS);
      for (const old of removed) await deleteHistoryImageFile(old.imagePath);
    }
    store.set('history', history);
    return { success: true };
  });

  ipcMain.handle('get-history-image', async (event, imagePath) => {
    const dir = getHistoryImagesDir();
    if (!validateImagePath(imagePath) || !dir) return null;
    try {
      const data     = await fs.readFile(path.join(dir, imagePath));
      const ext      = path.extname(imagePath).slice(1).toLowerCase();
      const mimeType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      return `data:${mimeType};base64,${data.toString('base64')}`;
    } catch { return null; }
  });

  ipcMain.handle('delete-history-item', async (event, id) => {
    if (typeof id !== 'string' || id.length > 100) return { success: false, error: 'Invalid id' };
    const history = store.get('history', []);
    const item    = history.find(h => h.id === id);
    if (item) await deleteHistoryImageFile(item.imagePath);
    store.set('history', history.filter(h => h.id !== id));
    return { success: true };
  });

  ipcMain.handle('clear-history', async () => {
    const history = store.get('history', []);
    for (const item of history) await deleteHistoryImageFile(item.imagePath);
    store.set('history', []);
    return { success: true };
  });

  ipcMain.handle('export-history', async () => {
    const { dialog } = require('electron');
    const history = store.get('history', []);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export History',
      defaultPath: `history-export-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    try {
      await atomicWriteFile(filePath, Buffer.from(JSON.stringify(history, null, 2), 'utf8'));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import-history', async () => {
    const { dialog } = require('electron');
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import History',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { success: false, canceled: true };
    try {
      const raw      = await fs.readFile(filePaths[0], 'utf8');
      const imported = JSON.parse(raw);
      if (!Array.isArray(imported)) return { success: false, error: 'Invalid history file format.' };
      const valid = imported.filter(item =>
        item && typeof item.id === 'string' && typeof item.description === 'string'
      );
      const existing   = store.get('history', []);
      const existingIds = new Set(existing.map(h => h.id));
      const newItems = valid.filter(h => !existingIds.has(h.id)).map(h => ({
        id: h.id, timestamp: h.timestamp || Date.now(), description: h.description,
        style: h.style || 'photorealistic', detail: h.detail || 2,
        model: h.model || null, provider: h.provider || null, cost: h.cost || 0,
        imagePath: null, imageAvailable: false,
      }));
      const merged = [...newItems, ...existing].slice(0, MAX_HISTORY_ITEMS);
      store.set('history', merged);
      return { success: true, count: newItems.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tag-history-item', async (event, { id, tags }) => {
    if (typeof id !== 'string' || id.length > 100) return { success: false, error: 'Invalid id' };
    if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || t.length > 50)) {
      return { success: false, error: 'Invalid tags' };
    }
    const history = store.get('history', []);
    const item = history.find(h => h.id === id);
    if (!item) return { success: false, error: 'Item not found' };
    item.tags = tags.slice(0, 10).map(t => t.trim().toLowerCase()).filter(Boolean);
    store.set('history', history);
    return { success: true };
  });
}

module.exports = { register };
