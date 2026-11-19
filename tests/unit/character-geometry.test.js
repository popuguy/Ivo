import test from 'node:test';
import assert from 'node:assert/strict';
import { characterInkBox, characterDecorationY } from '../../src/domain/text/character-geometry.js';
import {
  nativeCaretRect,
  nativeSelectionRects,
} from '../../src/features/editor/text/native-composition-geometry.js';

test('signed font boxes preserve complete shifted ink without changing line struts', () => {
  const line = { baseline: 50, ascent: 15, descent: 4 },
    before = structuredClone(line);
  const above = characterInkBox(line, { inkAscent: 41.5, inkDescent: -39.6 });
  assert.equal(above.y, 8.5);
  assert(Math.abs(above.height - 1.9) < 1e-9);
  const below = characterInkBox(line, { inkAscent: -38.5, inkDescent: 40.4 });
  assert.equal(below.y, 88.5);
  assert(Math.abs(below.height - 1.9) < 1e-9);
  assert.deepEqual(line, before);
  assert.deepEqual(characterInkBox(line), { y: 35, height: 19 });
  const run = {
    baselineShift: 6,
    verticalScale: 150,
    xHeight: 8,
    underlinePosition: -2,
    underlineThickness: 0.5,
  };
  assert.equal(characterDecorationY(line, run), 46);
  assert.equal(characterDecorationY(line, run, true), 38);
  for (const ink of [
    { inkAscent: NaN, inkDescent: 4 },
    { inkAscent: 1, inkDescent: -2 },
    { inkAscent: 1 },
  ])
    assert.throws(() => characterInkBox(line, ink), /invalid/);
});

test('advanced carets use the affinity-owned run box and selection preserves each transformed run', () => {
  const runs = [
      {
        start: 0,
        end: 2,
        inkAscent: 22,
        inkDescent: -2,
        glyphs: [
          { position: [0, 6], advance: [15, 0] },
          { position: [15, 6], advance: [15, 0] },
        ],
      },
      {
        start: 2,
        end: 4,
        inkAscent: 16,
        inkDescent: 4,
        glyphs: [
          { position: [30, 0], advance: [10, 0] },
          { position: [40, 0], advance: [10, 0] },
        ],
      },
    ],
    line = {
      frame: 'frame',
      start: 0,
      end: 4,
      contentEnd: 4,
      baseline: 60,
      ascent: 16,
      descent: 4,
      inkAscent: 22,
      inkDescent: 4,
      runs,
      carets: [0, 15, 30, 40, 50].map((x, index) => ({
        index,
        primary: x,
        secondary: x,
        logicalCandidates: [index, index],
      })),
    },
    column = {
      frameId: 'frame',
      start: 0,
      end: 4,
      native: {
        lines: [line],
        text: 'ABCD',
        spans: [{ kind: 'text', start: 0, end: 4, logicalStart: 0, logicalEnd: 4 }],
      },
    };
  const upstream = nativeCaretRect(column, { index: 2, affinity: 'backward' }),
    downstream = nativeCaretRect(column, { index: 2, affinity: 'forward' });
  assert.equal(upstream.y, 38);
  assert.equal(upstream.height, 20);
  assert.equal(downstream.y, 44);
  assert.equal(downstream.height, 20);
  assert.equal(upstream.x, downstream.x);
  const selection = nativeSelectionRects(column, { start: 0, end: 4 });
  assert.deepEqual(
    selection.rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [
      { x: 0, y: 38, width: 30, height: 20 },
      { x: 30, y: 44, width: 20, height: 20 },
    ],
  );
  assert.deepEqual(selection.limitations, []);
});
