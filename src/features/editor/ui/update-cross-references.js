import {
  paragraphDestinations,
  paragraphDestination,
} from '../../../domain/documents/paragraph-destinations.js';
import { crossReferenceResolver } from '../../../domain/documents/cross-references.js';
import { objectAvailable } from '../../../domain/documents/publishing.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function replaceLabel(link, label) {
  const walk = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  const leaves = [];
  while (walk.nextNode()) leaves.push(walk.currentNode);
  if (!leaves.length) {
    link.textContent = label;
    return;
  }
  if (leaves.length === 1) {
    leaves[0].data = label;
    return;
  }
  // A character-style boundary must never split a new emoji or combining sequence.
  const parts = [...graphemes.segment(label)].map((part) => part.segment);
  let offset = 0;
  for (const [i, leaf] of leaves.entries()) {
    const end =
      i === leaves.length - 1 ? parts.length : offset + [...graphemes.segment(leaf.data)].length;
    leaf.data = parts.slice(offset, end).join('');
    offset = end;
  }
}

/** Prepare a single undoable update. Unresolved labels and locked sources retain their last text. */
export function planCrossReferenceUpdate(doc, documents, onlyFormat, placements = new Map()) {
  const resolve = crossReferenceResolver(documents, doc),
    changes = [];
  const frames = new Map(doc.blocks.map((b) => [b.id, b]));
  let updated = 0,
    unresolved = 0,
    locked = 0;
  for (const holder of [...doc.blocks.filter((b) => !b.textFlowId), ...(doc.textFlows || [])]) {
    if (!holder.html?.includes('data-xref-format')) continue;
    const template = document.createElement('template');
    template.innerHTML = holder.html;
    const writable = (holder.frameIds || [holder.id]).every((id) =>
      objectAvailable(doc, frames.get(id)),
    );
    let changed = false;
    for (const link of template.content.querySelectorAll('a[data-xref-format]')) {
      if (onlyFormat && link.dataset.xrefFormat !== onlyFormat) continue;
      const pageId = link.dataset.pageId || /^#page=(.+)$/.exec(link.getAttribute('href'))?.[1];
      const id = link.dataset.docId || doc.id,
        key = link.dataset.xrefParagraph;
      if (key && !placements.has(id)) {
        const chapter = documents.find((d) => d.id === id);
        placements.set(id, chapter ? paragraphDestinations(chapter) : new Map());
      }
      const destination =
        key &&
        paragraphDestination(
          documents.find((d) => d.id === id),
          placements.get(id),
          key,
        );
      const nextPage = key ? destination?.pageId : pageId;
      const label = resolve(id, nextPage, link.dataset.xrefFormat, destination);
      if (label === null) {
        unresolved++;
        continue;
      }
      if (link.textContent === label && nextPage === pageId) continue;
      if (!writable) {
        locked++;
        continue;
      }
      if (nextPage !== pageId) {
        if (link.dataset.docId) link.dataset.pageId = nextPage;
        else link.setAttribute('href', '#page=' + nextPage);
      }
      if (link.textContent !== label) replaceLabel(link, label);
      updated++;
      changed = true;
    }
    if (changed) changes.push({ holder, html: template.innerHTML });
  }
  return { changes, updated, unresolved, locked };
}
