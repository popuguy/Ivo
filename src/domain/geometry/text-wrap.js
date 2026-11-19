import { layerFor, layersFor, parentObjects } from '../documents/publishing.js';
import { normalizeTextWrap, normalizeTextWrapPreferences } from '../documents/text-wrap.js';
import {
  textWrapObjectPath,
  triangulateTextWrapContour as triangulate,
  clippedTextWrapPath,
} from './wrap-contour.js';

const EPS = 1e-7;
const area = (points) =>
  points.reduce((sum, a, index) => {
    const b = points[(index + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
const rectangle = (left, top, right, bottom) =>
  right > left + EPS && bottom > top + EPS
    ? [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ]
    : [];
const extent = (points) => ({
  left: Math.min(...points.map((p) => p.x)),
  top: Math.min(...points.map((p) => p.y)),
  right: Math.max(...points.map((p) => p.x)),
  bottom: Math.max(...points.map((p) => p.y)),
});

function localPoint(object, point, inverse = false) {
  const angle = (((object.rotation || 0) * Math.PI) / 180) * (inverse ? -1 : 1),
    c = Math.cos(angle),
    s = Math.sin(angle),
    x = point.x - (inverse ? object.x : 0) - object.w / 2,
    y = point.y - (inverse ? object.y : 0) - object.h / 2;
  return {
    x: x * c - y * s + object.w / 2 + (inverse ? 0 : object.x),
    y: x * s + y * c + object.h / 2 + (inverse ? 0 : object.y),
  };
}

function ancestors(object, objects) {
  const chain = [],
    seen = new Set();
  while (object) {
    if (seen.has(object.id)) throw new Error('Text-wrap geometry contains an ownership cycle.');
    seen.add(object.id);
    chain.push(object);
    object = objects.get(object.parentId);
  }
  return chain;
}

function pageArtwork(document, pageId) {
  const page = document.pages?.find((p) => p.id === pageId);
  const blocks = [
      ...(page ? parentObjects(document, page) : []),
      ...document.blocks.filter((b) => b.pageId === pageId),
    ],
    layers = layersFor(document),
    byId = new Map(blocks.map((b) => [b.id, b]));
  const ordered = [],
    visited = new Set();
  const append = (object) => {
    if (visited.has(object.id)) return;
    visited.add(object.id);
    ordered.push(object);
    for (const child of blocks) if (child.parentId === object.id) append(child);
  };
  for (const object of blocks
    .filter((b) => !b.parentId)
    .sort((a, b) => layers.indexOf(layerFor(document, a)) - layers.indexOf(layerFor(document, b))))
    append(object);
  return { blocks: ordered, byId };
}

export function textWrapPageSide(document, pageId) {
  const preferences = normalizeTextWrapPreferences(document.textWrapPreferences),
    index = Math.max(
      0,
      document.pages.findIndex((page) => page.id === pageId),
    );
  if (!preferences.facingPages) return preferences.firstPageSide;
  return index % 2
    ? preferences.firstPageSide === 'right'
      ? 'left'
      : 'right'
    : preferences.firstPageSide;
}

/** Read-only transformed exclusion paths in unscaled frame text coordinates. */
export function textWrapObstacles(document, frame, { column } = {}) {
  if (frame.ignoreTextWrap) return [];
  const { blocks, byId } = pageArtwork(document, frame.pageId),
    target = byId.get(frame.id) || frame,
    frameChain = ancestors(target, byId),
    targetAncestors = new Set(frameChain.map((object) => object.id)),
    preferences = normalizeTextWrapPreferences(document.textWrapPreferences),
    targetIndex = blocks.findIndex((b) => b.id === target.id),
    sx = frame.textScale?.x || 1,
    sy = frame.textScale?.y || 1;
  const toFrame = (point) => {
    let next = point;
    for (const object of [...frameChain].reverse()) next = localPoint(object, next, true);
    return { x: next.x / sx - (column?.left || 0), y: next.y / sy - (column?.top || 0) };
  };
  const result = [];
  for (const [index, object] of blocks.entries()) {
    if (!object.textWrap || object.textWrap.mode === 'none') continue;
    const chain = ancestors(object, byId);
    if (targetAncestors.has(object.id) || chain.some((ancestor) => ancestor.id === target.id))
      continue;
    if (preferences.onlyBelow && index <= targetIndex) continue;
    if (
      chain.some((ancestor) => {
        const layer = layerFor(document, ancestor);
        return !layer.visible && layer.ignoreWrap;
      })
    )
      continue;
    const options = normalizeTextWrap(object.textWrap),
      path = textWrapObjectPath(object, options),
      stroke = path.stroke;
    const toWorld = (point) =>
      chain.reduce((value, ancestor) => localPoint(ancestor, value), point);
    const masks =
      object.type === 'image'
        ? chain.slice(1).filter((ancestor) => ancestor.type === 'polygon' && ancestor.clip)
        : [];
    if (masks.length) {
      // Graphic wrap is independent of the parent frame's own wrap settings,
      // but invisible image content cannot contribute an exclusion rectangle.
      const values =
        options.mode === 'jump'
          ? [options.offsets.top, options.offsets.bottom]
          : Object.values(options.offsets);
      if (!values.every((value) => value === values[0]))
        throw new Error('Clipped-image text wrapping currently requires uniform offsets.');
      const clips = masks.map((mask) => {
        const owners = ancestors(mask, byId);
        return mask.points.map((p) =>
          owners.reduce((value, ancestor) => localPoint(ancestor, value), {
            x: p.x * mask.w,
            y: p.y * mask.h,
          }),
        );
      });
      const polygons = clippedTextWrapPath(
        rectangle(0, 0, object.w, object.h).map(toWorld),
        clips,
        values[0] + stroke,
      ).map((polygon) => polygon.map(toFrame));
      if (polygons.length || options.invert)
        result.push({
          id: object.id,
          mode: options.mode,
          side: options.side,
          invert: options.invert,
          polygons,
          bounds: polygons.length
            ? extent(polygons.flat())
            : { left: 0, top: 0, right: 0, bottom: 0 },
          offsets: { ...options.offsets },
          pageSide: textWrapPageSide(document, frame.pageId),
        });
      continue;
    }
    let polygon;
    if (options.mode === 'contour') {
      polygon = path.points.map(toWorld);
    } else {
      const bounds = extent(rectangle(0, 0, object.w, object.h).map(toWorld));
      const offsets = options.offsets;
      polygon = rectangle(
        bounds.left - (options.mode === 'jump' ? 0 : offsets.left) - stroke,
        bounds.top - offsets.top - stroke,
        bounds.right + (options.mode === 'jump' ? 0 : offsets.right) + stroke,
        bounds.bottom + offsets.bottom + stroke,
      );
    }
    if (!polygon.length) {
      if (options.invert)
        result.push({
          id: object.id,
          mode: options.mode,
          side: options.side,
          invert: true,
          polygons: [],
          bounds: { left: 0, top: 0, right: 0, bottom: 0 },
          offsets: { ...options.offsets },
          pageSide: textWrapPageSide(document, frame.pageId),
        });
      continue;
    }
    polygon = polygon.map(toFrame);
    const polygons = triangulate(polygon);
    if (!polygons.length) continue;
    result.push({
      id: object.id,
      mode: options.mode,
      side: options.side,
      invert: options.invert,
      polygons,
      bounds: extent(polygon),
      offsets: { ...options.offsets },
      pageSide: textWrapPageSide(document, frame.pageId),
    });
  }
  return result;
}

function clipY(points, value, keepAbove) {
  const output = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length],
      insideA = keepAbove ? a.y >= value : a.y <= value,
      insideB = keepAbove ? b.y >= value : b.y <= value;
    if (insideA) output.push(a);
    if (insideA !== insideB) {
      const t = (value - a.y) / (b.y - a.y);
      output.push({ x: a.x + (b.x - a.x) * t, y: value });
    }
  }
  return output;
}
function merge(intervals) {
  const output = [];
  for (const interval of intervals
    .filter((v) => v.right > v.left + EPS)
    .sort((a, b) => a.left - b.left)) {
    const previous = output.at(-1);
    if (previous && interval.left <= previous.right + EPS)
      previous.right = Math.max(previous.right, interval.right);
    else output.push({ ...interval });
  }
  return output;
}
function intersection(a, b) {
  return a
    .flatMap((x) =>
      b.map((y) => ({ left: Math.max(x.left, y.left), right: Math.min(x.right, y.right) })),
    )
    .filter((v) => v.right > v.left + EPS);
}
function subtract(available, excluded) {
  let output = available;
  for (const gap of excluded)
    output = output.flatMap((value) => {
      if (gap.right <= value.left + EPS || gap.left >= value.right - EPS) return [value];
      return [
        { left: value.left, right: Math.min(value.right, gap.left) },
        { left: Math.max(value.left, gap.right), right: value.right },
      ].filter((part) => part.right > part.left + EPS);
    });
  return output;
}

/** Full line-band exclusion, not a baseline/center point sample. */
export function textWrapBand(obstacles, band) {
  if (
    !['left', 'right', 'top', 'bottom'].every((key) => Number.isFinite(band[key])) ||
    band.right <= band.left ||
    band.bottom <= band.top
  )
    throw new TypeError('Choose a finite positive text-wrap band.');
  let segments = [{ left: band.left, right: band.right }],
    nextColumn = false;
  const events = [];
  for (const obstacle of obstacles) {
    const polygons = obstacle.polygons,
      bounds = obstacle.bounds;
    const occupied = merge(
      polygons.flatMap((polygon) => {
        const clipped = clipY(clipY(polygon, band.top, true), band.bottom, false);
        return clipped.length && Math.abs(area(clipped)) > EPS
          ? [
              {
                left: Math.min(...clipped.map((p) => p.x)),
                right: Math.max(...clipped.map((p) => p.x)),
              },
            ]
          : [];
      }),
    );
    const active = intersection(occupied, [{ left: band.left, right: band.right }]);
    if (['jump', 'next-column'].includes(obstacle.mode)) {
      if (!active.length) continue;
      segments = [];
      nextColumn ||= obstacle.mode === 'next-column';
    } else if (obstacle.invert) {
      // Every vertical slice of the line band must fit inside the contour. Use
      // the complement's projection to retain concave openings conservatively.
      const critical = [
        band.top,
        band.bottom,
        ...polygons
          .flatMap((p) => p.map((v) => v.y))
          .filter((y) => y > band.top && y < band.bottom),
      ];
      let inside = [{ left: band.left, right: band.right }];
      for (const y of critical) {
        const slices = merge(
          polygons.flatMap((polygon) => {
            const intersections = [];
            for (let i = 0; i < polygon.length; i++) {
              const a = polygon[i],
                b = polygon[(i + 1) % polygon.length];
              if (y >= Math.min(a.y, b.y) - EPS && y <= Math.max(a.y, b.y) + EPS) {
                if (Math.abs(a.y - b.y) < EPS) intersections.push(a.x, b.x);
                else intersections.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
              }
            }
            return intersections.length
              ? [{ left: Math.min(...intersections), right: Math.max(...intersections) }]
              : [];
          }),
        );
        inside = intersection(inside, slices);
      }
      segments = intersection(segments, inside);
    } else {
      if (!active.length) continue;
      let side = obstacle.side;
      const pageSide = band.pageSide || obstacle.pageSide || 'right';
      if (side === 'inside') side = pageSide === 'right' ? 'left' : 'right';
      if (side === 'outside') side = pageSide === 'right' ? 'right' : 'left';
      if (side === 'largest')
        side =
          Math.max(0, bounds.left - band.left) > Math.max(0, band.right - bounds.right)
            ? 'left'
            : 'right';
      if (side === 'left')
        segments = intersection(segments, [{ left: band.left, right: occupied[0].left }]);
      else if (side === 'right')
        segments = intersection(segments, [{ left: occupied.at(-1).right, right: band.right }]);
      else segments = subtract(segments, occupied);
    }
    if (bounds.bottom > band.top + EPS) events.push(bounds.bottom);
    if (bounds.top > band.top + EPS) events.push(bounds.top);
  }
  return {
    segments: merge(segments),
    nextColumn,
    nextY: events.length ? Math.min(...events) : null,
  };
}

export function availableWrapSegments(obstacles, band) {
  return textWrapBand(obstacles, band).segments;
}
