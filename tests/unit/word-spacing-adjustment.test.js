import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustWordSpacing,
  normalizeWordSpacingPolicy,
  wordSpacingMeasurement,
} from '../../src/domain/text/word-spacing-adjustment.js';
import { chooseWrappedParagraphFlow } from '../../src/domain/text/wrapped-paragraph-flow.js';
import { chooseParagraphFlow, paragraphFlowSteps } from '../../src/domain/text/paragraph-flow.js';
import { createParagraphComposer } from '../../src/rendering/text/paragraph-composition.js';

const policy = Object.freeze({ minimum: 80, desired: 100, maximum: 133 });
const metrics = { ascent: 8, descent: 2, advance: 12, capHeight: 7, xHeight: 4, leading: 0 };
const columns = [{ width: 100, height: 100, firstBaseline: 'fixed', minimumFirstBaseline: 8 }];
function row(start, end, width, nominal, settings = policy, extra = {}) {
  return {
    start,
    end,
    width,
    ...metrics,
    wordSpacing: {
      minimumWidth: width + nominal * (settings.minimum / 100 - 1),
      desiredWidth: width + nominal * (settings.desired / 100 - 1),
      maximumWidth: width + nominal * (settings.maximum / 100 - 1),
      eligibleGaps: nominal ? 1 : 0,
      nominalSpaceWidth: nominal,
    },
    ...extra,
  };
}
const input = (end, measurements, extra = {}) => ({
  start: 0,
  end,
  opportunities: Array.from({ length: end + 1 }, (_, index) => ({
    index,
    mandatory: index === end,
  })),
  measurements,
  columns,
  layout: { align: 'justify' },
  wordSpacing: policy,
  ...extra,
});

// The scalar fixtures are exact provider rows, not platform font simulations.
test('nonfinal justification can cross both soft bounds while keeping finite costs and exact struts', () => {
  const request = input(2, [row(0, 1, 125, 40), row(1, 2, 40, 0)]);
  const before = JSON.stringify(request),
    result = chooseParagraphFlow(request);
  assert.equal(result.status, 'fit');
  assert.deepEqual(
    result.lines.map((line) => line.end),
    [1, 2],
  );
  assert.equal(result.lines[0].naturalWidth, 125);
  assert.equal(result.lines[0].wordSpacing.visibleWidth, 100);
  assert.equal(result.lines[0].ascent, 8);
  assert.equal(result.lines[0].baseline, 8);
  assert.equal(result.wordSpacingDiagnostics[0].kind, 'word-spacing-outside-minimum');
  assert.equal(result.wordSpacingDiagnostics[0].amount, 17);
  assert.equal(JSON.stringify(request), before);
  const fixed = { minimum: 100, desired: 100, maximum: 100 };
  const expanded = chooseParagraphFlow(
    input(1, [row(0, 1, 50, 20, fixed)], {
      wordSpacing: fixed,
      layout: { align: 'justify-all' },
    }),
  );
  assert.equal(expanded.lines[0].wordSpacing.ratio, null);
  assert.equal(expanded.lines[0].wordSpacing.badness, 10000);
  assert.equal(expanded.lines[0].wordSpacing.percentage, 350);
  assert.ok(Number.isFinite(expanded.cost));
  assert.equal(
    JSON.parse(JSON.stringify(expanded)).wordSpacingDiagnostics[0].kind,
    'word-spacing-outside-maximum',
  );
});

test('ordinary ragged, justified final, full justification and soft-return rows have distinct observed policies', () => {
  const minimumZero = { minimum: 0, desired: 100, maximum: 133 };
  const measured = row(0, 1, 52, 6, minimumZero);
  const base = input(1, [measured], {
    columns: [{ ...columns[0], width: 50 }],
    wordSpacing: minimumZero,
  });
  const final = chooseParagraphFlow(base);
  assert.equal(final.status, 'fit');
  assert.equal(final.lines[0].wordSpacing.visibleWidth, 50);
  assert.equal(chooseParagraphFlow({ ...base, layout: { align: 'left' } }).status, 'unfit');
  assert.equal(
    chooseParagraphFlow({ ...base, measurements: [row(0, 1, 52, 6)], wordSpacing: policy }).status,
    'unfit',
  );
  for (const align of ['justify', 'justify-center', 'justify-right']) {
    const result = chooseParagraphFlow(
      input(2, [row(0, 1, 50, 10), row(1, 2, 50, 10)], {
        layout: { align },
        opportunities: [{ index: 0 }, { index: 1, mandatory: true }, { index: 2, mandatory: true }],
      }),
    );
    assert.deepEqual(
      result.lines.map((line) => line.wordSpacing.visibleWidth),
      [100, 50],
    );
  }
});

test('zero-gap native fallback has the same worst finite badness as word-space adjustment', () => {
  const result = chooseParagraphFlow(
    input(1, [row(0, 1, 40, 0)], { layout: { align: 'justify-all' } }),
  );
  assert.equal(result.status, 'fit');
  assert.equal(result.cost, 10001);
  assert.equal(result.wordSpacingDiagnostics[0].kind, 'native-no-gap-justification');
  assert.equal(result.wordSpacingDiagnostics[0].amount, 60);
  assert.equal(result.lines[0].wordSpacing.visibleWidth, 100);
  assert.equal(result.lines[0].wordSpacing.scoreWidth, 40);
  const desired = { minimum: 100, desired: 200, maximum: 300 };
  const noGap = chooseParagraphFlow(
    input(1, [row(0, 1, 40, 0, desired)], {
      wordSpacing: desired,
      layout: { align: 'justify-all' },
    }),
  );
  assert.equal(noGap.lines[0].wordSpacing.percentage, 200);
  assert.equal(noGap.lines[0].wordSpacing.fallback, 'single-word');
  const blank = chooseParagraphFlow(
    input(1, [row(0, 1, 0, 0)], { layout: { align: 'justify-all' } }),
  );
  assert.deepEqual(blank.wordSpacingDiagnostics, []);
  assert.equal(blank.lines[0].wordSpacing.visibleWidth, 0);
  assert.equal(blank.lines[0].wordSpacing.fallback, null);
  assert.equal(
    chooseParagraphFlow(input(1, [row(0, 1, 120, 0)], { layout: { align: 'justify-all' } })).status,
    'unfit',
  );
});

test('missing policy preserves every old score/result field and source-first indent across columns', () => {
  const request = input(2, [row(0, 1, 60, 10), row(0, 2, 130, 20), row(1, 2, 60, 0)], {
    wordSpacing: undefined,
    layout: { leftIndent: 3, firstLineIndent: 7 },
    columns: [
      { ...columns[0], width: 100, height: 10 },
      { ...columns[0], width: 120 },
    ],
  });
  const result = chooseParagraphFlow(request);
  assert.equal(result.policy, 'ragged-right-quadratic-v1');
  assert.equal(result.cost, 2 + 100 * (30 / 90) ** 2);
  assert.deepEqual(
    result.lines.map(({ frame, left }) => ({ frame, left })),
    [
      { frame: 0, left: 10 },
      { frame: 1, left: 3 },
    ],
  );
  assert.equal(Object.hasOwn(result, 'wordSpacingDiagnostics'), false);
  assert.ok(result.lines.every((line) => !Object.hasOwn(line, 'wordSpacing')));
});

test('native capacities must exactly match the authored triple and cannot silently substitute source widths', () => {
  const measured = row(0, 2, 100, 20);
  assert.deepEqual(wordSpacingMeasurement(measured, policy), measured.wordSpacing);
  const wrong = structuredClone(measured);
  wrong.wordSpacing.desiredWidth++;
  assert.throws(() => wordSpacingMeasurement(wrong, policy), /source percentages/);
  for (const mutation of [
    (r) => {
      r.wordSpacing.eligibleGaps = 3;
    },
    (r) => {
      r.wordSpacing.nominalSpaceWidth = 0;
    },
    (r) => {
      r.wordSpacing.extra = 1;
    },
    (r) => {
      r.wordSpacing.minimumWidth = -1;
    },
  ]) {
    const invalid = structuredClone(measured);
    mutation(invalid);
    assert.throws(() => wordSpacingMeasurement(invalid, policy), /capacities/);
  }
  assert.throws(() => normalizeWordSpacingPolicy({ ...policy, unknown: 1 }), /percentages/);
  assert.equal(normalizeWordSpacingPolicy(), null);
  assert.equal(adjustWordSpacing(measured, 10, 'justify', false), null);
  assert.throws(
    () => adjustWordSpacing(row(0, 1, 1, Number.MIN_VALUE), 100, 'justify-all', true),
    /finite adjustment budget/,
  );
});

// Independent exhaustive enumeration uses only the specified affine measurements
// and scalar objective, without planner preparation, state maps or cache logic.
function exhaustive(request) {
  let best = Infinity;
  function visit(position, frame, baseline, cost) {
    if (position === request.end) {
      best = Math.min(best, cost);
      return;
    }
    for (let f = frame; f < request.columns.length; f++) {
      const col = request.columns[f],
        feasible = [];
      for (const r of request.measurements) {
        if (r.start !== position) continue;
        const final = r.end === request.end,
          w = col.width,
          capacity = r.wordSpacing;
        const floor = final ? capacity.minimumWidth : r.width - capacity.nominalSpaceWidth;
        const y =
          f === frame && baseline !== null ? baseline + r.advance : col.minimumFirstBaseline;
        if (floor > w + 1e-6 || y + r.descent > col.height) continue;
        const target = final ? Math.min(capacity.desiredWidth, w) : w;
        const delta = target - capacity.desiredWidth;
        const range =
          delta < 0
            ? capacity.desiredWidth - capacity.minimumWidth
            : capacity.maximumWidth - capacity.desiredWidth;
        const ratio = delta === 0 ? 0 : range > 1e-6 ? delta / range : null;
        const score =
          final && delta === 0
            ? 0
            : ratio === null
              ? 10000
              : Math.min(10000, 100 * Math.abs(ratio) ** 3);
        feasible.push([r, y, 1 + score]);
      }
      if (feasible.length) {
        for (const [r, y, add] of feasible) visit(r.end, f, y, cost + add);
        return;
      }
    }
  }
  visit(0, 0, null, 0);
  return best;
}

test('150 mixed-metric unequal-column plans agree with an independent exhaustive finite-ratio oracle', () => {
  let seed = 391;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let example = 0; example < 150; example++) {
    const rows = [];
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b <= 4; b++)
        rows.push(
          row(a, b, 25 + Math.floor(random() * 90), 20, policy, {
            advance: 8 + Math.floor(random() * 8),
          }),
        );
    const request = input(4, rows, {
      columns: [
        { ...columns[0], width: 40, height: 28 },
        { ...columns[0], width: 70, height: 38 },
        { ...columns[0], width: 100, height: 60 },
      ],
    });
    const expected = exhaustive(request),
      result = chooseParagraphFlow(request);
    assert.equal(result.status, Number.isFinite(expected) ? 'fit' : 'unfit');
    if (result.status === 'fit') assert.ok(Math.abs(result.cost - expected) < 1e-8);
  }
});

function requestFor(text, settings = [policy]) {
  let start = 0;
  const paragraphs = [...text.matchAll(/[^\u2029]*\u2029|[^\u2029]+$/g)].map((match, index) => {
    const p = {
      start,
      end: start + match[0].length,
      align: 'justify',
      ...(settings[index] ? { wordSpacing: settings[index] } : {}),
    };
    start = p.end;
    return p;
  });
  return {
    protocol: 5,
    text,
    sourceDigest: text + JSON.stringify(settings),
    paragraphs,
    runs: [{ start: 0, end: text.length, font: 'owned', size: 16, tracking: 0 }],
    resources: [{ id: 'owned', identity: 'fixture' }],
  };
}
function measuredBackend() {
  const calls = [];
  const measure = async (request) => {
    calls.push(structuredClone(request));
    return {
      sourceDigest: request.sourceDigest,
      measurements: request.candidates.map((candidate) => {
        const content = request.text
          .slice(candidate.start, candidate.end)
          .replace(/[ \r\n\u2028\u2029]+$/g, '');
        const nominal = (content.match(/ /g) || []).length * 10;
        const natural = (content.match(/[^ ]/g) || []).length * 12 + nominal;
        const paragraph = request.paragraphs.find(
          (p) => p.start <= candidate.start && p.end >= candidate.end,
        );
        const measured = { ...candidate, width: natural, ...metrics };
        if (paragraph.wordSpacing)
          measured.wordSpacing = {
            ...row(candidate.start, candidate.end, natural, nominal, paragraph.wordSpacing)
              .wordSpacing,
            eligibleGaps: nominal / 10,
          };
        return measured;
      }),
    };
  };
  return { measure, calls };
}

test('cold/warm policy changes invalidate only affected capacities and preserve native/source boundaries', async () => {
  const backend = measuredBackend(),
    composer = createParagraphComposer(backend.measure);
  const source = requestFor('AA BB CC\u2029DD EE FF', [policy, policy]),
    before = JSON.stringify(source);
  const geometry = [{ ...columns[0], width: 80 }];
  const cold = await composer.compose(source, geometry),
    warm = await composer.compose(source, geometry);
  assert.equal(warm.work.backendCalls, 0);
  assert.deepEqual(warm.placements, cold.placements);
  assert.deepEqual(warm.wordSpacingDiagnostics, cold.wordSpacingDiagnostics);
  assert.equal(warm.work.states, cold.work.states);
  assert.equal(warm.work.candidates, cold.work.candidates);
  const changed = requestFor(source.text, [{ minimum: 0, desired: 100, maximum: 133 }, policy]);
  const next = await composer.compose(changed, geometry);
  assert.equal(next.work.measuredParagraphs, 1);
  assert.equal(next.work.reusedParagraphs, 1);
  assert.deepEqual(
    next.placements,
    (await createParagraphComposer(backend.measure).compose(changed, geometry)).placements,
  );
  assert.ok(
    backend.calls.every(
      (call) => call.mode === 'measure-lines-proof' && !Object.hasOwn(call, 'paragraphKeeps'),
    ),
  );
  assert.equal(JSON.stringify(source), before);
  await assert.rejects(
    composer.compose(source, geometry, {
      limits: { candidates: Math.max(1, cold.work.candidates - 1) },
    }),
    /budget/,
  );
  assert.deepEqual((await composer.compose(source, geometry)).placements, cold.placements);
});

test('All probes and future overset retain capacities, exact source diagnostics and warm budget charges', async () => {
  const backend = measuredBackend(),
    composer = createParagraphComposer(backend.measure);
  const source = requestFor('PRE\u2029AA BB\u2028CC DD\u2028EE FF\u2029TAIL', [null, policy, null]);
  const geometry = [
    { ...columns[0], width: 80, height: 26 },
    { ...columns[0], width: 90, height: 42 },
  ];
  const options = { paragraphKeeps: [{}, { keepTogether: true }, {}] };
  const result = await composer.compose(source, geometry, options),
    warm = await composer.compose(source, geometry, options);
  assert.deepEqual(
    result.placements.map((line) => line.frame),
    [0, 1, 1, 1, 2],
  );
  assert.ok(result.work.keepProbes > 0);
  assert.equal(warm.work.candidates, result.work.candidates);
  assert.deepEqual(warm.placements, result.placements);
  assert.deepEqual(warm.wordSpacingPlan, result.wordSpacingPlan);
  assert.equal(result.wordSpacingPlan.length, result.placements.length);
  assert.deepEqual(
    result.wordSpacingPlan.map((p) => p?.visibleWidth ?? null),
    [null, 90, 90, 58, null],
  );
  assert.deepEqual(
    result.wordSpacingPlan.map((p) => p?.justified ?? null),
    [null, true, true, false, null],
  );
  assert.equal(result.wordSpacingPlan[1].start, source.paragraphs[1].start);
  assert.equal(result.wordSpacingPlan[3].end, source.paragraphs[1].end);
  assert.ok(
    result.wordSpacingDiagnostics.every(
      (d) => d.start >= source.paragraphs[1].start && d.end <= source.paragraphs[1].end,
    ),
  );
  assert.deepEqual(result.keepViolations, []);
});

test('unqualified source/profile combinations reject before backend I/O and malformed batches cannot poison caches', async () => {
  const backend = measuredBackend(),
    composer = createParagraphComposer(backend.measure);
  const source = requestFor('AA BB');
  for (const invalid of [
    { ...source, protocol: 4 },
    { ...source, runs: [{ ...source.runs[0], tracking: -1 }] },
    requestFor('AA\tBB'),
    requestFor('AA\u2009BB'),
    { ...source, paragraphs: [{ ...source.paragraphs[0], wordSpacing: null }] },
  ])
    await assert.rejects(composer.compose(invalid, columns));
  assert.equal(backend.calls.length, 0);
  let invalidBatch = true;
  const retrying = createParagraphComposer(async (request) => {
    const result = await backend.measure(request);
    if (invalidBatch) {
      invalidBatch = false;
      result.measurements.find((r) => r.wordSpacing.eligibleGaps > 0).wordSpacing.desiredWidth++;
    }
    return result;
  });
  await assert.rejects(retrying.compose(source, columns), /source percentages/);
  assert.equal((await retrying.compose(source, columns)).work.measuredParagraphs, 1);
});

test('cooperative preparation/search is deterministic and explicit work limits never substitute old-width fitting', () => {
  const rows = [];
  for (let a = 0; a < 50; a++)
    for (let b = a + 1; b <= 50; b++) rows.push(row(a, b, 25 + (b - a) * 5, 20));
  const request = input(50, rows),
    steps = paragraphFlowSteps(request);
  let yields = 0,
    step;
  do {
    step = steps.next();
    if (!step.done) yields++;
  } while (!step.done);
  assert.ok(yields > 0);
  assert.deepEqual(step.value, chooseParagraphFlow(request));
  assert.equal(chooseParagraphFlow({ ...request, maxCandidates: 1 }).reason, 'candidate-budget');
  assert.equal(chooseParagraphFlow({ ...request, maxStates: 1 }).reason, 'state-budget');
});

test('local options cannot override authored spacing and policy-cache eviction remains bounded', async () => {
  const backend = measuredBackend(),
    composer = createParagraphComposer(backend.measure);
  const source = requestFor('AA BB');
  for (const options of [
    { wordSpacing: { ...policy, desired: 120 } },
    { alternatePolicy: true },
    null,
    [],
  ])
    await assert.rejects(composer.compose(source, columns, options), /composition options/);
  assert.equal(backend.calls.length, 0);
  const original = await composer.compose(source, columns);
  for (let minimum = 0; minimum < 70; minimum++) {
    const result = await composer.compose(
      requestFor(source.text, [{ ...policy, minimum }]),
      columns,
    );
    assert.ok(result.work.cacheEntries <= 64);
    assert.ok(result.work.cacheBytes <= 8000000);
  }
  const restored = await composer.compose(source, columns);
  assert.equal(restored.work.measuredParagraphs, 1);
  assert.deepEqual(restored.placements, original.placements);
  assert.deepEqual(restored.wordSpacingPlan, original.wordSpacingPlan);
});

test('a heavily expanded soft-return row is preferred over manufacturing letter-spread single-word rows', async () => {
  const backend = measuredBackend(),
    source = requestFor('  Full alpha beta  \u2028Final gamma delta  ');
  const result = await createParagraphComposer(backend.measure).compose(source, [
    { ...columns[0], width: 300, height: 100 },
  ]);
  assert.deepEqual(result.breaks, [source.text.indexOf('\u2028') + 1, source.text.length]);
  assert.equal(result.wordSpacingPlan[0].fallback, null);
  assert.equal(result.wordSpacingPlan[0].justified, true);
  assert.ok(result.wordSpacingPlan[0].percentage > policy.maximum);
  assert.equal(result.wordSpacingPlan[1].justified, false);
  assert.equal(result.wordSpacingPlan[1].percentage, policy.desired);
  const normal = requestFor(source.text, [null]);
  const legacy = await createParagraphComposer(backend.measure).compose(normal, [
    { ...columns[0], width: 300, height: 100 },
  ]);
  assert.equal(legacy.policy, 'ragged-right-quadratic-v1');
  assert.equal(Object.hasOwn(legacy, 'wordSpacingPlan'), false);
});

test('wrap fits custom spacing against each side of an object and honors a single-line minimum when possible', () => {
  const blocker = {
    mode: 'bounds',
    side: 'both',
    bounds: { left: 40, top: 0, right: 67, bottom: 30 },
    polygons: [
      [
        { x: 40, y: 0 },
        { x: 67, y: 0 },
        { x: 67, y: 30 },
        { x: 40, y: 30 },
      ],
    ],
  };
  const base = input(
    3,
    [row(0, 1, 38, 10), row(0, 2, 44, 10), row(1, 2, 28, 10), row(1, 3, 40, 10), row(2, 3, 28, 10)],
    {
      columns: [{ ...columns[0], obstacles: [blocker] }],
      mode: 'single-line',
      layout: { align: 'justify-all' },
    },
  );
  const fit = chooseWrappedParagraphFlow(base);
  assert.equal(fit.status, 'fit');
  assert.deepEqual(
    fit.lines.slice(0, 2).map((l) => [l.end, l.left, l.wordSpacing.visibleWidth]),
    [
      [1, 0, 40],
      [2, 67, 33],
    ],
  );
  assert.equal(fit.lines[0].baseline, fit.lines[1].baseline);
  const forced = chooseWrappedParagraphFlow({
    ...base,
    measurements: base.measurements.filter((r) => r.start !== 0 || r.end === 2),
  });
  assert.equal(forced.lines[0].end, 2);
  assert.equal(forced.lines[0].wordSpacing.diagnostic.kind, 'word-spacing-outside-minimum');
  assert.equal(forced.lines[0].wordSpacing.visibleWidth, 40);
});

test('nine-field fitting first uses ordinary spaces, then shares expansion with letter and glyph room', () => {
  const settings = {
    minimum: 80,
    desired: 100,
    maximum: 125,
    letterMinimum: -5,
    letterDesired: 0,
    letterMaximum: 12,
    glyphMinimum: 96,
    glyphDesired: 100,
    glyphMaximum: 104,
  };
  const measurement = {
    ...row(0, 11, 56, 8),
    wordSpacing: {
      nominalSpaceWidth: 8,
      eligibleGaps: 3,
      letterBasis: 27,
      minimumWidth: (56 - 1.6 - 1.35) * 0.96,
      desiredWidth: 56,
      maximumWidth: (56 + 2 + 3.24) * 1.04,
      physicalMinimum: (56 - 8 - 1.35) * 0.96,
    },
  };
  assert.deepEqual(wordSpacingMeasurement(measurement, settings), measurement.wordSpacing);
  assert.throws(
    () =>
      wordSpacingMeasurement(
        { ...measurement, wordSpacing: { ...measurement.wordSpacing, physicalMinimum: 1 } },
        settings,
      ),
    /physical minimum/,
  );
  const minor = adjustWordSpacing(measurement, 57, 'justify', false, settings);
  assert.equal(minor.percentage, 112.5);
  assert.equal(minor.letterPercentage, 0);
  assert.equal(minor.glyphPercentage, 100);
  const larger = adjustWordSpacing(measurement, 61, 'justify', false, settings);
  assert.ok(larger.letterPercentage > 0 && larger.letterPercentage < 12);
  assert.ok(larger.glyphPercentage > 100 && larger.glyphPercentage < 104);
  assert.ok(Math.abs(larger.visibleWidth - 61) < 1e-8);
  const final = adjustWordSpacing(measurement, 61, 'justify', true, settings);
  assert.equal(final.visibleWidth, 56);
  assert.equal(final.glyphPercentage, 100);
  assert.equal(adjustWordSpacing(measurement, 12, 'justify', false, settings), null);
});
