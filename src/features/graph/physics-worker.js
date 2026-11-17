// Original Ivo force layout. Runs outside the editing thread; no vendor code.
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
export const SIMULATION_INTERVAL = 1000 / 60;
const ALPHA_DECAY = 1 - 0.001 ** (1 / 300);
const MIN_ALPHA = 0.001;

export function createSimulation(inputNodes = [], inputEdges = []) {
  const ids = new Map(inputNodes.map((node, i) => [String(node.id), i]));
  const nodes = inputNodes.map((node, i) => ({
    id: String(node.id),
    kind: node.kind || 'document',
    x: finite(node.x, Math.cos(i * 2.399963) * 80),
    y: finite(node.y, Math.sin(i * 2.399963) * 80),
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
    degree: 0,
  }));
  const edges = inputEdges.flatMap((edge) => {
    const source = ids.get(String(edge.source));
    const target = ids.get(String(edge.target));
    if (source === undefined || target === undefined || source === target) return [];
    nodes[source].degree += 1;
    nodes[target].degree += 1;
    return [{ source, target, tag: nodes[source].kind === 'tag' || nodes[target].kind === 'tag' }];
  });
  return { nodes, edges, alpha: 1, alphaTarget: 0, ticks: 0 };
}

export function pinNode(simulation, id, position, releasePosition) {
  const node = simulation.nodes.find((item) => item.id === String(id));
  if (!node) return false;
  node.fx = position ? finite(position.x, node.x) : null;
  node.fy = position ? finite(position.y, node.y) : null;
  const at = position || releasePosition;
  if (at) {
    node.x = finite(at.x, node.x);
    node.y = finite(at.y, node.y);
    node.vx = 0;
    node.vy = 0;
  }
  simulation.alphaTarget = simulation.nodes.some((item) => item.fx !== null) ? 0.3 : 0;
  if (position) simulation.alpha = Math.max(simulation.alpha, 0.3);
  return true;
}

export function tickSimulation(simulation) {
  const { nodes, edges } = simulation;
  if (!nodes.length) return true;
  simulation.alpha += (simulation.alphaTarget - simulation.alpha) * ALPHA_DECAY;
  const alpha = simulation.alpha;
  for (const node of nodes) {
    node.vx -= node.x * 0.1 * alpha;
    node.vy -= node.y * 0.1 * alpha;
  }
  // Degree-biased springs use predicted positions. Hubs move less than their
  // neighbors. These force/cooling contracts follow our recorded reference;
  // this implementation is original JavaScript, with no embedded vendor WASM.
  for (const edge of edges) {
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    const dx = target.x + target.vx - source.x - source.vx || 0.001;
    const dy = target.y + target.vy - source.y - source.vy || 0.001;
    const distance = Math.hypot(dx, dy);
    const force =
      (((distance - 250) / distance) * alpha) / Math.max(1, Math.min(source.degree, target.degree));
    const bias = source.degree / (source.degree + target.degree);
    target.vx -= dx * force * bias;
    target.vy -= dy * force * bias;
    source.vx += dx * force * (1 - bias);
    source.vy += dy * force * (1 - bias);
  }
  // At the explicit 500-node budget, exact pairs avoid approximation artifacts
  // and stay off the rendering thread. Benchmark before increasing this budget.
  for (let a = 0; a < nodes.length; a += 1) {
    const left = nodes[a];
    for (let b = a + 1; b < nodes.length; b += 1) {
      const right = nodes[b];
      let dx = left.x - right.x;
      let dy = left.y - right.y;
      let square = dx * dx + dy * dy;
      if (square < 0.01) {
        const angle = (a + 1) * 1.713 + (b + 1) * 2.941;
        dx = Math.cos(angle) * 0.1;
        dy = Math.sin(angle) * 0.1;
        square = 0.01;
      }
      const force = (1000 * alpha) / Math.max(1, square);
      const pushX = dx * force;
      const pushY = dy * force;
      left.vx += pushX;
      left.vy += pushY;
      right.vx -= pushX;
      right.vy -= pushY;
      // Predicted-position collision: a 60-unit radius for each node.
      const cx = left.x + left.vx - right.x - right.vx;
      const cy = left.y + left.vy - right.y - right.vy;
      const separation = Math.hypot(cx, cy);
      if (separation > 0 && separation < 120) {
        const overlap = ((120 - separation) / separation) * 0.25;
        left.vx += cx * overlap;
        left.vy += cy * overlap;
        right.vx -= cx * overlap;
        right.vy -= cy * overlap;
      }
    }
  }
  for (const node of nodes) {
    if (node.fx !== null && node.fy !== null) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= 0.6;
    node.vy *= 0.6;
    node.x += node.vx;
    node.y += node.vy;
  }
  simulation.ticks += 1;
  return simulation.alphaTarget === 0 && simulation.alpha <= MIN_ALPHA;
}

// Importing the pure functions in Node tests does not install a worker loop.
if (
  typeof self !== 'undefined' &&
  typeof self.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  let simulation = null;
  let timer = null;
  let paused = false;
  let revision = 0;
  let nextStep = 0;

  function publish(settled = false) {
    const positions = new Float32Array(simulation.nodes.length * 2);
    simulation.nodes.forEach((node, i) => {
      positions[i * 2] = node.x;
      positions[i * 2 + 1] = node.y;
    });
    self.postMessage({ type: 'positions', positions, settled, revision }, [positions.buffer]);
  }

  function step() {
    timer = null;
    if (!simulation || paused) return;
    const settled = tickSimulation(simulation);
    publish(settled);
    nextStep = Math.max(nextStep + SIMULATION_INTERVAL, performance.now());
    if (!settled) timer = setTimeout(step, Math.max(0, nextStep - performance.now()));
  }

  function start() {
    if (timer === null && !paused) {
      nextStep = performance.now();
      timer = setTimeout(step, 0);
    }
  }

  self.onmessage = ({ data }) => {
    if (data.type === 'init') {
      clearTimeout(timer);
      timer = null;
      simulation = createSimulation(data.nodes, data.edges);
      revision = 0;
      paused = false;
      publish(simulation.nodes.length < 2);
      if (simulation.nodes.length > 1) start();
    } else if (data.type === 'pin' && simulation) {
      if (pinNode(simulation, data.id, data.position, data.at)) {
        revision = Math.max(revision, data.revision || 0);
        start();
      }
    } else if (data.type === 'pause') {
      paused = true;
      clearTimeout(timer);
      timer = null;
    } else if (data.type === 'resume') {
      paused = false;
      if (simulation && simulation.alpha > MIN_ALPHA) start();
    }
  };
}
