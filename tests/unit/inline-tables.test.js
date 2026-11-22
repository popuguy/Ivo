import { defineCellStyle, applyCellStyle } from '../../src/domain/documents/table-cell-styles.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTable, reshapeTable, validateTable } from '../../src/domain/documents/tables.js';
import { setCellRuns, hasInlineTables } from '../../src/domain/documents/inline-tables.js';
import { putTableCells } from '../../src/domain/documents/table-clipboard.js';
import { changeCell, planTableCorrections } from '../../src/features/editor/text/table-proofing.js';
import { tableMarkup } from '../../src/rendering/table.js';
import { validateParagraphSource } from '../../src/rendering/text/paragraph-composition.js';

test('formatted words follow their cells across merges, row/column changes, and plain spreadsheet paste', () => {
  const table = createTable(2, 2);
  table.cells = [
    ['Wool twill', 'Nylon'],
    ['Hem', 'Silk'],
  ];
  setCellRuns(table, 0, 0, [{ start: 5, end: 10, italic: true, underline: true }]);
  setCellRuns(table, 0, 1, [{ start: 0, end: 5, bold: true }]);
  const merged = reshapeTable(table, 'merge', { row: 0, column: 0, columns: 2 });
  assert.equal(merged.cells[0][0], 'Wool twill\nNylon');
  assert.deepEqual(merged.cellRuns['0,0'], [
    { start: 5, end: 10, italic: true, underline: true },
    { start: 11, end: 16, bold: true },
  ]);
  const moved = reshapeTable(merged, 'later-row', { row: 0, column: 0 });
  assert.deepEqual(moved.cellRuns, { '1,0': merged.cellRuns['0,0'] });
  const deleted = reshapeTable(moved, 'delete-column', { row: 1, column: 0 });
  assert.equal(deleted.cells[1][0], 'Wool twill\nNylon');
  assert.deepEqual(deleted.cellRuns, moved.cellRuns);
  const changed = putTableCells(deleted, 0, 0, [['Text']]);
  assert.deepEqual(changed.cellRuns, deleted.cellRuns);
  assert.equal(putTableCells(changed, 1, 0, [['new']]).cellRuns, undefined);
  assert.equal(hasInlineTables({ blocks: [{ type: 'table', table }] }), true);
  assert.equal(hasInlineTables({ blocks: [{ type: 'table', table: createTable(2, 2) }] }), false);
});

test('find/change moves untouched and replaced formatted characters with their source edits', () => {
  const table = createTable(1, 1);
  const value = 'a\r\nWool twill wool';
  table.cells[0][0] = value;
  setCellRuns(table, 0, 0, [{ start: 8, end: 13, color: '#123456', italic: true }]);
  const cell = { row: 0, column: 0 };
  const changed = changeCell({ cell, value }, [
    { start: 0, end: 1, text: 'a', replacement: 'new' },
    { start: 8, end: 13, text: 'twill', replacement: 'tweed' },
  ]);
  const result = planTableCorrections({ blocks: [{ id: 't', table }] }, [
    { ...changed, frameId: 't' },
  ]).get('t');
  assert.equal(result.cells[0][0], 'new\r\nWool tweed wool');
  assert.deepEqual(result.cellRuns, {
    '0,0': [{ start: 10, end: 15, color: '#123456', italic: true }],
  });
  assert.match(tableMarkup(result), /color:#123456[^>]*><em>tweed<\/em>/);
});

test('archive cell markup admits only valid, non-overlapping styles on existing UTF-16 text', () => {
  const t = createTable(1, 1);
  t.cells[0][0] = '<script>bold</script>';
  assert.match(tableMarkup(t), /&lt;script&gt;/);
  for (const runs of [
    [{ start: 0, end: 1, untrusted: true }],
    [{ start: 0, end: 32, bold: true }],
    [
      { start: 0, end: 2, bold: true },
      { start: 1, end: 2, italic: true },
    ],
    [{ start: 0, end: 1, color: 'red;position:fixed' }],
  ]) {
    assert.throws(() => validateTable({ ...t, cellRuns: { '0,0': runs } }));
  }
});

test('table marker occupies its own line in a single author paragraph', () => {
  const [p] = validateParagraphSource('Intro\uFFFCAfter', [], [], [5]);
  assert.deepEqual(
    p.opportunities.filter((x) => x.mandatory).map((x) => x.index),
    [5, 6, 11],
  );
  assert.equal(p.text, 'Intro\uFFFCAfter');
  assert.deepEqual(
    validateParagraphSource('a\uFFFC\u2029b', [], [], [1])[0].opportunities.map((x) => x.index),
    [0, 1, 3],
  );
  assert.equal(validateParagraphSource('x\uFFFCy')[0].opportunities.length, 2);
});

test('named cell styles update every assigned cell and survive a removed merge origin', () => {
  const table = createTable(3, 2);
  const options = { name: 'Swatch', fill: '#abcdef', ink: '#131313', inset: 4, vertical: 'middle' };
  const id = defineCellStyle(table, '', options);
  applyCellStyle(table, 0, 0, id);
  applyCellStyle(table, 2, 1, id);
  defineCellStyle(table, id, { ...options, fill: '#fedcba' });
  const merged = reshapeTable(table, 'merge', { row: 0, column: 0, rows: 2 });
  const cut = reshapeTable(merged, 'delete-row', { row: 0, column: 0 });
  assert.deepEqual(cut.appliedCellStyles, { '0,0': id, '1,1': id });
  assert.equal(tableMarkup(cut).match(/background-color:#fedcba/g).length, 2);
  assert.throws(() => defineCellStyle(cut, '', options), /Invalid named/);
  assert.throws(
    () => validateTable({ ...cut, appliedCellStyles: { '0,0': 'missing' } }),
    /Unknown/,
  );
  assert.throws(
    () => defineCellStyle(cut, id, { ...options, fill: 'url(invalid)' }),
    /Invalid named/,
  );
});
