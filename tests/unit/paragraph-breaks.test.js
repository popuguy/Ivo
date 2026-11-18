import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseParagraphBreaks } from '../../src/domain/text/paragraph-breaks.js';

function measuredWords(widths) {
  const opportunities = Array.from({ length: widths.length + 1 }, (_, index) => ({ index })),
    measurements = [];
  for (let start = 0; start < widths.length; start++) {
    let width = 0;
    for (let end = start + 1; end <= widths.length; end++) {
      width += widths[end - 1] + (end > start + 1 ? 1 : 0);
      measurements.push({ start, end, width });
    }
  }
  return {
    start: 0,
    end: widths.length,
    opportunities,
    measurements,
    lineWidths: Array(widths.length).fill(6),
  };
}
test('whole-paragraph decisions can revise an earlier greedy break with lower explicit cost', () => {
  const input = measuredWords([3, 2, 2, 5]),
    before = JSON.stringify(input),
    greedy = chooseParagraphBreaks({ ...input, mode: 'single-line' }),
    optimal = chooseParagraphBreaks(input);
  assert.deepEqual(
    greedy.lines.map((l) => l.end),
    [2, 3, 4],
  );
  assert.deepEqual(
    optimal.lines.map((l) => l.end),
    [1, 3, 4],
  );
  assert(optimal.cost < greedy.cost);
  assert.equal(JSON.stringify(input), before, 'Composition changed source measurement input');
  assert(optimal.lines.every((l) => l.width <= l.available));
});
test('unequal line slots, mandatory breaks and penalties remain inspectable decisions', () => {
  const input = measuredWords([3, 2, 2, 5]);
  input.lineWidths = [3, 5, 5];
  input.opportunities[1].mandatory = true;
  const result = chooseParagraphBreaks(input);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((l) => [l.end, l.available]),
    [
      [1, 3],
      [3, 5],
      [4, 5],
    ],
  );
  input.opportunities[3].penalty = 17;
  const penalized = chooseParagraphBreaks(input);
  assert.equal(penalized.lines[1].penalty, 17);
  assert.equal(penalized.cost, result.cost + 17);
});
test('unfit and bounded-work outcomes never silently substitute another policy or omit source', () => {
  const input = measuredWords([3, 2, 2, 5]);
  assert.equal(chooseParagraphBreaks({ ...input, lineWidths: [1] }).status, 'unfit');
  assert.equal(chooseParagraphBreaks({ ...input, maxCandidates: 1 }).reason, 'candidate-budget');
  assert.equal(chooseParagraphBreaks({ ...input, maxStates: 1 }).reason, 'state-budget');
  assert.equal(
    chooseParagraphBreaks({ ...input, mode: 'single-line', lineWidths: [6] }).reason,
    'insufficient-lines',
  );
  assert.throws(() => chooseParagraphBreaks({ ...input, lineWidths: [Infinity] }), /Invalid/);
  assert.throws(() => chooseParagraphBreaks({ ...input, lineWidths: Array(2) }), /Invalid/);
  assert.throws(() => chooseParagraphBreaks({ ...input, opportunities: Array(2) }), /Invalid/);
  assert.throws(() => chooseParagraphBreaks({ ...input, measurements: [null] }), /Invalid/);
  assert.throws(
    () =>
      chooseParagraphBreaks({
        ...input,
        measurements: [...input.measurements, input.measurements[0]],
      }),
    /duplicate/,
  );
  assert.throws(
    () =>
      chooseParagraphBreaks({
        ...input,
        opportunities: [{ index: 0 }, { index: 2 }, { index: 1 }, { index: 4 }],
      }),
    /opportunities/,
  );
});
test('paragraph optimum agrees with exhaustive feasible paths and ignores measurement arrival order', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const widths = Array.from({ length: 5 }, (_, i) => 1 + ((seed * 7 + i * 3) % 5)),
      input = measuredWords(widths);
    input.lineWidths = [6, 8, 5, 7, 6];
    const visit = (start, line, cost) => {
      if (start === input.end) return cost;
      if (line === input.lineWidths.length) return Infinity;
      return Math.min(
        ...input.measurements
          .filter((m) => m.start === start && m.width <= input.lineWidths[line])
          .map((m) =>
            visit(
              m.end,
              line + 1,
              cost +
                1 +
                (m.end === input.end
                  ? 0
                  : 100 * ((input.lineWidths[line] - m.width) / input.lineWidths[line]) ** 2),
            ),
          ),
      );
    };
    const expected = visit(0, 0, 0),
      actual = chooseParagraphBreaks(input),
      reversed = chooseParagraphBreaks({
        ...input,
        measurements: [...input.measurements].reverse(),
      });
    assert.equal(actual.status, Number.isFinite(expected) ? 'fit' : 'unfit');
    if (Number.isFinite(expected)) assert(Math.abs(actual.cost - expected) < 1e-9);
    assert.deepEqual(actual, reversed);
  }
});
