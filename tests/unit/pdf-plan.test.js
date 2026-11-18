import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, insertObject as insert } from '../../src/domain/documents/scene.js';
import { startTextFlow, enableNativeComposition } from '../../src/domain/documents/text-flows.js';
import {
  createPDFSnapshot,
  intersectPDFRect,
  pdfRectInsidePolygon,
} from '../../src/features/export/pdf-plan.js';

const insertObject = (doc, type, options = {}) => {
  const { pageId = doc.pages[0].id, ...rest } = options;
  const item = insert(doc, type, pageId, rest);
  if (type === 'polygon') Object.assign(item, rest);
  return item;
};
test('frozen export rejects more native flow tokens than its recovery budget before rendering', () => {
  const doc = createSceneDocument('Bounded native publication');
  for (let index = 0; index < 257; index++) {
    const frame = insertObject(doc, 'text', { html: '<p>Text</p>' });
    enableNativeComposition(
      doc,
      startTextFlow(doc, frame.id, { automaticPages: false }),
      'single-line',
    );
  }
  assert.throws(() => createPDFSnapshot([doc], [], doc.id), /256 independently composed/);
});

test('PDF sharing freezes a deterministic linked closure without changing source documents', () => {
  const a = createSceneDocument('A'),
    b = createSceneDocument('B'),
    c = createSceneDocument('C');
  insertObject(a, 'text', { html: `<a data-doc-id="${b.id}">B</a> [[C]]` });
  insertObject(b, 'text', { html: `[[A]]` });
  const before = JSON.stringify([a, b, c]),
    snapshot = createPDFSnapshot([a, b, c], [], a.id, { includeLinked: true });
  assert.deepEqual(
    snapshot.documents.map((doc) => doc.id),
    [a.id, b.id, c.id],
  );
  snapshot.documents[0].title = 'Edited snapshot';
  assert.equal(JSON.stringify([a, b, c]), before);
  assert.deepEqual(
    createPDFSnapshot([a, b, c], [], a.id).documents.map((doc) => doc.id),
    [a.id],
  );
});
test('PDF export reports unsupported placements rather than exporting blank media', () => {
  const doc = createSceneDocument();
  insertObject(doc, 'pdf');
  assert.throws(() => createPDFSnapshot([doc], [], doc.id), /legacy PDF attachments/);
  doc.blocks = [];
  insertObject(doc, 'image', { src: 'https://example.com/image.png' });
  assert.throws(() => createPDFSnapshot([doc], [], doc.id), /store image/);
});
test('PDF hit regions obey page intersections and concave polygon masks', () => {
  assert.deepEqual(intersectPDFRect({ x: -3, y: 4, w: 10, h: 12 }, { x: 0, y: 0, w: 10, h: 10 }), {
    x: 0,
    y: 4,
    w: 7,
    h: 6,
  });
  const concave = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 6, y: 10 },
    { x: 6, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(pdfRectInsidePolygon({ x: 1, y: 1, w: 2, h: 2 }, concave), true);
  assert.equal(pdfRectInsidePolygon({ x: 1, y: 2, w: 8, h: 6 }, concave), false);
  assert.equal(
    pdfRectInsidePolygon({ x: 0, y: 0, w: 10, h: 10 }, [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]),
    false,
  );
});
