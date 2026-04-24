'use strict';

const SCHEMA_VERSION = 4;

/**
 * Migrates an electron-store instance from its current schema version up to targetVersion.
 * Migration steps are additive and idempotent — they only fill in missing fields.
 * Returns { migrated: boolean, from: number, to: number }.
 */
function migrateStore(store, targetVersion = SCHEMA_VERSION) {
  const currentVersion = store.get('schemaVersion', 1);

  if (currentVersion >= targetVersion) {
    return { migrated: false, from: currentVersion, to: targetVersion };
  }

  console.log(`Migrating schema v${currentVersion} → v${targetVersion}`);

  // Snapshot the full store before making any changes
  store.set('schemaBackup', store.store);

  if (currentVersion < 2 && targetVersion >= 2) {
    // v1 → v2: defaultModel added to settings
    const s = store.get('settings', {});
    if (!('defaultModel' in s)) {
      s.defaultModel = null;
      store.set('settings', s);
    }
  }

  if (currentVersion < 3 && targetVersion >= 3) {
    // v2 → v3: showOnboarding and concurrency added to settings
    const s = store.get('settings', {});
    if (!('showOnboarding' in s)) s.showOnboarding = true;
    if (!('concurrency' in s)) s.concurrency = 2;
    store.set('settings', s);
  }

  if (currentVersion < 4 && targetVersion >= 4) {
    // v3 → v4: per-provider stats breakdown
    const stats = store.get('stats', {});
    if (!stats.byProvider) {
      stats.byProvider = {
        openai:    { images: 0, cost: 0, tokens: 0 },
        anthropic: { images: 0, cost: 0, tokens: 0 },
        google:    { images: 0, cost: 0, tokens: 0 }
      };
      store.set('stats', stats);
    }
    // Note: legacy encrypted_api_key migration (to per-provider keys) is handled
    // at runtime in main.js via getApiKeyForProvider(), which needs safeStorage.
  }

  store.set('schemaVersion', targetVersion);
  return { migrated: true, from: currentVersion, to: targetVersion };
}

module.exports = { migrateStore, SCHEMA_VERSION };
