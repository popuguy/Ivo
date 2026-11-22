import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseParagraphFlow } from '../../src/domain/text/paragraph-flow.js';
import {
  chooseWrappedParagraphFlow,
  wrappedParagraphFlowSteps,
} from '../../src/domain/text/wrapped-paragraph-flow.js';

const metrics = { ascent: 10, descent: 3, advance: 14, capHeight: 7, xHeight: 5, leading: 0 };

function rectangle(left, top, right, bottom, extra = {}) {
  return {
    mode: 'bounds',
    side: 'both',
    bounds: { left, top, right, bottom },
    polygons: [
      [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    ],
    ...extra,
  };
}

function measuredWords(widths, indices = widths.map((_, index) => index).concat(widths.length)) {
  const measurements = [];
  for (let a = 0; a < widths.length; a++) {
    let width = 0;
    for (let b = a + 1; b <= widths.length; b++) {
      width += widths[b - 1] + (b > a + 1 ? 1 : 0);
      measurements.push({ start: indices[a], end: indices[b], width, ...metrics });
    }
  }
  return {
    start: indices[0],
    end: indices.at(-1),
    opportunities: indices.map((index) => ({ index })),
    measurements,
    columns: [{ width: 100, height: 100 }],
  };
}

function realSpaces() {
  const text = 'alpha beta gamma delta',
    input = measuredWords([18, 15, 18, 15], [0, 6, 11, 17, 22]);
  input.columns[0].obstacles = [rectangle(25, 0, 60, 40)];
  return { text, input };
}

/** Independent exhaustive rectangular oracle. It subtracts bounds directly;
 * it does not import the production wrap geometry, memoize or merge cursors. */
function rectangularOracle(input) {
  const style = {
      leftIndent: 0,
      rightIndent: 0,
      firstLineIndent: 0,
      paragraphBefore: 0,
      ...input.layout,
    },
    uniform = input.measurements[0],
    first = (column) =>
      Math.max(
        column.minimumFirstBaseline ?? 0,
        {
          ascent: uniform.ascent,
          'cap-height': uniform.capHeight,
          'x-height': uniform.xHeight,
          leading: uniform.advance,
          fixed: 0,
        }[column.firstBaseline ?? 'ascent'],
      ),
    visit = (
      position,
      currentFrame,
      currentBaseline,
      after,
      mandatory,
      initial,
      cost,
      priorRowTop,
    ) => {
      if (position === input.end) return cost;
      const stop =
          input.opportunities.find((point) => point.index > position && point.mandatory)?.index ??
          input.end,
        rows = input.measurements.filter((row) => row.start === position && row.end <= stop);
      for (let frame = currentFrame; frame < input.columns.length; frame++) {
        const column = input.columns[frame],
          offset = first(column),
          left = style.leftIndent + (position === input.start ? style.firstLineIndent : 0),
          right = column.width - style.rightIndent,
          minWidth = Math.min(...rows.map((row) => row.width));
        if (right - left < 1 || minWidth > right - left + 1e-6) continue;
        let y =
            frame !== currentFrame || currentBaseline === null
              ? offset
              : initial
                ? currentBaseline +
                  uniform.advance +
                  (input.previousAfter ?? 0) +
                  style.paragraphBefore
                : currentBaseline + (mandatory ? uniform.advance : 0),
          consumed = frame === currentFrame && !initial && !mandatory ? after : null;
        let firstRow = frame !== currentFrame || currentBaseline === null;
        let rowTop = firstRow ? 0 : consumed === null ? y - uniform.advance : priorRowTop;
        while (y <= column.height + 1e-6) {
          let segments = [{ left, right }],
            nextColumn = false,
            jumpEnd = null;
          const events = [],
            top = y - uniform.ascent,
            bottom = y + uniform.descent;
          for (const obstacle of column.obstacles ?? []) {
            const b = obstacle.bounds;
            if (obstacle.mode === 'jump') {
              if (
                b.left < right &&
                b.right > left &&
                b.top < Math.max(y, rowTop + 1e-6) &&
                b.bottom > rowTop
              )
                jumpEnd = Math.max(jumpEnd ?? -Infinity, b.bottom);
              continue;
            }
            if (!(
              b.left < right - 1e-7 &&
              b.right > left + 1e-7 &&
              b.top < (obstacle.mode === 'bounds' ? Math.max(y, rowTop + 1e-6) : bottom) - 1e-7 &&
              b.bottom > (obstacle.mode === 'bounds' ? rowTop : top) + 1e-7
            ))
              continue;
            if (obstacle.mode === 'next-column') {
              nextColumn = true;
              segments = [];
            } else if (obstacle.side === 'left')
              segments = segments
                .map((part) => ({ left: part.left, right: Math.min(part.right, b.left) }))
                .filter((part) => part.right > part.left);
            else if (obstacle.side === 'right')
              segments = segments
                .map((part) => ({ left: Math.max(part.left, b.right), right: part.right }))
                .filter((part) => part.right > part.left);
            else
              segments = segments
                .flatMap((part) => [
                  { left: part.left, right: Math.min(part.right, b.left) },
                  { left: Math.max(part.left, b.right), right: part.right },
                ])
                .filter((part) => part.right > part.left);
            if (b.top > top + 1e-7) events.push(b.top);
            if (b.bottom > top + 1e-7) events.push(b.bottom);
          }
          if (nextColumn) break;
          if (jumpEnd !== null) {
            rowTop = firstRow ? jumpEnd : y;
            y = rowTop + (firstRow ? offset : uniform.advance);
            consumed = null;
            continue;
          }
          if (!segments.length) {
            let next = events.length ? Math.min(...events) + offset : null;
            if (next !== null && next <= y + 1e-6) {
              const clear = Math.min(...events) + Math.max(offset, uniform.ascent);
              if (clear > y + 1e-6) next = clear;
              else {
                const later = (column.obstacles ?? [])
                  .flatMap((obstacle) => [obstacle.bounds.top, obstacle.bounds.bottom])
                  .filter((event) => event + offset > y + 1e-6);
                next = later.length ? Math.min(...later) + offset : null;
              }
            }
            if (next === null) break;
            y = next;
            rowTop = y - offset;
            consumed = null;
            continue;
          }
          for (const part of segments) {
            if (consumed !== null && part.left < consumed - 1e-6) continue;
            const width = part.right - part.left,
              choices = rows.filter((row) => width >= 1 && row.width <= width + 1e-6);
            if (choices.length)
              return Math.min(
                ...choices.map((row) => {
                  const target = input.opportunities.find((point) => point.index === row.end);
                  return visit(
                    row.end,
                    frame,
                    y,
                    part.right,
                    target.mandatory,
                    false,
                    cost +
                      1 +
                      (target.penalty ?? 0) +
                      (row.end === input.end ? 0 : 100 * ((width - row.width) / width) ** 2),
                    rowTop,
                  );
                }),
              );
          }
          if (uniform.advance === 0) {
            if (consumed !== null) {
              consumed = null;
              continue;
            }
            break;
          }
          rowTop = y;
          firstRow = false;
          y += uniform.advance;
          consumed = null;
        }
      }
      return Infinity;
    };
  return visit(
    input.start,
    input.cursor?.frame ?? 0,
    input.cursor?.baseline ?? null,
    null,
    false,
    true,
    0,
  );
}

test('real source spaces survive left-to-right fragments sharing a physical baseline', () => {
  const { text, input } = realSpaces(),
    before = structuredClone(input),
    result = chooseWrappedParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => [line.start, line.end, line.baseline, line.left]),
    [
      [0, 6, 10, 0],
      [6, 17, 10, 60],
      [17, 22, 24, 0],
    ],
  );
  assert.equal(result.lines.map((line) => text.slice(line.start, line.end)).join(''), text);
  assert.equal(text.slice(result.lines[0].start, result.lines[0].end).at(-1), ' ');
  assert.deepEqual(result.cursor, { frame: 0, baseline: 24 });
  assert.deepEqual(input, before);
});

test('wrap openings count from the first placed word on each physical row', () => {
  function compose(slots, words, mode, mixed) {
    const input = measuredWords(words);
    const obstacles = [];
    let x = 0;
    for (const width of slots.slice(0, -1)) {
      x += width;
      obstacles.push(rectangle(x, 0, x + 4, 70));
      x += 4;
    }
    input.columns = [{ width: x + slots.at(-1), height: 140, obstacles }];
    if (mixed)
      for (const row of input.measurements) if (row.start < 2 && row.end >= 2) row.ascent += 2;
    const result = chooseWrappedParagraphFlow({ ...input, mode });
    assert.equal(result.status, 'fit');
    return result.lines.filter((l) => l.baseline === result.lines[0].baseline).map((l) => l.left);
  }
  for (const mode of ['paragraph', 'single-line'])
    for (const mixed of [false, true]) {
      assert.deepEqual(
        compose(Array(8).fill(12), Array(8).fill(10), mode, mixed),
        [0, 16, 32, 48, 64],
      );
      // A long initial word may search past five unusable openings.
      assert.deepEqual(compose([6, 6, 6, 6, 6, 14, 12, 12], [14, 10], mode, mixed), [50, 68]);
      // Unused openings after a placed word still count.
      assert.deepEqual(compose([12, 6, 6, 6, 6, 14], [10, 14], mode, mixed), [0]);
      assert.deepEqual(
        compose([6, 12, 12, 12, 12, 12, 12], Array(7).fill(10), mode, mixed),
        [10, 26, 42, 58, 74],
      );
    }
});

test('mandatory hard/soft break opportunities end the row and skip its remaining gaps', () => {
  for (const mode of ['paragraph', 'single-line']) {
    const { input } = realSpaces();
    input.opportunities[1].mandatory = true;
    const result = chooseWrappedParagraphFlow({ ...input, mode });
    assert.equal(result.status, 'fit');
    assert.deepEqual(
      result.lines.slice(0, 2).map((line) => [line.end, line.baseline, line.left]),
      [
        [6, 10, 0],
        [11, 24, 0],
      ],
    );
    assert.equal(result.lines.filter((line) => line.baseline === 10).length, 1);
  }
});

test('fully blocked bands restart from the exclusion boundary plus first-baseline offset', () => {
  for (const obstacle of [rectangle(20, 0, 60, 44, { mode: 'jump' }), rectangle(0, 0, 100, 44)]) {
    const input = measuredWords([20]);
    input.columns = [
      {
        width: 100,
        height: 100,
        firstBaseline: 'fixed',
        minimumFirstBaseline: 12,
        obstacles: [obstacle],
      },
    ];
    const result = chooseWrappedParagraphFlow(input);
    assert.equal(result.status, 'fit');
    assert.equal(
      result.lines[0].baseline,
      56,
      'Do not round the new origin onto the previous leading grid',
    );
  }
});

test('Jump restarts an empty column at its configured first baseline beneath the object', () => {
  for (const firstBaseline of ['cap-height', 'x-height', 'fixed']) {
    const input = measuredWords([20]);
    input.columns = [
      {
        width: 100,
        height: 100,
        firstBaseline,
        obstacles: [rectangle(0, 0, 100, 44, { mode: 'jump' })],
      },
    ];
    const result = chooseWrappedParagraphFlow(input);
    assert.equal(result.status, 'fit');
    assert.equal(result.lines[0].frame, 0);
    assert.equal(
      result.lines[0].baseline,
      44 + { 'cap-height': 7, 'x-height': 5, fixed: 0 }[firstBaseline],
    );
    assert(result.candidates < 30);
  }
});

test('Jump keeps the leading cadence across a blocker and restarts only at column entry', () => {
  for (const mode of ['paragraph', 'single-line']) {
    const input = measuredWords([75, 75, 75]);
    input.mode = mode;
    for (const row of input.measurements) row.advance = 14.4;
    const column = input.columns[0];
    column.firstBaseline = 'fixed';
    column.minimumFirstBaseline = 12;
    const baselines = (top) => {
      column.obstacles = [rectangle(20, top, 70, 29, { mode: 'jump' })];
      return chooseWrappedParagraphFlow(input).lines.map((line) =>
        Number(line.baseline.toFixed(4)),
      );
    };
    assert.deepEqual(baselines(16), [12, 55.2, 69.6]);
    assert.deepEqual(baselines(12), [12, 55.2, 69.6]);
    assert.deepEqual(baselines(11.99), [41, 55.4, 69.8]);
    column.obstacles.push(rectangle(30, 10, 80, 27, { mode: 'next-column' }));
    input.columns.push({ width: 100, height: 100 });
    assert.deepEqual(
      chooseWrappedParagraphFlow(input).lines.map((line) => line.frame),
      [1, 1, 1],
    );
  }
});

test('a tall Jump Object skips blocked leading intervals within the search budget', () => {
  const input = measuredWords([75, 75]);
  for (const row of input.measurements) row.advance = 0.25;
  input.columns = [
    { width: 100, height: 12000, obstacles: [rectangle(20, 11, 70, 11000, { mode: 'jump' })] },
  ];
  input.cursor = { frame: 0, baseline: 10.75 };
  input.layout = { paragraphBefore: 0.25 };
  const result = chooseWrappedParagraphFlow({ ...input, maxCandidates: 100 });
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => line.baseline),
    [11000.25, 11000.5],
  );
});

test('empty inverse-contour apex rows advance into the usable interior', () => {
  const obstacle = {
    mode: 'contour',
    invert: true,
    bounds: { left: 10, top: 10, right: 90, bottom: 90 },
    polygons: [
      Array.from({ length: 24 }, (_, index) => ({
        x: 50 + 40 * Math.cos((index * Math.PI) / 12),
        y: 50 + 40 * Math.sin((index * Math.PI) / 12),
      })),
    ],
  };
  for (const mode of ['paragraph', 'single-line']) {
    const input = measuredWords([20]);
    input.columns = [
      { width: 100, height: 100, obstacles: [obstacle] },
      { width: 100, height: 100 },
    ];
    const before = structuredClone(input),
      result = chooseWrappedParagraphFlow({ ...input, mode });
    assert.equal(result.status, 'fit');
    assert.equal(result.lines[0].frame, 0);
    assert.equal(result.lines[0].baseline, 24);
    assert(result.lines[0].left > 30 && result.lines[0].width > 33);
    assert(result.candidates < 30, 'Apex recovery must not spin');
    assert.deepEqual(input, before);
  }
});

test('a contour covering the first full band can expose usable sides before its box bottom', () => {
  const input = measuredWords([5]);
  input.columns = [
    {
      width: 100,
      height: 100,
      obstacles: [
        {
          mode: 'contour',
          side: 'both',
          bounds: { left: 0, top: 0, right: 100, bottom: 80 },
          polygons: [
            [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 50, y: 80 },
            ],
          ],
        },
      ],
    },
  ];
  const result = chooseWrappedParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.equal(result.lines[0].baseline, 24);
  assert.equal(result.lines[0].left, 0);
  assert.equal(result.lines[0].width, 6.25);
});

test('an unrelated contour does not change qualified rectangle or Jump boundary restart', () => {
  for (const mode of ['bounds', 'jump']) {
    const input = measuredWords([20]);
    input.columns = [
      {
        width: 100,
        height: 100,
        firstBaseline: 'fixed',
        minimumFirstBaseline: 12,
        obstacles: [
          rectangle(0, 0, 100, 44, { mode }),
          {
            mode: 'contour',
            bounds: { left: 200, top: 0, right: 250, bottom: 80 },
            polygons: [
              [
                { x: 200, y: 0 },
                { x: 250, y: 0 },
                { x: 200, y: 80 },
              ],
            ],
          },
        ],
      },
    ];
    const result = chooseWrappedParagraphFlow(input);
    assert.equal(result.status, 'fit');
    assert.equal(result.lines[0].baseline, 56);
  }
});

test('empty contour search handles zero and underflow leading without retrying one band forever', () => {
  for (const advance of [0, Number.MIN_VALUE]) {
    const input = measuredWords([5]);
    input.measurements[0].advance = advance;
    input.columns[0].obstacles = [
      {
        mode: 'contour',
        side: 'both',
        bounds: { left: 0, top: 0, right: 100, bottom: 80 },
        polygons: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 80 },
          ],
        ],
      },
    ];
    const result = chooseWrappedParagraphFlow(input);
    assert.equal(result.status, 'fit');
    assert.equal(result.lines[0].baseline, 23);
    assert.equal(result.lines[0].advance, advance);
    assert(result.candidates < 30);
  }
});

test('next-column wrapping skips immediately and future empty columns do not inherit obstacles', () => {
  const input = measuredWords([20, 20]);
  input.columns = [
    { width: 100, height: 200, obstacles: [rectangle(20, 0, 60, 44, { mode: 'next-column' })] },
    { width: 90, height: 80, firstBaseline: 'cap-height', obstacles: [] },
  ];
  const before = structuredClone(input),
    result = chooseWrappedParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => [line.frame, line.baseline, line.left, line.width]),
    [[1, 7, 0, 90]],
  );
  assert.deepEqual(input, before);
  input.columns[0].obstacles[0].mode = 'jump';
  input.columns[0].height = 20;
  assert.equal(chooseWrappedParagraphFlow(input).lines[0].frame, 1);
});

test('side selection uses box geometry and ordinary contours use the physical line band', () => {
  const input = measuredWords([18, 15, 18]);
  input.columns[0].obstacles = [rectangle(25, 0, 60, 80, { side: 'right' })];
  const right = chooseWrappedParagraphFlow(input);
  assert.equal(right.status, 'fit');
  assert(right.lines.every((line) => line.left === 60 && line.width === 40));
  const contour = measuredWords([45]);
  contour.columns[0].obstacles = [
    {
      mode: 'contour',
      side: 'both',
      bounds: { left: 40, top: 0, right: 60, bottom: 40 },
      polygons: [
        [
          { x: 40, y: 0 },
          { x: 60, y: 20 },
          { x: 40, y: 40 },
        ],
      ],
    },
  ];
  const result = chooseWrappedParagraphFlow(contour);
  assert.equal(result.status, 'fit');
  assert.equal(result.lines[0].left, 50);
  assert.equal(result.lines[0].width, 50);
});

test('paragraph indents, spacing and first source-fragment indent survive split rows', () => {
  const input = measuredWords([12, 16, 20]);
  input.layout = { leftIndent: 4, rightIndent: 4, firstLineIndent: 6, paragraphBefore: 3 };
  input.cursor = { frame: 0, baseline: 5 };
  input.previousAfter = 4;
  input.columns[0].obstacles = [rectangle(25, 0, 60, 100)];
  const result = chooseWrappedParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => [line.baseline, line.left, line.width]),
    [
      [26, 10, 15],
      [26, 60, 36],
      [40, 4, 21],
    ],
  );
  input.columns[0].height = 20;
  input.columns.push({ width: 100, height: 100 });
  const transitioned = chooseWrappedParagraphFlow(input);
  assert.equal(transitioned.lines[0].baseline, 10, 'Paragraph spacing is suppressed at column top');
  assert.equal(transitioned.lines[0].left, 10);
});

test('unwrapped uniform paragraphs agree with the physical-column solver', () => {
  for (const mode of ['paragraph', 'single-line']) {
    const input = measuredWords([3, 2, 2, 5]);
    input.columns = [
      { width: 6, height: 24 },
      { width: 8, height: 100 },
    ];
    const actual = chooseWrappedParagraphFlow({ ...input, mode }),
      expected = chooseParagraphFlow({ ...input, mode });
    assert.equal(actual.status, expected.status);
    assert.equal(actual.cost, expected.cost);
    assert.deepEqual(actual.lines, expected.lines);
    assert.deepEqual(actual.cursor, expected.cursor);
  }
});

test('tiny wrapped paragraph costs agree with exhaustive rectangular paths', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const input = measuredWords(
      Array.from({ length: 5 }, (_, index) => 1 + ((seed * 3 + index * 7) % 5)),
    );
    for (const row of input.measurements)
      Object.assign(row, { ascent: 4, descent: 1, advance: 6, capHeight: 3, xHeight: 2 });
    input.columns = Array.from({ length: 3 }, (_, index) => ({
      width: 7 + ((seed + index) % 7),
      height: 10 + ((seed * 3 + index * 5) % 20),
      firstBaseline: ['ascent', 'leading', 'fixed', 'x-height', 'cap-height'][(seed + index) % 5],
      minimumFirstBaseline: seed % 3,
      obstacles:
        index === 2
          ? []
          : [
              rectangle(2 + (seed % 2), seed % 4, 5 + (seed % 3), 10 + (seed % 5), {
                mode: seed % 7 === 0 ? 'next-column' : seed % 11 === 0 ? 'jump' : 'bounds',
                side: ['both', 'left', 'right'][seed % 3],
              }),
            ],
    }));
    input.layout = {
      leftIndent: seed % 2,
      rightIndent: seed % 2,
      firstLineIndent: seed % 3,
      paragraphBefore: seed % 3,
    };
    input.cursor = { frame: 0, baseline: seed % 2 ? null : 5 };
    input.previousAfter = seed % 3;
    if (seed % 4 === 0) input.opportunities[2].mandatory = true;
    input.opportunities[3].penalty = seed % 5;
    const before = structuredClone(input),
      expected = rectangularOracle(input),
      actual = chooseWrappedParagraphFlow(input),
      reversed = chooseWrappedParagraphFlow({
        ...input,
        measurements: [...input.measurements].reverse(),
      });
    assert.equal(actual.status, Number.isFinite(expected) ? 'fit' : 'unfit', `Seed ${seed}`);
    if (Number.isFinite(expected))
      assert(
        Math.abs(actual.cost - expected) < 1e-9,
        `Seed ${seed}: ${actual.cost} vs ${expected}`,
      );
    assert.deepEqual(actual, reversed);
    assert.deepEqual(input, before);
  }
});

test('a larger run in a later fragment settles the whole row, including after a frame break', () => {
  for (const mode of ['single-line', 'paragraph'])
    for (const automatic of [true, false]) {
      const input = measuredWords(Array(8).fill(20));
      input.mode = mode;
      input.columns = [{ width: 100, height: 130, obstacles: [rectangle(37, 0, 65, 125)] }];
      for (const row of input.measurements)
        if (row.start <= 3 && row.end > 3) {
          row.ascent = 20;
          row.advance = automatic ? 28 : 14;
        }
      const result = chooseWrappedParagraphFlow(input);
      const y = automatic ? 38 : 24;
      assert.equal(result.status, 'fit');
      assert.deepEqual(
        result.lines.map((line) => line.baseline),
        [10, 10, y, y, y + 14, y + 14, y + 28, y + 28],
      );
      assert.equal(result.lines[2].ascent, 20);
      assert.equal(result.lines[3].left, 65);
      const split = chooseWrappedParagraphFlow({
        ...input,
        columns: [{ ...input.columns[0], height: 20 }, input.columns[0]],
      });
      assert.deepEqual(
        split.lines.slice(2, 4).map((l) => [l.frame, l.baseline]),
        [
          [1, 20],
          [1, 20],
        ],
      );
      assert.deepEqual(
        chooseWrappedParagraphFlow({ ...input, measurements: [...input.measurements].reverse() })
          .lines,
        result.lines,
      );
    }
});
test('a larger next fragment cannot evict a valid short row from its frame', () => {
  const input = measuredWords([14, 22]);
  input.columns = [
    { width: 72, height: 17, obstacles: [rectangle(30, 0, 42, 100)] },
    { width: 100, height: 90 },
  ];
  for (const row of input.measurements)
    if (row.end === 2) {
      row.ascent = 24;
      row.advance = 30;
    }
  for (const mode of ['single-line', 'paragraph']) {
    const result = chooseWrappedParagraphFlow({ ...input, mode });
    assert.equal(result.status, 'fit');
    assert.deepEqual(
      result.lines.map((l) => [l.end, l.frame, l.baseline]),
      [
        [1, 0, 10],
        [2, 1, 24],
      ],
    );
  }
});
test('a taller following run clears the object without taking an earlier short line with it', () => {
  const input = measuredWords([14, 22]);
  input.columns = [
    {
      width: 72,
      height: 100,
      obstacles: [rectangle(30, 0, 42, 100), rectangle(0, 16, 72, 53)],
    },
  ];
  for (const row of input.measurements)
    if (row.end === 2) {
      row.ascent = 24;
      row.advance = 30;
    }
  for (const mode of ['single-line', 'paragraph']) {
    const result = chooseWrappedParagraphFlow({ ...input, mode });
    assert.equal(result.status, 'fit');
    assert.deepEqual(
      result.lines.map((line) => [line.end, line.baseline]),
      [
        [1, 10],
        [2, 77],
      ],
    );
  }
});

test('three fragments share the final run’s ascent and both mixed-row budgets remain binding', () => {
  const input = measuredWords([17, 17, 17, 17, 17]);
  input.columns = [
    {
      width: 90,
      height: 90,
      obstacles: [rectangle(20, 0, 35, 90), rectangle(55, 0, 70, 90)],
    },
  ];
  for (const row of input.measurements)
    if (row.start <= 2 && row.end > 2) {
      row.ascent = 23;
      row.advance = 32;
    }
  for (const mode of ['single-line', 'paragraph']) {
    const result = chooseWrappedParagraphFlow({ ...input, mode });
    assert.equal(result.status, 'fit');
    assert.deepEqual(
      result.lines.map((line) => [line.left, line.baseline]),
      [
        [0, 23],
        [35, 23],
        [70, 23],
        [0, 37],
        [35, 37],
      ],
    );
    assert.equal(
      chooseWrappedParagraphFlow({ ...input, mode, maxStates: 2 }).reason,
      'state-budget',
    );
    assert.equal(
      chooseWrappedParagraphFlow({ ...input, mode, maxCandidates: 10 }).reason,
      'candidate-budget',
    );
  }
});

test('subpixel noise in uniform metrics preserves stable placements and work counts', () => {
  const input = measuredWords([3, 3]);
  input.measurements[1].ascent += 0.0000005;
  const a = chooseWrappedParagraphFlow(input),
    b = chooseWrappedParagraphFlow({ ...input, measurements: [...input.measurements].reverse() });
  assert.equal(a.status, 'fit');
  assert.deepEqual(a, b);
});

test('work, geometry and nonfit limits never substitute a fallback composition', () => {
  const { input } = realSpaces();
  assert.equal(
    chooseWrappedParagraphFlow({ ...input, maxCandidates: 1 }).reason,
    'candidate-budget',
  );
  assert.equal(chooseWrappedParagraphFlow({ ...input, maxStates: 1 }).reason, 'state-budget');
  assert.equal(
    chooseWrappedParagraphFlow({ ...input, columns: [{ width: 1, height: 100 }] }).reason,
    'no-feasible-path',
  );
  const polygon = Array.from({ length: 4097 }, (_, index) => ({ x: index % 2, y: index }));
  const excessive = {
    mode: 'contour',
    bounds: { left: 0, top: 0, right: 1, bottom: 4096 },
    polygons: [polygon],
  };
  assert.equal(
    chooseWrappedParagraphFlow({
      ...input,
      columns: [{ width: 100, height: 100, obstacles: [excessive] }],
    }).reason,
    'geometry-budget',
  );
  const inverted = {
    ...excessive,
    invert: true,
    polygons: [polygon.slice(0, 257)],
  };
  assert.equal(
    chooseWrappedParagraphFlow({
      ...input,
      columns: [{ width: 100, height: 100, obstacles: [inverted] }],
    }).reason,
    'geometry-budget',
    'Inverted query complexity is bounded independently of vertex count',
  );
});

test('blank paragraphs and zero leading remain bounded without dropping source', () => {
  const blank = measuredWords([0]);
  assert.equal(chooseWrappedParagraphFlow(blank).status, 'fit');
  const input = measuredWords([3, 3, 3]);
  for (const row of input.measurements) row.advance = 0;
  input.columns = [{ width: 4, height: 13 }];
  const result = chooseWrappedParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.equal(result.lines.length, 3);
  assert(result.lines.every((line) => line.baseline === 10));
});

test('cooperative preparation/search steps produce exactly the synchronous terminal result', () => {
  const input = measuredWords(Array.from({ length: 160 }, (_, index) => 1 + ((index * 7) % 5)));
  input.columns = Array.from({ length: 128 }, (_, index) => ({
    width: 20 + (index % 3),
    height: 100,
    obstacles: index < 3 ? [rectangle(6, 0, 10, 70)] : [],
  }));
  const iterator = wrappedParagraphFlowSteps(input),
    progress = [];
  let step;
  do {
    step = iterator.next();
    if (!step.done) progress.push(step.value);
  } while (!step.done);
  assert(progress.some((point) => point.stage === 'prepare'));
  assert(progress.some((point) => !point.stage));
  progress
    .filter((point) => point.stage === 'prepare')
    .forEach((point, index) => assert.equal(point.work, (index + 1) * 1024));
  progress
    .filter((point) => !point.stage)
    .forEach((point, index) => assert.equal(point.candidates, (index + 1) * 1024));
  assert.deepEqual(step.value, chooseWrappedParagraphFlow(input));
  assert.equal(step.value.status, 'fit');
});

test('larger admitted contours yield before each uncached geometry query', () => {
  const input = measuredWords([20]),
    polygon = Array.from({ length: 100 }, (_, index) => ({
      x: 200 + 20 * Math.cos((index * Math.PI) / 50),
      y: 200 + 20 * Math.sin((index * Math.PI) / 50),
    }));
  input.columns[0].obstacles = [
    {
      mode: 'contour',
      bounds: { left: 180, top: 180, right: 220, bottom: 220 },
      polygons: [polygon],
    },
  ];
  const steps = wrappedParagraphFlowSteps(input),
    first = steps.next();
  assert.equal(first.done, false);
  assert.equal(first.value.stage, 'geometry');
  const final = steps.next();
  assert.equal(final.done, true);
  assert.equal(final.value.status, 'fit');
  assert.deepEqual(final.value, chooseWrappedParagraphFlow(input));
});

test('malformed obstacle geometry and source data are rejected', () => {
  const input = measuredWords([3]);
  for (const override of [
    { columns: Array(1) },
    { opportunities: Array(2) },
    { measurements: [null] },
    { measurements: [{ ...input.measurements[0], advance: Infinity }] },
    { columns: [{ width: 30, height: 100, obstacles: [null] }] },
    {
      columns: [
        { width: 30, height: 100, obstacles: [rectangle(1, 0, 2, 30, { mode: 'unknown' })] },
      ],
    },
    {
      columns: [
        {
          width: 30,
          height: 100,
          obstacles: [
            rectangle(1, 0, 2, 30, {
              polygons: [
                [
                  { x: NaN, y: 0 },
                  { x: 2, y: 0 },
                  { x: 2, y: 30 },
                ],
              ],
            }),
          ],
        },
      ],
    },
    {
      columns: [
        { width: 30, height: 100, obstacles: [rectangle(1, 0, 2, 30, { polygons: Array(1) })] },
      ],
    },
    { layout: { firstLineIndent: -1 } },
    { maxCandidates: 0 },
    { maxStates: 0 },
  ])
    assert.throws(() => chooseWrappedParagraphFlow({ ...input, ...override }));
});
