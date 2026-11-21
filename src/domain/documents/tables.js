/** Table coordinates are zero-based. Covered cells are empty; the upper-left cell owns a merge. */
const maxRows = 256,
  maxColumns = 64;
export const tableCellLimit = 16000;
const bounded = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const dimensions = (r, c) => bounded(r, 1, maxRows) && bounded(c, 1, maxColumns) && r * c <= 4096;
export function createTable(rows = 4, columns = 3) {
  if (!dimensions(rows, columns))
    throw Error('Choose up to 256 rows and 64 columns, with at most 4,096 cells.');
  return {
    cells: Array.from({ length: rows }, () => Array(columns).fill('')),
    widths: Array(columns).fill(1),
    merges: [],
    headerRows: 0,
    footerRows: 0,
    inset: 4,
    stroke: 0.5,
    vertical: 'top',
  };
}
export function tableCoverage(table) {
  const covered = new Map(),
    count = table.widths.length;
  for (const merge of table.merges)
    for (let r = merge.row; r < merge.row + merge.rows; r++)
      for (let c = merge.column; c < merge.column + merge.columns; c++) {
        const key = r * count + c;
        if (covered.has(key)) throw Error('Merged cells overlap.');
        if ((r !== merge.row || c !== merge.column) && table.cells[r][c] !== '')
          throw Error('A covered cell contains text.');
        covered.set(key, merge);
      }
  return covered;
}
export function validateTable(value) {
  if (!value || typeof value !== 'object') throw Error('Table data is missing.');
  const { cells, widths, merges, headerRows, footerRows, inset, stroke, vertical } = value;
  if (
    !Array.isArray(cells) ||
    !Array.isArray(widths) ||
    !dimensions(cells.length, widths.length) ||
    widths.some((n) => !Number.isFinite(n) || n <= 0 || n > 10000) ||
    cells.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== widths.length ||
        row.some((s) => typeof s !== 'string' || s.length > tableCellLimit),
    )
  )
    throw Error('Invalid table cells or column widths.');
  if (
    !bounded(headerRows, 0, cells.length - 1) ||
    !bounded(footerRows, 0, cells.length - 1 - headerRows) ||
    !Number.isFinite(inset) ||
    inset < 0 ||
    inset > 72 ||
    !Number.isFinite(stroke) ||
    stroke < 0 ||
    stroke > 12 ||
    !['top', 'middle', 'bottom'].includes(vertical)
  )
    throw Error('Invalid table formatting.');
  if (!Array.isArray(merges) || merges.length > Math.floor((cells.length * widths.length) / 2))
    throw Error('Invalid merged cells.');
  for (const m of merges) {
    if (
      !m ||
      !bounded(m.row, 0, cells.length - 1) ||
      !bounded(m.column, 0, widths.length - 1) ||
      !bounded(m.rows, 1, cells.length - m.row) ||
      !bounded(m.columns, 1, widths.length - m.column) ||
      m.rows * m.columns < 2
    )
      throw Error('A merge must fit inside the table.');
    if (
      [headerRows, cells.length - footerRows].some((edge) => m.row < edge && m.row + m.rows > edge)
    )
      throw Error('A merged cell cannot cross a header or footer boundary.');
  }
  if (cells.reduce((n, row) => n + row.reduce((sum, s) => sum + s.length, 0), 0) > 1000000)
    throw Error('Table text exceeds one million characters.');
  tableCoverage(value);
  return {
    cells: cells.map((row) => [...row]),
    widths: [...widths],
    merges: merges.map(({ row, column, rows, columns }) => ({ row, column, rows, columns })),
    headerRows,
    footerRows,
    inset,
    stroke,
    vertical,
  };
}
export function reshapeTable(source, action, { row, column, rows = 1, columns = 1 } = {}) {
  const t = structuredClone(source),
    nr = t.cells.length,
    nc = t.widths.length;
  if (!bounded(row, 0, nr - 1) || !bounded(column, 0, nc - 1)) throw Error('Choose a table cell.');
  if (action === 'merge') {
    if (!bounded(rows, 1, nr - row) || !bounded(columns, 1, nc - column) || rows * columns < 2)
      throw Error('Choose two or more cells inside the table.');
    const covered = tableCoverage(t),
      text = [];
    for (let r = row; r < row + rows; r++)
      for (let c = column; c < column + columns; c++) {
        if (covered.has(r * nc + c))
          throw Error('Split existing merged cells before merging this range.');
        if (t.cells[r][c]) text.push(t.cells[r][c]);
        t.cells[r][c] = '';
      }
    t.cells[row][column] = text.join('\n');
    t.merges.push({ row, column, rows, columns });
  } else if (action === 'split') {
    const merge = tableCoverage(t).get(row * nc + column);
    if (!merge) throw Error('Choose a merged cell.');
    t.merges = t.merges.filter((m) => m !== merge);
  } else {
    const [verb, axis] = action.split('-');
    if (
      !['row', 'column'].includes(axis) ||
      !['insert', 'delete', 'earlier', 'later'].includes(verb)
    )
      throw Error('Unknown table operation.');
    const horiz = axis === 'column',
      i = horiz ? column : row,
      n = horiz ? nc : nr,
      count = horiz ? 'columns' : 'rows',
      indices = Array.from({ length: n }, (_, j) => j);
    if (verb === 'insert') indices.splice(i + 1, 0, null);
    if (verb === 'delete') indices.splice(i, 1);
    if (verb === 'earlier' || verb === 'later') {
      const to = i + (verb === 'earlier' ? -1 : 1);
      if (to < 0 || to >= n) throw Error('The cell is already at that edge.');
      indices.splice(to, 0, ...indices.splice(i, 1));
    }
    if (!dimensions(horiz ? nr : indices.length, horiz ? indices.length : nc))
      throw Error('The table must stay within its row and column limits.');
    const sections = Array.from({ length: nr }, (_, j) =>
      j < t.headerRows ? 0 : j >= nr - t.footerRows ? 2 : 1,
    );
    if (!horiz) {
      const next = indices.map((j) => sections[j ?? i]);
      if (next.some((v, k) => k > 0 && v < next[k - 1]) || !next.includes(1))
        throw Error('Keep headers, body rows and footers in order.');
      t.headerRows = next.filter((v) => v === 0).length;
      t.footerRows = next.filter((v) => v === 2).length;
    }
    const moved = [];
    for (const m of t.merges) {
      const first = m[axis],
        last = first + m[count] - 1;
      const positions = indices.flatMap((old, j) =>
        (old === null ? first <= i && i < last : old >= first && old <= last) ? [j] : [],
      );
      if (!positions.length) continue;
      if (positions.at(-1) - positions[0] + 1 !== positions.length)
        throw Error('Split the merged cell before moving this row or column.');
      const newMerge = { ...m, [axis]: positions[0], [count]: positions.length };
      moved.push({ m: newMerge, text: t.cells[m.row][m.column] });
      t.cells[m.row][m.column] = '';
    }
    if (horiz) {
      t.cells = t.cells.map((r) => indices.map((j) => (j === null ? '' : r[j])));
      t.widths = indices.map((j) => t.widths[j ?? i]);
    } else t.cells = indices.map((j) => (j === null ? Array(nc).fill('') : t.cells[j]));
    t.merges = [];
    for (const { m, text } of moved) {
      t.cells[m.row][m.column] = text;
      if (m.rows * m.columns > 1) t.merges.push(m);
    }
  }
  return validateTable(t);
}
