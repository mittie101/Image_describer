'use strict';

const { migrateStore, SCHEMA_VERSION } = require('../src/migrateStore');

class FakeStore {
  constructor(initial = {}) {
    this._data = JSON.parse(JSON.stringify(initial));
  }
  get store() { return JSON.parse(JSON.stringify(this._data)); }
  get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this._data, key)
      ? JSON.parse(JSON.stringify(this._data[key]))
      : fallback;
  }
  set(key, value) { this._data[key] = JSON.parse(JSON.stringify(value)); }
}

// ===== v3 → v4: per-provider stats =====

describe('migrateStore — v3 to v4 (per-provider stats)', () => {
  test('adds byProvider structure to stats when absent', () => {
    const store = new FakeStore({
      schemaVersion: 3,
      settings: { showOnboarding: false, concurrency: 2, defaultModel: 'gpt-4o' },
      stats: { totalImages: 5, totalCost: 0.12, totalTokens: 4000 }
    });

    migrateStore(store);

    const stats = store.get('stats');
    expect(stats.byProvider).toBeDefined();
    expect(stats.byProvider.openai).toEqual({ images: 0, cost: 0, tokens: 0 });
    expect(stats.byProvider.anthropic).toEqual({ images: 0, cost: 0, tokens: 0 });
    expect(stats.byProvider.google).toEqual({ images: 0, cost: 0, tokens: 0 });
  });

  test('preserves existing stats fields when adding byProvider', () => {
    const store = new FakeStore({
      schemaVersion: 3,
      settings: {},
      stats: { totalImages: 10, totalCost: 0.25, totalTokens: 8000 }
    });

    migrateStore(store);

    const stats = store.get('stats');
    expect(stats.totalImages).toBe(10);
    expect(stats.totalCost).toBe(0.25);
    expect(stats.totalTokens).toBe(8000);
  });

  test('does not overwrite existing byProvider data', () => {
    const existing = {
      openai:    { images: 3, cost: 0.05, tokens: 2000 },
      anthropic: { images: 2, cost: 0.10, tokens: 1500 },
      google:    { images: 0, cost: 0,    tokens: 0    }
    };
    const store = new FakeStore({
      schemaVersion: 3,
      settings: {},
      stats: { totalImages: 5, byProvider: existing }
    });

    migrateStore(store);

    const stats = store.get('stats');
    expect(stats.byProvider.openai).toEqual({ images: 3, cost: 0.05, tokens: 2000 });
    expect(stats.byProvider.anthropic).toEqual({ images: 2, cost: 0.10, tokens: 1500 });
  });

  test('handles missing stats key — creates stats with byProvider', () => {
    const store = new FakeStore({ schemaVersion: 3, settings: {} });

    expect(() => migrateStore(store)).not.toThrow();

    const stats = store.get('stats');
    expect(stats).toBeDefined();
    expect(stats.byProvider).toBeDefined();
    expect(Object.keys(stats.byProvider)).toEqual(expect.arrayContaining(['openai', 'anthropic', 'google']));
  });

  test('sets schemaVersion to 4 after migration', () => {
    const store = new FakeStore({ schemaVersion: 3, settings: {} });
    migrateStore(store);
    expect(store.get('schemaVersion')).toBe(4);
  });

  test('returns { migrated: true, from: 3, to: 4 }', () => {
    const store = new FakeStore({ schemaVersion: 3, settings: {} });
    const result = migrateStore(store);
    expect(result).toEqual({ migrated: true, from: 3, to: 4 });
  });

  test('writes backup before making changes', () => {
    const initial = { schemaVersion: 3, settings: {}, stats: { totalImages: 7 } };
    const store = new FakeStore(initial);
    migrateStore(store);
    expect(store.get('schemaBackup')).toEqual(initial);
  });
});

// ===== v1 → v4 full upgrade path =====

describe('migrateStore — v1 to v4 full upgrade', () => {
  test('applies all migrations in sequence from v1', () => {
    const store = new FakeStore({
      schemaVersion: 1,
      settings: { autoCompress: true },
      stats: { totalImages: 2 }
    });

    migrateStore(store);

    const s = store.get('settings');
    expect(s.defaultModel).toBeNull();       // v1→v2
    expect(s.showOnboarding).toBe(true);     // v2→v3
    expect(s.concurrency).toBe(2);           // v2→v3
    expect(s.autoCompress).toBe(true);       // preserved

    const stats = store.get('stats');
    expect(stats.byProvider).toBeDefined();  // v3→v4
    expect(store.get('schemaVersion')).toBe(SCHEMA_VERSION);
  });

  test('partial upgrade to v3 does not run v3→v4 step', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {}, stats: {} });
    migrateStore(store, 3);

    const stats = store.get('stats');
    expect(stats?.byProvider).toBeUndefined();
    expect(store.get('schemaVersion')).toBe(3);
  });

  test('partial upgrade to v4 from v2 skips v1→v2 step', () => {
    const store = new FakeStore({
      schemaVersion: 2,
      settings: { defaultModel: 'claude-3-5-sonnet-20241022', showOnboarding: false, concurrency: 4 },
      stats: {}
    });
    migrateStore(store);

    // v1→v2 step should NOT have overwritten defaultModel
    expect(store.get('settings').defaultModel).toBe('claude-3-5-sonnet-20241022');
    expect(store.get('stats').byProvider).toBeDefined();
  });
});

// ===== Idempotency across all versions =====

describe('migrateStore — idempotency', () => {
  test('running migration twice on v1 store is idempotent', () => {
    const store = new FakeStore({ schemaVersion: 1, settings: {}, stats: {} });
    migrateStore(store);
    const afterFirst = JSON.stringify(store.store);
    migrateStore(store);
    const afterSecond = JSON.stringify(store.store);
    // Settings and stats should not change; schemaBackup only appears on first run
    expect(JSON.parse(afterSecond).settings).toEqual(JSON.parse(afterFirst).settings);
    expect(JSON.parse(afterSecond).stats).toEqual(JSON.parse(afterFirst).stats);
  });

  test('running migration twice on v3 store is idempotent', () => {
    const store = new FakeStore({ schemaVersion: 3, settings: {}, stats: { totalImages: 3 } });
    migrateStore(store);
    const statsAfterFirst = store.get('stats');
    migrateStore(store);
    expect(store.get('stats')).toEqual(statsAfterFirst);
  });
});
