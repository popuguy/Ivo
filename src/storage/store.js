import { CURRENT_ARCHIVE_VERSION } from '../domain/documents/capabilities.js';
import { validateImport } from '../domain/documents/schema.js';
import { assertStore } from './contracts.js';
import { createIndexedDBStore } from './indexeddb.js';

let adapter;
/** One backend per renderer window. Native initialization runs before this facade is opened. */
export async function openStore() {
  if (!adapter && globalThis.ivoNative?.platform && !globalThis.ivoNative.store)
    throw new Error('Native atlas storage is not ready.');
  if (!adapter) adapter = assertStore(globalThis.ivoNative?.store || createIndexedDBStore());
  return adapter;
}
export const loadDocuments = async () => (await openStore()).loadDocuments();
export const saveDocument = async (document) => (await openStore()).saveDocument(document);
export const loadAssets = async () => (await openStore()).loadAssets();
export const loadAsset = async (id) => (await openStore()).loadAsset(id);
export const saveAsset = async (asset) => (await openStore()).saveAsset(asset);
export const getMeta = async (id) => (await openStore()).getMeta(id);
export const putMeta = async (id, value) => (await openStore()).putMeta(id, value);
export const saveImport = async (payload) => (await openStore()).saveImport(payload);

export async function snapshot(document) {
  const key = 'history:' + document.id;
  const previous = (await getMeta(key))?.value || [];
  if (previous[0]?.updatedAt === document.updatedAt) return;
  await putMeta(key, [structuredClone(document), ...previous].slice(0, 20));
}
export async function loadHistory(id) {
  const entries = (await getMeta('history:' + id))?.value || [];
  const assets = await loadAssets();
  return entries.map(
    (document) =>
      validateImport({ schemaVersion: CURRENT_ARCHIVE_VERSION, documents: [document], assets })
        .documents[0],
  );
}

export async function changeLibrary(command) {
  const store = await openStore();
  if (typeof store.changeLibrary !== 'function')
    throw new Error('This storage adapter needs an update for folder operations.');
  return store.changeLibrary(command);
}
