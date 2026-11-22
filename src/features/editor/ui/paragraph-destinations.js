import { uid } from '../../../domain/documents/model.js';
import {
  destinationTags,
  paragraphDestinations,
} from '../../../domain/documents/paragraph-destinations.js';
import { objectAvailable } from '../../../domain/documents/publishing.js';
import {
  composePublicationChapter,
  paintPublicationPage,
} from '../../../rendering/publication-pages.js';
import { prepareTextFlowFonts } from '../../../rendering/text/flow-layout.js';
import { printedParagraphs } from '../../../rendering/text/printed-paragraphs.js';
import { cleanHTML } from '../../../shared/html/sanitize.js';

export function markParagraphDialog(form, doc, block, { valid, mutate }) {
  const holder = block?.textFlowId ? doc.textFlows?.find((f) => f.id === block.textFlowId) : block;
  const writable = () =>
    holder &&
    (holder.frameIds || [holder.id]).every((id) =>
      objectAvailable(
        doc,
        doc.blocks.find((b) => b.id === id),
      ),
    );
  if (!writable() || !['text', 'quote'].includes(block.type))
    throw Error('Select an unlocked text frame.');
  const before = holder.html,
    root = document.createElement('div');
  root.innerHTML = cleanHTML(before);
  if (
    !root.querySelector(destinationTags) &&
    !root.querySelector('ul,ol,div,blockquote') &&
    root.textContent.trim()
  ) {
    const p = document.createElement('p');
    p.append(...root.childNodes);
    root.append(p);
  }
  const choices = [...root.querySelectorAll(destinationTags)].filter(
    (node) =>
      node.textContent.trim() &&
      !node.querySelector('a[data-xref-format],p,div,ul,ol,blockquote,h2,h3,h4'),
  );
  if (!choices.length) throw Error('Choose a frame containing a text paragraph or heading.');
  const dialog = form(
    'Mark Paragraph Destination',
    '<label>Paragraph<select name="paragraph"></select></label>',
    (data) => {
      if (!valid() || !writable() || holder.html !== before)
        throw Error('The text frame changed. Reopen the destination dialog.');
      const node = choices[Number(data.get('paragraph'))];
      if (!node || node.dataset.paragraphDestination) return;
      node.dataset.paragraphDestination = uid('par-');
      mutate(() => {
        holder.html = root.innerHTML;
        doc.canvasVersion = Math.max(doc.canvasVersion, 32);
      }, 'Mark paragraph destination');
    },
  );
  const select = dialog.querySelector('select');
  select.replaceChildren(
    ...choices.map(
      (node, i) =>
        new Option(
          (node.dataset.paragraphDestination ? '✓ ' : '') + node.textContent.trim().slice(0, 160),
          String(i),
        ),
    ),
  );
}

/** Resolve the first printed character of a marked paragraph from the canonical flow.
 * Closed chapters are composed on a disposable copy without generating pages or opening tabs. */
export async function placedParagraphs(chapter, { documents, assets, compose }) {
  if (!paragraphDestinations(chapter).size) return new Map();
  const snapshot = structuredClone(chapter),
    sources = new Map(assets.map((a) => [a.id, a.data]));
  await prepareTextFlowFonts();
  const { flow } = await composePublicationChapter(snapshot, documents, assets, compose, false);
  const host = document.createElement('div');
  host.inert = true;
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style;z-index:-1';
  document.body.append(host);
  try {
    const pages = snapshot.pages.map((p) => {
      const section = document.createElement('div');
      section.style.cssText =
        'position:relative;overflow:hidden;width:' + p.width + 'px;height:' + p.height + 'px';
      host.append(section);
      paintPublicationPage(section, snapshot, p, {
        flow,
        documents,
        source: (src) => (src?.startsWith('asset:') ? sources.get(src.slice(6)) || '' : src),
      });
      return { pageId: p.id, section };
    });
    await document.fonts.ready;
    return printedParagraphs(snapshot, flow, pages);
  } finally {
    host.remove();
  }
}

/** Measure only chapters containing paragraph targets actually referenced by these sources. */
export async function referencePlacements(owner, documents, options) {
  const chapterIds = new Set();
  for (const holder of [...owner.blocks, ...(owner.textFlows || [])]) {
    if (!holder.html?.includes('data-xref-paragraph')) continue;
    const root = document.createElement('template');
    root.innerHTML = holder.html;
    for (const node of root.content.querySelectorAll('a[data-xref-paragraph]'))
      chapterIds.add(node.dataset.docId || owner.id);
  }
  const placements = new Map(),
    snapshots = new Map();
  for (const id of chapterIds) {
    const chapter = documents.find((doc) => doc.id === id);
    if (!chapter) continue;
    snapshots.set(chapter, JSON.stringify(chapter));
    placements.set(id, await placedParagraphs(chapter, { ...options, documents }));
  }
  if ([...snapshots].some(([doc, before]) => JSON.stringify(doc) !== before))
    throw Error('A destination changed during composition. Update the cross-references again.');
  return placements;
}
