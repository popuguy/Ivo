// Original Ivo force layout. Runs outside the editing thread; no vendor code.
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createSimulation(inputNodes = [], inputEdges = []) {
  const ids = new Map(inputNodes.map((node, i) => [String(node.id), i]));
  const nodes = inputNodes.map((node, i) => ({
    id: String(node.id), kind: node.kind || 'document',
    x: finite(node.x, Math.cos(i * 2.399963) * 80),
    y: finite(node.y, Math.sin(i * 2.399963) * 80),
    vx: 0, vy: 0, fx: null, fy: null, degree: 0,
  }));
  const edges = inputEdges.flatMap(edge => {
    const source = ids.get(String(edge.source));
    const target = ids.get(String(edge.target));
    if (source === undefined || target === undefined || source === target) return [];
    nodes[source].degree += 1;
    nodes[target].degree += 1;
    return [{ source, target, tag: nodes[source].kind === 'tag' || nodes[target].kind === 'tag' }];
  });
  return { nodes, edges, alpha: 1, ticks: 0, quietTicks: 0 };
}

export function pinNode(simulation, id, position) {
  const node = simulation.nodes.find(item => item.id === String(id));
  if (!node) return false;
  node.fx = position ? finite(position.x, node.x) : null;
  node.fy = position ? finite(position.y, node.y) : null;
  if (position) {
    node.x = node.fx;
    node.y = node.fy;
    node.vx = 0;
    node.vy = 0;
  }
  simulation.alpha = Math.max(simulation.alpha, .5);
  simulation.ticks = 0;
  simulation.quietTicks = 0;
  return true;
}

export function tickSimulation(simulation) {
  const { nodes, edges, alpha } = simulation;
  if (!nodes.length) return true;
  // The view deliberately caps its complete model at 500 nodes. This simple
  // pairwise force is predictable at that scale and stays in this worker.
  for (let a = 0; a < nodes.length; a += 1) {
    const left = nodes[a];
    for (let b = a + 1; b < nodes.length; b += 1) {
      const right = nodes[b];
      let dx = left.x - right.x;
      let dy = left.y - right.y;
      let square = dx * dx + dy * dy;
      if (square < .01) {
        const angle = (a + 1) * 1.713 + (b + 1) * 2.941;
        dx = Math.cos(angle) * .1;
        dy = Math.sin(angle) * .1;
        square = .01;
      }
      const distance = Math.sqrt(square);
      const charge = left.kind === 'tag' || right.kind === 'tag' ? .65 : 1;
      const force = Math.min(5, 1700 * charge / (square + 90)) * alpha;
      const pushX = dx / distance * force;
      const pushY = dy / distance * force;
      left.vx += pushX;
      left.vy += pushY;
      right.vx -= pushX;
      right.vy -= pushY;
    }
  }
  for (const edge of edges) {
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(.1, Math.hypot(dx, dy));
    const rest = edge.tag ? 95 : 132;
    const strength = .035 / Math.sqrt(Math.max(1, Math.min(source.degree, target.degree)));
    const force = (distance - rest) * strength * alpha;
    const pushX = dx / distance * force;
    const pushY = dy / distance * force;
    source.vx += pushX;
    source.vy += pushY;
    target.vx -= pushX;
    target.vy -= pushY;
  }
  let energy = 0;
  let hasPin = false;
  for (const node of nodes) {
    if (node.fx !== null && node.fy !== null) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
      hasPin = true;
      continue;
    }
    node.vx = clamp((node.vx - node.x * .004 * alpha) * .77, -18, 18);
    node.vy = clamp((node.vy - node.y * .004 * alpha) * .77, -18, 18);
    node.x += node.vx;
    node.y += node.vy;
    energy += node.vx * node.vx + node.vy * node.vy;
  }
  simulation.ticks += 1;
  simulation.alpha = Math.max(hasPin ? .12 : 0, alpha * .976);
  simulation.quietTicks = energy / nodes.length < .0025 ? simulation.quietTicks + 1 : 0;
  return !hasPin && (
    simulation.alpha < .008 ||
    (simulation.ticks > 60 && simulation.quietTicks > 20) ||
    simulation.ticks >= 420
  );
}

// Importing the pure functions in Node tests does not install a worker loop.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined') {
  let simulation = null;
  let timer = null;
  let paused = false;

  function publish(settled = false) {
    const positions = new Float32Array(simulation.nodes.length * 2);
    simulation.nodes.forEach((node, i) => {
      positions[i * 2] = node.x;
      positions[i * 2 + 1] = node.y;
    });
    self.postMessage({ type: 'positions', positions, settled }, [positions.buffer]);
  }

  function step() {
    timer = null;
    if (!simulation || paused) return;
    const settled = tickSimulation(simulation);
    if (settled || simulation.ticks % 2 === 0) publish(settled);
    if (!settled) timer = setTimeout(step, 16);
  }

  function start() {
    if (timer === null && !paused) timer = setTimeout(step, 0);
  }

  self.onmessage = ({ data }) => {
    if (data.type === 'init') {
      clearTimeout(timer);
      timer = null;
      simulation = createSimulation(data.nodes, data.edges);
      paused = false;
      publish(simulation.nodes.length < 2);
      if (simulation.nodes.length > 1) start();
    } else if (data.type === 'pin' && simulation) {
      if (pinNode(simulation, data.id, data.position)) start();
    } else if (data.type === 'pause') {
      paused = true;
      clearTimeout(timer);
      timer = null;
    } else if (data.type === 'resume') {
      paused = false;
      if (simulation && simulation.alpha >= .008) start();
    }
  };
}
