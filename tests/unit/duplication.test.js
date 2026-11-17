import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneDocument,
  insertObject,
  addPage,
  duplicateObjects,
} from '../../src/domain/documents/scene.js';
import {
  startTextFlow,
  threadFrame,
  textFlowForFrame,
} from '../../src/domain/documents/text-flows.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import {
  transformBlock,
  alignmentRectTargets,
  constrainMove,
} from '../../src/domain/geometry/layout.js';
test('selection copies remap nested clips and shared textFlow frames once, preserving original source and order', () => {
  const doc = createSceneDocument(),
    page = doc.pages[0],
    mask = insertObject(doc, 'polygon', page.id, { x: 80.125, y: 90.375 }),
    frame = insertObject(doc, 'text', page.id, {
      parentId: mask.id,
      html: '<p><strong>Retained textFlow</strong></p>',
    }),
    textFlow = startTextFlow(doc, frame.id, { automaticPages: false }),
    next = insertObject(doc, 'text', addPage(doc, page.id).id);
  threadFrame(doc, frame.id, next.id);
  const before = structuredClone(doc),
    copies = duplicateObjects(doc, [next.id, mask.id, frame.id], { offset: { x: 0, y: 0 } }),
    copyMask = copies.find((b) => b.type === 'polygon'),
    copyChild = doc.blocks.find((b) => b.parentId === copyMask.id),
    copyNext = copies.find((b) => b.type === 'text'),
    copyTextFlow = textFlowForFrame(doc, copyChild);
  assert.equal(copies.length, 2);
  assert.deepEqual(doc.blocks.slice(0, 3), before.blocks);
  assert.deepEqual(doc.textFlows[0], before.textFlows[0]);
  assert.deepEqual(doc.pages, before.pages);
  assert.equal(copyMask.x, mask.x);
  assert.equal(copyMask.y, mask.y);
  assert.notEqual(copyMask.points[0].id, mask.points[0].id);
  assert.notEqual(copyTextFlow.id, textFlow.id);
  assert.deepEqual(copyTextFlow.frameIds, [copyChild.id, copyNext.id]);
  assert.equal(copyTextFlow.html, textFlow.html);
  assert.equal(copyNext.textFlowId, copyChild.textFlowId);
  assert.equal(copyTextFlow.automaticPages, false);
  assert.deepEqual(copyTextFlow.autoPages, []);
  validateImport({ schemaVersion: 5, documents: [doc], assets: [] });
  copyTextFlow.html = '<p>Independent edit</p>';
  assert.equal(textFlow.html, before.textFlows[0].html);
});
test('copying content inside a mask retains its parent and media identity without copying its parent', () => {
  const doc = createSceneDocument(),
    mask = insertObject(doc, 'polygon', doc.pages[0].id),
    image = insertObject(doc, 'image', mask.pageId, {
      parentId: mask.id,
      src: 'asset:original',
      crop: { x: 37.25, y: 62.5 },
    }),
    [copy] = duplicateObjects(doc, [image.id]);
  assert.equal(copy.parentId, mask.id);
  assert.equal(copy.src, image.src);
  assert.deepEqual(copy.crop, image.crop);
  assert.equal(copy.x, image.x + 16);
  assert.equal(doc.blocks.length, 3);
  assert.equal(doc.blocks.filter((b) => b.type === 'polygon').length, 1);
});
test('copy capacity failures leave the entire document unchanged', () => {
  const doc = createSceneDocument();
  for (let i = 0; i < 1000; i++) insertObject(doc, 'polygon', doc.pages[0].id);
  const before = structuredClone(doc);
  assert.throws(() => duplicateObjects(doc, [doc.blocks[0].id]), /1,000/);
  assert.deepEqual(doc, before);
});
test('Shift movement constrains all octants while snapping keeps that same direction', () => {
  for (const delta of [
    { x: 30, y: 2 },
    { x: 2, y: 30 },
    { x: 30, y: 28 },
    { x: -30, y: 28 },
    { x: -30, y: -28 },
    { x: 30, y: -28 },
  ]) {
    const c = constrainMove(delta);
    assert.ok(
      Math.abs(c.x) < 1e-9 ||
        Math.abs(c.y) < 1e-9 ||
        Math.abs(Math.abs(c.x) - Math.abs(c.y)) < 1e-9,
    );
  }
  const start = { x: 80, y: 100, w: 100, h: 80 },
    targets = alignmentRectTargets([{ id: 'target', x: 260, y: 278, w: 60, h: 40 }], 612, 792);
  const horizontal = transformBlock(
    start,
    { x: 177, y: 10 },
    { pageWidth: 612, targets, constrain: true, unbounded: true },
  );
  assert.equal(horizontal.rect.x, 260);
  assert.equal(horizontal.rect.y, 100);
  const diagonal = transformBlock(
    start,
    { x: 177, y: 180 },
    { pageWidth: 612, targets, constrain: true, unbounded: true },
  );
  assert.ok(Math.abs(diagonal.rect.x - start.x - (diagonal.rect.y - start.y)) < 1e-9);
  assert.ok(diagonal.guides.length);
});
