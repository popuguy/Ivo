import { tableInnerWidth } from '../domain/geometry/table-columns.js';
import { paginateTable, tableThreads } from '../domain/documents/table-threads.js';
import { fontFamilyFor } from '../domain/text/typography.js';
import { tableMarkup } from './table.js';

export async function prepareTableFonts(doc) {
  if (!doc.blocks.some((b) => b.tableNext)) return;
  const styles = new Set(
    doc.blocks
      .filter((b) => b.type === 'table')
      .flatMap((b) => {
        const family = fontFamilyFor(b.textStyle) || 'serif';
        return ['400', '700'].map((weight) => weight + ' ' + b.fontSize + 'px ' + family);
      }),
  );
  await Promise.all([...styles].map((style) => document.fonts.load(style)));
}

function measuringFrame() {
  const host = document.createElement('div');
  host.className = 'table-frame';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;height:auto;contain:layout style';
  return host;
}

function setFrameMetrics(host, frame) {
  host.style.width = tableInnerWidth(frame) + 'px';
  host.style.fontFamily = fontFamilyFor(frame.textStyle) || 'serif';
  host.style.fontSize = frame.fontSize + 'px';
}

export function measureInlineRowMinimums(frame) {
  return measureInline(frame, true);
}
export function measureInlineTableHeight(frame) {
  return measureInline(frame, false);
}
function measureInline(frame, measureRows) {
  const host = measuringFrame();
  try {
    setFrameMetrics(host, frame);
    host.innerHTML = tableMarkup(
      measureRows ? { ...frame.table, rowOptions: undefined } : frame.table,
      { layout: true },
    );
    const grid = host.firstElementChild;
    grid.style.height = 'auto';
    document.body.append(host);
    if (measureRows) return Array.from(grid.rows, (row) => row.getBoundingClientRect().height);
    return Math.max(
      1,
      grid.getBoundingClientRect().height + 2 * (frame.frameOptions?.strokeWidth || 0),
    );
  } finally {
    host.remove();
  }
}

// Measure at document scale, outside the editor camera. Use the same column widths,
// borders and type as the printed table; a textarea used for editing never contributes.
export function layoutTableThreads(doc, cache) {
  const result = new Map();
  if (!doc.blocks.some((b) => b.tableNext)) return result;
  const host = measuringFrame();

  try {
    for (const frames of new Set(tableThreads(doc.blocks).values())) {
      if (frames.length < 2) continue;
      const head = frames[0],
        table = head.table;
      // Cell strings, options and column widths can be edited in place. Geometry is
      // independent of the camera, page position and selection.
      const key =
        cache &&
        JSON.stringify([
          table,
          frames.map((f) => [f.id, f.w, f.h, f.fontSize, f.textStyle, f.frameOptions?.strokeWidth]),
        ]);
      const previous = cache?.get(head);
      if (previous && previous.key === key) {
        for (const [id, part] of previous.parts) result.set(id, part);
        continue;
      }
      if (!host.isConnected) document.body.append(host);
      host.innerHTML = tableMarkup(table, { layout: true });
      const grid = host.firstElementChild;
      grid.style.height = 'auto';
      const metrics = new Map();
      function measure(frame) {
        const stroke = frame.frameOptions?.strokeWidth || 0;
        const key = JSON.stringify([frame.w, frame.fontSize, frame.textStyle, stroke]);
        if (metrics.has(key)) return metrics.get(key);
        setFrameMetrics(host, frame);
        const heights = Array.from(grid.rows, (r) => r.getBoundingClientRect().height);
        const border = grid.getBoundingClientRect().height - heights.reduce((sum, h) => sum + h, 0);
        const m = { heights, border: border + 2 * stroke };
        metrics.set(key, m);
        return m;
      }
      const parts = paginateTable(table, frames, measure);
      cache?.set(head, { key, parts });
      for (const [id, part] of parts) result.set(id, part);
    }
  } finally {
    host.remove();
  }
  return result;
}
