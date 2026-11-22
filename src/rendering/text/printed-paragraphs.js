import { paragraphDestinations } from '../../domain/documents/paragraph-destinations.js';
import { textIndexMap } from '../../shared/dom/text-selection.js';
import { collectPrintedEntries } from './publication-headings.js';

function flowTargetRect(frame, fragment, at) {
  if (fragment.native) {
    const column = fragment.columns.find((c) => c.start <= at && at < c.end);
    const span = column?.native.spans.find(
      (s) => s.kind === 'text' && s.logicalStart <= at && at < s.logicalEnd,
    );
    if (!span) return null;
    const glyph = span.start + at - span.logicalStart;
    const line = column.native.lines.find((l) => l.start <= glyph && glyph < l.end);
    if (!line) return null;
    const row = frame.querySelector(
      '[data-flow-column="' + CSS.escape(column.id) + '"] [data-line-start="' + line.start + '"]',
    );
    const ink = row?.querySelector('[data-glyph-offset="' + (glyph - line.start) + '"]') || row;
    return ink?.getBoundingClientRect();
  }
  for (const marker of frame.querySelectorAll('[data-flow-text]')) {
    const offset = at - Number(marker.dataset.flowText);
    if (offset < 0 || offset >= marker.textContent.length) continue;
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
    let start = 0,
      leaf;
    while ((leaf = walker.nextNode())) {
      if (offset < start + leaf.length) {
        const range = document.createRange();
        range.setStart(leaf, offset - start);
        range.setEnd(leaf, offset - start + 1);
        return range.getBoundingClientRect();
      }
      start += leaf.length;
    }
  }
  return null;
}

export function printedParagraphs(doc, layout, pages) {
  const entries = paragraphDestinations(doc);
  if (!entries.size) return entries;
  for (const entry of entries.values()) if (entry) entry.pageId = null;
  const matches = collectPrintedEntries(doc, layout, pages, {
    flowTargetRect,
    mayMatch: (html) => html.includes('data-paragraph-destination'),
    matches(root) {
      const marked = root.querySelectorAll('[data-paragraph-destination]');
      if (!marked.length) return [];
      const map = textIndexMap(root);
      const result = [];
      for (const node of marked) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let first = walker.nextNode();
        while (first && !/\S/u.test(first.data)) first = walker.nextNode();
        if (!first) continue;
        const offset = first.data.search(/\S/u);
        result.push({
          marker: node.dataset.paragraphDestination,
          first,
          offset,
          at: map.boundaries.get(first)[0] + offset,
        });
      }
      return result;
    },
  });
  for (const [page, matchesOnPage] of matches)
    for (const { paragraphKey, topFraction } of matchesOnPage) {
      const entry = entries.get(paragraphKey);
      if (entry) {
        entry.pageId = page;
        entry.topFraction = topFraction;
      }
    }
  return entries;
}
