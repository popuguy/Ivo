import { taggedWords, verifyTaggedBook } from './tagged-book.mjs';
import { verifyEndnotePDF } from './endnotes.mjs';
import { verifyPrintedStyleRules } from './paragraph-style-rules.mjs';
import { publicationPages } from '../../../src/rendering/publication-pages.js';
import { indexHTML } from '../../../src/features/editor/ui/subject-index.js';
import { contentsSettings } from '../../../src/domain/documents/contents-settings.js';
import { writePublicationText } from '../../../src/domain/documents/contents.js';
import { contentsHTML } from '../../../src/features/editor/ui/table-of-contents.js';
import { baselineGridFixture, addGridWrap } from '../../fixtures/text/baseline-grid.js';
import { verifyPortableTypeSpecimens } from './portable-type.mjs';
import { createHash } from 'node:crypto';
import { inspectFont } from '../../../src/domain/text/fonts.js';
import { markTypographyVersion } from '../../../src/domain/documents/capabilities.js';
import { setTextWrap } from '../../../src/domain/documents/text-wrap.js';
import { prepareBackgroundTest } from '../helpers/background.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  enablePublishing,
  createParent,
  saveTextStyle,
  applyParent,
  addLayer,
} from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  threadFrame,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { app, ipcMain, nativeImage } from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { renderPDF as renderNativePDF, pdfRendererOwner } from '../../../desktop/pdf-export.mjs';
import { installTextCompositionBridge } from '../../../desktop/text-composition-bridge.mjs';
import { createTextComposition } from '../../../desktop/text-composition.mjs';
import { nativeTextTestExecutable } from '../helpers/native-text.mjs';
import { verifyCharacterPDF } from './character-export.mjs';
import { verifyParagraphKeepsPDF } from './paragraph-keeps.mjs';
import { verifyWordSpacingPDF } from './word-spacing.mjs';
let compositionBridge;
const nativeCompositions = [];
const renderPDF = (snapshot, options) =>
  renderNativePDF(snapshot, {
    ...options,
    compositionPDF: (contents, token) => compositionBridge.readPDF(contents, token),
  });
import {
  createSceneDocument,
  continueTableOnNextPage,
  addPage,
  insertObject as insert,
} from '../../../src/domain/documents/scene.js';
import { createTable } from '../../../src/domain/documents/tables.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

const insertObject = (doc, type, options = {}) => {
  const { pageId = doc.pages[0].id, ...rest } = options;
  const item = insert(doc, type, pageId, rest);
  if (type === 'polygon') Object.assign(item, rest);
  return item;
};
const root = fileURLToPath(new URL('../../..', import.meta.url)),
  output = path.resolve(root, '../work/pdf-export/runtime');
const profile = process.argv[2];
if (!profile) throw Error('Start the isolated PDF suite with npm run test:pdf.');
prepareBackgroundTest(app);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
app
  .whenReady()
  .then(async () => {
    compositionBridge = installTextCompositionBridge({
      ipcMain,
      authorize: pdfRendererOwner,
      createService: async () => {
        const service = createTextComposition(await nativeTextTestExecutable());
        return {
          compose: async (request) => {
            const result = await service.compose(request);
            nativeCompositions.push({ request, result });
            return result;
          },
          pdf: service.pdf,
          close: service.close,
        };
      },
    });
    await mkdir(output, { recursive: true });
    await verifyEndnotePDF({ root, output, renderPDF });
    const a = createSceneDocument('PDF typography'),
      b = createSceneDocument('Linked reference');
    Object.assign(addPage(a, a.pages[0].id), { width: 800.25, height: 500, name: 'Landscape' });
    b.pages[0].width = 300;
    b.pages[0].height = 400;
    const first = a.pages[0].id,
      second = a.pages[1].id;
    insertObject(a, 'text', {
      pageId: first,
      x: 72,
      y: 65,
      w: 460,
      h: 180,
      textStyle: 'cmu-serif',
      fontSize: 20,
      html: `<p>Alpha Ω café <strong>bold</strong> <em>italic</em> <strong><em>both</em></strong></p><p><a data-doc-id="${b.id}">Linked reference</a> · <a href="https://example.com">External</a></p><p><span data-ivo-size="28" data-ivo-color="#9a2040">Large red type</span></p>`,
    });
    insertObject(a, 'text', {
      pageId: second,
      x: 50.25,
      y: 40.5,
      w: 400,
      h: 100,
      textStyle: 'cmu-serif',
      fontSize: 24,
      textKind: 'point',
      textScale: { x: 1.1, y: 0.9 },
      html: '<p>Landscape point text</p>',
    });
    const mask = insertObject(a, 'polygon', {
      pageId: first,
      x: 72,
      y: 300,
      w: 200,
      h: 200,
      clip: true,
      fill: '#edf2f6',
      stroke: '#445577',
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 1, y: 0 },
        { id: 'p3', x: 0, y: 1 },
      ],
    });
    insertObject(a, 'text', {
      pageId: first,
      parentId: mask.id,
      x: 8,
      y: 10,
      w: 180,
      h: 180,
      textStyle: 'cmu-serif',
      fontSize: 16,
      html: `<p><a data-doc-id="${b.id}">Visible link</a></p><p>Text remains selectable.</p><p><br></p><p><br></p><p><a href="https://hidden.example.com">Masked link crossing boundary</a></p>`,
    });
    insertObject(a, 'polygon', { pageId: first, x: 340, y: 300, w: 150, h: 150, fill: '#b5c8dc' });
    insertObject(b, 'text', {
      x: 30,
      y: 40,
      w: 230,
      h: 200,
      textStyle: 'cmu-serif',
      fontSize: 18,
      html: `<p>Reference page <a data-doc-id="${a.id}">Back to source</a>.</p>`,
    });
    const pixels = Buffer.alloc(1024 * 512 * 4);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 1024; x++) {
        const i = (y * 1024 + x) * 4;
        pixels[i] = x < 512 ? 210 : 80;
        pixels[i + 1] = y < 256 ? 160 : 210;
        pixels[i + 2] = x < 512 ? 70 : 180;
        pixels[i + 3] = 255;
      }
    const original = nativeImage.createFromBitmap(pixels, { width: 1024, height: 512 }).toPNG();
    const asset = {
      id: 'pdf-photo',
      name: 'Original 1024 image.png',
      mimeType: 'image/png',
      data: 'data:image/png;base64,' + original.toString('base64'),
    };
    insertObject(a, 'image', {
      pageId: first,
      x: 72,
      y: 550,
      w: 420,
      h: 160,
      src: 'asset:pdf-photo',
      fit: 'cover',
      crop: { x: 30, y: 75 },
      caption: 'Original image · cropped placement',
    });
    const snapshot = createPDFSnapshot([a, b], [asset], a.id, { includeLinked: true }),
      before = JSON.stringify(snapshot);
    let layout;
    const { bytes, manifest } = await renderPDF(snapshot, {
      project: root,
      onRendered: async (window, _manifest) => {
        layout = await window.webContents.executeJavaScript(
          `(()=>{const page=document.querySelector('.pdf-page'),text=page.querySelector('.canvas-text'),range=document.createRange();range.setStart(text.firstChild.firstChild,0);range.setEnd(text.firstChild.firstChild,5);const r=range.getBoundingClientRect(),p=page.getBoundingClientRect();return {textX:(r.left-p.left)*.75,textY:(r.top-p.top)*.75,font:getComputedStyle(text).fontFamily,links:[...document.querySelectorAll('a[href]')].filter(a=>!a.getAttribute('href').startsWith('https://ivo-pdf.invalid/annotation/')).length,controls:document.querySelectorAll('button,input').length}})()`,
        );
        assert.equal(layout.links, 0);
        assert.equal(layout.controls, 0);
        assert.ok(Math.abs(layout.textX - 72) < 0.01);
        const capture = await window.webContents.capturePage({
          x: 0,
          y: 0,
          width: 816,
          height: 1056,
        });
        await writeFile(path.join(output, 'renderer.png'), capture.toPNG());
      },
    });
    assert.equal(JSON.stringify(snapshot), before);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 3);
    assert.deepEqual(
      pdf.getPages().map((page) => page.getSize()),
      [
        { width: 612, height: 792 },
        { width: 800.25, height: 500 },
        { width: 300, height: 400 },
      ],
    );
    assert.ok(manifest.links.some((link) => link.target.pageIndex === 2));
    assert.ok(manifest.links.some((link) => link.target.pageIndex === 0));
    assert.ok(manifest.links.some((link) => link.target.url === 'https://example.com/'));
    assert.ok(!manifest.links.some((link) => link.target.url?.includes('hidden.example')));
    assert.ok(manifest.warnings.some((w) => w.includes('polygon mask')));
    for (const [_i, page] of pdf.getPages().entries())
      for (const annotation of page.node.Annots()?.asArray() || []) {
        const dict = pdf.context.lookup(annotation);
        assert.equal(dict.get(PDFName.of('Subtype')).toString(), '/Link');
      }
    await writeFile(path.join(output, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
    await writeFile(path.join(output, 'output.pdf'), bytes);
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await writeFile(path.join(output, 'layout.json'), JSON.stringify(layout, null, 2));
    const front = createSceneDocument('Préface Ω');
    front.pages[0].section = { style: 'roman-lower', prefix: '', start: 1 };
    const owner = structuredClone(a);
    owner.publication = { version: 1, order: [], excluded: [], chapters: [front.id, owner.id] };
    owner.pages[0].section = { style: 'decimal', prefix: 'A–', start: 7 };
    markTypographyVersion(front);
    markTypographyVersion(owner);
    const footerFrame = insertObject(owner, 'text', {
      x: 36,
      y: 350,
      w: 240,
      h: 32,
      html: '<p>Printed «Current Page Number» / «Last Page Number»</p>',
      extensions: { ivoRunningText: true },
    });
    const footerParent = createParent(owner, owner.pages[0].id, 'Pagination');
    footerParent.blocks = footerParent.blocks.filter((b) => b.extensions?.ivoRunningText);
    owner.blocks = owner.blocks.filter((b) => b.id !== footerFrame.id);
    for (const page of owner.pages) applyParent(owner, page.id, footerParent.id);
    markTypographyVersion(owner);
    const referenceFrame = insertObject(front, 'text', {
      x: 30,
      y: 30,
      w: 480,
      h: 180,
      html: '<h2 data-paragraph-destination="par-sources">Sources</h2><h3>Image credits</h3>',
    });
    const nativeTarget = insertObject(front, 'text', {
      x: 42,
      y: 170,
      w: 285,
      h: 100,
      fontSize: 13,
      textStyle: 'cmu-serif',
      html: '<p>Paragraph location proof</p><p data-paragraph-destination="par-native">Fibre index</p>',
    });
    const targetFlow = startTextFlow(front, nativeTarget.id, { automaticPages: false });
    enableNativeComposition(front, targetFlow, 'single-line');
    front.publication = {
      version: 1,
      order: [targetFlow.id, referenceFrame.id],
      excluded: [],
      chapters: [],
    };
    insertObject(owner, 'text', {
      pageId: owner.pages[1].id,
      x: 42,
      y: 230,
      w: 275,
      h: 60,
      html:
        '<p><a data-doc-id="' +
        front.id +
        '" data-page-id="stale" href="#doc=' +
        front.id +
        '" data-xref-format="paragraph-text" data-xref-paragraph="' +
        targetFlow.id +
        '/par-native">Fibre index</a></p>',
    });
    markTypographyVersion(front);
    owner.referenceFormats = [
      { id: 'xref-proof', name: 'Proof', definition: '<paraText/> · <pageNum/>' },
    ];
    const headingStyle = saveTextStyle(owner, 'paragraph', {
      name: 'Contents heading',
      attributes: { fontSize: 12, textStyle: 'cmu-serif' },
    });
    owner.publication.headings = { [headingStyle.id]: 2 };
    const intro = insertObject(owner, 'text', {
      x: 25,
      y: 25,
      w: 180,
      h: 19,
      textStyle: 'cmu-serif',
      fontSize: 12,
      leading: 16,
      html:
        '<p><a href="#page=' +
        owner.pages[1].id +
        '">Opening</a> <a data-xref-format="xref-proof" data-xref-paragraph="' +
        referenceFrame.id +
        '/par-sources" data-doc-id="' +
        front.id +
        '" data-page-id="' +
        'obsolete-page-cache' +
        '" href="#doc=' +
        front.id +
        '">Sources · i</a></p><p data-ivo-pstyle="' +
        headingStyle.id +
        '">Woven surfaces</p><p>' +
        'Overflow '.repeat(160) +
        '</p><p data-ivo-pstyle="' +
        headingStyle.id +
        '">Unprinted entry</p>',
    });
    const continuation = insertObject(owner, 'text', {
      pageId: owner.pages[1].id,
      x: 25,
      y: 25,
      w: 180,
      h: 62,
      html: '',
    });
    const indexedFlow = startTextFlow(owner, intro.id, { automaticPages: false });
    threadFrame(owner, intro.id, continuation.id);
    enableNativeComposition(owner, indexedFlow, 'single-line');
    markTypographyVersion(owner);
    const swatches = createTable(6, 2);
    swatches.headerRows = swatches.footerRows = 1;
    swatches.inset = 0;
    swatches.stroke = 0.5;
    const fabrics = [
      'Weave sample',
      'Linen twill',
      'Silk crepe',
      'Wool hopsack',
      'Cotton voile',
      'Sample register',
    ];
    fabrics.forEach((label, row) => {
      swatches.cells[row][0] = label;
    });
    swatches.rowOptions = Object.fromEntries(fabrics.map((_, i) => [i, { minimumHeight: 20 }]));
    const swatchFrame = insertObject(owner, 'table', {
      x: 40,
      y: 320,
      w: 270,
      h: 84,
      fontSize: 10,
      table: swatches,
    });
    continueTableOnNextPage(owner, swatchFrame.id);
    const book = createPDFSnapshot([owner, front], [asset], owner.id, { useBook: true });
    const bookPDF = await renderPDF(book, { project: root });
    assert.deepEqual(
      bookPDF.manifest.pages.map((p) => p.documentId),
      [front.id, owner.id, owner.id],
    );
    const bookFile = path.join(output, 'sectioned-book.pdf');
    await writeFile(bookFile, bookPDF.bytes);
    const inspected = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      path.join(root, 'tests/runtime/pdf/inspect-book.swift'),
      bookFile,
    ]);
    const outline = JSON.parse(inspected.stdout);
    await verifyTaggedBook(bookPDF.bytes);
    const followed = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      path.join(root, 'tests/runtime/pdf/follow-book-links.swift'),
      bookFile,
    ]);
    assert(JSON.parse(followed.stdout).some(([from, to]) => from === 2 && to === 0));
    for (const title of ['Sources', 'Image credits', 'Woven surfaces'])
      assert(
        outline.headingPoints.some(([label, top]) => label === title && top > 0),
        'Bookmark should land at the first printed line of ' + title,
      );
    for (const page of [1, 2]) {
      assert.match(outline.text[page], /Weave sample/);
      assert.match(outline.text[page], /Sample register/);
      for (const label of fabrics.slice(1, -1)) {
        assert.equal(
          outline.text[page].includes(label),
          page === (fabrics.indexOf(label) <= 2 ? 1 : 2),
          'Printed row "' + label + '" on book page ' + page,
        );
      }
    }
    assert(
      outline.pageLinks.some(([from, to]) => from === 1 && to === 0),
      'The composed inline reference lost its external page destination',
    );
    assert.match(outline.text[1], /Sources\s*·\s*i/);
    assert(
      outline.linkPoints.some(([from, to, top]) => from === 1 && to === 0 && top > 20 && top < 120),
      'PDFKit did not land at the referenced paragraph',
    );
    assert(
      outline.linkPoints.some(
        ([from, to, top]) => from === 2 && to === 0 && top > 172 && top < 270,
      ),
      'PDFKit did not land on the native target line',
    );
    assert.deepEqual(outline.labels, ['i', 'A–7', 'A–8']);
    assert(
      outline.pageLinks.some(([from, to]) => from === 1 && to === 2),
      'Native text link did not navigate to the next page in PDFKit',
    );
    const withContents = structuredClone(owner);
    const settings = contentsSettings({ includeBook: true, styles: { [headingStyle.id]: 2 } });
    const entries = new Map(
      bookPDF.manifest.pages
        .filter((p) => p.documentId === owner.id)
        .map((p) => [p.pageId, p.headings]),
    );
    writePublicationText(
      withContents,
      null,
      contentsHTML(
        withContents,
        [
          ...publicationPages(
            front,
            new Map([[front.pages[0].id, [{ title: 'Book introduction', level: 1 }]]]),
          ),
          ...publicationPages(withContents, entries),
        ],
        settings,
      ),
      settings,
    );
    const indexOptions = { title: 'Subject index', topics: [['Textiles', 'Weaves']], ranges: true };
    const matches = new Map(
      withContents.pages
        .slice(0, 2)
        .map((p) => [p.id, [{ title: JSON.stringify(['Textiles', 'Weaves']) }]]),
    );
    writePublicationText(
      withContents,
      null,
      indexHTML(withContents, publicationPages(withContents, matches), indexOptions),
      indexOptions,
      { kind: 'index' },
    );
    const contentsPDF = await renderPDF(
      createPDFSnapshot([withContents, front], [asset], owner.id, { useBook: true }),
      { project: root },
    );
    const tocFile = path.join(output, 'book-contents.pdf');
    await writeFile(tocFile, contentsPDF.bytes);
    const tocInspected = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      path.join(root, 'tests/runtime/pdf/inspect-book.swift'),
      tocFile,
    ]);
    const toc = JSON.parse(tocInspected.stdout);
    assert.match(toc.text[4], /Weaves\s+A–7–A–8/u);
    for (const dest of [1, 2])
      assert(
        toc.pageLinks.some(([from, to]) => from === 4 && to === dest),
        'Index range endpoint lost its PDF destination',
      );
    assert.match(toc.text[3], /Book introduction/);
    assert(
      toc.pageLinks.some(([from, to]) => from === 3 && to === 0),
      'Book contents lost the other chapter destination',
    );
    assert.match(toc.text[3], /Woven surfaces\s+A–8/u);
    assert(
      toc.pageLinks.some(([from, to]) => from === 3 && to === 2),
      'Printed contents did not link to the heading’s page',
    );
    assert(!toc.text[3].includes('Unprinted entry'), 'Overset heading appeared in the contents');
    assert.match(outline.text[1], /Printed A–7 \/ A–8/);
    assert.match(outline.text[2], /Printed A–8 \/ A–8/);
    assert.deepEqual(outline.bookmarks, [
      {
        title: front.title,
        page: 0,
        children: [
          {
            title: 'Sources',
            page: 0,
            children: [{ title: 'Image credits', page: 0, children: [] }],
          },
        ],
      },
      {
        title: owner.title,
        page: 1,
        children: owner.pages.map((p, i) => ({
          title: p.name,
          page: i + 1,
          children: i === 1 ? [{ title: 'Woven surfaces', page: 2, children: [] }] : [],
        })),
      },
    ]);
    const long = createSceneDocument('Flow PDF', { width: 360, height: 300 }),
      flowFrame = insertObject(long, 'text', {
        x: 30,
        y: 30,
        w: 300,
        h: 240,
        textStyle: 'cmu-serif',
        fontSize: 18,
        html: Array.from(
          { length: 24 },
          (_, i) =>
            `<p>P${String(i).padStart(3, '0')} <strong>Rich source</strong> <em>café Ω</em> flows from frame to frame without missing or duplicated text.</p>`,
        ).join(''),
      });
    startTextFlow(long, flowFrame.id);
    const flowSnapshot = createPDFSnapshot([long], [], long.id),
      flowBefore = JSON.stringify(flowSnapshot),
      flowPDF = await renderPDF(flowSnapshot, { project: root });
    assert.equal(JSON.stringify(flowSnapshot), flowBefore);
    assert.ok(flowPDF.manifest.pages.length > 5);
    assert.deepEqual(flowPDF.manifest.warnings, []);
    await writeFile(path.join(output, 'flow-source.json'), JSON.stringify(flowSnapshot, null, 2));
    await writeFile(path.join(output, 'flow.pdf'), flowPDF.bytes);
    await writeFile(
      path.join(output, 'flow-manifest.json'),
      JSON.stringify(flowPDF.manifest, null, 2),
    );
    const publishing = createSceneDocument('Publishing export'),
      fontBytes = await readFile(path.join(root, 'public/fonts/cmu-serif/cmunrm.ttf')),
      font = inspectFont(fontBytes),
      fontId = 'font-' + createHash('sha256').update(fontBytes).digest('hex');
    enablePublishing(publishing);
    const parentMask = insertObject(publishing, 'polygon', {
      x: 40,
      y: 40,
      w: 220,
      h: 150,
      clip: true,
      points: [
        { id: 'pm-a', x: 0, y: 0 },
        { id: 'pm-b', x: 1, y: 0 },
        { id: 'pm-c', x: 0, y: 1 },
      ],
      fill: '#e6e8eb',
      stroke: '#626872',
    });
    insertObject(publishing, 'text', {
      parentId: parentMask.id,
      x: 8,
      y: 8,
      w: 180,
      h: 100,
      textStyle: fontId,
      fontSize: 16,
      html: '<p><a href="https://example.com/parent">Parent link</a></p><p><span data-ivo-highlight="#fff176">Portable font highlight</span></p>',
    });
    const parentDefinition = createParent(publishing, publishing.pages[0].id, 'Layout'),
      parentPage = addPage(publishing, publishing.pages[0].id);
    applyParent(publishing, parentPage.id, parentDefinition.id);
    const invisible = addLayer(publishing, 'Hidden');
    invisible.visible = false;
    const hiddenItem = insertObject(publishing, 'text', {
      x: 20,
      y: 220,
      w: 240,
      h: 80,
      html: '<p>Do not print</p>',
    });
    hiddenItem.layerId = invisible.id;
    const pubSnapshot = createPDFSnapshot(
        [publishing],
        [
          {
            id: fontId,
            name: 'cmunrm.ttf',
            mimeType: font.mimeType,
            data: `data:${font.mimeType};base64,${fontBytes.toString('base64')}`,
          },
        ],
        publishing.id,
      ),
      pubBefore = JSON.stringify(pubSnapshot);
    const pubPDF = await renderPDF(pubSnapshot, {
      project: root,
      onRendered: async (window) => {
        const result = await window.webContents.executeJavaScript(
          `({hidden:document.body.textContent.includes('Do not print'),family:getComputedStyle(document.querySelector('.canvas-text')).fontFamily,highlight:!!document.querySelector('[data-ivo-highlight]')})`,
        );
        assert.equal(result.hidden, false);
        assert.ok(result.family.includes(fontId));
        assert.equal(result.highlight, true);
      },
    });
    assert.equal(JSON.stringify(pubSnapshot), pubBefore);
    assert.equal(pubPDF.manifest.pages.length, 2);
    assert.ok(
      pubPDF.manifest.links.some(
        (l) => l.pageIndex === 1 && l.target.url === 'https://example.com/parent',
      ),
    );
    await writeFile(path.join(output, 'publishing.pdf'), pubPDF.bytes);
    const nativeDoc = createSceneDocument('Native transformed PDF');
    const nativeMask = insertObject(nativeDoc, 'polygon', {
      x: 60,
      y: 70,
      w: 380,
      h: 240,
      rotation: -7,
      clip: true,
      fill: '#eef1f4',
      points: [
        { id: 'n1', x: 0.1, y: 0 },
        { id: 'n2', x: 1, y: 0.1 },
        { id: 'n3', x: 0.9, y: 1 },
        { id: 'n4', x: 0, y: 0.9 },
      ],
    });
    const nativeFrame = insertObject(nativeDoc, 'text', {
      parentId: nativeMask.id,
      x: 30,
      y: 45,
      w: 280,
      h: 120,
      rotation: 17,
      textScale: { x: 1.1, y: 0.9 },
      textStyle: 'cmu-serif',
      fontSize: 16,
      html: '<p data-ivo-align="right" data-ivo-left="18" data-ivo-right="12" data-ivo-first="9" data-ivo-after="11">Native <em>italic affinity</em> and regular.</p><p data-ivo-align="center" data-ivo-before="7"><a href="https://example.com/native">Native link</a></p>',
    });
    enableNativeComposition(
      nativeDoc,
      startTextFlow(nativeDoc, nativeFrame.id, { automaticPages: false }),
      'single-line',
    );
    const nativeSnapshot = createPDFSnapshot([nativeDoc], [], nativeDoc.id),
      nativeBefore = JSON.stringify(nativeSnapshot);
    const nativePDF = await renderPDF(nativeSnapshot, {
      project: root,
      onRendered: async (window) => {
        const details = await window.webContents.executeJavaScript(
          `({svgs:document.querySelectorAll('svg[data-composed-text]').length,paths:document.querySelectorAll('svg[data-composed-text] path').length,firstGlyph:document.querySelector('svg[data-composed-text] use')?.getAttribute('transform')})`,
        );
        assert(
          details.svgs > 0 && details.paths > 5,
          'Native flow did not paint actual glyph paths',
        );
        assert(
          Number(details.firstGlyph.match(/translate\(([-\d.]+)/)[1]) > 18,
          'Frozen PDF renderer dropped native paragraph alignment/indent positioning',
        );
      },
    });
    assert.equal(JSON.stringify(nativeSnapshot), nativeBefore);
    assert.equal(nativePDF.manifest.composedText.length, 1);
    const nativePlacement = nativePDF.manifest.composedText[0].placements[0];
    assert(
      Math.abs(nativePlacement.matrix[1]) > 0.01 && Math.abs(nativePlacement.matrix[2]) > 0.01,
      'Frozen PDF text lost frame rotation',
    );
    assert.equal(nativePlacement.clips.length, 1, 'Frozen PDF text lost polygon mask');
    const nativeParsed = await PDFDocument.load(nativePDF.bytes),
      nativeFonts = new Set();
    let embeddedNative = 0;
    for (const [_reference, object] of nativeParsed.context.enumerateIndirectObjects()) {
      const face = object.get?.(PDFName.of('BaseFont'));
      if (face) nativeFonts.add(face.toString());
      if (
        object.get?.(PDFName.of('FontFile')) ||
        object.get?.(PDFName.of('FontFile2')) ||
        object.get?.(PDFName.of('FontFile3'))
      )
        embeddedNative++;
    }
    assert([...nativeFonts].some((name) => name.includes('CMUSerif-Roman')));
    assert([...nativeFonts].some((name) => name.includes('CMUSerif-Italic')));
    assert(embeddedNative >= 2, 'Native text fonts were not embedded after finalization');
    await writeFile(path.join(output, 'native.pdf'), nativePDF.bytes);
    await writeFile(
      path.join(output, 'native-manifest.json'),
      JSON.stringify(nativePDF.manifest, null, 2),
    );
    await writeFile(
      path.join(output, 'native-source.json'),
      JSON.stringify(nativeSnapshot, null, 2),
    );
    const caption = createSceneDocument('Narrow caption export', { width: 200, height: 200 });
    const captionFrame = insertObject(caption, 'text', {
      x: 20,
      y: 20,
      w: 42,
      h: 140,
      textStyle: 'cmu-serif',
      fontSize: 16,
      html: '<p data-ivo-hyphens="true">typesetting</p>',
    });
    enableNativeComposition(
      caption,
      startTextFlow(caption, captionFrame.id, { automaticPages: false }),
      'single-line',
    );
    const captionSnapshot = createPDFSnapshot([caption], [], caption.id);
    const captionPDF = await renderPDF(captionSnapshot, { project: root });
    const captionLayout = nativeCompositions.findLast(
      ({ result }) => result.token === captionPDF.manifest.composedText[0]?.token,
    )?.result.layout;
    assert(
      captionLayout?.lines.some((line) =>
        line.runs.some((run) => run.glyphs.some((g) => g.generated)),
      ),
      'Export did not use the hyphenated line geometry',
    );
    const captionFile = path.join(profile, 'caption.pdf'),
      captionReader = path.join(profile, 'caption.swift');
    await writeFile(captionFile, captionPDF.bytes);
    await writeFile(
      captionReader,
      `import PDFKit
let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
print(pdf.page(at: 0)!.string ?? "")
`,
    );
    const captionText = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      captionReader,
      captionFile,
    ]);
    assert.equal(
      captionText.stdout.replace(/\s/g, ''),
      'typesetting',
      'Generated caption ink entered selectable PDF text',
    );
    await verifyPrintedStyleRules({ root, profile, renderPDF });
    const portableType = await verifyPortableTypeSpecimens({
      root,
      profile,
      captionReader,
      renderPDF,
      nativeCompositions,
    });
    const unequalDoc = createSceneDocument('Unequal native paragraph PDF', {
        width: 420,
        height: 360,
      }),
      paragraphWords = Array.from(
        { length: 80 },
        (_, index) => 'word' + String(index).padStart(3, '0'),
      ),
      paragraphHTML =
        '<p data-ivo-left="12" data-ivo-right="8" data-ivo-first="6" data-ivo-after="5"><span data-ivo-size="22" data-ivo-leading="28">' +
        paragraphWords[0] +
        '</span> <em>' +
        paragraphWords[1] +
        '</em> ' +
        paragraphWords.slice(2, 30).join(' ') +
        '</p>' +
        '<p data-ivo-align="center" data-ivo-left="18" data-ivo-right="10" data-ivo-before="8" data-ivo-after="6">' +
        paragraphWords.slice(30, 55).join(' ') +
        '</p>' +
        '<p data-ivo-align="right" data-ivo-left="10" data-ivo-right="12" data-ivo-before="7">' +
        paragraphWords.slice(55).join(' ') +
        '</p>',
      unequalFirst = insertObject(unequalDoc, 'text', {
        x: 42,
        y: 52,
        w: 156,
        h: 112,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 20,
        frameOptions: { firstBaseline: 'fixed', minimumFirstBaseline: 40, verticalAlign: 'top' },
        html: paragraphHTML,
      }),
      unequalFlow = startTextFlow(unequalDoc, unequalFirst.id, { automaticPages: false }),
      unequalSecondPage = addPage(unequalDoc, unequalDoc.pages[0].id),
      unequalSecond = insertObject(unequalDoc, 'text', {
        pageId: unequalSecondPage.id,
        x: 55,
        y: 45,
        w: 244,
        h: 142,
        frameOptions: { firstBaseline: 'ascent', verticalAlign: 'center' },
      }),
      unequalThirdPage = addPage(unequalDoc, unequalSecondPage.id),
      unequalThird = insertObject(unequalDoc, 'text', {
        pageId: unequalThirdPage.id,
        x: 38,
        y: 40,
        w: 356,
        h: 280,
        frameOptions: { firstBaseline: 'ascent', verticalAlign: 'bottom' },
      });
    Object.assign(unequalSecondPage, { width: 600, height: 420 });
    Object.assign(unequalThirdPage, { width: 480, height: 400 });
    threadFrame(unequalDoc, unequalFirst.id, unequalSecond.id);
    threadFrame(unequalDoc, unequalSecond.id, unequalThird.id);
    enableNativeComposition(unequalDoc, unequalFlow, 'paragraph');
    const unequalFrames = [unequalFirst, unequalSecond, unequalThird],
      unequalSnapshot = createPDFSnapshot([unequalDoc], [], unequalDoc.id),
      unequalBefore = JSON.stringify(unequalSnapshot),
      unequalPDF = await renderPDF(unequalSnapshot, {
        project: root,
        onRendered: async (window) => {
          const result = await window.webContents.executeJavaScript(`({
            frames:document.querySelectorAll('svg[data-composed-text]').length,
            browserInk:document.querySelectorAll('[data-flow-frame] [data-flow-text]').length,
            glyphs:document.querySelectorAll('svg[data-composed-text] use').length
          })`);
          assert.equal(result.frames, 3, 'Unequal PDF did not paint all three native frames');
          assert.equal(result.browserInk, 0, 'Unequal PDF painted duplicate browser ink');
          assert(result.glyphs > 300, 'Unequal PDF did not paint actual vector glyphs');
        },
      });
    assert.equal(
      JSON.stringify(unequalSnapshot),
      unequalBefore,
      'Unequal paragraph PDF changed authored source or frame geometry',
    );
    assert.deepEqual(unequalPDF.manifest.warnings, []);
    assert.equal(unequalPDF.manifest.composedText.length, 1);
    const unequalLayer = unequalPDF.manifest.composedText[0],
      unequalComposition = nativeCompositions.findLast(
        ({ result }) => result.token === unequalLayer.token,
      );
    assert(unequalComposition, 'Unequal PDF has no matching actual native request');
    const { request: unequalRequest, result: unequalResult } = unequalComposition;
    assert.equal(unequalRequest.protocol, 3);
    assert.equal(unequalRequest.mode, 'planned-lines-proof');
    assert.deepEqual(
      unequalRequest.frames.map((frame) => frame.width),
      [156, 244, 356],
    );
    assert.equal(
      unequalResult.layout.coveredLength,
      unequalRequest.text.length,
      'Unequal PDF is unexpectedly overset',
    );
    assert.equal(unequalLayer.placements.length, 3, 'Frozen PDF lost unequal frame placements');
    assert.deepEqual(
      unequalLayer.placements.map((placement) => placement.destinationPageIndex),
      [0, 1, 2],
    );
    assert.deepEqual(
      unequalLayer.placements.map((placement) => placement.sourcePageIndex),
      [0, 1, 2],
    );
    assert.equal(unequalResult.layout.lines.length, unequalRequest.placements.length);
    const unequalParsed = await PDFDocument.load(unequalPDF.bytes);
    assert.deepEqual(
      unequalParsed.getPages().map((page) => page.getSize()),
      [
        { width: 420, height: 360 },
        { width: 600, height: 420 },
        { width: 480, height: 400 },
      ],
    );
    const expectedParagraphLines = unequalResult.layout.lines.map((line, index) => {
      const placement = unequalRequest.placements[index],
        frame = unequalFrames[placement.frame];
      assert.equal(line.placementIndex, index);
      assert.equal(line.frame, unequalRequest.frames[placement.frame].id);
      assert.equal(line.end, placement.end);
      assert(Math.abs(line.baseline - placement.baseline) < 0.001);
      return {
        page: placement.frame,
        baseline: frame.y + line.baseline,
        ascent: line.ascent,
        descent: line.descent,
        words: [
          ...unequalRequest.text.slice(line.start, line.contentEnd).matchAll(/word[0-9]{3}/g),
        ].map((match) => {
          const caret = line.carets.find((item) => item.index === line.start + match.index);
          assert(caret, 'Unequal PDF source word has no native caret');
          return { text: match[0], left: frame.x + caret.primary };
        }),
      };
    });
    assert.deepEqual([...new Set(expectedParagraphLines.map((line) => line.page))], [0, 1, 2]);
    assert.equal(expectedParagraphLines.flatMap((line) => line.words).length, 80);
    await writeFile(path.join(output, 'native-unequal-paragraph.pdf'), unequalPDF.bytes);
    await writeFile(
      path.join(output, 'native-unequal-paragraph-source.json'),
      JSON.stringify(unequalSnapshot, null, 2),
    );
    await writeFile(
      path.join(output, 'native-unequal-paragraph-plan.json'),
      JSON.stringify(
        {
          protocol: unequalRequest.protocol,
          mode: unequalRequest.mode,
          text: unequalRequest.text,
          frames: unequalRequest.frames,
          placements: unequalRequest.placements,
          expectedLines: expectedParagraphLines,
        },
        null,
        2,
      ),
    );
    // PDFKit reads final printed bytes independently of renderer DOM or SVG geometry.
    const paragraphInspector = path.join(profile, 'inspect-native-unequal-paragraph.swift');
    await writeFile(
      paragraphInspector,
      `import Foundation
import PDFKit
let input = CommandLine.arguments[1]
let plan = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))) as! [String: Any]
let lines = plan["expectedLines"] as! [[String: Any]]
guard let document = PDFDocument(url: URL(fileURLWithPath: input)), document.pageCount == 3 else { fatalError("Unequal paragraph PDF is not a readable three-page document") }
let expression = try NSRegularExpression(pattern: "word[0-9]{3}")
var words: [String] = []
var locations: [String: (PDFPage, NSRange)] = [:]
for index in 0..<document.pageCount {
  let page = document.page(at: index)!, text = page.string ?? ""
  for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
    let word = (text as NSString).substring(with: match.range)
    words.append(word)
    precondition(locations[word] == nil, "Printed PDF repeats a source word")
    locations[word] = (page, match.range)
  }
}
precondition(words == (0..<80).map { String(format: "word%03d", $0) }, "Printed unequal PDF lost, duplicated or reordered source words")
var checked = 0
for line in lines {
  let pageIndex = line["page"] as! Int, baseline = line["baseline"] as! Double, ascent = line["ascent"] as! Double
  let expectedWords = line["words"] as! [[String: Any]]
  var rowTops: [Double] = []
  for expected in expectedWords {
    let word = expected["text"] as! String, left = expected["left"] as! Double
    guard let (page, range) = locations[word] else { fatalError("Printed word is not selectable") }
    precondition(document.index(for: page) == pageIndex, "Printed word moved to the wrong unequal frame page")
    let first = page.selection(for: NSRange(location: range.location, length: 1))!.bounds(for: page)
    let top = page.bounds(for: .mediaBox).height - first.maxY
    precondition(abs(first.minX - left) < 0.05, "Printed word left edge disagrees with native caret placement")
    precondition(top < baseline + 0.1 && top > baseline - ascent - 1, "Printed line does not occupy its planned baseline band")
    if word != "word000" && word != "word001" { rowTops.append(top) }
    checked += 1
  }
  if let first = rowTops.first { precondition(rowTops.allSatisfy { abs($0 - first) < 0.05 }, "Printed words on one native line disagree vertically") }
}
let summary: [String: Any] = ["unequalParagraphPDFWords":80, "independentLineGeometry":true, "checkedWords":checked]
let summaryData = try JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys])
print(String(data: summaryData, encoding: .utf8)!)
`,
    );
    const inspectedParagraph = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      paragraphInspector,
      path.join(output, 'native-unequal-paragraph.pdf'),
      path.join(output, 'native-unequal-paragraph-plan.json'),
    ]);
    const unequalParagraphPDFInspection = JSON.parse(inspectedParagraph.stdout);
    const wrapDoc = createSceneDocument('Object wrap PDF', { width: 500, height: 500 }),
      wrapSource = Array.from({ length: 100 }, (_, i) => 'word' + String(i).padStart(3, '0')).join(
        ' ',
      ),
      wrapFrame = insertObject(wrapDoc, 'text', {
        x: 20,
        y: 20,
        w: 460,
        h: 430,
        textStyle: 'cmu-serif',
        fontSize: 16,
        leading: 20,
        html: '<p>' + wrapSource + '</p>',
      }),
      wrapObject = insertObject(wrapDoc, 'polygon', {
        x: 180,
        y: 100,
        w: 140,
        h: 140,
        fill: 'none',
        stroke: 'none',
        strokeWidth: 0,
        points: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 1, y: 0 },
          { id: 'c', x: 1, y: 1 },
          { id: 'd', x: 0, y: 1 },
        ],
      });
    setTextWrap(wrapDoc, [wrapObject.id], {
      mode: 'bounds',
      offsets: { top: 8, right: 8, bottom: 8, left: 8 },
    });
    const clippedImage = insertObject(wrapDoc, 'image', {
      parentId: wrapObject.id,
      x: -60,
      y: -60,
      w: 260,
      h: 260,
      src: 'asset:' + asset.id,
    });
    setTextWrap(wrapDoc, [clippedImage.id], { mode: 'contour' });
    const wrapSnapshot = createPDFSnapshot([wrapDoc], [asset], wrapDoc.id),
      wrapBefore = JSON.stringify(wrapSnapshot);
    let wrapInk;
    const wrappedPDF = await renderPDF(wrapSnapshot, {
      project: root,
      onRendered: async (window) => {
        wrapInk = await window.webContents.executeJavaScript(`(()=>{
          const element=document.querySelector('[data-flow-frame="${wrapFrame.id}"]'), page=document.querySelector('.pdf-layout'),
            origin=page.getBoundingClientRect(), factor=origin.width/500, result=[], walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT), range=document.createRange();
          let node; while(node=walker.nextNode()) for(let i=0;i<node.length;i++) {
            if(!/\\S/.test(node.data[i]))continue;
            range.setStart(node,i);range.setEnd(node,i+1);const r=range.getBoundingClientRect();
            result.push({char:node.data[i],left:(r.left-origin.left)/factor,right:(r.right-origin.left)/factor,
              top:(r.top-origin.top)/factor,bottom:(r.bottom-origin.top)/factor});
          } return result;
        })()`);
      },
    });
    assert.equal(
      JSON.stringify(wrapSnapshot),
      wrapBefore,
      'Wrapped PDF mutated its source snapshot',
    );
    assert.equal((await PDFDocument.load(wrappedPDF.bytes)).getPageCount(), 1);
    assert.deepEqual(wrappedPDF.manifest.warnings, []);
    assert.equal(
      wrapInk.map((c) => c.char).join(''),
      wrapSource.replaceAll(' ', ''),
      'Wrapped PDF renderer lost source characters',
    );
    assert(
      wrapInk.every(
        (c) => c.bottom <= 92.05 || c.top >= 247.95 || c.right <= 172.05 || c.left >= 327.95,
      ),
      'Frozen PDF renderer placed text inside object wrap offsets',
    );
    assert(
      wrapInk.some((c) => c.left >= 120 && c.right <= 172 && c.top >= 100 && c.bottom <= 240),
      'Hidden image rectangle still displaced exported text outside its clipping frame',
    );
    await writeFile(path.join(output, 'wrap.pdf'), wrappedPDF.bytes);
    await writeFile(path.join(output, 'wrap-ink.json'), JSON.stringify(wrapInk, null, 2));
    await writeFile(
      path.join(output, 'wrap-source.json'),
      JSON.stringify(
        { text: wrapSource, exclusion: { left: 172, top: 92, right: 328, bottom: 248 } },
        null,
        2,
      ),
    );
    const inspectedWrap = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      path.join(root, 'tests/runtime/pdf/inspect-wrap.swift'),
      path.join(output, 'wrap.pdf'),
    ]);
    const wrapPDFInspection = JSON.parse(inspectedWrap.stdout);
    const nativeWrapDocument = structuredClone(wrapDoc);
    enableNativeComposition(nativeWrapDocument, nativeWrapDocument.textFlows[0], 'paragraph');
    const styledFlow = nativeWrapDocument.textFlows[0];
    styledFlow.html =
      '<p data-ivo-align="center" data-ivo-wordspace="80:115:180">' +
      wrapSource.replace('word035', '<i><span data-ivo-size="22">word035</span></i>') +
      '</p>';
    markTypographyVersion(nativeWrapDocument);
    const nativeWrapSnapshot = createPDFSnapshot(
        [nativeWrapDocument],
        [asset],
        nativeWrapDocument.id,
      ),
      nativeWrapBefore = JSON.stringify(nativeWrapSnapshot);
    let nativeWrapInk;
    const nativeWrappedPDF = await renderPDF(nativeWrapSnapshot, {
      project: root,
      onRendered: async (window) => {
        nativeWrapInk = await window.webContents.executeJavaScript(`(()=>{
          const page=document.querySelector('.pdf-layout'), bounds=page.getBoundingClientRect(), scale=bounds.width/500;
          return [...document.querySelectorAll('svg[data-composed-text] use')].map(glyph=>{
            const r=glyph.getBoundingClientRect(); return {left:(r.left-bounds.left)/scale,
              right:(r.right-bounds.left)/scale,top:(r.top-bounds.top)/scale,bottom:(r.bottom-bounds.top)/scale};
          });
        })()`);
      },
    });
    assert.equal(JSON.stringify(nativeWrapSnapshot), nativeWrapBefore);
    assert.equal((await PDFDocument.load(nativeWrappedPDF.bytes)).getPageCount(), 1);
    assert.deepEqual(nativeWrappedPDF.manifest.warnings, []);
    assert.equal(nativeWrapInk.length, 700, 'Native wrapped PDF lost source glyph ink');
    assert(
      nativeWrapInk.every(
        (c) => c.bottom <= 92.05 || c.top >= 247.95 || c.right <= 172.05 || c.left >= 327.95,
      ),
      'Native PDF glyph paths intersect the independent padded exclusion',
    );
    const nativeWrapPlan = nativeCompositions.findLast(
      (call) =>
        call.request.mode === 'planned-lines-proof' &&
        call.request.id === nativeWrapDocument.textFlows[0].id,
    );
    assert.equal(nativeWrapPlan.request.protocol, 5);
    assert(
      nativeWrapPlan.request.runs.some(
        (run) =>
          run.size === 22 &&
          nativeWrapPlan.request.resources.some(
            (face) => face.id === run.font && face.postscript === 'CMUSerif-Italic',
          ),
      ),
      'Export lost the size or face of the styled word beside the wrapped object',
    );
    assert.equal(nativeWrapPlan.request.paragraphs[0].wordSpacing.desired, 115);
    assert(nativeWrapPlan.result.layout.lines.every((line) => line.wordSpacing.percentage === 115));
    for (const [i, line] of nativeWrapPlan.result.layout.lines.entries()) {
      const previous = nativeWrapPlan.result.layout.lines[i - 1],
        next = nativeWrapPlan.result.layout.lines[i + 1];
      if (next?.baseline === line.baseline)
        assert(
          Math.abs(
            line.originX +
              line.visibleWidth -
              (nativeWrapPlan.request.placements[i].left + line.availableWidth),
          ) < 0.001,
        );
      if (previous?.baseline === line.baseline)
        assert(Math.abs(line.originX - nativeWrapPlan.request.placements[i].left) < 0.001);
    }
    assert(
      nativeWrapPlan.result.layout.lines.some(
        (line, index, lines) => index && line.baseline === lines[index - 1].baseline,
      ),
      'Native wrapped PDF did not use same-baseline fragments',
    );
    await writeFile(path.join(output, 'native-wrap.pdf'), nativeWrappedPDF.bytes);
    await writeFile(
      path.join(output, 'native-wrap-ink.json'),
      JSON.stringify(nativeWrapInk, null, 2),
    );
    // A hole in a placed picture must admit searchable glyphs only when its interior is enabled.
    const ringPixels = Buffer.alloc(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        if (x < 10 || x >= 54 || y < 10 || y >= 54) ringPixels[(y * 64 + x) * 4 + 3] = 255;
    const ringAsset = {
      id: 'ring-cutout',
      mimeType: 'image/png',
      name: 'Ring',
      data: nativeImage.createFromBitmap(ringPixels, { width: 64, height: 64 }).toDataURL(),
    };
    const ringDoc = structuredClone(nativeWrapDocument);
    const ringPic = ringDoc.blocks.find((b) => b.id === clippedImage.id);
    delete ringPic.parentId;
    Object.assign(ringPic, {
      x: 100,
      y: 55,
      w: 260,
      h: 260,
      src: 'asset:' + ringAsset.id,
      caption: '',
    });
    // The unrelated columns share the picture's page and must retain their own layout.
    const sideNote = insertObject(ringDoc, 'text', {
      pageId: ringDoc.pages[0].id,
      x: 365,
      y: 30,
      w: 130,
      h: 160,
      html: '<p>Side column.</p>',
    });
    sideNote.frameOptions = { columns: 2, gutter: 6 };
    startTextFlow(ringDoc, sideNote.id, { automaticPages: false });
    setTextWrap(ringDoc, [wrapObject.id], { mode: 'none' });
    setTextWrap(ringDoc, [ringPic.id], { mode: 'contour', contour: { source: 'alpha' } });
    for (const insideEdges of [false, true]) {
      setTextWrap(ringDoc, [ringPic.id], { contour: { insideEdges } });
      let interiorGlyphs, sideColumnText;
      const exported = await renderPDF(createPDFSnapshot([ringDoc], [ringAsset], ringDoc.id), {
        project: root,
        onRendered: async (window) => {
          sideColumnText = await window.webContents.executeJavaScript(
            'document.querySelector(\'[data-object="' + sideNote.id + '"]\')?.textContent',
          );
          interiorGlyphs = await window.webContents.executeJavaScript(`(()=>{
            const page=document.querySelector('.pdf-layout').getBoundingClientRect(),scale=page.width/500;
            return [...document.querySelectorAll('svg[data-composed-text] use')].filter(g=>{
              const rect=g.getBoundingClientRect(),x=(rect.x-page.x)/scale,y=(rect.y-page.y)/scale;
              return x>150 && x<305 && y>108 && y<254;
            }).length;
          })()`);
        },
      });
      assert.match(sideColumnText, /Side column/);
      assert.equal((await PDFDocument.load(exported.bytes)).getPageCount(), 1);
      assert.equal(
        interiorGlyphs > 0,
        insideEdges,
        'PDF ignored the picture’s inside-edge setting',
      );
    }
    async function inspectWrappedFile(name, mode = 'bounds') {
      const inspected = await promisify(execFile)('xcrun', [
        'swift',
        '-module-cache-path',
        path.join(profile, 'swift-cache'),
        path.join(root, 'tests/runtime/pdf/inspect-wrap.swift'),
        path.join(output, name),
        mode,
      ]);
      return JSON.parse(inspected.stdout);
    }
    const nativeWrapPDFInspection = await inspectWrappedFile('native-wrap.pdf');

    // A single word wraps to the right of a left-hand object when centered;
    // at Bottom it returns left and its real descenders print below the frame.
    const alignedWrapPDFs = {};
    for (const alignment of ['center', 'bottom', 'justify', 'justify-wrap']) {
      const document = structuredClone(nativeWrapDocument);
      document.blocks = document.blocks.filter((b) => b.id !== clippedImage.id);
      const frame = document.blocks.find((b) => b.id === wrapFrame.id);
      Object.assign(frame, {
        x: 20,
        y: 20,
        w: 200,
        h: 180,
        fontSize: 16,
        frameOptions: {
          firstBaseline: 'fixed',
          minimumFirstBaseline: 16,
          verticalAlign: alignment === 'justify-wrap' ? 'justify' : alignment,
        },
      });
      const obstacle = document.blocks.find((b) => b.id === wrapObject.id);
      Object.assign(obstacle, { x: 20, y: 90, w: 140, h: 55 });
      setTextWrap(document, [obstacle.id], {
        mode: 'bounds',
        offsets: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      if (alignment === 'justify' || alignment === 'justify-wrap') {
        if (alignment === 'justify') setTextWrap(document, [obstacle.id], { mode: 'none' });
        else Object.assign(obstacle, { y: 125, w: 120, h: 40 });
        frame.frameOptions.paragraphSpacingLimit = 12;
        document.textFlows[0].html = '<p>cut<br>hem</p><p>sew<br>grading</p>';
        markTypographyVersion(document);
      } else document.textFlows[0].html = '<p>grading</p>';
      const pdf = await renderPDF(createPDFSnapshot([document], [], document.id), {
        project: root,
      });
      assert.deepEqual(pdf.manifest.warnings, []);
      if (alignment === 'justify-wrap') {
        assert.deepEqual(await taggedWords(pdf.bytes), ['cut', 'hem', 'sew', 'grading']);
      }
      const filename = path.join(output, 'native-wrap-' + alignment + '.pdf');
      await writeFile(filename, pdf.bytes);
      const inspected = await promisify(execFile)('xcrun', [
        'swift',
        '-module-cache-path',
        path.join(profile, 'swift-cache'),
        path.join(root, 'tests/runtime/pdf/inspect-aligned-wrap.swift'),
        filename,
        alignment,
      ]);
      alignedWrapPDFs[alignment] = JSON.parse(inspected.stdout);
    }
    const gridDocument = baselineGridFixture({ aligned: true }).doc;
    const gridPDF = await renderPDF(createPDFSnapshot([gridDocument], [], gridDocument.id), {
      project: root,
    });
    assert.deepEqual(gridPDF.manifest.warnings, []);
    const gridFile = path.join(output, 'native-document-baseline-grid.pdf');
    await writeFile(gridFile, gridPDF.bytes);
    const gridInspection = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      path.join(root, 'tests/runtime/pdf/inspect-baseline-grid.swift'),
      gridFile,
    ]);
    const documentBaselineGridPDF = JSON.parse(gridInspection.stdout);
    addGridWrap(gridDocument);
    const gridFrames = gridDocument.textFlows[0].frameIds.map((id) =>
      gridDocument.blocks.find((b) => b.id === id),
    );
    gridFrames[0].frameOptions.baselineGrid = { relativeTo: 'frame', start: 4, increment: 17 };
    gridFrames[1].frameOptions.baselineGrid = { relativeTo: 'inset', start: 1, increment: 11 };
    markTypographyVersion(gridDocument);
    const custom = await renderPDF(createPDFSnapshot([gridDocument], [], gridDocument.id), {
      project: root,
    });
    assert.deepEqual(custom.manifest.warnings, []);
    const frameGridFile = path.join(output, 'native-frame-baseline-grid.pdf');
    await writeFile(frameGridFile, custom.bytes);
    const inspectedFrameGrid = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      path.join(root, 'tests/runtime/pdf/inspect-baseline-grid.swift'),
      frameGridFile,
      'custom',
    ]);
    assert.equal(JSON.parse(inspectedFrameGrid.stdout).selectableGridWords, 12);
    // Keep the composite Box/Shape proof above. Exercise signed ink in its own Box layout.
    const boxDocument = structuredClone(nativeWrapDocument);
    setTextWrap(boxDocument, [clippedImage.id], { mode: 'none' });
    boxDocument.textFlows[0].html = styledFlow.html.replace(
      'data-ivo-size="22"',
      'data-ivo-size="22" data-ivo-baseline="4" data-ivo-vscale="125"',
    );
    const boxPDF = await renderPDF(createPDFSnapshot([boxDocument], [asset], boxDocument.id), {
      project: root,
    });
    assert.deepEqual(boxPDF.manifest.warnings, []);
    const boxPlan = nativeCompositions.findLast(
      (call) =>
        call.request.mode === 'planned-lines-proof' &&
        call.request.id === boxDocument.textFlows[0].id,
    );
    const raisedInk = boxPlan.result.layout.lines
      .flatMap((line) => line.runs)
      .filter((run) => run.baselineShift === 4 && run.verticalScale === 125)
      .flatMap((run) => run.glyphs);
    assert(
      raisedInk.length >= 7 && raisedInk.every((glyph) => Math.abs(glyph.position[1] - 4) < 0.001),
      'Transformed Box-wrap PDF lost the raised word or its baseline',
    );
    await writeFile(path.join(output, 'native-box-ink.pdf'), boxPDF.bytes);
    const nativeBoxInkPDFInspection = await inspectWrappedFile('native-box-ink.pdf');
    const browserJump = structuredClone(wrapDoc);
    browserJump.pages[0].height = 700;
    browserJump.blocks.find((block) => block.id === wrapFrame.id).h = 620;
    setTextWrap(browserJump, [clippedImage.id], { mode: 'none' });
    setTextWrap(browserJump, [wrapObject.id], { mode: 'jump' });
    const browserJumpPDF = await renderPDF(
      createPDFSnapshot([browserJump], [asset], browserJump.id),
      { project: root },
    );
    assert.deepEqual(browserJumpPDF.manifest.warnings, []);
    await writeFile(path.join(output, 'browser-jump.pdf'), browserJumpPDF.bytes);
    const browserJumpInspection = await inspectWrappedFile('browser-jump.pdf', 'jump');
    const signedWrapPDFs = {};
    for (const mode of ['contour', 'jump']) {
      const document = structuredClone(boxDocument);
      document.pages[0].height = 700;
      document.blocks.find((block) => block.id === wrapFrame.id).h = 620;
      const triangle = document.blocks.find((block) => block.id === wrapObject.id);
      triangle.points.splice(2, 1);
      setTextWrap(document, [triangle.id], {
        mode,
        offsets: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      const start = nativeCompositions.length;
      const pdf = await renderPDF(createPDFSnapshot([document], [asset], document.id), {
        project: root,
      });
      assert.deepEqual(pdf.manifest.warnings, []);
      const plan = nativeCompositions
        .slice(start)
        .findLast(
          (call) =>
            call.request.mode === 'planned-lines-proof' &&
            call.request.id === document.textFlows[0].id,
        );
      assert.ok(
        plan?.result.layout.lines.some((line) =>
          line.runs.some(
            (run) => run.baselineShift === 4 && run.verticalScale === 125 && run.glyphs.length,
          ),
        ),
        'Export must use the signed native plan for ' + mode,
      );
      const filename = 'native-' + mode + '-ink.pdf';
      await writeFile(path.join(output, filename), pdf.bytes);
      signedWrapPDFs[mode] = await inspectWrappedFile(filename, mode);
    }
    const characterPDFInspection = await verifyCharacterPDF({
      renderPDF,
      root,
      output,
      profile,
      nativeCompositions,
    });
    const paragraphKeepPDFInspection = await verifyParagraphKeepsPDF({
      renderPDF,
      root,
      output,
      profile,
      nativeCompositions,
    });
    const wordSpacingPDFInspection = await verifyWordSpacingPDF({
      renderPDF,
      root,
      output,
      profile,
      nativeCompositions,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          pages: 3,
          selectableFontSource: layout.font,
          pageDimensionsExact: true,
          ...portableType,
          internalAndExternalLinks: true,
          maskedLinkOmitted: true,
          sourceSnapshotUnchanged: true,
          originalImagePixels: [1024, 512],
          flowPages: flowPDF.manifest.pages.length,
          flowSnapshotUnchanged: true,
          publishingFontsParentsLayersHighlights: true,
          nativeRotatedScaledMaskedItalicText: true,
          nativeParagraphLayout: true,
          nativeUnequalParagraphPlacements: true,
          unequalParagraphPDFInspection,
          nativeFontNames: [...nativeFonts],
          wrappedTextSourceAndExclusion: true,
          clippedGraphicWrapping: true,
          wrapPDFInspection,
          nativeWrappedTextSourceAndExclusion: true,
          nativeWrapPDFInspection,
          alignedWrapPDFs,
          documentBaselineGridPDF,
          nativeBoxInkPDFInspection,
          signedWrapPDFs,
          browserJumpInspection,
          ...characterPDFInspection,
          ...paragraphKeepPDFInspection,
          ...wordSpacingPDFInspection,
          warnings: manifest.warnings,
        },
        null,
        2,
      ),
    );
    compositionBridge.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    compositionBridge?.close();
    app.exit(1);
  });
