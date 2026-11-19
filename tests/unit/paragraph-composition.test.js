import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createParagraphComposer,
  validateParagraphSource,
} from '../../src/rendering/text/paragraph-composition.js';

const columns = (width = 18) => [{ width }, { width }];
function request(text, extra = {}) {
  return {
    protocol: 1,
    id: 'flow',
    text,
    sourceHTML: text,
    sourceDigest: text,
    runs: [{ start: 0, end: text.length, font: 'cmu', size: 12, tracking: 0 }],
    resources: [{ id: 'cmu', digest: 'exact-face', postscript: 'CMUSerif-Roman', data: 'bytes' }],
    allowFallback: false,
    ...extra,
  };
}
function backend(transform = (result) => result) {
  const calls = [];
  return {
    calls,
    measure: async (query) => {
      calls.push(query);
      return transform(
        {
          sourceDigest: query.sourceDigest,
          measurements: query.candidates.map((candidate) => ({
            ...candidate,
            width: query.text.slice(candidate.start, candidate.end).trimEnd().length,
          })),
        },
        query,
      );
    },
  };
}

function paragraphRequest(text, styles = []) {
  const req = request(text, { protocol: 2 }),
    parts = validateParagraphSource(text);
  req.paragraphs = parts.map((p, index) => ({
    start: p.start,
    end: p.start + p.text.length,
    align: 'left',
    paragraphBefore: 0,
    paragraphAfter: 0,
    leftIndent: 0,
    rightIndent: 0,
    firstLineIndent: 0,
    ...styles[index],
  }));
  return req;
}

test('paragraph indents fit distinct first/rest widths while spacing and alignment reuse shaping', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = paragraphRequest('aaaa bbbb cccc dddd\u2029', [
      { leftIndent: 2, rightIndent: 1, firstLineIndent: 4 },
    ]),
    before = JSON.stringify(req),
    result = await composer.compose(req, columns(14));
  let start = 0;
  for (const [index, end] of result.breaks.entries()) {
    assert(req.text.slice(start, end).trimEnd().length <= (index === 0 ? 7 : 11));
    start = end;
  }
  assert.equal(start, req.text.length);
  assert.equal(JSON.stringify(req), before);
  const changed = structuredClone(req);
  Object.assign(changed.paragraphs[0], { align: 'right', paragraphBefore: 7, paragraphAfter: 11 });
  const aligned = await composer.compose(changed, columns(14));
  assert.equal(aligned.work.backendCalls, 0);
  assert.deepEqual(aligned.breaks, result.breaks);
  changed.paragraphs[0].firstLineIndent = -2;
  const hanging = await composer.compose(changed, columns(14));
  assert.equal(hanging.work.backendCalls, 0);
  assert.notDeepEqual(hanging.breaks, result.breaks);
  assert.deepEqual(
    hanging.breaks,
    (await createParagraphComposer(backend().measure).compose(changed, columns(14))).breaks,
  );
  const bad = structuredClone(req);
  bad.paragraphs[0].leftIndent = 100;
  const calls = service.calls.length;
  await assert.rejects(composer.compose(bad, columns(14)), /text width/);
  assert.equal(service.calls.length, calls, 'Invalid areas must reject before native requests');
  bad.paragraphs[0].start = 1;
  await assert.rejects(composer.compose(bad, columns(14)), /metadata/);
});

test('tab-containing paragraphs measure at exact frame-relative indent origins and cannot alias caches', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = paragraphRequest('A\tB\u2029A\tB\u2029', [
      { leftIndent: 18, firstLineIndent: 9 },
      { leftIndent: 10, firstLineIndent: 5 },
    ]);
  const result = await composer.compose(req, columns(100));
  assert.equal(result.work.measuredParagraphs, 2);
  assert.equal(result.work.deduplicatedParagraphs, 0);
  const candidates = service.calls.flatMap((call) => call.candidates);
  assert(candidates.some((c) => c.start === 0 && c.offset === 27));
  assert(candidates.some((c) => c.start === 4 && c.offset === 15));
  assert(candidates.some((c) => c.start === 2 && c.offset === 18));
  const moved = structuredClone(req);
  moved.paragraphs[0].leftIndent++;
  assert.equal((await composer.compose(moved, columns(100))).work.measuredParagraphs, 1);
});

test('paragraph endings have independent decisions; soft breaks and blank paragraphs retain source', async () => {
  const source = 'aaa bb cc ddddd\u2029aaa bb cc ddddd\u2029\u2029a\u2028b\r\nc',
    service = backend(),
    composer = createParagraphComposer(service.measure),
    result = await composer.compose(request(source), columns(6));
  assert.deepEqual(result.breaks, [4, 10, 16, 20, 26, 32, 33, 35, 38, 39]);
  assert.equal(result.work.paragraphs, 4);
  assert.equal(result.work.measuredParagraphs, 3);
  assert.equal(result.work.deduplicatedParagraphs, 1);
  assert.equal(result.work.backendCalls, 1, 'Cold paragraphs should share a typesetter request');
  assert(!service.calls[0].candidates.some(({ end }) => source[end - 1] === '\r'));
});

test('edits and inserted/deleted paragraphs reuse rebased measurements and equal a fresh composition', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    first = 'First concise paragraph.\u2029Second paragraph keeps its exact text.\u2029Tail.',
    initial = request(first),
    before = JSON.stringify(initial);
  await composer.compose(initial, columns());
  assert.equal(JSON.stringify(initial), before, 'Derived composition must not mutate source');
  const edited = request(first.replace('concise', 'rather long')),
    result = await composer.compose(edited, columns());
  assert.equal(result.work.measuredParagraphs, 1);
  assert.equal(result.work.reusedParagraphs, 2);
  assert.equal(result.work.reusedDecisions, 2);
  assert(
    service.calls.at(-1).candidates.every(({ end }) => end <= edited.text.indexOf('\u2029') + 1),
  );
  const fresh = await createParagraphComposer(backend().measure).compose(edited, columns());
  assert.deepEqual(result.breaks, fresh.breaks);
  const inserted = request('New.\u2029' + edited.text),
    grown = await composer.compose(inserted, columns());
  assert.equal(grown.work.measuredParagraphs, 1);
  assert.equal(grown.work.reusedParagraphs, 3);
  assert.equal(grown.work.reusedDecisions, 3);
  assert.deepEqual(grown.breaks, [5, ...result.breaks.map((end) => end + 5)]);
  const shrunk = await composer.compose(
    request(edited.text.slice(edited.text.indexOf('\u2029') + 1)),
    columns(),
  );
  assert.equal(shrunk.work.backendCalls, 0);
  assert.equal(shrunk.work.reusedParagraphs, 2);
});

test('frame width and markup changes reuse shaping but compute the right new breaks', async () => {
  const service = backend(),
    composer = createParagraphComposer(service.measure),
    req = request('aaa bb cc ddddd\u2029Tail words.'),
    wide = await composer.compose(req, columns(14)),
    narrow = await composer.compose(
      { ...req, id: 'other-flow', sourceHTML: '<p>same text</p>', sourceDigest: 'new-html' },
      columns(6),
    );
  assert.equal(narrow.work.backendCalls, 0);
  assert.equal(narrow.work.reusedDecisions, 0);
  assert.notDeepEqual(narrow.breaks, wide.breaks);
  assert.deepEqual(
    narrow.breaks,
    (await createParagraphComposer(backend().measure).compose(req, columns(6))).breaks,
  );
  await assert.rejects(composer.compose(req, [{ width: 10 }, { width: 12 }]), /unequal column/);
  assert.equal((await composer.compose(req, columns(14))).work.reusedDecisions, 2);
  assert.equal((await composer.compose(req, columns(14.0001))).work.reusedDecisions, 0);
  await assert.rejects(composer.compose(req, [{ width: 10 }, { width: NaN }]), /unequal column/);
});

test('font and shaping changes invalidate only the affected paragraph', async () => {
  for (const change of [
    (req) => {
      req.runs[0].size = 14;
    },
    (req) => {
      req.runs[0].tracking = 20;
    },
    (req) => {
      req.runs[0].ligatures = false;
    },
    (req) => {
      req.resources[0].digest = 'replacement-face';
    },
  ]) {
    const service = backend(),
      composer = createParagraphComposer(service.measure),
      req = request('First paragraph.\u2029Second paragraph.', {
        runs: [
          { start: 0, end: 17, font: 'cmu', size: 12 },
          { start: 17, end: 34, font: 'other', size: 12 },
        ],
        resources: [
          { id: 'cmu', digest: 'face-a' },
          { id: 'other', digest: 'face-b' },
        ],
      });
    await composer.compose(req, columns());
    const edited = structuredClone(req);
    change(edited);
    const result = await composer.compose(edited, columns());
    assert.equal(result.work.measuredParagraphs, 1);
    assert.equal(result.work.reusedParagraphs, 1);
  }
});

test('native batch validation rejects wrong identities, ranges and widths without poisoning retries', async () => {
  for (const corrupt of [
    (r) => {
      r.sourceDigest = 'stale-source';
    },
    (r) => {
      r.measurements.pop();
    },
    (r) => {
      r.measurements.reverse();
    },
    (r) => {
      r.measurements[0].width = NaN;
    },
    (r) => {
      r.measurements[0].width = -1;
    },
    (r) => {
      r.measurements[0].start++;
    },
  ]) {
    let invalid = true;
    const service = backend((result) => {
        if (invalid) corrupt(result);
        return result;
      }),
      composer = createParagraphComposer(service.measure),
      req = request('one two three');
    await assert.rejects(composer.compose(req, columns()), /Native paragraph measure/);
    invalid = false;
    const retry = await composer.compose(req, columns());
    assert.equal(retry.work.reusedParagraphs, 0);
    assert.equal(retry.work.backendCalls, 1);
    assert.equal((await composer.compose(req, columns())).work.backendCalls, 0);
  }
});

test('cold alternatives batch across paragraphs; a failed later batch leaves no partial cache', async () => {
  let failing = true;
  const service = backend((result, query) => {
      assert(query.candidates.length <= 4096);
      if (failing && service.calls.length === 2) throw Error('worker disconnected');
      return result;
    }),
    composer = createParagraphComposer(service.measure),
    text = Array.from({ length: 3 }, (_, p) =>
      Array(70)
        .fill('word' + p)
        .join(' '),
    ).join('\u2029'),
    req = request(text);
  await assert.rejects(composer.compose(req, columns(30)), /disconnected/);
  failing = false;
  const retry = await composer.compose(req, columns(30));
  assert.equal(retry.work.reusedParagraphs, 0);
  assert.equal(retry.work.backendCalls, 2);
  assert.equal(retry.work.measuredCandidates, 3 * ((70 * 71) / 2));
});

test('cache is bounded and eviction preserves deterministic composition', async () => {
  const composer = createParagraphComposer(backend().measure),
    req = request('original paragraph'),
    original = await composer.compose(req, columns());
  for (let i = 0; i < 80; i++) {
    const result = await composer.compose(request('paragraph number ' + i), columns());
    assert(result.work.cacheEntries <= 64);
    assert(result.work.cacheBytes <= 8000000);
  }
  const afterEviction = await composer.compose(req, columns());
  assert.equal(afterEviction.work.backendCalls, 1);
  assert.deepEqual(afterEviction.breaks, original.breaks);
});

test('whole-flow admission budgets remain in effect for repeated and already measured paragraphs', async () => {
  assert.throws(() => validateParagraphSource('a'.repeat(10001)), /source budget/);
  assert.throws(() => validateParagraphSource('x\u2029'.repeat(1024)), /source budget/);
  assert.throws(() => validateParagraphSource('x '.repeat(450)), /alternative budget/);
  const composer = createParagraphComposer(backend().measure);
  await composer.compose(request('x\u2029'), columns());
  await assert.rejects(
    composer.compose(request('x\u2029'.repeat(1024)), columns()),
    /source budget/,
  );
  await assert.rejects(
    composer.compose(request('word-wider-than-frame'), columns(1)),
    /no-feasible-path/,
  );
  const expensive = 'x '.repeat(140) + '\u2029';
  await composer.compose(request(expensive), columns(1000));
  await assert.rejects(
    composer.compose(request(expensive.repeat(3)), columns(1000)),
    /flow decision budget/,
  );
  await assert.rejects(
    createParagraphComposer(backend().measure).compose(request(expensive.repeat(3)), columns(1000)),
    /flow decision budget/,
  );
});

function frameBackend(transform = (result) => result) {
  return backend((result, query) => {
    for (const row of result.measurements) {
      const large = query.text.slice(row.start, row.end).includes('LARGE');
      Object.assign(row, {
        ascent: large ? 18 : 8,
        descent: large ? 4 : 2,
        advance: large ? 24 : 12,
        capHeight: large ? 13 : 6,
        xHeight: large ? 9 : 4,
        leading: 0,
      });
    }
    return transform(result, query);
  });
}
const flowRequest = (text, styles) => ({ ...paragraphRequest(text, styles), protocol: 3 });
test('frame fitting carries exact measured heights through unequal columns and independent paragraphs', async () => {
  const service = frameBackend(),
    composer = createParagraphComposer(service.measure),
    req = flowRequest('aaa bbb LARGE ccc ddd eee\u2029Next paragraph.\u2029', [
      { leftIndent: 1, firstLineIndent: 2, paragraphAfter: 4 },
      { paragraphBefore: 3 },
    ]),
    frames = [
      { width: 14, height: 26 },
      { width: 24, height: 80, firstBaseline: 'cap-height', minimumFirstBaseline: 10 },
    ],
    before = structuredClone(req),
    result = await composer.compose(req, frames);
  assert.deepEqual(req, before);
  assert.equal(result.placements.at(-1).end, req.text.length);
  assert(result.placements.some((line) => line.frame === 1));
  let start = 0;
  for (const line of result.placements) {
    const text = req.text.slice(start, line.end),
      large = text.includes('LARGE');
    assert(text.trimEnd().length <= line.width);
    assert(line.baseline + (large ? 4 : 2) <= frames[line.frame].height);
    start = line.end;
  }
  const warm = await composer.compose(req, frames);
  assert.deepEqual(warm.placements, result.placements);
  assert.equal(warm.work.backendCalls, 0);
  assert.equal(warm.work.reusedDecisions, 2);
  const narrower = structuredClone(frames);
  narrower[1].width = 18;
  narrower[1].height = 70;
  const changed = await composer.compose(req, narrower);
  assert.equal(changed.work.backendCalls, 0);
  assert.deepEqual(
    changed.placements,
    (await createParagraphComposer(frameBackend().measure).compose(req, narrower)).placements,
  );
});

test('frame planning skips indented unusable columns and retains future overset without changing the actual frames', async () => {
  const service = frameBackend(),
    composer = createParagraphComposer(service.measure),
    req = flowRequest('aaa bbb ccc ddd eee fff\u2029', [{ leftIndent: 8 }]),
    frames = [
      { width: 6, height: 30 },
      { width: 14, height: 12 },
    ],
    before = structuredClone(frames),
    result = await composer.compose(req, frames);
  assert.equal(result.placements[0].frame, 1);
  assert(result.placements.at(-1).frame >= frames.length);
  assert.deepEqual(frames, before);
  req.paragraphs[0].leftIndent = 15;
  const calls = service.calls.length;
  await assert.rejects(composer.compose(req, frames), /outside all/);
  assert.equal(service.calls.length, calls);
});

test('final center/bottom alignment translates owned baselines once and cannot poison cached top alignment', async () => {
  const composer = createParagraphComposer(frameBackend().measure),
    req = flowRequest('short\u2029'),
    frames = [{ width: 20, height: 100 }],
    top = await composer.compose(req, frames);
  for (const [verticalAlign, expected] of [
    ['center', 53],
    ['bottom', 98],
  ]) {
    const result = await composer.compose(req, [{ ...frames[0], verticalAlign }]);
    assert.equal(result.placements[0].baseline, expected);
    assert.equal(result.work.backendCalls, 0);
  }
  assert.deepEqual((await composer.compose(req, frames)).placements, top.placements);
  assert.equal(top.placements[0].baseline, 8);
});

test('invalid exact metric batches are atomic and retryable', async () => {
  for (const corrupt of [
    (r) => {
      delete r.measurements[0].ascent;
    },
    (r) => {
      r.measurements[0].advance = 0;
    },
    (r) => {
      r.measurements[0].descent = NaN;
    },
  ]) {
    let invalid = true;
    const service = frameBackend((result) => {
        if (invalid) corrupt(result);
        return result;
      }),
      composer = createParagraphComposer(service.measure),
      req = flowRequest('one two three\u2029'),
      frames = [{ width: 10, height: 40 }];
    await assert.rejects(composer.compose(req, frames), /valid line metrics/);
    invalid = false;
    const result = await composer.compose(req, frames);
    assert.equal(result.work.reusedParagraphs, 0);
    assert.equal(result.placements.at(-1).end, req.text.length);
  }
});

test('frame planner yields to pending input tasks during preparation and exact fitting', async () => {
  const composer = createParagraphComposer(frameBackend().measure),
    req = flowRequest('word '.repeat(120) + '\u2029');
  let tasks = 0;
  const timer = setInterval(() => tasks++, 0);
  try {
    const result = await composer.compose(req, [{ width: 50, height: 300 }]);
    assert(result.placements.length > 1);
    assert(tasks > 2, 'Bounded work must allow scheduled input/camera tasks to run');
  } finally {
    clearInterval(timer);
  }
});
