// Settings belong to a paragraph. Break points and painted hyphens are derived.
export const HYPHENATION_FIELDS = Object.freeze({
  hyphenWordLength: {
    attr: 'hypword',
    label: 'Words with at Least',
    unit: 'letters',
    initial: 5,
    min: 2,
    max: 128,
  },
  hyphenAfterFirst: {
    attr: 'hypfirst',
    label: 'After First',
    unit: 'letters',
    initial: 2,
    min: 1,
    max: 128,
  },
  hyphenBeforeLast: {
    attr: 'hyplast',
    label: 'Before Last',
    unit: 'letters',
    initial: 2,
    min: 1,
    max: 128,
  },
  hyphenLimit: {
    attr: 'hyplimit',
    label: 'Hyphen Limit',
    unit: 'lines (0 = unlimited)',
    initial: 3,
    min: 0,
    max: 100,
  },
  hyphenZone: {
    attr: 'hypzone',
    label: 'Hyphenation Zone',
    unit: 'pt',
    initial: 36,
    min: 0,
    max: 14400,
    fractional: true,
  },
  hyphenCapitals: { attr: 'hypcaps', label: 'Hyphenate Capitalized Words', initial: true },
  hyphenLastWord: { attr: 'hypfinal', label: 'Hyphenate Last Word', initial: true },
});
export const HYPHENATION_DEFAULTS = Object.freeze(
  Object.fromEntries(
    Object.entries(HYPHENATION_FIELDS).map(([key, field]) => [key, field.initial]),
  ),
);
export const HYPHENATION_ATTRIBUTES = Object.freeze(
  Object.fromEntries(Object.entries(HYPHENATION_FIELDS).map(([key, field]) => [key, field.attr])),
);
const byAttribute = new Map(Object.values(HYPHENATION_FIELDS).map((field) => [field.attr, field]));
export function validHyphenationAttribute(attr, value) {
  const field = byAttribute.get(attr);
  if (!field) return null;
  if (typeof field.initial === 'boolean') return ['true', 'false'].includes(value) ? value : null;
  const n = Number(value);
  return String(value).trim() !== '' &&
    Number.isFinite(n) &&
    (field.fractional || Number.isInteger(n)) &&
    n >= field.min &&
    n <= field.max
    ? String(n)
    : null;
}
export function customHyphenation(settings, mixed = []) {
  return Object.entries(HYPHENATION_DEFAULTS).some(
    ([key, initial]) =>
      mixed.includes(key) || (settings[key] !== undefined && settings[key] !== initial),
  );
}
