'use strict';

const { validateSettings, validateHistoryItem, validateTemplate, validateImagePath } = require('../src/validators');

// ===== validateSettings =====

describe('validateSettings', () => {
  test('accepts an empty object', () => {
    expect(validateSettings({})).toBe(true);
  });

  test('accepts a fully populated valid object', () => {
    expect(validateSettings({
      autoCompress: true,
      compressionQuality: 0.8,
      maxImageSize: 1024,
      exportFormat: 'json',
      concurrency: 3,
      defaultModel: 'gpt-4o',
      showOnboarding: false,
    })).toBe(true);
  });

  test('rejects null', () => {
    expect(validateSettings(null)).toBe(false);
  });

  test('rejects an array', () => {
    expect(validateSettings([])).toBe(false);
  });

  test('rejects non-object primitives', () => {
    expect(validateSettings('settings')).toBe(false);
    expect(validateSettings(42)).toBe(false);
  });

  test('strips unknown keys instead of rejecting', () => {
    const settings = { autoCompress: true, injectedKey: 'evil' };
    const result = validateSettings(settings);
    expect(result).toBe(true);
    expect('injectedKey' in settings).toBe(false);
  });

  // autoCompress / showOnboarding
  test('rejects non-boolean autoCompress', () => {
    expect(validateSettings({ autoCompress: 'yes' })).toBe(false);
    expect(validateSettings({ autoCompress: 1 })).toBe(false);
  });

  test('rejects non-boolean showOnboarding', () => {
    expect(validateSettings({ showOnboarding: 'true' })).toBe(false);
  });

  // compressionQuality
  test('accepts compressionQuality at boundaries 0 and 1', () => {
    expect(validateSettings({ compressionQuality: 0 })).toBe(true);
    expect(validateSettings({ compressionQuality: 1 })).toBe(true);
  });

  test('rejects compressionQuality out of range', () => {
    expect(validateSettings({ compressionQuality: -0.1 })).toBe(false);
    expect(validateSettings({ compressionQuality: 1.1 })).toBe(false);
  });

  test('rejects non-numeric compressionQuality', () => {
    expect(validateSettings({ compressionQuality: 'high' })).toBe(false);
  });

  // maxImageSize
  test('accepts maxImageSize at boundaries 256 and 4096', () => {
    expect(validateSettings({ maxImageSize: 256 })).toBe(true);
    expect(validateSettings({ maxImageSize: 4096 })).toBe(true);
  });

  test('rejects maxImageSize out of range', () => {
    expect(validateSettings({ maxImageSize: 255 })).toBe(false);
    expect(validateSettings({ maxImageSize: 4097 })).toBe(false);
  });

  test('floors fractional maxImageSize', () => {
    const settings = { maxImageSize: 1024.9 };
    validateSettings(settings);
    expect(settings.maxImageSize).toBe(1024);
  });

  // exportFormat
  test('accepts all valid export formats', () => {
    expect(validateSettings({ exportFormat: 'txt' })).toBe(true);
    expect(validateSettings({ exportFormat: 'json' })).toBe(true);
    expect(validateSettings({ exportFormat: 'csv' })).toBe(true);
  });

  test('rejects invalid export format', () => {
    expect(validateSettings({ exportFormat: 'pdf' })).toBe(false);
    expect(validateSettings({ exportFormat: '' })).toBe(false);
  });

  // concurrency
  test('accepts concurrency at boundaries 1 and 5', () => {
    expect(validateSettings({ concurrency: 1 })).toBe(true);
    expect(validateSettings({ concurrency: 5 })).toBe(true);
  });

  test('rejects concurrency out of range', () => {
    expect(validateSettings({ concurrency: 0 })).toBe(false);
    expect(validateSettings({ concurrency: 6 })).toBe(false);
  });

  test('floors fractional concurrency', () => {
    const settings = { concurrency: 2.9 };
    validateSettings(settings);
    expect(settings.concurrency).toBe(2);
  });

  // defaultModel
  test('accepts null defaultModel', () => {
    expect(validateSettings({ defaultModel: null })).toBe(true);
  });

  test('rejects defaultModel over 100 characters', () => {
    expect(validateSettings({ defaultModel: 'x'.repeat(101) })).toBe(false);
  });
});

// ===== validateHistoryItem =====

describe('validateHistoryItem', () => {
  function validItem() {
    return {
      id: 'item-1',
      timestamp: Date.now(),
      description: 'A photo of a sunset',
      style: 'detailed',
      detail: 2,
      model: 'gpt-4o',
      cost: 0.002,
    };
  }

  test('accepts a valid history item', () => {
    expect(validateHistoryItem(validItem())).toBe(true);
  });

  test('rejects null', () => {
    expect(validateHistoryItem(null)).toBe(false);
  });

  test('rejects non-object', () => {
    expect(validateHistoryItem('item')).toBe(false);
  });

  test('rejects id longer than 100 chars', () => {
    expect(validateHistoryItem({ ...validItem(), id: 'x'.repeat(101) })).toBe(false);
  });

  test('rejects numeric id', () => {
    expect(validateHistoryItem({ ...validItem(), id: 123 })).toBe(false);
  });

  test('rejects negative timestamp', () => {
    expect(validateHistoryItem({ ...validItem(), timestamp: -1 })).toBe(false);
  });

  test('rejects timestamp more than 24 hours in the future', () => {
    expect(validateHistoryItem({ ...validItem(), timestamp: Date.now() + 86400001 })).toBe(false);
  });

  test('rejects description over 20000 chars', () => {
    expect(validateHistoryItem({ ...validItem(), description: 'x'.repeat(20001) })).toBe(false);
  });

  test('rejects non-string description', () => {
    expect(validateHistoryItem({ ...validItem(), description: 42 })).toBe(false);
  });

  test('rejects style over 100 chars', () => {
    expect(validateHistoryItem({ ...validItem(), style: 'x'.repeat(101) })).toBe(false);
  });

  test('accepts all valid detail levels', () => {
    [1, 2, 3].forEach(d => {
      expect(validateHistoryItem({ ...validItem(), detail: d })).toBe(true);
    });
  });

  test('rejects invalid detail values', () => {
    expect(validateHistoryItem({ ...validItem(), detail: 0 })).toBe(false);
    expect(validateHistoryItem({ ...validItem(), detail: 4 })).toBe(false);
    expect(validateHistoryItem({ ...validItem(), detail: 2.5 })).toBe(false);
  });

  test('rejects model string over 100 chars', () => {
    expect(validateHistoryItem({ ...validItem(), model: 'x'.repeat(101) })).toBe(false);
  });

  test('rejects negative cost', () => {
    expect(validateHistoryItem({ ...validItem(), cost: -0.001 })).toBe(false);
  });

  test('accepts zero cost', () => {
    expect(validateHistoryItem({ ...validItem(), cost: 0 })).toBe(true);
  });
});

// ===== validateTemplate =====

describe('validateTemplate', () => {
  function validTemplate() {
    return { name: 'My Template', style: 'creative', detail: 1 };
  }

  test('accepts a valid template', () => {
    expect(validateTemplate(validTemplate())).toBe(true);
  });

  test('rejects null', () => {
    expect(validateTemplate(null)).toBe(false);
  });

  test('rejects empty name', () => {
    expect(validateTemplate({ ...validTemplate(), name: '' })).toBe(false);
  });

  test('rejects name over 50 chars', () => {
    expect(validateTemplate({ ...validTemplate(), name: 'x'.repeat(51) })).toBe(false);
  });

  test('rejects non-string name', () => {
    expect(validateTemplate({ ...validTemplate(), name: 42 })).toBe(false);
  });

  test('rejects style over 100 chars', () => {
    expect(validateTemplate({ ...validTemplate(), style: 'x'.repeat(101) })).toBe(false);
  });

  test('accepts all valid detail levels', () => {
    [1, 2, 3].forEach(d => {
      expect(validateTemplate({ ...validTemplate(), detail: d })).toBe(true);
    });
  });

  test('rejects invalid detail values', () => {
    [0, 4, 2.5, 'medium'].forEach(d => {
      expect(validateTemplate({ ...validTemplate(), detail: d })).toBe(false);
    });
  });
});

// ===== validateImagePath =====

describe('validateImagePath', () => {
  test('accepts valid filenames', () => {
    expect(validateImagePath('abc.jpg')).toBe(true);
    expect(validateImagePath('my-image.png')).toBe(true);
    expect(validateImagePath('photo_001.webp')).toBe(true);
    expect(validateImagePath('IMG-20240101.jpeg')).toBe(true);
  });

  test('rejects path traversal with ..', () => {
    expect(validateImagePath('../secret.jpg')).toBe(false);
    expect(validateImagePath('../../etc/passwd')).toBe(false);
  });

  test('rejects forward slashes', () => {
    expect(validateImagePath('subdir/image.jpg')).toBe(false);
  });

  test('rejects backslashes', () => {
    expect(validateImagePath('subdir\\image.jpg')).toBe(false);
  });

  test('rejects unsupported extensions', () => {
    expect(validateImagePath('file.gif')).toBe(false);
    expect(validateImagePath('file.pdf')).toBe(false);
    expect(validateImagePath('file.exe')).toBe(false);
  });

  test('rejects non-string input', () => {
    expect(validateImagePath(null)).toBe(false);
    expect(validateImagePath(123)).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateImagePath('')).toBe(false);
  });
});
