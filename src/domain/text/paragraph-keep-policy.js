export const PARAGRAPH_KEEP_FIELDS = Object.freeze(['keepTogether', 'keepWithNext']);

/** Renderer-owned All/Next1 policy. Default widow/orphan counts do not activate
 * partial keeps. No native shaping fields or saved layout are introduced here. */
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
    for (const key of PARAGRAPH_KEEP_FIELDS) {
      if (value[key] !== undefined && typeof value[key] !== 'boolean')
        throw Error('Invalid paragraph keep policy: ' + key + '.');
      policy[key] = value[key] ?? false;
    }
    return Object.freeze(policy);
  });
  return Object.freeze(policies);
}
