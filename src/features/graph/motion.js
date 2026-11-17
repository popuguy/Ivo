// Worker snapshots are consumed on animation frames. A drag owns its node until
// the worker acknowledges the final pointer position, including on release.
export function createPositionStream(nodes) {
  let revision = 0;
  let latest = null;
  const pinned = new Set();
  const barriers = new Map();
  const pending = new Map();

  return {
    pin(node, position) {
      node.x = position.x;
      node.y = position.y;
      pinned.add(node.id);
      barriers.set(node.id, ++revision);
      pending.set(node.id, {
        type: 'pin',
        id: node.id,
        position: { x: node.x, y: node.y },
        revision,
      });
    },
    release(node) {
      if (!pinned.delete(node.id)) return;
      barriers.set(node.id, ++revision);
      pending.set(node.id, {
        type: 'pin',
        id: node.id,
        position: null,
        at: { x: node.x, y: node.y },
        revision,
      });
    },
    commands() {
      const commands = [...pending.values()];
      pending.clear();
      return commands;
    },
    receive(snapshot) {
      if (snapshot.positions?.length === nodes.length * 2) latest = snapshot;
    },
    apply() {
      if (!latest) return null;
      const snapshot = latest;
      latest = null;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (pinned.has(node.id) || (snapshot.revision ?? 0) < (barriers.get(node.id) ?? 0))
          continue;
        const x = snapshot.positions[i * 2],
          y = snapshot.positions[i * 2 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        node.x = x;
        node.y = y;
        barriers.delete(node.id);
      }
      return snapshot;
    },
  };
}

// Time-based equivalents of a 60 Hz zoom ease (15%) and pan friction (10%).
// Keeping these independent of refresh rate also serves 120 Hz iPad displays.
export function advanceCamera(camera, elapsed, { reducedMotion = false, panning = false } = {}) {
  const frames = Math.min(4, Math.max(0, elapsed) / (1000 / 60));
  const blend = reducedMotion ? 1 : 1 - 0.85 ** frames;
  let moving = false;
  if (Math.abs(camera.targetScale - camera.scale) > 0.00001) {
    const anchor = camera.zoomAnchor;
    const wx = (anchor.x - camera.x) / camera.scale;
    const wy = (anchor.y - camera.y) / camera.scale;
    camera.scale += (camera.targetScale - camera.scale) * blend;
    if (Math.abs(camera.targetScale - camera.scale) < 0.00001) camera.scale = camera.targetScale;
    camera.x = anchor.x - wx * camera.scale;
    camera.y = anchor.y - wy * camera.scale;
    moving = true;
  }
  if (!panning && !reducedMotion && Math.hypot(camera.vx, camera.vy) > 0.01) {
    const decay = 0.9 ** frames;
    // Integrate the same exponential over the frame, rather than multiplying
    // velocity by a variable dt (which changes travel at different refresh rates).
    const travel = (1 - decay) / -Math.log(0.9);
    camera.x += camera.vx * travel;
    camera.y += camera.vy * travel;
    camera.vx *= decay;
    camera.vy *= decay;
    moving = true;
  } else if (!panning) camera.vx = camera.vy = 0;
  return moving;
}
