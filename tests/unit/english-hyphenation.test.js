import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dictionaryForLanguage,
  dictionaryHyphenationPoints,
} from '../../src/domain/text/dictionary-hyphenation.js';

test('English patterns, exceptions and original UTF-16 indexes', () => {
  assert.deepEqual(dictionaryHyphenationPoints('Typesetting'), [4, 7]);
  assert.deepEqual(dictionaryHyphenationPoints('associate'), [2, 4]);
  assert.deepEqual(dictionaryHyphenationPoints('projects'), []);
  assert.deepEqual(dictionaryHyphenationPoints("'typesetting'"), [5, 8]);
  assert.deepEqual(dictionaryHyphenationPoints('🌿 Typesetting.'), [7, 10]);
  for (const text of [
    'type\u00adsetting',
    'typesetting17',
    'typesetting_id',
    'typesetting\u0301',
    'cafétypesetting',
    'typesetting’s',
    'a'.repeat(129),
  ])
    assert.deepEqual(dictionaryHyphenationPoints(text), []);
});

test('local dictionaries keep language-specific breaks at the authored Unicode positions', () => {
  const points = (word, lang) =>
    dictionaryHyphenationPoints(word, {}, () => dictionaryForLanguage(lang));
  assert.deepEqual(points('composición', 'es-MX'), [3, 5, 7]);
  assert.deepEqual(points('типографика', 'ru'), [2, 4, 7, 9]);
  assert.deepEqual(points('IŞIKLANDIRMA', 'tr-TR'), [4, 7, 10]);
  assert.deepEqual(points('İstanbul', 'tr'), [2, 5]);
  assert.deepEqual(points('tipografia', 'it-IT'), [2, 4, 7]);
  assert.deepEqual(points('τυπογραφία', 'el-GR'), [2, 4, 7]);
  assert.deepEqual(points('organisation', 'en-GB'), [2, 5, 8]);
  assert.deepEqual(points('organisation', 'en-Latn-GB'), [2, 5, 8]);
  assert.deepEqual(points('organisation', 'en-US'), [2, 5, 6, 8]);
  assert.deepEqual(points('repu\u0301blica', 'es'), [2, 5, 8]);
  assert.deepEqual(points('tips\u00adografica', 'it'), []);
  assert.deepEqual(points('typography', 'fr'), []);
  assert.deepEqual(points('τυπογραφία', 'el-polyton'), []);
});
