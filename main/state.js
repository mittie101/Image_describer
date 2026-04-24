'use strict';

// Shared mutable state that is set after app.whenReady().
// Exposed via getters/setters so modules always read the current value.

let _mainWindow         = null;
let _historyImagesDir   = null;
let _batchQueueImagesDir = null;

const activeRequests   = new Map(); // requestId -> AbortController
const providerCooldowns = new Map(); // provider  -> { until: timestamp }

const ipcRateLimits = new Map(); // channel -> { count, windowStart }

module.exports = {
  getMainWindow:          ()  => _mainWindow,
  setMainWindow:          (w) => { _mainWindow = w; },

  getHistoryImagesDir:    ()  => _historyImagesDir,
  setHistoryImagesDir:    (d) => { _historyImagesDir = d; },

  getBatchQueueImagesDir: ()  => _batchQueueImagesDir,
  setBatchQueueImagesDir: (d) => { _batchQueueImagesDir = d; },

  activeRequests,
  providerCooldowns,
  ipcRateLimits,
};
