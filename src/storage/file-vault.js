import { planLibraryChange } from '../domain/documents/library-commands.js';
import { CURRENT_ARCHIVE_VERSION } from '../domain/documents/capabilities.js';
import { normalizeWorkspace, normalizeWindowDescriptors } from '../domain/workspace/state.js';
import { normalizeLibraryMeta } from '../domain/documents/library.js';
import { validateImport } from '../domain/documents/schema.js';

const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true });
const json = (value) => encoder.encode(JSON.stringify(value, null, 2) + '\n');
const decodeText = (bytes) => decoder.decode(bytes);
const idPattern = /^[A-Za-z0-9_-]+$/;
const digestPattern = /^[a-f0-9]{64}$/;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
export async function hashBytes(bytes) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export function encodeBytes(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function decodeBytes(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

// Identical validation and commit semantics on macOS and iOS. IO owns only native bytes.
export async function createFileVault(io, { beforeCommit = async () => {} } = {}) {
  await io.initialize();
  const hash = io.hash || hashBytes;
  const original = await io.read('atlas.json');
  let manifestHash = original ? await hash(original) : null;
  let manifest = original
    ? JSON.parse(decodeText(original))
    : { format: 'ivo-folder', schemaVersion: 1, documents: {}, assets: {}, meta: {} };
  if (
    manifest.format !== 'ivo-folder' ||
    manifest.schemaVersion !== 1 ||
    !['documents', 'assets', 'meta'].every((key) => record(manifest[key]))
  ) {
    throw new Error(
      'Unsupported or damaged Ivo atlas manifest. Your files have been left in place.',
    );
  }
  if (!original) {
    const bytes = json(manifest);
    manifestHash = await hash(bytes);
    await io.writeAtomic('atlas.json', bytes, { expectedHash: null });
  }
  async function readObject(relative, expectedHash) {
    const bytes = await io.read(relative);
    if (!bytes || (await hash(bytes)) !== expectedHash)
      throw new Error('An atlas file has changed or is damaged: ' + relative);
    return bytes;
  }
  async function readState() {
    const documents = [],
      assets = [];
    for (const [id, entry] of Object.entries(manifest.documents)) {
      if (
        !idPattern.test(id) ||
        !digestPattern.test(entry?.sha256) ||
        entry.file !== `documents/${id}-${entry.sha256}.json`
      )
        throw new Error('Invalid document reference in atlas manifest.');
      const doc = JSON.parse(decodeText(await readObject(entry.file, entry.sha256)));
      if (doc.id !== id) throw new Error('Document identity does not match its manifest.');
      documents.push(doc);
    }
    for (const [id, entry] of Object.entries(manifest.assets)) {
      if (
        !idPattern.test(id) ||
        !digestPattern.test(entry?.sha256) ||
        entry.file !== `assets/${entry.sha256}.bin`
      )
        throw new Error('Invalid asset reference in atlas manifest.');
      const bytes = await readObject(entry.file, entry.sha256);
      assets.push({
        id,
        name: entry.name,
        mimeType: entry.mimeType,
        data: `data:${entry.mimeType};base64,${encodeBytes(bytes)}`,
      });
    }
    return validateImport({ schemaVersion: CURRENT_ARCHIVE_VERSION, documents, assets });
  }
  // Fail before the editor can seed or overwrite a corrupt collection.
  let state = await readState(),
    queue = Promise.resolve();
  for (const [id, value] of Object.entries(manifest.meta))
    manifest.meta[id] = normalizeMeta(id, value);
  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function commit(next) {
    await beforeCommit(next);
    const bytes = json(next);
    const nextHash = await hash(bytes);
    await io.writeAtomic('atlas.json', bytes, { expectedHash: manifestHash });
    manifestHash = nextHash;
    manifest = next;
  }
  async function merge(payload, initialized = false, { library } = {}) {
    const changedAssetIds = new Set((payload.assets || []).map((asset) => asset.id));
    const incoming = validateImport({
      ...payload,
      assets: [
        ...state.assets.filter((asset) => !changedAssetIds.has(asset.id)),
        ...(payload.assets || []),
      ],
    });
    const documents = new Map(state.documents.map((doc) => [doc.id, doc]));
    const assets = new Map(state.assets.map((asset) => [asset.id, asset]));
    incoming.documents.forEach((doc) => documents.set(doc.id, doc));
    incoming.assets.forEach((asset) => assets.set(asset.id, asset));
    const nextState = validateImport({
      schemaVersion: CURRENT_ARCHIVE_VERSION,
      documents: [...documents.values()],
      assets: [...assets.values()],
    });
    const next = structuredClone(manifest);
    for (const doc of incoming.documents) {
      const bytes = json(doc),
        sha256 = await hash(bytes),
        file = `documents/${doc.id}-${sha256}.json`;
      await io.writeAtomic(file, bytes);
      Object.defineProperty(next.documents, doc.id, {
        value: { file, sha256 },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    for (const asset of incoming.assets) {
      if (!changedAssetIds.has(asset.id)) continue;
      const bytes = decodeBytes(asset.data.slice(asset.data.indexOf(',') + 1));
      const sha256 = await hash(bytes),
        file = `assets/${sha256}.bin`;
      await io.writeAtomic(file, bytes);
      Object.defineProperty(next.assets, asset.id, {
        value: { file, sha256, name: asset.name, mimeType: asset.mimeType },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    if (library) next.meta['library:1'] = normalizeLibraryMeta(library);
    if (initialized) next.meta.initialized = true;
    await commit(next);
    state = nextState;
  }
  function checkMetaKey(id) {
    if (
      id !== 'initialized' &&
      id !== 'workspace:1' &&
      id !== 'workspace-windows:1' &&
      id !== 'library:1' &&
      !/^workspace-window:[A-Za-z0-9_-]{1,120}$/.test(id) &&
      !/^history:[A-Za-z0-9_-]+$/.test(id)
    )
      throw new Error('Unknown atlas metadata key.');
  }
  function normalizeMeta(id, value) {
    checkMetaKey(id);
    if (id === 'workspace:1' || id.startsWith('workspace-window:')) {
      const serialized = JSON.stringify(value);
      if (!serialized || serialized.length > 250000)
        throw new Error('Workspace metadata is too large.');
      return normalizeWorkspace(value, state.documents);
    }
    if (id === 'workspace-windows:1') return normalizeWindowDescriptors(value);
    if (id === 'library:1') return normalizeLibraryMeta(value);
    if (id === 'initialized') {
      if (value !== true) throw new Error('Invalid initialization value.');
      return true;
    }
    if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid history.');
    return value.map((doc) => {
      if (doc?.id !== id.slice(8)) throw new Error('History belongs to another document.');
      return validateImport({
        schemaVersion: CURRENT_ARCHIVE_VERSION,
        documents: [doc],
        assets: state.assets,
      }).documents[0];
    });
  }
  return Object.freeze({
    directory: io.directory,
    loadDocuments: () => serialize(() => structuredClone(state.documents)),
    loadAssets: () => serialize(() => structuredClone(state.assets)),
    loadAsset: (id) =>
      serialize(() => structuredClone(state.assets.find((asset) => asset.id === id))),
    saveDocument: async (doc) => {
      const input = structuredClone(doc);
      return serialize(() =>
        merge({ schemaVersion: CURRENT_ARCHIVE_VERSION, documents: [input], assets: [] }),
      );
    },
    saveAsset: async (asset) => {
      const input = structuredClone(asset);
      return serialize(() =>
        merge({ schemaVersion: CURRENT_ARCHIVE_VERSION, documents: [], assets: [input] }),
      );
    },
    saveImport: async (payload) => {
      const input = structuredClone(payload);
      return serialize(() => merge(input, true));
    },
    changeLibrary: async (command) => {
      const input = structuredClone(command);
      return serialize(async () => {
        const plan = planLibraryChange(state.documents, manifest.meta['library:1'], input);
        if (plan.changed)
          await merge(
            { schemaVersion: CURRENT_ARCHIVE_VERSION, documents: plan.documents, assets: [] },
            false,
            { library: plan.library },
          );
        const ids = new Set(plan.documents.map((doc) => doc.id));
        return structuredClone({
          ...plan,
          documents: state.documents.filter((doc) => ids.has(doc.id)),
        });
      });
    },
    getMeta: (id) =>
      serialize(() => {
        checkMetaKey(id);
        return Object.hasOwn(manifest.meta, id)
          ? { id, value: structuredClone(manifest.meta[id]) }
          : undefined;
      }),
    putMeta: async (id, value) => {
      const input = structuredClone(value);
      return serialize(async () => {
        const next = structuredClone(manifest);
        next.meta[id] = normalizeMeta(id, input);
        await commit(next);
      });
    },
    flush: () => queue,
  });
}
