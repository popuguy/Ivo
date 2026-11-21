import { ID_PATTERN, LIMITS } from './constants.js';

export function publicationSettings(value, ownerId) {
  if (
    !value ||
    value.version !== 1 ||
    Object.keys(value).some(
      (k) => !['version', 'order', 'excluded', 'chapters', 'headings'].includes(k),
    )
  )
    throw Error('Unsupported publication settings.');
  function ids(key, max) {
    const entries = value[key];
    if (
      !Array.isArray(entries) ||
      entries.length > max ||
      entries.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id)) ||
      new Set(entries).size !== entries.length
    )
      throw Error('Invalid publication ' + key + '.');
    return [...entries];
  }
  const chapters = ids('chapters', LIMITS.documents);
  if (chapters.length && !chapters.includes(ownerId))
    throw Error('The book must include its owning document.');
  const headings = value.headings ?? {};
  if (
    !headings ||
    typeof headings !== 'object' ||
    Array.isArray(headings) ||
    Object.entries(headings).some(
      ([id, level]) => !ID_PATTERN.test(id) || !Number.isInteger(level) || level < 2 || level > 6,
    )
  )
    throw Error('Invalid publication heading level.');
  return {
    ...(Object.keys(headings).length ? { headings: { ...headings } } : {}),
    version: 1,
    order: ids('order', LIMITS.blocksPerDocument),
    excluded: ids('excluded', LIMITS.blocksPerDocument),
    chapters,
  };
}

/** IDs outlive a frame move. A complete flow is one reading unit, even across pages. */
export function orderPublicationEntries(entries, settings, { includeExcluded = false } = {}) {
  const rank = new Map(settings?.order.map((id, i) => [id, i]) || []),
    excluded = new Set(settings?.excluded);
  return entries
    .filter((entry) => includeExcluded || !excluded.has(entry.id))
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? entries.length + rank.size) -
        (rank.get(b.id) ?? entries.length + rank.size),
    );
}
