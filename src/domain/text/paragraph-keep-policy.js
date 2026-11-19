export const PARAGRAPH_STARTS = Object.freeze({
  anywhere: 'Anywhere',
  column: 'In Next Column',
  frame: 'In Next Frame',
  page: 'On Next Page',
  odd: 'On Next Odd Page',
  even: 'On Next Even Page',
});

export const PARAGRAPH_KEEP_FIELDS = Object.freeze([
  'keepTogether',
  'keepWithNext',
  'keepWithPrevious',
  'keepNextLines',
  'paragraphStart',
]);

/** Normalize only placement rules. These never enter the native glyph-shaping request. */
export function normalizeParagraphKeeps(input, count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000)
    throw Error('Invalid paragraph keep policy count.');
  if (input !== undefined && (!Array.isArray(input) || input.length !== count))
    throw Error('Paragraph keep policy does not cover its source.');
  const policies = Array.from({ length: count }, (_, index) => {
    const value = input === undefined ? {} : input[index];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => !PARAGRAPH_KEEP_FIELDS.includes(key))
    )
      throw Error('Invalid paragraph keep policy fields.');
    const policy = {};
    for (const key of ['keepTogether', 'keepWithNext', 'keepWithPrevious']) {
      if (value[key] !== undefined && typeof value[key] !== 'boolean')
        throw Error('Invalid paragraph keep policy: ' + key + '.');
      if (key !== 'keepWithPrevious' || value[key]) policy[key] = value[key] ?? false;
    }
    if (value.keepNextLines !== undefined) {
      if (
        !Number.isInteger(value.keepNextLines) ||
        value.keepNextLines < 1 ||
        value.keepNextLines > 5
      )
        throw Error('Invalid paragraph keep policy: following line count.');
      if (value.keepNextLines > 1) policy.keepNextLines = value.keepNextLines;
    }
    if (value.paragraphStart !== undefined) {
      if (
        typeof value.paragraphStart !== 'string' ||
        !Object.hasOwn(PARAGRAPH_STARTS, value.paragraphStart)
      )
        throw Error('Invalid paragraph start location.');
      if (value.paragraphStart !== 'anywhere') policy.paragraphStart = value.paragraphStart;
    }
    return Object.freeze(policy);
  });
  return Object.freeze(policies);
}
