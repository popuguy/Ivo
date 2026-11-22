export function tableInnerWidth(block) {
  return Math.max(0, block.w - 2 * (block.frameOptions?.strokeWidth || 0));
}
export function columnPoints(block) {
  const total = block.table.widths.reduce((sum, weight) => sum + weight, 0);
  const width = tableInnerWidth(block);
  return block.table.widths.map((weight) => width * (weight / total));
}

/** Keep the left midpoint fixed, including when rotation changes the frame's center. */
export function resizeColumn(block, column, requested, balance = false) {
  const points = columnPoints(block),
    old = points[column];
  if (!Number.isFinite(requested) || old === undefined)
    throw Error('Enter a column width in points.');
  const min = Math.min(4, old),
    next = points[column + 1];
  const paired = balance && next !== undefined;
  const max = paired ? old + next - Math.min(4, next) : 100000 - block.w + old;
  const width = Math.min(max, Math.max(min, requested)),
    delta = width - old;
  if (delta === 0) return { widths: block.table.widths, ...geometry(block, 0) };
  if (old === 0) throw Error('Reduce the frame stroke to make room for table columns.');
  points[column] = width;
  if (paired) points[column + 1] -= delta;
  const largest = Math.max(...points);
  // Weights are relative. Normalization keeps even large frames inside the archive bounds.
  return { widths: points.map((n) => n / largest), ...geometry(block, paired ? 0 : delta) };
}
function geometry(block, delta) {
  const radians = ((block.rotation || 0) * Math.PI) / 180;
  return {
    x: block.x + ((Math.cos(radians) - 1) * delta) / 2,
    y: block.y + (Math.sin(radians) * delta) / 2,
    w: block.w + delta,
  };
}
