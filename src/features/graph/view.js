import { createGraphWorker } from './worker-factory.js';

import { cursor } from '../../shared/ui/icons.js';
import { createPositionStream, advanceCamera } from './motion.js';
import { createGraphRenderer } from './renderer.js';

// Graph interaction and its derived view model. Document data stays in the app.
const positions = new Map();
export const MAX_GRAPH_NODES = 500;
const TAG_PREFIX = '\u0000tag:';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normal = (value) =>
  String(value ?? '')
    .replace(/^#/, '')
    .trim()
    .toLocaleLowerCase();
const endpoint = (value) => String(value && typeof value === 'object' ? value.id : value);
const values = (value) =>
  value instanceof Map
    ? [...value.values()]
    : Array.isArray(value)
      ? value
      : Object.values(value || {});

export function buildGraphModel(
  index = {},
  { activeId, scope = 'global', depth = 1, showTags = true, tag = '', query = '' } = {},
) {
  const allNodes = values(index.nodes).map((node) => ({
    id: String(node.id),
    title: String(node.title || 'Untitled'),
    tags: Array.isArray(node.tags) ? node.tags.map(String) : [],
    kind: 'document',
  }));
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const allEdges = values(index.edges)
    .map((edge) => ({
      source: endpoint(edge.source),
      target: endpoint(edge.target),
      count: edge.count || 1,
    }))
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  let allowed = new Set(byId.keys());
  if (scope === 'local') {
    const center = String(activeId ?? '');
    allowed = new Set(byId.has(center) ? [center] : []);
    let frontier = new Set(allowed);
    for (let hop = 0; hop < clamp(Number(depth) || 0, 0, 8); hop += 1) {
      const next = new Set();
      for (const edge of allEdges) {
        if (frontier.has(edge.source) && !allowed.has(edge.target)) next.add(edge.target);
        if (frontier.has(edge.target) && !allowed.has(edge.source)) next.add(edge.source);
      }
      for (const id of next) allowed.add(id);
      frontier = next;
      if (!frontier.size) break;
    }
  }
  const wantedTag = normal(tag);
  const terms = String(query || '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const candidates = allNodes.filter((node) => {
    if (!allowed.has(node.id)) return false;
    const tags = node.tags.map(normal);
    if (wantedTag && !tags.some((item) => item === wantedTag || item.startsWith(`${wantedTag}/`)))
      return false;
    const text = `${node.title} ${node.tags.join(' ')}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  // Keep the current document visible when a large view needs truncating.
  candidates.sort((a, b) => Number(b.id === String(activeId)) - Number(a.id === String(activeId)));
  const nodes = candidates.slice(0, MAX_GRAPH_NODES);
  const selectedIds = new Set(nodes.map((node) => node.id));
  const edges = allEdges.filter(
    (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
  );
  let omittedCount = Math.max(0, candidates.length - nodes.length);
  if (showTags) {
    const tagMap = new Map();
    for (const node of nodes) {
      for (const name of node.tags) {
        const key = normal(name);
        if (!key) continue;
        if (!tagMap.has(key))
          tagMap.set(key, {
            id: TAG_PREFIX + key,
            title: '#' + name.replace(/^#/, ''),
            kind: 'tag',
            tags: [],
          });
      }
    }
    const shownTags = [...tagMap.values()].slice(0, Math.max(0, MAX_GRAPH_NODES - nodes.length));
    omittedCount += tagMap.size - shownTags.length;
    const shownTagIds = new Set(shownTags.map((node) => node.id));
    for (const node of nodes) {
      for (const key of new Set(node.tags.map(normal))) {
        if (shownTagIds.has(TAG_PREFIX + key))
          edges.push({ source: node.id, target: TAG_PREFIX + key, count: 1, kind: 'tag' });
      }
    }
    nodes.push(...shownTags);
  }
  return { nodes, edges, omittedCount };
}

export function mountGraph(container, options = {}) {
  const { activeId, onOpen = () => {} } = options;
  const model = buildGraphModel(options.index, options);
  const root = document.createElement('div');
  root.className = 'ivo-graph';
  Object.assign(root.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: '280px',
    overflow: 'hidden',
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'ivo-graph-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Knowledge graph. Drag the background to pan, drag a node to move it, and scroll to zoom. Press plus or minus to zoom and zero to fit. Use the adjacent page list to open pages with a keyboard.',
  );
  Object.assign(canvas.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    position: 'absolute',
    inset: '0',
    touchAction: 'none',
    cursor: cursor('hand', 'grab'),
  });
  root.append(canvas);
  const note = document.createElement('p');
  note.className = 'ivo-graph-note';
  Object.assign(note.style, {
    position: 'absolute',
    margin: '0',
    left: '20px',
    bottom: '16px',
    right: '20px',
    color: '#77756f',
    fontSize: '11px',
    pointerEvents: 'none',
  });
  if (model.omittedCount)
    note.textContent = `Showing ${model.nodes.length} nodes. Narrow your search to reveal more.`;
  root.append(note);
  container.append(root);
  let destroyed = false;
  let frame = 0;
  let lastFrame = 0;
  let worker = null;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let fitted = false;
  let interacted = false;
  let hover = null;
  let hoverPoint = null;
  let selectedTag = null;
  let gesture = null;
  let pinch = null;
  const pointers = new Map();
  const camera = { x: 0, y: 0, scale: 1, targetScale: 1, zoomAnchor: { x: 0, y: 0 }, vx: 0, vy: 0 };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const nodeMap = new Map();
  const neighbors = new Map(model.nodes.map((node) => [node.id, new Set()]));
  const degree = new Map(model.nodes.map((node) => [node.id, 0]));
  for (const edge of model.edges) {
    if (edge.source === edge.target) continue;
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  const radius = Math.max(80, Math.sqrt(model.nodes.length) * 30);
  const nodes = model.nodes.map((node, i) => {
    const cached = positions.get(node.id);
    const angle = i * 2.399963;
    const ring = radius * Math.sqrt((i + 0.5) / Math.max(1, model.nodes.length));
    const result = {
      ...node,
      x: cached?.x ?? Math.cos(angle) * ring,
      y: cached?.y ?? Math.sin(angle) * ring,
      radius: node.kind === 'tag' ? 3.5 : clamp(4 + Math.sqrt(degree.get(node.id) || 0), 4, 9),
    };
    nodeMap.set(node.id, result);
    return result;
  });
  const edges = model.edges.map((edge) => ({
    ...edge,
    from: nodeMap.get(edge.source),
    to: nodeMap.get(edge.target),
  }));
  const fontFamily = getComputedStyle(container).fontFamily || 'system-ui, sans-serif';
  const stream = createPositionStream(nodes);
  const renderer = createGraphRenderer(root, canvas, nodes, edges, {
    activeId,
    neighbors,
    fontFamily,
    changed: requestDraw,
  });
  document.fonts?.ready.then(() => {
    if (!destroyed) {
      renderer.invalidateText();
      requestDraw();
    }
  });

  function screen(node) {
    return { x: node.x * camera.scale + camera.x, y: node.y * camera.scale + camera.y };
  }

  function world(point) {
    return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function requestDraw() {
    if (!destroyed && !frame && width && height) frame = requestAnimationFrame(draw);
  }

  function fit(markInteraction = true) {
    if (destroyed || !nodes.length || !width || !height) return;
    if (markInteraction) interacted = true;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
    const usableWidth = Math.max(80, width - 140);
    const usableHeight = Math.max(80, height - 110);
    camera.scale = clamp(
      Math.min(usableWidth / Math.max(260, maxX - minX), usableHeight / Math.max(200, maxY - minY)),
      0.08,
      1.4,
    );
    camera.targetScale = camera.scale;
    camera.vx = camera.vy = 0;
    camera.x = width / 2 - ((minX + maxX) / 2) * camera.scale;
    camera.y = height / 2 - ((minY + maxY) / 2) * camera.scale;
    fitted = true;
    requestDraw();
  }

  function flushPins() {
    for (const command of stream.commands()) worker?.postMessage(command);
  }

  function draw(now) {
    frame = 0;
    if (destroyed) return;
    const elapsed = lastFrame ? Math.min(64, now - lastFrame) : 1000 / 60;
    lastFrame = now;
    flushPins();
    const snapshot = stream.apply();
    if (hover && hoverPoint && !gesture && hit(hoverPoint)?.id !== hover) {
      hover = null;
      canvas.title = '';
    }
    if (snapshot?.settled && !interacted) fit(false);
    const moving = advanceCamera(camera, elapsed, {
      reducedMotion: reducedMotion?.matches,
      panning: Boolean(gesture || pinch),
    });
    const fading = renderer.render(camera, {
      focus: gesture?.node?.id || hover || selectedTag,
      elapsed,
      reducedMotion: reducedMotion?.matches,
    });
    if (moving || fading) requestDraw();
    else lastFrame = 0;
  }

  function hit(point) {
    let closest = null,
      best = Infinity;
    for (const node of nodes) {
      const p = screen(node);
      const distance = Math.hypot(p.x - point.x, p.y - point.y);
      const hitRadius = Math.max(13, node.radius * Math.sqrt(camera.scale) + 6);
      if (distance < hitRadius && distance < best) {
        closest = node;
        best = distance;
      }
    }
    return closest;
  }

  function zoom(factor, at = { x: width / 2, y: height / 2 }) {
    camera.targetScale = clamp(camera.targetScale * factor, 0.08, 4);
    camera.zoomAnchor = at;
    camera.vx = camera.vy = 0;
    interacted = true;
    requestDraw();
  }

  function releasePin() {
    if (gesture?.node) {
      stream.release(gesture.node);
      flushPins();
    }
  }

  function pointerDown(event) {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const p = point(event);
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, p);
    camera.vx = camera.vy = 0;
    camera.targetScale = camera.scale;
    interacted = true;
    if (pointers.size === 2) {
      releasePin();
      gesture = null;
      const [a, b] = [...pointers.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        scale: camera.scale,
        world: world(center),
      };
      return;
    }
    if (pointers.size > 2) return;
    const node = hit(p);
    gesture = {
      pointerId: event.pointerId,
      start: p,
      last: p,
      time: event.timeStamp,
      node,
      moved: false,
      offset: node ? { x: node.x - world(p).x, y: node.y - world(p).y } : null,
    };
    if (node) stream.pin(node, node);
    canvas.style.cursor = cursor('fist', 'grabbing');
    requestDraw();
  }

  function pointerMove(event) {
    const p = point(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      camera.scale = clamp(
        (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance,
        0.08,
        4,
      );
      camera.targetScale = camera.scale;
      camera.x = center.x - pinch.world.x * camera.scale;
      camera.y = center.y - pinch.world.y * camera.scale;
      requestDraw();
      return;
    }
    if (gesture?.pointerId === event.pointerId) {
      gesture.moved ||= Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 4;
      if (gesture.node) {
        const location = world(p);
        stream.pin(gesture.node, {
          x: location.x + gesture.offset.x,
          y: location.y + gesture.offset.y,
        });
      } else {
        const dx = p.x - gesture.last.x,
          dy = p.y - gesture.last.y;
        camera.x += dx;
        camera.y += dy;
        const dt = Math.max(1, event.timeStamp - gesture.time);
        const blend = 1 - 0.8 ** (dt / (1000 / 60));
        camera.vx += ((dx / dt) * (1000 / 60) - camera.vx) * blend;
        camera.vy += ((dy / dt) * (1000 / 60) - camera.vy) * blend;
      }
      gesture.last = p;
      gesture.time = event.timeStamp;
      requestDraw();
      return;
    }
    hoverPoint = p;
    const next = hit(p)?.id || null;
    if (hover !== next) {
      hover = next;
      canvas.title = nodeMap.get(next)?.title || '';
      requestDraw();
    }
    canvas.style.cursor = next ? cursor('select-selection') : cursor('hand', 'grab');
  }

  function pointerEnd(event) {
    if (!pointers.has(event.pointerId) && gesture?.pointerId !== event.pointerId) return;
    const releaseAge = event.timeStamp - (gesture?.time ?? event.timeStamp);
    if (event.type === 'pointerup' && gesture?.pointerId === event.pointerId) pointerMove(event);
    pointers.delete(event.pointerId);
    const finished = gesture?.pointerId === event.pointerId ? gesture : null;
    if (finished) {
      releasePin();
      if (finished.node || event.type !== 'pointerup' || !finished.moved || releaseAge > 100)
        camera.vx = camera.vy = 0;
      gesture = null;
    }
    if (pinch) {
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinch = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          scale: camera.scale,
          world: world(center),
        };
      } else if (pointers.size === 1) {
        pinch = null;
        const [id, p] = [...pointers.entries()][0];
        gesture = {
          pointerId: id,
          start: p,
          last: p,
          time: event.timeStamp,
          node: null,
          moved: true,
        };
      } else pinch = null;
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = hover ? cursor('select-selection') : cursor('hand', 'grab');
    requestDraw();
    if (finished && !finished.moved && event.type === 'pointerup' && finished.node) {
      if (finished.node.kind === 'tag') {
        selectedTag = selectedTag === finished.node.id ? null : finished.node.id;
        requestDraw();
      } else
        onOpen(finished.node.id, {
          newTab: event.metaKey || event.ctrlKey,
          toRight: (event.metaKey || event.ctrlKey) && event.altKey,
        });
    }
  }

  function pointerLeave() {
    if (!gesture && !pinch) {
      hover = null;
      hoverPoint = null;
      canvas.title = '';
      requestDraw();
    }
  }

  function wheel(event) {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    zoom(Math.exp(-clamp(delta, -300, 300) * 0.0015), point(event));
  }

  function keyDown(event) {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoom(1.2);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoom(1 / 1.2);
    } else if (event.key === '0') {
      event.preventDefault();
      fit();
    } else if (event.key === 'Escape') {
      selectedTag = null;
      hover = null;
      requestDraw();
    }
  }

  function captureView() {
    return {
      center: {
        x: (width / 2 - camera.x) / camera.scale,
        y: (height / 2 - camera.y) / camera.scale,
      },
      scale: camera.scale,
    };
  }
  function restoreView(value) {
    const center = value?.center,
      scale = value?.scale;
    if (
      !center ||
      ![center.x, center.y, scale].every(Number.isFinite) ||
      Math.abs(center.x) > 1e9 ||
      Math.abs(center.y) > 1e9 ||
      scale < 0.08 ||
      scale > 4
    )
      return false;
    Object.assign(camera, {
      x: width / 2 - center.x * scale,
      y: height / 2 - center.y * scale,
      scale,
      targetScale: scale,
      vx: 0,
      vy: 0,
    });
    interacted = true;
    fitted = true;
    requestDraw();
    return true;
  }

  function resize() {
    if (destroyed) return;
    const rect = root.getBoundingClientRect();
    const nextWidth = Math.max(0, rect.width),
      nextHeight = Math.max(0, rect.height);
    const nextRatio = Math.min(window.devicePixelRatio || 1, 3);
    if (nextWidth === width && nextHeight === height && nextRatio === ratio) return;
    camera.x += (nextWidth - width) / 2;
    camera.y += (nextHeight - height) / 2;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    renderer.resize(width, height, ratio);
    if (!fitted && width && height) fit(false);
    requestDraw();
  }

  function visibility() {
    worker?.postMessage({ type: document.hidden ? 'pause' : 'resume' });
    if (!document.hidden) requestDraw();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('lostpointercapture', pointerEnd);
  canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', keyDown);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(root);
  resize();
  if (options.initialState) restoreView(options.initialState);

  if (!nodes.length || !renderer.available) {
    const empty = document.createElement('div');
    empty.className = 'ivo-graph-empty';
    Object.assign(empty.style, {
      position: 'absolute',
      inset: '0',
      display: 'grid',
      placeContent: 'center',
      textAlign: 'center',
      color: '#77756f',
      padding: '30px',
      pointerEvents: 'none',
    });
    empty.textContent = !renderer.available
      ? 'This browser cannot display the graph.'
      : 'No pages in this view. Try another search or tag.';
    root.append(empty);
    canvas.tabIndex = -1;
  } else {
    try {
      worker = createGraphWorker();
      worker.onmessage = ({ data }) => {
        if (destroyed || data.type !== 'positions') return;
        stream.receive(data);
        requestDraw();
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        note.textContent =
          'Automatic layout is unavailable. You can still move, explore, and open pages.';
      };
      worker.postMessage({
        type: 'init',
        nodes: nodes.map(({ id, x, y, kind }) => ({ id, x, y, kind })),
        edges: model.edges,
      });
      if (document.hidden) visibility();
    } catch {
      worker?.terminate();
      worker = null;
      note.textContent =
        'Automatic layout is unavailable. You can still move, explore, and open pages.';
    }
  }

  return {
    fit: () => fit(),
    captureView,
    restoreView,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const node of nodes) positions.set(node.id, { x: node.x, y: node.y });
      // Avoid an unbounded session cache after opening many unrelated libraries.
      while (positions.size > 3000) positions.delete(positions.keys().next().value);
      worker?.terminate();
      renderer.destroy();
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd);
      canvas.removeEventListener('pointercancel', pointerEnd);
      canvas.removeEventListener('lostpointercapture', pointerEnd);
      canvas.removeEventListener('pointerleave', pointerLeave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', keyDown);
      root.remove();
    },
  };
}
