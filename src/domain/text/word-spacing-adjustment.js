import { fitJustification, justificationWidth } from './justification-fit.js';
import { wordSpacingSettings, wordSpacingValue } from './word-spacing.js';

export const WORD_SPACING_COST_POLICY = 'word-spacing-adjustment-cubic-v1';
const EPSILON = 0.0001,
  fields = ['minimumWidth', 'desiredWidth', 'maximumWidth', 'eligibleGaps', 'nominalSpaceWidth'],
  finite = (value) => Number.isFinite(value) && value >= 0 && value <= 1000000;

/** Native percentages are local shaping policy, separate from column geometry. */
export function normalizeWordSpacingPolicy(input) {
  return input === undefined || input === null
    ? null
    : wordSpacingSettings(wordSpacingValue(input));
}

/** Retain native capacities only after validating the exact affine space proof.
 * Width excludes trailing spaces; eligible leading/interior advances are actual
 * transformed font advances, with existing tracking preserved independently. */
export function wordSpacingMeasurement(row, policy) {
  const measured = row.wordSpacing;
  const advanced = policy.letterDesired !== undefined;
  if (
    !measured ||
    typeof measured !== 'object' ||
    Array.isArray(measured) ||
    Object.keys(measured).some(
      (field) =>
        field !== 'canSpreadGlyphs' &&
        !(advanced && ['letterBasis', 'physicalMinimum'].includes(field)) &&
        !fields.includes(field),
    ) ||
    ('canSpreadGlyphs' in measured && typeof measured.canSpreadGlyphs !== 'boolean') ||
    fields.some((field) => !finite(measured[field])) ||
    (advanced && (!finite(measured.letterBasis) || !finite(measured.physicalMinimum))) ||
    !Number.isSafeInteger(measured.eligibleGaps) ||
    measured.eligibleGaps > row.end - row.start ||
    measured.minimumWidth > measured.desiredWidth + EPSILON ||
    measured.desiredWidth > measured.maximumWidth + EPSILON ||
    (measured.eligibleGaps === 0) !== (measured.nominalSpaceWidth === 0) ||
    row.width - measured.nominalSpaceWidth < -EPSILON
  )
    throw Error('Native word-spacing measurement has invalid capacities.');
  if (advanced) {
    const floor = justificationWidth(
      row.width,
      measured.nominalSpaceWidth,
      measured.letterBasis,
      0,
      policy.letterMinimum,
      policy.glyphMinimum,
    );
    if (Math.abs(floor - measured.physicalMinimum) > Math.max(EPSILON, Math.abs(floor) * 2e-7))
      throw Error('Native justification measurement has an inconsistent physical minimum.');
  }
  for (const [percent, width] of [
    ['minimum', 'minimumWidth'],
    ['desired', 'desiredWidth'],
    ['maximum', 'maximumWidth'],
  ]) {
    const suffix = percent[0].toUpperCase() + percent.slice(1);
    const expected = advanced
      ? justificationWidth(
          row.width,
          measured.nominalSpaceWidth,
          measured.letterBasis,
          policy[percent],
          policy['letter' + suffix],
          policy['glyph' + suffix],
        )
      : row.width + measured.nominalSpaceWidth * (policy[percent] / 100 - 1);
    if (Math.abs(measured[width] - expected) > Math.max(EPSILON, Math.abs(expected) * 2e-7))
      throw Error('Native word-spacing measurement does not match its source percentages.');
  }
  return { ...measured };
}

/** The preference minimum is soft. Zero font-space is an owned admitted floor,
 * not an inferred universal InDesign limit; negative space tracking is gated. */
export function wordSpacingMinimumWidth(row, alignment) {
  return alignment.startsWith('justify')
    ? (row.wordSpacing.physicalMinimum ??
        Math.max(0, row.width - row.wordSpacing.nominalSpaceWidth))
    : row.wordSpacing.desiredWidth;
}

/** An owned finite badness, not Adobe's paragraph objective. Ordinary ragged rows
 * use desired spacing; justified final rows may condense down to their measured
 * preference minimum. Soft returns are nonfinal and justify normally.
 * Zero-gap justified rows preserve the existing native single-word fallback. */
export function adjustWordSpacing(row, availableWidth, alignment, last, desiredPolicy = 100) {
  if (desiredPolicy?.letterDesired !== undefined)
    return fitJustification(row, availableWidth, alignment, last, desiredPolicy);
  const desiredPercentage =
    typeof desiredPolicy === 'number' ? desiredPolicy : desiredPolicy.desired;
  const measured = row.wordSpacing,
    paragraphJustified = alignment.startsWith('justify'),
    justified = paragraphJustified && (!last || alignment === 'justify-all'),
    floor = justified
      ? Math.max(0, row.width - measured.nominalSpaceWidth)
      : paragraphJustified
        ? measured.minimumWidth
        : measured.desiredWidth;
  if (floor > availableWidth + 0.000001) return null;
  const underfilledWord =
      justified &&
      measured.eligibleGaps === 0 &&
      row.width > 0.000001 &&
      row.width < availableWidth,
    fallback = underfilledWord && measured.canSpreadGlyphs !== false,
    target =
      justified && measured.eligibleGaps > 0
        ? availableWidth
        : paragraphJustified && measured.eligibleGaps > 0
          ? Math.min(measured.desiredWidth, availableWidth)
          : measured.desiredWidth,
    delta = target - measured.desiredWidth,
    capacity =
      delta < 0
        ? measured.desiredWidth - measured.minimumWidth
        : measured.maximumWidth - measured.desiredWidth,
    ratio = delta === 0 ? 0 : capacity > 0.000001 ? delta / capacity : null,
    badness = ratio === null ? 10000 : Math.min(10000, 100 * Math.abs(ratio) ** 3),
    below = Math.max(0, measured.minimumWidth - target),
    above = Math.max(0, target - measured.maximumWidth),
    percentage = measured.nominalSpaceWidth
      ? Math.max(0, 100 * (1 + (target - row.width) / measured.nominalSpaceWidth))
      : desiredPercentage;
  if (!Number.isFinite(percentage))
    throw Error('Word-spacing target exceeds its finite adjustment budget.');
  return {
    fitsMinimum: availableWidth + 0.000001 >= measured.minimumWidth,
    visibleWidth: fallback ? availableWidth : target,
    scoreWidth: target,
    percentage,
    eligibleGaps: measured.eligibleGaps,
    nominalSpaceWidth: measured.nominalSpaceWidth,
    justified: justified || target < measured.desiredWidth,
    fallback: fallback ? 'single-word' : null,
    ratio,
    badness: underfilledWord
      ? 10000
      : (justified && measured.eligibleGaps > 0) || target < measured.desiredWidth
        ? badness
        : null,
    diagnostic: fallback
      ? {
          kind: 'native-no-gap-justification',
          amount: Math.max(0, availableWidth - target),
          percentage,
        }
      : below > EPSILON
        ? { kind: 'word-spacing-outside-minimum', amount: below, percentage }
        : above > EPSILON
          ? { kind: 'word-spacing-outside-maximum', amount: above, percentage }
          : null,
  };
}

/** Compare line alternatives using the space actually available to that fragment. */
export function paragraphLineCost(line, last) {
  const spacing = line.wordSpacing;
  const raggedness = last
    ? 0
    : 100 * ((line.width - (spacing?.scoreWidth ?? line.naturalWidth)) / line.width) ** 2;
  return 1 + line.penalty + (spacing?.badness ?? raggedness);
}
