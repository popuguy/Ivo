/** The DOM flow measures an atomic inline box. The native composer emits an equivalent SVG site. */
export function sizeAnchorSites(root, doc) {
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  for (const slot of root.querySelectorAll('[data-ivo-anchor]')) {
    const item = blocks.get(slot.dataset.ivoAnchor);
    if (!item?.extensions?.ivoAnchor) continue;
    const above = item.extensions.ivoAnchor.position === 'above-line';
    Object.assign(slot.style, {
      display: 'inline-block',
      width: above ? '0px' : item.w + 'px',
      height: above ? 'calc(' + item.h + 'px + 1em)' : item.h + 'px',
      overflow: 'hidden',
      lineHeight: '0',
      color: 'transparent',
      verticalAlign: 'baseline',
    });
    if (item.type === 'table')
      Object.assign(slot.style, {
        display: 'block',
        width: item.w + 'px',
        height: item.h + 'px',
        breakInside: 'avoid',
      });
    slot.contentEditable = 'false';
  }
}
