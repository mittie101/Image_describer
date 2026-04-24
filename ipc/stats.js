'use strict';

const { store }      = require('../main/storage');
const { PROVIDERS, DEFAULT_STATS } = require('../main/config');

function register(ipcMain) {

  ipcMain.handle('get-stats', async () => {
    const stats = store.get('stats', DEFAULT_STATS);
    if (!stats.byProvider) {
      stats.byProvider = {
        openai:    { images: 0, cost: 0, tokens: 0 },
        anthropic: { images: 0, cost: 0, tokens: 0 },
        google:    { images: 0, cost: 0, tokens: 0 },
      };
    }
    return stats;
  });

  ipcMain.handle('update-stats', async (event, delta) => {
    if (typeof delta !== 'object' || delta === null) return { success: false };
    const images   = Math.max(0, Number(delta.images) || 0);
    const cost     = Math.max(0, Number(delta.cost)   || 0);
    const tokens   = Math.max(0, Number(delta.tokens) || 0);
    const provider = PROVIDERS.includes(delta.provider) ? delta.provider : null;

    const stats = store.get('stats', DEFAULT_STATS);
    if (!stats.byProvider) stats.byProvider = {
      openai:    { images: 0, cost: 0, tokens: 0 },
      anthropic: { images: 0, cost: 0, tokens: 0 },
      google:    { images: 0, cost: 0, tokens: 0 },
    };

    stats.totalImages += images;
    stats.totalCost   += cost;
    stats.totalTokens += tokens;
    if (provider) {
      stats.byProvider[provider].images += images;
      stats.byProvider[provider].cost   += cost;
      stats.byProvider[provider].tokens += tokens;
    }
    store.set('stats', stats);
    return { success: true };
  });
}

module.exports = { register };
