// Paragraphs contain runs of UTF-16 text or a single soft break. The caller
// supplies opaque style identities. Positions never refer to frames or pages.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const commands = new Set([
  'insertText',
  'insertReplacementText',
  'insertParagraph',
  'insertLineBreak',
  'deleteContentBackward',
  'deleteContentForward',
]);

export function isDocumentTextEdit(type) {
  return commands.has(type);
}

function plain(paragraph) {
  return paragraph.runs.map((run) => (run.break ? '\n' : run.text)).join('');
}

function sliceRuns(runs, start, end) {
  const result = [];
  let offset = 0;
  for (const run of runs) {
    const length = run.break ? 1 : run.text.length;
    const from = Math.max(0, start - offset);
    const to = Math.min(length, end - offset);
    if (to > from)
      result.push(from === 0 && to === length ? run : { ...run, text: run.text.slice(from, to) });
    offset += length;
    if (offset >= end) break;
  }
  return result;
}

function edge(text, offset, end) {
  if (offset === text.length || offset === 0) return offset;
  const part = graphemes.segment(text).containing(offset);
  return end && offset !== part.index ? part.index + part.segment.length : part.index;
}

// Return only the changed paragraph window. Unaffected paragraphs keep their
// identity. A null result is an admitted no-op (e.g. Backspace at document start).
export function editParagraphs(paragraphs, anchor, focus, { type, text = '', style }) {
  if (!isDocumentTextEdit(type)) throw new TypeError('Unknown text operation.');
  for (const { paragraph, offset } of [anchor, focus]) {
    if (
      !Number.isInteger(paragraph) ||
      !paragraphs[paragraph] ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > plain(paragraphs[paragraph]).length
    )
      throw new RangeError('Text position is outside its paragraph.');
  }
  let [start, end] =
    anchor.paragraph < focus.paragraph ||
    (anchor.paragraph === focus.paragraph && anchor.offset <= focus.offset)
      ? [anchor, focus]
      : [focus, anchor];
  const collapsed = start.paragraph === end.paragraph && start.offset === end.offset;
  const backward = type === 'deleteContentBackward';
  if (collapsed && (backward || type === 'deleteContentForward')) {
    const p = start.paragraph,
      content = plain(paragraphs[p]);
    if (backward && !start.offset) {
      if (!p) return null;
      start = { paragraph: p - 1, offset: plain(paragraphs[p - 1]).length };
    } else if (!backward && start.offset === content.length) {
      if (p + 1 === paragraphs.length) return null;
      end = { paragraph: p + 1, offset: 0 };
    } else {
      const unit = graphemes.segment(content).containing(start.offset - (backward ? 1 : 0));
      start = { paragraph: p, offset: unit.index };
      end = { paragraph: p, offset: unit.index + unit.segment.length };
    }
  } else {
    start = { ...start, offset: edge(plain(paragraphs[start.paragraph]), start.offset, false) };
    end = collapsed
      ? start
      : { ...end, offset: edge(plain(paragraphs[end.paragraph]), end.offset, true) };
  }
  const first = paragraphs[start.paragraph],
    last = paragraphs[end.paragraph];
  const before = sliceRuns(first.runs, 0, start.offset);
  const after = sliceRuns(last.runs, end.offset, Infinity);
  // An explicit caret style distinguishes two sides of the same run boundary.
  const insertionStyle =
    style ??
    (collapsed ? before.at(-1)?.style : undefined) ??
    sliceRuns(first.runs, start.offset, start.offset + 1)[0]?.style ??
    first.emptyStyle;
  let inserted = [];
  if (type === 'insertLineBreak') inserted = [{ break: true, style: insertionStyle }];
  else if (type === 'insertText' || type === 'insertReplacementText') {
    if (!text && collapsed) return null;
    if (text) inserted = [{ text, style: insertionStyle }];
  }
  const split = type === 'insertParagraph';
  const replacement = split
    ? [
        { block: first.block, runs: before, emptyStyle: insertionStyle },
        { block: first.block, runs: after, emptyStyle: insertionStyle },
      ]
    : [
        {
          block: first.block,
          runs: [...before, ...inserted, ...after],
          emptyStyle: insertionStyle,
        },
      ];
  return {
    from: start.paragraph,
    through: end.paragraph,
    replacement,
    caret: {
      paragraph: split ? 1 : 0,
      offset: split ? 0 : start.offset + (inserted[0]?.break ? 1 : inserted[0]?.text.length || 0),
    },
    range: { start, end },
  };
}
