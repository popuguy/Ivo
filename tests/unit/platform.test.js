import test from 'node:test';
import assert from 'node:assert/strict';
import { initializePlatform } from '../../src/platform/initialize.js';
import { hashBytes, encodeBytes, decodeBytes } from '../../src/storage/file-vault.js';
import { openStore } from '../../src/storage/store.js';

test('asynchronous native startup binds lifecycle saves before returning a ready store', async (t) => {
  const previous = { native: globalThis.ivoNative, capacitor: globalThis.Capacitor };
  t.after(() => {
    globalThis.ivoNative = previous.native;
    globalThis.Capacitor = previous.capacitor;
  });
  globalThis.ivoNative = undefined;
  globalThis.Capacitor = { getPlatform: () => 'ios', isPluginAvailable: () => true };
  const objects = new Map(),
    events = {};
  let acknowledged,
    prepared = false,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const plugin = {
    get then() {
      throw new Error('Await a native method result, never the Capacitor plugin proxy itself');
    },
    initialize: async () => {
      await gate;
      return { directory: 'test-atlas' };
    },
    hash: async ({ data }) => ({ sha256: await hashBytes(decodeBytes(data)) }),
    read: async ({ path }) => ({ data: objects.has(path) ? encodeBytes(objects.get(path)) : null }),
    write: async ({ path, data, expectedHash }) => {
      if (path === 'atlas.json')
        assert.equal(objects.has(path) ? await hashBytes(objects.get(path)) : null, expectedHash);
      objects.set(path, decodeBytes(data));
    },
    addListener: async (name, handler) => {
      events[name] = handler;
      return { remove() {} };
    },
    finishSuspend: async (value) => {
      acknowledged = value;
    },
  };
  const opening = initializePlatform({
    createPlugin: () => plugin,
    prepareForSuspend: async () => {
      prepared = true;
      return true;
    },
  });
  await Promise.resolve();
  assert.equal(globalThis.ivoNative.store, undefined);
  release();
  await opening;
  assert.equal(typeof globalThis.ivoNative.store.saveDocument, 'function');
  await events.prepareSuspend({ token: 'suspend-1' });
  assert.equal(prepared, true);
  assert.deepEqual(acknowledged, { token: 'suspend-1', success: true });
  globalThis.ivoNative.onPrepareClose(async () => {
    throw new Error('save failed');
  });
  await events.prepareSuspend({ token: 'suspend-2' });
  assert.deepEqual(acknowledged, { token: 'suspend-2', success: false });
});

test('failed native startup cannot open an unrelated browser database', async (t) => {
  const previous = {
    native: globalThis.ivoNative,
    capacitor: globalThis.Capacitor,
    indexedDB: globalThis.indexedDB,
  };
  t.after(() => {
    globalThis.ivoNative = previous.native;
    globalThis.Capacitor = previous.capacitor;
    globalThis.indexedDB = previous.indexedDB;
  });
  globalThis.ivoNative = undefined;
  globalThis.Capacitor = { getPlatform: () => 'ios', isPluginAvailable: () => true };
  let browserOpened = false;
  globalThis.indexedDB = {
    open() {
      browserOpened = true;
      throw new Error('unexpected fallback');
    },
  };
  await assert.rejects(
    initializePlatform({
      createPlugin: () => ({
        initialize: async () => {
          throw new Error('native disk unavailable');
        },
      }),
    }),
    /native disk unavailable/,
  );
  await assert.rejects(openStore(), /Native atlas storage is not ready/);
  assert.equal(browserOpened, false);
});
