import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParagraphKeeps } from '../../src/domain/text/paragraph-keep-policy.js';

test('native keeps default off without activating dormant widow/orphan counts', () => {
  const policies = normalizeParagraphKeeps(undefined, 3);
  assert.deepEqual(policies, Array(3).fill({ keepTogether: false, keepWithNext: false }));
  assert(Object.isFrozen(policies) && policies.every(Object.isFrozen));
});

test('All plus Next1 is admitted on one paragraph and retains immutable source flags', () => {
  const input = [{ keepTogether: true, keepWithNext: true }, {}, { keepWithNext: true }],
    before = structuredClone(input),
    result = normalizeParagraphKeeps(input, 3);
  assert.deepEqual(input, before);
  assert.deepEqual(result[0], { keepTogether: true, keepWithNext: true });
  assert.equal(result[2].keepWithNext, true, 'A final paragraph can retain its dormant Next flag');
});

test('unqualified keep chains, following All and wrap combinations reject explicitly', () => {
  assert.throws(
    () => normalizeParagraphKeeps([{ keepWithNext: true }, { keepWithNext: true }], 2),
    /chains/,
  );
  assert.throws(
    () => normalizeParagraphKeeps([{ keepWithNext: true }, { keepTogether: true }], 2),
    /following kept-together/,
  );
  assert.throws(
    () => normalizeParagraphKeeps([{ keepTogether: true }], 1, { wrapped: true }),
    /object wrapping/,
  );
  assert.deepEqual(normalizeParagraphKeeps([{}], 1, { wrapped: true }), [
    { keepTogether: false, keepWithNext: false },
  ]);
});

test('keep policy validates source coverage and boolean fields before scheduling', () => {
  for (const [input, count] of [
    [[], 0],
    [[], 1],
    [[null], 1],
    [[{ keepTogether: 1 }], 1],
    [[{ keepWithNext: null }], 1],
    [[{ widows: 2 }], 1],
    [[{ keepTogether: true }], 1.5],
  ])
    assert.throws(() => normalizeParagraphKeeps(input, count), /keep policy/);
});
