/** Optional rich ranges are UTF-16 offsets into the one canonical string in each cell. */
export function hasInlineTables(doc) {
  return (doc.blocks || []).some(
    (b) =>
      b.type === 'table' && (b.table?.cellRuns || b.table?.cellStyles || b.extensions?.ivoAnchor),
  );
}

const marks = ['bold', 'italic', 'underline', 'strike'];
const rgb = /^#[a-f0-9]{6}$/i;
export function validateCellRuns(styles, cells) {
  if (styles === undefined) return;
  if (!styles || typeof styles !== 'object' || Array.isArray(styles))
    throw Error('Invalid table cell styles.');
  const output = {};
  let count = 0;
  for (const [key, runs] of Object.entries(styles)) {
    if (!/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key) || !Array.isArray(runs) || !runs.length)
      throw Error('Invalid formatted table cell.');
    const [row, column] = key.split(',').map(Number);
    const text = cells[row]?.[column];
    if (typeof text !== 'string' || (count += runs.length) > 65536)
      throw Error('Table cell formatting exceeds the table bounds.');
    let end = 0;
    output[key] = runs.map((run) => {
      if (
        !run ||
        typeof run !== 'object' ||
        !Number.isInteger(run.start) ||
        !Number.isInteger(run.end) ||
        run.start < end ||
        run.end <= run.start ||
        run.end > text.length
      )
        throw Error('Invalid table text range.');
      const next = { start: run.start, end: run.end };
      for (const [field, value] of Object.entries(run)) {
        if (field === 'start' || field === 'end') continue;
        if (marks.includes(field) && value === true) next[field] = true;
        else if (
          (field === 'color' || field === 'highlight') &&
          typeof value === 'string' &&
          rgb.test(value)
        )
          next[field] = value.toLowerCase();
        else throw Error('Unknown table character formatting.');
      }
      if (Object.keys(next).length === 2) throw Error('Empty table character formatting.');
      end = run.end;
      return next;
    });
  }
  return Object.keys(output).length ? output : undefined;
}

export function setCellRuns(table, row, column, runs) {
  const key = row + ',' + column;
  if (runs?.length) (table.cellRuns ??= {})[key] = runs;
  else if (table.cellRuns) {
    delete table.cellRuns[key];
    if (!Object.keys(table.cellRuns).length) delete table.cellRuns;
  }
}

/** Find/Change and spelling provide exact source edits, including untouched text between matches. */
export function replaceCellRanges(runs, edits) {
  if (!runs?.length) return [];
  let result = runs;
  for (const edit of [...edits].reverse()) {
    const { start, end } = edit;
    const length = edit.replacement.replace(/\r\n?/g, '\n').length,
      delta = length - (end - start);
    const next = [];
    const inherited = result.find((r) => r.start <= start && r.end > start);
    for (const run of result)
      if (run.start < start) next.push({ ...run, end: Math.min(start, run.end) });
    if (length && inherited) next.push({ ...inherited, start, end: start + length });
    for (const run of result)
      if (run.end > end)
        next.push({ ...run, start: Math.max(end, run.start) + delta, end: run.end + delta });
    result = next;
  }
  return result;
}
