// A marker owns its artwork through its text source. Mask children still
// belong to the artwork, even when the marker reflows onto a different page.
export function ownedSelection(doc, selection, { deleting = false } = {}) {
  const included = new Set(selection);
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const children = new Map();
  for (const block of doc.blocks) {
    const owner = block.parentId || block.extensions?.ivoAnchor?.ownerId;
    if (!owner) continue;
    if (!children.has(owner)) children.set(owner, []);
    children.get(owner).push(block.id);
  }
  const remaining = new Map((doc.textFlows || []).map((flow) => [flow.id, flow.frameIds.length]));
  const includeChildren = (id) => {
    for (const child of children.get(id) || []) included.add(child);
  };
  for (const id of included) {
    includeChildren(id);
    const flow = byId.get(id)?.textFlowId;
    if (!flow) continue;
    remaining.set(flow, remaining.get(flow) - 1);
    if (!deleting || remaining.get(flow) === 0) includeChildren(flow);
  }
  return included;
}

const marker = /<span\b[^>]*?\sdata-ivo-anchor\s*=\s*(["'])([\w-]+)\1[^>]*>\uFFFC<\/span>/gi;

export function rewriteAnchorMarkers(html, replacement) {
  if (!html?.includes('data-ivo-anchor')) return html;
  return html.replace(marker, (whole, quote, id) => {
    const next = replacement(id);
    if (next === id) return whole;
    return next ? whole.replace(quote + id + quote, quote + next + quote) : '';
  });
}

export function detachAnchor(block) {
  if (!block.extensions?.ivoAnchor) return;
  delete block.extensions.ivoAnchor;
  if (!Object.keys(block.extensions).length) delete block.extensions;
}

export function remapAnchorOwnership(holder, ids) {
  if (holder.html) holder.html = rewriteAnchorMarkers(holder.html, (id) => ids.get(id));
  const anchor = holder.extensions?.ivoAnchor;
  if (!anchor) return;
  if (ids.has(anchor.ownerId)) anchor.ownerId = ids.get(anchor.ownerId);
  else detachAnchor(holder);
}

export function removeAnchorReferences(doc, deleted) {
  for (const holder of [...(doc.textFlows || []), ...doc.blocks]) {
    if (holder.html?.includes('data-ivo-anchor'))
      holder.html = rewriteAnchorMarkers(holder.html, (id) => (deleted.has(id) ? null : id));
  }
}

/** A block's stored page is its original location. Text on surviving pages
 * still owns the anchored block if the page originally containing it goes. */
export function retainAnchorsOnPageRemoval(doc, pageId) {
  if (!doc.blocks.some((b) => b.pageId === pageId && b.extensions?.ivoAnchor)) return;
  const survivingPages = new Map();
  for (const block of doc.blocks) {
    if (block.pageId === pageId) continue;
    survivingPages.set(block.id, block.pageId);
    if (block.textFlowId && !survivingPages.has(block.textFlowId))
      survivingPages.set(block.textFlowId, block.pageId);
  }
  const children = new Map();
  for (const block of doc.blocks) {
    if (!block.parentId) continue;
    if (!children.has(block.parentId)) children.set(block.parentId, []);
    children.get(block.parentId).push(block);
  }
  function move(block, target) {
    block.pageId = target;
    for (const child of children.get(block.id) || []) move(child, target);
  }
  for (const block of doc.blocks) {
    const target = survivingPages.get(block.extensions?.ivoAnchor?.ownerId);
    if (block.pageId === pageId && target) move(block, target);
  }
}
