import { validateImport } from '../../../src/domain/documents/schema.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { createIndexedDBStore } from '../../../src/storage/indexeddb.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { markTypographyVersion } from '../../../src/domain/documents/capabilities.js';
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  const legacy = { id: 'legacy', title: 'Preserved', blocks: [], version: 5 },
    asset = { id: 'original', data: 'original bytes' },
    history = { id: 'history:legacy', value: [legacy] };
  const old = await new Promise((resolve, reject) => {
    const request = indexedDB.open('ivo-atlas', 3);
    request.onupgradeneeded = () => {
      for (const name of ['documents', 'assets', 'meta'])
        request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = old.transaction(['documents', 'assets', 'meta'], 'readwrite');
    tx.objectStore('documents').put(legacy);
    tx.objectStore('assets').put(asset);
    tx.objectStore('meta').put(history);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  let staleClosed = false;
  old.onversionchange = () => {
    old.close();
    staleClosed = true;
  };
  const current = createIndexedDBStore();
  assert(
    JSON.stringify(await current.loadDocuments()) === JSON.stringify([legacy]),
    'Upgrade changed original documents',
  );
  assert(staleClosed, 'Upgrade did not close stale connection');
  assert(
    JSON.stringify(await current.loadAssets()) === JSON.stringify([asset]),
    'Upgrade changed original asset bytes',
  );
  assert(
    JSON.stringify(await current.getMeta('history:legacy')) === JSON.stringify(history),
    'Upgrade changed original history',
  );
  const oldRejected = await new Promise((resolve) => {
    const request = indexedDB.open('ivo-atlas', 3);
    request.onerror = () => resolve(request.error.name === 'VersionError');
    request.onsuccess = () => {
      request.result.close();
      resolve(false);
    };
  });
  assert(oldRejected, 'Old browser client could still open typography-capable data');
  const styled = createSceneDocument('Rich'),
    text = insertObject(styled, 'text', styled.pages[0].id, {
      fontSize: 20,
      leading: 24,
      html: '<p><span data-ivo-size="28" style="font-size:28px">Typed</span></p>',
    });
  markTypographyVersion(styled);
  await current.saveDocument(styled);
  const reread = (await current.loadDocuments()).find((d) => d.id === styled.id);
  assert(
    reread.canvasVersion === 2 &&
      reread.blocks[0].html === text.html &&
      reread.blocks[0].leading === 24,
    'New typography did not survive browser persistence',
  );
  const textFlowHTML = text.html;
  startTextFlow(styled, text.id);
  await current.saveDocument(styled);
  const flow = (await current.loadDocuments()).find((d) => d.id === styled.id);
  assert(
    flow.canvasVersion === 4 && flow.textFlows[0].html === textFlowHTML,
    'Canonical textFlow did not survive browser persistence',
  );
  const legacyArchive = await (
    await fetch(new URL('../../fixtures/legacy/archive-v4.json', import.meta.url))
  ).json();
  await current.saveImport(legacyArchive);
  const raw = (await current.loadDocuments()).find(
    (doc) => doc.id === legacyArchive.documents[0].id,
  );
  const converted = validateImport({
    schemaVersion: 5,
    documents: [raw],
    assets: legacyArchive.assets,
  });
  assert(
    converted.documents[0].textFlows[0].html === legacyArchive.documents[0].stories[0].html,
    'Legacy browser text changed',
  );
  assert(
    JSON.stringify(raw) === JSON.stringify(legacyArchive.documents[0]),
    'Reading migration rewrote stored source',
  );
  await current.saveDocument(converted.documents[0]);
  const canonical = (await current.loadDocuments()).find((doc) => doc.id === raw.id);
  assert(
    canonical.canvasVersion === 4 && !('stories' in canonical),
    'New browser writes did not use canonical fields',
  );
  console.log(
    'IVO_BROWSER_STORE_RESULT:' +
      JSON.stringify({
        ok: true,
        preservedDocuments: true,
        preservedAssets: true,
        preservedHistory: true,
        staleClientClosed: true,
        oldClientRejected: true,
        typographyRoundTrip: true,
        canonicalTextFlowRoundTrip: true,
        legacyTextMigration: true,
        readMigrationDoesNotWrite: true,
      }),
  );
} catch (error) {
  console.log(
    'IVO_BROWSER_STORE_RESULT:' + JSON.stringify({ error: error.stack || error.message }),
  );
}
