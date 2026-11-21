/** A topic path ends with the exact word or phrase to find on printed pages. */
export function indexSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Check the index settings.');
  const { title = 'Index', topics, ranges = true } = value;
  if (
    typeof title !== 'string' ||
    title.length > 256 ||
    typeof ranges !== 'boolean' ||
    !Array.isArray(topics) ||
    !topics.length ||
    topics.length > 256
  )
    throw Error('Enter between 1 and 256 index topics.');
  const unique = new Map();
  for (const path of topics) {
    if (
      !Array.isArray(path) ||
      path.length < 1 ||
      path.length > 4 ||
      path.some(
        (part) =>
          typeof part !== 'string' ||
          !part.trim() ||
          part.length > 160 ||
          /[\p{C}]/u.test(part) ||
          part.includes('>'),
      )
    )
      throw Error('Each topic needs one to four nonempty levels of up to 160 characters.');
    const names = path.map((part) => part.trim());
    unique.set(JSON.stringify(names), names);
  }
  return { title, topics: [...unique.values()], ranges };
}
