import { ID_PATTERN } from './constants.js';
const canonicalMarker = /<span data-ivo-anchor="([A-Za-z0-9][A-Za-z0-9_-]{0,119})">\uFFFC<\/span>/g;
const graphicTypes = new Set(['image', 'polygon', 'table']);

export function anchorObjectMarker(id) {
  if (!ID_PATTERN.test(id)) throw Error('Invalid anchored object identifier.');
  return '<span data-ivo-anchor="' + id + '">\uFFFC</span>';
}
export function anchoredObjectIds(html) {
  return [...String(html || '').matchAll(canonicalMarker)].map((match) => match[1]);
}
export function hasAnchoredObjects(doc) {
  return (
    (doc.blocks || []).some(
      (b) => b.extensions?.ivoAnchor || b.html?.includes('data-ivo-anchor'),
    ) || (doc.textFlows || []).some((flow) => flow.html?.includes('data-ivo-anchor'))
  );
}

function holders(doc) {
  return [
    ...(doc.textFlows || []),
    ...(doc.blocks || []).filter((b) => !b.textFlowId && ['text', 'quote'].includes(b.type)),
  ];
}

function checkBinding(doc, block, owner, position) {
  if (
    !block ||
    !graphicTypes.has(block.type) ||
    block.parentId ||
    !owner ||
    owner.contents ||
    owner.index ||
    !['inline', 'above-line'].includes(position) ||
    (block.type === 'table' && (position !== 'above-line' || !block.table || block.tableNext))
  )
    throw Error('Choose a top-level graphic or table and an authored text insertion point.');
  const descendants = new Set([block.id]);
  if (block.type === 'polygon') {
    const children = new Map();
    for (const item of doc.blocks) {
      if (!item.parentId) continue;
      if (!children.has(item.parentId)) children.set(item.parentId, []);
      children.get(item.parentId).push(item);
    }
    for (const id of descendants)
      for (const child of children.get(id) || []) {
        if (!['image', 'polygon'].includes(child.type))
          throw Error('An anchored mask supports graphics and polygons.');
        descendants.add(child.id);
      }
  }
  // An anchored mask cannot indirectly contain the frame that owns its marker.
  const frames = owner.frameIds || [owner.id];
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  for (const id of frames) {
    let current = byId.get(id);
    const seen = new Set();
    while (current) {
      if (current.id === block.id || seen.has(current.id))
        throw Error('An anchored object cannot contain its text frame.');
      seen.add(current.id);
      current = byId.get(current.parentId);
    }
  }
}

export function anchorObject(doc, block, ownerId, position = 'inline') {
  const owner = holders(doc).find((h) => h.id === ownerId);
  if (!doc.blocks.includes(block) || block.extensions?.ivoAnchor)
    throw Error('Choose an available page object.');
  checkBinding(doc, block, owner, position);
  (block.extensions ||= {}).ivoAnchor = { ownerId, position };
  doc.canvasVersion = Math.max(doc.canvasVersion || 1, block.type === 'table' ? 37 : 36);
}

export function validateAnchoredObjects(doc) {
  const sources = holders(doc);
  const byId = new Map((doc.blocks || []).map((b) => [b.id, b]));
  const seen = new Set();
  for (const owner of sources) {
    if (!owner.html?.includes('data-ivo-anchor')) continue;
    const ids = anchoredObjectIds(owner.html);
    if (owner.html.replace(canonicalMarker, '').match(/<[^>]*\sdata-ivo-anchor\b/i))
      throw Error('Malformed anchored object marker.');
    for (const id of ids) {
      const block = byId.get(id);
      const anchor = block?.extensions?.ivoAnchor;
      if (seen.has(id) || anchor?.ownerId !== owner.id)
        throw Error('Invalid anchored object reference.');
      if (Object.keys(anchor).some((key) => !['ownerId', 'position'].includes(key)))
        throw Error('Invalid anchored object settings.');
      checkBinding(doc, block, owner, anchor.position);
      seen.add(id);
    }
  }
  for (const block of byId.values()) {
    if (block.extensions && 'ivoAnchor' in block.extensions && !seen.has(block.id))
      throw Error('Missing anchored object marker.');
  }
}
