'use strict';

const path                            = require('path');
const fs                              = require('fs').promises;
const { createLogger }                = require('../src/logger');
const { store, atomicWriteFile }      = require('../main/storage');
const { getBatchQueueImagesDir }      = require('../main/state');
const { validateBatchQueueItem }      = require('../src/validators');
const { checkIpcRateLimit }           = require('../main/rate-limit');

const log = createLogger('batch-ipc');

function register(ipcMain) {

  ipcMain.handle('save-batch-queue', async (event, items) => {
    if (!checkIpcRateLimit('save-batch-queue', 5)) return { success: false };
    if (!Array.isArray(items))      return { success: false, error: 'Invalid items' };
    const dir = getBatchQueueImagesDir();
    if (!dir) return { success: false, error: 'Batch queue directory unavailable' };

    const pending = items.filter(i => i.status === 'pending' || i.status === 'processing');
    const saved   = [];

    for (const item of pending) {
      if (!validateBatchQueueItem(item)) continue;
      let imagePath = null;
      if (item.dataUrl && item.dataUrl.startsWith('data:image/')) {
        try {
          const match = item.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (match) {
            const ext  = match[1] === 'jpeg' ? 'jpg' : match[1];
            imagePath  = `bq_${item.id}.${ext}`;
            await atomicWriteFile(path.join(dir, imagePath), Buffer.from(match[2], 'base64'));
          }
        } catch (err) {
          log.warn('Failed to save batch queue image', { message: err.message });
        }
      }
      saved.push({ id: item.id, filename: item.filename, imagePath, status: 'pending' });
    }

    store.set('savedBatchQueue', { items: saved, savedAt: Date.now() });
    return { success: true, count: saved.length };
  });

  ipcMain.handle('get-batch-queue', async () => {
    const saved = store.get('savedBatchQueue', null);
    if (!saved || !saved.items || saved.items.length === 0) return { items: [] };
    const dir      = getBatchQueueImagesDir();
    const restored = [];

    for (const item of saved.items) {
      let dataUrl = null;
      if (item.imagePath && dir) {
        try {
          const data     = await fs.readFile(path.join(dir, item.imagePath));
          const ext      = path.extname(item.imagePath).slice(1).toLowerCase();
          const mimeType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
          dataUrl = `data:${mimeType};base64,${data.toString('base64')}`;
        } catch (_) {}
      }
      restored.push({ id: item.id, filename: item.filename, dataUrl, status: 'pending', imagePath: item.imagePath });
    }

    return { items: restored, savedAt: saved.savedAt };
  });

  ipcMain.handle('clear-batch-queue', async () => {
    const saved = store.get('savedBatchQueue', null);
    const dir   = getBatchQueueImagesDir();
    if (saved && saved.items && dir) {
      for (const item of saved.items) {
        if (item.imagePath) {
          try { await fs.unlink(path.join(dir, item.imagePath)); } catch (_) {}
        }
      }
    }
    store.delete('savedBatchQueue');
    return { success: true };
  });
}

module.exports = { register };
