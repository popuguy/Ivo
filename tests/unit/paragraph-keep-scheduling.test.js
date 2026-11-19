import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createParagraphComposer,
  validateParagraphSource,
} from '../../src/rendering/text/paragraph-composition.js';

function request(text, { layouts = [], runs = [], protocol = 3 } = {}) {
  const paragraphs = validateParagraphSource(text).map((part, index) => ({
    start: part.start,
    end: part.start + part.text.length,
    align: 'left',
    paragraphBefore: 0,
    paragraphAfter: 0,
    leftIndent: 0,
    rightIndent: 0,
    firstLineIndent: 0,
    ...layouts[index],
  }));
  return {
    protocol,
    id: 'private-keep-fixture',
    text,
    sourceHTML: text,
    sourceDigest: text,
    paragraphs,
    runs: paragraphs.map((part, index) => ({
      start: part.start,
      end: part.end,
      font: 'exact-fixture',
      size: 12,
      leading: 14.4,
      ...runs[index],
    })),
    resources: [{ id: 'exact-fixture', digest: 'public-fixture', postscript: 'Fixture' }],
    allowFallback: false,
  };
}
function backend() {
  const calls = [];
  return {
    calls,
    measure: async (query) => {
      calls.push(structuredClone(query));
      assert.equal('paragraphKeeps' in query, false);
      assert.equal('limits' in query, false);
      assert(
        query.paragraphs.every(
          (paragraph) => !('keepTogether' in paragraph) && !('keepWithNext' in paragraph),
        ),
      );
      return {
        sourceDigest: query.sourceDigest,
        measurements: query.candidates.map((candidate) => {
          const runs = query.runs.filter(
              (run) => run.start < candidate.end && run.end > candidate.start,
            ),
            size = Math.max(...runs.map((run) => run.size)),
            advance = Math.max(...runs.map((run) => run.leading));
          return {
            ...candidate,
            width:
              (query.text.slice(candidate.start, candidate.end).trimEnd().length * 5 * size) / 12,
            ascent: (size * 5) / 6,
            descent: size / 4,
            advance,
            capHeight: size * 0.6,
            xHeight: size * 0.4,
            leading: 0,
          };
        }),
      };
    },
  };
}
const column = (width = 120, height = 45) => ({
  width,
  height,
  firstBaseline: 'fixed',
  minimumFirstBaseline: 12,
});
const keep = (keepTogether = false, keepWithNext = false) => ({ keepTogether, keepWithNext });
function rows(result) {
  let start = 0;
  return result.placements.map((line) => {
    const row = { start, ...line };
    start = line.end;
    return row;
  });
}
function sourceRows(result, text) {
  return rows(result).map((row) => [
    row.frame,
    +row.baseline.toFixed(6),
    text.slice(row.start, row.end),
  ]);
}

test('All moves a paragraph wholly from occupied space and recomputes top spacing', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('PRE\u2029A1\u2028A2\u2028A3\u2029TAIL', {
      layouts: [{ paragraphAfter: 10 }, { paragraphBefore: 20 }],
    }),
    columns = [column(80), column(300, 74), column(160, 74)],
    options = { paragraphKeeps: [keep(), keep(true), keep()] },
    before = structuredClone({ req, columns, options }),
    result = await composer.compose(req, columns, options);
  assert.deepEqual(sourceRows(result, req.text), [
    [0, 12, 'PRE\u2029'],
    [1, 12, 'A1\u2028'],
    [1, 26.4, 'A2\u2028'],
    [1, 40.8, 'A3\u2029'],
    [1, 55.2, 'TAIL'],
  ]);
  assert.deepEqual(result.keepViolations, []);
  assert(result.work.keepProbes >= 2);
  assert.deepEqual({ req, columns, options }, before);
});

test('empty-column All relaxation is local even when the following frame can fit everything', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('A1\u2028A2\u2028A3\u2028A4'),
    result = await composer.compose(req, [column(120, 31), column(300, 100)], {
      paragraphKeeps: [keep(true)],
    });
  assert.deepEqual(
    result.placements.map((line) => line.frame),
    [0, 0, 1, 1],
  );
  assert.deepEqual(result.keepViolations, [
    {
      paragraphIndex: 0,
      start: 0,
      end: req.text.length,
      kind: 'keepTogether',
      frame: 0,
      future: false,
      reason: 'empty-column-capacity',
    },
  ]);
});

test('nonempty All handoff happens before local relaxation and preserves passive actual overset', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('PRE\u2029A1\u2028A2\u2028A3\u2028A4\u2028A5\u2028A6'),
    actual = [column(120, 45), column(120, 45)],
    before = structuredClone(actual),
    result = await composer.compose(req, actual, { paragraphKeeps: [keep(), keep(true)] });
  assert.deepEqual(
    result.placements.map((line) => line.frame),
    [0, 1, 1, 1, 2, 2, 2],
  );
  assert.equal(result.placements[0].end, 4);
  assert.equal(result.placements.at(-1).end, req.text.length);
  assert.equal(result.keepViolations[0].frame, 1);
  assert.equal(result.keepViolations[0].future, false);
  assert.deepEqual(actual, before);
});

test('Next1 moves only the final row of a multiline paragraph that began in an empty frame', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('A1\u2028A2\u2028A3\u2029N1'),
    options = { paragraphKeeps: [keep(false, true), keep()] },
    columns = [column(), column(200)],
    control = await composer.compose(req, columns),
    result = await composer.compose(req, columns, options);
  assert.deepEqual(
    control.placements.map((line) => line.frame),
    [0, 0, 0, 1],
  );
  assert.deepEqual(sourceRows(result, req.text), [
    [0, 12, 'A1\u2028'],
    [0, 26.4, 'A2\u2028'],
    [1, 12, 'A3\u2029'],
    [1, 26.4, 'N1'],
  ]);
  assert.deepEqual(result.keepViolations, []);
});

test('All relaxation in a planned future frame reports locally derived future/source diagnostics', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('P1\u2028P2\u2028P3\u2029A1\u2028A2\u2028A3\u2028A4'),
    columns = [column()],
    before = structuredClone(columns),
    result = await composer.compose(req, columns, { paragraphKeeps: [keep(), keep(true)] });
  assert.deepEqual(
    result.placements.slice(0, 3).map((line) => line.frame),
    [0, 0, 0],
  );
  assert.deepEqual(
    result.placements.slice(3).map((line) => line.frame),
    [1, 1, 1, 2],
  );
  assert.deepEqual(result.keepViolations, [
    {
      paragraphIndex: 1,
      start: req.paragraphs[1].start,
      end: req.text.length,
      kind: 'keepTogether',
      frame: 1,
      future: true,
      reason: 'empty-column-capacity',
    },
  ]);
  assert.deepEqual(columns, before);
});

test('All outranks Next1 when both cannot fit at an empty column', async () => {
  for (const prefix of ['', 'PRE\u2029']) {
    const req = request(prefix + 'A1\u2028A2\u2029N1'),
      service = backend(),
      composer = createParagraphComposer(service.measure),
      index = prefix ? 1 : 0,
      policies = prefix ? [keep(), keep(true, true), keep()] : [keep(true, true), keep()],
      result = await composer.compose(req, [column(120, 31), column(160, 31)], {
        paragraphKeeps: policies,
      });
    assert.deepEqual(
      result.placements.slice(index, index + 2).map((line) => line.frame),
      [index, index],
    );
    assert.equal(result.placements.at(-1).frame, index + 1);
    assert.equal(result.keepViolations.length, 1);
    assert.equal(result.keepViolations[0].kind, 'keepWithNext');
    assert.equal(result.keepViolations[0].reason, 'all-priority');
    assert.equal(result.keepViolations[0].frame, index);
  }
});

test('Next1 at an empty one-row column relaxes; final-paragraph Next is a no-op', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('H\u2029N'),
    columns = [column(120, 16), column(160, 45)],
    result = await composer.compose(req, columns, { paragraphKeeps: [keep(false, true), keep()] });
  assert.deepEqual(
    result.placements.map((line) => line.frame),
    [0, 1],
  );
  assert.equal(result.keepViolations[0].reason, 'empty-column-capacity');
  const last = request('H'),
    noKeep = await composer.compose(last, columns),
    next = await composer.compose(last, columns, { paragraphKeeps: [keep(false, true)] });
  assert.deepEqual(next.placements, noKeep.placements);
  assert.deepEqual(next.keepViolations, []);
});

test('paired All6/All6+Next1 witnesses preserve the same placement after local All relaxation', async () => {
  const cases = [
    { prefix: '', columns: [column(), column(), column()], expected: [0, 0, 0, 1, 1, 1, 2] },
    {
      prefix: 'PRE\u2029',
      columns: [column(), column(), column()],
      expected: [0, 1, 1, 1, 2, 2, 2, 3],
    },
    {
      prefix: '',
      columns: [column(), column(), column(400, 150)],
      expected: [0, 0, 0, 1, 1, 1, 2],
    },
    {
      prefix: '',
      columns: [column(120, 31), column(120, 60), column()],
      expected: [0, 0, 1, 1, 1, 1, 2],
    },
  ];
  for (const scenario of cases) {
    const service = backend(),
      composer = createParagraphComposer(service.measure),
      req = request(scenario.prefix + 'A1\u2028A2\u2028A3\u2028A4\u2028A5\u2028A6\u2029N1'),
      index = scenario.prefix ? 1 : 0,
      plainPolicies = req.paragraphs.map((_, p) => keep(p === index)),
      nextPolicies = req.paragraphs.map((_, p) => keep(p === index, p === index)),
      before = structuredClone({ req, nextPolicies }),
      plain = await composer.compose(req, scenario.columns, { paragraphKeeps: plainPolicies }),
      next = await composer.compose(req, scenario.columns, { paragraphKeeps: nextPolicies });
    assert.deepEqual(
      plain.placements.map((line) => line.frame),
      scenario.expected,
    );
    assert.deepEqual(
      next.placements,
      plain.placements,
      'Do not move the final row after the measured All conflict',
    );
    assert.equal(next.work.backendCalls, 0);
    assert.equal(next.keepViolations[0].kind, 'keepTogether');
    const violation = next.keepViolations.find((part) => part.kind === 'keepWithNext');
    assert.equal(violation.reason, 'all-priority');
    assert.equal(violation.frame, scenario.expected.at(-2));
    assert.equal(violation.start, rows(next).at(-2).start);
    assert.equal(violation.end, req.text.length);
    assert.deepEqual({ req, nextPolicies }, before);
  }
});

test('a following blank paragraph contributes one physical strut row to Next1', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('PRE\u2029H\u2029\u2029'),
    result = await composer.compose(req, [column(120, 31), column(160, 45)], {
      paragraphKeeps: [keep(), keep(false, true), keep()],
    });
  assert.deepEqual(sourceRows(result, req.text), [
    [0, 12, 'PRE\u2029'],
    [1, 12, 'H\u2029'],
    [1, 26.4, '\u2029'],
  ]);
  assert.deepEqual(result.keepViolations, []);
});

test('All remeasures decisions at unequal widths while retaining exact source measurements', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('PRE\u2029one two three four five six seven eight nine ten\u2029TAIL'),
    columns = [column(65, 60), column(240, 100)],
    policies = [keep(), keep(true), keep()],
    control = await composer.compose(req, columns),
    kept = await composer.compose(req, columns, { paragraphKeeps: policies });
  assert.equal(kept.work.backendCalls, 0);
  assert.equal(kept.placements[1].frame, 1);
  assert(
    kept.placements[1].end > control.placements[1].end,
    'The wide handoff must recompose rather than move narrow breaks',
  );
  assert.deepEqual(kept.keepViolations, []);
});

test('a moved suffix can rewrap in a narrower column without repeating first indent or before spacing', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('PRE\u2029AA\u2028BB\u2028one two three four\u2029N', {
      layouts: [{}, { firstLineIndent: 10, leftIndent: 4, paragraphBefore: 2 }],
    }),
    columns = [column(120, 61), column(60, 31), column(180, 100)],
    control = await composer.compose(req, columns),
    result = await composer.compose(req, columns, {
      paragraphKeeps: [keep(), keep(false, true), keep()],
    });
  const own = rows(result).filter(
    (line) => line.start >= req.paragraphs[1].start && line.end <= req.paragraphs[1].end,
  );
  assert.equal(own[0].left, 14);
  const tailStart = req.text.indexOf('one'),
    tail = own.filter((line) => line.start >= tailStart);
  assert.equal(
    rows(control).find((line) => line.start === tailStart).frame,
    0,
    'Control must actually fill the original final row',
  );
  assert.deepEqual(
    tail.map((line) => line.frame),
    [1, 2],
    'The newly wrapped final row moves again after its earlier suffix row occupies frame 1',
  );
  assert(
    tail.every((line) => line.left === 4),
    'Every moved suffix fragment uses the rest-line indent',
  );
  assert.equal(result.placements.at(-1).frame, own.at(-1).frame);
  assert.deepEqual(result.keepViolations, []);
});

test('following source, shaping and layout changes cannot reuse a stale preceding Next schedule', async () => {
  for (const change of ['source', 'shaping', 'layout']) {
    const service = backend(),
      composer = createParagraphComposer(service.measure),
      req = request('PRE\u2029H\u2029N'),
      columns = [column(120, 45), column(400, 100)],
      policies = [keep(), keep(false, true), keep()],
      original = await composer.compose(req, columns, { paragraphKeeps: policies });
    assert.equal(original.placements[1].frame, 0);
    const edited =
      change === 'source' ? request('PRE\u2029H\u2029' + 'W'.repeat(30)) : structuredClone(req);
    if (change === 'shaping') edited.runs[2].leading = 28.8;
    if (change === 'layout') edited.paragraphs[2].paragraphBefore = 8;
    const kept = await composer.compose(edited, columns, { paragraphKeeps: policies });
    assert.equal(kept.placements[1].frame, 1, change);
    assert.equal(kept.work.reusedParagraphs, change === 'layout' ? 3 : 2);
    assert.deepEqual(
      kept.placements,
      (
        await createParagraphComposer(backend().measure).compose(edited, columns, {
          paragraphKeeps: policies,
        })
      ).placements,
    );
  }
});

test('cold/warm and policy toggles keep measurements pure while charging every primitive probe', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('PRE\u2029A1\u2028A2\u2028A3\u2029N'),
    columns = [column(), column(200, 74)],
    options = { paragraphKeeps: [keep(), keep(true), keep()] },
    before = structuredClone(req),
    off = await composer.compose(req, columns),
    cold = await composer.compose(req, columns, options),
    warm = await composer.compose(req, columns, options);
  assert.deepEqual(warm.placements, cold.placements);
  assert.deepEqual(warm.keepViolations, cold.keepViolations);
  assert.equal(warm.work.backendCalls, 0);
  assert.equal(warm.work.states, cold.work.states);
  assert.equal(warm.work.candidates, cold.work.candidates);
  assert.equal(warm.work.fitProbes, cold.work.fitProbes);
  assert(warm.work.reusedDecisions > 0);
  assert.deepEqual((await composer.compose(req, columns)).placements, off.placements);
  assert.deepEqual(req, before);
});

test('lower-only global work limits charge warm cache hits and every failed keep probe', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('PRE\u2029A1\u2028A2\u2028A3\u2029N'),
    columns = [column(), column(200, 74)],
    options = { paragraphKeeps: [keep(), keep(true), keep()] },
    full = await composer.compose(req, columns, options);
  assert(full.work.keepProbes >= 3);
  await assert.rejects(
    composer.compose(req, columns, { ...options, limits: { states: full.work.states - 1 } }),
    /budget/,
  );
  await assert.rejects(
    composer.compose(req, columns, {
      ...options,
      limits: { candidates: full.work.candidates - 1 },
    }),
    /budget/,
  );
  await assert.rejects(
    createParagraphComposer(backend().measure).compose(req, columns, {
      ...options,
      limits: { states: 2 },
    }),
    /budget/,
  );
  assert.deepEqual(
    (await composer.compose(req, columns, options)).placements,
    full.placements,
    'Failed budget probes cannot poison retry geometry',
  );
  for (const limits of [
    null,
    { states: 100001 },
    { candidates: 1000001 },
    { states: 0 },
    { unknown: 1 },
  ])
    await assert.rejects(composer.compose(req, columns, { ...options, limits }), /work limits/);
});

test('invalid keep policies reject before native measurement; disabled defaults retain baseline layout', async () => {
  const req = request('A\u2029B'),
    columns = [column(), column(200)],
    service = backend(),
    composer = createParagraphComposer(service.measure);
  for (const policies of [[keep()], [null, keep()]])
    await assert.rejects(
      composer.compose(req, columns, { paragraphKeeps: policies }),
      /keep|source/i,
    );
  await assert.rejects(
    composer.compose({ ...req, protocol: 2 }, [column(), column()], {
      paragraphKeeps: [keep(true), keep()],
    }),
    /planned physical/,
  );
  assert.equal(service.calls.length, 0);
  assert.deepEqual(
    (await composer.compose(req, columns, { paragraphKeeps: [keep(), keep()] })).placements,
    (await composer.compose(req, columns)).placements,
  );
});

test('heading chains recompose together and respect a following whole paragraph in both composers', async () => {
  const req = request('PRE\u2029Title\u2029Deck\u2029A\u2028B\u2029Tail'),
    flags = [keep(), keep(false, true), keep(false, true), keep(true), keep()],
    columns = [column(120, 45), column(90, 60), column(180, 60)];
  for (const mode of ['single-line', 'paragraph']) {
    const composer = createParagraphComposer(backend().measure);
    const result = await composer.compose(req, columns, { paragraphKeeps: flags, mode });
    assert.deepEqual(
      result.placements.map((row) => row.frame),
      [0, 1, 1, 1, 1, 2],
    );
    assert.deepEqual(result.keepViolations, []);
    const warm = await composer.compose(req, columns, { paragraphKeeps: flags, mode });
    assert.deepEqual(warm.placements, result.placements);
    assert.equal(warm.work.backendCalls, 0);
  }
});

test('only the connected suffix moves; an impossible chain relaxes at its broken join', async () => {
  const composer = createParagraphComposer(backend().measure);
  const flags = [keep(false, true), keep(false, true), keep()];
  const result = await composer.compose(
    request('start\u2028tail\u2029Deck\u2029Body'),
    [column(120, 45), column(120, 60)],
    { paragraphKeeps: flags },
  );
  assert.deepEqual(
    result.placements.map((row) => row.frame),
    [0, 1, 1, 1],
  );
  const impossible = await composer.compose(request('A\u2029B\u2029C'), [column(120, 31)], {
    paragraphKeeps: flags,
  });
  assert.deepEqual(
    impossible.placements.map((row) => row.frame),
    [0, 0, 1],
  );
  assert.deepEqual(
    impossible.keepViolations.map((v) => [v.paragraphIndex, v.kind, v.start, v.end]),
    [[1, 'keepWithNext', 2, 5]],
  );
});

test('a keep moves both fragments of the last physical wrap row and recomposes them at the new width', async () => {
  const req = request('PRE\u2029one two mid end\u2029after');
  // Two 40-point segments on the second (last) row. Both belong to one moving tail.
  const obstacle = {
    mode: 'bounds',
    side: 'both',
    bounds: { left: 40, right: 80, top: 18, bottom: 45 },
    polygons: [
      [
        { x: 40, y: 18 },
        { x: 80, y: 18 },
        { x: 80, y: 45 },
        { x: 40, y: 45 },
      ],
    ],
  };
  const columns = [{ ...column(120, 31), obstacles: [obstacle] }, column(120, 60)];
  const composer = createParagraphComposer(backend().measure);
  const before = await composer.compose(req, columns);
  assert.deepEqual(
    before.placements.map((row) => [row.frame, row.left]),
    [
      [0, 0],
      [0, 0],
      [0, 80],
      [1, 0],
    ],
  );
  const kept = await composer.compose(req, columns, {
    paragraphKeeps: [keep(), keep(false, true), keep()],
  });
  assert.deepEqual(sourceRows(kept, req.text), [
    [0, 12, 'PRE\u2029'],
    [1, 12, 'one two mid end\u2029'],
    [1, 26.4, 'after'],
  ]);
  assert.deepEqual(kept.keepViolations, []);
});

test('counted joins carry one through five physical body rows and clamp to a shorter paragraph', async () => {
  const req = request('PRE\u2029Heading\u2029A\u2028B\u2028C\u2028D\u2028E\u2029Tail');
  const columns = [column(100, 45), column(140, 120)];
  for (let count = 1; count <= 5; count++) {
    const result = await createParagraphComposer(backend().measure).compose(req, columns, {
      paragraphKeeps: [{}, { keepWithNext: true, keepNextLines: count }, {}, {}],
    });
    assert.equal(result.placements[1].frame, count === 1 ? 0 : 1);
    assert.deepEqual(result.keepViolations, []);
  }
  const shorter = await createParagraphComposer(backend().measure).compose(
    request('A\u2029B\u2029C'),
    [column(100, 31)],
    {
      paragraphKeeps: [{ keepWithNext: true, keepNextLines: 5 }, {}, {}],
    },
  );
  assert.deepEqual(
    shorter.placements.map((line) => line.frame),
    [0, 0, 1],
  );
  assert.deepEqual(shorter.keepViolations, []);
});

test('moving a later join carries an earlier counted prefix only when the two overlap', async () => {
  const req = request('PRE\u2029H\u2029A\u2028B\u2029C');
  const cols = [column(100, 60), column(160, 80)];
  for (const count of [1, 2]) {
    const result = await createParagraphComposer(backend().measure).compose(req, cols, {
      paragraphKeeps: [
        {},
        { keepWithNext: true, keepNextLines: count },
        {},
        { keepWithPrevious: true },
      ],
    });
    assert.deepEqual(
      result.placements.map((row) => row.frame),
      count === 1 ? [0, 0, 0, 1, 1] : [0, 1, 1, 1, 1],
    );
    assert.deepEqual(result.keepViolations, []);
  }
});

test('an impossible previous join is reported on its owning paragraph; first-paragraph previous is dormant', async () => {
  const result = await createParagraphComposer(backend().measure).compose(
    request('A\u2029B'),
    [column(120, 16)],
    {
      paragraphKeeps: [{ keepWithPrevious: true }, { keepWithPrevious: true }],
    },
  );
  assert.deepEqual(
    result.placements.map((row) => row.frame),
    [0, 1],
  );
  assert.deepEqual(
    result.keepViolations.map((v) => [v.kind, v.paragraphIndex, v.future]),
    [['keepWithPrevious', 1, true]],
  );
});

test('two sides of an illustration count as one of the following physical lines', async () => {
  const bounds = { left: 40, right: 80, top: 34, bottom: 45 };
  const obstacle = {
    mode: 'bounds',
    side: 'both',
    bounds,
    polygons: [
      [
        { x: 40, y: 34 },
        { x: 80, y: 34 },
        { x: 80, y: 45 },
        { x: 40, y: 45 },
      ],
    ],
  };
  const req = request('PRE\u2029Heading\u2029one two mid end\u2028after');
  const columns = [{ ...column(120, 45), obstacles: [obstacle] }, column(120, 90)];
  const compose = createParagraphComposer(backend().measure);
  const base = await compose.compose(req, columns);
  assert.deepEqual(
    base.placements.map((r) => [r.frame, r.left]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 80],
      [1, 0],
    ],
  );
  const kept = await compose.compose(req, columns, {
    paragraphKeeps: [{}, { keepWithNext: true, keepNextLines: 2 }, {}],
  });
  assert.deepEqual(
    kept.placements.map((r) => r.frame),
    [0, 1, 1, 1],
  );
  assert.deepEqual(kept.keepViolations, []);
});

test('a later tail reflow preserves a genuinely broken incoming previous join', async () => {
  const req = request('A\u2029B\u2028C\u2028D\u2029E');
  const result = await createParagraphComposer(backend().measure).compose(
    req,
    [column(110, 16), column(110, 45), column(110, 60)],
    { paragraphKeeps: [{}, { keepWithPrevious: true, keepWithNext: true }, {}] },
  );
  assert.deepEqual(
    result.placements.map((r) => r.frame),
    [0, 1, 1, 2, 2],
  );
  assert.deepEqual(
    result.keepViolations.map((v) => [v.paragraphIndex, v.kind, v.frame]),
    [[1, 'keepWithPrevious', 1]],
  );
});

test('forced starts distinguish the next physical column, frame, page and page parity', async () => {
  const cols = Array.from({ length: 8 }, (_, i) => ({
    ...column(134, 45),
    frameId: 'F' + Math.floor(i / 2),
    pageNumber: [1, 1, 2, 3][Math.floor(i / 2)],
  }));
  const compose = createParagraphComposer(backend().measure);
  for (const [rule, expected] of Object.entries({
    column: 1,
    frame: 2,
    page: 4,
    even: 4,
    odd: 6,
  })) {
    const req = request('Preface\u2029Deck\u2029Heading\u2029Body');
    const layout = await compose.compose(req, cols, {
      paragraphKeeps: [{}, { keepWithNext: true }, { paragraphStart: rule }, {}],
    });
    assert.deepEqual(
      layout.placements.map((r) => r.frame),
      [0, 0, expected, expected],
      rule,
    );
    assert.deepEqual(
      layout.keepViolations.map((v) => [v.paragraphIndex, v.reason]),
      [[1, 'paragraph-start']],
    );
    const first = await compose.compose(request('Heading\u2029Body'), cols, {
      paragraphKeeps: [{ paragraphStart: rule }, {}],
    });
    assert.deepEqual(
      first.placements.map((r) => r.frame),
      rule === 'even' ? [4, 4] : [0, 0],
      rule,
    );
  }
});

test('future starts clone the last frame column count; repeated page starts advance from the prior paragraph', async () => {
  const cols = [0, 1].map(() => ({ ...column(120, 45), frameId: 'one', pageNumber: 1 }));
  const req = request('Preface\u2029First\u2029Second');
  const compose = createParagraphComposer(backend().measure);
  for (const [rule, frames] of Object.entries({
    column: [0, 1, 2],
    frame: [0, 2, 4],
    page: [0, 2, 4],
    odd: [0, 4, 8],
    even: [0, 2, 6],
  })) {
    const layout = await compose.compose(req, cols, {
      paragraphKeeps: [{}, { paragraphStart: rule }, { paragraphStart: rule }],
    });
    assert.deepEqual(
      layout.placements.map((r) => r.frame),
      frames,
    );
  }
});

test('split-line minima activate independently of stored counts and whole-paragraph priority', async () => {
  const text = 'A1\u2028A2\u2028A3\u2028A4\u2028A5',
    composer = createParagraphComposer(backend().measure);
  const layout = async (policy, counts = [4, 4]) =>
    composer.compose(
      request(text),
      counts.map((n) => column(140, 15.5 + (n - 1) * 14.4)),
      { paragraphKeeps: [policy] },
    );
  const frames = (result) => result.placements.map((line) => line.frame);
  assert.deepEqual(frames(await layout({ widows: 3, orphans: 2 })), [0, 0, 0, 0, 1]);
  assert.deepEqual(
    frames(await layout({ keepBoundaryLines: true, widows: 3, orphans: 2 })),
    [0, 0, 1, 1, 1],
  );
  const impossible = await layout({ keepBoundaryLines: true, widows: 3, orphans: 3 }, [2, 2, 1]);
  assert.deepEqual(frames(impossible), [0, 0, 1, 1, 2]);
  assert.deepEqual(
    impossible.keepViolations.map((v) => [v.kind, v.start, v.end]),
    [
      ['orphans', 0, 6],
      ['widows', 12, 14],
    ],
  );
  const all = await layout({ keepBoundaryLines: true, widows: 3, orphans: 2, keepTogether: true });
  assert.deepEqual(frames(all), [0, 0, 0, 0, 1]);
  assert.deepEqual(
    all.keepViolations.map((v) => v.kind),
    ['keepTogether'],
  );
});

test('No Break belongs to the selected whitespace and keeps manual breaks and source indices intact', () => {
  const text = 'aa bb\u2028cc dd\u2029ee ff';
  const points = (ranges) =>
    validateParagraphSource(text, ranges).map((p) => p.opportunities.map((o) => o.index));
  assert.deepEqual(points([]), [
    [0, 3, 6, 9, 12],
    [0, 3, 5],
  ]);
  assert.deepEqual(points([{ start: 2, end: 3 }]), [
    [0, 6, 9, 12],
    [0, 3, 5],
  ]);
  assert.deepEqual(points([{ start: 3, end: 5 }]), points([]));
  assert.deepEqual(points([{ start: 0, end: text.length }]), [
    [0, 6, 12],
    [0, 5],
  ]);
  assert.throws(
    () =>
      points([
        { start: 5, end: 7 },
        { start: 2, end: 4 },
      ]),
    /No Break/,
  );
});
test('No Break preserves an overset suffix, skips narrow frames, respects both composers and invalidates cached decisions', async () => {
  const composer = createParagraphComposer(backend().measure),
    req = request('Up aa bb cc'),
    noBreakRanges = [{ start: 3, end: 11 }];
  for (const mode of ['single-line', 'paragraph']) {
    const narrow = [column(20), column(25)],
      opts = { mode, noBreakRanges };
    const actual = await composer.compose(req, narrow, opts);
    assert.equal(actual.oversetStart, 3);
    assert.deepEqual(
      actual.placements.map((l) => l.end),
      [3],
    );
    const wider = await composer.compose(req, [...narrow, column(45)], opts);
    assert.deepEqual(
      wider.placements.map((l) => [l.end, l.frame]),
      [
        [3, 0],
        [11, 2],
      ],
    );
    const restored = await composer.compose(req, narrow, { mode });
    assert.equal(restored.oversetStart, undefined);
    assert.equal(restored.breaks.at(-1), 11);
    const empty = await composer.compose(req, narrow, {
      mode,
      noBreakRanges: [{ start: 0, end: 11 }],
    });
    assert.equal(empty.oversetStart, 0);
    assert.deepEqual(empty.placements, []);
  }
});

test('an optional break retains its own source position and can be disabled by protecting the marker', () => {
  const text = 'Patt\u200bern\u2028End';
  const points = (ranges = []) => validateParagraphSource(text, ranges)[0].opportunities;
  assert.deepEqual(points(), [
    { index: 0 },
    { index: 5, mandatory: false },
    { index: 9, mandatory: true },
    { index: 12, mandatory: true },
  ]);
  assert.deepEqual(
    points([{ start: 4, end: 5 }]).map((p) => p.index),
    [0, 9, 12],
  );
  assert.deepEqual(points([{ start: 5, end: 8 }]), points());
});
