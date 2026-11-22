import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { unzipSync, strFromU8 } from '../../../node_modules/fflate/esm/browser.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import {
  createSceneDocument,
  addPage,
  insertObject,
  duplicateObjects,
} from '../../../src/domain/documents/scene.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { copyDocument } from '../../../src/domain/documents/copy.js';
import { exportReflowableBook } from '../../../src/features/export/epub.js';
import { renderPDFSnapshot } from '../../../src/features/export/pdf-renderer.js';

export async function verifyEndnotes(host, assert) {
  const doc = createSceneDocument('Endnote review');
  const page = addPage(doc, doc.pages[0].id);
  const first = insertObject(doc, 'text', doc.pages[0].id, {
    html: '<p>First material</p>',
    w: 260,
    h: 100,
  });
  const last = insertObject(doc, 'text', page.id, {
    html: '<p>Later material</p>',
    w: 260,
    h: 100,
  });
  let reason = '';
  const history = createDocumentHistory();
  const restore = (result) => {
    if (!result) return;
    for (const key of Object.keys(doc)) delete doc[key];
    Object.assign(doc, result.document);
    editor.restoreView(result.view);
  };
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    sessionId: 'endnotes',
    source: (s) => s,
    onCommit: (previous, metadata) => history.record(previous, doc, metadata),
    onUndo: () => restore(history.undo(doc)),
    onRedo: () => restore(history.redo(doc)),
    onChange() {},
    onNotify: (s) => {
      reason = s;
    },
  });
  const pick = (frame, index) => {
    const caret = { index, path: [], offset: 0, kind: 'text', affinity: 'forward' };
    editor.restoreView({
      selection: [frame.id],
      activePage: frame.pageId,
      tool: 'text',
      activeTextId: frame.id,
      textSelection: { anchor: caret, focus: caret },
    });
  };
  const enter = (text) => {
    const input = host.querySelector('.canvas-flow-input[contenteditable="true"]');
    assert(input && input === document.activeElement, 'Caret did not enter endnote text');
    document.execCommand('insertText', false, text);
  };
  try {
    pick(last, 6);
    await editor.command('insert-endnote');
    const notes = doc.textFlows?.find((f) => f.endnotes);
    assert(notes, 'Insert Endnote failed: ' + reason);
    enter('Later annotation');
    document.execCommand('insertParagraph', false);
    enter('Continuation of the later note.');
    await editor.flush();
    pick(first, 6);
    await editor.command('insert-endnote');
    enter('Earlier annotation');
    await editor.flush();
    assert(
      doc.pages.length === 3 &&
        notes.html.includes('Later annotation') &&
        notes.html.indexOf('Earlier annotation') < notes.html.indexOf('Later annotation'),
      'Order or edits lost: ' + notes.html + ' ' + reason,
    );
    assert(
      first.html.match(/>1<\/a>/) && last.html.match(/>2<\/a>/),
      'Numbering ignores source order',
    );
    await editor.command('go-to-endnote');
    assert(
      editor.captureView().activeTextId === first.id,
      'Return link missed its source: ' + reason,
    );
    await editor.command('go-to-endnote');
    assert(
      editor.captureView().activeTextId === notes.frameIds[0],
      'Could not go back into endnote',
    );
    await editor.command('update-endnotes');
    const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
    const restored = validateImport(archive).documents[0];
    const paired = restored.textFlows.find((f) => f.endnotes);
    assert(
      archive.schemaVersion === 35 && paired.html === notes.html,
      'Archive lost endnote content or identity',
    );
    const copied = copyDocument(restored);
    assert(
      copied.textFlows.find((f) => f.endnotes).html.includes('#page=' + copied.pages[0].id),
      'Duplicate document lost return link',
    );
    const duplicate = duplicateObjects(copied, [
      copied.blocks.find((b) => b.html.includes('data-endnote=')).id,
    ]);
    assert(!duplicate[0].html.includes('data-endnote='), 'Duplicate object stole note ownership');
    const bytes = await exportReflowableBook([restored], restored.id, {});
    const chapter = strFromU8(unzipSync(bytes)['EPUB/chapter-1.xhtml']);
    const xhtml = new DOMParser().parseFromString(chapter, 'application/xhtml+xml');
    for (const citation of xhtml.querySelectorAll('[role=doc-noteref]')) {
      const body = xhtml.getElementById(citation.getAttribute('href').slice(1));
      assert(
        body?.querySelector('[role=doc-backlink]')?.getAttribute('href') === '#' + citation.id &&
          body.textContent.includes('annotation'),
        'EPUB return link or readable note does not resolve',
      );
    }
    assert(
      xhtml.querySelectorAll('[role=doc-noteref]').length === 2,
      'EPUB dropped endnotes: ' + chapter,
    );
    const reader = document.createElement('iframe');
    const chapterUrl = URL.createObjectURL(new Blob([chapter], { type: 'application/xhtml+xml' }));
    try {
      reader.src = chapterUrl;
      const loaded = new Promise((resolve, reject) => {
        reader.onload = resolve;
        reader.onerror = reject;
      });
      document.body.append(reader);
      await loaded;
      const forward = reader.contentDocument.querySelector('[role=doc-noteref]');
      forward.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: reader.contentWindow }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const target = reader.contentDocument.getElementById(
        reader.contentWindow.location.hash.slice(1),
      );
      assert(
        target?.textContent.includes('annotation'),
        'EPUB reader did not navigate to the complete note',
      );
      target
        .querySelector('[role=doc-backlink]')
        .dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: reader.contentWindow }),
        );
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(
        reader.contentWindow.location.hash === '#' + forward.id,
        'EPUB reader backlink missed its source',
      );
    } finally {
      reader.remove();
      URL.revokeObjectURL(chapterUrl);
    }
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '../../../src/features/export/pdf.css';
    const cssReady = new Promise((resolve, reject) => {
      css.onload = resolve;
      css.onerror = reject;
    });
    document.head.append(css);
    await cssReady;
    const pdfHost = document.createElement('main');
    pdfHost.id = 'pdf-pages';
    document.body.append(pdfHost);
    try {
      const pdf = await renderPDFSnapshot({
        title: doc.title,
        documents: [structuredClone(restored)],
        assets: [],
        createdAt: doc.createdAt,
      });
      const targets = pdf.links.map((l) => [l.pageIndex, l.target?.pageIndex, l.target?.top]);
      assert(
        pdf.links.length === 4 && targets.every((item) => Number.isFinite(item[2])),
        'PDF paired links missing: ' + JSON.stringify(pdf.links) + ' ' + pdf.warnings,
      );
    } finally {
      pdfHost.remove();
      css.remove();
    }
    pick(first, 6);
    await editor.command('delete-endnote');
    assert(
      !notes.html.includes('Earlier annotation') &&
        notes.html.includes('Later annotation') &&
        last.html.match(/>1<\/a>/),
      'Delete and renumber failed: ' + reason,
    );
    const noteSource = () => doc.textFlows.find((f) => f.endnotes).html;
    await editor.command('undo');
    assert(
      noteSource().includes('Earlier annotation') &&
        doc.blocks.find((b) => b.id === last.id).html.includes('>2</a>'),
      'Undo lost text or numbering',
    );
    await editor.command('redo');
    assert(
      !noteSource().includes('Earlier annotation') && noteSource().includes('Later annotation'),
      'Redo lost the other note',
    );
    await editor.command('undo');
    pick(first, 7);
    document.execCommand('delete', false);
    await editor.flush();
    assert(
      !noteSource().includes('Earlier annotation') && noteSource().includes('Later annotation'),
      'Backspace at the citation did not delete its note: ' + reason,
    );
    await editor.command('undo');
    assert(noteSource().includes('Earlier annotation'), 'Undo Backspace lost the annotation');
    assert(
      noteSource().includes('Continuation of the later note.'),
      'A neighboring multiline note lost content',
    );
  } finally {
    editor.destroy();
    host.replaceChildren();
  }
  const reading = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: false,
    sessionId: 'read-endnotes',
    source: (s) => s,
    onChange() {},
    onCommit() {},
  });
  try {
    const cite = host.querySelector('.canvas-page a[data-endnote^="cite-"]');
    const pair = 'body-' + cite.dataset.endnote.slice(5);
    const target = host.querySelector('.canvas-page a[data-endnote="' + pair + '"]');
    cite.setAttribute('href', '#page=' + doc.pages[0].id);
    cite.click();
    assert(
      reading.captureView().activePage === target.closest('.canvas-page').dataset.page,
      'Reading view followed an obsolete page hint',
    );
    target.click();
    assert(
      reading.captureView().activePage === first.pageId,
      'Reading view did not return to the citation',
    );
  } finally {
    reading.destroy();
    host.replaceChildren();
  }
}
