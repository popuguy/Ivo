import { paragraphDestinations } from '../../domain/documents/paragraph-destinations.js';
import { textIndexMap } from '../../shared/dom/text-selection.js';
import { collectPrintedEntries, flowTargetRect } from './publication-headings.js';

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
