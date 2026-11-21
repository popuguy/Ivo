import { textIndexMap } from '../../shared/dom/text-selection.js';
import { cleanHTML } from '../../shared/html/sanitize.js';
import { frameTextSettings } from '../../domain/documents/text-flows.js';

export function publicationHeadingLevel(element, settings, defaultStyle) {
  if (settings?.semantic !== false && /^H[1-6]$/.test(element.tagName))
    return Number(element.tagName[1]);
  if (!settings?.headings || element.querySelector('p,div,ol,ul,blockquote,h1,h2,h3,h4,h5,h6'))
    return null;
  const key = element.closest('[data-ivo-pstyle]')?.getAttribute('data-ivo-pstyle') ?? defaultStyle;
  return Object.hasOwn(settings.headings, key) ? settings.headings[key] : null;
}

function headingStarts(root, settings, defaultStyle) {
  let positions;
  const result = [];
  for (const node of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div')) {
    const level = publicationHeadingLevel(node, settings, defaultStyle);
    if (!level) continue;
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let first = walk.nextNode();
    while (first && !/\S/u.test(first.data)) first = walk.nextNode();
    if (!first) continue;
    positions ||= textIndexMap(root);
    const offset = first.data.search(/\S/u);
    result.push({
      level,
      title: node.textContent.trim(),
      at: positions.boundaries.get(first)[0] + offset,
      first,
      offset,
    });
  }
  return result;
}

/** Find the printed page containing a heading's first character. A subsequent
 * copy of the same paragraph in a continuation cannot create another bookmark. */
export function collectPageHeadings(doc, flow, pages, settings = doc.publication) {
  return collectPrintedEntries(doc, flow, pages, {
    matches: (root, style) => headingStarts(root, settings, style),
    mayMatch: (html) => Object.keys(settings?.headings || {}).length || /<h[1-6]\b/i.test(html),
  });
}

export function collectPrintedEntries(
  doc,
  flow,
  pages,
  { matches, mayMatch, includeTables = false },
) {
  const results = new Map(pages.map((page) => [page.pageId, []]));
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const physical = new Map(pages.map((p) => [p.pageId, p]));
  const excluded = new Set(doc.publication?.excluded || []);
  for (const source of doc.textFlows || [])
    if (source.contents || source.index) excluded.add(source.id);
  function add(id, heading) {
    const block = byId.get(id),
      page = physical.get(block?.pageId);
    if (!page || !page.section.querySelector('[data-object="' + CSS.escape(id) + '"]')) return;
    results.get(page.pageId).push({ title: heading.title, level: heading.level });
  }
  const sources = new Map((doc.textFlows || []).map((f) => [f.id, f]));
  const seen = new Set(),
    rank = new Map((doc.publication?.order || []).map((id, i) => [id, i]));
  const sorted = doc.blocks
    .filter((b) => ['text', 'quote'].includes(b.type) || (includeTables && b.type === 'table'))
    .sort((a, b) => {
      const order = (id) => rank.get(id) ?? rank.size;
      return order(a.textFlowId || a.id) - order(b.textFlowId || b.id) || a.y - b.y || a.x - b.x;
    });
  for (const block of sorted) {
    const source = sources.get(block.textFlowId),
      key = source?.id || block.id;
    if (seen.has(key) || excluded.has(key)) continue;
    seen.add(key);
    const html = source?.html ?? block.html ?? '';
    if (mayMatch && !mayMatch(html)) continue;
    const style = source?.style?.paragraphStyle || frameTextSettings(doc, block).paragraphStyle;
    if (!source) {
      const page = physical.get(block.pageId);
      const container = page?.section.querySelector('[data-object="' + CSS.escape(block.id) + '"]');
      if (!container) continue;
      const nodes =
        block.type === 'table'
          ? container.querySelectorAll('.page-table [data-table-row]')
          : container.querySelectorAll(':scope > [data-scene-text]');
      const frame = container.getBoundingClientRect(),
        sheet = page.section.getBoundingClientRect();
      for (const node of nodes)
        for (const h of matches(node, style)) {
          const range = document.createRange();
          range.setStart(h.first, h.offset);
          range.setEnd(h.first, h.offset + 1);
          const glyph = range.getBoundingClientRect();
          if (
            glyph.width &&
            glyph.height &&
            glyph.right > Math.max(frame.left, sheet.left) &&
            glyph.left < Math.min(frame.right, sheet.right) &&
            glyph.bottom > Math.max(frame.top, sheet.top) &&
            glyph.top < Math.min(frame.bottom, sheet.bottom)
          )
            add(block.id, h);
        }
      continue;
    }
    const root = document.createElement('div');
    root.innerHTML = cleanHTML(html);
    const headings = matches(root, style);
    let next = 0;
    for (const id of source.frameIds) {
      const fragment = flow.fragments.get(id);
      if (!fragment) continue;
      while (next < headings.length && headings[next].at < fragment.end) {
        const h = headings[next++];
        if (h.at >= fragment.start) add(id, h);
      }
    }
  }
  return results;
}
