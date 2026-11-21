import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  NATIVE_CHARACTER_STYLE_FIELDS,
  nativeCharacterStyle,
  hasNondefaultNativeCharacter,
  requiredNativeCharacterFeatures,
  nativeCharacterFeatureAdmission,
} from '../../src/domain/text/native-character-style.js';
import { TEXT_DEFAULTS } from '../../src/domain/text/typography.js';
import { inspectFont } from '../../src/domain/text/fonts.js';

const metadata = (features, overrides = {}) => ({
  digest: 'a'.repeat(64),
  postscript: 'Exact-Face',
  features,
  ...overrides,
});

test('default character styles retain the previous protocol identity and existing ligature policy', () => {
  const result = nativeCharacterStyle(TEXT_DEFAULTS);
  assert.deepEqual(result, {});
  assert.equal(result, nativeCharacterStyle({}));
  assert.equal(hasNondefaultNativeCharacter(TEXT_DEFAULTS), false);
  assert.deepEqual(requiredNativeCharacterFeatures(TEXT_DEFAULTS), []);
  assert.equal(hasNondefaultNativeCharacter({ ligatures: false, bold: true, fontSize: 90 }), false);
  assert.deepEqual(nativeCharacterStyle({ ligatures: false }), {});
  assert.deepEqual(nativeCharacterStyle({ features: { dlig: false, smcp: false } }), {});
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(NATIVE_CHARACTER_STYLE_FIELDS));
  assert.equal(NATIVE_CHARACTER_STYLE_FIELDS.length, 32);
  assert.ok(!NATIVE_CHARACTER_STYLE_FIELDS.includes('allCaps'));
  assert.ok(NATIVE_CHARACTER_STYLE_FIELDS.includes('fontVariations'));
});

test('authored and transported variable coordinates preserve precision and identity', () => {
  const coordinates = { wdth: 91, wght: 647.5 };
  assert.deepEqual(nativeCharacterStyle({ fontVariations: 'wght:647.5,wdth:91' }), {
    variations: coordinates,
  });
  assert.deepEqual(nativeCharacterStyle({ variations: coordinates }), { variations: coordinates });
  for (const input of [
    { fontVariations: 'wght:1,wght:2' },
    { variations: { wght: '650' } },
    { variations: { wd: 91 } },
    { fontVariations: 'wght:700', variations: { wght: 300 } },
  ])
    assert.throws(() => nativeCharacterStyle(input), TypeError);
});

test('effective character styles project only bounded scalars and enabled protocol4 tags', () => {
  const input = {
      ...TEXT_DEFAULTS,
      baselineShift: -40,
      horizontalScale: 150,
      verticalScale: 10,
      discretionaryLigatures: true,
      smallCaps: true,
      oldstyleFigures: true,
      tabularFigures: true,
      slashedZero: true,
      fractions: true,
      ordinals: true,
      stylisticAlternates: true,
    },
    before = structuredClone(input),
    result = nativeCharacterStyle(input);
  assert.deepEqual(result, {
    baselineShift: -40,
    horizontalScale: 150,
    verticalScale: 10,
    features: {
      dlig: true,
      frac: true,
      onum: true,
      ordn: true,
      salt: true,
      smcp: true,
      tnum: true,
      zero: true,
    },
  });
  assert.deepEqual(requiredNativeCharacterFeatures(input), [
    'dlig',
    'frac',
    'onum',
    'ordn',
    'salt',
    'smcp',
    'tnum',
    'zero',
  ]);
  assert.equal(hasNondefaultNativeCharacter(input), true);
  assert.equal(hasNondefaultNativeCharacter(result), true);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.features));
  assert.throws(() => {
    result.features.smcp = false;
  }, TypeError);
  assert.deepEqual(
    nativeCharacterStyle({
      baselineShift: 0,
      horizontalScale: 100,
      verticalScale: 100,
      smallCaps: false,
    }),
    {},
  );
  assert.deepEqual(
    nativeCharacterStyle({ baselineShift: -2000, horizontalScale: 10, verticalScale: 1000 }),
    { baselineShift: -2000, horizontalScale: 10, verticalScale: 1000 },
  );
  assert.deepEqual(
    nativeCharacterStyle({ baselineShift: 2000, horizontalScale: 1000, verticalScale: 10 }),
    { baselineShift: 2000, horizontalScale: 1000, verticalScale: 10 },
  );
});

test('native runs and camelcase styles share one strict feature policy without conflicting overrides', () => {
  const authoring = { baselineShift: 3, oldstyleFigures: true, smallCaps: true },
    native = {
      start: 4,
      end: 20,
      size: 12,
      baselineShift: 3,
      features: { smcp: true, onum: true },
    };
  assert.deepEqual(nativeCharacterStyle(authoring), nativeCharacterStyle(native));
  assert.deepEqual(nativeCharacterStyle({ smallCaps: true, features: { smcp: true } }), {
    features: { smcp: true },
  });
  assert.throws(
    () => nativeCharacterStyle({ smallCaps: false, features: { smcp: true } }),
    /Conflicting/,
  );
  assert.throws(
    () => nativeCharacterStyle({ smallCaps: true, features: { smcp: false } }),
    /Conflicting/,
  );
  assert.deepEqual(
    nativeCharacterStyle(Object.assign(Object.create(null), authoring)),
    nativeCharacterStyle(authoring),
  );
});

test('invalid character values never silently become defaults or truthy OpenType flags', () => {
  const invalid = [
    null,
    [],
    new Date(),
    { baselineShift: -2001 },
    { baselineShift: 2001 },
    { baselineShift: null },
    { horizontalScale: 9 },
    { verticalScale: 1001 },
    { horizontalScale: '150' },
    { verticalScale: false },
    { baselineShift: Number.NaN },
    { verticalScale: Infinity },
    { smallCaps: 'true' },
    { fractions: 1 },
    { ordinals: null },
    { features: null },
    { features: [] },
    { features: new Map() },
    { features: { smcp: 1 } },
    { features: { smcp: undefined } },
    { features: { xxxx: true } },
    { features: { liga: true } },
    { features: { pnum: true } },
  ];
  for (const input of invalid) {
    assert.throws(() => nativeCharacterStyle(input), TypeError);
    assert.throws(() => hasNondefaultNativeCharacter(input), TypeError);
    assert.throws(() => requiredNativeCharacterFeatures(input), TypeError);
    assert.throws(() => nativeCharacterFeatureAdmission(input), TypeError);
  }
});

test('unknown font metadata stays unavailable while a known empty list proves missing features', () => {
  const style = { smallCaps: true, fractions: true };
  for (const unknown of [
    undefined,
    null,
    {},
    { family: 'Exact Face', features: ['smcp', 'frac'] },
    metadata(undefined),
    { digest: 'a'.repeat(64), postscript: 'Exact-Face' },
  ]) {
    const result = nativeCharacterFeatureAdmission(style, unknown);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.required, ['frac', 'smcp']);
    assert.deepEqual(result.missing, []);
    assert.equal(result.reason, 'font-feature-metadata-unavailable');
  }
  const known = nativeCharacterFeatureAdmission(style, metadata([]));
  assert.equal(known.status, 'missing');
  assert.deepEqual(known.missing, ['frac', 'smcp']);
  assert.equal(known.reason, 'font-feature-not-declared');
  assert.deepEqual(known.font, { digest: 'a'.repeat(64), postscript: 'Exact-Face' });
  const scalar = nativeCharacterFeatureAdmission({ baselineShift: 4, horizontalScale: 150 });
  assert.equal(
    scalar.status,
    'available',
    'Character transforms do not require feature declarations',
  );
  assert.equal(
    scalar.font,
    null,
    'Feature admission does not pretend to establish font byte identity',
  );
});

test('available declared features need no sample substitution and proportional figures are derived only when known', () => {
  const onlyOldstyle = nativeCharacterFeatureAdmission(
    { oldstyleFigures: true },
    metadata(['onum']),
  );
  assert.equal(onlyOldstyle.status, 'available');
  assert.deepEqual(onlyOldstyle.required, ['onum']);
  assert.deepEqual(
    onlyOldstyle.derived,
    [],
    'An onum-only face must not need a nonexistent pnum feature',
  );
  const proportional = nativeCharacterFeatureAdmission(
    { oldstyleFigures: true, tabularFigures: false },
    metadata(['onum', 'pnum', 'salt']),
  );
  assert.equal(proportional.status, 'available');
  assert.deepEqual(proportional.derived, ['pnum']);
  assert.deepEqual(proportional.required, ['onum']);
  const tabular = nativeCharacterFeatureAdmission(
    { oldstyleFigures: true, tabularFigures: true },
    metadata(['onum', 'pnum', 'tnum']),
  );
  assert.equal(tabular.status, 'available');
  assert.deepEqual(tabular.required, ['onum', 'tnum']);
  assert.deepEqual(tabular.derived, []);
  assert.equal(
    nativeCharacterFeatureAdmission({ stylisticAlternates: true }, metadata(['salt'])).status,
    'available',
  );
});

test('metadata admission binds exact immutable identity and snapshots its results', () => {
  const source = metadata(['smcp', 'pnum', 'onum']),
    expected = { digest: source.digest, postscript: source.postscript },
    before = structuredClone(source),
    result = nativeCharacterFeatureAdmission(
      { smallCaps: true, oldstyleFigures: true },
      source,
      expected,
    );
  assert.equal(result.status, 'available');
  assert.deepEqual(source, before);
  for (const mismatch of [
    { ...expected, digest: 'b'.repeat(64) },
    { ...expected, postscript: 'Another-Face' },
  ]) {
    const unavailable = nativeCharacterFeatureAdmission({ smallCaps: true }, source, mismatch);
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.reason, 'font-feature-metadata-identity-mismatch');
    assert.deepEqual(unavailable.missing, []);
  }
  source.features.length = 0;
  source.postscript = 'Changed-Face';
  assert.deepEqual(result.required, ['onum', 'smcp']);
  assert.deepEqual(result.derived, ['pnum']);
  assert.equal(result.font.postscript, 'Exact-Face');
  assert.ok(
    [result, result.required, result.missing, result.derived, result.font].every(Object.isFrozen),
  );
  assert.throws(() => {
    result.required.push('xxxx');
  }, TypeError);
});

test('malformed feature metadata is unavailable rather than mistaken for an empty declaration', () => {
  for (const features of [
    null,
    {},
    ['smcp', null],
    ['too-long'],
    [1],
    new Array(1),
    Array(4097).fill('smcp'),
  ]) {
    const result = nativeCharacterFeatureAdmission({ smallCaps: true }, metadata(features));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'font-feature-metadata-invalid');
    assert.deepEqual(result.missing, []);
  }
});

test('shipped exact-byte metadata admits actual CMU and Geist capabilities without a family-name fallback', async () => {
  for (const [file, style, status, missing] of [
    ['cmu-serif/cmunrm.ttf', { smallCaps: true, oldstyleFigures: true }, 'available', []],
    ['cmu-serif/cmunrm.ttf', { discretionaryLigatures: true }, 'missing', ['dlig']],
    [
      'geist/Geist-Variable.ttf',
      { fractions: true, ordinals: true, tabularFigures: true },
      'available',
      [],
    ],
    ['geist/Geist-Variable.ttf', { slashedZero: true }, 'missing', ['zero']],
  ]) {
    const bytes = await readFile(new URL('../../public/fonts/' + file, import.meta.url)),
      exact = { ...inspectFont(bytes), digest: createHash('sha256').update(bytes).digest('hex') },
      before = structuredClone(exact),
      result = nativeCharacterFeatureAdmission(style, exact);
    assert.equal(result.status, status, file);
    assert.deepEqual(result.missing, missing);
    assert.deepEqual(exact, before);
  }
});

test('stylistic sets combine independently and require declarations from the selected face', () => {
  const input = { stylisticSet1: true, stylisticSet9: true, stylisticSet20: false };
  assert.deepEqual(nativeCharacterStyle(input), { features: { ss01: true, ss09: true } });
  assert.deepEqual(nativeCharacterFeatureAdmission(input, metadata(['ss01'])).missing, ['ss09']);
  assert.deepEqual(nativeCharacterStyle({ stylisticSet20: true }), { features: { ss20: true } });
  for (const key of ['ss00', 'ss1', 'ss21'])
    assert.throws(() => nativeCharacterStyle({ features: { [key]: true } }));
});
