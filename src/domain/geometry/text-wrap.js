import { compoundWrapPieces } from './compound-contour.js';
import { placedImageRings, rasterContourSource } from './raster-contour.js';
import { layerFor, layersFor, parentObjects } from '../documents/publishing.js';
import { normalizeTextWrap, normalizeTextWrapPreferences } from '../documents/text-wrap.js';
import {
  textWrapObjectPath,
  triangulateTextWrapContour as triangulate,
  clippedTextWrapPath,
} from './wrap-contour.js';

const EPS = 1e-7;
// A line can begin at any opening. After the first word is placed, the
// current opening and the next four are available on that baseline.
export const MAX_WRAP_SEGMENTS_PER_LINE = 5;
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
export function textWrapObstacles(document, frame, { column, imageContours } = {}) {
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
    const maskPaths = masks.map((mask) => {
      const owners = ancestors(mask, byId);
      return mask.points.map((p) =>
        owners.reduce((v, a) => localPoint(a, v), { x: p.x * mask.w, y: p.y * mask.h }),
      );
    });
    const frameRect = rectangle(0, 0, object.w, object.h);
    let pieces;
    if (options.mode === 'contour' && rasterContourSource(options.contour.source)) {
      const image = imageContours?.get(object);
      if (!image) throw Error('Prepare the placed image before composing its text-wrap contour.');
      const inset = object.frameOptions?.strokeWidth || 0;
      const height = image.viewportHeight ?? object.h - 2 * inset;
      const imageRect = rectangle(inset, inset, object.w - inset, inset + height).map(toWorld);
      const distance = options.offsets.top + stroke;
      pieces = imageRect.length
        ? compoundWrapPieces(
            placedImageRings(object, image).map((r) => r.map(toWorld)),
            [imageRect, ...maskPaths],
            distance,
          )
        : [];
      if (object.caption) {
        const caption = rectangle(inset, inset + height + 6, object.w - inset, object.h - inset);
        if (caption.length)
          pieces.push(...compoundWrapPieces([caption.map(toWorld)], maskPaths, distance));
      }
    } else if (
      masks.length &&
      !(options.mode === 'contour' && options.contour.source === 'bounding-box')
    ) {
      const values =
        options.mode === 'jump'
          ? [options.offsets.top, options.offsets.bottom]
          : Object.values(options.offsets);
      if (!values.every((v) => v === values[0]))
        throw Error('Clipped-image text wrapping currently requires uniform offsets.');
      const useContainer = options.mode === 'contour' && options.contour.source === 'graphic-frame';
      pieces = clippedTextWrapPath(
        useContainer ? maskPaths[0] : frameRect.map(toWorld),
        useContainer ? maskPaths.slice(1) : maskPaths,
        values[0] + stroke,
      );
    } else if (path.pieces) {
      pieces = path.pieces.map((piece) => piece.map(toWorld));
    } else {
      let polygon;
      if (options.mode === 'contour') polygon = path.points.map(toWorld);
      else {
        const box = extent(frameRect.map(toWorld)),
          o = options.offsets;
        polygon = rectangle(
          box.left - o.left - stroke,
          box.top - o.top - stroke,
          box.right + o.right + stroke,
          box.bottom + o.bottom + stroke,
        );
      }
      pieces = polygon.length ? triangulate(polygon) : [];
    }
    const polygons = pieces.map((piece) => piece.map(toFrame));
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
  // Both inputs are merged, ordered intervals. Retain an exclusion that spans
  // an available gap so it can also cut the next available interval.
  const output = [];
  let index = 0;
  for (const value of available) {
    let left = value.left;
    while (index < excluded.length && excluded[index].right <= left + EPS) index++;
    while (index < excluded.length && excluded[index].left < value.right - EPS) {
      const gap = excluded[index];
      if (gap.left > left + EPS) output.push({ left, right: gap.left });
      left = Math.max(left, gap.right);
      if (left >= value.right - EPS) break;
      index++;
    }
    if (left < value.right - EPS) output.push({ left, right: value.right });
  }
  return output;
}

/** Keep the existing leading grid and skip only rows known to be blocked. */
export function nextWrapRowTop(baseline, step, blockedThrough) {
  const skipped =
    blockedThrough != null && blockedThrough > baseline
      ? Math.floor((blockedThrough - baseline) / step)
      : 0;
  return baseline + skipped * step;
}

/** Each wrap mode projects its polygons across the physical row interval it uses. */
export function textWrapBand(
  obstacles,
  band,
  { jumpBand, shapeBand, boundsBand, nextColumnBand } = {},
) {
  if (
    !['left', 'right', 'top', 'bottom'].every((key) => Number.isFinite(band[key])) ||
    band.right <= band.left ||
    band.bottom <= band.top
  )
    throw new TypeError('Choose a finite positive text-wrap band.');
  let segments = [{ left: band.left, right: band.right }],
    nextColumn = false,
    jumpBottom = null;
  let jumpThrough = null;
  const events = [],
    excluded = [];
  for (const obstacle of obstacles) {
    const polygons = obstacle.polygons,
      bounds = obstacle.bounds;
    // Native Box, Shape and Jump inspect the space leading up to this baseline.
    // Inverse contours still need the whole ink box inside the path.
    const slice =
      obstacle.mode === 'jump'
        ? (jumpBand ?? band)
        : obstacle.mode === 'contour' && !obstacle.invert
          ? (shapeBand ?? band)
          : obstacle.mode === 'bounds' && !obstacle.invert
            ? (boundsBand ?? band)
            : obstacle.mode === 'next-column'
              ? (nextColumnBand ?? band)
              : band;
    const occupied = merge(
      polygons.flatMap((polygon) => {
        const clipped = clipY(clipY(polygon, slice.top, true), slice.bottom, false);
        if (!clipped.length || Math.abs(area(clipped)) <= EPS) return [];
        if (
          jumpBand &&
          obstacles.length === 1 &&
          obstacle.mode === 'jump' &&
          polygon.every((point) => point.x >= band.left && point.x <= band.right)
        ) {
          // This connected polygon stays in the column all the way to its bottom.
          // Other obstacles, disjoint paths and partial column overlaps need fresh queries.
          jumpThrough = Math.max(jumpThrough ?? -Infinity, ...polygon.map((point) => point.y));
        }
        return [
          {
            left: Math.min(...clipped.map((p) => p.x)),
            right: Math.max(...clipped.map((p) => p.x)),
          },
        ];
      }),
    );
    const active = intersection(occupied, [{ left: band.left, right: band.right }]);
    if (['jump', 'next-column'].includes(obstacle.mode)) {
      if (!active.length) continue;
      segments = [];
      nextColumn ||= obstacle.mode === 'next-column';
      if (jumpBand && obstacle.mode === 'jump')
        jumpBottom = Math.max(jumpBottom ?? -Infinity, bounds.bottom);
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
      // Ordinary exclusions commute with every side/inverse intersection.
      // Union them once, then sweep instead of repeatedly splitting all gaps.
      else excluded.push(...occupied);
    }
    if (bounds.bottom > band.top + EPS) events.push(bounds.bottom);
    if (bounds.top > band.top + EPS) events.push(bounds.top);
  }
  return {
    segments: merge(subtract(merge(segments), merge(excluded))),
    nextColumn,
    ...(jumpBand && { jumpBottom, jumpThrough }),
    nextY: events.length ? Math.min(...events) : null,
  };
}

export function availableWrapSegments(obstacles, band) {
  return textWrapBand(obstacles, band).segments;
}
