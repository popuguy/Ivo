import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneDocument, insertObject, addPage } from '../../src/domain/documents/scene.js';
import {
  enablePublishing,
  addLayer,
  moveToLayer,
  layerFor,
  orderedPageObjects,
  objectAvailable,
  removeLayer,
  saveTextStyle,
  resolvedTextStyle,
  createParent,
  applyParent,
  parentObjects,
  overrideParent,
  commitParentDefinition,
} from '../../src/domain/documents/publishing.js';
import { marqueeSelection } from '../../src/domain/geometry/selection.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { inspectFont } from '../../src/domain/text/fonts.js';
import { createFileVault } from '../../src/storage/file-vault.js';
const fixture = () => {
  const doc = createSceneDocument('Publishing');
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<p>Fabric and proportion.</p>',
    x: 12.5,
    y: 40,
    w: 240,
    h: 180,
  });
  return { doc, frame };
};
const roundTrip = (doc) =>
  validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] })
    .documents[0];

test('layers control paint order, visibility and selection without deleting source', () => {
  const { doc, frame } = fixture(),
    original = frame.html,
    p = enablePublishing(doc),
    upper = addLayer(doc, 'Annotations');
  const second = insertObject(doc, 'polygon', frame.pageId, { x: 10, y: 10 });
  moveToLayer(doc, [second.id], upper.id);
  assert.deepEqual(
    orderedPageObjects(doc, frame.pageId).map((b) => b.id),
    [frame.id, second.id],
  );
  upper.locked = true;
  assert.equal(objectAvailable(doc, second), false);
  assert.equal(objectAvailable(doc, second, { editing: false }), true);
  assert.ok(!marqueeSelection(doc, { x: 0, y: 0, w: 1000, h: 1000 }).includes(second.id));
  upper.visible = false;
  assert.ok(!orderedPageObjects(doc, frame.pageId).includes(second));
  assert.equal(frame.html, original);
  upper.visible = true;
  upper.locked = false;
  removeLayer(doc, upper.id);
  assert.equal(layerFor(doc, second).id, p.layers[0].id);
  assert.equal(roundTrip(doc).blocks[0].x, 12.5);
  assert.equal(archiveVersion([doc]), 6);
  assert.throws(
    () => validateImport({ schemaVersion: 5, documents: [doc], assets: [] }),
    /schema 6/,
  );
});

test('sparse text styles inherit with local ownership and reject cycles atomically', () => {
  const { doc, frame } = fixture();
  const body = saveTextStyle(doc, 'paragraph', {
    name: 'Body',
    attributes: { textStyle: 'cmu-serif', fontSize: 12, leading: 0, autoLeading: 120 },
  });
  const heading = saveTextStyle(doc, 'paragraph', {
    name: 'Heading',
    basedOn: body.id,
    attributes: { fontSize: 24, paragraphAfter: 8 },
  });
  assert.deepEqual(resolvedTextStyle(doc, 'paragraph', heading.id), {
    textStyle: 'cmu-serif',
    fontSize: 24,
    leading: 0,
    autoLeading: 120,
    paragraphAfter: 8,
  });
  const before = JSON.stringify(doc);
  assert.throws(() => saveTextStyle(doc, 'paragraph', { ...body, basedOn: heading.id }), /cycle/);
  assert.equal(JSON.stringify(doc), before);
  frame.html = `<p data-ivo-pstyle="${heading.id}"><span data-ivo-highlight="#fff176">Proportion</span></p>`;
  const normalized = roundTrip(doc);
  assert.equal(normalized.blocks[0].html, frame.html);
  assert.equal(normalized.publishing.paragraphStyles[1].attributes.fontSize, 24);
  const copy = copyDocument(doc);
  validateImport({ schemaVersion: 6, documents: [doc, copy], assets: [] });
  assert.notEqual(copy.publishing.paragraphStyles[0].id, body.id);
  assert.ok(copy.blocks[0].html.includes(copy.publishing.paragraphStyles[1].id));
});

test('parents retain shared definitions, derive instances, override independently and copy with remapped IDs', () => {
  const { doc, frame } = fixture(),
    parent = createParent(doc, frame.pageId, 'Layout'),
    page = addPage(doc, frame.pageId);
  applyParent(doc, page.id, parent.id);
  assert.equal(parent.prefix, 'A');
  const instances = parentObjects(doc, page);
  assert.equal(instances[0].html, frame.html);
  assert.notEqual(instances[0].id, parent.blocks[0].id);
  parent.blocks[0].html = '<p>Shared header</p>';
  assert.equal(parentObjects(doc, page)[0].html, '<p>Shared header</p>');
  const ids = overrideParent(doc, page.id);
  assert.equal(parentObjects(doc, page).length, 0);
  assert.equal(doc.blocks.find((b) => b.id === ids[0]).parentOriginId, parent.blocks[0].id);
  const normalized = roundTrip(doc);
  assert.equal(normalized.publishing.parents[0].blocks[0].html, '<p>Shared header</p>');
  validateImport({ schemaVersion: 6, documents: [doc, copyDocument(doc)], assets: [] });
  const sharedLayer = addLayer(doc, 'Shared artwork');
  parent.blocks[0].layerId = sharedLayer.id;
  removeLayer(doc, sharedLayer.id);
  assert.equal(parent.blocks[0].layerId, doc.publishing.layers[0].id);
  roundTrip(doc);
});

test('parent session commits reconcile shared layers across page artwork and all definitions atomically', () => {
  const { doc, frame } = fixture(),
    sharedLayer = addLayer(doc, 'Shared'),
    parent = createParent(doc, frame.pageId, 'Original'),
    another = createParent(doc, frame.pageId, 'Other');
  frame.layerId = sharedLayer.id;
  parent.blocks[0].layerId = sharedLayer.id;
  another.blocks[0].layerId = sharedLayer.id;
  const edited = structuredClone(doc);
  edited.pages = [{ id: parent.id, name: 'Revised', width: parent.width, height: parent.height }];
  edited.blocks = structuredClone(parent.blocks).map((b) => ({ ...b, pageId: parent.id }));
  removeLayer(edited, sharedLayer.id);
  edited.blocks[0].fontSize = 28;
  assert.equal(frame.layerId, sharedLayer.id);
  commitParentDefinition(doc, parent.id, edited);
  assert.equal(doc.publishing.parents[0].name, 'Revised');
  assert.equal(doc.publishing.parents[0].blocks[0].fontSize, 28);
  assert.equal(doc.blocks[0].layerId, doc.publishing.layers[0].id);
  assert.equal(doc.publishing.parents[1].blocks[0].layerId, doc.publishing.layers[0].id);
  roundTrip(doc);
  const before = JSON.stringify(doc);
  edited.blocks = Array.from({ length: 1000 }, () => structuredClone(edited.blocks[0]));
  assert.throws(() => commitParentDefinition(doc, parent.id, edited), /object limit/);
  assert.equal(JSON.stringify(doc), before);
});

test('font identity and embedding restrictions come from font bytes; assets survive native vault round-trip', async () => {
  const bytes = await readFile(new URL('../../public/fonts/cmu-serif/cmunrm.ttf', import.meta.url)),
    font = inspectFont(bytes);
  assert.equal(font.family, 'CMU Serif');
  assert.equal(font.mimeType, 'font/ttf');
  assert.ok(font.features.includes('liga'));
  const bad = new Uint8Array(bytes);
  const v = new DataView(bad.buffer);
  for (let i = 0; i < v.getUint16(4); i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...bad.slice(at, at + 4)) === 'OS/2') {
      v.setUint16(v.getUint32(at + 8) + 8, 2);
      break;
    }
  }
  assert.throws(() => inspectFont(bad), /restricted/);
  assert.throws(() => inspectFont(new Uint8Array(30)), /single/);
  const id = 'font-' + createHash('sha256').update(bytes).digest('hex'),
    asset = {
      id,
      name: 'cmunrm.ttf',
      mimeType: font.mimeType,
      data: `data:${font.mimeType};base64,${bytes.toString('base64')}`,
    },
    files = new Map();
  const io = {
    initialize: async () => {},
    read: async (key) => files.get(key) || null,
    writeAtomic: async (key, value) => files.set(key, new Uint8Array(value)),
  };
  const vault = await createFileVault(io);
  await vault.saveAsset(asset);
  const { doc, frame } = fixture();
  enablePublishing(doc);
  frame.textStyle = id;
  await vault.saveDocument(doc);
  const reopened = await createFileVault(io),
    assets = await reopened.loadAssets(),
    docs = await reopened.loadDocuments();
  assert.equal(assets[0].data, asset.data);
  assert.equal(assets[0].font.family, font.family);
  assert.equal(docs[0].blocks[0].textStyle, id);
  assert.throws(
    () => validateImport({ schemaVersion: 6, documents: [doc], assets: [] }),
    /missing vault font/,
  );
});

test('frozen archive 5 stays readable without an implicit rewrite or publishing upgrade', async () => {
  const bytes = await readFile(new URL('../fixtures/legacy/archive-v5.json', import.meta.url)),
    input = JSON.parse(bytes),
    before = JSON.stringify(input);
  const normalized = validateImport(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(normalized.documents[0].canvasVersion, 4);
  assert.equal(archiveVersion(normalized.documents), 5);
  assert.equal(normalized.documents[0].blocks[0].x, 48.125);
  assert.ok(!normalized.documents[0].publishing);
});

test('numeric transform references retain their chosen fractional anchor', async () => {
  const { referencePoint, editReferenceRect } =
    await import('../../src/domain/geometry/transform-reference.js');
  const rect = { x: 48.125, y: 63.75, w: 140.5, h: 82.125 };
  for (let i = 0; i < 9; i++) {
    const anchor = referencePoint(rect, i),
      resized = editReferenceRect(rect, 'w', 227.75, i);
    assert.deepEqual(referencePoint(resized, i), anchor);
    const moved = editReferenceRect(rect, 'x', 200.125, i);
    assert.equal(referencePoint(moved, i).x, 200.125);
  }
});

test('font registration publishes atomically and rejects stale passive generations', async () => {
  const { prepareVaultFonts } = await import('../../src/rendering/text/fonts.js');
  const oldDocument = globalThis.document,
    oldFace = globalThis.FontFace,
    faces = new Set();
  let finishOld;
  globalThis.document = {
    fonts: { add: (face) => faces.add(face), delete: (face) => faces.delete(face) },
  };
  globalThis.FontFace = class {
    constructor(family, source) {
      this.family = family;
      this.source = typeof source === 'string' ? source : new TextDecoder().decode(source);
    }
    load() {
      if (this.source.includes('delayed'))
        return new Promise((resolve) => {
          finishOld = () => resolve(this);
        });
      if (this.source.includes('invalid')) return Promise.reject(new Error('Font decode failed'));
      return Promise.resolve(this);
    }
  };
  const asset = (id, data) => ({
    id,
    mimeType: 'font/ttf',
    font: { family: id, weight: 400, axes: [], italic: false },
    data: 'data:font/ttf;base64,' + btoa(data),
  });
  try {
    await prepareVaultFonts([asset('a', 'working')]);
    assert.equal(faces.size, 1);
    const old = prepareVaultFonts([asset('b', 'delayed')]);
    await prepareVaultFonts([asset('c', 'current')]);
    finishOld();
    assert.equal(await old, false);
    assert.equal([...faces][0].family, 'ivo-c');
    await assert.rejects(prepareVaultFonts([asset('d', 'invalid')]), /decode/);
    assert.equal([...faces][0].family, 'ivo-c');
    await prepareVaultFonts([]);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldFace === undefined) delete globalThis.FontFace;
    else globalThis.FontFace = oldFace;
  }
});
