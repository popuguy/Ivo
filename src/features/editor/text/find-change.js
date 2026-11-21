import { runGrep, replacementParts } from './grep.js';
import { formattedRegions, formatRanges, formatAttributes } from './find-format.js';
import { objectAvailable, effectiveTextStyle } from '../../../domain/documents/publishing.js';
import { frameTextSettings, textFlowForFrame } from '../../../domain/documents/text-flows.js';
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
    const defaults = effectiveTextStyle(doc, frameTextSettings(doc, item));
    result.push({
      id,
      html: flow?.html ?? item.html ?? '',
      frames: available,
      regions,
      doc,
      defaults,
    });
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

function contained(ranges, start, end) {
  if (!ranges) return true;
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid].end < end) lo = mid + 1;
    else hi = mid;
  }
  return lo < ranges.length && ranges[lo].start <= start;
}

function prepared(owner, filter) {
  const index = sourceIndex(owner.html);
  return { owner, index, formatted: filter && formattedRegions(index, owner, filter) };
}

function matchRange(prep, selection, from, to) {
  const { index, owner, formatted } = prep;
  const start = index.offsets[from],
    end = index.offsets[to];
  if (selection && (from < selection.searchStart || to > selection.searchEnd)) return null;
  if (!contained(owner.regions, start, end) || !contained(formatted, start, end)) return null;
  // An insertion exactly on a protected frame boundary has ambiguous ownership.
  if (from === to && owner.regions?.some((r) => r.start === start || r.end === start)) return null;
  return {
    id: owner.id,
    start,
    end,
    searchStart: from,
    searchEnd: to,
    text: index.text.slice(from, to),
  };
}

/** Editable dictionary words mapped to the same logical positions used by Find/Change. */
export function* proofingWords(owner) {
  const prep = prepared(owner);
  for (const { index, segment, isWordLike } of words.segment(prep.index.text)) {
    if (!isWordLike || segment.length > 256 || !/\p{Letter}/u.test(segment)) continue;
    const match = matchRange(prep, null, index, index + segment.length);
    if (match) yield match;
  }
}

function formatOnly(prep, selection) {
  const { index, owner, formatted } = prep,
    matches = [];
  const allowed = owner.regions || [{ start: 0, end: Infinity }];
  let offset = 0;
  for (const range of formatted) {
    while (offset < allowed.length && allowed[offset].end <= range.start) offset++;
    for (let i = offset; i < allowed.length && allowed[i].start < range.end; i++) {
      const from = Math.max(
        searchOffset(index.offsets, Math.max(range.start, allowed[i].start)),
        selection?.searchStart ?? 0,
      );
      const to = Math.min(
        searchOffset(index.offsets, Math.min(range.end, allowed[i].end)),
        selection?.searchEnd ?? Infinity,
      );
      if (from < to) {
        const match = matchRange(prep, selection, from, to);
        if (match) matches.push(match);
      }
    }
  }
  return matches;
}

export function findTextMatches(
  sources,
  { needle, caseSensitive, wholeWord, mode, findFormat },
  selection,
  signal,
) {
  const filter = formatAttributes(findFormat, sources[0]?.doc);
  if (!needle && !filter) return [];
  const preparedSources = sources
    .filter((owner) => !selection || selection.id === owner.id)
    .map((owner) => prepared(owner, filter));
  if (!needle) return preparedSources.flatMap((prep) => formatOnly(prep, selection));
  if (mode === 'grep') {
    return runGrep(
      { texts: preparedSources.map((p) => p.index.text), needle, caseSensitive },
      signal,
    ).then((rows) => {
      const matches = [];
      rows.forEach((row, i) => {
        const prep = preparedSources[i];
        for (const captures of row) {
          const match = matchRange(prep, selection, ...captures[0]);
          if (!match) continue;
          // A lookaround may capture outside the match. Protected content cannot become replacement text.
          const groups = captures.map((pair) => pair && matchRange(prep, selection, ...pair));
          if (captures.some((pair, j) => pair && !groups[j])) continue;
          matches.push({ ...match, groups });
        }
      });
      return matches;
    });
  }
  const pattern = new RegExp(
    decodeFindField(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    caseSensitive ? 'gu' : 'giu',
  );
  const matches = [];
  for (const prep of preparedSources) {
    const { text } = prep.index;
    const starts = new Set(),
      ends = new Set();
    if (wholeWord)
      for (const word of words.segment(text)) {
        if (word.isWordLike) {
          starts.add(word.index);
          ends.add(word.index + word.segment.length);
        }
      }
    for (const match of text.matchAll(pattern)) {
      const from = match.index,
        to = from + match[0].length;
      if (wholeWord && !(starts.has(from) && ends.has(to))) continue;
      const result = matchRange(prep, selection, from, to);
      if (result) matches.push(result);
    }
  }
  return matches;
}

export function plannedReplacement(match, template, changeFormat, remaining = 20000000) {
  // An empty Change To with a format applies only that format, retaining the original characters.
  if (!template && changeFormat) return { ...match, replacement: match.text, parts: null };
  const parts = match.groups
    ? replacementParts(template, match.groups)
    : [decodeFindField(template)];
  if (
    parts.reduce((sum, p) => sum + (typeof p === 'string' ? p.length : p.text.length), 0) >
    remaining
  )
    throw new Error('Replacement text exceeds the document budget. Narrow the search.');
  return {
    ...match,
    parts,
    replacement: parts.map((p) => (typeof p === 'string' ? p : p.text)).join(''),
  };
}

export function changeTextMatches(html, matches, replacement, changeFormat, owner) {
  const edits = matches.map((m) => (replacement !== undefined ? { ...m, replacement } : m));
  return applyTextChanges(owner || { html }, edits, changeFormat).html;
}

export function applyTextChanges(owner, edits, changeFormat) {
  const initial = sourceIndex(owner.html);
  const { root, segments } = initial;
  const attributes = formatAttributes(changeFormat, owner.doc);
  const alreadyFormatted = attributes ? formattedRegions(initial, owner, attributes) : null;
  const textChanges = (m) =>
    m.text !== m.replacement ||
    m.parts?.some((p) => typeof p !== 'string' && (p.start !== m.start || p.end !== m.end));
  const changed = edits.filter(textChanges);
  const count = edits.filter(
    (m) =>
      textChanges(m) ||
      (attributes && m.end > m.start && !contained(alreadyFormatted, m.start, m.end)),
  ).length;
  if (!count) return { html: owner.html, count: 0 };
  if (
    changed.some(
      (m) =>
        !m.text ||
        /[\r\n]/.test(m.text + m.replacement) ||
        m.parts?.some((p) => typeof p !== 'string'),
    )
  ) {
    changeParagraphs(initial, changed);
  } else changeRuns(segments, changed);
  if (attributes) {
    const index = changed.length ? indexedSource(root) : initial;
    let delta = 0;
    const ranges = edits.map((m) => {
      const start = m.searchStart + delta,
        end = start + m.replacement.length;
      delta += m.replacement.length - m.text.length;
      return { start: index.offsets[start], end: index.offsets[end] };
    });
    formatRanges(index, ranges, attributes, owner);
  }
  return { html: root.innerHTML, count };
}

function changeRuns(segments, matches) {
  let last = segments.length - 1;
  for (const match of matches.toReversed()) {
    const replacementCharacters = Array.from(
      characters.segment(match.replacement),
      (item) => item.segment,
    );
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

function paragraphAt(paragraphs, index) {
  let lo = 0,
    hi = paragraphs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (paragraphs[mid].end < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Rebuild each touched paragraph once, including when Change All joins hundreds of neighbors. */
function changeParagraphs(source, matches) {
  const groups = [],
    paragraphs = source.paragraphs;
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
      affected.some(
        (p) =>
          p.block.parentNode !== first.block.parentNode || p.block.textContent.includes('\u2029'),
      ) ||
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
      const newParagraph = (p) => {
        if (!output.childNodes.length) output.append(document.createElement('br'));
        output = paragraphShell(source, p);
        result.append(output);
      };
      let line = 0;
      for (const piece of match.parts || [match.replacement]) {
        if (typeof piece !== 'string') {
          let i = paragraphAt(paragraphs, piece.start);
          while (i < paragraphs.length) {
            const p = paragraphs[i];
            copyPortion(
              output,
              source,
              p,
              Math.max(piece.start, p.start),
              Math.min(piece.end, p.end),
            );
            if (piece.end <= p.end) break;
            newParagraph(paragraphs[++i]);
            line++;
          }
          continue;
        }
        for (const [i, text] of piece.split('\r').entries()) {
          if (i) line++;
          const p = paragraphs[Math.min(through, from + line)];
          if (i) newParagraph(p);
          if (text) {
            const content = document.createDocumentFragment();
            for (const [j, section] of text.split('\n').entries()) {
              if (j) content.append(document.createElement('br'));
              if (section) content.append(section);
            }
            let [node] = paragraphPoint(source, p, line ? p.start : match.start, false);
            if (
              from === through &&
              match.parts?.some((part) => typeof part !== 'string') &&
              match.start < match.end
            ) {
              const range = document.createRange();
              range.setStart(...paragraphPoint(source, p, match.start, false));
              range.setEnd(...paragraphPoint(source, p, match.end, true));
              node = range.commonAncestorContainer;
            }
            output.append(withInlineStyle(p.block, node, content));
          }
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
