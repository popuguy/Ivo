import { mountGraph } from '../../../src/features/graph/view.js';
import { createGraphRenderer } from '../../../src/features/graph/renderer.js';

const errors = [];
addEventListener('error', (event) => errors.push(event.message));
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const frame = () => new Promise(requestAnimationFrame);
async function frames(count) {
  for (let i = 0; i < count; i++) await frame();
}
function summary(values) {
  values.sort((a, b) => a - b);
  return {
    samples: values.length,
    medianMs: values[values.length >> 1],
    p95Ms: values[Math.floor(values.length * 0.95)],
    maxMs: values.at(-1),
  };
}

let worker, renderer;
try {
  console.log('Graph runtime: drawing workload');
  const root = document.querySelector('#stage'),
    canvas = document.createElement('canvas');
  root.append(canvas);
  const nodes = Array.from({ length: 500 }, (_, i) => ({
    id: String(i),
    title: `Research note ${i}: connected ideas`,
    x: ((i % 25) - 12) * 32,
    y: (Math.floor(i / 25) - 10) * 25,
    radius: 6,
    kind: 'document',
  }));
  const edges = nodes.slice(1).flatMap((node, i) => [
    { source: node.id, target: nodes[i >> 1].id, from: node, to: nodes[i >> 1] },
    { source: node.id, target: nodes[(i + 17) % 500].id, from: node, to: nodes[(i + 17) % 500] },
  ]);
  const density = devicePixelRatio || 1;
  renderer = createGraphRenderer(root, canvas, nodes, edges, {
    activeId: '0',
    neighbors: new Map(),
    fontFamily: 'system-ui',
  });
  renderer.resize(1100, 700, density);
  const camera = { x: 550, y: 350, scale: 0.8 };
  for (let i = 0; i < 20; i++) {
    await frame();
    renderer.render(camera);
  }
  const times = [];
  for (let i = 0; i < 180; i++) {
    await frame();
    nodes.forEach((node, n) => {
      node.x += Math.sin((i + n) / 40) * 0.2;
    });
    const start = performance.now();
    renderer.render(camera);
    times.push(performance.now() - start);
  }
  const report = {
    nodes: nodes.length,
    edges: edges.length,
    density,
    backend: renderer.backend,
    drawing: summary(times),
  };
  renderer.destroy();
  canvas.remove();
  console.log('Graph runtime: GPU recovery');

  const target = document.createElement('canvas');
  root.append(target);
  const node = { id: 'test', title: 'GPU test', x: 0, y: 0, radius: 7, kind: 'document' };
  renderer = createGraphRenderer(root, target, [node], [], {
    activeId: 'test',
    neighbors: new Map(),
    fontFamily: 'system-ui',
  });
  renderer.resize(1100, 700, density);
  const centered = { x: 550, y: 350, scale: 1 };
  renderer.render(centered);
  if (renderer.backend === 'webgl') {
    const gl = root.querySelector('canvas[aria-hidden]').getContext('webgl');
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(550 * density),
      Math.floor(350 * density),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    check(pixel[3] > 240 && Math.abs(pixel[2] - 182) < 3, 'GPU node pixel was not drawn');
    check(gl.getError() === gl.NO_ERROR, 'GPU rendering produced an error');
    report.gpuPixel = Array.from(pixel);
    const extension = gl.getExtension('WEBGL_lose_context');
    if (extension) {
      extension.loseContext();
      await frames(3);
      check(renderer.backend === 'canvas', 'Lost GPU context did not fall back to Canvas');
      renderer.render(centered);
      const fallback = target
        .getContext('2d')
        .getImageData(Math.floor(550 * density), Math.floor(350 * density), 1, 1).data;
      check(
        fallback[3] > 240 && Math.abs(fallback[2] - 182) < 3,
        'Canvas fallback node was not drawn',
      );
      extension.restoreContext();
      for (let i = 0; i < 60 && renderer.backend !== 'webgl'; i++) await frame();
      check(renderer.backend === 'webgl', 'GPU context did not restore');
      report.contextRecovery = true;
    }
  }
  renderer.destroy();
  renderer = null;
  console.log('Graph runtime: worker transport');

  worker = new Worker('../../../src/features/graph/physics-worker.js', { type: 'module' });
  const intervals = [];
  let count = 0,
    previous = 0,
    ack;
  const published = new Promise((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(`Graph worker failed: ${event.message}`));
    worker.onmessage = ({ data }) => {
      check(data.positions.length === 1000, 'Worker published a malformed position buffer');
      check(data.positions.every(Number.isFinite), 'Worker published invalid positions');
      const now = performance.now();
      if (previous) intervals.push(now - previous);
      previous = now;
      if (++count === 70) resolve();
      if (data.revision === 2) ack?.(data);
    };
  });
  worker.postMessage({
    type: 'init',
    nodes,
    edges: edges.map(({ source, target }) => ({ source, target })),
  });
  worker.postMessage({ type: 'pin', id: '0', position: { x: 300, y: 100 }, revision: 1 });
  await Promise.race([
    published,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`Worker stalled after ${count} snapshots`)), 5000),
    ),
  ]);
  const released = new Promise((resolve) => {
    ack = resolve;
  });
  worker.postMessage({ type: 'pin', id: '0', position: null, at: { x: 320, y: 110 }, revision: 2 });
  await released;
  report.worker = { publication: summary(intervals.slice(3)), releaseAcknowledged: true };
  worker.terminate();
  worker = null;
  check(errors.length === 0, errors.join('\n'));
  const graphHost = document.createElement('div');
  Object.assign(graphHost.style, { width: '380px', height: '280px' });
  document.body.append(graphHost);
  const view = { center: { x: 123.25, y: -45.5 }, scale: 1.7 },
    graph = mountGraph(graphHost, {
      index: { nodes: [{ id: 'view-node', title: 'View', tags: [] }], edges: [] },
      initialState: view,
    });
  await frames(2);
  const firstView = graph.captureView();
  check(
    Math.abs(firstView.center.x - view.center.x) < 1e-9 && firstView.scale === view.scale,
    'Initial graph camera was not restored',
  );
  graphHost.style.width = '520px';
  await frames(3);
  const resizedView = graph.captureView();
  check(Math.abs(resizedView.center.x - view.center.x) < 1e-9, 'Resizing moved graph world center');
  check(
    graph.restoreView({ center: { x: 1, y: 2 }, scale: 99 }) === false,
    'Invalid graph view accepted',
  );
  graph.destroy();
  graphHost.remove();
  report.graphViewRestoration = true;
  console.log('IVO_GRAPH_RESULT:' + JSON.stringify(report));
} catch (error) {
  worker?.terminate();
  renderer?.destroy();
  console.log('IVO_GRAPH_RESULT:' + JSON.stringify({ error: error.stack, errors }));
}
