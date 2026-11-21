import { collectPageHeadings } from '../../rendering/text/publication-headings.js';
import { readyImageWrapResources } from '../../rendering/text/image-contours.js';
import { pageFolios } from '../../domain/documents/page-sections.js';
import { prepareVaultFonts } from '../../rendering/text/fonts.js';
import { parentObjects, orderedPageObjects } from '../../domain/documents/publishing.js';
import { layoutDocumentTextFlows, prepareTextFlowFonts } from '../../rendering/text/flow-layout.js';
import { sceneObjectHTML, applySceneTypography } from '../../rendering/page-content.js';
import { readableHTML } from '../../shared/html/sanitize.js';
import { intersectPDFRect, pdfRectInsidePolygon } from './pdf-plan.js';
import { composeNativeTextFlows } from '../../rendering/text/native-flow-layout.js';
import { composedPDFMatrix, composedPDFPolygon, screenToPageMatrix } from './composed-geometry.js';

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
    destinations = new Map(),
    nativeDocuments = new Map(),
    flowPlans = new Map();
  root.replaceChildren();
  let rules = '';
  for (const doc of documents) {
    const imageContours = await readyImageWrapResources(doc, snapshot.assets);
    const flow = layoutDocumentTextFlows(doc, { imageContours });
    if (doc.textFlows?.some((f) => f.composition)) {
      const port = globalThis.ivoTextComposition || globalThis.ivoNative?.textComposition;
      if (!port) throw Error('This document requires the native text composer for PDF export.');
      const native = await composeNativeTextFlows(doc, {
        compose: port.compose,
        assets: snapshot.assets,
      });
      nativeDocuments.set(doc.id, native);
      for (const [id, part] of native.fragments) flow.fragments.set(id, part);
      for (const [id, value] of native.status) flow.status.set(id, value);
    }
    for (const [_id, part] of flow.fragments)
      if (!part.native)
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
    flowPlans.set(doc.id, flow);
    const folios = pageFolios(doc.pages);
    for (const [pageIndex, page] of doc.pages.entries()) {
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
        folio: folios[pageIndex],
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
  for (const doc of documents) {
    const chapter = pages.filter((page) => page.documentId === doc.id);
    const headings = collectPageHeadings(doc, flowPlans.get(doc.id), chapter);
    for (const page of chapter) page.headings = headings.get(page.pageId);
  }
  const links = [],
    composedText = new Map();
  const pageTargets = new Map(pages.map((p, i) => [p.documentId + '/' + p.pageId, i]));
  for (const [pageIndex, page] of pages.entries()) {
    const pageRect = page.section.getBoundingClientRect(),
      factor = 4 / 3;
    const rect = (value) => ({
      x: (value.left - pageRect.left) / factor,
      y: (value.top - pageRect.top) / factor,
      w: value.width / factor,
      h: value.height / factor,
    });
    for (const composition of nativeDocuments.get(page.documentId)?.compositions || []) {
      for (const [sourcePageIndex, frame] of composition.frames.entries()) {
        if (frame.pageId !== page.pageId) continue;
        const svg = page.section.querySelector(
          `[data-flow-column="${CSS.escape(frame.id)}"] svg[data-composed-text]`,
        );
        // Nonprinting/hidden layers have no physical text placement in this export.
        if (!svg) continue;
        const matrix = screenToPageMatrix(svg.getScreenCTM(), pageRect, factor),
          clips = [];
        let clip = svg.closest('.canvas-clip');
        while (clip) {
          const owner = clip.parentElement,
            item = page.doc.blocks.find((block) => block.id === owner.dataset.object);
          if (!item?.points) throw Error('A frozen text mask lost its source shape.');
          const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          probe.setAttribute('viewBox', `0 0 ${item.w} ${item.h}`);
          probe.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
          clip.append(probe);
          const maskMatrix = screenToPageMatrix(probe.getScreenCTM(), pageRect, factor);
          probe.remove();
          clips.push(composedPDFPolygon(item.points, item.w, item.h, maskMatrix, page.height));
          clip = owner.parentElement.closest('.canvas-clip');
        }
        const layer = composedText.get(composition.token) || {
          token: composition.token,
          placements: [],
        };
        layer.placements.push({
          sourcePageIndex,
          destinationPageIndex: pageIndex,
          matrix: composedPDFMatrix(matrix, frame.height, page.height),
          clips,
        });
        composedText.set(composition.token, layer);
      }
    }
    for (const table of page.section.querySelectorAll('.table-frame')) {
      if (table.scrollHeight > table.clientHeight + 1 || table.scrollWidth > table.clientWidth + 1)
        warnings.add(
          `${page.doc.title}: table content extends outside its frame on page ${pageIndex + 1}.`,
        );
    }
    for (const anchor of page.section.querySelectorAll('a')) {
      const targetId = anchor.dataset.docId;
      let target;
      if (targetId) {
        if (destinations.has(targetId)) target = { pageIndex: destinations.get(targetId) };
        else warnings.add(`Link to a document outside this export: ${anchor.textContent.trim()}`);
      } else if (anchor.getAttribute('href')?.startsWith('#page=')) {
        const index = pageTargets.get(page.documentId + '/' + anchor.getAttribute('href').slice(6));
        if (index !== undefined) target = { pageIndex: index };
        else warnings.add('Link to a missing page: ' + anchor.textContent.trim());
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
          if (text && text.dataset.textKind !== 'point')
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
    composedText: [...composedText.values()],
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
