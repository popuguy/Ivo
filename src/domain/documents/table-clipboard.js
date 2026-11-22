import { readDelimitedRows } from '../text/merge-records.js';
import { createTable, tableCoverage, validateTable } from './tables.js';

export function readTableText(text, delimiter = '\t') {
  if (text.length > 1200000) throw Error('The pasted table is too large.');
  const rows = readDelimitedRows(text, {
    delimiter,
    keepBlank: true,
    maxRows: 256,
    maxColumns: 64,
  });
  if (!rows.length) throw Error('Paste at least one cell.');
  return rows;
}
export function tableText(table, delimiter = '\t') {
  return table.cells
    .map((row) =>
      row
        .map((s) =>
          s.includes(delimiter) || /["\n\r]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s,
        )
        .join(delimiter),
    )
    .join('\n');
}
export function putTableCells(source, row, column, values) {
  const height = row + values.length,
    width = column + Math.max(...values.map((r) => r.length));
  if (height > source.cells.length && source.footerRows)
    throw Error('Insert body rows above the footer before pasting this range.');
  const next = createTable(
    Math.max(height, source.cells.length),
    Math.max(width, source.widths.length),
  );
  Object.assign(next, {
    ...(source.rowOptions && { rowOptions: structuredClone(source.rowOptions) }),
    headerRows: source.headerRows,
    footerRows: source.footerRows,
    merges: structuredClone(source.merges),
    vertical: source.vertical,
    stroke: source.stroke,
    inset: source.inset,
  });
  next.widths.splice(0, source.widths.length, ...source.widths);
  source.cells.forEach((cells, i) => next.cells[i].splice(0, cells.length, ...cells));
  const coverage = tableCoverage(next);
  for (const [dy, cells] of values.entries())
    for (const [dx, value] of cells.entries()) {
      const y = row + dy,
        x = column + dx,
        merge = coverage.get(y * next.widths.length + x);
      if (merge && (merge.row !== y || merge.column !== x))
        throw Error('Split the merged cells before pasting across them.');
      next.cells[y][x] = value;
    }
  return validateTable(next);
}
