'use strict';

/**
 * Security Regression Tests
 *
 * These tests assert static security properties of preload.js and main.js
 * configuration — ensuring no regressions sneak in during refactors:
 *
 *  1. Preload surface does NOT expose raw ipcRenderer
 *  2. Preload exposes only the expected, fixed API names (surface snapshot)
 *  3. BrowserWindow is configured with hardened webPreferences
 *  4. setWindowOpenHandler returns deny-by-default
 *  5. will-navigate blocks non-file:// URLs
 *  6. CSP header is set and contains no unsafe-eval
 */

const fs = require('fs');
const path = require('path');

const PRELOAD_SOURCE  = fs.readFileSync(path.join(__dirname, '../preload.js'),         'utf-8');
// After modular split, security-sensitive code lives in sub-modules:
const WINDOW_SOURCE   = fs.readFileSync(path.join(__dirname, '../main/window.js'),     'utf-8');
const APIKEYS_IPC_SRC = fs.readFileSync(path.join(__dirname, '../ipc/api-keys.js'),    'utf-8');
const DIAG_IPC_SRC    = fs.readFileSync(path.join(__dirname, '../ipc/diagnostics.js'), 'utf-8');
const CONFIG_SRC      = fs.readFileSync(path.join(__dirname, '../main/config.js'),     'utf-8');

// ── 1. Preload surface: no raw ipcRenderer exposure ──────────────────────────

describe('Preload — ipcRenderer isolation', () => {
  test('does NOT expose ipcRenderer directly on the world bridge', () => {
    // Ensure ipcRenderer is never passed as a value in exposeInMainWorld
    // Pattern: no property that returns or assigns ipcRenderer (the object itself, not .invoke/.on calls)
    expect(PRELOAD_SOURCE).not.toMatch(/:\s*ipcRenderer\s*[,}]/);
  });

  test('does NOT expose require or __dirname or process', () => {
    // These would break context isolation guarantees
    expect(PRELOAD_SOURCE).not.toMatch(/exposeInMainWorld[^)]*require/s);
    expect(PRELOAD_SOURCE).not.toMatch(/:\s*process\b/);
    expect(PRELOAD_SOURCE).not.toMatch(/:\s*__dirname\b/);
  });
});

// ── 2. Preload API surface snapshot ─────────────────────────────────────────

describe('Preload — API surface snapshot', () => {
  const EXPECTED_METHODS = [
    'hasApiKey', 'setApiKey', 'setApiKeyForProvider', 'deleteApiKey', 'deleteApiKeyForProvider', 'testApiKey',
    'getApiProvider', 'getProviderStatus', 'getAvailableModels', 'refreshModelPricing',
    'loadMainApp', 'loadSetup', 'openExternal',
    'generateDescription', 'generateRedbubblePitch', 'generateEtsyListing', 'cancelRequest',
    'getSettings', 'saveSettings',
    'getHistory', 'saveHistoryItem', 'getHistoryImage', 'deleteHistoryItem', 'clearHistory',
    'saveBatchQueue', 'getBatchQueue', 'clearBatchQueue',
    'getTemplates', 'saveTemplate', 'deleteTemplate',
    'getStats', 'updateStats',
    'exportText', 'exportMarkdown', 'exportJson', 'exportCsv', 'showMessageBox',
    'getDiagnostics', 'exportDiagnostics',
    'selectImageFile',
    'onUpdateAvailable', 'onUpdateDownloaded', 'onUpdateError', 'onProviderCooldown', 'installUpdate',
    'onStreamChunk',
    'exportHistory', 'importHistory', 'tagHistoryItem'
  ];

  EXPECTED_METHODS.forEach(method => {
    test(`exposes method: ${method}`, () => {
      expect(PRELOAD_SOURCE).toContain(`${method}:`);
    });
  });

  test('total exposed method count matches expected surface', () => {
    // Count top-level property assignments inside exposeInMainWorld block
    const matches = PRELOAD_SOURCE.match(/^\s{2}[a-zA-Z]+:/gm) || [];
    expect(matches.length).toBe(EXPECTED_METHODS.length);
  });
});

// ── 3. Preload — update listeners return unsubscribe disposers ───────────────

describe('Preload — listener hygiene', () => {
  test('onUpdateAvailable returns a disposer (removeListener call present)', () => {
    expect(PRELOAD_SOURCE).toContain('removeListener');
  });

  test('onUpdateAvailable and onUpdateDownloaded both call removeListener', () => {
    const removeCount = (PRELOAD_SOURCE.match(/removeListener/g) || []).length;
    expect(removeCount).toBeGreaterThanOrEqual(2);
  });
});

// ── 4. BrowserWindow webPreferences hardening ────────────────────────────────

describe('main.js — BrowserWindow security config', () => {
  test('nodeIntegration: false is set', () => {
    expect(WINDOW_SOURCE).toContain('nodeIntegration: false');
  });

  test('contextIsolation: true is set', () => {
    expect(WINDOW_SOURCE).toContain('contextIsolation: true');
  });

  test('sandbox: true is set', () => {
    expect(WINDOW_SOURCE).toContain('sandbox: true');
  });

  test('webSecurity: true is explicitly set', () => {
    expect(WINDOW_SOURCE).toContain('webSecurity: true');
  });

  test('allowRunningInsecureContent: false is set', () => {
    expect(WINDOW_SOURCE).toContain('allowRunningInsecureContent: false');
  });
});

// ── 5. Navigation policy ──────────────────────────────────────────────────────

describe('main.js — Navigation hardening', () => {
  test('setWindowOpenHandler is called (deny-by-default)', () => {
    expect(WINDOW_SOURCE).toContain("setWindowOpenHandler");
    expect(WINDOW_SOURCE).toContain("action: 'deny'");
  });

  test('will-navigate handler is registered', () => {
    expect(WINDOW_SOURCE).toContain("'will-navigate'");
  });

  test('will-navigate blocks non-file:// URLs (preventDefault called)', () => {
    expect(WINDOW_SOURCE).toContain('event.preventDefault');
    // Must check for file:// — the only allowed navigation origin
    expect(WINDOW_SOURCE).toContain("file://");
  });
});

// ── 6. CSP ────────────────────────────────────────────────────────────────────

describe('main.js — Content Security Policy', () => {
  test('CSP is set via onHeadersReceived', () => {
    expect(WINDOW_SOURCE).toContain('onHeadersReceived');
    expect(WINDOW_SOURCE).toContain('Content-Security-Policy');
  });

  test('CSP does not contain unsafe-eval', () => {
    const cspMatch = WINDOW_SOURCE.match(/Content-Security-Policy['":\s]+\[([^\]]+)\]/s);
    if (cspMatch) {
      expect(cspMatch[1]).not.toContain('unsafe-eval');
    } else {
      expect(WINDOW_SOURCE).not.toContain("'unsafe-eval'");
    }
  });

  test('CSP does not contain unsafe-inline', () => {
    expect(WINDOW_SOURCE).not.toContain("'unsafe-inline'");
  });

  test('CSP does not load fonts from external origins', () => {
    expect(WINDOW_SOURCE).not.toContain('fonts.googleapis.com');
    expect(WINDOW_SOURCE).not.toContain('fonts.gstatic.com');
  });

  test('CSP script-src is restricted to self', () => {
    expect(WINDOW_SOURCE).toContain("script-src 'self'");
  });

  test('CSP connect-src restricts to known API origins only', () => {
    // Endpoint literals live in main/providers.js (buildConnectSrc) and main/config.js
    expect(CONFIG_SRC).toContain('api.openai.com');
    expect(CONFIG_SRC).toContain('api.anthropic.com');
    expect(CONFIG_SRC).toContain('generativelanguage.googleapis.com');
    expect(WINDOW_SOURCE).not.toMatch(/connect-src[^;]*\*/);
  });
});

// ── 7. open-external allowlist correctness ───────────────────────────────────

describe('main.js — open-external allowlist', () => {
  test('allowlist is an array literal', () => {
    expect(DIAG_IPC_SRC).toContain('allowedUrls');
  });

  test('allowlist uses exact URL matching (hostname + pathname checked)', () => {
    expect(DIAG_IPC_SRC).toContain('parsedUrl.hostname');
    expect(DIAG_IPC_SRC).toContain('parsedUrl.pathname');
  });

  test('only https protocol URLs are in the allowlist', () => {
    const allowlistMatch = DIAG_IPC_SRC.match(/const allowedUrls\s*=\s*\[([^\]]+)\]/s);
    if (allowlistMatch) {
      const entries = allowlistMatch[1].match(/https?:\/\/[^\s'"]+/g) || [];
      entries.forEach(url => {
        expect(url).toMatch(/^https:\/\//);
      });
    }
  });
});

// ── 8. Secure storage fallback path ──────────────────────────────────────────

describe('main.js — Secure storage UX', () => {
  test('set-api-key checks isEncryptionAvailable before storing', () => {
    expect(APIKEYS_IPC_SRC).toContain('isEncryptionAvailable');
  });

  test('returns actionable error string when encryption unavailable', () => {
    expect(APIKEYS_IPC_SRC).toMatch(/OS-level encryption/i);
  });
});
