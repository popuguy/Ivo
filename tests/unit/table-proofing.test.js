import assert from 'node:assert/strict';
import test from 'node:test';
import { createTable, reshapeTable } from '../../src/domain/documents/tables.js';
import {
  indexCell,
  changeCell,
  planTableCorrections,
  tableProofingSources,
} from '../../src/features/editor/text/table-proofing.js';

test('table corrections preserve unrelated CRLFs and never search a merged cell twice', () => {
  const table = reshapeTable(createTable(3, 2), 'merge', { row: 0, column: 0, columns: 2 });
  const value = 'a\r\nb\nc';
  table.cells[0][0] = value;
  const block = { id: 't', table },
    doc = { blocks: [block] };
  const sources = [...tableProofingSources(doc, block)];
  assert.equal(sources.length, 5);
  const index = indexCell(value);
  assert.deepEqual(index, { text: 'a\rb\rc', offsets: [0, 1, 3, 4, 5, 6] });
  const change = changeCell(sources[0], [{ start: 3, end: 4, text: 'b', replacement: 'X\rY' }]);
  const plan = planTableCorrections(doc, [{ frameId: 't', ...change }]);
  assert.equal(plan.get('t').cells[0][0], 'a\r\nX\nY\nc');
  assert.equal(block.table.cells[0][0], value);
  assert.throws(
    () => changeCell(sources[0], [{ start: 3, end: 4, text: 'b', replacement: 'x'.repeat(16001) }]),
    /limit/,
  );
});
