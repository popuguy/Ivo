/**
 * Disposable source-to-visual geometry. Coordinates are column-local CSS units,
 * never authored positions. Every caret comes from native Range rectangles;
 * logical order is not used to guess a glyph's left/right direction.
 */
const rtl = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u202a-\u202e\u2066-\u2069]/;
function previewLeaves(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    leaves = [];
  let node;
  while ((node = walker.nextNode())) {
    const marker = node.parentElement.closest('[data-flow-text]');
    if (!marker || !root.contains(marker)) continue;
    const prefix = document.createRange();
    prefix.selectNodeContents(marker);
    prefix.setEnd(node, 0);
    const start = Number(marker.dataset.flowText) + prefix.toString().length;
    if (Number.isSafeInteger(start)) leaves.push({ node, start, end: start + node.length });
  }
  return leaves;
}
function dimension(style, axis, element) {
  const horizontal = axis === 'width',
    value = parseFloat(style[axis]);
  if (Number.isFinite(value))
    return (
      value +
      (style.boxSizing === 'border-box'
        ? 0
        : [horizontal ? 'Left' : 'Top', horizontal ? 'Right' : 'Bottom'].reduce(
            (n, side) =>
              n +
              (parseFloat(style['padding' + side]) || 0) +
              (parseFloat(style['border' + side + 'Width']) || 0),
            0,
          ))
    );
  return horizontal ? element.offsetWidth : element.offsetHeight;
}
function axisAligned(element) {
  for (let node = element; node instanceof Element; node = node.parentElement) {
    const transform = getComputedStyle(node).transform;
    if (!transform || transform === 'none') continue;
    const matrix = new DOMMatrixReadOnly(transform);
    if (
      ['m13', 'm14', 'm23', 'm24', 'm31', 'm32', 'm34', 'm43'].some(
        (key) => Math.abs(matrix[key]) > 1e-6,
      ) ||
      Math.abs(matrix.m33 - 1) > 1e-6 ||
      Math.abs(matrix.m44 - 1) > 1e-6 ||
      Math.abs(matrix.b) > 1e-6 ||
      Math.abs(matrix.c) > 1e-6 ||
      matrix.a <= 0 ||
      matrix.d <= 0
    )
      return false;
  }
  return true;
}
function localGeometry(element) {
  const bounds = element.getBoundingClientRect(),
    style = getComputedStyle(element),
    width = dimension(style, 'width', element),
    height = dimension(style, 'height', element),
    scaleX = bounds.width / width,
    scaleY = height > 0 ? bounds.height / height : scaleX;
  return {
    width,
    height,
    rect(rect) {
      return {
        x: (rect.left - bounds.left) / scaleX,
        y: (rect.top - bounds.top) / scaleY,
        width: rect.width / scaleX,
        height: rect.height / scaleY,
      };
    },
    valid:
      width > 0 && scaleX > 0 && scaleY > 0 && Number.isFinite(scaleX) && Number.isFinite(scaleY),
  };
}
function nativeRects(range, local) {
  return [...range.getClientRects()].filter((r) => r.height > 0).map((r) => local.rect(r));
}
function sameLine(a, b) {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlap >= Math.min(a.height, b.height) * 0.5;
}
function lineGroups(stops, column, columnOrder) {
  const result = [];
  for (const stop of [...stops].sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index)) {
    let line = result.find((line) => sameLine(line, stop));
    if (!line) {
      line = {
        frameId: column.frameId,
        column: column.column ?? column.index ?? 0,
        columnOrder,
        sourceStart: column.sourceStart ?? column.start,
        sourceEnd: column.sourceEnd ?? column.end,
        y: stop.y,
        height: stop.height,
        start: stop.index,
        end: stop.index,
        stops: [],
      };
      result.push(line);
    }
    const bottom = Math.max(line.y + line.height, stop.y + stop.height);
    line.y = Math.min(line.y, stop.y);
    line.height = bottom - line.y;
    line.start = Math.min(line.start, stop.index);
    line.end = Math.max(line.end, stop.index);
    line.stops.push(stop);
  }
  for (const [lineOrder, line] of result.entries()) {
    line.lineOrder = lineOrder;
    line.stops.sort(
      (a, b) => a.x - b.x || a.index - b.index || a.affinity.localeCompare(b.affinity),
    );
  }
  return result;
}
function boundaries(columns, supplied, locale) {
  if (supplied) return supplied;
  const min = columns.length ? Math.min(...columns.map((column) => column.start)) : 0,
    max = Math.max(0, ...columns.map((column) => column.end)),
    text = Array(max - min).fill('\n');
  for (const column of columns)
    for (const leaf of column.leaves)
      for (let i = 0; i < leaf.node.length; i++) text[leaf.start - min + i] = leaf.node.data[i];
  const result = new Set();
  for (const part of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text.join('')))
    result.add(part.index + min);
  result.add(max);
  return result;
}

/**
 * Measures one logical flow's current/adjacent columns without changing their DOM
 * or the native selection. Limits/unsupported geometry are explicit so callers
 * can retain native navigation instead of silently skipping source positions.
 */
export function measureFlowCaretLines(
  columns,
  { locale, graphemeBoundaries, maxStops = 20000 } = {},
) {
  if (!Number.isSafeInteger(maxStops) || maxStops < 1)
    throw new TypeError('A positive caret measurement limit is required.');
  const prepared = columns.map((column) => ({
      ...column,
      start: column.sourceStart ?? column.start,
      end: column.sourceEnd ?? column.end,
      leaves: previewLeaves(column.element),
    })),
    edges = boundaries(prepared, graphemeBoundaries, locale),
    orderedEdges = [...edges].sort((a, b) => a - b),
    lines = [],
    limitations = new Set();
  let measuredStops = 0,
    truncated = false;
  for (const [columnOrder, column] of prepared.entries()) {
    if (truncated) break;
    if (!axisAligned(column.element)) {
      limitations.add('rotated-or-sheared-column');
      continue;
    }
    if (getComputedStyle(column.element).writingMode !== 'horizontal-tb') {
      limitations.add('vertical-writing-navigation');
      continue;
    }
    const local = localGeometry(column.element),
      stops = [],
      seen = new Set(),
      range = document.createRange();
    if (!local.valid) {
      limitations.add('unmeasurable-column');
      continue;
    }
    function add(index, affinity, rect, measurement) {
      if (index < column.start || index > column.end || !edges.has(index)) return;
      if (rect.y + rect.height <= 0 || (local.height > 0 && rect.y >= local.height)) return;
      const key = [
        index,
        affinity,
        rect.x.toFixed(4),
        rect.y.toFixed(4),
        rect.height.toFixed(4),
      ].join('/');
      if (seen.has(key)) return;
      if (measuredStops >= maxStops) {
        truncated = true;
        return;
      }
      seen.add(key);
      measuredStops++;
      stops.push({ index, affinity, x: rect.x, y: rect.y, height: rect.height, measurement });
    }
    for (const leaf of column.leaves) {
      if (truncated) break;
      const style = getComputedStyle(leaf.node.parentElement);
      if (style.direction === 'rtl' || rtl.test(leaf.node.data))
        limitations.add('mixed-bidi-affinity');
      for (
        let ancestor = leaf.node.parentElement;
        ancestor && ancestor !== column.element;
        ancestor = ancestor.parentElement
      ) {
        const computed = getComputedStyle(ancestor);
        if (
          computed.verticalAlign !== 'baseline' ||
          (computed.position === 'relative' && parseFloat(computed.top))
        ) {
          limitations.add('offset-inline-baseline');
          break;
        }
      }
      let low = 0,
        high = orderedEdges.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (orderedEdges[middle] < leaf.start) low = middle + 1;
        else high = middle;
      }
      const offsets = [];
      while (low < orderedEdges.length && orderedEdges[low] <= leaf.end)
        offsets.push(orderedEdges[low++]);
      for (const [at, index] of offsets.entries()) {
        if (truncated) break;
        const offset = index - leaf.start;
        range.setStart(leaf.node, offset);
        range.collapse(true);
        const rects = nativeRects(range, local);
        if (!rects.length) {
          limitations.add('native-caret-geometry-unavailable');
          continue;
        }
        const previous = offsets[at - 1],
          next = offsets[at + 1];
        let before = [],
          after = [];
        if (previous !== undefined) {
          range.setStart(leaf.node, previous - leaf.start);
          range.setEnd(leaf.node, offset);
          before = nativeRects(range, local);
        }
        if (next !== undefined) {
          range.setStart(leaf.node, offset);
          range.setEnd(leaf.node, next - leaf.start);
          after = nativeRects(range, local);
        }
        for (const rect of rects) {
          const priorLine = before.some((r) => sameLine(r, rect)),
            nextLine = after.some((r) => sameLine(r, rect));
          const affinity =
            priorLine && !nextLine
              ? 'backward'
              : nextLine && !priorLine
                ? 'forward'
                : offset === leaf.node.length
                  ? 'backward'
                  : 'forward';
          add(index, affinity, rect, 'caret-range');
        }
      }
    }
    for (const br of column.element.querySelectorAll('br[data-flow-break]')) {
      const index = Number(br.dataset.flowBreak);
      if (index < column.start || index > column.end) continue;
      range.setStartBefore(br);
      range.collapse(true);
      const before = nativeRects(range, local);
      for (const rect of before) add(index, 'forward', rect, 'caret-range');
      if (!before.length) {
        range.selectNode(br);
        for (const rect of nativeRects(range, local)) add(index, 'forward', rect, 'break-range');
      }
      range.setStartAfter(br);
      range.collapse(true);
      for (const rect of nativeRects(range, local)) add(index + 1, 'backward', rect, 'caret-range');
    }
    for (const block of column.element.querySelectorAll('[data-flow-block-start]')) {
      if (block.textContent || block.querySelector('br,[data-flow-block-start]')) continue;
      const index = Number(block.dataset.flowBlockStart);
      if (index < column.start || index > column.end) continue;
      range.setStart(block, 0);
      range.collapse(true);
      const rects = nativeRects(range, local);
      for (const rect of rects) add(index, 'forward', rect, 'empty-block-caret');
      if (!rects.length) limitations.add('empty-paragraph-no-caret-rect');
    }
    if (!stops.length && column.start !== column.end)
      limitations.add('column-has-no-measured-carets');
    lines.push(...lineGroups(stops, column, columnOrder));
  }
  return { lines, measuredStops, truncated, limitations: [...limitations] };
}

/** Full authored paragraph/mark ranges, not clipped visual fragments or virtual-LF guesses. */
export function flowParagraphRanges(columns) {
  const ranges = new Map();
  for (const { element } of columns)
    for (const block of element.querySelectorAll('[data-flow-paragraph="true"]')) {
      const start = Number(block.dataset.flowBlockBefore),
        end = Number(block.dataset.flowBlockAfter),
        contentStart = Number(block.dataset.flowBlockStart),
        contentEnd = Number(block.dataset.flowBlockEnd);
      if (![start, end, contentStart, contentEnd].every(Number.isSafeInteger) || end < start)
        continue;
      ranges.set(start + '/' + end, { start, end, contentStart, contentEnd });
    }
  return [...ranges.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}
