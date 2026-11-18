import { createHash } from 'node:crypto';
import { inspectFont } from '../../../src/domain/text/fonts.js';
import {
  enablePublishing,
  createParent,
  applyParent,
  addLayer,
} from '../../../src/domain/documents/publishing.js';
import {
  startTextFlow,
  enableNativeComposition,
} from '../../../src/domain/documents/text-flows.js';
import { app, ipcMain, nativeImage } from 'electron';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { renderPDF as renderNativePDF, pdfRendererOwner } from '../../../desktop/pdf-export.mjs';
import { installTextCompositionBridge } from '../../../desktop/text-composition-bridge.mjs';
import { createTextComposition } from '../../../desktop/text-composition.mjs';
import { buildNativeText } from '../../../scripts/build-native-text.mjs';
let compositionBridge;
const renderPDF = (snapshot, options) =>
  renderNativePDF(snapshot, {
    ...options,
    compositionPDF: (contents, token) => compositionBridge.readPDF(contents, token),
  });
import {
  createSceneDocument,
  addPage,
  insertObject as insert,
} from '../../../src/domain/documents/scene.js';
import { createPDFSnapshot } from '../../../src/features/export/pdf-plan.js';

const insertObject = (doc, type, options = {}) => {
  const { pageId = doc.pages[0].id, ...rest } = options;
  const item = insert(doc, type, pageId, rest);
  if (type === 'polygon') Object.assign(item, rest);
  return item;
};
const root = fileURLToPath(new URL('../../..', import.meta.url)),
  output = path.resolve(root, '../work/pdf-export/runtime');
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-pdf-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
app
  .whenReady()
  .then(async () => {
    compositionBridge = installTextCompositionBridge({
      ipcMain,
      authorize: pdfRendererOwner,
      createService: async () => createTextComposition(await buildNativeText()),
    });
    await mkdir(output, { recursive: true });
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
          `(()=>{const page=document.querySelector('.pdf-page'),text=page.querySelector('.canvas-text'),range=document.createRange();range.setStart(text.firstChild.firstChild,0);range.setEnd(text.firstChild.firstChild,5);const r=range.getBoundingClientRect(),p=page.getBoundingClientRect();return {textX:(r.left-p.left)*.75,textY:(r.top-p.top)*.75,font:getComputedStyle(text).fontFamily,links:document.querySelectorAll('a[href]').length,controls:document.querySelectorAll('button,input').length}})()`,
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
      html: '<p>Native <em>italic affinity</em> and regular.</p><p><a href="https://example.com/native">Native link</a></p>',
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
          `({svgs:document.querySelectorAll('svg[data-composed-text]').length,paths:document.querySelectorAll('svg[data-composed-text] path').length})`,
        );
        assert(
          details.svgs > 0 && details.paths > 5,
          'Native flow did not paint actual glyph paths',
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
    console.log(
      JSON.stringify(
        {
          ok: true,
          pages: 3,
          selectableFontSource: layout.font,
          pageDimensionsExact: true,
          internalAndExternalLinks: true,
          maskedLinkOmitted: true,
          sourceSnapshotUnchanged: true,
          originalImagePixels: [1024, 512],
          flowPages: flowPDF.manifest.pages.length,
          flowSnapshotUnchanged: true,
          publishingFontsParentsLayersHighlights: true,
          nativeRotatedScaledMaskedItalicText: true,
          nativeFontNames: [...nativeFonts],
          warnings: manifest.warnings,
        },
        null,
        2,
      ),
    );
    await rm(profile, { recursive: true, force: true });
    compositionBridge.close();
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    compositionBridge?.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    app.exit(1);
  });
