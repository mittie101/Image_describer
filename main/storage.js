'use strict';

const Store  = require('electron-store');
const path   = require('path');
const fs     = require('fs').promises;
const { createLogger }          = require('../src/logger');
const { migrateStore, SCHEMA_VERSION } = require('../src/migrateStore');

const log = createLogger('storage');

/** Write data atomically: write to .tmp then rename to avoid partial writes on crash. */
async function atomicWriteFile(finalPath, data, encoding = undefined) {
  const tmpPath = finalPath + '.tmp';
  await fs.writeFile(tmpPath, data, encoding);
  await fs.rename(tmpPath, finalPath);
}

let store;
try {
  store = new Store();
  const result = migrateStore(store);
  if (result.migrated) log.info('Schema migrated', result);
} catch (error) {
  log.error('Corrupted config, resetting', { message: error.message });
  try {
    const { app } = require('electron');
    require('fs').unlinkSync(path.join(app.getPath('userData'), 'config.json'));
  } catch (_) {}
  store = new Store();
  store.set('schemaVersion', SCHEMA_VERSION);
}

module.exports = { store, atomicWriteFile };
