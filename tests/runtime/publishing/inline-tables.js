import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createSceneDocument, addPage, insertObject } from '../../../src/domain/documents/scene.js';
import { threadFrame } from '../../../src/domain/documents/text-flows.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { exportReflowableBook } from '../../../src/features/export/epub.js';
import { unzipSync, strFromU8 } from '../../../node_modules/fflate/esm/browser.js';
import {
  paintPublicationPage,
  composePublicationChapter,
} from '../../../src/rendering/publication-pages.js';

export async function verifyInlineTables(host, assert) {
  const doc = createSceneDocument('Inline table review');
  const secondPage = addPage(doc, doc.pages[0].id);
  const first = insertObject(doc, 'text', doc.pages[0].id, {
    x: 36,
    y: 36,
    w: 260,
    h: 112,
    fontSize: 12,
    html: '<p>IntroAfter</p>',
  });
  const next = insertObject(doc, 'text', secondPage.id, {
    x: 36,
    y: 36,
    w: 260,
    h: 230,
    fontSize: 12,
    html: '',
  });
  const flow = threadFrame(doc, first.id, next.id);
  const history = createDocumentHistory(),
    notices = [];
  let editor;
  const restore = (r) => {
    if (!r) return;
    for (const key of Object.keys(doc)) delete doc[key];
    Object.assign(doc, r.document);
    editor.restoreView(r.view);
  };
  editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    sessionId: 'inline-table-review',
    source: (s) => s,
    onChange() {},
    onCommit: (before, info) => history.record(before, doc, info),
    onNotify: (t) => notices.push(t),
    onUndo: () => restore(history.undo(doc)),
    onRedo: () => restore(history.redo(doc)),
  });
  const caret = (index) => {
    const pt = { path: [], offset: 0, index, kind: 'text', affinity: 'forward' };
    editor.restoreView({
      activePage: first.pageId,
      selection: [first.id],
      tool: 'text',
      activeTextId: first.id,
      textSelection: { anchor: pt, focus: pt },
    });
  };
  const table = () => doc.blocks.find((b) => b.type === 'table');
  const currentFlow = () => doc.textFlows.find((f) => f.id === flow.id);
  const cell = () =>
    host.querySelector('[data-anchored-artwork] [data-table-row="0"][data-table-column="0"]');
  const input = () => host.querySelector('[data-table-editor]');
  const page = () => cell()?.closest('[data-page]')?.dataset.page;
  const required = (value, message) => assert(value, message + ' ' + notices.join(', '));
  try {
    caret(1);
    const editSurface = host.querySelector('.canvas-flow-input[contenteditable="true"]');
    window.getSelection().collapse(editSurface.querySelector('p').firstChild, 5);
    await editor.command('insert-table');
    const form = document.querySelector('dialog[open] form');
    required(form, 'Insert Table unavailable at caret');
    form.elements.source.value = 'Wool twill\tBlue\nSilk\tIvory';
    form.requestSubmit();
    required(
      !form.closest('dialog')?.open && table()?.extensions?.ivoAnchor?.ownerId === flow.id,
      'Inline table not bound to flow: ' + form.querySelector('[role=alert]')?.textContent,
    );
    const content = document.createElement('div');
    content.innerHTML = currentFlow().html;
    assert(
      content.textContent === 'Intro\uFFFCAfter' && content.querySelectorAll('p').length === 1,
      'Adding a table changed authored words or paragraph count: ' + content.innerHTML,
    );
    required(page() === first.pageId, 'Initial table missing from first text frame');
    const slot = host.querySelector('[data-flow-frame] [data-ivo-anchor]');
    required(
      slot && getComputedStyle(slot).display === 'block',
      'Table did not establish its own line',
    );
    const range = document.createRange();
    range.selectNodeContents(slot.previousSibling);
    const before = range.getBoundingClientRect();
    range.selectNodeContents(slot.nextSibling);
    const after = range.getBoundingClientRect();
    const box = slot.getBoundingClientRect();
    assert(
      before.top < box.top && box.bottom <= after.bottom,
      'Mid-sentence text overlapped the table instead of flowing above and below it',
    );

    cell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    required(input() && input() === document.activeElement, 'Placed cell could not be edited');
    range.setStart(input().firstChild, 5);
    range.setEnd(input().firstChild, 10);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    await editor.command('italic');
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'u', metaKey: true, bubbles: true, cancelable: true }),
    );
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    const marks = () => table().table.cellRuns?.['0,0'];
    required(
      marks()?.length === 1 &&
        marks()[0].start === 5 &&
        marks()[0].end === 10 &&
        marks()[0].italic &&
        marks()[0].underline,
      'Formatting selected text did not survive leaving the cell',
    );
    await editor.command('undo');
    required(!marks(), 'Undo did not restore unformatted text');
    await editor.command('redo');
    required(marks()?.[0].italic, 'Redo lost character formatting');
    cell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    range.selectNodeContents(input());
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, 'New ');
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    required(
      table().table.cells[0][0] === 'New Wool twill' &&
        marks()[0].start === 9 &&
        marks()[0].end === 14,
      'Inserting before styled text disturbed character formatting',
    );
    const secondCell = host.querySelector(
      '[data-anchored-artwork] [data-table-row="1"][data-table-column="0"]',
    );
    secondCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'Nylon\tMint');
    clipboard.setData(
      'text/html',
      '<table><tr><td><em>Nylon</em></td><td><span style="background-color:#fcf180">Mint</span></td></tr></table>',
    );
    input().dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    required(
      table().table.cellRuns['1,0'][0].italic &&
        table().table.cellRuns['1,1'][0].highlight === '#fcf180',
      'Pasting formatted spreadsheet cells lost text styles',
    );
    async function appearance(action, row, id, values = {}) {
      await editor.command('table-options');
      const form = document.querySelector('dialog[open] form');
      required(form, 'Table Options unavailable for selected anchor');
      form.elements.action.value = action;
      form.elements.action.dispatchEvent(new Event('change'));
      form.elements.row.value = row;
      form.elements.column.value = 1;
      form.elements.cellStyle.value = id;
      form.elements.cellStyle.dispatchEvent(new Event('change'));
      for (const [field, value] of Object.entries(values)) form.elements[field].value = value;
      form.requestSubmit();
      required(
        !form.closest('dialog')?.open,
        'Cell style was rejected: ' + form.querySelector('[role=alert]')?.textContent,
      );
    }
    await appearance('define-style', 1, '', {
      styleName: 'Sample',
      cellFill: '#e8dce2',
      cellInset: '5',
    });
    const styleId = table().table.cellStyles[0].id;
    await appearance('apply-style', 2, styleId);
    await appearance('define-style', 1, styleId, { cellFill: '#f2dce2' });
    required(
      table().table.appliedCellStyles['1,0'] === styleId &&
        getComputedStyle(cell()).backgroundColor === 'rgb(242, 220, 226)',
      'A shared cell style failed to update',
    );
    caret(0);
    for (let i = 0; i < 6; i++) document.execCommand('insertParagraph', false);
    await editor.flush();
    required(
      page() === secondPage.id,
      'Editing prose did not move actual table into the next threaded frame',
    );
    const version = archiveVersion([doc]);
    const restored = validateImport({
      schemaVersion: version,
      documents: [structuredClone(doc)],
      assets: [],
    }).documents[0];
    required(
      version === 38 &&
        restored.blocks.find((b) => b.type === 'table').table.cellRuns['0,0'][0].italic,
      'Saving or reopening lost versioned inline table formatting',
    );
    const proof = document.createElement('section');
    proof.style.cssText =
      'position:relative;width:' + secondPage.width + 'px;height:' + secondPage.height + 'px';
    document.body.append(proof);
    try {
      const { flow: plan } = await composePublicationChapter(restored, [restored], [], null, false);
      paintPublicationPage(proof, restored, secondPage, {
        source: (s) => s,
        flow: plan,
        documents: [restored],
      });
      required(
        proof.querySelectorAll('table').length === 1 &&
          proof.querySelector('td em')?.textContent === 'twill' &&
          getComputedStyle(proof.querySelector('td')).backgroundColor === 'rgb(242, 220, 226)',
        'Printed page lost inline table location or character style',
      );
    } finally {
      proof.remove();
    }
    const packed = await exportReflowableBook([restored], restored.id, {});
    const chapter = strFromU8(unzipSync(packed)['EPUB/chapter-1.xhtml']);
    const xml = new DOMParser().parseFromString(chapter, 'application/xhtml+xml');
    const body = xml.querySelector('body');
    const words = body?.textContent || '';
    required(
      xml.querySelectorAll('table').length === 1 &&
        xml.querySelector('td em')?.textContent === 'twill' &&
        words.indexOf('Intro') < words.indexOf('New Wool') &&
        words.indexOf('New Wool') < words.indexOf('After'),
      'EPUB lost table position, semantic table, or character marks',
    );
  } finally {
    editor.destroy();
  }
}
