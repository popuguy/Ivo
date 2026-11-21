import { ID_PATTERN } from './constants.js';
export function contentsSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Check the table of contents settings.');
  const {
    title = 'Contents',
    numbering = 'after',
    order = 'page',
    separator = 'em',
    semantic = true,
    styles = {},
    entryStyle = '',
  } = value;
  if (
    typeof title !== 'string' ||
    title.length > 256 ||
    !['after', 'before', 'none'].includes(numbering) ||
    !['page', 'alphabetical'].includes(order) ||
    !['em', 'tab'].includes(separator) ||
    typeof semantic !== 'boolean' ||
    !styles ||
    Array.isArray(styles) ||
    typeof styles !== 'object' ||
    Object.keys(styles).length > 256 ||
    Object.entries(styles).some(
      ([id, level]) => !ID_PATTERN.test(id) || !Number.isInteger(level) || level < 1 || level > 6,
    ) ||
    typeof entryStyle !== 'string' ||
    (entryStyle && !ID_PATTERN.test(entryStyle))
  )
    throw Error('Check the table of contents settings.');
  return { title, numbering, order, separator, semantic, styles: { ...styles }, entryStyle };
}

export function remapContentsStyles(holder, ids) {
  const settings = holder.contents;
  if (!settings) return;
  settings.styles = Object.fromEntries(
    Object.entries(settings.styles || {}).map(([id, level]) => [ids.get(id) ?? id, level]),
  );
  if (ids.has(settings.entryStyle)) settings.entryStyle = ids.get(settings.entryStyle);
}
