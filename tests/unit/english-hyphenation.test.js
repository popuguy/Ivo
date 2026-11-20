import test from 'node:test';
import assert from 'node:assert/strict';
import { englishHyphenationPoints } from '../../src/domain/text/english-hyphenation.js';

test('English patterns, exceptions and original UTF-16 indexes', () => {
  assert.deepEqual(englishHyphenationPoints('Typesetting'), [4, 7]);
  assert.deepEqual(englishHyphenationPoints('associate'), [2, 4]);
  assert.deepEqual(englishHyphenationPoints('projects'), []);
  assert.deepEqual(englishHyphenationPoints("'typesetting'"), [5, 8]);
  assert.deepEqual(englishHyphenationPoints('🌿 Typesetting.'), [7, 10]);
  for (const text of [
    'type\u00adsetting',
    'typesetting17',
    'typesetting_id',
    'typesetting\u0301',
    'cafétypesetting',
    'typesetting’s',
    'a'.repeat(129),
  ])
    assert.deepEqual(englishHyphenationPoints(text), []);
});
