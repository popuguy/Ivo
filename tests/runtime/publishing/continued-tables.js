import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { createTable } from '../../../src/domain/documents/tables.js';
import { tableText } from '../../../src/domain/documents/table-clipboard.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';

export async function verifyContinuedTables(host, assert) {
  let doc = createSceneDocument('Continued garment measurements'),
    editor;
  const history = createDocumentHistory();
  const t = createTable(12, 2);
  t.headerRows = t.footerRows = 1;
  t.inset = 0;
  t.stroke = 0.5;
  t.rowOptions = Object.fromEntries(t.cells.map((_, row) => [row, { minimumHeight: 20 }]));
  t.cells.forEach((row, i) => {
    row[0] = 'R' + i;
    row[1] = 'D' + i;
  });
  const head = insertObject(doc, 'table', doc.pages[0].id, {
    h: 124,
    w: 280,
    fontSize: 10,
    table: t,
  });
  const mount = (editing = true) =>
    mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing,
      sessionId: 'continued-table',
      source: (s) => s,
      onChange() {},
      onCommit: (before, info) => history.record(before, doc, info),
      onUndo() {
        const previous = history.undo(doc);
        if (previous) {
          doc = previous.document;
          editor.restoreView(previous.view);
        }
      },
    });
  const shown = () =>
    Array.from(host.querySelectorAll('.table-frame'), (f) =>
      Array.from(f.querySelectorAll('tbody [data-table-column="0"]'), (c) =>
        Number(c.dataset.tableRow),
      ).join(','),
    ).join('|');
  const cell = (row, col) =>
    host.querySelector(
      `[data-table-row="${row}"][data-table-column="${col}"]:not([data-table-repeat])`,
    );
  const select = (block) =>
    editor.restoreView({ activePage: block.pageId, selection: [block.id], tool: 'select' });
  const text = () => host.querySelector('[data-table-editor]');
  const setText = (s) => {
    text().value = s;
    text().dispatchEvent(new Event('input', { bubbles: true }));
  };
  editor = mount();
  try {
    select(head);
    for (let i = 0; i < 3; i++) await editor.command('continue-table');
    assert(
      doc.pages.length === 4 && doc.blocks.filter((b) => b.table).length === 1,
      'Continuing duplicated the source',
    );
    for (const [height, expected] of [
      [124, '1,2,3,4|5,6,7,8|9,10|'],
      [104, '1,2,3|4,5,6|7,8,9|10'],
      [84, '1,2|3,4|5,6|7,8'],
    ]) {
      doc.blocks.forEach((b) => (b.h = height));
      select(head);
      assert(shown() === expected, 'Unexpected row breaks at ' + height + ' pt: ' + shown());
      assert(
        !!host.querySelector('[data-table-overset]') === (height === 84),
        'Incorrect end-of-thread overflow',
      );
    }
    head.table.cells[5][1] = 'Cut\nFold\nPress\nStitch';
    for (const [height, expected] of [
      [124, '1,2,3,4|5,6|7,8,9,10|'],
      [104, '1,2,3|4|5|6,7,8'],
    ]) {
      doc.blocks.forEach((b) => (b.h = height));
      select(head);
      assert(
        shown() === expected,
        'Multiline cell changed the wrong page boundary at ' + height + ': ' + shown(),
      );
    }
    head.table.cells[5][1] = 'D5';
    for (const block of doc.blocks) {
      block.h = 124;
      block.frameOptions = { stroke: '#112233', strokeWidth: 10 };
    }
    select(head);
    assert(shown() === '1,2,3|4,5,6|7,8,9|10', 'Rows crossed the painted frame edge');
    doc.blocks.forEach((block) => {
      delete block.frameOptions;
      block.h = 84;
    });
    select(head);
    await editor.command('find-change');
    const search = host.querySelector('.canvas-find-change');
    search.elements.scope.value = 'document';
    search.elements.needle.value = 'D10';
    search.elements.replacement.value = 'Changed overset row';
    search.elements.needle.dispatchEvent(new Event('input', { bubbles: true }));
    search.querySelector('[data-find-action="all"]').click();
    assert(head.table.cells[10][1] === 'D10', 'Change All modified a row hidden by overflow');
    search.elements.needle.value = 'D5';
    search.elements.needle.dispatchEvent(new Event('input', { bubbles: true }));
    search.querySelector('[data-find-action="next"]').click();
    assert(
      search.querySelector('output').textContent === '1 of 1',
      'Visible continuation cell did not participate in Find',
    );
    search.querySelector('[data-find-action="done"]').click();
    assert(
      text()?.value === 'D5' && text().closest('[data-object]').dataset.object === doc.blocks[2].id,
      'Find returned to the wrong table frame',
    );
    text().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    doc.blocks.forEach((b) => (b.h = 124));
    select(head);
    await editor.command('table-options');
    const form = document.querySelector('dialog[open] form');
    form.elements.row.value = 5;
    form.elements.row.dispatchEvent(new Event('input'));
    form.elements.keepRow.checked = true;
    form.requestSubmit();
    assert(shown() === '1,2,3|4,5,6,7|8,9,10|', 'Keep with next row failed: ' + shown());
    cell(3, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    text().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    assert(
      text()?.value === 'R4' && text().closest('[data-object]').dataset.object === doc.blocks[1].id,
      'Tab did not cross the page break into the next body row',
    );
    text().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    assert(text()?.value === 'D3', 'Shift-Tab stopped in a repeated footer or heading');
    text().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    const preserved = structuredClone(head.table);
    head.table.merges = [{ row: 6, column: 0, rows: 3, columns: 1 }];
    head.table.cells[7][0] = head.table.cells[8][0] = '';
    select(head);
    const merged = cell(6, 0);
    assert(
      merged.rowSpan === 3 && merged.closest('[data-object]').dataset.object === doc.blocks[2].id,
      'A tall vertical merge was split between pages',
    );
    head.table = preserved;
    select(head);
    const repeated = host.querySelector('thead [data-table-repeat]');
    repeated.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert(!text(), 'Cannot edit a generated header occurrence');
    cell(6, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert(text()?.value === 'D6', 'Continuation did not open its own source row');
    setText('Cut\nFold\nPress\nStitch');
    text().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert(
      head.table.cells[6][1].endsWith('Stitch') && shown() !== '1,2,3|4,5,6,7|8,9,10|',
      'Editing on page two did not reflow later rows: ' + shown(),
    );
    const changed = shown(),
      html = JSON.stringify(doc);
    await editor.command('undo');
    assert(
      doc.blocks[0].table.cells[6][1] === 'D6' && shown() === '1,2,3|4,5,6,7|8,9,10|',
      'Undo failed to restore table pagination',
    );
    editor.destroy();
    doc = validateImport({
      schemaVersion: archiveVersion([JSON.parse(html)]),
      documents: [JSON.parse(html)],
      assets: [],
    }).documents[0];
    editor = mount(false);
    assert(
      shown() === changed && tableText(doc.blocks[0].table).includes('Stitch'),
      'Reopening in reading view changed rows',
    );
  } finally {
    editor.destroy();
  }
}
