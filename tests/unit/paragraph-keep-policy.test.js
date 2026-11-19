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

test('linked headings and whole following paragraphs retain their independent policies', () => {
  const flags = [{ keepWithNext: true }, { keepWithNext: true }, { keepTogether: true }];
  const result = normalizeParagraphKeeps(flags, 3);
  assert.deepEqual(
    result.map((policy) => policy.keepWithNext),
    [true, true, false],
  );
  assert.deepEqual(
    result.map((policy) => policy.keepTogether),
    [false, false, true],
  );
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
