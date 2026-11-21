export const CASE_COMMANDS = Object.freeze({
  'case-uppercase': 'UPPERCASE',
  'case-lowercase': 'lowercase',
  'case-title': 'Title Case',
  'case-sentence': 'Sentence case',
});

// Each part belongs to an authored text run. Case whole words, including a
// final Greek sigma across two differently styled runs. Only the changed text
// is returned; links, paragraphs and run properties stay in their original nodes.
export function changeCaseParts(parts, command, locale = 'en-US', state = { sentenceStart: true }) {
  if (!Object.hasOwn(CASE_COMMANDS, command)) throw Error('Choose a text case.');
  const text = parts.join(''),
    output = parts.map(() => ''),
    segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  let part = 0,
    partStart = 0;
  for (const token of segmenter.segment(text)) {
    const word = token.segment,
      end = token.index + word.length;
    const capitalize =
      token.isWordLike &&
      (command === 'case-title' || (command === 'case-sentence' && state.sentenceStart));
    const convert = (value) => {
      if (!token.isWordLike) return value;
      if (command === 'case-uppercase') return value.toLocaleUpperCase(locale);
      const lower = value.toLocaleLowerCase(locale);
      return capitalize ? lower.replace(/\p{L}/u, (c) => c.toLocaleUpperCase(locale)) : lower;
    };
    const result = convert(word);
    let cursor = token.index,
      previous = 0;
    while (cursor < end) {
      while (part < parts.length && cursor >= partStart + parts[part].length)
        partStart += parts[part++].length;
      const next = Math.min(end, partStart + parts[part].length);
      const cut =
        next === end
          ? result.length
          : Math.min(result.length, convert(word.slice(0, next - token.index)).length);
      output[part] += result.slice(previous, cut);
      cursor = next;
      previous = cut;
    }
    if (token.isWordLike && /\p{L}/u.test(word)) state.sentenceStart = false;
    else if (/[.!?。！？\r\n]/u.test(word)) state.sentenceStart = true;
  }
  return output;
}
