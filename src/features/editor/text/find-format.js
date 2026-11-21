import { textStyleReader } from '../../../rendering/text/selection-style.js';
import { CHARACTER_FIELDS } from '../../../domain/text/typography.js';
import { setTextAttribute } from '../../../shared/dom/text-attributes.js';

export const findFormats = [
  ['bold', 'Bold', { bold: true }],
  ['italic', 'Italic', { italic: true }],
  ['regular', 'Regular', { bold: false, italic: false }],
  ['underline', 'Underline', { underline: true }],
  ['strike', 'Strikethrough', { strikethrough: true }],
  ['no-break', 'No Break', { noBreak: true }],
];

const styleKeys = { characterStyle: 'characterStyles', paragraphStyle: 'paragraphStyles' };

export function namedFormats(doc, find) {
  return Object.entries(styleKeys)
    .filter(([kind]) => find || kind === 'characterStyle')
    .flatMap(([kind, list]) =>
      (doc?.publishing?.[list] || []).map((style) => ({
        key: kind + '/' + style.id,
        kind,
        name: style.name,
      })),
    );
}

export function formatAttributes(key, doc) {
  if (!key) return null;
  const basic = findFormats.find(([id]) => id === key)?.[2];
  if (basic) return basic;
  const [field, id] = key.split('/');
  if (
    Object.hasOwn(styleKeys, field) &&
    doc?.publishing?.[styleKeys[field]]?.some((style) => style.id === id)
  )
    return { [field]: id };
  throw new Error('This style is unavailable. Choose a style from this document.');
}

function hasFormat(style, attributes) {
  return Object.entries(attributes).every(([key, value]) => style[key] === value);
}

export function formattedRegions(index, owner, attributes) {
  const at = textStyleReader(index.root, owner.doc, owner.defaults);
  const ranges = [];
  for (const part of index.segments) {
    if (part.start === part.end || !hasFormat(at(part.node), attributes)) continue;
    const last = ranges.at(-1);
    if (last?.end === part.start) last.end = part.end;
    else ranges.push({ start: part.start, end: part.end });
  }
  return ranges;
}

// Work backwards so splitting a run leaves earlier offsets on the original text node.
export function formatRanges(index, ranges, attributes, owner) {
  const at = textStyleReader(index.root, owner.doc, owner.defaults);
  let cursor = index.segments.length - 1;
  for (const { start, end } of ranges.toReversed()) {
    while (cursor >= 0 && index.segments[cursor].start >= end) cursor--;
    for (let i = cursor; i >= 0 && index.segments[i].end > start; i--) {
      const part = index.segments[i];
      if (hasFormat(at(part.node), attributes)) continue;
      const from = Math.max(start, part.start) - part.start;
      const to = Math.min(end, part.end) - part.start;
      if (to <= from) continue;
      const node = part.node;
      if (to < node.length) node.splitText(to);
      const target = from ? node.splitText(from) : node;
      const span = document.createElement('span');
      for (const [key, value] of Object.entries(attributes))
        setTextAttribute(span, CHARACTER_FIELDS[key], value);
      target.before(span);
      span.append(target);
    }
  }
}
