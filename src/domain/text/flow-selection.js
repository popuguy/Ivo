/**
 * Logical text positions are UTF-16 offsets, independent of pages and columns.
 * Callers supply text aligned to textIndexMap, including virtual block/BR marks;
 * this module neither flattens HTML nor invents a second source representation.
 */
function position(value, length = Infinity) {
  const index = typeof value === 'number' ? value : value?.index;
  if (!Number.isSafeInteger(index)) throw new TypeError('A text position needs an integer index.');
  if (length !== Infinity && (!Number.isSafeInteger(length) || length < 0))
    throw new TypeError('A text length must be a nonnegative integer.');
  const affinity = typeof value === 'object' ? value.affinity : undefined;
  if (affinity !== undefined && !['forward', 'backward'].includes(affinity))
    throw new TypeError('Unknown text affinity.');
  return { index: Math.max(0, Math.min(length, index)), affinity: affinity || 'forward' };
}

/** Preserve direction/affinity while exposing a normalized half-open range. */
export function logicalSelection(anchor, focus = anchor, { length = Infinity } = {}) {
  anchor = position(anchor, length);
  focus = position(focus, length);
  return {
    anchor,
    focus,
    start: Math.min(anchor.index, focus.index),
    end: Math.max(anchor.index, focus.index),
    backward: focus.index < anchor.index,
    collapsed: focus.index === anchor.index,
  };
}

/**
 * Clip a logical range into disposable frame/column intervals. A collapsed caret
 * paints no range; an empty frame has no selected glyphs. Positive intervals
 * containing only a paragraph mark remain selected even when they have no text.
 */
export function selectionIntervals(selection, intervals) {
  const range = logicalSelection(selection.anchor, selection.focus);
  if (range.collapsed) return [];
  return intervals.flatMap((interval) => {
    const start = Math.max(range.start, interval.start),
      end = Math.min(range.end, interval.end);
    return end > start ? [{ ...interval, start, end }] : [];
  });
}

/** One caret owner at a shared boundary; affinity never selects both columns. */
export function caretInterval(point, intervals) {
  const { index, affinity } = position(point),
    at = (interval) => index >= interval.start && index <= interval.end,
    candidates = intervals.filter(at);
  if (!candidates.length) return null;
  const edge = candidates.filter((interval) =>
    affinity === 'backward' ? interval.end === index : interval.start === index,
  );
  return (affinity === 'backward' ? edge.at(-1) : edge[0]) || candidates[0];
}

function segments(text, granularity, locale) {
  return [...new Intl.Segmenter(locale, { granularity }).segment(text)];
}
function graphemeEdges(text, locale) {
  return [...segments(text, 'grapheme', locale).map((part) => part.index), text.length];
}
function direction(value) {
  if (!['forward', 'backward'].includes(value)) throw new TypeError('Unknown text direction.');
  return value;
}

/** Snap a partial UTF-16 hit away from surrogate, combining and ZWJ interiors. */
export function snapTextPosition(text, point, { locale } = {}) {
  const current = position(point, text.length),
    edges = graphemeEdges(text, locale);
  if (edges.includes(current.index)) return current;
  const index =
    current.affinity === 'backward'
      ? edges.findLast((edge) => edge < current.index)
      : edges.find((edge) => edge > current.index);
  return { ...current, index };
}

/**
 * Supplied paragraph intervals preserve structural/empty paragraph marks exactly.
 * Without them, LF/CR/paragraph separators in the aligned logical text delimit
 * paragraphs. Sequential separators intentionally produce empty paragraphs.
 */
function paragraphIntervals(text, supplied) {
  if (supplied) return supplied;
  const result = [];
  let start = 0;
  for (const match of text.matchAll(/\r\n|[\n\r\u2029]/g)) {
    result.push({ start, end: match.index + match[0].length });
    start = match.index + match[0].length;
  }
  result.push({ start, end: text.length });
  return result;
}

/**
 * Logical movement, not visual bidi/line navigation. Word steps end/start at
 * Unicode word-like segments; paragraph steps use authored structural ranges.
 * Visual left/right/up/down requires the composition's glyph/line map.
 */
export function moveTextPosition(
  text,
  point,
  { direction: requested = 'forward', unit = 'grapheme', locale, paragraphs } = {},
) {
  const way = direction(requested),
    current = position(point, text.length),
    forward = way === 'forward';
  let index;
  if (unit === 'flow') index = forward ? text.length : 0;
  else if (unit === 'grapheme') {
    const edges = graphemeEdges(text, locale);
    index = forward
      ? edges.find((edge) => edge > current.index)
      : edges.findLast((edge) => edge < current.index);
  } else if (unit === 'word') {
    const words = segments(text, 'word', locale).filter((part) => part.isWordLike);
    index = forward
      ? words.map((part) => part.index + part.segment.length).find((edge) => edge > current.index)
      : words.map((part) => part.index).findLast((edge) => edge < current.index);
  } else if (unit === 'paragraph') {
    const ranges = paragraphIntervals(text, paragraphs);
    index = forward
      ? ranges.map((part) => part.end).find((edge) => edge > current.index)
      : ranges.map((part) => part.start).findLast((edge) => edge < current.index);
  } else throw new TypeError('Unknown text movement unit.');
  return {
    index: index ?? (forward ? text.length : 0),
    affinity: forward ? 'backward' : 'forward',
  };
}

/** Extend focus while retaining its anchor, or collapse before ordinary movement. */
export function moveTextSelection(text, selection, { extend = false, ...options } = {}) {
  const range = logicalSelection(selection.anchor, selection.focus, { length: text.length }),
    way = direction(options.direction || 'forward');
  if (!extend && !range.collapsed) {
    const edge = way === 'forward' ? range.end : range.start,
      point = snapTextPosition(
        text,
        { index: edge, affinity: way === 'forward' ? 'backward' : 'forward' },
        options,
      );
    return logicalSelection(point);
  }
  const focus = moveTextPosition(text, range.focus, options);
  return logicalSelection(extend ? range.anchor : focus, focus, { length: text.length });
}

/** Double-click word range; non-word segments retain whitespace/punctuation scope. */
export function wordSelection(text, point, { locale } = {}) {
  const current = position(point, text.length),
    parts = segments(text, 'word', locale),
    before = parts.findLast((part) => part.index + part.segment.length === current.index),
    containing = parts.find(
      (part) => current.index >= part.index && current.index < part.index + part.segment.length,
    ),
    part = current.affinity === 'backward' ? before || containing : containing || before;
  if (!part) return logicalSelection(current);
  return logicalSelection(
    { index: part.index, affinity: 'forward' },
    { index: part.index + part.segment.length, affinity: 'backward' },
  );
}

/** Paragraph range, including its authored mark; empty paragraphs retain a caret. */
export function paragraphSelection(text, point, { paragraphs } = {}) {
  const current = position(point, text.length),
    part = caretInterval(current, paragraphIntervals(text, paragraphs));
  return part
    ? logicalSelection(
        { index: part.start, affinity: 'forward' },
        { index: part.end, affinity: 'backward' },
      )
    : logicalSelection(current);
}

function lowerBound(values, target) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}
function upperBound(values, target) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}
function rangeSelection(part, fallback) {
  return part
    ? logicalSelection(
        { index: part.start, affinity: 'forward' },
        { index: part.end, affinity: 'backward' },
      )
    : logicalSelection(fallback);
}

/**
 * Navigation index for one immutable logical source generation. Segmentation is
 * lazy and reused by repeated arrow, word and range operations. Keep this object
 * in view state and replace it when source/locale/paragraph structure changes.
 * The exposed grapheme boundary array is frozen; document source is never owned
 * or changed here. Visual bidi/line movement still requires composition geometry.
 */
export function createTextNavigation(text, { locale, paragraphs } = {}) {
  let graphemes, words, paragraphIndex;
  const authoredParagraphs = paragraphs?.map((part) => ({ ...part }));
  function graphemeIndex() {
    if (!graphemes) {
      const values = [];
      for (const part of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text))
        values.push(part.index);
      values.push(text.length);
      graphemes = Object.freeze(values);
    }
    return graphemes;
  }
  function wordIndex() {
    if (!words) {
      const parts = [],
        starts = [],
        ends = [],
        wordStarts = [],
        wordEnds = [];
      for (const part of new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)) {
        const end = part.index + part.segment.length;
        parts.push({ start: part.index, end });
        starts.push(part.index);
        ends.push(end);
        if (part.isWordLike) {
          wordStarts.push(part.index);
          wordEnds.push(end);
        }
      }
      words = { parts, starts, ends, wordStarts, wordEnds };
    }
    return words;
  }
  function paragraphData() {
    if (!paragraphIndex) {
      const parts = paragraphIntervals(text, authoredParagraphs),
        starts = parts.map((part) => part.start),
        ends = parts.map((part) => part.end),
        ordered = parts.every(
          (part, i) => !i || (part.start >= parts[i - 1].start && part.end >= parts[i - 1].end),
        );
      paragraphIndex = { parts, starts, ends, ordered };
    }
    return paragraphIndex;
  }
  function snap(point) {
    const current = position(point, text.length),
      edges = graphemeIndex(),
      at = lowerBound(edges, current.index);
    return edges[at] === current.index
      ? current
      : { ...current, index: current.affinity === 'backward' ? edges[at - 1] : edges[at] };
  }
  function move(point, { direction: requested = 'forward', unit = 'grapheme' } = {}) {
    const way = direction(requested),
      current = position(point, text.length),
      forward = way === 'forward';
    let index, values;
    if (unit === 'flow') index = forward ? text.length : 0;
    else if (unit === 'grapheme') values = graphemeIndex();
    else if (unit === 'word') {
      const data = wordIndex();
      values = forward ? data.wordEnds : data.wordStarts;
    } else if (unit === 'paragraph') {
      const data = paragraphData();
      // Preserve the standalone contract for unusual caller-supplied overlapping
      // or unordered ranges. Normal authored paragraph order uses binary lookup.
      if (!data.ordered)
        return moveTextPosition(text, point, { direction: way, unit, paragraphs: data.parts });
      values = forward ? data.ends : data.starts;
    } else throw new TypeError('Unknown text movement unit.');
    if (values)
      index = forward
        ? values[upperBound(values, current.index)]
        : values[lowerBound(values, current.index) - 1];
    return {
      index: index ?? (forward ? text.length : 0),
      affinity: forward ? 'backward' : 'forward',
    };
  }
  function selection(value, { extend = false, ...options } = {}) {
    const range = logicalSelection(value.anchor, value.focus, { length: text.length }),
      way = direction(options.direction || 'forward');
    if (!extend && !range.collapsed)
      return logicalSelection(
        snap({
          index: way === 'forward' ? range.end : range.start,
          affinity: way === 'forward' ? 'backward' : 'forward',
        }),
      );
    const focus = move(range.focus, options);
    return logicalSelection(extend ? range.anchor : focus, focus, { length: text.length });
  }
  function word(point) {
    const current = position(point, text.length),
      data = wordIndex(),
      previous = upperBound(data.ends, current.index) - 1,
      before = data.ends[previous] === current.index ? data.parts[previous] : null,
      at = upperBound(data.starts, current.index) - 1,
      containing = data.parts[at]?.end > current.index ? data.parts[at] : null,
      part = current.affinity === 'backward' ? before || containing : containing || before;
    return rangeSelection(part, current);
  }
  function paragraph(point) {
    const current = position(point, text.length),
      data = paragraphData();
    if (!data.ordered) return rangeSelection(caretInterval(current, data.parts), current);
    const edge =
        current.affinity === 'backward'
          ? upperBound(data.ends, current.index) - 1
          : lowerBound(data.starts, current.index),
      exact =
        current.affinity === 'backward'
          ? data.ends[edge] === current.index
          : data.starts[edge] === current.index,
      containing = lowerBound(data.ends, current.index),
      part = exact
        ? data.parts[edge]
        : data.starts[containing] <= current.index
          ? data.parts[containing]
          : null;
    return rangeSelection(part, current);
  }
  return Object.freeze({
    snap,
    move,
    selection,
    word,
    paragraph,
    get graphemeBoundaries() {
      return graphemeIndex();
    },
  });
}
