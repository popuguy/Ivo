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
