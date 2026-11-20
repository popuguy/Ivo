import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseParagraphFlow, paragraphFlowSteps } from '../../src/domain/text/paragraph-flow.js';

function measurement(start, end, width, metrics = {}) {
  return {
    start,
    end,
    width,
    ascent: 10,
    descent: 3,
    advance: 14.4,
    capHeight: 7,
    xHeight: 5,
    leading: 0,
    ...metrics,
  };
}

function measuredWords(widths) {
  const opportunities = Array.from({ length: widths.length + 1 }, (_, index) => ({ index })),
    measurements = [];
  for (let start = 0; start < widths.length; start++) {
    let width = 0;
    for (let end = start + 1; end <= widths.length; end++) {
      width += widths[end - 1] + (end > start + 1 ? 1 : 0);
      measurements.push(measurement(start, end, width));
    }
  }
  return {
    start: 0,
    end: widths.length,
    opportunities,
    measurements,
    columns: [{ width: 6, height: 200 }],
  };
}

/** Deliberately exhaustive oracle: no solver imports, dynamic programming,
 * cursor merging, upper-bound pruning or measurement prefiltering. */
function exhaustive(input) {
  const style = {
      leftIndent: 0,
      firstLineIndent: 0,
      rightIndent: 0,
      paragraphBefore: 0,
      ...input.layout,
    },
    end = input.end,
    visit = (position, frame, baseline, cost) => {
      if (position === end) return cost;
      const nextMandatory =
          input.opportunities.find((point) => point.index > position && point.mandatory)?.index ??
          end,
        choices = input.measurements.filter(
          (row) => row.start === position && row.end <= nextMandatory,
        );
      for (let index = frame; index < input.columns.length; index++) {
        const column = input.columns[index],
          current = index === frame ? baseline : null,
          left = style.leftIndent + (position === input.start ? style.firstLineIndent : 0),
          area = column.width - left - style.rightIndent,
          fits = [];
        for (const row of choices) {
          let y;
          if (current === null) {
            const first = {
              ascent: row.ascent,
              'cap-height': row.capHeight,
              'x-height': row.xHeight,
              leading: row.advance,
              fixed: 0,
            }[column.firstBaseline ?? 'ascent'];
            y = Math.max(column.minimumFirstBaseline ?? 0, first);
          } else
            y =
              current +
              row.advance +
              (position === input.start ? (input.previousAfter ?? 0) + style.paragraphBefore : 0);
          if (area >= 1 && row.width <= area + 0.000001 && y + row.descent <= column.height)
            fits.push({ row, y });
        }
        // Fill the first column that accepts anything, even when another column
        // would allow a cheaper or longer line.
        if (fits.length)
          return Math.min(
            ...fits.map(({ row, y }) =>
              visit(
                row.end,
                index,
                y,
                cost +
                  1 +
                  (input.opportunities.find((point) => point.index === row.end).penalty ?? 0) +
                  (row.end === end ? 0 : 100 * ((area - row.width) / area) ** 2),
              ),
            ),
          );
      }
      return Infinity;
    };
  return visit(input.start, input.cursor?.frame ?? 0, input.cursor?.baseline ?? null, 0);
}

test('paragraph optimization improves on greedy composition without changing source metrics', () => {
  const input = measuredWords([3, 2, 2, 5]),
    before = structuredClone(input),
    greedy = chooseParagraphFlow({ ...input, mode: 'single-line' }),
    actual = chooseParagraphFlow(input);
  assert.equal(actual.status, 'fit');
  assert.deepEqual(
    greedy.lines.map((line) => line.end),
    [2, 3, 4],
  );
  assert.deepEqual(
    actual.lines.map((line) => line.end),
    [1, 3, 4],
  );
  assert(actual.cost < greedy.cost);
  assert.equal(actual.policy, 'ragged-right-quadratic-v1');
  assert(actual.lines.every((line) => line.naturalWidth <= line.width));
  assert.deepEqual(input, before);
});

test('a full narrow column can continue into a wider column instead of rejecting the paragraph', () => {
  const input = {
      start: 0,
      end: 2,
      opportunities: [{ index: 0 }, { index: 1 }, { index: 2 }],
      measurements: [measurement(0, 1, 5), measurement(1, 2, 100), measurement(0, 2, 110)],
      columns: [
        { width: 20, height: 13 },
        { width: 120, height: 60 },
      ],
    },
    result = chooseParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => [line.start, line.end, line.frame]),
    [
      [0, 1, 0],
      [1, 2, 1],
    ],
  );
  assert.deepEqual(result.cursor, { frame: 1, baseline: 10 });
});

test('a narrow first word skips unusable columns but cannot skip usable space for lower cost', () => {
  const input = measuredWords([8, 8]);
  input.columns = [
    { width: 4, height: 30 },
    { width: 10, height: 60 },
    { width: 100, height: 60 },
  ];
  const result = chooseParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => [line.end, line.frame]),
    [
      [1, 1],
      [2, 1],
    ],
  );
});

test('mixed metrics use a shorter fitting line before transitioning a tall alternative', () => {
  const input = {
      start: 0,
      end: 2,
      opportunities: [{ index: 0 }, { index: 1 }, { index: 2 }],
      measurements: [
        measurement(0, 1, 40, { advance: 5, descent: 2 }),
        measurement(0, 2, 80, { advance: 25, ascent: 20, descent: 5 }),
        measurement(1, 2, 40, { advance: 25, ascent: 20, descent: 5 }),
      ],
      columns: [
        { width: 120, height: 30 },
        { width: 120, height: 100 },
      ],
      cursor: { frame: 0, baseline: 10 },
    },
    actual = chooseParagraphFlow(input);
  assert.equal(actual.status, 'fit');
  assert.deepEqual(
    actual.lines.map((line) => [line.end, line.frame, line.baseline]),
    [
      [1, 0, 15],
      [2, 1, 20],
    ],
  );
});

test('first-line indent follows source position across columns, with paragraph spacing suppressed at top', () => {
  const input = {
      start: 5,
      end: 9,
      opportunities: [{ index: 5 }, { index: 7, mandatory: true }, { index: 9 }],
      measurements: [measurement(5, 7, 60), measurement(7, 9, 60)],
      columns: [
        { width: 100, height: 13 },
        { width: 100, height: 60 },
      ],
      layout: { leftIndent: 18, rightIndent: 12, firstLineIndent: -9, paragraphBefore: 7 },
      previousAfter: 11,
    },
    result = chooseParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => [line.frame, line.left, line.width, line.baseline]),
    [
      [0, 9, 79, 10],
      [1, 18, 70, 10],
    ],
  );
  const one = {
    ...input,
    end: 7,
    opportunities: input.opportunities.slice(0, 2),
    measurements: input.measurements.slice(0, 1),
    cursor: { frame: 0, baseline: 10 },
    columns: [{ width: 100, height: 60 }],
  };
  assert.equal(chooseParagraphFlow(one).lines[0].baseline, 42.4);
  assert.equal(
    chooseParagraphFlow({
      ...one,
      columns: [
        { width: 100, height: 40 },
        { width: 100, height: 60 },
      ],
    }).lines[0].baseline,
    10,
  );
});

test('each first-baseline policy uses the chosen native metrics and minimum offset', () => {
  const input = measuredWords([3]);
  for (const [firstBaseline, expected] of Object.entries({
    ascent: 10,
    'cap-height': 7,
    'x-height': 6,
    leading: 14.4,
    fixed: 6,
  })) {
    const result = chooseParagraphFlow({
      ...input,
      columns: [{ width: 30, height: 60, firstBaseline, minimumFirstBaseline: 6 }],
    });
    assert.equal(result.lines[0].baseline, expected, firstBaseline);
  }
});

test('mandatory breaks, penalties, exact width and zero-width blank paragraphs are preserved', () => {
  const input = measuredWords([3, 2, 2, 5]);
  input.opportunities[1].mandatory = true;
  input.opportunities[3].penalty = 17;
  const result = chooseParagraphFlow(input);
  assert.deepEqual(
    result.lines.map((line) => line.end),
    [1, 3, 4],
  );
  assert.equal(result.lines[1].penalty, 17);
  assert.equal(result.lines.at(-1).cost, 1, 'The final line has no slack penalty');
  const blank = chooseParagraphFlow({
    start: 0,
    end: 1,
    opportunities: [{ index: 0 }, { index: 1 }],
    measurements: [measurement(0, 1, 0)],
    columns: [{ width: 1, height: 13 }],
  });
  assert.equal(blank.status, 'fit');
  assert.equal(blank.lines[0].naturalWidth, 0);
});

test('different baseline histories survive even when the cheaper earlier path becomes infeasible', () => {
  const input = {
      start: 0,
      end: 3,
      opportunities: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }],
      measurements: [
        measurement(0, 2, 10, { ascent: 10, descent: 0, advance: 10 }),
        measurement(0, 1, 8, { ascent: 2, descent: 0, advance: 2 }),
        measurement(1, 2, 8, { ascent: 2, descent: 0, advance: 2 }),
        measurement(2, 3, 8, { ascent: 2, descent: 0, advance: 4 }),
      ],
      columns: [{ width: 10, height: 11 }],
    },
    result = chooseParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => line.end),
    [1, 2, 3],
  );
  assert.equal(result.cursor.baseline, 8);
});

test('a lower and cheaper cursor does not dominate one that reaches a wider column sooner', () => {
  const input = {
      start: 0,
      end: 4,
      opportunities: Array.from({ length: 5 }, (_, index) => ({ index })),
      measurements: [
        measurement(0, 2, 10, { ascent: 2, descent: 0, advance: 2 }),
        measurement(0, 1, 9, { ascent: 4, descent: 0, advance: 4 }),
        measurement(1, 2, 9, { ascent: 4, descent: 0, advance: 4 }),
        measurement(2, 3, 1, { ascent: 4, descent: 0, advance: 4 }),
        measurement(2, 4, 100, { ascent: 4, descent: 0, advance: 4 }),
        measurement(3, 4, 1, { ascent: 4, descent: 0, advance: 4 }),
      ],
      columns: [
        { width: 10, height: 10 },
        { width: 100, height: 100 },
      ],
    },
    result = chooseParagraphFlow(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => [line.end, line.frame]),
    [
      [1, 0],
      [2, 0],
      [4, 1],
    ],
  );
  assert(Math.abs(result.cost - 5) < 1e-9);
  assert.equal(result.cost, exhaustive(input));
});

test('all feasible tiny paths agree with an independent exhaustive geometry oracle', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const input = measuredWords(
      Array.from({ length: 5 }, (_, index) => 1 + ((seed * 7 + index * 3) % 5)),
    );
    input.columns = Array.from({ length: 4 }, (_, index) => ({
      width: 5 + ((seed + index * 3) % 8),
      height: 10 + ((seed * 3 + index * 7) % 34),
      firstBaseline: ['ascent', 'cap-height', 'x-height', 'leading', 'fixed'][(seed + index) % 5],
      minimumFirstBaseline: seed % 4,
    }));
    input.layout = {
      leftIndent: seed % 2,
      firstLineIndent: seed % 3,
      rightIndent: seed % 2,
      paragraphBefore: seed % 4,
    };
    input.previousAfter = seed % 3;
    input.cursor = { frame: 0, baseline: seed % 2 ? null : 6 };
    for (const row of input.measurements) {
      const mixed = (seed * 11 + row.start * 3 + row.end * 7) % 9;
      Object.assign(row, {
        ascent: 4 + mixed,
        descent: mixed % 4,
        advance: 6 + mixed,
        capHeight: 3 + mixed,
        xHeight: 2 + mixed,
        leading: mixed % 3,
      });
    }
    if (seed % 3 === 0) input.opportunities[2].mandatory = true;
    input.opportunities[3].penalty = seed % 5;
    const original = structuredClone(input),
      expected = exhaustive(input),
      actual = chooseParagraphFlow(input),
      reversed = chooseParagraphFlow({ ...input, measurements: [...input.measurements].reverse() });
    assert.equal(actual.status, Number.isFinite(expected) ? 'fit' : 'unfit', `Seed ${seed}`);
    if (Number.isFinite(expected)) assert(Math.abs(actual.cost - expected) < 1e-9, `Seed ${seed}`);
    assert.deepEqual(actual, reversed, `Arrival order changed seed ${seed}`);
    assert.deepEqual(input, original, `Source mutated in seed ${seed}`);
  }
});

test('infeasible geometry and exhausted work budgets report explicit failure with no fallback', () => {
  const input = measuredWords([3, 2, 2, 5]);
  assert.equal(
    chooseParagraphFlow({ ...input, columns: [{ width: 1, height: 60 }] }).reason,
    'no-feasible-path',
  );
  assert.equal(
    chooseParagraphFlow({ ...input, cursor: { frame: 1, baseline: null } }).status,
    'unfit',
  );
  assert.equal(chooseParagraphFlow({ ...input, maxCandidates: 1 }).reason, 'candidate-budget');
  assert.equal(chooseParagraphFlow({ ...input, maxStates: 1 }).reason, 'state-budget');
  assert.equal(
    chooseParagraphFlow({ ...input, columns: [{ width: 6, height: 13 }], mode: 'single-line' })
      .reason,
    'no-feasible-line',
  );
  const wide = measurement(0, 4, 1000);
  assert.equal(
    chooseParagraphFlow({ ...input, measurements: [wide], maxCandidates: 1 }).reason,
    'no-feasible-path',
  );
  assert.equal(
    chooseParagraphFlow({ ...input, measurements: [wide], maxCandidates: 1 }).candidates,
    0,
    'Globally too-wide edges are prefiltered',
  );
});

test('cooperative search yields bounded progress and returns exactly the synchronous result', () => {
  const input = measuredWords(Array(160).fill(3));
  input.columns = Array.from({ length: 128 }, (_, index) => ({
    width: 20 + (index % 3),
    height: 100,
  }));
  for (const row of input.measurements) row.advance += (row.start % 3) * 0.1;
  const steps = paragraphFlowSteps(input),
    checkpoints = [];
  let step;
  do {
    step = steps.next();
    if (!step.done) checkpoints.push(step.value);
  } while (!step.done);
  assert(checkpoints.length > 0);
  checkpoints
    .filter((point) => !point.stage)
    .forEach((point, index) => assert.equal(point.candidates, (index + 1) * 1024));
  const preparation = checkpoints.filter((point) => point.stage === 'prepare');
  assert.equal(preparation.length, Math.floor(input.measurements.length / 1024));
  preparation.forEach((point, index) => assert.equal(point.measurements, (index + 1) * 1024));
  assert.deepEqual(step.value, chooseParagraphFlow(input));
  const limited = paragraphFlowSteps({ ...input, maxCandidates: 1100 });
  let firstSearch;
  do firstSearch = limited.next();
  while (!firstSearch.done && firstSearch.value.stage === 'prepare');
  assert.equal(firstSearch.value.candidates, 1024);
  assert.deepEqual(limited.next().value, chooseParagraphFlow({ ...input, maxCandidates: 1100 }));
});

test('invalid metrics, columns, opportunity ranges and unsupported geometry are rejected', () => {
  const input = measuredWords([3, 2]);
  for (const override of [
    { end: 0 },
    { columns: [] },
    { columns: Array(2) },
    { columns: [{ width: Infinity, height: 60 }] },
    { columns: [{ width: 30, height: 60, firstBaseline: 'unknown' }] },
    { opportunities: Array(2) },
    { opportunities: [{ index: 0 }, { index: 2 }, { index: 1 }] },
    { opportunities: [{ index: 1 }, { index: 2 }] },
    { measurements: [null] },
    { measurements: [{ ...input.measurements[0], advance: NaN }] },
    { measurements: [{ ...input.measurements[0], capHeight: undefined }] },
    { measurements: [...input.measurements, input.measurements[0]] },
    { layout: { leftIndent: -1 } },
    { layout: { firstLineIndent: -1 } },
    { layout: { rightIndent: -1 } },
    { cursor: { frame: -1, baseline: null } },
    { maxStates: 0 },
    { maxCandidates: 0 },
  ])
    assert.throws(() => chooseParagraphFlow({ ...input, ...override }));
});

test('ragged single-line hyphenation zone protects whole words within half an inch', () => {
  const options = measuredWords([60, 20, 50]);
  options.opportunities[2].automatic = true;
  const first = (width, align = 'left') =>
    chooseParagraphFlow({
      ...options,
      columns: [{ width, height: 120 }],
      mode: 'single-line',
      layout: { align },
    }).lines[0].end;
  assert.equal(first(96), 1);
  assert.equal(first(97), 2);
  assert.equal(first(96, 'justify'), 2);
  assert.equal(first(160), 3);
});
