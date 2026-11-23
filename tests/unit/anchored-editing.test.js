import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSceneDocument,
  insertObject,
  duplicateObjects,
  addPage,
  removePage,
  removeObject,
} from '../../src/domain/documents/scene.js';
import {
  anchorObject,
  anchoredObjectIds,
  anchorObjectMarker,
  setAnchorYOffset,
} from '../../src/domain/documents/anchored-objects.js';
import { startTextFlow, threadFrame } from '../../src/domain/documents/text-flows.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import { archiveVersion, markTypographyVersion } from '../../src/domain/documents/capabilities.js';
import {
  copyObjectSelection,
  pasteObjectSelection,
  readObjectClipboard,
} from '../../src/domain/documents/clipboard.js';
import {
  copyInlineSelection,
  prepareInlinePaste,
} from '../../src/domain/documents/inline-clipboard.js';
import { validateImport } from '../../src/domain/documents/schema.js';

const asset = {
  id: 'weave',
  kind: 'image',
  mimeType: 'image/png',
  name: 'weave.png',
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yOG8AAAAASUVORK5CYII=',
};
function fixture() {
  const doc = createSceneDocument('Swatches');
  const page = doc.pages[0].id;
  const text = insertObject(doc, 'text', page);
  const shape = insertObject(doc, 'polygon', page, { clip: true });
  const image = insertObject(doc, 'image', page, { parentId: shape.id, src: 'asset:weave' });
  anchorObject(doc, shape, text.id);
  const html = 'Blue ' + anchorObjectMarker(shape.id) + ' twill.';
  text.html = '<p>' + html + '</p>';
  return { doc, text, shape, image, html };
}
function check(doc) {
  return validateImport({
    schemaVersion: archiveVersion([doc]),
    documents: [doc],
    assets: [asset],
  });
}
test('a threaded selection, a whole document and a pasted range own independent copies of their masked art', () => {
  const { doc, text, shape, html } = fixture();
  const flow = startTextFlow(doc, text.id);
  assert.equal(shape.extensions.ivoAnchor.ownerId, flow.id);
  const page = addPage(doc, doc.pages[0].id);
  const tail = insertObject(doc, 'text', page.id, { html: '' });
  threadFrame(doc, text.id, tail.id);
  const [dup] = duplicateObjects(doc, [tail.id]);
  const dupFlow = doc.textFlows.find((f) => f.id === dup.textFlowId);
  assert.notEqual(anchoredObjectIds(dupFlow.html)[0], shape.id);
  assert.equal(dupFlow.frameIds.length, 1);
  check(doc);
  const independently = copyDocument(doc);
  check(independently);
  assert.equal(independently.blocks.filter((b) => b.extensions?.ivoAnchor).length, 2);
  const destination = createSceneDocument('Destination');
  const target = insertObject(destination, 'text', destination.pages[0].id);
  for (let i = 0; i < 2; i++) {
    const payload = copyInlineSelection(doc, tail, html, [asset]);
    assert.equal(payload.archive.assets.length, 1);
    const inserted = prepareInlinePaste(
      destination,
      readObjectClipboard(JSON.stringify(payload)),
      target.id,
      true,
    );
    targetFrom(destination, target.id).html += '<p>' + inserted + '</p>';
  }
  check(destination);
  assert.equal(new Set(anchoredObjectIds(targetFrom(destination, target.id).html)).size, 2);
  assert.equal(destination.blocks.filter((b) => b.parentId).length, 2);
});
function targetFrom(doc, id) {
  return doc.blocks.find((b) => b.id === id);
}

test('direct graphic copying detaches it, while pasting one page graphic into text anchors it anew', () => {
  const { doc, shape, text } = fixture();
  const payload = copyObjectSelection(doc, [shape.id], [asset]);
  assert.ok(!payload.archive.documents[0].blocks.some((b) => b.extensions?.ivoAnchor));
  const [free] = pasteObjectSelection(doc, payload.archive, { pageId: doc.pages[0].id });
  assert.ok(!free.extensions?.ivoAnchor);
  const inserted = prepareInlinePaste(doc, payload.archive, text.id, false);
  targetFrom(doc, text.id).html += inserted;
  check(doc);
  removeObject(doc, shape.id);
  assert.ok(!targetFrom(doc, text.id).html.includes(shape.id));
  check(doc);
});
test('removing the original page retains graphics in surviving text, deleting the final frame removes them together', () => {
  const { doc, text, shape, image } = fixture();
  const page = addPage(doc, doc.pages[0].id);
  const tail = insertObject(doc, 'text', page.id, { html: '' });
  threadFrame(doc, text.id, tail.id);
  removePage(doc, doc.pages[0].id);
  assert.equal(shape.pageId, page.id);
  assert.equal(image.pageId, page.id);
  check(doc);
  removeObject(doc, tail.id);
  assert.equal(doc.blocks.length, 0);
  check(doc);
});
test('the newest format is required only for the features present and the prior endnote archive reopens untouched', async () => {
  const archive = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v35.json', import.meta.url)),
  );
  assert.deepEqual(validateImport(archive), archive);
  assert.equal(archiveVersion(archive.documents), 35);
  const { doc, text } = fixture();
  assert.equal(check(doc).schemaVersion, 37);
  assert.throws(() => validateImport({ ...check(doc), schemaVersion: 36 }), /archive 37/);
  text.html = '<p>Missing its object</p>';
  assert.throws(() => check(doc), /marker/);
  const clean = createSceneDocument('Fresh note');
  const plain = insertObject(clean, 'text', clean.pages[0].id, { html: '<p>Ordinary text</p>' });
  assert.ok(archiveVersion([clean]) < 36);
  plain.html = '<p>See <span data-footnote="Woven%20sample">1</span></p>';
  markTypographyVersion(clean);
  assert.equal(check(clean).schemaVersion, 36);
});

test('an anchored graphic keeps its signed baseline offset through saving and copying', async () => {
  const previous = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v38.json', import.meta.url)),
  );
  assert.deepEqual(validateImport(previous), previous);
  assert.equal(archiveVersion(previous.documents), 38);
  const { doc, shape } = fixture();
  for (const offset of [8.75, -12.5]) {
    setAnchorYOffset(doc, shape, offset);
    const saved = check(doc);
    assert.equal(saved.schemaVersion, 39);
    assert.equal(
      check(copyDocument(saved.documents[0])).documents[0].blocks.find(
        (b) => b.extensions?.ivoAnchor,
      ).extensions.ivoAnchor.yOffset,
      offset,
    );
    assert.throws(() => validateImport({ ...saved, schemaVersion: 38 }), /archive 39/);
  }
  assert.throws(() => setAnchorYOffset(doc, shape, Infinity), /offset/);
  setAnchorYOffset(doc, shape, 0);
  assert.equal('yOffset' in shape.extensions.ivoAnchor, false);
  assert.equal(check(doc).schemaVersion, 39);
});
