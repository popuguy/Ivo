import { objectAvailable } from '../../../domain/documents/publishing.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { blankParagraphBreak } from '../../../rendering/text/insertion.js';
import {
  textIndexMap,
  textParagraphRanges,
  rangeFromBookmark,
} from '../../../shared/dom/text-selection.js';

const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const characters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A thread owns one source even when a hit crosses between two visible frames. */
export function findTextSources(doc, fragmentFor, overset = () => false) {
  const visited = new Set(),
    blocks = new Map(doc.blocks.map((item) => [item.id, item])),
    result = [];
  for (const item of doc.blocks) {
    if (!['text', 'quote'].includes(item.type)) continue;
    const flow = textFlowForFrame(doc, item),
      id = flow?.id || item.id;
    if (visited.has(id)) continue;
    visited.add(id);
    const frames = flow ? flow.frameIds.map((frame) => blocks.get(frame)) : [item];
    const available = frames.filter((frame) => frame && objectAvailable(doc, frame));
    if (!available.length) continue;
    let regions = null;
    if (available.length !== frames.length || (flow && overset(flow))) {
      regions = [];
      // Missing or stale layout cannot safely identify which offsets are protected.
      const fragments = frames.map((frame) => frame && fragmentFor(frame.id, flow));
      if (!fragments.every((part) => Number.isInteger(part?.start) && Number.isInteger(part?.end)))
        continue;
      for (let i = 0; i < frames.length; i++) {
        if (!objectAvailable(doc, frames[i])) continue;
        const { start, end } = fragments[i],
          previous = regions.at(-1);
        if (previous && previous.end === start) previous.end = end;
        else regions.push({ start, end });
      }
    }
    result.push({ id, html: flow?.html ?? item.html ?? '', frames: available, regions });
  }
  return result;
}

const paragraphTags = 'p,div,h1,h2,h3,h4,h5,h6,li,blockquote';

export function decodeFindField(value) {
  return value.replace(/\^([pt^])/g, (_, code) => ({ p: '\r', t: '\t', '^': '^' })[code]);
}

function indexedSource(root) {
  const map = textIndexMap(root),
    parts = [],
    blocks = new Map();
  let end = 0;
  for (const part of map.segments) {
    parts.push('\n'.repeat(part.start - end), part.node.data);
    end = part.end;
  }
  parts.push('\n'.repeat(map.boundaries.get(root).at(-1) - end));
  const logical = parts.join('');
  for (const node of root.querySelectorAll(paragraphTags)) {
    if (!node.querySelector(paragraphTags)) blocks.set(map.boundaries.get(node)[0], node);
  }
  const offsets = [],
    text = [];
  const paragraphs = textParagraphRanges(root, map).map((range) => {
    const block = blocks.get(range.contentStart) || root;
    const start = range.contentStart;
    const end = range.contentEnd - Number(!!blankParagraphBreak(block));
    if (text.length) text.push('\r');
    for (let index = start; index <= end; index++) offsets.push(index);
    text.push(logical.slice(start, end));
    return { block, start, end };
  });
  return { root, segments: map.segments, paragraphs, offsets, text: text.join('') };
}

function sourceIndex(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return indexedSource(root);
}

function searchOffset(offsets, index) {
  let lo = 0,
    hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsets[mid] < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function findSelection(html, start, end) {
  const source = sourceIndex(html);
  const searchStart = searchOffset(source.offsets, start),
    searchEnd = searchOffset(source.offsets, end);
  const text = source.text
    .slice(searchStart, searchEnd)
    .replace(/\^/g, '^^')
    .replace(/\r/g, '^p')
    .replace(/\t/g, '^t');
  return { searchStart, searchEnd, text: text.includes('\n') ? '' : text };
}

export function findTextMatches(sources, { needle, caseSensitive, wholeWord }, selection) {
  if (!needle) return [];
  needle = decodeFindField(needle);
  const pattern = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    caseSensitive ? 'gu' : 'giu',
  );
  const matches = [];
  for (const source of sources) {
    if (selection && selection.id !== source.id) continue;
    const { text, offsets } = sourceIndex(source.html);
    let starts, ends;
    if (wholeWord) {
      starts = new Set();
      ends = new Set();
      for (const word of words.segment(text)) {
        if (!word.isWordLike) continue;
        starts.add(word.index);
        ends.add(word.index + word.segment.length);
      }
    }
    for (const match of text.matchAll(pattern)) {
      const searchStart = match.index,
        searchEnd = searchStart + match[0].length;
      const start = offsets[searchStart],
        end = offsets[searchEnd];
      if (selection && (searchStart < selection.searchStart || searchEnd > selection.searchEnd))
        continue;
      if (
        source.regions &&
        !source.regions.some((region) => start >= region.start && end <= region.end)
      )
        continue;
      if (wholeWord && !(starts.has(searchStart) && ends.has(searchEnd))) continue;
      matches.push({ id: source.id, start, end, searchStart, searchEnd, text: match[0] });
    }
  }
  return matches;
}

/** Write only matched character data. Runs, links and paragraph attributes retain their identity. */
export function changeTextMatches(html, matches, replacement) {
  const initial = sourceIndex(html);
  const { root, segments } = initial;
  if (replacement.includes('\r') || matches.some((match) => match.text.includes('\r'))) {
    changeParagraphs(initial, matches, replacement);
    return root.innerHTML;
  }
  const replacementCharacters = Array.from(characters.segment(replacement), (item) => item.segment);
  let last = segments.length - 1;
  for (const match of matches.toReversed()) {
    while (last >= 0 && segments[last].start >= match.end) last--;
    let first = last;
    while (first > 0 && segments[first - 1].end > match.start) first--;
    let used = 0;
    for (let i = first; i <= last; i++) {
      const { start, end, node } = segments[i];
      const from = Math.max(start, match.start) - start,
        to = Math.min(end, match.end) - start;
      if (to <= from) continue;
      const next =
        i === last
          ? replacementCharacters.length
          : used + Array.from(characters.segment(node.data.slice(from, to))).length;
      node.replaceData(from, to - from, replacementCharacters.slice(used, next).join(''));
      used = next;
    }
  }
  return root.innerHTML;
}

function paragraphPoint(source, paragraph, index, end) {
  const block = paragraph.block;
  const { segments } = source;
  let lo = 0,
    hi = segments.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2),
      boundary = segments[mid].end;
    if (boundary < index || (boundary === index && !end)) lo = mid + 1;
    else hi = mid;
  }
  for (const piece of [segments[lo], segments[lo - 1]]) {
    if (piece && piece.start <= index && piece.end >= index && block.contains(piece.node)) {
      return [piece.node, index - piece.start];
    }
  }
  const mark = { path: [], offset: 0, index, kind: 'text', affinity: end ? 'backward' : 'forward' };
  const range = rangeFromBookmark(source.root, { anchor: mark, focus: mark });
  if (range && block.contains(range.startContainer))
    return [range.startContainer, range.startOffset];
  if (index === paragraph.start) return [block, 0];
  if (index === paragraph.end) return [block, block.childNodes.length];
  throw new Error('The match crosses an unsupported text structure.');
}

function withInlineStyle(block, container, content) {
  let ancestor = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
  while (ancestor !== block && block.contains(ancestor)) {
    const parent = ancestor.cloneNode(false);
    parent.append(content);
    content = parent;
    ancestor = ancestor.parentNode;
  }
  return content;
}

function copyPortion(output, source, p, start, end) {
  if (start >= end) return;
  const range = document.createRange();
  range.setStart(...paragraphPoint(source, p, start, false));
  range.setEnd(...paragraphPoint(source, p, end, true));
  output.append(withInlineStyle(p.block, range.commonAncestorContainer, range.cloneContents()));
}

function paragraphShell(source, paragraph) {
  return paragraph.block === source.root
    ? document.createElement('p')
    : paragraph.block.cloneNode(false);
}

/** Rebuild each touched paragraph once, including when Change All joins hundreds of neighbors. */
function changeParagraphs(source, matches, replacement) {
  const groups = [],
    paragraphs = source.paragraphs,
    parts = replacement.split('\r');
  let cursor = 0;
  for (const match of matches) {
    while (cursor < paragraphs.length && paragraphs[cursor].end < match.start) cursor++;
    const first = cursor;
    while (cursor < paragraphs.length && paragraphs[cursor].end < match.end) cursor++;
    if (
      cursor === paragraphs.length ||
      match.start < paragraphs[first].start ||
      match.end < paragraphs[cursor].start
    )
      throw new Error('The match crosses an unsupported text structure.');
    const previous = groups.at(-1);
    const item = { match, first, last: cursor };
    if (previous?.at(-1).last === first) previous.push(item);
    else groups.push([item]);
  }
  for (const group of groups.toReversed()) {
    const affected = paragraphs.slice(group[0].first, group.at(-1).last + 1),
      first = affected[0],
      last = affected.at(-1);
    if (
      affected.some((p) => p.block.parentNode !== first.block.parentNode) ||
      (first.block === source.root && source.root.querySelector(paragraphTags))
    ) {
      throw new Error('This replacement crosses separate text structures.');
    }
    const result = document.createDocumentFragment();
    let output = paragraphShell(source, first),
      copied = first.start;
    result.append(output);
    for (const { match, first: from, last: through } of group) {
      copyPortion(output, source, paragraphs[from], copied, match.start);
      for (const [i, text] of parts.entries()) {
        const p = paragraphs[Math.min(through, from + i)];
        if (i) {
          if (!output.childNodes.length) output.append(document.createElement('br'));
          output = paragraphShell(source, p);
          result.append(output);
        }
        if (text) {
          const [node] = paragraphPoint(source, p, i ? p.start : match.start, false);
          output.append(withInlineStyle(p.block, node, document.createTextNode(text)));
        }
      }
      copied = match.end;
    }
    copyPortion(output, source, last, copied, last.end);
    if (!output.childNodes.length) output.append(document.createElement('br'));
    if (first.block === source.root) first.block.replaceChildren(result);
    else {
      first.block.before(result);
      for (const p of affected) p.block.remove();
    }
  }
}
