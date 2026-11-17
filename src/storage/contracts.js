/**
 * Native IO uses relative object names only; it never accepts caller-selected absolute paths.
 * @typedef {Object} VaultIO
 * @property {string} directory
 * @property {() => Promise<void>} initialize Reject a non-atlas, nonempty root.
 * @property {(path:string) => Promise<Uint8Array|null>} read Null means missing, not unreadable.
 * @property {(data:Uint8Array) => Promise<string>} [hash] Native SHA-256; otherwise use Web Crypto.
 * @property {(path:string, data:Uint8Array, guard?:{expectedHash:string|null}) => Promise<void>} writeAtomic
 * Replace one complete file. Manifest writes must reject a mismatched expected hash.
 * A rejection means the destination was not committed; never reject after a successful replacement.
 *
 * @typedef {Object} VaultStore
 * @property {() => Promise<Array>} loadDocuments
 * @property {(document:Object) => Promise<void>} saveDocument
 * @property {() => Promise<Array>} loadAssets
 * @property {(id:string) => Promise<Object|undefined>} loadAsset
 * @property {(asset:Object) => Promise<void>} saveAsset
 * @property {(id:string) => Promise<Object|undefined>} getMeta
 * @property {(id:string, value:*) => Promise<void>} putMeta
 * @property {(archive:Object) => Promise<void>} saveImport Merge IDs in one commit.
 * @property {(command:Object) => Promise<Object>} [changeLibrary] Atomic logical folder/document metadata changes.
 */
export const STORE_METHODS = Object.freeze([
  'loadDocuments',
  'saveDocument',
  'loadAssets',
  'saveAsset',
  'loadAsset',
  'getMeta',
  'putMeta',
  'saveImport',
]);
export function assertStore(store) {
  for (const method of STORE_METHODS) {
    if (typeof store?.[method] !== 'function')
      throw new Error('The atlas storage adapter is missing ' + method + '.');
  }
  return store;
}
