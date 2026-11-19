/** Enter a live text surface without rebuilding it or resetting subsequent native selections. */
export function placeTextCaret(element, x, y, { word = false } = {}) {
  element.focus({ preventScroll: true });
  let range;
  const hit = document.caretPositionFromPoint?.(x, y);
  if (hit) {
    range = document.createRange();
    range.setStart(hit.offsetNode, hit.offset);
    range.collapse(true);
  } else range = document.caretRangeFromPoint?.(x, y);
  if (!range || !element.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  if (word) selectCaretWord(element, range);
}
export function selectCaretWord(element, caret) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT),
    nodes = [];
  let node,
    text = '',
    offset = 0,
    lastBlock = null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') text += '\n';
      continue;
    }
    const block = node.parentElement.closest('p,div,li,blockquote,h1,h2,h3,h4,h5,h6');
    if (lastBlock && block !== lastBlock && !text.endsWith('\n')) text += '\n';
    lastBlock = block;
    nodes.push({ node, start: text.length });
    if (node === caret.startContainer) offset = text.length + caret.startOffset;
    text += node.data;
  }
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)];
  const segment =
    segments.find(
      (s) => s.isWordLike && offset >= s.index && offset < s.index + s.segment.length,
    ) || segments.find((s) => s.isWordLike && offset === s.index + s.segment.length);
  if (!segment) return;
  function position(index) {
    for (const value of nodes)
      if (index <= value.start + value.node.length)
        return [value.node, Math.max(0, index - value.start)];
    const last = nodes.at(-1);
    return [last.node, last.node.length];
  }
  const range = document.createRange();
  range.setStart(...position(segment.index));
  range.setEnd(...position(segment.index + segment.segment.length));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** A caret may live directly on the editable element, not only in a text node. */
export function textSurface(node) {
  return (
    (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest(
      '[data-scene-text]',
    ) || null
  );
}
const textBlocks = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);
function textPositions(element) {
  let index = 0;
  const boundaries = new Map(),
    segments = [];
  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      boundaries.set(node, [index]);
      segments.push({ node, start: index, end: index + node.length });
      index += node.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const block = node !== element && textBlocks.has(node.tagName);
    if (block) index++;
    if (node.tagName === 'BR') {
      boundaries.set(node, [index]);
      index++;
      return;
    }
    const points = [index];
    for (const child of node.childNodes) {
      visit(child);
      points.push(index);
    }
    boundaries.set(node, points);
    if (block) index++;
  }
  visit(element);
  return { boundaries, segments };
}
function pointIndex(map, node, offset) {
  const points = map.boundaries.get(node);
  return points
    ? node.nodeType === Node.TEXT_NODE
      ? points[0] + offset
      : points[Math.min(offset, points.length - 1)]
    : null;
}
function pointBookmark(element, node, offset, map) {
  if (node !== element && !element.contains(node)) return null;
  const original = node,
    path = [];
  while (node !== element) {
    path.unshift([...node.parentNode.childNodes].indexOf(node));
    node = node.parentNode;
  }
  return {
    path,
    offset,
    index: pointIndex(map, original, offset),
    kind: original.nodeType === Node.TEXT_NODE ? 'text' : original.nodeName,
    affinity:
      original.nodeType === Node.TEXT_NODE && offset === original.length ? 'backward' : 'forward',
  };
}
function bookmarkPoint(element, point, map) {
  if (!point || !Array.isArray(point.path)) return null;
  let node = element;
  for (const index of point.path) {
    node = node?.childNodes[index];
    if (!node) break;
  }
  if (node) {
    const length = node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length,
      offset = Math.max(0, Math.min(length, point.offset));
    if (
      point.index === undefined ||
      (pointIndex(map, node, offset) === point.index &&
        (node.nodeType === Node.TEXT_NODE ? 'text' : node.nodeName) === point.kind)
    )
      return { node, offset };
  }
  // HTML serialization merges adjacent/empty text nodes. A logical text position
  // survives that normalization, inline formatting and the recreation of nodes.
  const candidates = map.segments.filter(
    (s) => point.index >= s.start && point.index <= s.end && s.end > s.start,
  );
  const segment =
    candidates.find((s) =>
      point.affinity === 'backward' ? point.index === s.end : point.index === s.start,
    ) || candidates[0];
  if (segment) return { node: segment.node, offset: point.index - segment.start };
  for (const [candidate, points] of map.boundaries) {
    if (candidate.nodeType !== Node.ELEMENT_NODE) continue;
    const offset = points.indexOf(point.index);
    if (offset >= 0) return { node: candidate, offset };
  }
  return null;
}
export function captureTextSelection(element, selection = window.getSelection()) {
  if (!selection?.rangeCount) return null;
  const map = textPositions(element),
    anchor = pointBookmark(element, selection.anchorNode, selection.anchorOffset, map),
    focus = pointBookmark(element, selection.focusNode, selection.focusOffset, map);
  return anchor && focus ? { anchor, focus } : null;
}
export function bookmarkForRange(element, range) {
  const map = textPositions(element),
    anchor = pointBookmark(element, range.startContainer, range.startOffset, map),
    focus = pointBookmark(element, range.endContainer, range.endOffset, map);
  return anchor && focus ? { anchor, focus } : null;
}
export function rangeFromBookmark(element, bookmark) {
  const map = textPositions(element),
    anchor = bookmarkPoint(element, bookmark?.anchor, map),
    focus = bookmarkPoint(element, bookmark?.focus, map);
  if (!anchor || !focus) return null;
  const a = document.createRange(),
    b = document.createRange();
  a.setStart(anchor.node, anchor.offset);
  a.collapse(true);
  b.setStart(focus.node, focus.offset);
  b.collapse(true);
  const range = document.createRange(),
    forward = a.compareBoundaryPoints(Range.START_TO_START, b) <= 0;
  range.setStart((forward ? anchor : focus).node, (forward ? anchor : focus).offset);
  range.setEnd((forward ? focus : anchor).node, (forward ? focus : anchor).offset);
  return range;
}
export function restoreTextSelection(element, bookmark, { focus = true } = {}) {
  const map = textPositions(element),
    anchor = bookmarkPoint(element, bookmark?.anchor, map),
    end = bookmarkPoint(element, bookmark?.focus, map);
  if (!anchor || !end) return false;
  if (focus) element.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection.setBaseAndExtent(anchor.node, anchor.offset, end.node, end.offset);
  return true;
}

export function textIndexMap(element) {
  return textPositions(element);
}
export function textIndexAt(map, node, offset) {
  return pointIndex(map, node, offset);
}

/** Authored paragraphs include their structural marks; BR remains inside its paragraph. */
export function logicalText(root) {
  const map = textIndexMap(root),
    length = [...map.boundaries.values()].reduce(
      (length, points) => Math.max(length, points.at(-1) || 0),
      0,
    ),
    chars = Array(length).fill('\n');
  for (const segment of map.segments)
    for (let i = 0; i < segment.node.length; i++) chars[segment.start + i] = segment.node.data[i];
  return chars.join('');
}
export function textParagraphRanges(element) {
  const map = textPositions(element),
    ranges = [];
  const blocks = [...element.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote')].filter(
    (node) => !node.querySelector('p,div,li,h1,h2,h3,h4,h5,h6,blockquote'),
  );
  for (const node of blocks) {
    const siblings = [...node.parentNode.childNodes],
      at = siblings.indexOf(node),
      parent = map.boundaries.get(node.parentNode),
      points = map.boundaries.get(node);
    if (parent && points)
      ranges.push({
        start: parent[at],
        end: parent[at + 1],
        contentStart: points[0],
        contentEnd: points.at(-1),
      });
  }
  ranges.sort((a, b) => a.start - b.start);
  const result = [],
    end = map.boundaries.get(element).at(-1);
  let start = 0;
  for (const range of [...ranges, { start: end, end }]) {
    if (
      range.start > start &&
      map.segments.some(
        (part) => part.end > start && part.start < range.start && part.node.data.trim(),
      )
    )
      result.push({ start, end: range.start, contentStart: start, contentEnd: range.start });
    if (range.end > range.start) result.push(range);
    start = range.end;
  }
  const authored = result.length ? result : [{ start: 0, end, contentStart: 0, contentEnd: end }],
    separators = map.segments.flatMap((part) =>
      [...part.node.data.matchAll(/\u2029/g)].map((match) => part.start + match.index),
    );
  return authored.flatMap((range) => {
    const split = [];
    let start = range.start,
      contentStart = range.contentStart;
    for (const separator of separators) {
      if (separator < range.contentStart || separator >= range.contentEnd) continue;
      split.push({ start, end: separator + 1, contentStart, contentEnd: separator });
      start = contentStart = separator + 1;
    }
    split.push({ start, end: range.end, contentStart, contentEnd: range.contentEnd });
    return split;
  });
}
