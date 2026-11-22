import { textIndexMap } from '../../shared/dom/text-selection.js';
import { publicationHeadingLevel } from '../../rendering/text/publication-headings.js';

// The export uses the same glyph paths and line ranges as the canvas. Give each
// printed paragraph its semantic role without moving or redrawing any glyph.
export function composedParagraphRoles(source, settings, defaultStyle) {
  const root = document.createElement('div');
  root.innerHTML = source.sourceHTML;
  const map = textIndexMap(root);
  const headings = [];
  for (const block of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div,blockquote')) {
    const level = publicationHeadingLevel(block, settings, defaultStyle);
    if (!level && block.tagName !== 'BLOCKQUOTE') continue;
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let leaf;
    while ((leaf = walk.nextNode())) {
      if (!leaf.data.trim()) continue;
      headings.push({ at: map.boundaries.get(leaf)[0], role: level ? 'H' + level : 'BlockQuote' });
      break;
    }
  }
  let next = 0;
  return source.paragraphs.map((paragraph) => {
    const heading = headings[next];
    if (heading && heading.at < paragraph.logicalEnd) {
      next++;
      return heading.role;
    }
    return 'P';
  });
}

export function describeComposedFrame(svg, composition, frame, roles, marker) {
  const { source, result } = composition;
  const lines = result.layout.lines.filter((line) => line.frame === frame.id);
  if (!lines.length) return;
  const linkRows = svg.lastElementChild.children;
  const paragraphs = [];
  let p = source.paragraphs.findIndex((paragraph) => paragraph.end > lines[0].start);
  for (let i = 0; i < lines.length;) {
    const paragraph = source.paragraphs[p];
    if (!paragraph || lines[i].start < paragraph.start) throw Error('Invalid PDF paragraph range.');
    const firstLine = i,
      start = lines[i].start;
    do {
      i++;
    } while (i < lines.length && lines[i].start < paragraph.end);
    const text = source.text
      .slice(start, Math.min(lines[i - 1].end, paragraph.contentEnd))
      .replaceAll('\u2028', '\n');
    if (text.trim()) {
      const key = marker + '-' + paragraphs.length;
      paragraphs.push({
        key,
        firstLine,
        through: i,
        role: start === paragraph.start ? roles[p] : 'P',
        text,
      });
      for (let j = firstLine; j < i; j++)
        for (const link of linkRows[j].querySelectorAll('a')) link.dataset.pdfParagraph = key;
    }
    p++;
  }
  if (!paragraphs.length) return;
  svg.setAttribute('aria-label', marker);
  return { marker, token: composition.token, lineCount: lines.length, paragraphs };
}

// Read the page in its authored order while keeping overlapping artwork at
// exactly the layer depth selected in the editor. Masks retain their children.
export function applyPDFReadingOrder(layout, doc) {
  const settings = doc.publication;
  if (!settings?.order?.length && !settings?.excluded?.length) return;
  const rank = new Map(settings.order.map((id, i) => [id, i]));
  const excluded = new Set(settings.excluded);
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  function order(parent) {
    const objects = [...parent.children].filter((el) => el.hasAttribute('data-object'));
    function key(el) {
      const item = blocks.get(el.dataset.object);
      return item?.textFlowId || item?.id;
    }
    for (const [i, object] of objects.entries()) {
      object.style.zIndex = String(i);
      if (excluded.has(key(object))) object.setAttribute('aria-hidden', 'true');
      for (const mask of object.querySelectorAll(':scope > .canvas-clip')) order(mask);
    }
    if (objects.some((el) => rank.has(key(el))))
      for (const el of objects.sort(
        (a, b) => (rank.get(key(a)) ?? rank.size) - (rank.get(key(b)) ?? rank.size),
      ))
        parent.append(el);
  }
  order(layout);
}
