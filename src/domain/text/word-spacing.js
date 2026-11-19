export const DEFAULT_WORD_SPACING = Object.freeze({ minimum: 80, desired: 100, maximum: 133 });
const fields = ['minimum', 'desired', 'maximum'];
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** One atomic source value; `normal` preserves the earlier composer policy. */
export function normalizeWordSpacing(value) {
  if (value === 'normal') return value;
  const parts = typeof value === 'string' ? value.split(':') : null;
  if (!parts || parts.length !== 3 || parts.some((part) => !numeric.test(part.trim())))
    throw new TypeError('Word spacing requires minimum, desired and maximum percentages.');
  const values = parts.map(Number);
  if (values.some((number) => !Number.isFinite(number) || number < 0 || number > 1000))
    throw new TypeError('Word spacing percentages must be between 0 and 1000.');
  if (values[0] > values[1] || values[1] > values[2])
    throw new TypeError('Word spacing must satisfy minimum ≤ desired ≤ maximum.');
  return values.map((number) => String(number === 0 ? 0 : number)).join(':');
}

/** Native layout receives typed percentages; defaults never activate on read. */
export function wordSpacingSettings(value = 'normal') {
  const canonical = normalizeWordSpacing(value);
  return canonical === 'normal'
    ? null
    : Object.freeze(
        Object.fromEntries(
          canonical.split(':').map((part, index) => [fields[index], Number(part)]),
        ),
      );
}

export function wordSpacingValue(settings) {
  if (
    !settings ||
    typeof settings !== 'object' ||
    Array.isArray(settings) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(settings)) ||
    Object.keys(settings).some((field) => !fields.includes(field)) ||
    fields.some((field) => typeof settings[field] !== 'number')
  )
    throw new TypeError('Word spacing requires three numeric percentages.');
  return normalizeWordSpacing(fields.map((field) => String(settings[field])).join(':'));
}

/** Conservative shaping scope for the first native word-spacing capability.
 * Unicode and fixed-space behavior outside this scope retains the earlier composer.
 */
export function wordSpacingSourceError(text) {
  if (text.includes('\t')) return 'word spacing with tabs';
  if (/[^\S \u00a0\u202f\r\n\u2028\u2029]|\u0085/u.test(text))
    return 'word spacing with fixed or special spaces';
  if (/[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/u.test(text))
    return 'word spacing with bidirectional controls';
  if (
    /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]/u.test(
      text,
    )
  )
    return 'word spacing with unqualified writing systems';
  return null;
}
