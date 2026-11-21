/** A topic path ends with the exact word or phrase to find on printed pages. */
function cleanPath(path) {
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
  return path.map((part) => part.trim());
}
export function indexSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Check the index settings.');
  const { title = 'Index', topics, ranges = true, references = [], sortKeys = [] } = value;
  if (
    (value.includeBook !== undefined && typeof value.includeBook !== 'boolean') ||
    typeof title !== 'string' ||
    title.length > 256 ||
    typeof ranges !== 'boolean' ||
    !Array.isArray(topics) ||
    !topics.length ||
    topics.length > 256
  )
    throw Error('Enter between 1 and 256 index topics.');
  if (
    !Array.isArray(references) ||
    references.length > 256 ||
    !Array.isArray(sortKeys) ||
    sortKeys.length > 256
  )
    throw Error('Use up to 256 index references and sort keys.');
  const unique = new Map(),
    known = new Set();
  function register(path) {
    for (let i = 1; i <= path.length; i++) known.add(JSON.stringify(path.slice(0, i)));
  }
  for (const raw of topics) {
    const path = cleanPath(raw);
    unique.set(JSON.stringify(path), path);
    register(path);
  }
  const refs = new Map(),
    keys = new Map(),
    redirects = new Map(),
    also = new Set();
  for (const ref of references) {
    if (!ref || !['see', 'also'].includes(ref.kind)) throw Error('Choose See or See also.');
    const from = cleanPath(ref.from),
      to = cleanPath(ref.to),
      source = JSON.stringify(from),
      target = JSON.stringify(to);
    if (source === target) throw Error('An index reference must point to another topic.');
    if (!known.has(target)) throw Error('Add the reference destination to Topics.');
    if (ref.kind === 'see') {
      if (also.has(source) || (redirects.has(source) && redirects.get(source) !== target))
        throw Error('A See entry has one destination.');
      redirects.set(source, target);
    } else {
      if (redirects.has(source)) throw Error('Choose either See or See also for a topic.');
      also.add(source);
    }
    refs.set(JSON.stringify([source, ref.kind, target]), { from, kind: ref.kind, to });
  }
  for (const { from, to } of refs.values()) {
    register(from);
    if (redirects.has(JSON.stringify(to)))
      throw Error('Point references directly to a topic with entries.');
  }
  for (const item of sortKeys) {
    const path = cleanPath(item?.path),
      key = item?.key;
    if (
      !known.has(JSON.stringify(path)) ||
      typeof key !== 'string' ||
      !key.trim() ||
      key.length > 160 ||
      /[\p{C}]/u.test(key)
    )
      throw Error('Give an existing topic a nonempty sort key of up to 160 characters.');
    keys.set(JSON.stringify(path), { path, key: key.trim() });
  }
  return {
    title,
    ...(value.includeBook && { includeBook: true }),
    topics: [...unique.values()],
    ranges,
    ...(refs.size && { references: [...refs.values()] }),
    ...(keys.size && { sortKeys: [...keys.values()] }),
  };
}
