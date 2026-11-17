import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneDocument,
  addPage,
  insertObject,
  reorderPage,
  pagePositions,
  worldRect,
  moveObjectToPage,
  transferObjectsAtDrop,
} from '../../src/domain/documents/scene.js';
import { validateImport } from '../../src/domain/documents/schema.js';
const globalRect = (doc, object) => {
  const p = pagePositions(doc.pages).find((p) => p.id === object.pageId),
    r = worldRect(doc, object);
  return { ...r, x: p.x + r.x, y: p.y + r.y };
};
test('Page reorder changes pagination, retaining IDs, clipping hierarchy and local geometry', () => {
  const doc = createSceneDocument(),
    first = doc.pages[0],
    second = addPage(doc, first.id);
  second.width = 800.25;
  const mask = insertObject(doc, 'polygon', first.id),
    _child = insertObject(doc, 'text', first.id, {
      parentId: mask.id,
      html: '<p>Original source</p>',
    }),
    before = structuredClone(doc.blocks);
  assert.equal(reorderPage(doc, second.id, 0), true);
  assert.equal(doc.pages[0].id, second.id);
  assert.deepEqual(doc.blocks, before);
  assert.equal(reorderPage(doc, second.id, 0), false);
  validateImport({ schemaVersion: 2, documents: [doc], assets: [] });
});
test('Dropping a mask into another page preserves world placement, descendants and source', () => {
  const doc = createSceneDocument(),
    first = doc.pages[0],
    second = addPage(doc, first.id),
    offset = pagePositions(doc.pages)[1].y;
  const mask = insertObject(doc, 'polygon', first.id, {
      x: 40.25,
      y: offset + 50.5,
      w: 100,
      h: 80,
    }),
    child = insertObject(doc, 'text', first.id, {
      parentId: mask.id,
      x: 10,
      y: 15,
      html: '<p><strong>Retained</strong></p>',
    }),
    before = globalRect(doc, child),
    source = child.html;
  assert.equal(transferObjectsAtDrop(doc, [mask.id]), 1);
  assert.equal(mask.pageId, second.id);
  assert.equal(child.pageId, second.id);
  assert.deepEqual(globalRect(doc, child), before);
  assert.equal(child.html, source);
  assert.equal(mask.y, 50.5);
  assert.equal(child.parentId, mask.id);
  validateImport({ schemaVersion: 2, documents: [doc], assets: [] });
  child.y = offset * 2;
  assert.equal(transferObjectsAtDrop(doc, [child.id]), 0);
  assert.equal(child.parentId, mask.id);
});
test('Explicit page transfer detaches content using its page-local placement and retains originals', () => {
  const doc = createSceneDocument(),
    first = doc.pages[0],
    second = addPage(doc, first.id),
    mask = insertObject(doc, 'polygon', first.id, { x: 50, y: 70 }),
    child = insertObject(doc, 'text', first.id, {
      parentId: mask.id,
      x: 10,
      y: 12,
      html: 'Original',
    });
  moveObjectToPage(doc, child.id, second.id);
  assert.equal(child.x, 60);
  assert.equal(child.y, 82);
  assert.equal(child.parentId, undefined);
  assert.equal(child.html, 'Original');
  assert.equal(mask.pageId, first.id);
  validateImport({ schemaVersion: 2, documents: [doc], assets: [] });
});
