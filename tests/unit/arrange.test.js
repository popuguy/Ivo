import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeObjects, ARRANGE_COMMANDS } from '../../src/domain/documents/arrange.js';
import { editorMenuState } from '../../src/domain/workspace/editor-commands.js';
import { NATIVE_TEXT_ACCELERATORS } from '../../src/domain/text/native-commands.js';
const fixture = () => ({
  blocks: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, pageId: 'p', html: id })),
});
const order = (doc) => doc.blocks.map((item) => item.id);

test('arrangement moves selected sibling runs one step, preserving their relative order', () => {
  const doc = fixture();
  assert(arrangeObjects(doc, ['b', 'c'], 'bring-forward'));
  assert.deepEqual(order(doc), ['a', 'd', 'b', 'c', 'e']);
  assert(arrangeObjects(doc, ['b', 'c'], 'send-backward'));
  assert.deepEqual(order(doc), ['a', 'b', 'c', 'd', 'e']);
  arrangeObjects(doc, ['b', 'd'], 'bring-forward');
  assert.deepEqual(order(doc), ['a', 'c', 'b', 'e', 'd']);
  assert.equal(doc.blocks.find((item) => item.id === 'b').html, 'b');
});
test('front/back are stable, bounded and ignore locked or hidden selected objects', () => {
  const doc = fixture();
  arrangeObjects(doc, ['b', 'd'], 'bring-front');
  assert.deepEqual(order(doc), ['a', 'c', 'e', 'b', 'd']);
  assert.equal(arrangeObjects(doc, ['b', 'd'], 'bring-front'), false);
  arrangeObjects(doc, ['b', 'd'], 'send-back');
  assert.deepEqual(order(doc), ['b', 'd', 'a', 'c', 'e']);
  doc.blocks[0].locked = true;
  doc.blocks[1].hidden = true;
  assert.equal(arrangeObjects(doc, ['b', 'd', 'missing'], 'bring-front'), false);
  assert.throws(() => arrangeObjects(doc, [], 'delete'), /Unknown/);
});
test('page, layer and clipping-parent boundaries survive independent selected order changes', () => {
  const doc = {
    publishing: {
      layers: [
        { id: 'low', visible: true },
        { id: 'high', visible: true },
      ],
    },
    blocks: [
      { id: 'mask', pageId: 'p', layerId: 'low', clip: true },
      { id: 'child-a', pageId: 'p', parentId: 'mask', layerId: 'low' },
      { id: 'outside', pageId: 'p', layerId: 'low' },
      { id: 'high', pageId: 'p', layerId: 'high' },
      { id: 'child-b', pageId: 'p', parentId: 'mask', layerId: 'low' },
      { id: 'other-page', pageId: 'q', layerId: 'low' },
    ],
  };
  const original = structuredClone(doc);
  arrangeObjects(doc, ['mask', 'child-a'], 'bring-front');
  assert.deepEqual(order(doc), ['outside', 'child-a', 'mask', 'high', 'child-b', 'other-page']);
  assert.equal(doc.blocks.find((item) => item.id === 'child-a').parentId, 'mask');
  arrangeObjects(doc, ['child-a'], 'bring-forward');
  assert.deepEqual(order(doc), ['outside', 'child-b', 'mask', 'high', 'child-a', 'other-page']);
  assert.deepEqual(doc.publishing, original.publishing);
  assert.deepEqual(
    doc.blocks.find((item) => item.id === 'high'),
    original.blocks[3],
  );
});
test('native menu state rejects implicit truthiness and reserves Adobe arrangement shortcuts', () => {
  assert.deepEqual(editorMenuState({ canArrange: true, canvasView: 'yes', smartGuides: 1 }), {
    canvasView: false,
    canArrange: false,
    smartGuides: false,
  });
  assert.equal(editorMenuState({ canvasView: true, canArrange: true }).canArrange, true);
  assert.equal(ARRANGE_COMMANDS['send-backward'].accelerator, 'CmdOrCtrl+[');
  assert.equal(ARRANGE_COMMANDS['send-back'].accelerator, 'CmdOrCtrl+Shift+[');
  assert.equal(NATIVE_TEXT_ACCELERATORS.underline, 'CmdOrCtrl+Shift+U');
});
