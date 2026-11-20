import { OPENTYPE_FEATURES, TEXT_DEFAULTS, validTextAttribute } from './typography.js';

const scalarBounds = Object.freeze({
    baselineShift: Object.freeze([-2000, 2000]),
    horizontalScale: Object.freeze([10, 1000]),
    verticalScale: Object.freeze([10, 1000]),
  }),
  featureFields = Object.freeze(
    Object.fromEntries(
      [
        'discretionaryLigatures',
        'smallCaps',
        'oldstyleFigures',
        'tabularFigures',
        'slashedZero',
        'fractions',
        'ordinals',
        'stylisticAlternates',
      ].map((field) => [field, OPENTYPE_FEATURES[field]]),
    ),
  ),
  featureTags = new Set(Object.values(featureFields)),
  identity = Object.freeze({});

export const NATIVE_CHARACTER_STYLE_FIELDS = Object.freeze([
  'fontVariations',
  ...Object.keys(scalarBounds),
  ...Object.keys(featureFields),
]);

function object(value, name) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError('Invalid native character ' + name + '.');
}

function project(input) {
  object(input, 'style');
  const result = {},
    features = {};
  for (const [field, [minimum, maximum]] of Object.entries(scalarBounds)) {
    const value = Object.hasOwn(input, field) ? input[field] : undefined;
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < minimum || value > maximum)
      throw new TypeError('Invalid native character ' + field + '.');
    if (value !== TEXT_DEFAULTS[field]) result[field] = value;
  }
  for (const [field, tag] of Object.entries(featureFields)) {
    const value = Object.hasOwn(input, field) ? input[field] : undefined;
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new TypeError('Invalid native character ' + field + '.');
    features[tag] = value;
  }
  if (Object.hasOwn(input, 'features') && input.features !== undefined) {
    object(input.features, 'features');
    for (const [tag, value] of Object.entries(input.features)) {
      if (!featureTags.has(tag) || typeof value !== 'boolean')
        throw new TypeError('Invalid native character OpenType feature: ' + tag + '.');
      if (Object.hasOwn(features, tag) && features[tag] !== value)
        throw new TypeError('Conflicting native character OpenType feature: ' + tag + '.');
      features[tag] = value;
    }
  }
  const enabled = Object.fromEntries(
    Object.keys(features)
      .filter((tag) => features[tag])
      .sort()
      .map((tag) => [tag, true]),
  );
  const axes = {};
  if (input.fontVariations !== undefined && input.fontVariations !== 'normal') {
    const value = validTextAttribute('axes', input.fontVariations);
    if (!value) throw new TypeError('Invalid variable font coordinates.');
    for (const pair of value.split(',')) {
      const [tag, coordinate] = pair.split(':');
      axes[tag] = Number(coordinate);
    }
  }
  if (input.variations !== undefined) {
    object(input.variations, 'variations');
    for (const [tag, value] of Object.entries(input.variations)) {
      if (
        !/^[A-Za-z0-9]{4}$/.test(tag) ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e6 ||
        (Object.hasOwn(axes, tag) && axes[tag] !== value)
      )
        throw new TypeError('Invalid variable font coordinate.');
      axes[tag] = value;
    }
  }
  const tags = Object.keys(axes).sort();
  if (tags.length > 16) throw new TypeError('Too many variable font coordinates.');
  if (tags.length)
    result.variations = Object.freeze(Object.fromEntries(tags.map((tag) => [tag, axes[tag]])));
  if (Object.keys(enabled).length) result.features = Object.freeze(enabled);
  return Object.keys(result).length ? Object.freeze(result) : identity;
}

/** Sparse protocol4 character fields. Defaults retain the existing protocol identity.
 * The effective style is already resolved; no font choice or inherited style is invented here.
 * Existing liga/ligatures, case mapping, variable axes and paragraph policy remain separate.
 */
export function nativeCharacterStyle(style = {}) {
  return project(style);
}

/** Accept either effective camelcase authoring fields or a projected native run. */
export function hasNondefaultNativeCharacter(styleOrRun = {}) {
  return Object.keys(project(styleOrRun)).length > 0;
}

/** Explicitly enabled font features; derived proportional-figure policy is not mandatory. */
export function requiredNativeCharacterFeatures(styleOrRun = {}) {
  return Object.freeze(Object.keys(project(styleOrRun).features || {}));
}

function metadataSnapshot(metadata, expected) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return { reason: 'font-feature-metadata-unavailable' };
  if (
    typeof metadata.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(metadata.digest) ||
    typeof metadata.postscript !== 'string' ||
    !metadata.postscript ||
    metadata.postscript.length > 120 ||
    !Object.hasOwn(metadata, 'features') ||
    metadata.features === undefined
  )
    return { reason: 'font-feature-metadata-unavailable' };
  if (
    !Array.isArray(metadata.features) ||
    metadata.features.length > 4096 ||
    Array.from(metadata.features).some(
      (tag) => typeof tag !== 'string' || !/^[\x20-\x7e]{4}$/.test(tag),
    )
  )
    return { reason: 'font-feature-metadata-invalid' };
  if (
    expected &&
    (metadata.digest !== expected.digest || metadata.postscript !== expected.postscript)
  )
    return { reason: 'font-feature-metadata-identity-mismatch' };
  return {
    font: Object.freeze({ digest: metadata.digest, postscript: metadata.postscript }),
    tags: new Set(metadata.features),
  };
}

/** Admission from caller-verified exact-font metadata, never a font-name substitution.
 * Missing/old metadata remains unavailable; a known empty feature list is affirmative
 * absence. This pure boundary does not fetch/hash bytes, and never treats no visible
 * substitution in one sample as evidence that an available feature is missing.
 */
export function nativeCharacterFeatureAdmission(styleOrRun = {}, metadata, expected) {
  const projection = project(styleOrRun),
    required = Object.freeze(Object.keys(projection.features || {})),
    known = required.length
      ? metadataSnapshot(metadata, expected)
      : { font: null, tags: new Set() },
    missing = Object.freeze(known.tags ? required.filter((tag) => !known.tags.has(tag)) : []),
    derived = Object.freeze(
      projection.features?.onum && !projection.features?.tnum && known.tags?.has('pnum')
        ? ['pnum']
        : [],
    );
  return Object.freeze({
    status: known.reason ? 'unavailable' : missing.length ? 'missing' : 'available',
    required,
    missing,
    derived,
    reason: known.reason || (missing.length ? 'font-feature-not-declared' : null),
    font: known.font || null,
  });
}
