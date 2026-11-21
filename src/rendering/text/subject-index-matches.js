import { textIndexMap } from '../../shared/dom/text-selection.js';

/** Match printed words across inline font changes. Paragraphs and explicit line breaks
 * have separate source coordinates, so a phrase cannot bridge them accidentally. */
export function indexMatcher(topics, language) {
  const words = new Intl.Segmenter(language, { granularity: 'word' });
  const byFirst = new Map();
  for (const path of topics) {
    const term = path.at(-1),
      initial = words.segment(term)[Symbol.iterator]().next().value.segment;
    const group = byFirst.get(initial) || [];
    group.push({ term, title: JSON.stringify(path) });
    byFirst.set(initial, group);
  }
  return (root) => {
    const { segments } = textIndexMap(root);
    const found = [];
    for (let begin = 0; begin < segments.length;) {
      let end = begin + 1;
      while (end < segments.length && segments[end - 1].end === segments[end].start) end++;
      const text = segments
        .slice(begin, end)
        .map((part) => part.node.data)
        .join('');
      const pieces = words.segment(text);
      const base = segments[begin].start;
      let nodeIndex = begin;
      for (const { index, segment } of pieces) {
        const candidates = byFirst.get(segment);
        if (!candidates) continue;
        const at = base + index;
        while (nodeIndex + 1 < end && segments[nodeIndex].end <= at) nodeIndex++;
        for (const { term, title } of candidates) {
          if (!text.startsWith(term, index)) continue;
          const after = index + term.length;
          if (after < text.length && pieces.containing(after)?.index !== after) continue;
          const part = segments[nodeIndex];
          found.push({ title, at, first: part.node, offset: at - part.start });
        }
      }
      begin = end;
    }
    return found;
  };
}
