import { objectAvailable } from '../../domain/documents/publishing.js';
import { childrenOf } from '../../domain/documents/scene.js';
import { tableMarkup } from '../../rendering/table.js';

/** Keep bitmap crops as packaged assets and polygon paths as scalable EPUB artwork. */
export async function anchoredPublicationMarkup(doc, packageImage, escape) {
  const objects = new Map();
  async function graphic(item, nested) {
    let content;
    if (item.type === 'image') {
      if (!item.src) return '';
      const file = await packageImage({ ...item, parentId: null, rotation: 0 });
      content = '<image href="' + file + '" width="' + item.w + '" height="' + item.h + '"/>';
    } else {
      const points = item.points.map((p) => p.x * item.w + ',' + p.y * item.h).join(' ');
      const shape = '<polygon points="' + points + '"';
      content =
        shape +
        ' fill="' +
        escape(item.fill) +
        '" stroke="' +
        escape(item.stroke) +
        '" stroke-width="' +
        item.strokeWidth +
        '"/>';
      const children = childrenOf(doc, item.id).filter((b) =>
        objectAvailable(doc, b, { editing: false }),
      );
      if (children.length) {
        const clip = 'mask-' + item.id;
        content +=
          '<defs><clipPath id="' +
          clip +
          '">' +
          shape +
          '/></clipPath></defs><g clip-path="url(#' +
          clip +
          ')">';
        for (const child of children) content += await graphic(child, true);
        content += '</g>';
      }
    }
    return (
      '<g transform="translate(' +
      (nested ? item.x + ' ' + item.y : '0 0') +
      ') rotate(' +
      (item.rotation || 0) +
      ' ' +
      item.w / 2 +
      ' ' +
      item.h / 2 +
      ')" opacity="' +
      (item.opacity ?? 100) / 100 +
      '">' +
      content +
      '</g>'
    );
  }
  for (const item of doc.blocks) {
    if (
      !item.extensions?.ivoAnchor ||
      !objectAvailable(doc, item, { editing: false }) ||
      doc.publication?.excluded.includes(item.id)
    )
      continue;
    if (item.type === 'table') objects.set(item.id, tableMarkup(item.table, { escape }));
    else
      objects.set(
        item.id,
        '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' +
          escape(item.alt || item.name || 'Artwork') +
          '" width="' +
          item.w +
          '" height="' +
          item.h +
          '" viewBox="0 0 ' +
          item.w +
          ' ' +
          item.h +
          '">' +
          (await graphic(item, false)) +
          '</svg>',
      );
  }
  return objects;
}

/** XHTML paragraphs cannot contain tables. Preserve styled prose on each side. */
export function replacePublicationMarker(marker, markup) {
  if (!markup) {
    marker.remove();
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = markup;
  const artwork = template.content.firstElementChild,
    paragraph = marker.closest('p');
  if (artwork.tagName !== 'TABLE' || !paragraph) {
    marker.replaceWith(artwork);
    return;
  }
  const after = document.createRange();
  after.setStartAfter(marker);
  after.setEnd(paragraph, paragraph.childNodes.length);
  const tail = paragraph.cloneNode(false);
  tail.removeAttribute('id');
  tail.append(after.extractContents());
  marker.remove();
  paragraph.after(artwork);
  if (tail.textContent || tail.children.length) artwork.after(tail);
  if (!paragraph.textContent && !paragraph.hasAttribute('id')) paragraph.remove();
}
