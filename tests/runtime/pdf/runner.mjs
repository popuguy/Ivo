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
      '<p data-ivo-align="center" data-ivo-wordspace="80:115:180">' + wrapSource + '</p>';
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
    const inspectedNativeWrap = await promisify(execFile)('xcrun', [
      'swift',
      '-module-cache-path',
      path.join(profile, 'swift-cache'),
      path.join(root, 'tests/runtime/pdf/inspect-wrap.swift'),
      path.join(output, 'native-wrap.pdf'),
    ]);
    const nativeWrapPDFInspection = JSON.parse(inspectedNativeWrap.stdout);
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
