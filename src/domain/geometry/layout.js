// The legacy 12-column / 22-unit coordinates remain a scalable document space.
// They are continuous values, not a required editing grid.
export const ROW_HEIGHT = 22;
export const COLUMNS = 12;
export const MAX_ROWS = 100;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const EPSILON = 1e-7;
const DIRECTIONS = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

export function blockPixels(block, pageWidth) {
  const unit = pageWidth / COLUMNS;
  return { x: block.x * unit, y: block.y * ROW_HEIGHT, w: block.w * unit, h: block.h * ROW_HEIGHT };
}

export function blockUnits(rect, pageWidth) {
  const unit = pageWidth / COLUMNS;
  return { x: rect.x / unit, y: rect.y / ROW_HEIGHT, w: rect.w / unit, h: rect.h / ROW_HEIGHT };
}

export function documentRows(document, minimum = document.layout?.rows || 20) {
  return clamp(
    Math.ceil(Math.max(minimum, 20, ...document.blocks.map((block) => block.y + block.h))),
    20,
    MAX_ROWS,
  );
}

/**
 * Retain each target's origin and bounds rather than flattening equal coordinates.
 * Artboard references are a separate policy; the growing composition's center
 * is deliberately not a default alignment target. All coordinates are CSS pixels
 * in the composition's coordinate system, as are the returned guide endpoints.
 */
export function alignmentTargets(blocks, movingId, pageWidth, pageHeight, options = {}) {
  return alignmentRectTargets(
    blocks
      .filter((block) => block.id !== movingId)
      .map((block) => ({ id: block.id, ...blockPixels(block, pageWidth) })),
    pageWidth,
    pageHeight,
    options,
  );
}

export function alignmentRectTargets(
  rectangles,
  pageWidth,
  pageHeight,
  {
    artboardEdges = true,
    artboardCenter = false,
    objectCenters = true,
    artboardOrigin = { x: 0, y: 0 },
  } = {},
) {
  const targets = { x: [], y: [] };
  function add(bounds, sourceId, kind, centers, edges = true) {
    for (const axis of ['x', 'y']) {
      const size = axis === 'x' ? bounds.w : bounds.h;
      const names = axis === 'x' ? ['left', 'center', 'right'] : ['top', 'center', 'bottom'];
      for (let index = 0; index < 3; index++) {
        if (index === 1 ? !centers : !edges) continue;
        targets[axis].push({
          position: bounds[axis] + (size * index) / 2,
          sourceId,
          kind,
          anchor: names[index],
          bounds: { ...bounds },
        });
      }
    }
  }
  for (const block of rectangles) {
    add({ x: block.x, y: block.y, w: block.w, h: block.h }, block.id, 'object', objectCenters);
  }
  if (artboardEdges || artboardCenter)
    add(
      { x: artboardOrigin.x, y: artboardOrigin.y, w: pageWidth, h: pageHeight },
      null,
      'artboard',
      artboardCenter,
      artboardEdges,
    );
  return targets;
}

function anchors(rect, axis, direction = 0, resizing = false) {
  const size = axis === 'x' ? rect.w : rect.h;
  const names = axis === 'x' ? ['left', 'center', 'right'] : ['top', 'center', 'bottom'];
  if (resizing)
    return direction
      ? [{ position: rect[axis] + (direction > 0 ? size : 0), name: names[direction > 0 ? 2 : 0] }]
      : [];
  return names.map((name, index) => ({ position: rect[axis] + (size * index) / 2, name }));
}

function candidates(rect, axis, values, threshold, direction, resizing) {
  const list = [];
  for (const [index, value] of (values || []).entries()) {
    // Numeric targets remain accepted for callers that supply a single coordinate.
    const target =
      typeof value === 'number'
        ? { position: value, sourceId: null, kind: 'coordinate', anchor: null, bounds: null }
        : value;
    if (!Number.isFinite(target?.position)) continue;
    for (const anchor of anchors(rect, axis, direction, resizing)) {
      const delta = target.position - anchor.position;
      if (Math.abs(delta) <= threshold) list.push({ axis, delta, target, anchor, index });
    }
  }
  return list.sort(
    (a, b) =>
      Math.abs(a.delta) - Math.abs(b.delta) ||
      Number(b.target.kind === 'object') - Number(a.target.kind === 'object') ||
      a.index - b.index,
  );
}

function guide(candidate, rect) {
  const { axis, target, anchor } = candidate;
  const other = axis === 'x' ? 'y' : 'x',
    size = axis === 'x' ? 'h' : 'w';
  const bounds = target.bounds || rect;
  return {
    axis,
    position: target.position,
    start: Math.min(rect[other], bounds[other]),
    end: Math.max(rect[other] + rect[size], bounds[other] + bounds[size]),
    sourceId: target.sourceId ?? null,
    targetKind: target.kind,
    movingAnchor: anchor.name,
    targetAnchor: target.anchor ?? null,
  };
}

function resizeGeometry(start, direction, fromCenter, proportional, pageWidth, unbounded) {
  const limits = { x: pageWidth, y: MAX_ROWS * ROW_HEIGHT };
  const origin = {},
    fraction = {},
    maximum = {};
  for (const [axis, index, size] of [
    ['x', 0, 'w'],
    ['y', 1, 'h'],
  ]) {
    // A side handle scales the inactive dimension about its midpoint only when
    // proportional resizing is requested. Otherwise that dimension is untouched.
    fraction[axis] =
      fromCenter || (!direction[index] && proportional) ? 0.5 : direction[index] < 0 ? 1 : 0;
    origin[axis] = start[axis] + start[size] * fraction[axis];
    maximum[size] = unbounded
      ? Infinity
      : Math.min(
          fraction[axis] ? origin[axis] / fraction[axis] : Infinity,
          fraction[axis] < 1 ? (limits[axis] - origin[axis]) / (1 - fraction[axis]) : Infinity,
        );
  }
  const minimum = {
    w: unbounded ? 0.01 : Math.min(12, pageWidth / COLUMNS, start.w),
    h: unbounded ? 0.01 : Math.min(8, start.h),
  };
  function place(w, h) {
    if (proportional) {
      const scale = clamp(
        w / start.w,
        Math.max(minimum.w / start.w, minimum.h / start.h),
        Math.min(maximum.w / start.w, maximum.h / start.h),
      );
      w = start.w * scale;
      h = start.h * scale;
    } else {
      w = clamp(w, minimum.w, maximum.w);
      h = clamp(h, minimum.h, maximum.h);
    }
    return { x: origin.x - w * fraction.x, y: origin.y - h * fraction.y, w, h };
  }
  function initial(delta) {
    const multiplier = fromCenter ? 2 : 1;
    const w = start.w + delta.x * direction[0] * multiplier;
    const h = start.h + delta.y * direction[1] * multiplier;
    if (!proportional) return place(w, h);
    // Project the active corner onto its aspect-ratio diagonal. Side handles
    // derive the scale from their one active axis. This is Ivo's explicit solver,
    // not a claim about the unrecovered native Illustrator constraint policy.
    const factor =
      direction[0] && direction[1]
        ? (w * start.w + h * start.h) / (start.w ** 2 + start.h ** 2)
        : direction[0]
          ? w / start.w
          : h / start.h;
    return place(start.w * factor, start.h * factor);
  }
  function snapTo(rect, candidate) {
    const index = candidate.axis === 'x' ? 0 : 1,
      multiplier = fromCenter ? 2 : 1;
    let w = rect.w,
      h = rect.h;
    if (index === 0) w += candidate.delta * direction[0] * multiplier;
    else h += candidate.delta * direction[1] * multiplier;
    if (proportional && index === 1) w = (h * start.w) / start.h;
    return place(w, h);
  }
  return { initial, snapTo };
}

/**
 * resize: false to move, true for legacy southeast resize, or one of the eight
 * compass directions. Side handles affect one axis. fromCenter and proportional
 * keep their anchors explicit. Guides describe the final solved geometry and
 * finite target/moving-object extents; the renderer must use start/end, not inset:0.
 * threshold is in screen CSS pixels; viewScale converts it into composition
 * coordinates (desktop page zoom or mobile visual-viewport pinch scale).
 * No document-coordinate rounding is performed.
 */
export function constrainMove(delta) {
  const angle = (Math.round(Math.atan2(delta.y, delta.x) / (Math.PI / 4)) * Math.PI) / 4;
  const direction = {
    x: Math.abs(Math.cos(angle)) < 1e-10 ? 0 : Math.cos(angle),
    y: Math.abs(Math.sin(angle)) < 1e-10 ? 0 : Math.sin(angle),
  };
  const distance = delta.x * direction.x + delta.y * direction.y;
  return { x: direction.x * distance, y: direction.y * distance };
}

export function transformBlock(
  start,
  delta,
  {
    pageWidth,
    targets,
    resize = false,
    snap = true,
    threshold = 4,
    viewScale = 1,
    fromCenter = false,
    proportional = false,
    constrain = false,
    unbounded = false,
  } = {},
) {
  threshold /= Number.isFinite(viewScale) && viewScale > 0 ? viewScale : 1;
  const handle = resize === true ? 'se' : resize;
  const direction = handle ? DIRECTIONS[handle] : [0, 0];
  if (!direction) throw new Error('Unknown resize direction.');
  if (!handle && constrain) delta = constrainMove(delta);
  const geometry = handle
    ? resizeGeometry(start, direction, fromCenter, proportional, pageWidth, unbounded)
    : null;
  let rect = geometry
    ? geometry.initial(delta)
    : {
        ...start,
        x: unbounded ? start.x + delta.x : clamp(start.x + delta.x, 0, pageWidth - start.w),
        y: unbounded
          ? start.y + delta.y
          : clamp(start.y + delta.y, 0, MAX_ROWS * ROW_HEIGHT - start.h),
      };
  const matches = [];
  if (snap && targets) {
    if (!handle && constrain) {
      // Acquire one alignment along the constrained line; never break Shift's direction.
      const length = Math.hypot(delta.x, delta.y),
        unit = length ? { x: delta.x / length, y: delta.y / length } : { x: 1, y: 0 };
      const choices = ['x', 'y'].flatMap((axis) =>
        Math.abs(unit[axis]) < 1e-10
          ? []
          : candidates(rect, axis, targets[axis], threshold, 0, false).map((candidate) => ({
              ...candidate,
              travel: candidate.delta / unit[axis],
            })),
      );
      choices.sort((a, b) => Math.abs(a.travel) - Math.abs(b.travel));
      if (choices.length) {
        const travel = choices[0].travel;
        rect = { ...rect, x: rect.x + unit.x * travel, y: rect.y + unit.y * travel };
      }
      for (const axis of ['x', 'y']) {
        const exact = candidates(rect, axis, targets[axis], EPSILON, 0, false)[0];
        if (exact) matches.push(exact);
      }
    } else if (geometry && proportional) {
      const choices = ['x', 'y'].flatMap((axis, index) =>
        candidates(rect, axis, targets[axis], threshold, direction[index], true),
      );
      choices.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      for (const candidate of choices) {
        const solved = geometry.snapTo(rect, candidate);
        const actual = anchors(
          solved,
          candidate.axis,
          direction[candidate.axis === 'x' ? 0 : 1],
          true,
        )[0];
        if (actual && Math.abs(actual.position - candidate.target.position) <= EPSILON) {
          rect = solved;
          break;
        }
      }
      // A proportional solve may also create an exact alignment on its other
      // axis. Only report guides that actually intersect the final geometry.
      for (const [index, axis] of ['x', 'y'].entries()) {
        const exact = candidates(rect, axis, targets[axis], EPSILON, direction[index], true)[0];
        if (exact) matches.push(exact);
      }
    } else {
      for (const [index, axis] of ['x', 'y'].entries()) {
        for (const candidate of candidates(
          rect,
          axis,
          targets[axis],
          threshold,
          direction[index],
          Boolean(handle),
        )) {
          const solved = geometry
            ? geometry.snapTo(rect, candidate)
            : { ...rect, [axis]: rect[axis] + candidate.delta };
          if (
            !unbounded &&
            (solved.x < -EPSILON ||
              solved.y < -EPSILON ||
              solved.x + solved.w > pageWidth + EPSILON ||
              solved.y + solved.h > MAX_ROWS * ROW_HEIGHT + EPSILON)
          )
            continue;
          const actual = anchors(solved, axis, direction[index], Boolean(handle)).find(
            (anchor) => anchor.name === candidate.anchor.name,
          );
          if (!actual || Math.abs(actual.position - candidate.target.position) > EPSILON) continue;
          rect = solved;
          matches.push(candidate);
          break;
        }
      }
    }
  }
  const guides = matches
    .filter((candidate) =>
      anchors(
        rect,
        candidate.axis,
        direction[candidate.axis === 'x' ? 0 : 1],
        Boolean(handle),
      ).some(
        (anchor) =>
          anchor.name === candidate.anchor.name &&
          Math.abs(anchor.position - candidate.target.position) <= EPSILON,
      ),
    )
    .map((candidate) => guide(candidate, rect));
  return { rect, block: blockUnits(rect, pageWidth), guides };
}

export function imagePlacement(size, pageWidth, anchor = { x: 0, y: 0 }) {
  let w = Math.max((pageWidth / COLUMNS) * 0.1, Math.min(size.width, pageWidth / 2));
  let h = Math.max(ROW_HEIGHT * 0.1, (w * size.height) / size.width);
  const scale = Math.min(1, (MAX_ROWS * ROW_HEIGHT - 44) / h);
  w = Math.max((pageWidth / COLUMNS) * 0.1, w * scale);
  h *= scale;
  return blockUnits(
    {
      x: clamp(anchor.x, 0, pageWidth - w),
      y: clamp(anchor.y, 0, MAX_ROWS * ROW_HEIGHT - h),
      w,
      h,
    },
    pageWidth,
  );
}
