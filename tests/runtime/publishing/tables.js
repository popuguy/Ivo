import { columnPoints } from '../../../src/domain/geometry/table-columns.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';

export async function verifyTables(host, assert) {
  let doc = createSceneDocument('Sample card'),
    editor;
  const history = createDocumentHistory(),
    page = doc.pages[0].id;
  const mount = (editing = true) =>
    mountCanvasEditor(host, {
      getDocument: () => doc,
      documents: [doc],
      editing,
      sessionId: 'table-test',
      source: (s) => s,
      onChange() {},
      onCommit: (before, info) => history.record(before, doc, info),
      onUndo() {
        const r = history.undo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
      onRedo() {
        const r = history.redo(doc);
        if (r) {
          doc = r.document;
          editor.restoreView(r.view);
        }
      },
    });
  const cell = (r, c) => host.querySelector(`[data-table-row="${r}"][data-table-column="${c}"]`);
  const input = () => host.querySelector('[data-table-editor]');
  const type = (s) => {
    assert(input(), 'Missing in-place cell editor');
    input().value = s;
    input().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const tab = () =>
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
  const submit = (settings) => {
    const d = document.querySelector('dialog[open]'),
      form = d?.querySelector('form');
    assert(form, 'Table dialog missing');
    for (const [key, value] of Object.entries(settings)) form.elements.namedItem(key).value = value;
    form.requestSubmit();
    assert(
      !d.open,
      'Table dialog rejected changes: ' + d.querySelector('[role=alert]').textContent,
    );
  };
  const edit = (r, c) => cell(r, c).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  editor = mount();
  try {
    await editor.command('insert-table');
    submit({ rows: 3, columns: 2, header: 1 });
    const table = doc.blocks.find((b) => b.type === 'table');
    assert(table && cell(0, 0)?.tagName === 'TH', 'Header cells missing after insertion');
    const divider = () => host.querySelector('[data-selected-table] [data-table-divider="0"]');
    const drag = (distance, cancel = false, shiftKey = false) => {
      const grip = divider(),
        bounds = grip.getBoundingClientRect(),
        x = bounds.x + bounds.width / 2,
        y = bounds.y + bounds.height / 2;
      grip.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerId: 51,
          shiftKey,
          button: 0,
        }),
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: x + distance,
          clientY: y,
          pointerId: 51,
          shiftKey,
        }),
      );
      window.dispatchEvent(
        new PointerEvent(cancel ? 'pointercancel' : 'pointerup', {
          bubbles: true,
          clientX: x + distance,
          clientY: y,
          pointerId: 51,
          shiftKey,
        }),
      );
    };
    const initial = columnPoints(table),
      frameWidth = table.w;
    drag(15, true);
    assert(
      columnPoints(table)[0] === initial[0] && table.w === frameWidth,
      'Cancel committed a column drag',
    );
    drag(20);
    const grown = columnPoints(table);
    assert(
      table.w > frameWidth && Math.abs(grown[1] - initial[1]) < 0.0001,
      'Normal drag changed the adjacent column',
    );
    const wider = table.w;
    drag(10, false, true);
    assert(
      table.w === wider && columnPoints(table)[0] > grown[0] && columnPoints(table)[1] < grown[1],
      'Shift-drag changed the overall table width',
    );
    edit(0, 0);
    type('Cut & finish');
    tab();
    type('Шерсть');
    tab();
    type('<silk>');
    tab();
    type('Printed');
    const jump = (key) =>
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }),
      );
    jump('Home');
    assert(
      input()?.getAttribute('aria-label') === 'Row 2, column 1',
      'Could not jump to the first cell of the row',
    );
    jump('PageDown');
    assert(
      input()?.getAttribute('aria-label') === 'Row 3, column 1',
      'Could not jump to the last cell of the column',
    );
    input().blur();
    assert(
      cell(1, 0).textContent === '<silk>' && !cell(1, 0).querySelector('silk'),
      'Table text interpreted as HTML',
    );
    await editor.command('table-options');
    submit({ action: 'merge', row: 2, column: 1, rows: 1, columns: 2 });
    assert(cell(1, 0).colSpan === 2 && !cell(1, 1), 'Merge failed');
    await editor.command('undo');
    assert(cell(1, 1)?.textContent === 'Printed', 'Undo lost cell text');
    await editor.command('redo');
    assert(cell(1, 0).textContent.includes('Printed') && !cell(1, 1), 'Redo lost merged content');
    edit(2, 1);
    tab();
    assert(
      input()?.getAttribute('aria-label') === 'Row 4, column 1',
      'Tab did not append an editable body row',
    );
    type('Final row');
    await editor.flush();
    edit(3, 1);
    const clip = new DataTransfer();
    clip.setData('text/plain', 'A\tB\nC\tD');
    input().dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: clip, bubbles: true, cancelable: true }),
    );
    assert(cell(4, 2)?.textContent === 'D', 'Spreadsheet paste did not expand both dimensions');
    await editor.command('undo');
    assert(!cell(4, 2) && cell(3, 0)?.textContent === 'Final row', 'Pasting was not one undo step');
    const reopen = () =>
      validateImport({
        schemaVersion: archiveVersion([doc]),
        documents: [JSON.parse(JSON.stringify(doc))],
        assets: [],
      }).documents[0];
    editor.destroy();
    doc = reopen();
    editor = mount();
    assert(
      cell(3, 0)?.textContent === 'Final row' &&
        cell(1, 0).colSpan === 2 &&
        cell(0, 1).textContent === 'Шерсть',
      'Round trip lost table content or layout',
    );
    // Search and correct the same phrase across a table and ordinary text.
    const tableId = doc.blocks.find((b) => b.type === 'table').id;
    const currentTable = () => doc.blocks.find((b) => b.id === tableId);
    const prose = insertObject(doc, 'text', page);
    const sample = 'Шерсть';
    prose.html = '<p><em>' + sample + '</em></p>';
    editor.restoreView({ activePage: page, selection: [tableId], tool: 'select' });
    edit(0, 1);
    input().select();
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }),
    );
    const search = host.querySelector('.canvas-find-change');
    assert(search?.elements.needle.value === sample, 'Find from selected cell lost its text');
    const action = (name) => search.querySelector('[data-find-action="' + name + '"]').click();
    search.elements.scope.value = 'selection';
    search.elements.scope.dispatchEvent(new Event('change', { bubbles: true }));
    action('next');
    assert(
      search.querySelector('output').textContent === '1 of 1',
      'Selection search escaped the cell',
    );
    action('done');
    assert(
      input()?.value.substring(input().selectionStart, input().selectionEnd) === sample,
      'Returning from the search lost the selected cell range',
    );
    await editor.command('find-change');
    const panel = host.querySelector('.canvas-find-change');
    panel.elements.scope.value = 'document';
    panel.elements.needle.value = sample;
    panel.elements.replacement.value = '<wool>&';
    panel.elements.needle.dispatchEvent(new Event('input', { bubbles: true }));
    panel.querySelector('[data-find-action="all"]').click();
    assert(
      panel.querySelector('output').textContent === '2 replacements made.' &&
        currentTable().table.cells[0][1] === '<wool>&' &&
        doc.blocks.find((b) => b.id === prose.id).html.includes('<em>&lt;wool&gt;&amp;</em>'),
      'One document-wide correction failed to preserve plain cells and italic body text',
    );
    panel.querySelector('[data-find-action="done"]').click();
    await editor.command('undo');
    assert(
      currentTable().table.cells[0][1] === sample &&
        doc.blocks.find((b) => b.id === prose.id).html.includes(sample),
      'One undo did not restore both sources',
    );
    const target = doc.blocks.find((b) => b.type === 'table');
    target.locked = true;
    editor.restoreView({ activePage: page, selection: [], tool: 'select' });
    edit(0, 1);
    assert(!input(), 'Locked table accepted edits');
    target.locked = false;
    editor.destroy();
    editor = mount(false);
    edit(0, 1);
    await editor.command('insert-table');
    assert(!input() && !document.querySelector('dialog[open]'), 'Reading view allowed editing');
  } finally {
    editor.destroy();
  }
}
