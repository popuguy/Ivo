import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { addPage, createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { layoutDocumentTextFlows } from '../../../src/rendering/text/flow-layout.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { exportReflowableBook } from '../../../src/features/export/epub.js';
import { renderPDFSnapshot } from '../../../src/features/export/pdf-renderer.js';
import { unzipSync, strFromU8 } from '../../../node_modules/fflate/esm/browser.js';

export async function verifyFootnotes(host, assert) {
  let doc = createSceneDocument('Column footnote study');
  const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const frame = insertObject(doc, 'text', doc.pages[0].id, {
    html: words.join('<br>'),
    w: 144,
    h: 96,
    fontSize: 12,
    leading: 16,
  });
  const next = insertObject(doc, 'text', addPage(doc, doc.pages[0].id).id, {
    html: '',
    w: 144,
    h: 96,
  });
  startTextFlow(doc, frame.id, { automaticPages: false });
  threadFrame(doc, frame.id, next.id);
  const history = createDocumentHistory();
  let reason = '';
  const restore = (result) => {
    if (result) {
      doc = result.document;
      editor.restoreView(result.view);
    }
  };
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    sessionId: 'footnote',
    source: (s) => s,
    onChange() {},
    onNotify: (s) => {
      reason = s;
    },
    onCommit: (before, meta) => history.record(before, doc, meta),
    onUndo: () => restore(history.undo(doc)),
    onRedo: () => restore(history.redo(doc)),
  });
  const source = () => doc.textFlows[0].html;
  const pick = (index) => {
    const point = { index, path: [], offset: 0, kind: 'text', affinity: 'forward' };
    editor.restoreView({
      selection: [frame.id],
      activePage: frame.pageId,
      tool: 'text',
      activeTextId: frame.id,
      textSelection: { anchor: point, focus: point },
    });
  };
  const apply = async (text) => {
    const input = host.querySelector('.footnote-editor textarea');
    assert(input, 'Footnote editor missing: ' + reason);
    input.value = text;
    input.form.requestSubmit();
    await editor.flush();
  };
  const note = 'Short footnote.';
  try {
    const unreserved = layoutDocumentTextFlows(doc).fragments.get(frame.id).end;
    const at = words.slice(0, 4).join('\n').length;
    pick(at);
    await editor.command('insert-footnote');
    await apply(note);
    assert(source().includes('data-footnote='), 'Footnote source missing: ' + reason);
    const view = () => layoutDocumentTextFlows(doc, { allowPages: false });
    let plan = view();
    assert(plan.fragments.get(frame.id).html.includes(note), 'Short footnote missed its column');
    assert(
      plan.fragments.get(frame.id).end < unreserved + 1,
      'Footnote did not reserve body space',
    );
    pick(at);
    await editor.command('edit-footnote');
    await apply('Longer footnote that wraps onto more lines and consumes more room in the column.');
    plan = view();
    const texts = [frame, next].map((f) => plan.fragments.get(f.id).html);
    assert(
      texts.some((h) => h.includes('Longer footnote')),
      'Edited note vanished',
    );
    assert(!texts.some((h) => h.includes(note)), 'Old note still painted');
    const footers = (plan) =>
      [frame, next].map((f) => {
        const node = document.createElement('div');
        node.innerHTML = plan.fragments.get(f.id).html;
        return node.querySelector('[role=doc-footnote]')?.textContent || '';
      });
    const split = footers(plan);
    assert(
      split[0] && split[1],
      'Default long note did not continue across columns: ' + JSON.stringify(split),
    );
    await editor.command('footnote-options');
    const settings = host.querySelector('.footnote-options form');
    assert(settings, 'Document Footnote Options did not open');
    settings.elements.allowSplitting.checked = false;
    settings.elements.startAt.value = 7;
    settings.elements.rule.checked = false;
    settings.requestSubmit();
    await editor.flush();
    const kept = footers(view());
    assert(
      !kept[0] && kept[1].includes('7  Longer footnote') && kept[1].includes('the column.'),
      'Unsplit note did not travel with its citation: ' + JSON.stringify(kept),
    );
    assert(
      host.querySelector('[role=doc-footnote]')?.textContent.includes('7'),
      'Changed numbering was not painted by the editor',
    );
    const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
    assert(
      archive.schemaVersion === 36 &&
        validateImport(archive).documents[0].textFlows[0].html === source(),
      'Footnote archive round trip failed',
    );
    const bytes = await exportReflowableBook([doc], doc.id, {});
    const xhtml = new DOMParser().parseFromString(
      strFromU8(unzipSync(bytes)['EPUB/chapter-1.xhtml']),
      'application/xhtml+xml',
    );
    const cite = xhtml.querySelector('[role=doc-noteref]');
    assert(
      cite &&
        xhtml
          .getElementById(cite.getAttribute('href').slice(1))
          ?.textContent.includes('Longer footnote'),
      'EPUB footnote navigation missing',
    );
    const pdfHost = document.createElement('div');
    pdfHost.id = 'pdf-pages';
    document.body.append(pdfHost);
    try {
      await renderPDFSnapshot({ documents: [structuredClone(doc)], assets: [] });
      assert(
        pdfHost.querySelectorAll('[role=doc-footnote]').length >= 1 &&
          pdfHost.textContent.includes('Longer footnote'),
        'PDF lost the footnote',
      );
    } finally {
      pdfHost.remove();
    }
    pick(at);
    await editor.command('delete-footnote');
    assert(!source().includes('data-footnote'), 'Delete footnote failed: ' + reason);
    assert(
      view().fragments.get(frame.id).end === unreserved,
      'Delete did not return the space to the body',
    );
    await editor.command('undo');
    assert(source().includes('data-footnote'), 'Undo lost note');
    const mixed = structuredClone(doc);
    const two = mixed.blocks.find((b) => b.id === frame.id);
    two.w = 300;
    two.frameOptions = { columns: 2, gutter: 12 };
    const twoCols = layoutDocumentTextFlows(mixed, { allowPages: false }).fragments.get(frame.id);
    const node = document.createElement('div');
    node.innerHTML = twoCols.html;
    const row = node.querySelector('.flow-footnotes');
    assert(
      row && Number.parseFloat(row.style.left) >= 144,
      'Two-column footnote was painted under the wrong physical column',
    );
  } finally {
    editor.destroy();
    host.replaceChildren();
  }
}
