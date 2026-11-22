export const DEFAULT_WORD_SPACING = Object.freeze({ minimum: 80, desired: 100, maximum: 133 });
export const JUSTIFICATION_GROUPS = Object.freeze([
  { label: 'Word Spacing', prefix: '', min: 0, max: 1000, defaults: [80, 100, 133] },
  { label: 'Letter Spacing', prefix: 'letter', min: -100, max: 500, defaults: [0, 0, 0] },
  { label: 'Glyph Scaling', prefix: 'glyph', min: 50, max: 200, defaults: [100, 100, 100] },
]);
export const DEFAULT_JUSTIFICATION = JUSTIFICATION_GROUPS.map(({ defaults }) =>
  defaults.join(':'),
).join('|');
const fields = ['minimum', 'desired', 'maximum'];
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function spacingField(prefix, field) {
  return prefix ? prefix + field[0].toUpperCase() + field.slice(1) : field;
}

/** Older documents store one triple. Explicit letter/glyph limits use three. */
export function normalizeWordSpacing(value) {
  if (value === 'normal') return value;
  const groups = typeof value === 'string' ? value.split('|') : [];
  if (![1, 3].includes(groups.length))
    throw new TypeError('Word spacing requires minimum, desired and maximum percentages.');
  return groups
    .map((group, index) => {
      const { min, max } = JUSTIFICATION_GROUPS[index];
      const label = index ? JUSTIFICATION_GROUPS[index].label : 'Word spacing';
      const parts = group.split(':');
      if (parts.length !== 3 || parts.some((part) => !numeric.test(part.trim())))
        throw new TypeError(label + ' requires minimum, desired and maximum percentages.');
      const values = parts.map(Number);
      if (values.some((number) => !Number.isFinite(number) || number < min || number > max))
        throw new TypeError(label + ' percentages must be between ' + min + ' and ' + max + '.');
      if (values[0] > values[1] || values[1] > values[2])
        throw new TypeError(label + ' must satisfy minimum ≤ desired ≤ maximum.');
      return values.join(':');
    })
    .join('|');
}
export function wordSpacingSettings(value = 'normal') {
  const canonical = normalizeWordSpacing(value);
  if (canonical === 'normal') return null;
  return Object.freeze(
    Object.fromEntries(
      canonical
        .split('|')
        .flatMap((group, i) =>
          group
            .split(':')
            .map((part, j) => [
              spacingField(JUSTIFICATION_GROUPS[i].prefix, fields[j]),
              Number(part),
            ]),
        ),
    ),
  );
}
export function wordSpacingValue(settings) {
  if (
    !settings ||
    typeof settings !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(settings))
  )
    throw new TypeError('Word spacing requires three or nine numeric percentages.');
  const groups = Object.hasOwn(settings, 'letterDesired')
    ? JUSTIFICATION_GROUPS
    : JUSTIFICATION_GROUPS.slice(0, 1);
  if (Object.keys(settings).length !== groups.length * 3)
    throw new TypeError('Word spacing requires three or nine numeric percentages.');
  const values = groups.map(({ prefix }) =>
    fields
      .map((field) => {
        const v = settings[spacingField(prefix, field)];
        if (typeof v !== 'number')
          throw new TypeError('Word spacing requires numeric percentages.');
        return v;
      })
      .join(':'),
  );
  return normalizeWordSpacing(values.join('|'));
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
