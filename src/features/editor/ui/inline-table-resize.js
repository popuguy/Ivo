import {
  columnPoints,
  resizeColumn,
  tableInnerWidth,
} from '../../../domain/geometry/table-columns.js';
import {
  measureInlineTableHeight,
  measureInlineRowMinimums,
} from '../../../rendering/table-thread-layout.js';

const sum = (values) => values.reduce((total, value) => total + value, 0);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/** Prepare one gesture in document points. A cell's painted border identifies
 * the track, even when its opposite edge belongs to a merged cell. */
export function inlineTableResize({ block, node, grip, event, pageWidth, mutate, valid }) {
  const table = block.table,
    grid = node.querySelector('.page-table');
  const rows = [...grid.rows],
    cols = [...grid.querySelectorAll('col')];
  const heights = rows.map((row) => parseFloat(getComputedStyle(row).height));
  const widths = columnPoints(block),
    width = tableInnerWidth(block),
    height = sum(heights);
  const edge = grip.dataset.inlineEdge,
    index = Number(grip.dataset.index);
  const minimums = edge === 'column' ? [] : measureInlineRowMinimums(block);
  const input = grid.closest('[data-page]').getBoundingClientRect().width / pageWidth;
  const angle = ((block.rotation || 0) * Math.PI) / 180;
  const originalRows = rows.map((row) => row.style.height),
    originalCols = cols.map((col) => col.style.width);
  const originalWidth = node.style.width,
    originalHeight = node.style.height,
    originalGridHeight = grid.style.height;
  const site = node
    .closest('[data-page]')
    .querySelector('[data-ivo-anchor="' + CSS.escape(block.id) + '"]');
  const siteWidth = site?.style.width,
    siteHeight = site?.style.height;
  let proposal;
  function restore() {
    node.style.width = originalWidth;
    node.style.height = originalHeight;
    grid.style.height = originalGridHeight;
    rows.forEach((row, i) => (row.style.height = originalRows[i]));
    cols.forEach((col, i) => (col.style.width = originalCols[i]));
    if (site) {
      site.style.width = siteWidth;
      site.style.height = siteHeight;
    }
  }
  function change(e) {
    const x = (e.clientX - event.clientX) / input,
      y = (e.clientY - event.clientY) / input;
    const dx = x * Math.cos(angle) + y * Math.sin(angle);
    const dy = y * Math.cos(angle) - x * Math.sin(angle);
    const corner = edge === 'corner',
      row = edge === 'row',
      column = edge === 'column';
    const scaleX = corner || (column && e.shiftKey && index === widths.length - 1);
    const scaleY = corner || (row && e.shiftKey && index === rows.length - 1);
    let sx = 1 + dx / width,
      sy = 1 + dy / height;
    const minX = Math.max(...widths.map((w) => Math.min(w, 4) / w));
    const minY = scaleY ? Math.max(...minimums.map((h, i) => Math.min(1, h / heights[i]))) : 0;
    const maxX = (100000 - block.w + width) / width,
      maxY = Math.min(...heights.map((h) => 14400 / h));
    if (corner && e.shiftKey) {
      // Project the mouse motion onto the original diagonal.
      sx = sy = clamp(
        1 + (dx * width + dy * height) / (width * width + height * height),
        Math.max(minX, minY),
        Math.min(maxX, maxY),
      );
    } else {
      sx = clamp(sx, minX, maxX);
      sy = clamp(sy, minY, maxY);
    }
    let w = block.w,
      weights = table.widths;
    if (scaleX) w += width * (sx - 1);
    else if (column) {
      const resized = resizeColumn(block, index, widths[index] + dx, e.shiftKey);
      w = resized.w;
      weights = resized.widths;
    }
    const requested = heights.slice();
    if (scaleY) heights.forEach((h, i) => (requested[i] = h * sy));
    else if (row) {
      const paired = e.shiftKey && index + 1 < heights.length;
      const delta = clamp(
        dy,
        Math.min(0, minimums[index] - heights[index]),
        paired
          ? Math.min(14400 - heights[index], Math.max(0, heights[index + 1] - minimums[index + 1]))
          : 14400 - heights[index],
      );
      requested[index] += delta;
      if (paired) requested[index + 1] -= delta;
    }
    if (
      Math.abs(w - block.w) < 0.001 &&
      weights === table.widths &&
      requested.every((h, i) => Math.abs(h - heights[i]) < 0.001)
    ) {
      proposal = null;
      restore();
      return;
    }
    const rowOptions = { ...table.rowOptions };
    if (!column)
      rows.forEach((r, i) => {
        const old = table.rowOptions?.[i]?.minimumHeight || 0;
        if (requested[i] !== heights[i] || heights[i] > Math.max(minimums[i], old) + 0.1)
          rowOptions[i] = { ...rowOptions[i], minimumHeight: clamp(requested[i], 0, 14400) };
        r.style.height = rowOptions[i]?.minimumHeight ? rowOptions[i].minimumHeight + 'px' : '';
      });
    node.style.width = w + 'px';
    const total = sum(weights);
    cols.forEach((col, i) => (col.style.width = (100 * weights[i]) / total + '%'));
    grid.style.height = 'auto';
    node.style.height =
      parseFloat(getComputedStyle(grid).height) + 2 * (block.frameOptions?.strokeWidth || 0) + 'px';
    if (site) {
      site.style.width = node.style.width;
      site.style.height = node.style.height;
    }
    proposal = { w, weights, rowOptions };
  }
  function end(commit) {
    restore();
    if (!commit || !proposal || !valid()) return;
    const { w, weights, rowOptions } = proposal;
    mutate(() => {
      block.w = w;
      table.widths = weights;
      if (Object.keys(rowOptions).length) table.rowOptions = rowOptions;
      block.h = measureInlineTableHeight(block);
    }, cornerLabel(edge));
  }
  return { change, end };
}
function cornerLabel(edge) {
  return edge === 'corner'
    ? 'Resize inline table'
    : edge === 'row'
      ? 'Resize table rows'
      : 'Resize table columns';
}
