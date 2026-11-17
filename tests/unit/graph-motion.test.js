import test from 'node:test';
import assert from 'node:assert/strict';
import { createPositionStream, advanceCamera } from '../../src/features/graph/motion.js';
import {
  createSimulation,
  pinNode,
  tickSimulation,
} from '../../src/features/graph/physics-worker.js';

test('late worker snapshots cannot pull a dragged or just-released node backwards', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
  ];
  const stream = createPositionStream(nodes);
  stream.pin(nodes[0], { x: 250, y: 20 });
  stream.receive({ positions: new Float32Array([10, 0, 110, 1]), revision: 0 });
  stream.apply();
  assert.equal(nodes[0].x, 250);
  assert.equal(nodes[1].x, 110, 'Unconstrained neighbors still follow the worker');
  stream.release(nodes[0]);
  const [release] = stream.commands();
  assert.equal(release.position, null);
  assert.deepEqual(release.at, { x: 250, y: 20 });
  stream.receive({ positions: new Float32Array([15, 0, 120, 2]), revision: release.revision - 1 });
  stream.apply();
  assert.equal(nodes[0].x, 250, 'Release waits for its acknowledgement');
  stream.receive({ positions: new Float32Array([249, 19, 125, 3]), revision: release.revision });
  stream.apply();
  assert.equal(nodes[0].x, 249, 'Acknowledged physics resumes without a stale jump');
});

test('many pointer events collapse to one latest command per node and frame', () => {
  const node = { id: 'a', x: 0, y: 0 };
  const stream = createPositionStream([node]);
  for (let i = 0; i < 100; i++) stream.pin(node, { x: i, y: 2 * i });
  const commands = stream.commands();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].position, { x: 99, y: 198 });
  assert.equal(stream.commands().length, 0);
  stream.receive({ positions: new Float32Array([1]), revision: 100 });
  assert.equal(stream.apply(), null, 'A wrong-size snapshot is ignored');
});

test('a new drag remains protected from the previous release acknowledgement', () => {
  const node = { id: 'a', x: 0, y: 0 };
  const stream = createPositionStream([node]);
  stream.pin(node, { x: 100, y: 0 });
  stream.release(node);
  const [release] = stream.commands();
  stream.pin(node, { x: 200, y: 0 });
  stream.receive({ positions: new Float32Array([100, 0]), revision: release.revision });
  stream.apply();
  assert.equal(node.x, 200);
});

test('release sends the final pointer location even when no pinned tick ran', () => {
  const simulation = createSimulation([{ id: 'a', x: 0, y: 0 }], []);
  pinNode(simulation, 'a', { x: 20, y: 30 });
  pinNode(simulation, 'a', null, { x: 100, y: 200 });
  assert.equal(simulation.nodes[0].x, 100);
  assert.equal(simulation.nodes[0].y, 200);
  assert.equal(simulation.nodes[0].vx, 0);
  assert.equal(simulation.alphaTarget, 0);
});

test('continuous dragging holds a steady temperature and then cools to idle', () => {
  const simulation = createSimulation([{ id: 'a', x: 0, y: 0 }], []);
  for (let i = 0; i < 350; i++) tickSimulation(simulation);
  for (let i = 0; i < 180; i++) {
    pinNode(simulation, 'a', { x: i, y: 0 });
    assert.equal(tickSimulation(simulation), false);
  }
  assert.ok(
    Math.abs(simulation.alpha - 0.3) < 1e-10,
    'Pointer frequency must not reheat the graph',
  );
  pinNode(simulation, 'a', null);
  let settled = false;
  for (let i = 0; i < 301 && !settled; i++) settled = tickSimulation(simulation);
  assert.ok(settled);
});

function camera() {
  return { x: 200, y: 100, scale: 1, targetScale: 2, zoomAnchor: { x: 300, y: 250 }, vx: 0, vy: 0 };
}

test('zoom preserves its cursor anchor and follows the same curve at 60 and 120 Hz', () => {
  const a = camera(),
    b = camera();
  const anchorWorld = { x: 100, y: 150 };
  for (let i = 0; i < 30; i++) advanceCamera(a, 1000 / 60);
  for (let i = 0; i < 60; i++) advanceCamera(b, 1000 / 120);
  for (const key of ['x', 'y', 'scale']) assert.ok(Math.abs(a[key] - b[key]) < 1e-9);
  assert.ok(Math.abs((a.zoomAnchor.x - a.x) / a.scale - anchorWorld.x) < 1e-9);
  assert.ok(Math.abs((a.zoomAnchor.y - a.y) / a.scale - anchorWorld.y) < 1e-9);
});

test('pan coasts consistently across refresh rates and reduced motion disables it', () => {
  const a = { ...camera(), targetScale: 1, vx: 10 },
    b = { ...a };
  for (let i = 0; i < 30; i++) advanceCamera(a, 1000 / 60);
  for (let i = 0; i < 60; i++) advanceCamera(b, 1000 / 120);
  assert.ok(Math.abs(a.x - b.x) < 1e-9);
  const reduced = { ...camera(), vx: 10 };
  advanceCamera(reduced, 1000 / 60, { reducedMotion: true });
  assert.equal(reduced.scale, 2);
  assert.equal(reduced.vx, 0);
});
