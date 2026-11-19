import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WORD_SPACING,
  normalizeWordSpacing,
  wordSpacingSettings,
  wordSpacingValue,
  wordSpacingSourceError,
} from '../../src/domain/text/word-spacing.js';

test('word spacing is atomic and defaults retain the previous composer identity', () => {
  assert.equal(normalizeWordSpacing('normal'), 'normal');
  assert.equal(wordSpacingSettings(), null);
  assert.equal(wordSpacingValue(DEFAULT_WORD_SPACING), '80:100:133');
  const settings = wordSpacingSettings('80:100:133');
  assert.deepEqual(settings, DEFAULT_WORD_SPACING);
  assert(Object.isFrozen(settings));
  assert(Object.isFrozen(DEFAULT_WORD_SPACING));
});

test('word spacing initially admits simple LTR scripts with ordinary and flexible nonbreaking spaces', () => {
  for (const text of [
    'Latin e\u0301 Ελληνικά Русский 123',
    '  A B \r\n\u2028\u2029',
    'A–B…C',
    'A\u00a0B',
    'A\u202fB',
  ])
    assert.equal(wordSpacingSourceError(text), null);
  for (const text of [
    'A\tB',
    'A\u2003B',
    'A\u2009B',
    'A\u202eB',
    'A\u2067B',
    'עברית',
    'العربية',
    '日本語',
  ])
    assert.match(wordSpacingSourceError(text), /word spacing with/);
});

test('fractional and boundary percentages normalize idempotently without mutating input', () => {
  for (const source of [
    '0:100:1000',
    '80.125:100.25:133.5',
    ' 080 : 1e2 : 133 ',
    '0:0:0',
    '0.00000001:100:133',
  ]) {
    const canonical = normalizeWordSpacing(source),
      settings = wordSpacingSettings(canonical);
    assert.equal(normalizeWordSpacing(canonical), canonical);
    const before = structuredClone(settings);
    assert.equal(wordSpacingValue(settings), canonical);
    assert.deepEqual(settings, before);
  }
});

test('invalid, partial or crossed spacing policy cannot be stored as a partial edit', () => {
  for (const value of [
    undefined,
    null,
    {},
    [80, 100, 133],
    '',
    '80:100',
    '80:100:133:150',
    '120:100:133',
    '80:150:133',
    '-1:100:133',
    '80:100:1001',
    'NaN:100:133',
    '80%:100:133',
    'Infinity:100:133',
    '0x50:100:133',
  ])
    assert.throws(() => normalizeWordSpacing(value), /Word spacing/);
  for (const value of [
    null,
    {},
    { minimum: 80, desired: 100 },
    { minimum: 80, desired: 100, maximum: 133, extra: 0 },
    { minimum: '80', desired: 100, maximum: 133 },
    { minimum: 80, desired: 100, maximum: Number.NaN },
  ])
    assert.throws(() => wordSpacingValue(value), /Word spacing/);
});
