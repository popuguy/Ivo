import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composedPDFMatrix,
  composedPDFPolygon,
  screenToPageMatrix,
} from '../../src/features/export/composed-geometry.js';
test('frozen native PDF transforms retain scale, rotation, shear and page coordinates', () => {
  const svg = { a: 0, b: 2, c: -1, d: 0.5, e: 80, f: 120 };
  assert.deepEqual(composedPDFMatrix(svg, 100, 792), [0, -2, 1, 0.5, -20, 622]);
  const screen = Object.fromEntries(
    Object.entries(svg).map(([key, value]) => [
      key,
      (value * 4) / 3 + (key === 'e' ? 50 : key === 'f' ? 300 : 0),
    ]),
  );
  const restored = screenToPageMatrix(screen, { left: 50, top: 300 });
  for (const key of Object.keys(svg)) assert(Math.abs(restored[key] - svg[key]) < 1e-10);
  assert.deepEqual(
    composedPDFPolygon(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      100,
      40,
      svg,
      792,
    ),
    [
      { x: 80, y: 672 },
      { x: 80, y: 472 },
      { x: 40, y: 652 },
    ],
  );
});
test('export rejects missing/singular or nonfinite composed geometry', () => {
  assert.throws(() => composedPDFMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, 100, 792));
  assert.throws(() => screenToPageMatrix(null, { left: 0, top: 0 }));
  assert.throws(() =>
    composedPDFPolygon(
      [
        { x: NaN, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      100,
      100,
      { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      792,
    ),
  );
});
