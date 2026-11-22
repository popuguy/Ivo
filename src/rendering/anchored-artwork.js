import { objectAvailable } from '../domain/documents/publishing.js';
import { sceneObjectHTML } from './page-content.js';
import { sizeAnchorSites } from './text/anchor-sites.js';

/** The marker owns composition. Artwork lives in the normal page scene so the editor,
 * print renderer and table tools address one real object at the measured position. */
export function placeAnchoredArtwork(root, doc, { source, flow, editing = false, pageId } = {}) {
  const anchored = doc.blocks.filter((b) => b.extensions?.ivoAnchor);
  if (!anchored.length && !root.hasAttribute('data-has-anchors')) return;
  root.toggleAttribute('data-has-anchors', !!anchored.length);
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
    const left =
      above && !slot.dataset.anchorSite
        ? (slot.closest('[data-flow-frame],[data-scene-text]')?.getBoundingClientRect().left ??
          rect.left)
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
    mounted.delete(item.id);
  }
  for (const element of mounted.values()) element.remove();
}
