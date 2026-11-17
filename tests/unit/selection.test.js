import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneDocument,
  insertObject,
  addPage,
  worldRect,
} from '../../src/domain/documents/scene.js';
import {
  marqueeSelection,
  toggleSelection,
  selectionRoots,
  selectionBounds,
  transformSelection,
  sceneRect,
} from '../../src/domain/geometry/selection.js';
import { validateImport } from '../../src/domain/documents/schema.js';

test('marquee includes partial path intersections and can require full containment', () => {
  const d = createSceneDocument(),
    a = insertObject(d, 'polygon', d.pages[0].id, { x: 100, y: 100, w: 100, h: 100 });
  assert.deepEqual(marqueeSelection(d, { x: 90, y: 90, w: 20, h: 20 }), [a.id]);
  assert.deepEqual(marqueeSelection(d, { x: 90, y: 90, w: 20, h: 20 }, { enclosed: true }), []);
  assert.deepEqual(marqueeSelection(d, { x: 99, y: 99, w: 102, h: 102 }, { enclosed: true }), [
    a.id,
  ]);
  a.points = a.points.slice(0, 3);
  assert.deepEqual(
    marqueeSelection(d, { x: 102, y: 180, w: 5, h: 5 }),
    [],
    'empty triangle-bounds corner must not count as a painted path hit',
  );
});
test('selection uses clipping roots, stable shift toggles and page-world coordinates', () => {
  const d = createSceneDocument(),
    p = d.pages[0],
    second = addPage(d, p.id),
    mask = insertObject(d, 'polygon', p.id),
    child = insertObject(d, 'text', p.id, { parentId: mask.id }),
    other = insertObject(d, 'polygon', second.id);
  assert.deepEqual(
    selectionRoots(d, [mask.id, child.id]).map((x) => x.id),
    [mask.id],
  );
  assert.deepEqual(marqueeSelection(d, { x: 0, y: 0, w: 600, h: 700 }), [mask.id]);
  assert.deepEqual(marqueeSelection(d, { x: 0, y: 0, w: 600, h: 700 }, { parentId: mask.id }), [
    child.id,
  ]);
  assert.equal(sceneRect(d, other).y, other.y + p.height + 64);
  assert.deepEqual(toggleSelection([mask.id], [mask.id, other.id]), [other.id]);
});
test('multi-object transforms preserve children, source HTML and identifiers from an immutable baseline', () => {
  const d = createSceneDocument(),
    mask = insertObject(d, 'polygon', d.pages[0].id, { x: 100, y: 100, w: 100, h: 100 }),
    child = insertObject(d, 'text', mask.pageId, {
      parentId: mask.id,
      x: 10,
      y: 20,
      w: 70,
      h: 50,
      html: '<p><em>Retained</em></p>',
    }),
    other = insertObject(d, 'polygon', mask.pageId, { x: 300, y: 200, w: 100, h: 100 });
  const ids = [mask.id, other.id],
    baseline = structuredClone(d),
    bounds = selectionBounds(d, ids);
  transformSelection(
    d,
    ids,
    { x: bounds.x + 12.125, y: bounds.y + 3.75, w: bounds.w * 2, h: bounds.h * 2 },
    baseline,
  );
  assert.deepEqual(worldRect(d, child), { x: 132.125, y: 143.75, w: 140, h: 100 });
  assert.equal(child.html, '<p><em>Retained</em></p>');
  assert.equal(child.parentId, mask.id);
  assert.equal(d.blocks[0].points[0].id, baseline.blocks[0].points[0].id);
  assert.equal(baseline.blocks[0].x, 100);
  validateImport({ schemaVersion: 2, documents: [d], assets: [] });
});
