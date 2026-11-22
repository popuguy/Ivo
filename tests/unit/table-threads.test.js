import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSceneDocument,
  insertObject,
  continueTableOnNextPage,
  removePage,
  duplicateObjects,
  removeObject,
} from '../../src/domain/documents/scene.js';
import { paginateTable, tableThreads } from '../../src/domain/documents/table-threads.js';
import { createTable, reshapeTable } from '../../src/domain/documents/tables.js';
import { copyDocument } from '../../src/domain/documents/copy.js';
import { copyObjectSelection, pasteObjectSelection } from '../../src/domain/documents/clipboard.js';
import { validateImport } from '../../src/domain/documents/schema.js';
import { archiveVersion } from '../../src/domain/documents/capabilities.js';

function fixture() {
  const doc = createSceneDocument('Samples'),
    page = doc.pages[0].id;
  const head = insertObject(doc, 'table', page, { table: createTable(9, 2) });
  head.table.cells[4][0] = 'Czech • červená';
  const middle = continueTableOnNextPage(doc, head.id),
    tail = continueTableOnNextPage(doc, middle.id);
  return { doc, head, middle, tail };
}
test('whole body rows flow between repeated headings and footers; merges and keep chains stay together', () => {
  const { head, middle, tail } = fixture(),
    t = head.table;
  t.headerRows = 1;
  t.footerRows = 1;
  t.merges = [{ row: 2, column: 1, rows: 2, columns: 1 }];
  t.rowOptions = { 3: { keepWithNext: true } };
  const frames = [head, middle, tail];
  [50, 60, 40].forEach((h, i) => (frames[i].h = h));
  const plan = paginateTable(t, frames, () => ({ heights: t.cells.map(() => 10), border: 0 }));
  assert.deepEqual(
    [...plan.values()].map((p) => [p.first, p.last, p.overset]),
    [
      [1, 2, false],
      [2, 6, false],
      [6, 8, false],
    ],
  );
  middle.h = 20;
  const small = paginateTable(t, frames, () => ({ heights: t.cells.map(() => 10), border: 0 }));
  assert.equal(small.get(tail.id).overset, true);
  assert.equal(small.get(tail.id).first, 2);
  const changed = reshapeTable(t, 'insert-row', { row: 0, column: 0 });
  assert.deepEqual(changed.rowOptions, { 4: { keepWithNext: true } });
});
test('partial table copies own independent rows; deleting a head preserves subsequent frames and the full data', () => {
  const { doc, head, middle, tail } = fixture();
  const copy = copyDocument(doc);
  assert.deepEqual(tableThreads(copy.blocks).get(copy.blocks[2].id), copy.blocks);
  const payload = copyObjectSelection(doc, [middle.id, tail.id]);
  const target = createSceneDocument('Paste');
  pasteObjectSelection(target, payload.archive, { pageId: target.pages[0].id });
  assert.equal(target.blocks[0].table.cells[4][0], 'Czech • červená');
  assert.equal(target.blocks[0].tableNext, target.blocks[1].id);
  assert.equal(target.blocks[1].table, undefined);
  const [independent] = duplicateObjects(doc, [tail.id]);
  independent.table.cells[4][0] = 'Blue';
  assert.equal(head.table.cells[4][0], 'Czech • červená');
  removeObject(doc, middle.id);
  assert.equal(head.tableNext, tail.id);
  removePage(doc, head.pageId);
  assert.equal(tail.table.cells[4][0], 'Czech • červená');
  assert.equal(tail.tableNext, undefined);
});
test('archive rejects a broken table chain and preserves an earlier archive', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../fixtures/legacy/archive-v31.json', import.meta.url), 'utf8'),
  );
  assert.equal(archiveVersion(validateImport(raw).documents), 31);
  const { doc, head, middle, tail } = fixture();
  const data = { schemaVersion: archiveVersion([doc]), documents: [doc], assets: [] };
  assert.equal(data.schemaVersion, 32);
  assert.equal(validateImport(data).documents[0].blocks[1].tableNext, tail.id);
  assert.throws(() => validateImport({ ...data, schemaVersion: 31 }), /archive 32/);
  tail.tableNext = head.id;
  assert.throws(() => validateImport(data), /cycle/);
  delete tail.tableNext;
  middle.tableNext = 'missing';
  assert.throws(() => validateImport(data), /continuation/);
});
