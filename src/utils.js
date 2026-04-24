// src/utils.js — Pure stateless utility functions
// Loaded before app.js; no dependencies on app state.

'use strict';

// ===== DEBOUNCE =====

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      clearTimeout(timeout);
      func(...args);
    }, wait);
  };
}

// ===== SVG ICON HELPER =====

function icon(id, label) {
  const ariaLabel = label ? ` aria-label="${label}"` : ' aria-hidden="true"';
  return `<svg class="icon"${ariaLabel}><use href="#icon-${id}"></use></svg>`;
}

// ===== ARIA ANNOUNCER =====

function announce(message) {
  const announcer = document.getElementById('ariaAnnouncer');
  if (!announcer) return;
  announcer.textContent = '';
  requestAnimationFrame(() => { announcer.textContent = message; });
}

// ===== DATA URL → FILE CONVERSION =====

/** Convert a base64 dataUrl returned from the main process into a browser File object
 *  so it can be passed to validateImageFile() and FileReader-based loaders unchanged. */
function dataUrlToFile(dataUrl, name, type) {
  const arr   = dataUrl.split(',');
  const bstr  = atob(arr[1]);
  let n        = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], name, { type });
}

// ===== IMAGE FILE VALIDATION =====

function validateImageFile(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Image too large. Maximum size is 10MB');
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type.toLowerCase())) throw new Error('Invalid image format. Supported: JPG, PNG, WebP');
  return true;
}

// ===== SMART FILENAME GENERATOR =====

function generateSmartFilename(text, extension = 'txt') {
  const words = text.trim().split(/\s+/).slice(0, 3).join('-');
  const sanitized = words.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  return `${sanitized}-${Date.now()}.${extension}`;
}

// ===== STATUS & NOTIFICATION =====

function showStatus(message, type) {
  const statusMsg = document.getElementById('statusMsg');
  statusMsg.textContent = message;
  statusMsg.className = type === 'error' ? 'error-msg' : type === 'success' ? 'success-msg' : 'status-msg';
  statusMsg.style.display = 'block';
  if (type === 'success') setTimeout(() => { statusMsg.style.display = 'none'; }, 3000);
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.setAttribute('role', 'alert');
  notification.setAttribute('aria-live', 'assertive');
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// ===== UI ENABLE/DISABLE =====

function setUiEnabled(enabled) {
  ['browseBtn', 'batchBrowseBtn', 'compareBrowseBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
  const fileInput   = document.getElementById('fileInput');
  if (fileInput) fileInput.disabled = !enabled;
  const generateBtn = document.getElementById('generateBtn');
  if (generateBtn && !enabled) generateBtn.disabled = true;
}
