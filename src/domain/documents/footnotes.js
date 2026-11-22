import { attribute } from '../text/html.js';

export const footnoteCommands = {
  'footnote-options': 'Document Footnote Options…',
  'insert-footnote': 'Insert Footnote',
  'edit-footnote': 'Edit Footnote',
  'delete-footnote': 'Delete Footnote',
};

export function containsFootnote(html) {
  return typeof html === 'string' && /<span\b[^>]*\sdata-footnote\s*=/i.test(html);
}

export function hasFootnotes(doc) {
  return (
    doc.canvasVersion === 35 ||
    doc.extensions?.ivoFootnotes !== undefined ||
    doc.textFlows?.some((f) => containsFootnote(f.html)) ||
    doc.blocks?.some((b) => containsFootnote(b.html)) ||
    false
  );
}

export function footnoteText(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 90000) return null;
  try {
    const value = decodeURIComponent(encoded);
    return value.trim() &&
      value.length <= 10000 &&
      // eslint-disable-next-line no-control-regex
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function validateFootnoteHTML(html) {
  if (typeof html !== 'string' || !/data-footnote/i.test(html)) return;
  // Authored typography may introduce nested spans around the reference digits.
  // Restrict the reference itself to an integer so pasted prose cannot become a silent note label.
  let depth = 0,
    digits = '';
  for (const [token] of html.matchAll(/<[^>]*>|[^<]+/g)) {
    if (!token.startsWith('<')) {
      if (depth) digits += token;
      continue;
    }
    const encoded = attribute(token, 'data-footnote');
    if (encoded !== null) {
      if (depth || !/^<span\b/i.test(token) || footnoteText(encoded) === null)
        throw Error('Invalid footnote text.');
      depth = 1;
      digits = '';
    } else if (depth && /^<span\b/i.test(token)) depth++;
    else if (depth && /^<\/span\s*>/i.test(token)) {
      if (--depth === 0 && !/^[1-9]\d*$/.test(digits))
        throw Error('Invalid footnote reference number.');
    }
  }
  if (depth) throw Error('Unclosed footnote reference.');
}

export const defaultFootnoteOptions = Object.freeze({
  startAt: 1,
  allowSplitting: true,
  rule: true,
  ruleWidth: 72,
  ruleWeight: 1,
  spaceBefore: 0,
  spaceBetween: 0,
  size: 12,
  leading: 14.4,
});
export function validateFootnoteOptions(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid footnote options.');
  const bounds = {
    startAt: [1, 9999],
    ruleWidth: [0, 1440],
    ruleWeight: [0, 24],
    spaceBefore: [0, 720],
    spaceBetween: [0, 720],
    size: [1, 144],
    leading: [1, 288],
  };
  for (const [field, v] of Object.entries(value)) {
    if (field === 'allowSplitting' || field === 'rule') {
      if (typeof v !== 'boolean') throw Error('Invalid footnote option: ' + field);
    } else {
      const range = bounds[field];
      if (
        !Object.hasOwn(bounds, field) ||
        !Number.isFinite(v) ||
        v < range[0] ||
        v > range[1] ||
        (field === 'startAt' && !Number.isInteger(v))
      )
        throw Error('Invalid footnote option: ' + field);
    }
  }
}

export function documentFootnoteOptions(doc) {
  return { ...defaultFootnoteOptions, ...doc.extensions?.ivoFootnotes };
}
