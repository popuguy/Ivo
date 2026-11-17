import test from 'node:test';
import assert from 'node:assert/strict';
import { scaledPointType } from '../../src/domain/text/metrics.js';

test('nonuniform point scaling matches the native 200% by 150% fixture', () => {
  const result = scaledPointType({ fontSize: 25, textScale: { x: 1, y: 1 } }, 2, 1.5);
  assert.equal(result.fontSize, 37.5);
  assert.equal(result.textScale.x, 4 / 3);
  assert.equal(result.textScale.y, 1);
});

test('point scaling composes existing glyph stretch and inverse restores it', () => {
  const original = { fontSize: 20, textScale: { x: 1.25, y: 0.8 } };
  const scaled = scaledPointType(original, 0.75, 1.5);
  assert.ok(
    Math.abs(
      scaled.fontSize * scaled.textScale.x - original.fontSize * original.textScale.x * 0.75,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      scaled.fontSize * scaled.textScale.y - original.fontSize * original.textScale.y * 1.5,
    ) < 1e-10,
  );
  const restored = scaledPointType(scaled, 1 / 0.75, 1 / 1.5);
  assert.equal(restored.fontSize, original.fontSize);
  assert.ok(Math.abs(restored.textScale.x - original.textScale.x) < 1e-10);
  assert.ok(Math.abs(restored.textScale.y - original.textScale.y) < 1e-10);
});

test('bounded type-size control retains a larger visual vertical scale', () => {
  const result = scaledPointType({ fontSize: 100 }, 2, 2);
  assert.equal(result.fontSize, 120);
  assert.equal(result.fontSize * result.textScale.x, 200);
  assert.equal(result.fontSize * result.textScale.y, 200);
});
