import { ALIGNMENTS, TEXT_DEFAULTS } from './typography.js';

export const PARAGRAPH_LAYOUT_FIELDS = Object.freeze([
  'align',
  'paragraphBefore',
  'paragraphAfter',
  'leftIndent',
  'rightIndent',
  'firstLineIndent',
]);

/** Source-owned paragraph policy, independent of fonts, DOM and native ports. */
export function paragraphLayout(input = {}) {
  const result = {};
  for (const key of PARAGRAPH_LAYOUT_FIELDS) {
    const value = input[key] ?? TEXT_DEFAULTS[key];
    if (key === 'align') {
      if (!ALIGNMENTS.includes(value)) throw Error('Invalid paragraph alignment.');
    } else if (
      !Number.isFinite(value) ||
      value > 2000 ||
      value < (key === 'paragraphBefore' || key === 'paragraphAfter' ? 0 : -2000)
    )
      throw Error('Invalid paragraph ' + key + '.');
    result[key] = value;
  }
  return result;
}

/** Native line area. A hanging first indent can consume its positive left indent;
 * authored overhang outside a clipped column needs a separate paint contract. */
export function paragraphLineArea(input, columnWidth, firstLine = false) {
  const style = paragraphLayout(input),
    left = style.leftIndent + (firstLine ? style.firstLineIndent : 0),
    width = columnWidth - left - style.rightIndent;
  if (
    !Number.isFinite(columnWidth) ||
    columnWidth <= 0 ||
    !Number.isFinite(width) ||
    width < 1 ||
    left < 0 ||
    style.rightIndent < 0
  )
    throw Error('Paragraph indents must leave at least one point of text width.');
  return { left, width };
}
