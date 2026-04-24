'use strict';

function validateSettings(settings) {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return false;
  const allowed = ['autoCompress', 'compressionQuality', 'maxImageSize', 'exportFormat', 'concurrency', 'defaultModel', 'showOnboarding'];
  for (const key of Object.keys(settings)) {
    if (!allowed.includes(key)) delete settings[key];
  }
  if ('autoCompress' in settings && typeof settings.autoCompress !== 'boolean') return false;
  if ('showOnboarding' in settings && typeof settings.showOnboarding !== 'boolean') return false;
  if ('compressionQuality' in settings) {
    const q = Number(settings.compressionQuality);
    if (isNaN(q) || q < 0 || q > 1) return false;
    settings.compressionQuality = q;
  }
  if ('maxImageSize' in settings) {
    const s = Number(settings.maxImageSize);
    if (isNaN(s) || s < 256 || s > 4096) return false;
    settings.maxImageSize = Math.floor(s);
  }
  if ('exportFormat' in settings && !['txt', 'json', 'csv', 'md'].includes(settings.exportFormat)) return false;
  if ('concurrency' in settings) {
    const c = Number(settings.concurrency);
    if (isNaN(c) || c < 1 || c > 5) return false;
    settings.concurrency = Math.floor(c);
  }
  if ('defaultModel' in settings && settings.defaultModel !== null) {
    if (typeof settings.defaultModel !== 'string' || settings.defaultModel.length > 100) return false;
  }
  return true;
}

function validateHistoryItem(item) {
  if (typeof item !== 'object' || item === null) return false;
  if (typeof item.id !== 'string' || item.id.length > 100) return false;
  if (typeof item.timestamp !== 'number' || item.timestamp < 0 || item.timestamp > Date.now() + 86400000) return false;
  if (typeof item.description !== 'string' || item.description.length > 20000) return false;
  if (typeof item.style !== 'string' || item.style.length > 100) return false;
  if (typeof item.detail !== 'number' || ![1, 2, 3].includes(item.detail)) return false;
  if (typeof item.model !== 'string' || item.model.length > 100) return false;
  if (typeof item.cost !== 'number' || item.cost < 0) return false;
  return true;
}

function validateTemplate(template) {
  if (typeof template !== 'object' || template === null) return false;
  if (typeof template.name !== 'string' || template.name.length === 0 || template.name.length > 50) return false;
  if (typeof template.style !== 'string' || template.style.length > 100) return false;
  if (typeof template.detail !== 'number' || ![1, 2, 3].includes(template.detail)) return false;
  return true;
}

function validateImagePath(imagePath) {
  if (typeof imagePath !== 'string') return false;
  if (imagePath.includes('..') || imagePath.includes('/') || imagePath.includes('\\')) return false;
  return /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(imagePath);
}

function validateBatchQueueItem(item) {
  if (typeof item !== 'object' || item === null) return false;
  if (typeof item.id !== 'string' || item.id.length > 100) return false;
  if (typeof item.filename !== 'string' || item.filename.length > 255) return false;
  return true;
}

module.exports = { validateSettings, validateHistoryItem, validateTemplate, validateImagePath, validateBatchQueueItem };
