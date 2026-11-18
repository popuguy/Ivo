import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPageCamera } from '../../src/rendering/page-camera.js';

test('page camera maps authored geometry without changing the document layout scale', () => {
  const world = { style: {} };
  applyPageCamera(world, { x: 123.45, y: -45.6, zoom: 2.5 });
  assert.equal(world.style.zoom, '1');
  const matrix = world.style.transform
      .match(/^matrix\((.+)\)$/)[1]
      .split(',')
      .map(Number),
    [a, b, c, d, x, y] = matrix;
  assert.deepEqual([a * 12 + c * 10 + x, b * 12 + d * 10 + y], [153.45, -20.6]);
  assert.equal(world.style.willChange, 'auto');
  applyPageCamera(world, { x: 124.45, y: -44.6, zoom: 3.125 });
  assert.equal(world.style.zoom, '1');
  assert.ok(!world.style.transform.includes('3d'));
});

test('invalid page camera values are rejected before changing renderer state', () => {
  for (const camera of [
    { x: NaN, y: 0, zoom: 1 },
    { x: 0, y: Infinity, zoom: 1 },
    { x: 0, y: 0, zoom: 0 },
    { x: 0, y: 0, zoom: -1 },
  ]) {
    const world = { style: {} };
    assert.throws(() => applyPageCamera(world, camera), TypeError);
    assert.deepEqual(world.style, {});
  }
});
