import { objectAvailable } from '../domain/documents/publishing.js';
import { sceneObject, worldRect } from '../domain/documents/scene.js';
import { sceneObjectHTML } from './page-content.js';
import { sizeAnchorSites } from './text/anchor-sites.js';

// Positions belong to a particular composition and view. Two editor windows can
// display the same document at different zoom levels or stages of reflow.
const placements = new WeakMap();

export function anchoredPlacement(root, id) {
  return placements.get(root)?.byId.get(id);
}

export function moveFrameArtwork(root, doc, frame) {
  const members = placements.get(root)?.byFrame.get(frame.id);
  if (!members) return;
  const origin = worldRect(doc, frame);
  for (const member of members) {
    member.element.style.left = origin.x + member.offsetX + 'px';
    member.element.style.top = origin.y + member.offsetY + 'px';
  }
}

/** The marker owns composition. Artwork lives in the normal page scene so the editor,
 * print renderer and table tools address one real object at the measured position. */
export function placeAnchoredArtwork(root, doc, { source, flow, editing = false, pageId } = {}) {
  const anchored = doc.blocks.filter((b) => b.extensions?.ivoAnchor);
  if (!anchored.length && !root.hasAttribute('data-has-anchors')) return;
  root.toggleAttribute('data-has-anchors', !!anchored.length);
  const positions = { byId: new Map(), byFrame: new Map() };
  if (editing && anchored.length) placements.set(root, positions);
  else placements.delete(root);
  const blocks = new Map(anchored.map((b) => [b.id, b]));
  const mounted = new Map(
    Array.from(root.querySelectorAll('[data-anchored-artwork]'), (el) => [el.dataset.object, el]),
  );
  sizeAnchorSites(root, doc);
  for (const slot of root.querySelectorAll('[data-anchor-site],[data-ivo-anchor]')) {
    if (slot.closest('.canvas-flow-input,[data-anchored-artwork]')) continue;
    const item = blocks.get(slot.dataset.anchorSite || slot.dataset.ivoAnchor);
    if (!item || !objectAvailable(doc, item, { editing: false })) continue;
    const page = pageId ? root : slot.closest('[data-page]');
    const modelPage = doc.pages.find((p) => p.id === (pageId || page?.dataset.page));
    if (!page || !modelPage) continue;
    const bounds = page.getBoundingClientRect();
    if (!bounds.width) continue;
    const scale = bounds.width / modelPage.width;
    const rect = slot.getBoundingClientRect();
    const above = item.extensions.ivoAnchor.position === 'above-line';
    const holder = slot.closest('[data-flow-frame],[data-scene-text]');
    const left =
      above && !slot.dataset.anchorSite
        ? (holder?.getBoundingClientRect().left ?? rect.left)
        : rect.left;
    const x = (left - bounds.left) / scale,
      y = (rect.top - bounds.top) / scale;
    let element = mounted.get(item.id);
    if (!element) {
      const template = document.createElement('template');
      template.innerHTML = sceneObjectHTML(
        { ...item, x, y },
        { document: doc, source, flow, editing },
      );
      element = template.content.firstElementChild;
      element.dataset.anchoredArtwork = '';
    }
    if (element.parentElement !== page) page.append(element);
    element.style.left = x + 'px';
    element.style.top = y + 'px';
    if (editing && holder) {
      const frame = sceneObject(doc, holder.dataset.flowFrame || holder.dataset.sceneText);
      if (frame) {
        const origin = worldRect(doc, frame);
        const placement = {
          element,
          frameId: frame.id,
          pageId: modelPage.id,
          offsetX: x - origin.x,
          offsetY: y - origin.y,
        };
        positions.byId.set(item.id, placement);
        if (!positions.byFrame.has(frame.id)) positions.byFrame.set(frame.id, []);
        positions.byFrame.get(frame.id).push(placement);
      }
    }
    mounted.delete(item.id);
  }
  for (const element of mounted.values()) element.remove();
}
