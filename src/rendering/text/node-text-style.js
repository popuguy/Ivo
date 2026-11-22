import {
  TEXT_DEFAULTS,
  CHARACTER_FIELDS,
  PARAGRAPH_FIELDS,
  validTextAttribute,
} from '../../domain/text/typography.js';
import { resolvedTextStyle } from '../../domain/documents/publishing.js';

const fieldForAttribute = new Map(
  Object.entries({ ...CHARACTER_FIELDS, ...PARAGRAPH_FIELDS }).map(([key, attr]) => [
    'data-ivo-' + attr,
    key,
  ]),
);
/** Resolve source-owned attributes, never generated CSS, along one ancestry path. */
export function nodeTextStyle(node, inherited, doc, { paragraph = true } = {}) {
  const result = { ...inherited };
  if (['B', 'STRONG'].includes(node.tagName)) result.bold = true;
  if (['I', 'EM'].includes(node.tagName)) result.italic = true;
  if (node.tagName === 'U') result.underline = true;
  if (node.tagName === 'S') result.strikethrough = true;
  Object.assign(
    result,
    paragraph && resolvedTextStyle(doc, 'paragraph', node.getAttribute('data-ivo-pstyle')),
    resolvedTextStyle(doc, 'character', node.getAttribute('data-ivo-cstyle')),
  );
  for (const attribute of node.attributes) {
    const key = fieldForAttribute.get(attribute.name);
    if (!key) continue;
    const value = validTextAttribute(attribute.name.slice(9), attribute.value);
    if (value === null) continue;
    result[key] =
      typeof TEXT_DEFAULTS[key] === 'boolean'
        ? value === 'true'
        : typeof TEXT_DEFAULTS[key] === 'number'
          ? Number(value)
          : value;
  }
  return result;
}
