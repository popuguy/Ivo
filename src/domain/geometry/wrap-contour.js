// The object, archive and layout boundaries use this same pure contour authority.
// It has no document/platform imports, so source validation cannot form a cycle.
const EPS = 1e-7;
const bits = new DataView(new ArrayBuffer(8));

function dyadic(value) {
  bits.setFloat64(0, value);
  const high = bits.getUint32(0),
    low = bits.getUint32(4),
    exponent = (high >>> 20) & 2047,
    fraction = (BigInt(high & 1048575) << 32n) | BigInt(low);
  return {
    n: (high >>> 31 ? -1n : 1n) * (exponent ? (1n << 52n) | fraction : fraction),
    e: exponent ? exponent - 1075 : -1074,
  };
}
function difference(a, b) {
  const e = Math.min(a.e, b.e);
  return { n: (a.n << BigInt(a.e - e)) - (b.n << BigInt(b.e - e)), e };
}
const product = (a, b) => ({ n: a.n * b.n, e: a.e + b.e });

/** Exact orientation of finite binary64 coordinates. Ordinary cases avoid BigInt;
 * cancellation falls back to the exact dyadic values, never an epsilon guess. */
function orientation(a, b, c) {
  const left = (b.x - a.x) * (c.y - a.y),
    right = (b.y - a.y) * (c.x - a.x),
    det = left - right;
  if (Math.abs(det) > (Math.abs(left) + Math.abs(right)) * Number.EPSILON * 8)
    return Math.sign(det);
  if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) return 0;
  const exact = difference(
    product(difference(dyadic(b.x), dyadic(a.x)), difference(dyadic(c.y), dyadic(a.y))),
    product(difference(dyadic(b.y), dyadic(a.y)), difference(dyadic(c.x), dyadic(a.x))),
  ).n;
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}
const equal = (a, b) => a.x === b.x && a.y === b.y;
const contains = (p, a, b) =>
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);
function intersects(a, b, c, d) {
  if (
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) ||
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  )
    return false;
  const p = orientation(a, b, c),
    q = orientation(a, b, d),
    r = orientation(c, d, a),
    s = orientation(c, d, b);
  return (
    (p * q < 0 && r * s < 0) ||
    (!p && contains(c, a, b)) ||
    (!q && contains(d, a, b)) ||
    (!r && contains(a, c, d)) ||
    (!s && contains(b, c, d))
  );
}

/** A bounded proof over every nonadjacent edge pair, before offset/triangulation.
 * Same-sign local turns (for example a pentagram) are not a simplicity proof. */
function simplePoints(input) {
  if (
    !Array.isArray(input) ||
    input.length < 3 ||
    input.length > 256 ||
    input.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw new TypeError('Text-wrap contours require 3–256 finite vertices.');
  const points = input.filter((p, i) => !equal(p, input[(i + 1) % input.length]));
  if (points.length < 3) throw new Error('Text wrapping requires a nondegenerate contour.');
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length],
      b = points[i],
      c = points[(i + 1) % points.length];
    if (!orientation(a, b, c) && !contains(b, a, c))
      throw new Error(
        'Self-overlapping text-wrap contours are not yet supported. Use bounding-box wrap.',
      );
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (
        intersects(
          points[i],
          points[(i + 1) % points.length],
          points[j],
          points[(j + 1) % points.length],
        )
      )
        throw new Error(
          'Self-intersecting text-wrap contours are not yet supported. Use bounding-box wrap.',
        );
    }
  }
  const cleaned = points.filter(
    (p, i) =>
      orientation(
        points[(i + points.length - 1) % points.length],
        p,
        points[(i + 1) % points.length],
      ) !== 0,
  );
  if (cleaned.length < 3) throw new Error('Text wrapping requires a nondegenerate contour.');
  return cleaned;
}

function direction(points) {
  let index = 0;
  for (let i = 1; i < points.length; i++)
    if (
      points[i].x < points[index].x ||
      (points[i].x === points[index].x && points[i].y < points[index].y)
    )
      index = i;
  return orientation(
    points[(index + points.length - 1) % points.length],
    points[index],
    points[(index + 1) % points.length],
  );
}
const area = (points) =>
  points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
function triangleContains(p, a, b, c, sign) {
  return (
    orientation(a, b, p) * sign >= 0 &&
    orientation(b, c, p) * sign >= 0 &&
    orientation(c, a, p) * sign >= 0
  );
}

export function triangulateTextWrapContour(input) {
  if (!input.length) return [];
  const points = simplePoints(input),
    sign = direction(points),
    triangles = [],
    remaining = points.map((_, i) => i);
  while (remaining.length > 3) {
    let removed = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = points[remaining[(i + remaining.length - 1) % remaining.length]],
        b = points[remaining[i]],
        c = points[remaining[(i + 1) % remaining.length]];
      if (
        orientation(a, b, c) * sign <= 0 ||
        remaining.some((index) => {
          const p = points[index];
          return p !== a && p !== b && p !== c && triangleContains(p, a, b, c, sign);
        })
      )
        continue;
      triangles.push([a, b, c]);
      remaining.splice(i, 1);
      removed = true;
      break;
    }
    if (!removed) throw new Error('Text wrapping requires a simple, nondegenerate contour.');
  }
  triangles.push(remaining.map((index) => points[index]));
  return triangles;
}

function offsetConvex(input, distance) {
  const points = simplePoints(input),
    sign = direction(points);
  if (Math.abs(distance) < EPS) return points;
  if (
    points.some(
      (p, i) =>
        orientation(p, points[(i + 1) % points.length], points[(i + 2) % points.length]) * sign < 0,
    )
  )
    throw new Error(
      'Concave contour offsets and stroke expansion are not yet supported. Use zero offset with no stroke, or bounding-box wrap.',
    );
  const edges = points.map((a, i) => {
    const b = points[(i + 1) % points.length],
      length = Math.hypot(b.x - a.x, b.y - a.y),
      normal = { x: (sign * (b.y - a.y)) / length, y: (-sign * (b.x - a.x)) / length };
    return { ...normal, limit: a.x * normal.x + a.y * normal.y + distance };
  });
  const output = points.map((_, i) => {
    const a = edges[(i + edges.length - 1) % edges.length],
      b = edges[i],
      det = a.x * b.y - a.y * b.x;
    if (Math.abs(det) < EPS)
      throw new Error('Text-wrap contour has an unsupported parallel corner.');
    return { x: (a.limit * b.y - a.y * b.limit) / det, y: (a.x * b.limit - a.limit * b.x) / det };
  });
  if (output.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Text-wrap contour exceeds finite geometry.');
  // A negative offset may consume the contour completely; never accept the
  // flipped polygon obtained by merely intersecting its displaced edge lines.
  if (
    output.some((p) => edges.some((edge) => p.x * edge.x + p.y * edge.y > edge.limit + EPS)) ||
    area(output) * sign <= EPS
  )
    return [];
  return output;
}

function convexPieces(input) {
  const points = simplePoints(input),
    sign = direction(points);
  return points.every(
    (p, i) =>
      orientation(p, points[(i + 1) % points.length], points[(i + 2) % points.length]) * sign >= 0,
  )
    ? [points]
    : triangulateTextWrapContour(points);
}

function intersectConvex(subject, clip) {
  let output = subject;
  const sign = direction(clip);
  for (let index = 0; index < clip.length && output.length; index++) {
    const a = clip[index],
      b = clip[(index + 1) % clip.length],
      input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i],
        q = input[(i + 1) % input.length],
        insideP = orientation(a, b, p) * sign >= 0,
        insideQ = orientation(a, b, q) * sign >= 0;
      if (insideP) output.push(p);
      if (insideP !== insideQ) {
        const crossP = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x),
          crossQ = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x),
          t = Math.max(0, Math.min(1, crossP / (crossP - crossQ)));
        output.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
    output = output.filter(
      (p, i) =>
        Math.hypot(
          p.x - output[(i + 1) % output.length].x,
          p.y - output[(i + 1) % output.length].y,
        ) > EPS,
    );
  }
  return output.length >= 3 && Math.abs(area(output)) > EPS ? output : [];
}

/** A placed graphic wraps its visible clipped contour, then its wrap offset.
 * Preserve a single convex boundary when possible, so offsets never expand
 * triangulation seams. Concave/disconnected nonzero buffering stays explicit. */
export function clippedTextWrapPath(points, masks, distance = 0) {
  let pieces = convexPieces(points);
  for (const mask of masks) {
    const clips = convexPieces(mask),
      next = [];
    if (pieces.length * clips.length > 4096)
      throw new Error('Clipped text wrap exceeded the 4,096-piece geometry budget.');
    for (const piece of pieces)
      for (const clip of clips) {
        const intersection = intersectConvex(piece, clip);
        if (intersection.length) next.push(intersection);
      }
    pieces = next;
    if (!pieces.length) return [];
  }
  if (Math.abs(distance) < EPS) return pieces;
  if (pieces.length !== 1)
    throw new Error('Concave clipped-image wrap offsets are not yet supported. Use zero offset.');
  const expanded = offsetConvex(pieces[0], distance);
  return expanded.length ? [expanded] : [];
}

/** A rectangle in local frame coordinates retains independent offsets when rotated on the page. */
export function rectangularWrapFrame(object) {
  if (!object || object.frameOptions?.corner > 0) return false;
  if (object.type !== 'polygon') return !['image', 'pdf'].includes(object.type);
  const points = object.points;
  return (
    points?.length === 4 &&
    points.every((point, i) => {
      const next = points[(i + 1) % 4];
      return (
        [0, 1].includes(point.x) &&
        [0, 1].includes(point.y) &&
        (point.x === next.x) !== (point.y === next.y)
      );
    }) &&
    new Set(points.map(({ x, y }) => x + ',' + y)).size === 4
  );
}

export function uniformWrapOffset(object, mode) {
  return (
    (mode === 'contour' && !rectangularWrapFrame(object)) ||
    (object?.type === 'image' && !!object.parentId)
  );
}

/** Shared cross-field proof used before commands, import/storage and layout.
 * Options are already normalized. Returned points stay in object-local units. */
export function textWrapObjectPath(object, options) {
  if (
    options.contour?.source &&
    options.contour.source !== 'frame' &&
    !['image', 'pdf'].includes(object.type)
  )
    throw new Error('Choose a placed graphic before setting a graphic contour type.');
  const stroke =
    object.type === 'polygon'
      ? object.stroke === 'none'
        ? 0
        : (object.strokeWidth || 0) / 2
      : object.frameOptions?.stroke === 'none'
        ? 0
        : (object.frameOptions?.strokeWidth || 0) / 2;
  if (options.mode !== 'contour') return { points: null, stroke };
  if (object.frameOptions?.corner > 0)
    throw new Error(
      'Rounded-frame text-wrap contours are not yet supported. Use bounding-box wrap.',
    );
  const points =
    object.type === 'polygon'
      ? object.points.map((p) => ({ x: p.x * object.w, y: p.y * object.h }))
      : [
          { x: 0, y: 0 },
          { x: object.w, y: 0 },
          { x: object.w, y: object.h },
          { x: 0, y: object.h },
        ];
  const { top, right, bottom, left } = options.offsets;
  if (![right, bottom, left].every((value) => value === top)) {
    if (!rectangularWrapFrame(object)) throw new Error('This contour requires uniform offsets.');
    const x1 = -left - stroke,
      y1 = -top - stroke,
      x2 = object.w + right + stroke,
      y2 = object.h + bottom + stroke;
    return {
      points:
        x2 > x1 && y2 > y1
          ? [
              { x: x1, y: y1 },
              { x: x2, y: y1 },
              { x: x2, y: y2 },
              { x: x1, y: y2 },
            ]
          : [],
      stroke,
    };
  }
  const output = offsetConvex(points, options.offsets.top + stroke);
  triangulateTextWrapContour(output);
  return { points: output, stroke };
}
