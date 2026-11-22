import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createSceneDocument, addPage, insertObject } from '../../../src/domain/documents/scene.js';
import { threadFrame, enableNativeComposition } from '../../../src/domain/documents/text-flows.js';
import { validateAnchoredObjects } from '../../../src/domain/documents/anchored-objects.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import {
  paintPublicationPage,
  composePublicationChapter,
} from '../../../src/rendering/publication-pages.js';
import { copyDocument } from '../../../src/domain/documents/copy.js';
import { exportReflowableBook } from '../../../src/features/export/epub.js';
import { unzipSync, strFromU8 } from '../../../node_modules/fflate/esm/browser.js';

export async function verifyAnchoredArtwork(host, assert, native) {
  const doc = createSceneDocument('Anchored artwork review'),
    page = addPage(doc, doc.pages[0].id);
  const first = insertObject(doc, 'text', doc.pages[0].id, {
    x: 20,
    y: 40,
    w: 250,
    h: 55,
    html: '<p>Before artwork afterwards.</p>',
  });
  const next = insertObject(doc, 'text', page.id, { x: 20, y: 40, w: 250, h: 150, html: '' });
  const flow = threadFrame(doc, first.id, next.id);
  if (native) {
    flow.style.textStyle = 'cmu-serif';
    flow.style.fontSize = 12;
    enableNativeComposition(doc, flow);
  }
  const figure = insertObject(doc, 'polygon', page.id, {
    x: 170,
    y: 250,
    w: 45,
    h: 30,
    fill: '#783fa8',
  });
  const bitmap = document.createElement('canvas');
  bitmap.width = 8;
  bitmap.height = 8;
  const drawing = bitmap.getContext('2d');
  drawing.fillStyle = '#11be4f';
  drawing.fillRect(0, 0, 8, 8);
  const asset = {
    id: 'anchored-swatch',
    name: 'Swatch.png',
    mimeType: 'image/png',
    data: bitmap.toDataURL(),
  };
  const source = (key) => (key === 'asset:' + asset.id ? asset.data : key);
  insertObject(doc, 'image', page.id, {
    parentId: figure.id,
    x: 8,
    y: 8,
    w: 16,
    h: 16,
    src: 'asset:' + asset.id,
    alt: 'Anchored swatch',
  });
  const history = createDocumentHistory(),
    notices = [];
  const restore = (r) => {
    if (!r) return;
    Object.assign(doc, r.document);
    editor.restoreView(r.view);
  };
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    sessionId: 'anchors',
    textComposition: native,
    assets: () => [asset],
    source,
    onCommit: (before, meta) => history.record(before, doc, meta),
    onChange() {},
    onUndo: () => restore(history.undo(doc)),
    onRedo: () => restore(history.redo(doc)),
    onNotify: (s) => notices.push(s),
  });
  const caret = (at) => {
    const point = { path: [], offset: 0, index: at, kind: 'text', affinity: 'forward' };
    editor.restoreView({
      selection: [first.id],
      activePage: first.pageId,
      tool: 'text',
      activeTextId: first.id,
      textSelection: { anchor: point, focus: point },
    });
  };
  const artwork = () =>
    host.querySelector('[data-anchored-artwork][data-object="' + figure.id + '"]');
  const owner = () => doc.textFlows.find((f) => f.id === flow.id);
  try {
    await editor.flush();
    caret(7);
    await editor.command('anchored-object');
    const form = document.querySelector('dialog[open] form');
    assert(form, 'Missing anchored object dialog: ' + notices.join(', '));
    form.elements.art.value = figure.id;
    form.requestSubmit();
    await editor.flush();
    assert(
      owner().html.includes('data-ivo-anchor="' + figure.id + '"'),
      'The marker was not inserted: ' + notices.join(', '),
    );
    validateAnchoredObjects(doc);
    assert(
      artwork()?.closest('[data-page]')?.dataset.page === first.pageId,
      'The actual polygon was not placed in its first text frame',
    );
    assert(
      host.querySelectorAll('[data-object="' + figure.id + '"]').length === 1,
      'Duplicate artwork on original page',
    );
    await editor.command('undo');
    assert(!owner().html.includes('data-ivo-anchor'), 'Undo did not restore the free polygon');
    await editor.command('redo');
    validateAnchoredObjects(copyDocument(doc));
    editor.restoreView({
      selection: [figure.id],
      activePage: first.pageId,
      tool: 'select',
      activeTextId: null,
    });
    await editor.command('anchored-object');
    const options = document.querySelector('dialog[open] form');
    assert(options, 'Could not edit an anchored graphic');
    options.elements.width.value = '52';
    options.requestSubmit();
    await editor.flush();
    assert(
      doc.blocks.find((b) => b.id === figure.id).w === 52 && artwork()?.style.width === '52px',
      'Resized graphic did not recompose',
    );
    assert(
      artwork()?.querySelector('.canvas-clip img')?.alt === 'Anchored swatch',
      'The masked image did not move with its polygon',
    );
    caret(0);
    for (let i = 0; i < 3; i++) document.execCommand('insertParagraph', false);
    await editor.flush();
    assert(
      artwork()?.closest('[data-page]')?.dataset.page === next.pageId,
      'The graphic did not follow edited text to its second page: ' + notices.join(', '),
    );
    const reopened = validateImport({
      schemaVersion: archiveVersion([doc]),
      documents: [doc],
      assets: [asset],
    }).documents[0];
    validateAnchoredObjects(reopened);
    const proof = document.createElement('div');
    proof.style.cssText =
      'position:relative;width:' + page.width + 'px;height:' + page.height + 'px';
    document.body.append(proof);
    try {
      const { flow: plan } = await composePublicationChapter(
        reopened,
        [reopened],
        [asset],
        native?.compose,
        false,
      );
      paintPublicationPage(proof, reopened, page, { source, flow: plan, documents: [reopened] });
      assert(
        proof.querySelector('[data-anchored-artwork] polygon[fill="#783fa8"]'),
        'Published page lost its anchored artwork',
      );
    } finally {
      proof.remove();
    }
    const output = await exportReflowableBook([doc], doc.id, { getSource: source });
    const chapter = strFromU8(unzipSync(output.bytes || output)['EPUB/chapter-1.xhtml']);
    assert(
      chapter.includes('<clipPath') &&
        chapter.includes('<image') &&
        Object.keys(unzipSync(output)).some((key) => key === 'EPUB/image-1.png'),
      'EPUB lost embedded raster or mask',
    );
    assert(
      chapter.indexOf('Before') < chapter.indexOf('<polygon') &&
        chapter.indexOf('<polygon') < chapter.indexOf('artwork afterwards'),
      'EPUB did not place artwork at its source character',
    );
  } finally {
    editor.destroy();
    host.replaceChildren();
  }
}
