import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphModel, MAX_GRAPH_NODES } from '../src/graph.js';
import { createSimulation, tickSimulation, pinNode } from '../src/graph-worker.js';

const fixture = {
  nodes: [
    { id: 'a', title: 'Atlas', tags: ['Research/Type'] },
    { id: 'b', title: 'Material memory', tags: ['research/type', 'textile'] },
    { id: 'c', title: 'Composition', tags: ['design'] },
    { id: 'd', title: 'Detached', tags: [] },
  ],
  edges: [{ source: 'a', target: 'b', count: 2 }, { source: 'c', target: 'b', count: 1 }],
};

test('local neighborhoods traverse incoming and outgoing links without admitting disconnected pages', () => {
  const first = buildGraphModel(fixture, { activeId: 'a', scope: 'local', depth: 1, showTags: false });
  assert.deepEqual(new Set(first.nodes.map(node => node.id)), new Set(['a', 'b']));
  const second = buildGraphModel(fixture, { activeId: 'a', scope: 'local', depth: 2, showTags: false });
  assert.deepEqual(new Set(second.nodes.map(node => node.id)), new Set(['a', 'b', 'c']));
  assert.equal(second.edges.length, 2);
  assert.deepEqual(buildGraphModel(fixture, { activeId: 'missing', scope: 'local' }).nodes, []);
});

test('query and hierarchical tag filters retain only relationships between visible pages', () => {
  const model = buildGraphModel(fixture, { tag: '#RESEARCH', query: 'material memory', showTags: false });
  assert.deepEqual(model.nodes.map(node => node.id), ['b']);
  assert.equal(model.edges.length, 0);
  assert.equal(fixture.edges.length, 2, 'Building a view must not mutate the index');
});

test('tags share a case-normalized node identity while document edges retain reference counts', () => {
  const model = buildGraphModel(fixture, { showTags: true });
  assert.equal(model.nodes.filter(node => node.kind === 'tag').length, 3);
  const sharedTag = model.nodes.find(node => node.kind === 'tag' && node.title.toLowerCase() === '#research/type');
  assert.equal(model.edges.filter(edge => edge.target === sharedTag.id).length, 2);
  assert.equal(model.edges.find(edge => edge.source === 'a' && edge.target === 'b').count, 2);
});

test('large views enforce the documented node budget and retain the active page', () => {
  const large = { nodes: Array.from({ length: MAX_GRAPH_NODES + 20 }, (_, i) => ({ id: String(i), title: `Page ${i}`, tags: ['archive'] })), edges: [] };
  const model = buildGraphModel(large, { activeId: '519' });
  assert.equal(model.nodes.length, MAX_GRAPH_NODES);
  assert.ok(model.nodes.some(node => node.id === '519'));
  assert.ok(model.omittedCount > 0);
});

test('empty and isolated layouts finish without invalid coordinates', () => {
  assert.equal(tickSimulation(createSimulation([], [])), true);
  const simulation = createSimulation([{ id: 'a', x: 0, y: 0 }], []);
  let settled = false;
  for (let i = 0; i < 500 && !settled; i += 1) settled = tickSimulation(simulation);
  assert.ok(settled);
  assert.ok(Number.isFinite(simulation.nodes[0].x));
  assert.ok(Number.isFinite(simulation.nodes[0].y));
});

test('coincident connected nodes separate and settle, and missing edge endpoints are ignored', () => {
  const input = Array.from({ length: 30 }, (_, i) => ({ id: String(i), x: 0, y: 0 }));
  const edges = input.slice(1).map(node => ({ source: '0', target: node.id }));
  edges.push({ source: 'missing', target: '0' });
  const simulation = createSimulation(input, edges);
  assert.equal(simulation.edges.length, 29);
  let settled = false;
  for (let i = 0; i < 500 && !settled; i += 1) settled = tickSimulation(simulation);
  assert.ok(settled, 'A graph without active dragging must stop its simulation');
  assert.ok(simulation.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  const xs = simulation.nodes.map(node => node.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 30);
  assert.ok(input.every(node => node.x === 0 && node.y === 0), 'Simulation must not mutate source documents');
});

test('drag constraints hold exactly, then release and allow the graph to settle', () => {
  const simulation = createSimulation([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }], [{ source: 'a', target: 'b' }]);
  assert.equal(pinNode(simulation, 'a', { x: 250, y: -125 }), true);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(tickSimulation(simulation), false);
    assert.equal(simulation.nodes[0].x, 250);
    assert.equal(simulation.nodes[0].y, -125);
  }
  pinNode(simulation, 'a', null);
  let settled = false;
  for (let i = 0; i < 500 && !settled; i += 1) settled = tickSimulation(simulation);
  assert.ok(settled);
  assert.notEqual(simulation.nodes[0].x, 250);
  assert.equal(pinNode(simulation, 'missing', { x: 1, y: 1 }), false);
});
