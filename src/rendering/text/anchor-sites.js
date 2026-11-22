/** The DOM flow measures an atomic inline box. The native composer emits an equivalent SVG site. */
export function sizeAnchorSites(root, doc) {
  const slots = root.querySelectorAll('[data-ivo-anchor]');
  if (!slots.length) return;
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  for (const slot of slots) {
    const item = blocks.get(slot.dataset.ivoAnchor);
    if (!item?.extensions?.ivoAnchor) continue;
    const table = item.type === 'table',
      aboveLineGraphic = !table && item.extensions.ivoAnchor.position === 'above-line';
    Object.assign(slot.style, {
      display: table ? 'block' : 'inline-block',
      width: aboveLineGraphic ? '0px' : item.w + 'px',
      height: aboveLineGraphic ? 'calc(' + item.h + 'px + 1em)' : item.h + 'px',
      breakInside: table ? 'avoid' : '',
      overflow: 'hidden',
      lineHeight: '0',
      color: 'transparent',
      verticalAlign: 'baseline',
    });
    slot.contentEditable = 'false';
  }
}
