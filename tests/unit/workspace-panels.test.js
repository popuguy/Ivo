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
