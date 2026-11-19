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

function wrappedFixture() {
  const fragment = (start, end, left, baseline, ascent = 8, descent = 2) => ({
    start,
    end,
    contentEnd: end,
    baseline,
    ascent,
    descent,
    carets: Array.from({ length: end - start + 1 }, (_, at) =>
      caret(start + at, left + at * 10, start + at),
    ),
    runs: [
      {
        start,
        end,
        rtl: false,
        glyphs: Array.from({ length: end - start }, (_, at) => ({
          index: start + at,
          end: start + at + 1,
          position: [left + at * 10, 0],
          advance: [10, 0],
        })),
      },
    ],
  });
  const second = fragment(3, 6, 100, 12, 10, 4);
  second.carets[1].secondary = 115;
  return {
    frameId: 'wrapped',
    column: 1,
    start: 0,
    end: 12,
    native: {
      spans: [{ kind: 'text', start: 0, end: 12, logicalStart: 0, logicalEnd: 12 }],
      lines: [fragment(0, 3, 0, 12), second, fragment(6, 9, 0, 28), fragment(9, 12, 0, 44)],
    },
  };
}

test('wrapped native row hits choose the closest fragment across gaps and preserve fragment affinity', () => {
  const column = wrappedFixture(),
    before = structuredClone(column),
    hit = (x, y = 8) => hitNativeColumn(column, { x, y }, { coordinateSpace: 'column' });
  const second = hit(128, 3);
  assert.equal(second.index, 6);
  assert.equal(second.affinity, 'backward');
  assert.deepEqual(second.nativeCaretHint, { lineIndex: 1, side: 'primary' });
  const leftGap = hit(40),
    rightGap = hit(90);
  assert.equal(leftGap.index, 3);
  assert.equal(leftGap.affinity, 'backward');
  assert.equal(leftGap.nativeCaretHint.lineIndex, 0);
  assert.equal(rightGap.index, 3);
  assert.equal(rightGap.affinity, 'forward');
  assert.equal(rightGap.nativeCaretHint.lineIndex, 1);
  assert.equal(nativeCaretRect(column, leftGap, { hint: leftGap.nativeCaretHint }).x, 30);
  assert.equal(nativeCaretRect(column, rightGap, { hint: rightGap.nativeCaretHint }).x, 100);
  const secondary = hit(114.8),
    secondaryRect = nativeCaretRect(column, secondary, { hint: secondary.nativeCaretHint });
  assert.equal(secondary.index, 4);
  assert.deepEqual(secondary.nativeCaretHint, { lineIndex: 1, side: 'secondary' });
  assert.equal(secondaryRect.x, 115);
  assert.equal(secondaryRect.y, 2);
  assert.equal(secondaryRect.height, 14);
  assert.equal(hit(10, 25).index, 7, 'A different baseline must remain a different physical row');
  assert.deepEqual(column, before, 'Hit testing changed source or native geometry');
});

test('wrapped native navigation exposes one Home/End and Up/Down row across all fragments', () => {
  const column = wrappedFixture(),
    geometry = nativeCaretLines([column]),
    first = geometry.lines[0];
  assert.equal(geometry.lines.length, 3);
  assert.deepEqual(
    geometry.lines.map((line) => line.lineOrder),
    [0, 2, 3],
  );
  assert.deepEqual([first.start, first.end, first.sourceStart, first.sourceEnd], [0, 6, 0, 12]);
  assert.deepEqual([first.y, first.height], [2, 14]);
  assert.deepEqual(
    first.stops.map((stop) => stop.x),
    [0, 10, 20, 30, 100, 110, 115, 120, 130],
  );
  assert.equal(geometry.measuredStops, 17);
  assert.deepEqual(first.stops[0].nativeCaretHint, { lineIndex: 0, side: 'primary' });
  assert.deepEqual(first.stops.at(-1).nativeCaretHint, { lineIndex: 1, side: 'primary' });
  const rowAtSecondFragment = geometry.lines.find((line) =>
    line.stops.some((stop) => stop.index === 4 && stop.nativeCaretHint.lineIndex === 1),
  );
  assert.equal(
    rowAtSecondFragment.stops[0].index,
    0,
    'Home must reach the start of the physical row',
  );
  assert.equal(
    rowAtSecondFragment.stops.at(-1).index,
    6,
    'End must reach the end of the physical row',
  );
  assert.equal(
    geometry.lines[1].start,
    6,
    'Down must advance to the next baseline, not the next fragment',
  );
  assert.equal(
    geometry.lines[0].end,
    6,
    'Up from the next baseline must return to the complete wrapped row',
  );
  assert.deepEqual(
    first.stops
      .filter((stop) => stop.index === 3)
      .map(({ affinity, nativeCaretHint }) => ({ affinity, nativeCaretHint })),
    [
      { affinity: 'backward', nativeCaretHint: { lineIndex: 0, side: 'primary' } },
      { affinity: 'forward', nativeCaretHint: { lineIndex: 1, side: 'primary' } },
    ],
  );
});

test('wrapped row selection paints each original fragment without filling the excluded gap', () => {
  const column = wrappedFixture(),
    before = structuredClone(column),
    paint = nativeSelectionRects(column, { start: 2, end: 5 });
  assert.deepEqual(paint.limitations, []);
  assert.deepEqual(
    paint.rects.map(({ x, y, width, height, lineIndex, nativeStart, nativeEnd }) => ({
      x,
      y,
      width,
      height,
      lineIndex,
      nativeStart,
      nativeEnd,
    })),
    [
      { x: 20, y: 4, width: 10, height: 10, lineIndex: 0, nativeStart: 2, nativeEnd: 3 },
      { x: 100, y: 2, width: 20, height: 14, lineIndex: 1, nativeStart: 3, nativeEnd: 5 },
    ],
  );
  assert.equal(nativeCaretRect(column, { index: 3, affinity: 'backward' }).x, 30);
  assert.equal(nativeCaretRect(column, { index: 3, affinity: 'forward' }).x, 100);
  assert.deepEqual(column, before);
});

test('equal native baselines never merge rows from different physical columns', () => {
  const left = wrappedFixture(),
    right = wrappedFixture();
  right.frameId = 'another-frame';
  right.column = 2;
  const geometry = nativeCaretLines([left, right]);
  assert.equal(geometry.lines.length, 6);
  assert.deepEqual(
    geometry.lines.map((line) => line.columnOrder),
    [0, 0, 0, 1, 1, 1],
  );
  assert.equal(geometry.lines[3].frameId, 'another-frame');
});
