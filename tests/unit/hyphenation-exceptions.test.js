import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hyphenationExceptions,
  exceptionLanguage,
  indexHyphenationExceptions,
} from '../../src/domain/text/hyphenation-exceptions.js';
import { dictionaryHyphenationPoints } from '../../src/domain/text/dictionary-hyphenation.js';

test('document word lists cover exact exceptions, explicit prevention and UTF-16 offsets', () => {
  const settings = hyphenationExceptions({
    es: ['REPÚ~BLICA'],
    'en-us': ['~typesetting'],
    cs: ['opo~ziční'],
  });
  const words = indexHyphenationExceptions(settings);
  const br = (text, language) =>
    dictionaryHyphenationPoints(
      text,
      {
        hyphenAfterFirst: 2,
        hyphenBeforeLast: 2,
        hyphenWordLength: 4,
        hyphenCapitals: true,
        hyphenLastWord: true,
      },
      () => language,
      words,
    );
  assert.deepEqual(br('repu\u0301blica', 'es'), [5]);
  assert.deepEqual(br('typesetting', 'en-us'), []);
  assert.deepEqual(br('opoziční', 'cs'), [3]);
  assert.deepEqual(br('unlisted', 'hu'), []);
  assert.equal(exceptionLanguage('tr-TR'), 'tr');
  assert.equal(exceptionLanguage('en-GB'), 'en-gb');
  for (const word of ['a~~b', '~a~b', 'a~', '~', 'two words'])
    assert.throws(() => hyphenationExceptions({ es: [word] }));
  assert.throws(() => hyphenationExceptions({ es: ['uno', '~Uno'] }));
  assert.throws(() => hyphenationExceptions({ '#': [] }));
});

test('Czech bundled patterns and exception words work offline with accented and decomposed source', () => {
  const policy = {
    hyphenWordLength: 4,
    hyphenAfterFirst: 2,
    hyphenBeforeLast: 2,
    hyphenLastWord: true,
  };
  assert.deepEqual(
    dictionaryHyphenationPoints('jihomoravského', policy, () => 'cs'),
    [2, 4, 6, 9, 12],
  );
  assert.deepEqual(
    dictionaryHyphenationPoints('jiho' + 'moravske\u0301ho', policy, () => 'cs'),
    [2, 4, 6, 9, 13],
  );
});
