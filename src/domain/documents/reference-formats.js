import { attribute } from '../text/html.js';

export const referenceBuildingBlocks = {
  paraText: 'Paragraph Text',
  pageNum: 'Page Number',
  fileName: 'Document Name',
  pageName: 'Page Name',
  sectionMarker: 'Section Marker',
};
export const customFormatId = (value) =>
  typeof value === 'string' && /^xref-[A-Za-z0-9_-]{1,100}$/.test(value);

export function validateReferenceFormats(formats) {
  if (!Array.isArray(formats) || formats.length > 128)
    throw Error('A document can contain up to 128 cross-reference formats.');
  const ids = new Set(),
    names = new Set();
  return formats.map((format) => {
    const { id, name, definition } = format || {};
    if (!customFormatId(id) || ids.has(id)) throw Error('Invalid cross-reference format ID.');
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || /\p{Cc}/u.test(name))
      throw Error('Enter a format name of up to 120 characters.');
    const key = name.trim().toLowerCase();
    if (names.has(key)) throw Error('A cross-reference format already has that name.');
    if (
      typeof definition !== 'string' ||
      !definition.trim() ||
      definition.length > 256 ||
      /\p{Cc}/u.test(definition)
    )
      throw Error('Enter a definition of up to 256 characters.');
    for (const [token] of definition.matchAll(/<[^<>]*>|[<>]/g)) {
      const block = /^<([A-Za-z]+)\/>$/.exec(token)?.[1];
      if (!Object.hasOwn(referenceBuildingBlocks, block))
        throw Error('Unknown building block. Choose a building block from the menu.');
    }
    ids.add(id);
    names.add(key);
    return { id, name: name.trim(), definition };
  });
}

export function referenceHolders(doc) {
  return [
    ...doc.blocks.filter((b) => !b.textFlowId),
    ...(doc.textFlows || []),
    ...(doc.publishing?.parents || []).flatMap((p) => p.blocks),
  ];
}
export function referencedFormatIds(doc) {
  const ids = new Set();
  for (const { html } of referenceHolders(doc))
    if (html?.includes('data-xref-format'))
      for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
        const value = attribute(tag, 'data-xref-format');
        if (customFormatId(value)) ids.add(value);
      }
  return ids;
}

/** Import the definitions used by copied objects, keeping their original field targets. */
export function mergeReferenceFormats(target, incoming, newId) {
  if (!incoming.referenceFormats?.length) return;
  const result = [...(target.referenceFormats || [])],
    remap = new Map();
  for (const format of incoming.referenceFormats) {
    const same = result.find((f) => f.name === format.name && f.definition === format.definition);
    if (same) {
      remap.set(format.id, same.id);
      continue;
    }
    const id = result.some((f) => f.id === format.id) ? newId() : format.id;
    let name = format.name;
    for (let n = 2; result.some((f) => f.name.toLowerCase() === name.toLowerCase()); n++)
      name = format.name.slice(0, 110) + ' (' + n + ')';
    result.push({ ...format, id, name });
    remap.set(format.id, id);
  }
  target.referenceFormats = validateReferenceFormats(result);
  for (const holder of referenceHolders(incoming)) {
    if (!holder.html?.includes('data-xref-format')) continue;
    holder.html = holder.html.replace(
      /(<a\b[^>]*?\sdata-xref-format\s*=\s*)(["'])([\w-]+)\2/gi,
      (match, prefix, quote, id) =>
        remap.has(id) ? prefix + quote + remap.get(id) + quote : match,
    );
  }
}
