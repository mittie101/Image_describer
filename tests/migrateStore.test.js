'use strict';

const { migrateStore, SCHEMA_VERSION } = require('../src/migrateStore');

// A minimal in-memory store that satisfies the same interface as electron-store.
// Using a fake avoids disk I/O, electron dependencies, and makes tests deterministic.
class FakeStore {
  constructor(initial = {}) {
    this._data = JSON.parse(JSON.stringify(initial));
  }

  get store() {
    return JSON.parse(JSON.stringify(this._data));
  }

  get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this._data, key)
      ? JSON.parse(JSON.stringify(this._data[key]))
      : fallback;
  }

  set(key, value) {
    this._data[key] = JSON.parse(JSON.stringify(value));
  }
}

// ===== No-op when already current =====

describe('migrateStore — already at current version', () => {
  test('returns migrated: false and leaves store untouched', () => {
    const store = new FakeStore({
      schemaVersion: SCHEMA_VERSION,
      settings: { showOnboarding: false, concurrency: 5, defaultModel: 'gpt-4o' }
    });
    const before = store.store;

    const result = migrateStore(store);

    expect(result).toEqual({ migrated: false, from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    expect(store.store).toEqual(before);
  });

  test('does not write a backup when no migration is needed', () => {
    const store = new FakeStore({ schemaVersion: SCHEMA_VERSION });
    migrateStore(store);
    expect(store.get('schemaBackup', null)).toBeNull();
  });
});

// ===== v1 → v3 (full upgrade path) =====

describe('migrateStore — v1 to current', () => {
  test('writes a backup of the original store before changing anything', () => {
    const initial = { schemaVersion: 1, settings: { autoCompress: true } };
    const store = new FakeStore(initial);

    migrateStore(store);

    expect(store.get('schemaBackup')).toEqual(initial);
  });

  test('adds defaultModel: null when absent', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: { autoCompress: true } });
    migrateStore(store);
    expect(store.get('settings').defaultModel).toBeNull();
  });

  test('adds showOnboarding: true when absent', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {} });
    migrateStore(store);
    expect(store.get('settings').showOnboarding).toBe(true);
  });

  test('adds concurrency: 2 when absent', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {} });
    migrateStore(store);
    expect(store.get('settings').concurrency).toBe(2);
  });

  test('preserves all pre-existing setting values', () => {
    const store = new FakeStore({
      schemaVersion: 1,
      settings: { autoCompress: false, compressionQuality: 0.6, exportFormat: 'csv' }
    });
    migrateStore(store);
    const s = store.get('settings');
    expect(s.autoCompress).toBe(false);
    expect(s.compressionQuality).toBe(0.6);
    expect(s.exportFormat).toBe('csv');
  });

  test('sets schemaVersion to SCHEMA_VERSION', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {} });
    migrateStore(store);
    expect(store.get('schemaVersion')).toBe(SCHEMA_VERSION);
  });

  test('returns { migrated: true, from: 1, to: SCHEMA_VERSION }', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {} });
    const result = migrateStore(store);
    expect(result).toEqual({ migrated: true, from: 1, to: SCHEMA_VERSION });
  });
});

// ===== v2 → v3 (partial upgrade) =====

describe('migrateStore — v2 to current', () => {
  test('does not overwrite an existing showOnboarding value', () => {
    const store = new FakeStore({
      schemaVersion: 2,
      settings: { showOnboarding: false, concurrency: 7, defaultModel: 'gpt-4o-mini' }
    });
    migrateStore(store);
    expect(store.get('settings').showOnboarding).toBe(false);
  });

  test('does not overwrite an existing concurrency value', () => {
    const store = new FakeStore({
      schemaVersion: 2,
      settings: { showOnboarding: true, concurrency: 4 }
    });
    migrateStore(store);
    expect(store.get('settings').concurrency).toBe(4);
  });

  test('does not re-run v1→v2 step (defaultModel left as-is)', () => {
    const store = new FakeStore({
      schemaVersion: 2,
      settings: { defaultModel: 'claude-3-5-sonnet-20241022' }
    });
    migrateStore(store);
    expect(store.get('settings').defaultModel).toBe('claude-3-5-sonnet-20241022');
  });

  test('sets schemaVersion to SCHEMA_VERSION', () => {
    const store = new FakeStore({ schemaVersion: 2, settings: {} });
    migrateStore(store);
    expect(store.get('schemaVersion')).toBe(SCHEMA_VERSION);
  });
});

// ===== Edge cases =====

describe('migrateStore — edge cases', () => {
  test('handles a store with no settings key (first-ever run, corrupt state)', () => {
    const store = new FakeStore({ schemaVersion: 1 });
    expect(() => migrateStore(store)).not.toThrow();
    const s = store.get('settings');
    expect(s).toBeDefined();
    expect(s.defaultModel).toBeNull();
    expect(s.showOnboarding).toBe(true);
    expect(s.concurrency).toBe(2);
  });

  test('handles a store with no schemaVersion (treated as v1)', () => {
    const store = new FakeStore({ settings: {} });
    migrateStore(store);
    expect(store.get('schemaVersion')).toBe(SCHEMA_VERSION);
  });

  test('is idempotent — running twice produces the same result as running once', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {} });
    migrateStore(store);
    const afterFirst = store.store;

    migrateStore(store);
    const afterSecond = store.store;

    // schemaBackup from the second run (which is a no-op) should not exist,
    // and all other keys should be identical.
    expect(afterSecond.schemaVersion).toBe(afterFirst.schemaVersion);
    expect(afterSecond.settings).toEqual(afterFirst.settings);
  });

  test('custom targetVersion only runs migrations up to that version', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {} });
    migrateStore(store, 2);

    const s = store.get('settings');
    expect(s.defaultModel).toBeNull();      // v1→v2 ran
    expect('showOnboarding' in s).toBe(false); // v2→v3 did NOT run
    expect(store.get('schemaVersion')).toBe(2);
  });
});
