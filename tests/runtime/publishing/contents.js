import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../../src/domain/documents/publishing.js';
import {
  archiveVersion,
  markTypographyVersion,
} from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';

export async function verifyContents(host, assert) {
  let doc = createSceneDocument('Materials');
  const first = doc.pages[0],
    second = addPage(doc, first.id);
  first.section = { style: 'roman-lower', prefix: '', start: 1 };
  second.section = { style: 'decimal', prefix: 'A–', start: 7 };
  const style = saveTextStyle(doc, 'paragraph', {
    name: 'Fabric heading',
    attributes: { fontSize: 16 },
  });
  const frame = insertObject(doc, 'text', first.id, {
    x: 30,
    y: 30,
    w: 300,
    h: 230,
    html: '<h2>Weaves &amp; finishes</h2><p>Body only.</p>',
  });
  insertObject(doc, 'text', second.id, {
    x: 30,
    y: 30,
    w: 320,
    h: 220,
    html: '<p data-ivo-pstyle="' + style.id + '">Alpaca</p>',
  });
  markTypographyVersion(doc);
  const history = createDocumentHistory();
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    sessionId: 'contents',
    source: (s) => s,
    onChange() {},
    onCommit: (before, info) => history.record(before, doc, info),
    onUndo: () => {
      const r = history.undo(doc);
      if (r) {
        doc = r.document;
        editor.restoreView(r.view);
      }
    },
  });
  const findOwner = () =>
    doc.blocks.find(
      (b) => b.textFlowId === doc.textFlows?.find((f) => f.contents)?.id && b.textFlowId,
    );
  const body = () => doc.textFlows.find((f) => f.id === findOwner()?.textFlowId)?.html;
  try {
    await editor.command('table-of-contents');
    const dialog = document.querySelector('dialog[aria-label="Table of Contents"]');
    assert(dialog, 'Layout command did not open a contents dialog');
    const form = dialog.querySelector('form');
    form.elements.title.value = 'Fabric index';
    form.querySelector('[data-toc-style="' + style.id + '"]').value = '3';
    form.elements.numbering.value = 'before';
    form.elements.order.value = 'alphabetical';
    form.requestSubmit();
    assert(
      !dialog.open,
      'Contents dialog did not commit: ' + dialog.querySelector('[role=alert]').textContent,
    );
    await editor.flush();
    assert(
      doc.pages.length === 3 && doc.pages.at(-1).name === 'Fabric index',
      'Contents page placement failed',
    );
    assert(
      body().includes('A–7\u2003Alpaca') &&
        body().includes('i\u2003Weaves &amp; finishes') &&
        body().indexOf('Alpaca') < body().indexOf('Weaves') &&
        !body().includes('Body only.'),
      'Wrong printed entries: ' + body(),
    );
    assert(body().includes('data-ivo-left="12"'), 'Heading hierarchy disappeared');
    const old = body();
    doc.blocks.find((b) => b.id === frame.id).html = '<h2>New heading</h2>';
    doc.pages[1].section.start = 9;
    const select = () =>
      editor.restoreView({
        activePage: findOwner().pageId,
        selection: [findOwner().id],
        tool: 'select',
      });
    select();
    await editor.command('update-table-of-contents');
    assert(
      body().includes('A–9\u2003Alpaca') &&
        body().includes('i\u2003New heading') &&
        !body().includes('Weaves') &&
        doc.pages.length === 3,
      'Update did not regenerate the same flow: ' + body(),
    );
    const saved = validateImport({
      schemaVersion: archiveVersion([doc]),
      documents: [doc],
      assets: [],
    }).documents[0];
    assert(
      saved.textFlows.find((f) => f.contents).contents.numbering === 'before',
      'Saved settings were lost',
    );
    await editor.command('undo');
    assert(
      body() === old && doc.blocks.find((b) => b.id === frame.id).html.includes('New heading'),
      'Undo replaced unrelated source',
    );
    select();
    await editor.flush();
    const targetLink = host.querySelector('a[href="#page=' + second.id + '"]');
    assert(targetLink, 'Generated link missing from the canvas');
    targetLink.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert(
      editor.getState().activePage === second.id,
      'Modified click did not jump to the printed destination',
    );
    editor.restoreView({ activePage: first.id, selection: [frame.id], tool: 'select' });
    const command = editor.command('page-link');
    const picker = document.querySelector('dialog[aria-label="Insert Page Link"]');
    assert(picker, 'Page Link did not open the destination chooser');
    picker.querySelector('select').value = second.id;
    picker.querySelector('form').requestSubmit();
    await command;
    assert(
      doc.blocks.find((b) => b.id === frame.id).html.includes('href="#page=' + second.id + '"'),
      'Page Link did not write to the selected frame',
    );
  } finally {
    editor.destroy();
  }
}
