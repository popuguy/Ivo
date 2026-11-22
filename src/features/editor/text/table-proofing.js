import { tableCoverage, tableCellLimit, validateTable } from '../../../domain/documents/tables.js';

export function tableCellId(frame, row, column) {
  return frame + ':' + row + ':' + column;
}

export function* tableProofingSources(doc, block, shown = null) {
  const table = block.table;
  const coverage = tableCoverage(table);
  const frames = [block];
  for (const [row, values] of table.cells.entries()) {
    if (shown && !shown.has(row)) continue;
    for (const [column, value] of values.entries()) {
      const merge = coverage.get(row * table.widths.length + column);
      if (merge && (merge.row !== row || merge.column !== column)) continue;
      yield { id: tableCellId(block.id, row, column), doc, frames, cell: { row, column }, value };
    }
  }
}

// A textarea presents CRLF as a single return. Map each search boundary back to
// the saved string so a correction leaves untouched line endings byte-for-byte intact.
export function indexCell(value) {
  const text = value.replace(/\r\n?|\n/g, '\r');
  if (text.length === value.length) return { text };
  const offsets = [0];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\r' && value[i + 1] === '\n') i++;
    offsets.push(i + 1);
  }
  return { text, offsets };
}

export function changeCell(owner, edits) {
  const result = [];
  let copied = 0,
    count = 0;
  for (const edit of edits) {
    if (edit.text === edit.replacement) continue;
    result.push(owner.value.slice(copied, edit.start), edit.replacement.replace(/\r\n?/g, '\n'));
    copied = edit.end;
    count++;
  }
  result.push(owner.value.slice(copied));
  const value = result.join('');
  if (value.length > tableCellLimit)
    throw Error('The replacement exceeds the table cell text limit.');
  return { cell: owner.cell, value, count };
}

// Validate every affected table before applying a mixed prose/table Change All.
export function planTableCorrections(doc, changes) {
  const tables = new Map();
  for (const { frameId, cell, value } of changes) {
    if (!cell) continue;
    if (!tables.has(frameId)) {
      const block = doc.blocks.find((b) => b.id === frameId);
      if (!block?.table) throw Error('The table has changed. Run the search again.');
      tables.set(frameId, structuredClone(block.table));
    }
    tables.get(frameId).cells[cell.row][cell.column] = value;
  }
  for (const table of tables.values()) validateTable(table);
  return tables;
}
