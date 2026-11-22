import { pageFolios } from './page-sections.js';

export const PARENT_FIELDS = Object.freeze({
  'current-page-number': 'Current Page Number',
  'section-marker': 'Section Marker',
  'last-page-number': 'Last Page Number',
  'document-name': 'Document Name',
});
export const parentFieldToken = (key) => '«' + PARENT_FIELDS[key] + '»';

export function pageFieldValues(doc, page) {
  const i = doc.pages.findIndex((p) => p.id === page.id);
  if (i < 0) throw Error('Choose a document page.');
  const folios = pageFolios(doc.pages);
  let start = i;
  while (start && !doc.pages[start].section) start--;
  return {
    'current-page-number': folios[i],
    'section-marker': doc.pages[start].section?.marker || '',
    'last-page-number': folios.at(-1),
    'document-name': doc.title,
  };
}
const markupEscape = (text) =>
  String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const tokens = new Map(Object.keys(PARENT_FIELDS).map((key) => [parentFieldToken(key), key]));
const fieldPattern = new RegExp([...tokens.keys()].join('|'), 'g');

export function runningFieldRanges(text) {
  return Array.from(text.matchAll(fieldPattern), (m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
}

// Parent-page field names can span inline formatting, but act as one character.
export function runningFieldEdge(fields, index, side) {
  const field = fields.find((f) => f.start < index && index < f.end);
  if (!field) return index;
  if (side === 'nearest') return index - field.start < field.end - index ? field.start : field.end;
  return field[side];
}

// Replace fields only in visible inline text. A field split across formatting
// runs takes the formatting of its first character. Keep surrounding markup.
export function resolveRunningText(html, values) {
  const parts = html.split(/(<!--[^]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>)/g);
  let leaves = [],
    length = 0;
  function flush() {
    if (!leaves.length) return;
    const text = leaves.map((v) => parts[v.part]).join('');
    const matches = [...text.matchAll(fieldPattern)];
    // Apply replacements right to left so source offsets stay valid.
    let last = leaves.length - 1;
    for (const m of matches.reverse()) {
      const start = m.index,
        end = start + m[0].length,
        value = markupEscape(values[tokens.get(m[0])] ?? '');
      while (last >= 0 && leaves[last].start >= end) last--;
      for (let j = last; j >= 0; j--) {
        const leaf = leaves[j],
          from = Math.max(0, start - leaf.start),
          to = Math.min(leaf.length, end - leaf.start);
        if (to <= from) break;
        const s = parts[leaf.part];
        parts[leaf.part] = s.slice(0, from) + (start >= leaf.start ? value : '') + s.slice(to);
        if (start >= leaf.start) {
          last = j;
          break;
        }
      }
    }
    leaves = [];
    length = 0;
  }
  for (let i = 0; i < parts.length; i++) {
    if (i % 2) {
      if (/^<\/?(?:p|div|br|li|h[1-6]|blockquote)\b/i.test(parts[i])) flush();
    } else if (parts[i]) {
      leaves.push({ part: i, start: length, length: parts[i].length });
      length += parts[i].length;
    }
  }
  flush();
  return parts.join('');
}
