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

/** Shared cross-field proof used before commands, import/storage and layout.
 * Options are already normalized. Returned points stay in object-local units. */
export function textWrapObjectPath(object, options) {
  if (options.invert && ['jump', 'next-column'].includes(options.mode))
    throw new Error('Inverted jump and next-column text wrap are not yet supported.');
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
  const output = offsetConvex(points, options.offsets.top + stroke);
  triangulateTextWrapContour(output);
  return { points: output, stroke };
}
