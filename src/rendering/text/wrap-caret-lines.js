/** Join two sides of an exclusion into one keyboard-navigation row. Range paint
 * and source ownership stay in their original segment; only navigation geometry
 * is translated from segment-local to frame/physical-column coordinates. */
export function mergeWrappedCaretRows(measured, columns) {
  const lines = [],
    rows = new Map();
  for (const line of measured.lines) {
    const column = columns[line.columnOrder];
    if (!column?.wrap) {
      lines.push(line);
      continue;
    }
    const key = JSON.stringify([column.frameId, column.column, column.row]),
      stops = line.stops.map((stop) => ({
        ...stop,
        x: stop.x + column.left,
        y: stop.y + column.top,
      }));
    let row = rows.get(key);
    if (!row) {
      row = {
        ...line,
        y: line.y + column.top,
        wrapColumnLeft: column.physicalColumnLeft || 0,
        sourceStart: column.start,
        sourceEnd: column.end,
        stops: [],
      };
      rows.set(key, row);
      lines.push(row);
    }
    row.start = Math.min(row.start, line.start);
    row.end = Math.max(row.end, line.end);
    row.sourceStart = Math.min(row.sourceStart, column.start);
    row.sourceEnd = Math.max(row.sourceEnd, column.end);
    const bottom = Math.max(row.y + row.height, line.y + column.top + line.height);
    row.y = Math.min(row.y, line.y + column.top);
    row.height = bottom - row.y;
    row.stops.push(...stops);
  }
  for (const row of rows.values())
    row.stops.sort(
      (a, b) => a.x - b.x || a.index - b.index || a.affinity.localeCompare(b.affinity),
    );
  return { ...measured, lines };
}
