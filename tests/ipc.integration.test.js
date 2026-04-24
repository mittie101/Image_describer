'use strict';

/**
 * IPC Integration Tests
 *
 * Strategy: mock all Electron/native modules before requiring main.js,
 * capture every ipcMain.handle registration, then invoke handlers directly
 * in tests — no Electron process required.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const handlers = new Map();
const mockIpcMain = {
  handle: jest.fn((channel, fn) => { handlers.set(channel, fn); }),
  on: jest.fn()
};

const mockSafeStorage = {
  isEncryptionAvailable: jest.fn(() => true),
  encryptString: jest.fn((s) => Buffer.from(`enc:${s}`)),
  decryptString: jest.fn((buf) => buf.toString().replace('enc:', ''))
};

let mockStoreData = {};
const mockStore = jest.fn().mockImplementation(() => ({
  get: jest.fn((key, def) => (key in mockStoreData ? mockStoreData[key] : def)),
  set: jest.fn((key, val) => { mockStoreData[key] = val; }),
  delete: jest.fn((key) => { delete mockStoreData[key]; })
}));

const mockApp = {
  getPath: jest.fn(() => '/tmp/test-userdata'),
  getVersion: jest.fn(() => '2.1.0'),
  isPackaged: false,
  whenReady: jest.fn(() => Promise.resolve()),
  on: jest.fn(),
  quit: jest.fn()
};

const mockMainWindow = {
  loadFile: jest.fn(),
  show: jest.fn(),
  webContents: {
    session: { webRequest: { onHeadersReceived: jest.fn() } },
    setWindowOpenHandler: jest.fn(),
    on: jest.fn(),
    send: jest.fn()
  },
  once: jest.fn()
};

const mockBrowserWindow = jest.fn(() => mockMainWindow);
mockBrowserWindow.getAllWindows = jest.fn(() => [mockMainWindow]);

jest.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
  shell: { openExternal: jest.fn(() => Promise.resolve()) },
  dialog: {
    showSaveDialog: jest.fn(),
    showMessageBox: jest.fn(() => Promise.resolve({ response: 0 }))
  },
  safeStorage: mockSafeStorage
}));

jest.mock('electron-updater', () => ({
  autoUpdater: { checkForUpdatesAndNotify: jest.fn(), on: jest.fn(), quitAndInstall: jest.fn() }
}));

jest.mock('electron-store', () => mockStore);

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
    readFile: jest.fn(() => Promise.resolve(Buffer.from('imgdata'))),
    unlink: jest.fn(() => Promise.resolve())
  }
}));

// ── Load main after mocks ────────────────────────────────────────────────────

beforeAll(() => {
  // Reset store data each suite run
  mockStoreData = {};
  require('../main');
});

afterAll(() => {
  jest.resetModules();
});

// ── Helper ───────────────────────────────────────────────────────────────────

function invoke(channel, ...args) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler({}, ...args);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('has-api-key', () => {
  test('returns false when no key stored', async () => {
    mockStoreData = {};
    const result = await invoke('has-api-key');
    expect(result).toBe(false);
  });

  test('returns true when encrypted_api_key present', async () => {
    mockStoreData = { encrypted_api_key: 'somehexvalue' };
    const result = await invoke('has-api-key');
    expect(result).toBe(true);
    mockStoreData = {};
  });
});

describe('set-api-key', () => {
  beforeEach(() => { mockStoreData = {}; });

  test('rejects key shorter than 10 chars', async () => {
    const r = await invoke('set-api-key', 'short');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid API key format/);
  });

  test('rejects key longer than 200 chars', async () => {
    const r = await invoke('set-api-key', 'x'.repeat(201));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid API key format/);
  });

  test('rejects non-string input', async () => {
    const r = await invoke('set-api-key', 12345);
    expect(r.success).toBe(false);
  });

  test('returns actionable error when encryption unavailable', async () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValueOnce(false);
    const r = await invoke('set-api-key', 'sk-validlongkey12345');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/OS-level encryption/i);
  });

  test('stores key and returns success for valid OpenAI key', async () => {
    const r = await invoke('set-api-key', 'sk-validlongkey1234567890');
    expect(r.success).toBe(true);
    expect(mockStoreData).toHaveProperty('encrypted_key_openai');
  });
});

describe('open-external', () => {
  test('rejects URL not on allowlist', async () => {
    const r = await invoke('open-external', 'https://evil.com/steal-data');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not allowed/i);
  });

  test('rejects malformed URL', async () => {
    const r = await invoke('open-external', 'not-a-url');
    expect(r.success).toBe(false);
  });

  test('allows an exact allowlisted URL', async () => {
    const { shell } = require('electron');
    const r = await invoke('open-external', 'https://platform.openai.com/api-keys');
    expect(r.success).toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://platform.openai.com/api-keys');
  });

  test('rejects allowlisted host with modified path', async () => {
    const r = await invoke('open-external', 'https://platform.openai.com/evil-path');
    expect(r.success).toBe(false);
  });
});

describe('generate-description input validation', () => {
  beforeEach(() => {
    // Ensure a key is stored so getApiKey() returns something
    mockStoreData = { encrypted_api_key: Buffer.from('enc:sk-validlongkey1234').toString('hex') };
    mockSafeStorage.decryptString.mockReturnValue('sk-validlongkey1234567');
  });

  test('rejects null imageDataUrl', async () => {
    const r = await invoke('generate-description', { requestId: 'r1', imageDataUrl: null, style: 'simple', detail: 1, model: 'gpt-4o-mini' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid image/i);
  });

  test('rejects invalid base64 prefix', async () => {
    const r = await invoke('generate-description', { requestId: 'r1', imageDataUrl: 'data:application/pdf;base64,abc', style: 'simple', detail: 1, model: 'gpt-4o-mini' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid image format/i);
  });

  test('rejects detail out of range', async () => {
    const r = await invoke('generate-description', {
      requestId: 'r2',
      imageDataUrl: 'data:image/jpeg;base64,/9j/abc',
      style: 'simple',
      detail: 5,
      model: 'gpt-4o-mini'
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid detail/i);
  });

  test('rejects oversized style string', async () => {
    const r = await invoke('generate-description', {
      requestId: 'r3',
      imageDataUrl: 'data:image/jpeg;base64,/9j/abc',
      style: 'x'.repeat(101),
      detail: 1,
      model: 'gpt-4o-mini'
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid style/i);
  });
});

describe('cancel-request', () => {
  test('returns failure for unknown request id', async () => {
    const r = await invoke('cancel-request', 'nonexistent-id');
    expect(r.success).toBe(false);
  });

  test('rejects non-string request id', async () => {
    const r = await invoke('cancel-request', 42);
    expect(r.success).toBe(false);
  });
});

describe('save-settings validation', () => {
  test('rejects invalid settings object', async () => {
    const r = await invoke('save-settings', { concurrency: 99 });
    expect(r.success).toBe(false);
  });

  test('accepts valid settings', async () => {
    const r = await invoke('save-settings', { concurrency: 2, exportFormat: 'json' });
    expect(r.success).toBe(true);
  });
});

describe('delete-template', () => {
  test('rejects non-custom template id', async () => {
    const r = await invoke('delete-template', 'simple');
    expect(r.success).toBe(false);
  });

  test('rejects id not starting with custom-', async () => {
    const r = await invoke('delete-template', 'hack-1234');
    expect(r.success).toBe(false);
  });
});

describe('update-stats', () => {
  test('rejects null delta', async () => {
    const r = await invoke('update-stats', null);
    expect(r.success).toBe(false);
  });

  test('ignores negative values (clamps to 0)', async () => {
    mockStoreData = {};
    await invoke('update-stats', { images: -5, cost: -1, tokens: -100 });
    const stats = mockStoreData['stats'];
    expect(stats.totalImages).toBe(0);
    expect(stats.totalCost).toBe(0);
  });
});

describe('get-history', () => {
  test('returns empty array when no history stored', async () => {
    mockStoreData = {};
    const r = await invoke('get-history');
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBe(0);
  });

  test('returns stored history items', async () => {
    mockStoreData = { history: [{ id: 'h1', timestamp: Date.now(), description: 'test', style: 'simple', detail: 1, model: 'gpt-4o-mini', cost: 0 }] };
    const r = await invoke('get-history');
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('h1');
    mockStoreData = {};
  });
});

describe('get-templates', () => {
  test('returns at least the built-in default templates', async () => {
    mockStoreData = {};
    const r = await invoke('get-templates');
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeGreaterThanOrEqual(5);
    const ids = r.map(t => t.id);
    expect(ids).toContain('simple');
    expect(ids).toContain('detailed');
    expect(ids).toContain('professional');
  });

  test('merges custom templates with defaults', async () => {
    mockStoreData = { templates: [{ id: 'custom-123', name: 'My Style', style: 'moody', detail: 2, custom: true }] };
    const r = await invoke('get-templates');
    expect(r.some(t => t.id === 'custom-123')).toBe(true);
    expect(r.some(t => t.id === 'simple')).toBe(true);
    mockStoreData = {};
  });
});

describe('get-stats', () => {
  test('returns default stats structure when no data stored', async () => {
    mockStoreData = {};
    const r = await invoke('get-stats');
    expect(r).toHaveProperty('totalImages');
    expect(r).toHaveProperty('totalCost');
    expect(r).toHaveProperty('totalTokens');
    expect(r).toHaveProperty('byProvider');
    expect(r.byProvider).toHaveProperty('openai');
    expect(r.byProvider).toHaveProperty('anthropic');
    expect(r.byProvider).toHaveProperty('google');
  });

  test('accumulates stats correctly across update calls', async () => {
    mockStoreData = {};
    await invoke('update-stats', { images: 2, cost: 0.01, tokens: 500, provider: 'openai' });
    await invoke('update-stats', { images: 1, cost: 0.005, tokens: 200, provider: 'anthropic' });
    const r = await invoke('get-stats');
    expect(r.totalImages).toBe(3);
    expect(r.byProvider.openai.images).toBe(2);
    expect(r.byProvider.anthropic.images).toBe(1);
    mockStoreData = {};
  });
});

describe('get-api-provider', () => {
  test('returns null provider when no keys stored', async () => {
    mockStoreData = {};
    const r = await invoke('get-api-provider');
    expect(r.provider).toBeNull();
    expect(Array.isArray(r.providers)).toBe(true);
    expect(r.providers.length).toBe(0);
  });

  test('returns provider when key is stored', async () => {
    mockSafeStorage.decryptString.mockReturnValueOnce('sk-validlongkey12345');
    mockStoreData = { encrypted_key_openai: 'somehex' };
    const r = await invoke('get-api-provider');
    expect(r.providers).toContain('openai');
    mockStoreData = {};
  });
});

describe('save-history-item', () => {
  test('rejects invalid history item (missing required fields)', async () => {
    const r = await invoke('save-history-item', { id: 'x' });
    expect(r.success).toBe(false);
  });

  test('accepts valid history item and stores metadata', async () => {
    mockStoreData = {};
    const item = {
      id: 'test-1', timestamp: Date.now(), description: 'A test description',
      style: 'simple', detail: 1, model: 'gpt-4o-mini', cost: 0.001
    };
    const r = await invoke('save-history-item', item);
    expect(r.success).toBe(true);
    const history = mockStoreData['history'];
    expect(Array.isArray(history)).toBe(true);
    expect(history[0].id).toBe('test-1');
    mockStoreData = {};
  });
});
