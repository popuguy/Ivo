import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtent, runCaret } from '../../src/domain/text/run-geometry.js';

test('native run extents preserve negative advances and fallback only at source edges', () => {
  const run = { start: 2, end: 4, rtl: true, glyphs: [{ position: [30, 0], advance: [-20, 0] }] },
    before = structuredClone(run);
  assert.deepEqual(runExtent(run), { min: 10, max: 30 });
  assert.deepEqual(runCaret({}, run, 2), { x: 30, measurement: 'native-run-extent' });
  assert.deepEqual(runCaret({}, run, 4), { x: 10, measurement: 'native-run-extent' });
  assert.equal(runCaret({}, run, 3), null);
  assert.deepEqual(run, before);
});

test('precomputed geometry preserves measured caret choices and rejects unrelated visual offsets', () => {
  const run = { start: 0, end: 2, rtl: true, glyphs: [{ position: [10, 0], advance: [20, 0] }] },
    line = {
      carets: [
        { index: 0, primary: 10, secondary: 30 },
        { index: 1, primary: 80, secondary: 20 },
        { index: 2, primary: 50, secondary: 60 },
      ],
    },
    geometry = {
      extent: runExtent(run),
      carets: new Map(line.carets.map((caret) => [caret.index, caret])),
    };
  assert.deepEqual(runCaret(line, run, 0), { x: 30, measurement: 'native-run-carets' });
  assert.deepEqual(runCaret(line, run, 1), { x: 20, measurement: 'native-run-carets' });
  assert.equal(runCaret(line, run, 2), null);
  for (const index of [0, 1, 2])
    assert.deepEqual(runCaret(line, run, index, geometry), runCaret(line, run, index));
});

test('run extents are iterative at the admitted glyph budget and empty runs have no caret geometry', () => {
  const run = {
    glyphs: Array.from({ length: 100000 }, (_, index) => ({
      position: [index, 0],
      advance: [1, 0],
    })),
  };
  assert.deepEqual(runExtent(run), { min: 0, max: 100000 });
  assert.equal(runExtent({ glyphs: [] }), null);
  assert.equal(runCaret({}, { start: 0, end: 0, glyphs: [] }, 0), null);
});
