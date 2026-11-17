import { planLibraryChange } from '../domain/documents/library-commands.js';
import { validateImport } from '../domain/documents/schema.js';
import { CURRENT_ARCHIVE_VERSION } from '../domain/documents/capabilities.js';
/** Browser adapter. Version 4 preserves stores and closes stale clients before canonical textFlows are saved. */
export function createIndexedDBStore(indexedDB = globalThis.indexedDB) {
  let connection;
  async function open() {
    if (!indexedDB) throw new Error('Browser storage is unavailable.');
    if (!connection) {
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open('ivo-atlas', 4);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const name of ['documents', 'assets', 'meta']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            connection = undefined;
          };
          resolve(db);
        };
        request.onerror = () => {
          connection = undefined;
          reject(request.error);
        };
      });
    }
    return connection;
  }
  async function transaction(names, mode, perform) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let request, failure;
      try {
        request = perform(tx, (error) => {
          failure = error;
          tx.abort();
        });
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(failure || tx.error || new Error('Storage failed.'));
      tx.onabort = () => reject(failure || tx.error || new Error('Storage aborted.'));
    });
  }
  const single = (name, mode, perform) =>
    transaction(name, mode, (tx) => perform(tx.objectStore(name)));
  return Object.freeze({
    loadDocuments: () => single('documents', 'readonly', (s) => s.getAll()),
    saveDocument: (document) =>
      single('documents', 'readwrite', (s) => s.put(structuredClone(document))),
    loadAssets: () => single('assets', 'readonly', (s) => s.getAll()),
    loadAsset: (id) => single('assets', 'readonly', (s) => s.get(id)),
    saveAsset: (asset) => single('assets', 'readwrite', (s) => s.put(structuredClone(asset))),
    changeLibrary: (command) =>
      transaction(['documents', 'assets', 'meta'], 'readwrite', (tx, abort) => {
        const result = { result: null },
          requests = [
            tx.objectStore('documents').getAll(),
            tx.objectStore('assets').getAll(),
            tx.objectStore('meta').get('library:1'),
          ];
        let remaining = requests.length;
        for (const request of requests)
          request.onsuccess = () => {
            if (--remaining) return;
            try {
              const archive = validateImport({
                schemaVersion: CURRENT_ARCHIVE_VERSION,
                documents: requests[0].result,
                assets: requests[1].result,
              });
              const plan = planLibraryChange(archive.documents, requests[2].result?.value, command);
              if (plan.changed) {
                for (const document of plan.documents) tx.objectStore('documents').put(document);
                tx.objectStore('meta').put({ id: 'library:1', value: plan.library });
              }
              result.result = plan;
            } catch (error) {
              abort(error);
            }
          };
        return result;
      }),
    getMeta: (id) => single('meta', 'readonly', (s) => s.get(id)),
    putMeta: (id, value) =>
      single('meta', 'readwrite', (s) => s.put({ id, value: structuredClone(value) })),
    saveImport: (payload) =>
      transaction(['documents', 'assets', 'meta'], 'readwrite', (tx) => {
        for (const doc of payload.documents) tx.objectStore('documents').put(structuredClone(doc));
        for (const asset of payload.assets || [])
          tx.objectStore('assets').put(structuredClone(asset));
        tx.objectStore('meta').put({ id: 'initialized', value: true });
      }),
  });
}
