import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
const assert = (value, message) => {
    if (!value) throw Error(message);
  },
  tick = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  wait = async (predicate, message = 'Window refresh timeout') => {
    for (let i = 0; i < 300; i++) {
      if (predicate()) return;
      await tick();
    }
    throw Error(
      message +
        ' · ' +
        document.querySelector('#toast').textContent +
        ' · ' +
        document.querySelector('#app').textContent.slice(0, 350),
    );
  };
const make = (id, title, text) => {
    const doc = createSceneDocument(title);
    doc.id = id;
    const frame = insertObject(doc, 'text', doc.pages[0].id, {
      x: 48,
      y: 48,
      w: 516,
      h: 696,
      html: '<p>' + text + '</p>',
    });
    startTextFlow(doc, frame.id);
    return doc;
  },
  a = make('refresh-a', 'Alpha', 'Alpha original source.'),
  b = make('refresh-b', 'Beta', 'Beta original source.');
const documents = new Map([
    [a.id, a],
    [b.id, b],
  ]),
  assets = new Map(),
  meta = new Map([
    ['initialized', true],
    [
      'workspace:1',
      {
        version: 1,
        tabs: [
          {
            id: 'refresh-tab',
            kind: 'document',
            docId: a.id,
            editing: true,
            canvasState: {
              activeTextId: a.blocks[0].id,
              activePage: a.pages[0].id,
              tool: 'text',
              selection: [a.blocks[0].id],
              camera: { x: 0, y: 0, zoom: 0.8 },
            },
          },
        ],
        active: 'refresh-tab',
      },
    ],
  ]);
let command,
  close,
  releaseWindow,
  windowState,
  storeChanged,
  nativeHistory,
  storeLease = true,
  passiveWrites = 0,
  documentWrites = 0,
  assetLoads = 0,
  holdNextDocuments = false,
  heldRead,
  finishHeld,
  heldCompleted = false;
const cloneDocuments = () => structuredClone([...documents.values()]),
  cloneAssets = () => structuredClone([...assets.values()]);
globalThis.ivoNative = {
  platform: 'macos',
  zoomFactor: () => 1,
  onCommand: (callback) => (command = callback),
  onPrepareClose: (callback) => (close = callback),
  onPrepareWindowRelease: (callback) => (releaseWindow = callback),
  onWindowState: (callback) => (windowState = callback),
  onStoreChanged: (callback) => (storeChanged = callback),
  updateHistory: (value) => (nativeHistory = value),
  store: {
    loadDocuments: async () => {
      const captured = cloneDocuments();
      if (holdNextDocuments) {
        holdNextDocuments = false;
        heldRead = structuredClone(captured);
        await new Promise((resolve) => (finishHeld = resolve));
        heldCompleted = true;
      }
      return captured;
    },
    loadAssets: async () => {
      assetLoads++;
      return cloneAssets();
    },
    loadAsset: async (id) => structuredClone(assets.get(id) || null),
    saveAsset: async (value) => {
      if (!storeLease) {
        passiveWrites++;
        throw Error('Passive window attempted asset write');
      }
      assets.set(value.id, structuredClone(value));
    },
    saveDocument: async (doc) => {
      if (!storeLease) {
        passiveWrites++;
        throw Error('Passive window attempted source write');
      }
      validateImport({ schemaVersion: 5, documents: [doc], assets: cloneAssets() });
      documentWrites++;
      documents.set(doc.id, structuredClone(doc));
    },
    getMeta: async (key) =>
      meta.has(key) ? { id: key, value: structuredClone(meta.get(key)) } : null,
    putMeta: async (key, value) => meta.set(key, structuredClone(value)),
    saveImport: async () => {},
  },
};
const source = () => document.querySelector('.workspace-pane.active .canvas-flow-input'),
  row = (id) => document.querySelector(`#document-list [data-open="${id}"]`),
  active = () => document.querySelector('.workspace-pane.active');
async function openSource() {
  await command('document-text');
  await wait(() => source()?.isContentEditable);
  source().focus();
}
async function replace(value) {
  await openSource();
  document.execCommand('selectAll');
  assert(document.execCommand('insertText', false, value), 'Native editing insertion failed');
  await tick();
  assert((await close()) === true, 'Source did not flush');
}
async function relinquish() {
  assert((await releaseWindow()) === true, 'Window lease did not release');
  storeLease = false;
  await tick();
  assert(
    document.querySelector('#app').inert && !source().isContentEditable,
    'Passive source retained edit ownership',
  );
}
async function grant() {
  storeLease = true;
  await windowState({ active: true, documents: cloneDocuments(), assets: cloneAssets() });
  await tick();
  assert(!document.querySelector('#app').inert, 'Window did not regain ownership');
}
function externalText(id, text) {
  const next = structuredClone(documents.get(id));
  next.textFlows[0].html = '<p>' + text + '</p>';
  next.version = (next.version || 1) + 1;
  next.updatedAt = new Date().toISOString();
  documents.set(id, next);
  return next;
}
async function insertLink(id, label) {
  await openSource();
  const range = document.createRange();
  range.selectNodeContents(source());
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  const pending = command('link');
  await wait(
    () =>
      document.querySelector('#dialog').open && document.querySelector(`[data-link-to="${id}"]`),
    'Updated document did not appear in link chooser',
  );
  assert(
    document.querySelector(`[data-link-to="${id}"]`).textContent === label,
    'Link chooser retained stale title',
  );
  document.querySelector(`[data-link-to="${id}"]`).click();
  await pending;
  await tick();
  assert(
    source().querySelector(`a[data-doc-id="${id}"]`)?.textContent === label,
    'Retained editor used stale document collection after refresh',
  );
  assert((await close()) === true, 'Inserted link did not flush');
}
try {
  await import('../../../src/app/main.js');
  await wait(() => source()?.isContentEditable);
  await wait(() => document.hasFocus());
  assert(
    releaseWindow && windowState && storeChanged,
    'Window lifecycle callbacks were not registered',
  );
  await replace('Alpha locally edited.');
  const retainedSource = source(),
    retainedWorld = active().querySelector('.canvas-world');
  assert(nativeHistory.canUndo, 'Own edit did not create undo');
  await relinquish();
  const unchangedA = structuredClone(documents.get(a.id)),
    renamedB = structuredClone(documents.get(b.id));
  renamedB.title = 'Beta externally renamed';
  renamedB.textFlows[0].html = '<p>Beta changed elsewhere.</p>';
  renamedB.version++;
  documents.set(b.id, renamedB);
  const added = make('refresh-new', 'New external note', 'External note source.');
  documents.set(added.id, added);
  const writesBeforePassive = documentWrites;
  storeChanged({ method: 'saveDocument' });
  await wait(
    () => row(added.id) && row(b.id)?.textContent.includes('Beta externally renamed'),
    'Passive navigation did not refresh',
  );
  assert(
    source() === retainedSource && active().querySelector('.canvas-world') === retainedWorld,
    'Unchanged active document controller was replaced by other-note refresh',
  );
  assert(
    JSON.stringify(documents.get(a.id)) === JSON.stringify(unchangedA) &&
      documentWrites === writesBeforePassive &&
      passiveWrites === 0,
    'Passive refresh wrote authored source',
  );
  await grant();
  await openSource();
  assert(
    source() === retainedSource && active().querySelector('.canvas-world') === retainedWorld,
    'Unchanged controller was not retained on lease grant',
  );
  assert(nativeHistory.canUndo, 'Unchanged active document lost its own undo');
  await command('undo');
  await tick();
  assert(
    source().textContent === 'Alpha original source.',
    'Retained undo did not restore own prior source',
  );
  await command('redo');
  await tick();
  assert(
    source().textContent === 'Alpha locally edited.',
    'Retained redo did not restore own edit',
  );
  await insertLink(added.id, 'New external note');
  await insertLink(b.id, 'Beta externally renamed');
  assert(
    documents.get(a.id).textFlows[0].html.includes('data-doc-id="' + added.id + '"') &&
      documents.get(a.id).textFlows[0].html.includes('Beta externally renamed'),
    'Saved links lost new/renamed targets',
  );
  // Capture an old passive read, reacquire with newer canonical text, then type before that old read returns.
  await relinquish();
  externalText(a.id, 'Remote P1 stale snapshot.');
  holdNextDocuments = true;
  storeChanged({ method: 'saveDocument' });
  await wait(() => heldRead && finishHeld, 'Passive document read was not held');
  assert(
    heldRead.find((doc) => doc.id === a.id).textFlows[0].html ===
      '<p>Remote P1 stale snapshot.</p>',
    'Held read did not capture the old source',
  );
  externalText(a.id, 'Remote P2 grant source.');
  await grant();
  await openSource();
  assert(
    source().textContent === 'Remote P2 grant source.',
    'Lease grant did not install newest canonical source',
  );
  assert(!nativeHistory.canUndo, 'Changed active source retained stale pre-grant undo');
  await replace('Own P3 after grant.');
  assert(
    nativeHistory.canUndo && documents.get(a.id).textFlows[0].html.includes('Own P3 after grant.'),
    'Post-grant own edit did not save/create undo',
  );
  finishHeld();
  await wait(() => heldCompleted);
  await tick();
  assert(
    source().textContent === 'Own P3 after grant.' &&
      documents.get(a.id).textFlows[0].html.includes('Own P3 after grant.'),
    'Late passive read overwrote post-grant source',
  );
  await command('undo');
  await tick();
  assert(
    source().textContent === 'Remote P2 grant source.',
    'Late passive read corrupted own undo baseline',
  );
  await command('redo');
  await tick();
  assert(source().textContent === 'Own P3 after grant.', 'Own redo lost after late passive read');
  assert((await close()) === true, 'Own race result did not save');
  // An asset notification followed by a document notification must not lose the pending asset refresh.
  await relinquish();
  const image = {
    id: 'refresh-image',
    name: 'New original.png',
    mimeType: 'image/png',
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGN49vorVmSUsgUrYhjVQBMNuCRwGTSqgSYaACk0CB+bcN8GAAAAAElFTkSuQmCC',
  };
  assets.set(image.id, image);
  const imageDoc = structuredClone(documents.get(a.id)),
    placed = insertObject(imageDoc, 'image', imageDoc.pages[0].id, {
      x: 80,
      y: 350,
      w: 90,
      h: 90,
      src: 'asset:' + image.id,
    });
  imageDoc.version++;
  documents.set(a.id, imageDoc);
  const loadsBefore = assetLoads;
  storeChanged({ method: 'saveAsset' });
  storeChanged({ method: 'saveDocument' });
  await wait(
    () =>
      assetLoads > loadsBefore &&
      document.querySelector(`[data-object="${placed.id}"] img`)?.src === image.data,
    'Burst notifications lost newly referenced original media',
  );
  const imageElement = document.querySelector(`[data-object="${placed.id}"] img`);
  await wait(
    () => imageElement.complete && imageElement.naturalWidth === 16,
    'Refreshed media did not decode original pixels',
  );
  assert(
    !source().isContentEditable && passiveWrites === 0,
    'Passive asset refresh gained source write ownership',
  );
  await grant();
  await openSource();
  assert(
    source().textContent === 'Own P3 after grant.' &&
      document.querySelector(`[data-object="${placed.id}"] img`).src === image.data,
    'Final grant lost authored source or original image',
  );
  assert((await close()) === true, 'Final refreshed source did not flush');
  assert(
    passiveWrites === 0 && assets.get(image.id).data === image.data,
    'Refresh wrote passive source or changed original media',
  );
  console.log(
    'IVO_WINDOW_REFRESH_RESULT:' +
      JSON.stringify({
        ok: true,
        passiveRefreshRetainsUnchangedController: true,
        unchangedSourceRetainsUndo: true,
        retainedEditorUsesNewAndRenamedLinkTargets: true,
        changedSourceClearsStaleUndo: true,
        heldPassiveSnapshotCannotOverwriteNewGrant: true,
        postGrantOwnUndoRedoIntact: true,
        assetDocumentBurstRetainsOriginalMedia: true,
        noPassiveSourceWrites: true,
      }),
  );
} catch (error) {
  console.log(
    'IVO_WINDOW_REFRESH_RESULT:' + JSON.stringify({ error: error.stack || error.message }),
  );
}
