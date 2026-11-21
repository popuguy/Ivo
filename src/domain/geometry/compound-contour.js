import {
  intersectD,
  inflatePathsD,
  triangulateD,
  TriangulateResult,
  FillRule,
  JoinType,
  EndType,
} from '../../../public/vendor/clipper2.js';

// Fixed-point operations at 1/10,000 pt keep separate islands and holes across
// clipping, expansion and erosion. Only the finished boundary is triangulated.
const precision = 4;
export function compoundWrapPieces(rings, masks, distance) {
  let paths = rings;
  for (const mask of masks) {
    if (!paths.length) return [];
    paths = intersectD(paths, [mask], FillRule.NonZero, precision);
  }
  if (paths.length && distance)
    paths = inflatePathsD(paths, distance, JoinType.Miter, EndType.Polygon, 8, precision);
  if (!paths.length) return [];
  const { solution, result } = triangulateD(paths, precision, false);
  if (result === TriangulateResult.noPolygons) return [];
  if (result !== TriangulateResult.success) throw Error('Unable to compose the text-wrap contour.');
  return solution.map((triangle) => triangle.map(({ x, y }) => ({ x, y })));
}
