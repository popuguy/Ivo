import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hitNativeColumn,
  nativeCaretRect,
  nativeCaretLines,
  nativeSelectionRects,
} from '../../src/features/editor/text/native-composition-geometry.js';
const caret = (index, primary, lo = index + 1, hi = lo, secondary = primary) => ({
  index,
  primary,
  secondary,
  logicalCandidates: [lo, hi],
  measurement: 'native-line',
});
function fixture() {
  const line = {
    start: 0,
    end: 5,
    contentEnd: 4,
    baseline: 12,
    ascent: 10,
    descent: 3,
    carets: [
      caret(0, 0, 0, 1),
      caret(1, 10),
      caret(2, 20, 3, 3, 40),
      caret(3, 30),
      caret(4, 40, 5, 6, 20),
      caret(5, 40, 6, 7),
    ],
    runs: [
      {
        start: 0,
        end: 2,
        rtl: false,
        glyphs: [
          { index: 0, end: 1, position: [0, 0], advance: [10, 0] },
          { index: 1, end: 2, position: [10, 0], advance: [10, 0] },
        ],
      },
      {
        start: 2,
        end: 4,
        rtl: true,
        glyphs: [
          { index: 3, end: 4, position: [20, 0], advance: [10, 0] },
          { index: 2, end: 3, position: [30, 0], advance: [10, 0] },
        ],
      },
    ],
  };
  return {
    frameId: 'frame-a',
    start: 0,
    end: 7,
    native: {
      lines: [line],
      spans: [
        { kind: 'structure', logicalStart: 0, logicalEnd: 1, start: 0, end: 0 },
        { kind: 'text', logicalStart: 1, logicalEnd: 5, start: 0, end: 4 },
        { kind: 'paragraph', logicalStart: 5, logicalEnd: 6, start: 4, end: 5 },
        { kind: 'structure', logicalStart: 6, logicalEnd: 7, start: 5, end: 5 },
      ],
    },
  };
}

test('native caret/hit geometry preserves canonical maps and measured primary/secondary offsets', () => {
  const column = fixture(),
    hit = hitNativeColumn(column, { x: 39.9, y: 8 }, { coordinateSpace: 'column' });
  assert.equal(hit.index, 3);
  assert.equal(hit.nativeCaretHint.side, 'secondary');
  const rect = nativeCaretRect(column, hit, { hint: hit.nativeCaretHint });
  assert.equal(rect.x, 40);
  assert.equal(rect.y, 2);
  assert.equal(rect.height, 13);
  assert.equal(nativeCaretRect(column, { index: 3, affinity: 'forward' }).x, 20);
  const geometry = nativeCaretLines([column]);
  assert.equal(geometry.lines[0].sourceStart, 0);
  assert.equal(geometry.lines[0].sourceEnd, 7);
  assert.ok(geometry.limitations.includes('mixed-bidi-affinity'));
  assert.ok(!geometry.lines[0].stops.some((stop) => stop.nativeIndex === 5));
});

test('native selection paint splits visual runs and resolves bidi boundary offsets per run', () => {
  const column = fixture(),
    before = structuredClone(column);
  const regular = nativeSelectionRects(column, { start: 1, end: 3 });
  assert.deepEqual(
    regular.rects.map(({ x, width }) => ({ x, width })),
    [{ x: 0, width: 20 }],
  );
  const partialRtl = nativeSelectionRects(column, { start: 3, end: 4 });
  assert.deepEqual(
    partialRtl.rects.map(({ x, width }) => ({ x, width })),
    [{ x: 30, width: 10 }],
  );
  const both = nativeSelectionRects(column, { start: 2, end: 5 });
  assert.deepEqual(
    both.rects.map(({ x, width }) => ({ x, width })),
    [
      { x: 10, width: 10 },
      { x: 20, width: 20 },
    ],
  );
  const marks = nativeSelectionRects(column, { start: 5, end: 6 });
  assert.ok(
    marks.rects.some(
      (rect) => rect.width === 0 && rect.measurement === 'paragraph-mark-native-origin',
    ),
  );
  assert.deepEqual(column, before);
});

test('empty paragraph hits choose the authored insertion point, never virtual min/max outside it', () => {
  const column = {
    frameId: 'blank',
    start: 0,
    end: 3,
    native: {
      spans: [
        { kind: 'structure', logicalStart: 0, logicalEnd: 1, start: 0, end: 0 },
        { kind: 'placeholder', logicalStart: 1, logicalEnd: 2, start: 0, end: 0 },
        { kind: 'paragraph', logicalStart: 2, logicalEnd: 3, start: 0, end: 1 },
      ],
      lines: [
        {
          start: 0,
          end: 1,
          contentEnd: 0,
          baseline: 12,
          ascent: 10,
          descent: 3,
          runs: [],
          carets: [caret(0, 0, 0, 3), caret(1, 0, 3, 3)],
        },
      ],
    },
  };
  assert.equal(hitNativeColumn(column, { x: 4, y: 9 }, { coordinateSpace: 'column' }).index, 1);
  assert.deepEqual(
    nativeCaretLines([column]).lines[0].stops.map((stop) => stop.index),
    [1],
  );
  assert.equal(nativeCaretRect(column, { index: 0, affinity: 'forward' }).x, 0);
  assert.equal(nativeCaretRect(column, { index: 2, affinity: 'backward' }).x, 0);
});

test('adjacent source style spans remain one native selection across a grapheme cluster', () => {
  const column = {
    frameId: 'cluster',
    start: 0,
    end: 4,
    native: {
      spans: [
        { kind: 'structure', logicalStart: 0, logicalEnd: 1, start: 0, end: 0 },
        { kind: 'text', logicalStart: 1, logicalEnd: 2, start: 0, end: 1 },
        { kind: 'text', logicalStart: 2, logicalEnd: 3, start: 1, end: 2 },
        { kind: 'paragraph', logicalStart: 3, logicalEnd: 4, start: 2, end: 3 },
      ],
      lines: [
        {
          start: 0,
          end: 3,
          contentEnd: 2,
          baseline: 12,
          ascent: 10,
          descent: 3,
          carets: [caret(0, 0, 0, 1), caret(2, 10, 3, 4), caret(3, 10, 4, 4)],
          runs: [
            {
              start: 0,
              end: 2,
              rtl: false,
              glyphs: [{ index: 0, end: 2, position: [0, 0], advance: [10, 0] }],
            },
          ],
        },
      ],
    },
  };
  const paint = nativeSelectionRects(column, { start: 1, end: 3 });
  assert.equal(paint.limitations.length, 0);
  assert.deepEqual(
    paint.rects.map(({ x, width }) => ({ x, width })),
    [{ x: 0, width: 10 }],
  );
});
