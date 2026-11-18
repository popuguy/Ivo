import { createFileVault, encodeBytes, decodeBytes } from '../storage/file-vault.js';
import { assertStore } from '../storage/contracts.js';

/** Attach the native backend before opening any collection; failure must not silently select IndexedDB. */
export async function initializePlatform({ prepareForSuspend, createPlugin } = {}) {
  if (globalThis.ivoNative?.store) {
    assertStore(globalThis.ivoNative.store);
    if (prepareForSuspend) globalThis.ivoNative.onPrepareClose?.(prepareForSuspend);
    return;
  }
  if (globalThis.Capacitor?.getPlatform?.() !== 'ios') return;
  globalThis.ivoNative = { platform: 'ios' };
  if (!createPlugin) {
    const { registerPlugin } = await import('../../public/vendor/capacitor.js');
    createPlugin = () => registerPlugin('IvoAtlas');
  }
  const plugin = await createPlugin();
  if (!globalThis.Capacitor.isPluginAvailable('IvoAtlas'))
    throw new Error('The iOS atlas plugin is unavailable. Rebuild the native app.');
  const info = await plugin.initialize();
  const store = await createFileVault({
    directory: info.directory,
    hash: async (bytes) => (await plugin.hash({ data: encodeBytes(bytes) })).sha256,
    initialize: async () => {},
    read: async (path) => {
      const result = await plugin.read({ path });
      return result.data === null ? null : decodeBytes(result.data);
    },
    writeAtomic: async (path, bytes, guard = {}) => {
      await plugin.write({
        path,
        data: encodeBytes(bytes),
        expectedHash: guard.expectedHash ?? null,
      });
    },
  });
  let prepare = prepareForSuspend || (async () => false);
  await plugin.addListener('prepareSuspend', async ({ token }) => {
    let success = false;
    try {
      success = (await prepare()) === true;
    } catch {}
    // Suspension can disconnect the bridge; the pending data stays in the save queue.
    try {
      await plugin.finishSuspend({ token, success });
    } catch {}
  });
  globalThis.ivoNative = {
    platform: 'ios',
    fonts: {
      list: async () => (await plugin.listFonts()).fonts,
      read: (postscript) => plugin.readFont({ postscript }),
    },
    store,
    onPrepareClose: (callback) => {
      prepare = callback;
    },
  };
}
