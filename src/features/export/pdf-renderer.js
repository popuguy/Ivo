import { prepareVaultFonts } from '../../rendering/text/fonts.js';
import { parentObjects, orderedPageObjects } from '../../domain/documents/publishing.js';
import { layoutDocumentTextFlows, prepareTextFlowFonts } from '../../rendering/text/flow-layout.js';
import { sceneObjectHTML, applySceneTypography } from '../../rendering/page-content.js';
import { readableHTML } from '../../shared/html/sanitize.js';
import { intersectPDFRect, pdfRectInsidePolygon } from './pdf-plan.js';

/** The only renderer used for PDF output: no editor, camera, user scripts or external requests. */
export async function renderPDFSnapshot(snapshot) {
  await prepareTextFlowFonts();
  await prepareVaultFonts(snapshot.assets);
  const root = document.querySelector('#pdf-pages'),
    assets = new Map(snapshot.assets.map((asset) => [asset.id, asset.data]));
  const source = (src) => (src.startsWith('asset:') ? assets.get(src.slice(6)) || '' : src);
  const pages = [],
    documents = snapshot.documents,
    warnings = new Set(),
    destinations = new Map();
  root.replaceChildren();
  let rules = '';
  for (const doc of documents) {
    const flow = layoutDocumentTextFlows(doc);
    for (const [_id, part] of flow.fragments)
      part.html = readableHTML(part.html, documents, doc.id, {
        preserveWikiText: true,
        trustedFlow: true,
      });
    for (const value of flow.status.values())
      if (value.overset)
        warnings.add(`${doc.title}: document text has overset text that is not included.`);
    if (documents.reduce((sum, doc) => sum + doc.pages.length, 0) > 256)
      throw new Error('Export up to 256 pages at a time.');
    destinations.set(doc.id, pages.length);
    for (const page of doc.pages) {
      const index = pages.length,
        name = 'ivo_page_' + index;
      rules += `@page ${name}{size:${page.width}pt ${page.height}pt;margin:0}`;
      const section = document.createElement('section');
      section.className = 'pdf-page';
      section.style.cssText = `page:${name};width:${page.width}pt;height:${page.height}pt`;
      const layout = document.createElement('div');
      layout.className = 'pdf-layout';
      layout.style.cssText = `width:${page.width}px;height:${page.height}px`;
      const inherited = parentObjects(doc, page),
        renderDoc = { ...doc, blocks: [...inherited, ...doc.blocks] };
      layout.innerHTML = [...orderedPageObjects(renderDoc, page.id)]
        .map((item) =>
          sceneObjectHTML(item, {
            document: renderDoc,
            source,
            flow,
            textHTML: (block) => readableHTML(block.html, documents, doc.id),
          }),
        )
        .join('');
      section.append(layout);
      root.append(section);
      applySceneTypography(layout, renderDoc);
      pages.push({
        documentId: doc.id,
        documentTitle: doc.title,
        sourceVersion: doc.version,
        pageId: page.id,
        name: page.name,
        width: page.width,
        height: page.height,
        section,
        doc: renderDoc,
      });
    }
  }
  const style = document.createElement('style');
  style.textContent = rules;
  document.head.append(style);
  await Promise.all(
    [
      '400 16px "CMU Serif"',
      '700 16px "CMU Serif"',
      'italic 400 16px "CMU Serif"',
      'italic 700 16px "CMU Serif"',
    ].map((font) => document.fonts.load(font)),
  );
  await document.fonts.ready;
  await Promise.all(
    [...root.querySelectorAll('img')].map((image) =>
      image.decode().catch(() => {
        throw new Error('An image could not be decoded. PDF was not exported.');
      }),
    ),
  );
  const links = [];
  for (const [pageIndex, page] of pages.entries()) {
    const pageRect = page.section.getBoundingClientRect(),
      factor = 4 / 3;
    const rect = (value) => ({
      x: (value.left - pageRect.left) / factor,
      y: (value.top - pageRect.top) / factor,
      w: value.width / factor,
      h: value.height / factor,
    });
    for (const anchor of page.section.querySelectorAll('a')) {
      const targetId = anchor.dataset.docId;
      let target;
      if (targetId) {
        if (destinations.has(targetId)) target = { pageIndex: destinations.get(targetId) };
        else warnings.add(`Link to a document outside this export: ${anchor.textContent.trim()}`);
      } else if (/^https?:\/\//.test(anchor.getAttribute('href') || ''))
        target = { url: anchor.href };
      else if (anchor.classList.contains('unresolved'))
        warnings.add(`Unresolved document link: ${anchor.textContent.trim()}`);
      if (target)
        for (const clientRect of anchor.getClientRects()) {
          let visible = intersectPDFRect(rect(clientRect), {
            x: 0,
            y: 0,
            w: page.width,
            h: page.height,
          });
          if (!visible) continue;
          const text = anchor.closest('.canvas-text');
          if (text?.dataset.textKind !== 'point')
            visible = intersectPDFRect(visible, rect(text.getBoundingClientRect()));
          if (!visible) continue;
          let clip = anchor.closest('.canvas-clip'),
            clipped = false;
          while (clip) {
            const owner = clip.parentElement,
              item = page.doc.blocks.find((block) => block.id === owner.dataset.object),
              box = rect(clip.getBoundingClientRect());
            const points = item.points.map((p) => ({
              x: box.x + p.x * box.w,
              y: box.y + p.y * box.h,
            }));
            if (!pdfRectInsidePolygon(visible, points)) {
              clipped = true;
              break;
            }
            clip = owner.parentElement.closest('.canvas-clip');
          }
          if (clipped) {
            warnings.add(
              `A link crossing a polygon mask was omitted: ${anchor.textContent.trim()}`,
            );
            continue;
          }
          links.push({ pageIndex, rect: visible, target });
        }
      // Chromium must not retain local file/ivo destinations or invisible native annotations.
      anchor.removeAttribute('href');
      anchor.removeAttribute('target');
    }
  }
  return {
    format: 'ivo-pdf-manifest-1',
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    pages: pages.map(({ section, doc, ...page }) => page),
    links,
    warnings: [...warnings],
  };
}
if (globalThis.ivoPDF)
  try {
    const manifest = await renderPDFSnapshot(await globalThis.ivoPDF.snapshot());
    await globalThis.ivoPDF.ready({ manifest });
  } catch (error) {
    await globalThis.ivoPDF.ready({ error: error.message });
  }
