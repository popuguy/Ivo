import { placeAnchoredArtwork } from './anchored-artwork.js';
import { layoutTableThreads, prepareTableFonts } from './table-thread-layout.js';
import { orderedPageObjects, parentObjects } from '../domain/documents/publishing.js';
import { pageFolios } from '../domain/documents/page-sections.js';
import { readableHTML } from '../shared/html/sanitize.js';
import { applySceneTypography, sceneObjectHTML } from './page-content.js';
import { layoutDocumentTextFlows } from './text/flow-layout.js';
import { readyImageWrapResources } from './text/image-contours.js';
import { composeNativeTextFlows } from './text/native-flow-layout.js';

/** Both printed output and book references must measure the same shaped lines and visible objects. */
export async function composePublicationChapter(doc, documents, assets, compose, allowPages) {
  const imageContours = await readyImageWrapResources(doc, assets);
  const flow = layoutDocumentTextFlows(doc, { imageContours, allowPages });
  let native;
  if (doc.textFlows?.some((f) => f.composition)) {
    if (!compose) throw Error('This document requires the native text composer.');
    native = await composeNativeTextFlows(doc, { compose, assets, allowPages });
    for (const [id, part] of native.fragments) flow.fragments.set(id, part);
    for (const [id, value] of native.status) flow.status.set(id, value);
  }
  for (const part of flow.fragments.values())
    if (!part.native)
      part.html = readableHTML(part.html, documents, doc.id, {
        preserveWikiText: true,
        trustedFlow: true,
      });
  if (doc.blocks.some((b) => b.tableNext)) {
    await prepareTableFonts(doc);
    flow.tables = layoutTableThreads(doc);
  }
  return { flow, native };
}

export function paintPublicationPage(layout, doc, page, { source, flow, documents }) {
  const renderDoc = { ...doc, blocks: [...parentObjects(doc, page), ...doc.blocks] };
  layout.innerHTML = orderedPageObjects(renderDoc, page.id)
    .filter((item) => !item.extensions?.ivoAnchor)
    .map((item) =>
      sceneObjectHTML(item, {
        document: renderDoc,
        source,
        flow,
        textHTML: (block) => readableHTML(block.html, documents, doc.id),
      }),
    )
    .join('');
  applySceneTypography(layout, renderDoc);
  placeAnchoredArtwork(layout, renderDoc, { source, flow, pageId: page.id });
  return renderDoc;
}

export function publicationPages(doc, matches) {
  const folios = pageFolios(doc.pages);
  return doc.pages.map((p, i) => ({
    documentId: doc.id,
    pageId: p.id,
    folio: folios[i],
    section: !!p.section,
    entries: matches.get(p.id) || [],
  }));
}
