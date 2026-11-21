// Word lists belong to the document. Store spelling and breaks together so a vault
// remains portable and the editor never inserts dictionary marks into source text.
export function exceptionLanguage(tag) {
  try {
    const locale = new Intl.Locale(tag);
    return locale.language === 'en'
      ? 'en-' + (locale.region || 'US').toLowerCase()
      : locale.baseName
          .split('-')
          .filter((part, i) => i === 0 || part !== locale.region)
          .join('-')
          .toLowerCase();
  } catch {
    return null;
  }
}

export function parseException(entry, language) {
  if (typeof entry !== 'string' || !entry || entry.length > 256)
    throw Error('Enter a word of up to 128 letters.');
  const value = entry.normalize('NFC').toLocaleLowerCase(language);
  const plain = value.replace(/^~/, '');
  if (
    !/^(?:\p{L}\p{M}*)+(?:~(?:\p{L}\p{M}*)+)*$/u.test(plain) ||
    (value.startsWith('~') && plain.includes('~'))
  )
    throw Error('Use a single ~ between syllables or at the start to prevent breaks.');
  const segments = plain.split('~'),
    word = segments.join('');
  if (word.length > 128) throw Error('Enter a word of up to 128 letters.');
  const breaks = [];
  let pos = 0;
  for (const part of segments.slice(0, -1)) {
    pos += part.length;
    breaks.push(pos);
  }
  return { word, breaks, entry: breaks.length ? plain : '~' + word };
}

export function hyphenationExceptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 64)
    throw Error('Invalid document hyphenation dictionary.');
  let count = 0;
  const result = {};
  for (const [language, words] of Object.entries(value)) {
    if (exceptionLanguage(language) !== language || !Array.isArray(words))
      throw Error('Invalid dictionary language or word list.');
    const known = new Set(),
      entries = [];
    for (const item of words) {
      const parsed = parseException(item, language);
      if (known.has(parsed.word)) throw Error('Duplicate dictionary word: ' + parsed.word);
      if (++count > 4096) throw Error('The document dictionary supports up to 4096 entries.');
      entries.push(parsed.entry);
      known.add(parsed.word);
    }
    if (entries.length) result[language] = entries;
  }
  return result;
}

const indexes = new WeakMap();
export function indexHyphenationExceptions(settings) {
  if (indexes.has(settings)) return indexes.get(settings);
  const index = new Map(
    Object.entries(settings || {}).map(([language, entries]) => [
      language,
      new Map(
        entries.map((entry) => {
          const { word, breaks } = parseException(entry, language);
          return [word, breaks];
        }),
      ),
    ]),
  );
  indexes.set(settings, index);
  return index;
}
