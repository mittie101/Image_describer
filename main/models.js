'use strict';

const path             = require('path');
const fs               = require('fs').promises;
const { createLogger } = require('../src/logger');
const { atomicWriteFile } = require('./storage');

const log = createLogger('models');

const MODELS_DEFAULT_PATH = path.join(__dirname, '..', 'src', 'models.default.json');
let MODELS_USER_PATH = null; // set after app.whenReady
let MODEL_PRICING    = {};

function setModelsUserPath(p) { MODELS_USER_PATH = p; }

async function loadModelPricing() {
  if (MODELS_USER_PATH) {
    try {
      const raw    = await fs.readFile(MODELS_USER_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.models === 'object') {
        MODEL_PRICING = parsed.models;
        log.info('Model pricing loaded from user file', { count: Object.keys(MODEL_PRICING).length });
        return;
      }
    } catch (_) {}
  }
  try {
    const raw    = await fs.readFile(MODELS_DEFAULT_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    MODEL_PRICING = parsed.models || {};
    log.info('Model pricing loaded from defaults', { count: Object.keys(MODEL_PRICING).length });
  } catch (err) {
    log.error('Failed to load model pricing defaults', { message: err.message });
    MODEL_PRICING = {};
  }
}

async function seedUserModelsFile() {
  if (!MODELS_USER_PATH) return;
  try {
    await fs.access(MODELS_USER_PATH);
  } catch (_) {
    try {
      const defaults = await fs.readFile(MODELS_DEFAULT_PATH);
      await atomicWriteFile(MODELS_USER_PATH, defaults);
      log.info('Seeded user models file from defaults');
    } catch (err) {
      log.warn('Failed to seed user models file', { message: err.message });
    }
  }
}

async function refreshModelPricingFromRemote(url) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);
    const response   = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = await response.json();
    if (!parsed || typeof parsed.models !== 'object') throw new Error('Invalid format');
    if (MODELS_USER_PATH) {
      await atomicWriteFile(MODELS_USER_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
    }
    MODEL_PRICING = parsed.models;
    log.info('Model pricing refreshed from remote', { url, count: Object.keys(MODEL_PRICING).length });
    return { success: true, count: Object.keys(MODEL_PRICING).length };
  } catch (err) {
    log.warn('Failed to refresh model pricing from remote', { message: err.message });
    return { success: false, error: err.message };
  }
}

function getPricing(model) { return MODEL_PRICING[model] || null; }
function formatModelName(modelId) { return MODEL_PRICING[modelId]?.name || modelId; }
function getModelPricing() { return MODEL_PRICING; }

module.exports = {
  setModelsUserPath, loadModelPricing, seedUserModelsFile,
  refreshModelPricingFromRemote, getPricing, formatModelName, getModelPricing,
};
