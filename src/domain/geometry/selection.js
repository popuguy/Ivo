import { objectAvailable } from '../documents/publishing.js';
import { pagePositions, worldRect, sceneObject, transformObject } from '../documents/scene.js';
import { scaledPointType } from '../text/metrics.js';

export function selectionRoots(document, ids) {
  const selected = new Set(ids);
  return document.blocks
    .filter((item) => selected.has(item.id) && objectAvailable(document, item))
    .filter((item) => {
      let parent = item.parentId;
      while (parent) {
        if (selected.has(parent)) return false;
        parent = sceneObject(document, parent)?.parentId;
      }
      return true;
    });
}
export function sceneRect(document, item) {
  const page = pagePositions(document.pages).find((p) => p.id === item.pageId);
  const rect = worldRect(document, item);
  return { ...rect, x: rect.x + (page?.x || 0), y: rect.y + (page?.y || 0) };
}
export function selectionBounds(document, ids) {
  const items = selectionRoots(document, ids);
  if (!items.length) return null;
  const rects = items.map((item) => sceneRect(document, item)),
    x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
}
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function segmentIntersects(a, b, c, d) {
  const q = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
  if (q.every((v) => Math.abs(v) < 1e-9))
    return (
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
        Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
        Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
    );
  return q[0] * q[1] <= 0 && q[2] * q[3] <= 0;
}
function inPolygon(p, points) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      result = !result;
  }
  return result;
}
export function intersectsSelection(rect, points, enclosed = false) {
  if (enclosed) return points.every((p) => inside(p, rect));
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  if (points.some((p) => inside(p, rect)) || corners.some((p) => inPolygon(p, points))) return true;
  return points.some((p, i) =>
    corners.some((c, j) =>
      segmentIntersects(p, points[(i + 1) % points.length], c, corners[(j + 1) % 4]),
    ),
  );
}
export function marqueeSelection(document, rect, { parentId = null, enclosed = false } = {}) {
  return document.blocks
    .filter((item) => (item.parentId || null) === parentId && objectAvailable(document, item))
    .filter((item) => {
      const r = sceneRect(document, item);
      if (
        r.x > rect.x + rect.w ||
        r.x + r.w < rect.x ||
        r.y > rect.y + rect.h ||
        r.y + r.h < rect.y
      )
        return false;
      const points =
        item.type === 'polygon'
          ? item.points.map((p) => ({ x: r.x + p.x * r.w, y: r.y + p.y * r.h }))
          : [
              { x: r.x, y: r.y },
              { x: r.x + r.w, y: r.y },
              { x: r.x + r.w, y: r.y + r.h },
              { x: r.x, y: r.y + r.h },
            ];
      return intersectsSelection(rect, points, enclosed);
    })
    .map((item) => item.id);
}
export function toggleSelection(existing, hits) {
  const result = new Set(existing);
  for (const id of hits)
    if (result.has(id)) result.delete(id);
    else result.add(id);
  return [...result];
}
/** One world-space transform; parent-local sources and all identities remain intact. */
export function transformSelection(document, ids, rect, baseline) {
  const roots = selectionRoots(baseline, ids),
    bounds = selectionBounds(baseline, ids),
    sx = rect.w / Math.max(0.01, bounds.w),
    sy = rect.h / Math.max(0.01, bounds.h);
  for (const original of roots) {
    const global = sceneRect(baseline, original),
      offset = { x: global.x - original.x, y: global.y - original.y };
    const next = {
      x: rect.x + (global.x - bounds.x) * sx - offset.x,
      y: rect.y + (global.y - bounds.y) * sy - offset.y,
      w: global.w * sx,
      h: global.h * sy,
    };
    transformObject(document, original.id, next, baseline);
    if (['text', 'quote'].includes(original.type))
      Object.assign(
        sceneObject(document, original.id),
        scaledPointType(original, sx, sy, { min: 1, max: 2000 }),
      );
  }
}
