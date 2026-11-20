import test from 'node:test';
import assert from 'node:assert/strict';
import { panelBounds, dockWidth } from '../../src/features/editor/ui/panels.js';
test('Workspace panel preferences remain reachable after a smaller window or corrupt values', () => {
  const bounds = panelBounds({ x: 1500, y: 900, w: 900, h: 1000 }, { w: 390, h: 600 });
  assert.deepEqual(bounds, { x: 0, y: 0, w: 390, h: 600 });
  const recovered = panelBounds({ x: NaN, y: Infinity, w: -20, h: null }, { w: 1000, h: 700 });
  assert.deepEqual(recovered, { x: 780, y: 24, w: 200, h: 480 });
  assert.equal(dockWidth(1000, 1000), 480);
  assert.equal(dockWidth(-10, 1000), 200);
  for (const size of [
    { w: 80, h: 80 },
    { w: 390, h: 600 },
    { w: 1200, h: 800 },
  ]) {
    const value = panelBounds({}, size);
    assert.ok(
      value.x >= 0 && value.y >= 0 && value.x + value.w <= size.w && value.y + value.h <= size.h,
    );
  }
});

import {
  draggedPalettePosition,
  panelDockTarget,
  palettePosition,
} from '../../src/domain/workspace/panel-drag.js';

test('Native palette placement retains its grip across displays with negative origins', () => {
  const area = { x: -1440, y: -240, width: 1440, height: 900 };
  const place = (x, y) =>
    palettePosition({ x, y }, { x: 38, y: 16 }, { width: 254, height: 480 }, area);
  assert.deepEqual(place(-600, -80), { x: -638, y: -96 });
  assert.deepEqual(place(-1438, -235), { x: -1440, y: -240 });
  assert.deepEqual(place(-2, 655), { x: -254, y: 180 });
  const grip = { x: 38, y: 16 };
  assert.deepEqual(draggedPalettePosition({ x: -1, y: 280 }, grip), { x: -39, y: 264 });
  assert.deepEqual(draggedPalettePosition({ x: 1, y: 280 }, grip), { x: -37, y: 264 });
});

test('Native panel targets distinguish tab order, stacking, dock edges and free canvas', () => {
  const rect = (left, top, right, bottom) => ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  });
  const workspace = rect(40, 80, 750, 480);
  const groups = [
    {
      id: 'dock',
      box: rect(500, 80, 750, 480),
      header: rect(500, 94, 750, 121),
      tabs: [
        { kind: 'pages', left: 500, right: 560 },
        { kind: 'links', left: 560, right: 620 },
      ],
    },
  ];
  const target = (x, y) => panelDockTarget(x, y, workspace, groups);
  assert.deepEqual(target(565, 109), { type: 'tabs', id: 'dock', before: 'links' });
  assert.deepEqual(target(610, 109), { type: 'tabs', id: 'dock', before: undefined });
  assert.deepEqual(target(540, 92), { type: 'above', id: 'dock' });
  assert.deepEqual(target(540, 468), { type: 'below', id: 'dock' });
  assert.deepEqual(target(735, 240), { type: 'edge' });
  assert.equal(target(490, 240), null);
  assert.equal(target(570, 240), null);
  assert.equal(target(747, 30), null);
  assert.deepEqual(panelDockTarget(729, 350, workspace, []), { type: 'edge' });
});
