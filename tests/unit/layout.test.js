import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockPixels,
  blockUnits,
  transformBlock,
  alignmentTargets,
  alignmentRectTargets,
  documentRows,
  imagePlacement,
} from '../../src/domain/geometry/layout.js';
import { createDocument, createBlock } from '../../src/domain/documents/model.js';
import { validateImport } from '../../src/domain/documents/schema.js';

test('free movement retains subpixel coordinates instead of rounding to layout units', () => {
  const width = 1017.25,
    block = { x: 1.12345, y: 2.6789, w: 3.14159, h: 4.2468 };
  const start = blockPixels(block, width);
  const moved = transformBlock(start, { x: 0.125, y: 0.375 }, { pageWidth: width, snap: false });
  assert.ok(Math.abs(moved.rect.x - start.x - 0.125) < 1e-10);
  assert.ok(Math.abs(moved.rect.y - start.y - 0.375) < 1e-10);
  assert.ok(Math.abs(blockPixels(moved.block, width).x - moved.rect.x) < 1e-10);
  assert.deepEqual(moved.guides, []);
});

test('nearby edges and centers snap, while the same move is free with snapping off', () => {
  const start = { x: 20, y: 30, w: 100, h: 80 };
  const options = { pageWidth: 960, targets: { x: [321], y: [180] } };
  const snapped = transformBlock(start, { x: 198, y: 108 }, options);
  assert.equal(snapped.rect.x + snapped.rect.w, 321);
  assert.equal(snapped.rect.y + snapped.rect.h / 2, 180);
  assert.deepEqual(
    snapped.guides.map(({ axis, position }) => ({ axis, position })),
    [
      { axis: 'x', position: 321 },
      { axis: 'y', position: 180 },
    ],
  );
  const free = transformBlock(start, { x: 198, y: 108 }, { ...options, snap: false });
  assert.equal(free.rect.x, 218);
  assert.equal(free.rect.y, 138);
  const distant = transformBlock(start, { x: 180, y: 90 }, options);
  assert.deepEqual(distant.guides, []);
});

test('targets retain object provenance and artboard edges without an implicit page center', () => {
  const blocks = [
    { id: 'moving', x: 1, y: 1, w: 1, h: 1 },
    { id: 'other', x: 3, y: 4, w: 2, h: 6 },
  ];
  const targets = alignmentTargets(blocks, 'moving', 960, 880);
  assert.deepEqual(
    targets.x.map((t) => t.position),
    [240, 320, 400, 0, 960],
  );
  assert.deepEqual(
    targets.y.map((t) => t.position),
    [88, 154, 220, 0, 880],
  );
  assert.ok(!targets.x.some((t) => t.position === 480));
  assert.ok(!targets.y.some((t) => t.position === 440));
  assert.deepEqual(targets.x[1], {
    position: 320,
    sourceId: 'other',
    kind: 'object',
    anchor: 'center',
    bounds: { x: 240, y: 88, w: 160, h: 132 },
  });
  assert.ok(!targets.x.some((t) => t.sourceId === 'moving'));
  const center = alignmentTargets(blocks, 'moving', 960, 880, {
    artboardEdges: false,
    artboardCenter: true,
  });
  assert.deepEqual(
    center.x.filter((t) => t.kind === 'artboard').map((t) => [t.position, t.anchor]),
    [[480, 'center']],
  );
  const edgesOnly = alignmentTargets(blocks, 'moving', 960, 880, {
    artboardEdges: false,
    objectCenters: false,
  });
  assert.deepEqual(
    edgesOnly.x.map((t) => t.position),
    [240, 400],
  );
});

test('free resizing is continuous and drag/resize remain inside document bounds', () => {
  const start = { x: 900, y: 2100, w: 40, h: 50 };
  const resized = transformBlock(
    start,
    { x: 0.03125, y: 0.0625 },
    { pageWidth: 960, resize: true, snap: false },
  );
  assert.equal(resized.rect.w, 40.03125);
  assert.equal(resized.rect.h, 50.0625);
  const bounded = transformBlock(
    start,
    { x: 200, y: 200 },
    { pageWidth: 960, resize: true, snap: false },
  );
  assert.equal(bounded.rect.x + bounded.rect.w, 960);
  assert.equal(bounded.rect.y + bounded.rect.h, 2200);
  const moved = transformBlock(start, { x: -2000, y: -3000 }, { pageWidth: 960, snap: false });
  assert.equal(moved.rect.x, 0);
  assert.equal(moved.rect.y, 0);
});

test('resize snaps the changing edges and does not translate the object', () => {
  const result = transformBlock(
    { x: 100, y: 200, w: 100, h: 100 },
    { x: 18, y: 37 },
    { pageWidth: 960, resize: true, targets: { x: [220], y: [340] } },
  );
  assert.deepEqual(result.rect, { x: 100, y: 200, w: 120, h: 140 });
});

test('fractional geometry survives archive validation with an integral enclosing page', () => {
  const doc = createDocument('Precise placement');
  doc.layout.rows = 20;
  doc.blocks = [createBlock('text', { x: 1.123456789, y: 20.25, w: 4.23456789, h: 5.1 })];
  doc.layout.rows = documentRows(doc);
  assert.equal(doc.layout.rows, 26);
  const restored = validateImport({ schemaVersion: 1, documents: [doc], assets: [] }).documents[0];
  assert.equal(restored.blocks[0].x, doc.blocks[0].x);
  assert.equal(restored.blocks[0].y, 20.25);
});

test('pasted images retain aspect ratio and placement fits even extreme source sizes', () => {
  const normal = imagePlacement({ width: 1600, height: 900 }, 960, { x: 50, y: 80 });
  const rect = blockPixels(normal, 960);
  assert.equal(rect.w / rect.h, 1600 / 900);
  for (const size of [
    { width: 1, height: 100000 },
    { width: 100000, height: 1 },
  ]) {
    const block = imagePlacement(size, 960, { x: 9000, y: 9000 });
    assert.ok(block.w >= 0.1 && block.h >= 0.1);
    assert.ok(block.x + block.w <= 12 + 1e-8);
    assert.ok(block.y + block.h <= 100 + 1e-8);
  }
  assert.deepEqual(blockUnits(rect, 960), normal);
});

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test('eight handles preserve opposite anchors and side handles leave the other axis unchanged', () => {
  const start = { x: 200, y: 300, w: 120, h: 80 },
    delta = { x: 17.125, y: 23.375 };
  const expected = {
    nw: { x: 217.125, y: 323.375, w: 102.875, h: 56.625 },
    n: { x: 200, y: 323.375, w: 120, h: 56.625 },
    ne: { x: 200, y: 323.375, w: 137.125, h: 56.625 },
    e: { x: 200, y: 300, w: 137.125, h: 80 },
    se: { x: 200, y: 300, w: 137.125, h: 103.375 },
    s: { x: 200, y: 300, w: 120, h: 103.375 },
    sw: { x: 217.125, y: 300, w: 102.875, h: 103.375 },
    w: { x: 217.125, y: 300, w: 102.875, h: 80 },
  };
  for (const [resize, rect] of Object.entries(expected)) {
    assert.deepEqual(
      transformBlock(start, delta, { pageWidth: 960, resize, snap: false }).rect,
      rect,
      resize,
    );
  }
});

test('west and north handles stop at minimum size and document edges without moving their fixed edges', () => {
  const start = { x: 100, y: 200, w: 100, h: 60 };
  const small = transformBlock(
    start,
    { x: 900, y: 900 },
    { pageWidth: 960, resize: 'nw', snap: false },
  ).rect;
  assert.equal(small.x + small.w, 200);
  assert.equal(small.y + small.h, 260);
  assert.equal(small.w, 12);
  assert.equal(small.h, 8);
  const large = transformBlock(
    start,
    { x: -900, y: -900 },
    { pageWidth: 960, resize: 'nw', snap: false },
  ).rect;
  assert.deepEqual(large, { x: 0, y: 0, w: 200, h: 260 });
  assert.throws(
    () => transformBlock(start, { x: 0, y: 0 }, { pageWidth: 960, resize: 'invalid' }),
    /resize direction/,
  );
});

test('centered resizing preserves center and doubles the active-edge displacement', () => {
  const start = { x: 100, y: 200, w: 120, h: 80 };
  for (const resize of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const rect = transformBlock(
      start,
      { x: 10, y: 5 },
      { pageWidth: 960, resize, fromCenter: true, snap: false },
    ).rect;
    close(rect.x + rect.w / 2, 160);
    close(rect.y + rect.h / 2, 240);
    if (resize === 'e') assert.deepEqual(rect, { x: 90, y: 200, w: 140, h: 80 });
    if (resize === 'n') assert.deepEqual(rect, { x: 100, y: 205, w: 120, h: 70 });
  }
});

test('proportional resizing preserves aspect ratio, fixed reference point and page bounds', () => {
  const start = { x: 150, y: 180, w: 120, h: 80 };
  for (const resize of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    for (const fromCenter of [false, true]) {
      const rect = transformBlock(
        start,
        { x: 2000, y: 1800 },
        { pageWidth: 960, resize, fromCenter, proportional: true, snap: false },
      ).rect;
      close(rect.w / rect.h, 1.5);
      assert.ok(
        rect.x >= -1e-8 &&
          rect.y >= -1e-8 &&
          rect.x + rect.w <= 960 + 1e-8 &&
          rect.y + rect.h <= 2200 + 1e-8,
      );
      if (fromCenter) {
        close(rect.x + rect.w / 2, 210);
        close(rect.y + rect.h / 2, 220);
      } else {
        if (resize.includes('w')) close(rect.x + rect.w, 270);
        if (resize.includes('e')) close(rect.x, 150);
        if (resize.includes('n')) close(rect.y + rect.h, 260);
        if (resize.includes('s')) close(rect.y, 180);
      }
    }
  }
});

test('object alignment guides connect the two real bounds and identify center versus edge', () => {
  const target = {
    position: 300,
    sourceId: 'other',
    kind: 'object',
    anchor: 'left',
    bounds: { x: 300, y: 50, w: 80, h: 100 },
  };
  const result = transformBlock(
    { x: 100, y: 240, w: 100, h: 80 },
    { x: 98, y: 0 },
    { pageWidth: 960, targets: { x: [target], y: [] } },
  );
  assert.equal(result.rect.x + result.rect.w, 300);
  assert.deepEqual(result.guides, [
    {
      axis: 'x',
      position: 300,
      start: 50,
      end: 320,
      sourceId: 'other',
      targetKind: 'object',
      movingAnchor: 'right',
      targetAnchor: 'left',
    },
  ]);
  const centered = transformBlock(
    { x: 100, y: 240, w: 100, h: 80 },
    { x: 148, y: 0 },
    { pageWidth: 960, targets: { x: [{ ...target, anchor: 'center' }], y: [] } },
  );
  assert.equal(centered.rect.x + centered.rect.w / 2, 300);
  assert.equal(centered.guides[0].movingAnchor, 'center');
  assert.equal(centered.guides[0].targetAnchor, 'center');
});

test('horizontal guides use finite object X extents rather than the full page width', () => {
  const target = {
    position: 100,
    sourceId: 'other',
    kind: 'object',
    anchor: 'top',
    bounds: { x: 50, y: 100, w: 80, h: 90 },
  };
  const result = transformBlock(
    { x: 220, y: 200, w: 100, h: 80 },
    { x: 0, y: -98 },
    { pageWidth: 960, targets: { x: [], y: [target] } },
  );
  assert.deepEqual(result.guides, [
    {
      axis: 'y',
      position: 100,
      start: 50,
      end: 320,
      sourceId: 'other',
      targetKind: 'object',
      movingAnchor: 'top',
      targetAnchor: 'top',
    },
  ]);
});

test('side-handle snapping only changes its active axis and respects the fixed edge', () => {
  const result = transformBlock(
    { x: 100, y: 200, w: 100, h: 80 },
    { x: -18, y: 97 },
    { pageWidth: 960, resize: 'w', targets: { x: [80], y: [300] } },
  );
  assert.deepEqual(result.rect, { x: 80, y: 200, w: 120, h: 80 });
  assert.deepEqual(
    result.guides.map((g) => [g.axis, g.position, g.movingAnchor]),
    [['x', 80, 'left']],
  );
  const centered = transformBlock(
    { x: 100, y: 200, w: 100, h: 80 },
    { x: -18, y: 0 },
    { pageWidth: 960, resize: 'w', fromCenter: true, targets: { x: [80], y: [] } },
  );
  assert.deepEqual(centered.rect, { x: 80, y: 200, w: 140, h: 80 });
});

test('blocked snapping never draws a guide that does not match final geometry', () => {
  const move = transformBlock(
    { x: 0, y: 0, w: 100, h: 80 },
    { x: -2, y: -2 },
    { pageWidth: 960, targets: { x: [-2], y: [-2] } },
  );
  assert.deepEqual(move.rect, { x: 0, y: 0, w: 100, h: 80 });
  assert.deepEqual(move.guides, []);
  const resize = transformBlock(
    { x: 100, y: 200, w: 100, h: 80 },
    { x: 89, y: 0 },
    { pageWidth: 960, resize: 'w', targets: { x: [190], y: [] } },
  );
  assert.equal(resize.rect.w, 12);
  assert.deepEqual(resize.guides, []);
});

test('proportional snap keeps the ratio and reports only final matching axes', () => {
  const result = transformBlock(
    { x: 100, y: 200, w: 120, h: 80 },
    { x: 28, y: 11 },
    { pageWidth: 960, resize: 'se', proportional: true, targets: { x: [250], y: [300] } },
  );
  close(result.rect.w / result.rect.h, 1.5);
  for (const g of result.guides) {
    close(
      g.position,
      g.axis === 'x' ? result.rect.x + result.rect.w : result.rect.y + result.rect.h,
    );
  }
  assert.ok(result.guides.length > 0);
});

test('equal-coordinate targets keep provenance and prefer an object over an artboard on a tie', () => {
  const targets = {
    x: [
      {
        position: 300,
        sourceId: null,
        kind: 'artboard',
        anchor: 'center',
        bounds: { x: 0, y: 0, w: 600, h: 600 },
      },
      {
        position: 300,
        sourceId: 'object-a',
        kind: 'object',
        anchor: 'left',
        bounds: { x: 300, y: 80, w: 50, h: 60 },
      },
    ],
    y: [],
  };
  const result = transformBlock(
    { x: 100, y: 240, w: 100, h: 80 },
    { x: 98, y: 0 },
    { pageWidth: 960, targets },
  );
  assert.equal(result.guides[0].sourceId, 'object-a');
  assert.equal(result.guides[0].end, 320);
});

test('the screenshot layout aligns tops without inventing a canvas-center vertical guide', () => {
  const width = 899;
  const blocks = [
    { id: 'left', x: 0, y: 0, w: 5, h: 30 },
    { id: 'right', x: 6, y: 0, w: 5.076, h: 23.4 },
  ];
  const targets = alignmentTargets(blocks, 'right', width, 880);
  const start = { x: 448.75, y: 1, w: 380.31, h: 515.379 };
  const result = transformBlock(start, { x: 0.5, y: 0 }, { pageWidth: width, targets });
  assert.equal(result.rect.x, 449.25);
  assert.equal(result.rect.y, 0);
  assert.equal(
    result.guides.some((guide) => guide.axis === 'x'),
    false,
  );
  const horizontal = result.guides.find((guide) => guide.axis === 'y');
  assert.equal(horizontal.sourceId, 'left');
  assert.equal(horizontal.targetAnchor, 'top');
  assert.equal(horizontal.position, 0);
  assert.equal(horizontal.start, 0);
  assert.equal(horizontal.end, 829.56);
});

test('snap tolerance stays constant in screen space as the view scale changes', () => {
  const start = { x: 100, y: 100, w: 80, h: 80 };
  for (const scale of [0.5, 1, 2, 4]) {
    const target = 300;
    const options = { pageWidth: 960, targets: { x: [target], y: [] }, viewScale: scale };
    const inside = transformBlock(
      start,
      { x: target - start.x - start.w - 3.9 / scale, y: 0 },
      options,
    );
    assert.equal(inside.rect.x + inside.rect.w, target);
    const outside = transformBlock(
      start,
      { x: target - start.x - start.w - 4.1 / scale, y: 0 },
      options,
    );
    assert.equal(outside.guides.length, 0);
  }
});

test('target-page artboard origins retain real edge positions while dragging across pages', () => {
  const targets = alignmentRectTargets([], 800, 500, { artboardOrigin: { x: 0, y: 856 } });
  assert.deepEqual(
    targets.y.map((t) => t.position),
    [856, 1356],
  );
  assert.ok(targets.y.every((t) => t.bounds.y === 856));
});
