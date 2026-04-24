'use strict';

const { safeStorage }      = require('electron');
const { createLogger }     = require('../src/logger');
const { PROVIDERS }        = require('./config');
const { store }            = require('./storage');
const { detectApiProvider } = require('./providers');

const log = createLogger('api-keys');

function providerKeyName(provider) {
  return `encrypted_key_${provider}`;
}

function hasApiKeyForProvider(provider) {
  return !!store.get(providerKeyName(provider));
}

function hasApiKey() {
  if (store.get('encrypted_api_key')) return true;
  return PROVIDERS.some(p => hasApiKeyForProvider(p));
}

function getApiKeyForProvider(provider) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    let encrypted = store.get(providerKeyName(provider));
    if (!encrypted) {
      // Migrate legacy key if it matches this provider
      const legacyEncrypted = store.get('encrypted_api_key');
      if (legacyEncrypted) {
        try {
          const decrypted = safeStorage.decryptString(Buffer.from(legacyEncrypted, 'hex'));
          if (detectApiProvider(decrypted) === provider) {
            store.set(providerKeyName(provider), legacyEncrypted);
            store.delete('encrypted_api_key');
            return decrypted;
          }
        } catch (_) {}
      }
      return null;
    }
    return safeStorage.decryptString(Buffer.from(encrypted, 'hex'));
  } catch (error) {
    log.error('Failed to decrypt API key', { provider, message: error.message });
    return null;
  }
}

function setApiKeyForProvider(provider, apiKey) {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS-level encryption not available');
    const encrypted = safeStorage.encryptString(apiKey);
    store.set(providerKeyName(provider), encrypted.toString('hex'));
    return true;
  } catch (error) {
    log.error('Failed to encrypt API key', { provider, message: error.message });
    return false;
  }
}

function deleteApiKeyForProvider(provider) {
  try { store.delete(providerKeyName(provider)); return true; }
  catch { return false; }
}

function getApiKey() {
  for (const p of PROVIDERS) {
    const key = getApiKeyForProvider(p);
    if (key) return key;
  }
  return null;
}

function deleteApiKey() {
  try {
    store.delete('encrypted_api_key');
    PROVIDERS.forEach(p => store.delete(providerKeyName(p)));
    return true;
  } catch { return false; }
}

module.exports = {
  providerKeyName, hasApiKeyForProvider, hasApiKey,
  getApiKeyForProvider, setApiKeyForProvider,
  deleteApiKeyForProvider, getApiKey, deleteApiKey,
};
