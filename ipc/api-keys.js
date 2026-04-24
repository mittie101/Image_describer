'use strict';

const { PROVIDERS }                   = require('../main/config');
const { store }                       = require('../main/storage');
const { detectApiProvider }           = require('../main/providers');
const { getModelPricing }             = require('../main/models');
const {
  hasApiKey, hasApiKeyForProvider, setApiKeyForProvider,
  deleteApiKey, deleteApiKeyForProvider, getApiKeyForProvider,
} = require('../main/api-keys');

function register(ipcMain) {

  ipcMain.handle('has-api-key', async () => hasApiKey());

  ipcMain.handle('get-provider-status', async () => {
    const status = {};
    for (const p of PROVIDERS) {
      status[p] = hasApiKeyForProvider(p) || (() => {
        const { safeStorage } = require('electron');
        const legacy = store.get('encrypted_api_key');
        if (legacy) {
          try {
            const dec = safeStorage.decryptString(Buffer.from(legacy, 'hex'));
            return detectApiProvider(dec) === p;
          } catch { return false; }
        }
        return false;
      })();
    }
    return status;
  });

  ipcMain.handle('set-api-key', async (event, apiKey) => {
    const { safeStorage } = require('electron');
    if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 200)
      return { success: false, error: 'Invalid API key format' };
    if (!safeStorage.isEncryptionAvailable())
      return { success: false, error: 'OS-level encryption is not available on this system.' };
    const provider = detectApiProvider(apiKey);
    if (provider === 'unknown') return { success: false, error: 'Unknown API key format' };
    return { success: setApiKeyForProvider(provider, apiKey), provider };
  });

  ipcMain.handle('set-api-key-for-provider', async (event, { provider, apiKey }) => {
    const { safeStorage } = require('electron');
    if (!PROVIDERS.includes(provider)) return { success: false, error: 'Invalid provider' };
    if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 200)
      return { success: false, error: 'Invalid API key format' };
    if (!safeStorage.isEncryptionAvailable())
      return { success: false, error: 'OS-level encryption is not available.' };
    const detected = detectApiProvider(apiKey);
    if (detected !== 'unknown' && detected !== provider)
      return { success: false, error: `Key format does not match ${provider}` };
    return { success: setApiKeyForProvider(provider, apiKey) };
  });

  ipcMain.handle('delete-api-key', async () => ({ success: deleteApiKey() }));

  ipcMain.handle('delete-api-key-for-provider', async (event, provider) => {
    if (!PROVIDERS.includes(provider)) return { success: false, error: 'Invalid provider' };
    return { success: deleteApiKeyForProvider(provider) };
  });

  ipcMain.handle('test-api-key', async (event, apiKey) => {
    if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 200)
      return { success: false, error: 'Invalid API key format' };
    try {
      const provider   = detectApiProvider(apiKey);
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 10000);
      let response;
      if (provider === 'openai') {
        response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
        });
      } else if (provider === 'anthropic') {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }),
          signal: controller.signal,
        });
      } else if (provider === 'google') {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: controller.signal });
      } else {
        return { success: false, error: 'Unknown API key format' };
      }
      clearTimeout(timeout);
      if (response.ok) return { success: true, provider };
      const err = await response.json().catch(() => ({}));
      return { success: false, error: err.error?.message || 'Invalid API key' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-api-provider', async () => {
    const activeProviders = PROVIDERS.filter(p => !!getApiKeyForProvider(p));
    return { provider: activeProviders[0] || null, providers: activeProviders };
  });

  ipcMain.handle('get-available-models', async () => {
    const MODEL_PRICING = getModelPricing();
    const allModels = [];
    for (const provider of PROVIDERS) {
      const key = getApiKeyForProvider(provider);
      if (!key) continue;
      const models = Object.entries(MODEL_PRICING)
        .filter(([, info]) => info.provider === provider)
        .map(([modelId, info]) => ({
          id: modelId, name: info.name || modelId, provider,
          pricing:     `~$${(info.input / 1000).toFixed(4)}-$${(info.output / 1000).toFixed(4)} per 1K tokens`,
          inputPrice:  info.input,
          outputPrice: info.output,
        }));
      allModels.push(...models);
    }
    return { models: allModels };
  });

  ipcMain.handle('refresh-model-pricing', async (event, { url } = {}) => {
    const { store: s }                  = require('../main/storage');
    const { loadModelPricing, refreshModelPricingFromRemote, getModelPricing } = require('../main/models');
    const remoteUrl = url || s.get('settings', {}).modelPricingUrl || null;
    if (!remoteUrl) {
      await loadModelPricing();
      return { success: true, count: Object.keys(getModelPricing()).length, source: 'local' };
    }
    return refreshModelPricingFromRemote(remoteUrl);
  });
}

module.exports = { register };
