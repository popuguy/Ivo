// Paragraphs contain runs of UTF-16 text or a single soft break. The caller
// supplies opaque style identities. Positions never refer to frames or pages.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const spaces = /^\p{Zs}+$/u;
const commands = new Set([
  'insertText',
  'insertReplacementText',
  'insertParagraph',
  'insertLineBreak',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
  'deleteSoftLineBackward',
  'deleteSoftLineForward',
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

// A word and the spaces following it form one deletion unit. Tabs and returns
// are individual units. Punctuation can form a run distinct from either word.
function wordEdge(parts, offset, backward) {
  const partAt = (at) => parts.containing(backward ? at - 1 : at);
  const boundary = (part) => (backward ? part.index : part.index + part.segment.length);
  const separator = (part) => /[\t\r\n\u2028\u2029]/u.test(part.segment);
  let at = offset;
  let part = partAt(at);
  if (backward && spaces.test(part.segment)) {
    at = part.index;
    part = partAt(at);
    if (!part || separator(part)) return at;
  }
  at = boundary(part);
  if (separator(part)) return at;
  if (!part.isWordLike && !spaces.test(part.segment)) {
    let adjacent;
    while (
      (adjacent = partAt(at)) &&
      !adjacent.isWordLike &&
      !spaces.test(adjacent.segment) &&
      !separator(adjacent)
    )
      at = boundary(adjacent);
  }
  if (!backward) {
    const next = partAt(at);
    if (next && spaces.test(next.segment)) at = boundary(next);
  }
  return at;
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
  const backward = type.endsWith('Backward');
  // A visual line range comes from the composed page. At its edge it is empty.
  if (collapsed && type.startsWith('deleteSoftLine')) return null;
  if (collapsed && type.startsWith('delete')) {
    const p = start.paragraph,
      content = plain(paragraphs[p]);
    if (backward && !start.offset) {
      if (!p) return null;
      start = { paragraph: p - 1, offset: plain(paragraphs[p - 1]).length };
    } else if (!backward && start.offset === content.length) {
      if (p + 1 === paragraphs.length) return null;
      end = { paragraph: p + 1, offset: 0 };
    } else if (type.startsWith('deleteWord')) {
      const parts = words.segment(content);
      const other = wordEdge(parts, start.offset, backward);
      let left = edge(content, Math.min(start.offset, other), false);
      let right = edge(content, Math.max(end.offset, other), true);
      // Smart spacing removes a single stranded separator when the entire
      // word disappears. Preserve intentional multiple spaces and punctuation.
      const part = parts.containing(left);
      if (part?.isWordLike && left === part.index && right === left + part.segment.length) {
        if (/^\p{Zs}[\p{L}\p{N}]/u.test(content.slice(right, right + 4))) right++;
        else if (
          right === content.length &&
          /[\p{L}\p{N}]\p{Zs}$/u.test(content.slice(Math.max(0, left - 4), left))
        )
          left--;
      }
      start = { paragraph: p, offset: left };
      end = { paragraph: p, offset: right };
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
