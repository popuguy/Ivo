// A text range travels in an ordinary, validated object archive. Its temporary
// frame owns precisely the graphics whose markers were included in the range.
import { anchorObject, anchoredObjectIds, anchorObjectMarker } from './anchored-objects.js';
import { copyObjectSelection, pasteObjectSelection } from './clipboard.js';
import { makeObject } from './scene.js';

export const INLINE_CLIPBOARD_TYPE = 'application/x-ivo-inline-objects+json';

export function copyInlineSelection(doc, frame, html, assets) {
  const ids = new Set(anchoredObjectIds(html));
  if (!ids.size) return null;
  const carrier = makeObject('text', frame.pageId, { html, textKind: 'point' });
  const ownerId = frame.textFlowId || frame.id;
  const blocks = doc.blocks.map((block) => {
    if (!ids.has(block.id)) return block;
    const anchor = block.extensions?.ivoAnchor;
    if (anchor?.ownerId !== ownerId) throw Error('The selected artwork is no longer in this text.');
    return {
      ...block,
      extensions: { ...block.extensions, ivoAnchor: { ...anchor, ownerId: carrier.id } },
    };
  });
  return copyObjectSelection({ ...doc, blocks: [...blocks, carrier] }, [carrier.id], assets);
}

/** Changes a disposable document. The caller inserts the returned markup and
 * commits the resources and document together with the normal text edit. */
export function prepareInlinePaste(planned, archive, frameId, fromRange) {
  const original = planned.blocks.find((b) => b.id === frameId);
  if (!original) throw Error('The destination frame is no longer available.');
  const roots = pasteObjectSelection(planned, archive, {
    pageId: original.pageId,
    layerId: original.layerId,
    offset: { x: 0, y: 0 },
  });
  const frame = planned.blocks.find((b) => b.id === frameId);
  const ownerId = frame.textFlowId || frame.id;
  const [root] = roots;
  if (roots.length !== 1) throw Error('Paste one graphic or table at the insertion point.');
  if (!fromRange) {
    anchorObject(planned, root, ownerId, root.type === 'table' ? 'above-line' : 'inline');
    return anchorObjectMarker(root.id);
  }
  if (root.type !== 'text' || root.textFlowId || !anchoredObjectIds(root.html).length)
    throw Error('The clipboard does not contain an anchored text selection.');
  for (const block of planned.blocks) {
    if (block.parentId === root.id) throw Error('The clipboard contains an invalid text frame.');
    const anchor = block.extensions?.ivoAnchor;
    if (anchor?.ownerId === root.id) anchor.ownerId = ownerId;
  }
  planned.blocks = planned.blocks.filter((b) => b !== root);
  return root.html;
}
