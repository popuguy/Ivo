import test from 'node:test';
import assert from 'node:assert/strict';
import { createTable, reshapeTable, validateTable } from '../../src/domain/documents/tables.js';
import {
  tableText,
  readTableText,
  putTableCells,
} from '../../src/domain/documents/table-clipboard.js';
import {
  copyObjectSelection,
  readObjectClipboard,
  pasteObjectSelection,
} from '../../src/domain/documents/clipboard.js';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { exportMarkdown } from '../../src/features/export/markdown.js';
import { filterDocuments } from '../../src/domain/knowledge/index.js';
const filled = () =>
  putTableCells(createTable(3, 3), 0, 0, [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
    ['G', 'H', 'I'],
  ]);
const at = (t, op, row, column, rows = 1, columns = 1) =>
  reshapeTable(t, op, { row, column, rows, columns });
test('merges retain text and geometry through insert, delete, reorder and split', () => {
  const t = filled(),
    merged = at(t, 'merge', 0, 0, 2, 2),
    expanded = at(merged, 'insert-row', 0, 0);
  assert.equal(merged.cells[0][0], 'A\nB\nD\nE');
  assert.equal(t.cells[0][0], 'A');
  assert.equal(expanded.merges[0].rows, 3);
  const removed = at(expanded, 'delete-row', 0, 0);
  assert.equal(removed.cells[0][0], merged.cells[0][0]);
  const moved = at(removed, 'later-column', 0, 0);
  assert.equal(moved.cells[0][0], merged.cells[0][0]);
  assert.equal(moved.cells[2][0], 'H');
  assert.throws(() => at(merged, 'later-column', 0, 1), /Split/);
  assert.equal(at(moved, 'split', 1, 1).merges.length, 0);
});
test('sections and table limits are enforced before changing existing cells', () => {
  const t = filled();
  t.headerRows = t.footerRows = 1;
  assert.throws(() => at(t, 'delete-row', 1, 1), /body/);
  assert.throws(() => at(t, 'merge', 0, 0, 2, 1), /boundary/);
  assert.throws(() => validateTable({ ...t, widths: [1, 0, 1] }), /width/);
  assert.throws(() => createTable(256, 64));
  const m = at(t, 'merge', 1, 0, 1, 2);
  m.cells[1][1] = 'overlap';
  assert.throws(() => validateTable(m), /covered/);
});
test('spreadsheet paste expands and preserves quoted Unicode, whitespace and empty cells', () => {
  const values = [
    [' wool ', '"woven"', ''],
    ['x\ty', 'Синий\nцвет', ''],
    ['', '', ''],
  ];
  const source = putTableCells(createTable(1, 1), 0, 0, values);
  assert.deepEqual(readTableText(tableText(source)), values);
  const m = at(source, 'merge', 2, 0, 1, 2);
  assert.throws(() => putTableCells(m, 2, 0, [['red', 'blue']]), /Split/);
  assert.equal(m.cells[2][0], '');
  assert.throws(() => readTableText('"incomplete'), /Unclosed/);
  assert.deepEqual(readTableText('a\r\n\r\nb\r\n'), [['a'], [''], ['b']]);
});
test('portable table objects round-trip safely, paste independently, and export literal text', () => {
  const doc = createSceneDocument('Fabrics'),
    dest = createSceneDocument('Other');
  const block = insertObject(doc, 'table', doc.pages[0].id, { table: filled() });
  block.table.cells[0][0] = '<silk & rayon>';
  block.table.headerRows = 1;
  const archive = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(archive.schemaVersion, 29);
  assert.throws(() => validateImport({ ...archive, schemaVersion: 28 }));
  assert.deepEqual(validateImport(archive).documents[0].blocks[0].table, block.table);
  assert.equal(filterDocuments([doc], 'rayon').length, 1);
  assert.match(exportMarkdown(doc), /<th scope="col">&lt;silk &amp; rayon&gt;<\/th>/);
  const incoming = readObjectClipboard(JSON.stringify(copyObjectSelection(doc, [block.id])));
  pasteObjectSelection(dest, incoming, { pageId: dest.pages[0].id });
  const pasted = dest.blocks.find((b) => b.type === 'table');
  assert.deepEqual(pasted.table, block.table);
  assert.notEqual(pasted.id, block.id);
  pasted.table.cells[0][0] = 'other';
  assert.equal(block.table.cells[0][0], '<silk & rayon>');
});
