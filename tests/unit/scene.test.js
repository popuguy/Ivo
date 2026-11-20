import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createBlock } from '../../src/domain/documents/model.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { buildIndex } from '../../src/domain/knowledge/index.js';
import { enablePublishing } from '../../src/domain/documents/publishing.js';
import {
  createSceneDocument,
  upgradeDocument,
  addPage,
  insertObject,
  moveVertex,
  worldRect,
  transformObject,
  duplicateObject,
  removeObject,
  removePage,
  releaseMask,
} from '../../src/domain/documents/scene.js';
import {
  screenToWorld,
  worldToScreen,
  zoomAt,
  fitCamera,
  easeCamera,
} from '../../src/domain/geometry/viewport.js';
const archive = (document) => ({ schemaVersion: 2, documents: [document], assets: [] });

test('creating a wrap polygon preserves its path, zero stroke and clipping settings', () => {
  const document = createSceneDocument('Shape around text');
  const points = [
    { id: 'top', x: 0, y: 0 },
    { id: 'right', x: 1, y: 0 },
    { id: 'bottom', x: 0, y: 1 },
  ];
  const shape = insertObject(document, 'polygon', document.pages[0].id, {
    points,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    clip: true,
  });
  assert.deepEqual(shape.points, points);
  assert.deepEqual(
    [shape.fill, shape.stroke, shape.strokeWidth, shape.clip],
    ['none', 'none', 0, true],
  );
  shape.points[0].x = 0.25;
  assert.equal(points[0].x, 0);
  const defaults = insertObject(document, 'polygon', document.pages[0].id);
  assert.equal(defaults.points.length, 4);
  assert.equal(defaults.strokeWidth, 1);
});

// Independent CSS affine witness: compose each rendered rotate-about-center matrix,
// including containing masks. Do not use the scene command's coordinate helpers.
function renderedMatrix(doc, item) {
  const radians = ((item.rotation || 0) * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians),
    cx = item.w / 2,
    cy = item.h / 2,
    local = [c, s, -s, c, item.x + cx - c * cx + s * cy, item.y + cy - s * cx - c * cy];
  if (!item.parentId) return local;
  const [a, b, k, d, e, f] = renderedMatrix(
      doc,
      doc.blocks.find((block) => block.id === item.parentId),
    ),
    [g, h, i, j, x, y] = local;
  return [
    a * g + k * h,
    b * g + d * h,
    a * i + k * j,
    b * i + d * j,
    a * x + k * y + e,
    b * x + d * y + f,
  ];
}
function renderedPoint(doc, item, point) {
  const [a, b, c, d, x, y] = renderedMatrix(doc, item);
  return { x: a * point.x + c * point.y + x, y: b * point.x + d * point.y + y };
}
function renderedCorners(doc, item) {
  return [
    { x: 0, y: 0 },
    { x: item.w, y: 0 },
    { x: item.w, y: item.h },
    { x: 0, y: item.h },
  ].map((point) => renderedPoint(doc, item, point));
}
function closePoints(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i].x - expected[i].x) < 1e-8, `Point ${i} moved horizontally`);
    assert.ok(Math.abs(actual[i].y - expected[i].y) < 1e-8, `Point ${i} moved vertically`);
  }
}
test('legacy upgrade preserves source and stable links without mutating old geometry', () => {
  const old = createDocument('Legacy');
  old.blocks = [
    createBlock('text', {
      html: '<p><em>Retain</em> [[Other]]</p>',
      x: 1.23456789,
      y: 2.34567,
      w: 4,
      h: 8,
    }),
  ];
  const before = JSON.stringify(old),
    next = upgradeDocument(old, 900);
  assert.equal(JSON.stringify(old), before);
  assert.equal(next.id, old.id);
  assert.equal(next.blocks[0].id, old.blocks[0].id);
  assert.equal(next.blocks[0].html, old.blocks[0].html);
  assert.equal(next.blocks[0].x, old.blocks[0].x * 75);
  assert.equal(next.blocks[0].y, old.blocks[0].y * 22);
  assert.equal(next.pages[0].height, old.layout.rows * 22);
  assert.deepEqual(buildIndex([next]).unresolved, buildIndex([old]).unresolved);
  const restored = validateImport(archive(next)).documents[0];
  assert.deepEqual(restored.pages, next.pages);
  assert.deepEqual(restored.legacyLayout, next.legacyLayout);
});
test('different fixed page sizes and stable identifiers survive archive round trip', () => {
  const doc = createSceneDocument('Pages');
  const second = addPage(doc, doc.pages[0].id);
  assert.equal(second.width, 612);
  assert.equal(second.height, 792);
  second.width = 900;
  second.height = 450;
  insertObject(doc, 'polygon', second.id, { x: -12.345, y: 800.123 });
  const value = validateImport(JSON.parse(JSON.stringify(archive(doc)))).documents[0];
  assert.deepEqual(value.pages, doc.pages);
  assert.deepEqual(value.blocks[0].points, doc.blocks[0].points);
  assert.equal(value.blocks[0].x, -12.345);
  assert.throws(
    () => validateImport({ schemaVersion: 1, documents: [doc], assets: [] }),
    /schema 2/,
  );
});
test('direct point editing changes shape while other vertices and clipped content stay fixed', () => {
  const doc = createSceneDocument(),
    mask = insertObject(doc, 'polygon', doc.pages[0].id, { x: 100, y: 100, w: 200, h: 200 });
  const child = insertObject(doc, 'text', mask.pageId, {
    parentId: mask.id,
    x: 20,
    y: 30,
    w: 100,
    h: 80,
    html: '<p>Inside</p>',
  });
  const point = mask.points[0],
    fixed = mask.points
      .slice(1)
      .map((p) => ({ x: mask.x + p.x * mask.w, y: mask.y + p.y * mask.h })),
    content = worldRect(doc, child);
  moveVertex(doc, mask.id, point.id, { x: 70.125, y: 90.375 });
  assert.deepEqual(worldRect(doc, child), content);
  assert.deepEqual(
    mask.points.slice(1).map((p) => ({ x: mask.x + p.x * mask.w, y: mask.y + p.y * mask.h })),
    fixed,
  );
  assert.equal(mask.x, 70.125);
  assert.equal(mask.y, 90.375);
  assert.ok(mask.clip);
  validateImport(archive(doc));
});
test('rotated point edits retain untouched vertices and nested clipped ink in rendered coordinates', () => {
  for (const rotation of [17.5, 90, -135, 359.75]) {
    const doc = createSceneDocument();
    enablePublishing(doc);
    const outer = insertObject(doc, 'polygon', doc.pages[0].id, {
        x: 87.125,
        y: 141.375,
        w: 420.5,
        h: 310.75,
        rotation: -23.25,
      }),
      mask = insertObject(doc, 'polygon', outer.pageId, {
        parentId: outer.id,
        x: 47.25,
        y: -12.625,
        w: 200.5,
        h: 150.25,
        rotation,
      }),
      nested = insertObject(doc, 'polygon', outer.pageId, {
        parentId: mask.id,
        x: -7.125,
        y: 18.75,
        w: 113.5,
        h: 93.25,
        rotation: 11.125,
      }),
      text = insertObject(doc, 'text', outer.pageId, {
        parentId: nested.id,
        x: 11.375,
        y: -3.25,
        w: 87.125,
        h: 72.5,
        rotation: -7.75,
        html: '<p><em>Unchanged</em> source [[Target]]</p>',
      }),
      before = structuredClone(doc),
      ids = mask.points.map((point) => point.id),
      pathBefore = mask.points.map((point) =>
        renderedPoint(doc, mask, { x: point.x * mask.w, y: point.y * mask.h }),
      ),
      nestedBefore = renderedCorners(doc, nested),
      textBefore = renderedCorners(doc, text),
      destination = { x: mask.x - 31.875, y: mask.y - 19.125 },
      expectedSelected = renderedPoint(doc, mask, {
        x: destination.x - mask.x,
        y: destination.y - mask.y,
      });
    moveVertex(doc, mask.id, ids[0], destination);
    const pathAfter = mask.points.map((point) =>
      renderedPoint(doc, mask, { x: point.x * mask.w, y: point.y * mask.h }),
    );
    closePoints(pathAfter, [expectedSelected, ...pathBefore.slice(1)]);
    closePoints(renderedCorners(doc, nested), nestedBefore);
    closePoints(renderedCorners(doc, text), textBefore);
    assert.deepEqual(
      mask.points.map((point) => point.id),
      ids,
    );
    assert.deepEqual(
      doc.blocks.map((item) => item.id),
      before.blocks.map((item) => item.id),
    );
    const oldNested = before.blocks.find((item) => item.id === nested.id),
      { x: oldX, y: oldY, ...oldSource } = oldNested,
      { x: newX, y: newY, ...newSource } = nested;
    assert.ok([oldX, oldY, newX, newY].every(Number.isFinite));
    assert.deepEqual(newSource, oldSource);
    assert.deepEqual(
      text,
      before.blocks.find((item) => item.id === text.id),
    );
    validateImport({ schemaVersion: 6, documents: [doc], assets: [] });
  }
});
test('whole mask transform carries contents and duplication remaps all scene identities', () => {
  const doc = createSceneDocument(),
    mask = insertObject(doc, 'polygon', doc.pages[0].id, { x: 100, y: 100, w: 200, h: 100 });
  const child = insertObject(doc, 'text', mask.pageId, {
    parentId: mask.id,
    x: 20,
    y: 10,
    w: 100,
    h: 50,
  });
  const start = structuredClone(doc);
  transformObject(doc, mask.id, { x: 200, y: 250, w: 400, h: 300 }, start);
  assert.deepEqual(worldRect(doc, child), { x: 240, y: 280, w: 200, h: 150 });
  const copy = duplicateObject(doc, mask.id);
  assert.notEqual(copy.id, mask.id);
  assert.notEqual(copy.points[0].id, mask.points[0].id);
  assert.equal(doc.blocks.filter((b) => b.parentId === copy.id).length, 1);
  validateImport(archive(doc));
  removeObject(doc, mask.id);
  assert.equal(doc.blocks.length, 2);
  assert.ok(doc.blocks.every((b) => b.id !== mask.id && b.id !== child.id));
});
test('scene validation rejects bad page references, cycles, malformed paths and colors', () => {
  for (const mutate of [
    (d) => (d.blocks[0].pageId = 'missing'),
    (d) => d.blocks[0].points.pop() && d.blocks[0].points.pop(),
    (d) => (d.blocks[0].points[0].x = NaN),
    (d) => (d.blocks[0].fill = 'url(x)'),
    (d) => {
      d.blocks[0].clip = true;
      d.blocks[0].parentId = d.blocks[0].id;
    },
    (d) => (d.pages[0].width = 0),
    (d) => (d.blocks[0].points[1].id = d.blocks[0].points[0].id),
  ]) {
    const doc = createSceneDocument();
    insertObject(doc, 'polygon', doc.pages[0].id);
    mutate(doc);
    assert.throws(() => validateImport(archive(doc)), TypeError);
  }
  const doc = createSceneDocument();
  const mask = insertObject(doc, 'polygon', doc.pages[0].id);
  const child = insertObject(doc, 'text', mask.pageId, { parentId: mask.id });
  mask.clip = false;
  assert.throws(() => validateImport(archive(doc)), /clipping parent/);
  child.parentId = 'absent';
  assert.throws(() => validateImport(archive(doc)), /clipping parent/);
});
test('removing a page removes its objects without disturbing another page', () => {
  const doc = createSceneDocument();
  const first = doc.pages[0],
    second = addPage(doc, first.id);
  const a = insertObject(doc, 'polygon', first.id),
    b = insertObject(doc, 'polygon', second.id);
  removePage(doc, first.id);
  assert.deepEqual(
    doc.blocks.map((x) => x.id),
    [b.id],
  );
  assert.throws(() => removePage(doc, second.id), /at least one/);
  assert.ok(a.id);
});
test('viewport zoom preserves its focal point and world/screen inverses at fractional scales', () => {
  const camera = { x: -123.456, y: 72.345, zoom: 0.735 },
    screen = { x: 385.12, y: 240.789 },
    world = screenToWorld(screen, camera);
  assert.deepEqual(worldToScreen(world, camera), screen);
  for (const zoom of [0.08, 0.25, 1, 3.77, 8]) {
    const next = zoomAt(camera, screen, zoom),
      actual = worldToScreen(world, next);
    assert.ok(Math.abs(actual.x - screen.x) < 1e-9);
    assert.ok(Math.abs(actual.y - screen.y) < 1e-9);
  }
});
test('camera easing is refresh-rate independent and preserves a fixed zoom anchor', () => {
  const from = { x: 0, y: 0, zoom: 1 },
    anchor = { x: 300, y: 200 },
    to = zoomAt(from, anchor, 2);
  let sixty = { ...from },
    oneTwenty = { ...from };
  for (let i = 0; i < 60; i++) sixty = easeCamera(sixty, to, 1000 / 60);
  for (let i = 0; i < 120; i++) oneTwenty = easeCamera(oneTwenty, to, 1000 / 120);
  assert.ok(Math.abs(sixty.zoom - oneTwenty.zoom) < 1e-4);
  const half = easeCamera(from, to, 16);
  assert.deepEqual(worldToScreen(anchor, half), anchor);
  const fit = fitCamera({ x: 0, y: 0, w: 612, h: 792 }, { width: 1000, height: 800 });
  assert.ok(612 * fit.zoom <= 904 && 792 * fit.zoom <= 704);
});

test('releasing a nested mask preserves content world geometry and its outer parent', () => {
  const doc = createSceneDocument(),
    outer = insertObject(doc, 'polygon', doc.pages[0].id, { x: 100, y: 120 }),
    inner = insertObject(doc, 'polygon', outer.pageId, { parentId: outer.id, x: 10, y: 20 }),
    content = insertObject(doc, 'text', outer.pageId, {
      parentId: inner.id,
      x: 15,
      y: 25,
      html: '<p>Source retained</p>',
    }),
    before = worldRect(doc, content);
  releaseMask(doc, inner.id);
  assert.deepEqual(worldRect(doc, content), before);
  assert.equal(content.parentId, outer.id);
  assert.equal(inner.clip, false);
  assert.equal(content.html, '<p>Source retained</p>');
  assert.ok(!Object.hasOwn(content, 'rotation'));
  validateImport(archive(doc));
});

test('releasing rotated nested masks preserves descendant ink and composes child orientation', () => {
  for (const rotation of [0, 32.75, 90, -135, 36000]) {
    const doc = createSceneDocument();
    enablePublishing(doc);
    const outer = insertObject(doc, 'polygon', doc.pages[0].id, {
        x: 103.125,
        y: -11.375,
        w: 480,
        h: 330,
        rotation: 21.5,
      }),
      mask = insertObject(doc, 'polygon', outer.pageId, {
        parentId: outer.id,
        x: -13.25,
        y: 57.625,
        w: 210.5,
        h: 175.25,
        rotation,
      }),
      nested = insertObject(doc, 'polygon', outer.pageId, {
        parentId: mask.id,
        x: 7.375,
        y: 19.625,
        w: 112.5,
        h: 87.25,
        rotation: 350.5,
      }),
      text = insertObject(doc, 'text', outer.pageId, {
        parentId: nested.id,
        x: -2.75,
        y: 9.125,
        w: 87.25,
        h: 64.375,
        rotation: -19.75,
        html: '<p>Exact <em>source</em> [[Link]]</p>',
      }),
      plain = insertObject(doc, 'text', outer.pageId, {
        parentId: mask.id,
        x: 140.5,
        y: 35.75,
        w: 37.25,
        h: 53.125,
        html: '<p>Plain source</p>',
      }),
      before = structuredClone(doc),
      nestedBefore = renderedCorners(doc, nested),
      textBefore = renderedCorners(doc, text),
      plainBefore = renderedCorners(doc, plain);
    releaseMask(doc, mask.id);
    closePoints(renderedCorners(doc, nested), nestedBefore);
    closePoints(renderedCorners(doc, text), textBefore);
    closePoints(renderedCorners(doc, plain), plainBefore);
    assert.equal(nested.parentId, outer.id);
    assert.equal(plain.parentId, outer.id);
    assert.equal(mask.clip, false);
    assert.deepEqual(nested.points, before.blocks.find((item) => item.id === nested.id).points);
    assert.deepEqual(
      doc.blocks.map((item) => item.id),
      before.blocks.map((item) => item.id),
    );
    assert.deepEqual(
      text,
      before.blocks.find((item) => item.id === text.id),
    );
    assert.equal(plain.html, '<p>Plain source</p>');
    if (rotation % 360 === 0) {
      assert.equal(nested.rotation, 350.5);
      assert.ok(!Object.hasOwn(plain, 'rotation'));
    } else {
      assert.equal(nested.rotation, (350.5 + rotation) % 360);
      assert.equal(plain.rotation, rotation % 360);
    }
    validateImport({ schemaVersion: 6, documents: [doc], assets: [] });
  }
});

test('fit all can frame a long legal page collection without hiding its ends', () => {
  const bounds = { x: 0, y: 0, w: 14400, h: 128 * 14400 + 127 * 64 },
    size = { width: 1200, height: 800 },
    camera = fitCamera(bounds, size);
  const top = worldToScreen({ x: bounds.x, y: bounds.y }, camera),
    bottom = worldToScreen({ x: bounds.w, y: bounds.h }, camera);
  assert.ok(
    top.x >= 47 && top.y >= 47 && bottom.x <= size.width - 47 && bottom.y <= size.height - 47,
  );
});

test('trackpad pixels, wheel lines and wheel pages preserve their declared units', async () => {
  const { wheelDelta, panBy } = await import('../../src/domain/geometry/viewport.js'),
    camera = { x: 12.345, y: -67.89, zoom: 0.735 },
    size = { width: 800, height: 600 };
  assert.deepEqual(wheelDelta({ deltaX: 0.125, deltaY: -1.75, deltaMode: 0 }, size), {
    x: 0.125,
    y: -1.75,
  });
  assert.deepEqual(wheelDelta({ deltaX: 1, deltaY: -2, deltaMode: 1 }, size), { x: 16, y: -32 });
  assert.deepEqual(wheelDelta({ deltaX: 0.5, deltaY: 1, deltaMode: 2 }, size), { x: 400, y: 600 });
  assert.deepEqual(panBy(camera, { x: 0.125, y: -1.75 }), { x: 12.22, y: -66.14, zoom: 0.735 });
  assert.equal(camera.x, 12.345);
});

test('macOS pinch wheel values recover native scale rather than its square root', async () => {
  const { pinchWheelScale } = await import('../../src/domain/geometry/viewport.js');
  for (const nativeScale of [0.5, 0.875, 1, 1.25, 1.5, 2]) {
    const deltaY = -100 * Math.log(nativeScale);
    assert.ok(Math.abs(pinchWheelScale(deltaY) - nativeScale) < 1e-12);
  }
});
