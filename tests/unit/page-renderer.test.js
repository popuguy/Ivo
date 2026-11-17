import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPageCamera } from '../../src/rendering/page-camera.js';

test('page camera changes paint zoom while its compositor transform only translates', () => {
  const world = { style: {} };
  applyPageCamera(world, { x: 123.45, y: -45.6, zoom: 2.5 });
  assert.equal(world.style.zoom, '2.5');
  const translated = world.style.transform.match(/translate3d\(([^p]+)px,([^p]+)px,0\)/);
  assert.ok(translated);
  assert.ok(
    Math.abs(Number(translated[1]) * 2.5 - 123.45) < 1e-10 &&
      Math.abs(Number(translated[2]) * 2.5 + 45.6) < 1e-10,
  );
  assert.equal(world.style.willChange, 'auto');
  assert.ok(!world.style.transform.includes('scale'));
  const zoom = world.style.zoom;
  applyPageCamera(world, { x: 124.45, y: -44.6, zoom: 2.5 });
  assert.equal(world.style.zoom, zoom);
  assert.ok(!world.style.transform.includes('scale'));
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
