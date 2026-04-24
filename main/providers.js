'use strict';

const { createLogger }                        = require('../src/logger');
const { PROVIDERS, PROVIDER_ENDPOINTS }       = require('./config');
const { store }                               = require('./storage');
const { providerCooldowns, getMainWindow }    = require('./state');

const log = createLogger('providers');

function detectApiProvider(apiKey) {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-'))     return 'openai';
  if (apiKey.startsWith('AIzaSy'))  return 'google';
  return 'unknown';
}

function buildConnectSrc() {
  const origins = ["'self'", ...Object.values(PROVIDER_ENDPOINTS)];
  const customUrl = store.get('settings', {}).modelPricingUrl;
  if (customUrl) {
    try {
      const origin = new URL(customUrl).origin;
      if (origin && !origins.includes(origin)) origins.push(origin);
    } catch (_) {}
  }
  return origins.join(' ');
}

/** Returns ms remaining on a provider cooldown, or 0 if clear. */
function getProviderCooldown(provider) {
  const entry = providerCooldowns.get(provider);
  if (!entry) return 0;
  const remaining = entry.until - Date.now();
  if (remaining <= 0) { providerCooldowns.delete(provider); return 0; }
  return remaining;
}

/** Set a cooldown on a provider after persistent 429s. */
function setProviderCooldown(provider, ms) {
  providerCooldowns.set(provider, { until: Date.now() + ms });
  log.warn('Provider cooldown set', { provider, cooldownMs: ms });
  getMainWindow()?.webContents.send('provider-cooldown', { provider, until: Date.now() + ms });
}

module.exports = { detectApiProvider, buildConnectSrc, getProviderCooldown, setProviderCooldown };
