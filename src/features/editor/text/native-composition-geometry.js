/** Native composition coordinates and source maps are disposable view data. */
import { characterInkBox } from '../../../domain/text/character-geometry.js';
import { runCaret } from '../../../domain/text/run-geometry.js';
const finite = (n) => Number.isFinite(n);
const sourceIndexes = new WeakMap(),
  caretIndexes = new WeakMap(),
  rowIndexes = new WeakMap();
function lowerBound(values, value) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
function sourceIndex(native) {
  let index = sourceIndexes.get(native.spans);
  if (!index) {
    index = {
      nativeEnds: native.spans.map((s) => s.end),
      logicalEnds: native.spans.map((s) => s.logicalEnd),
    };
    sourceIndexes.set(native.spans, index);
  }
  return index;
}
function sourceAt(native, at) {
  const result = [],
    index = sourceIndex(native);
  for (
    let i = lowerBound(index.nativeEnds, at);
    i < native.spans.length && native.spans[i].start <= at;
    i++
  )
    result.push(native.spans[i]);
  return result;
}
function caretChoices(native, at) {
  let index = caretIndexes.get(native);
  if (!index || index.lines !== native.lines || index.spans !== native.spans) {
    const rows = [];
    for (const [lineIndex, line] of native.lines.entries())
      for (const caret of line.carets || []) {
        const range = candidates(caret);
        if (range && finite(caret.primary)) rows.push({ line, caret, lineIndex, range });
      }
    rows.sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
    index = {
      lines: native.lines,
      spans: native.spans,
      rows,
      ends: rows.map((row) => row.range[1]),
    };
    caretIndexes.set(native, index);
  }
  const rows = [];
  for (
    let i = lowerBound(index.ends, at);
    i < index.rows.length && index.rows[i].range[0] <= at;
    i++
  )
    rows.push(index.rows[i]);
  return rows;
}

function data(column) {
  const native = column.native;
  return native && Array.isArray(native.lines) && Array.isArray(native.spans) ? native : null;
}
/** Wrap fragments retain independent native lines but share one navigable physical row. */
function physicalRows(native) {
  let index = rowIndexes.get(native);
  if (!index || index.lines !== native.lines) {
    const rows = [];
    for (const [lineIndex, line] of native.lines.entries()) {
      const previous = rows.at(-1),
        top = line.baseline - line.ascent,
        bottom = line.baseline + line.descent;
      if (previous && Math.abs(previous.baseline - line.baseline) <= 1e-6) {
        previous.fragments.push({ line, lineIndex });
        previous.y = Math.min(previous.y, top);
        previous.bottom = Math.max(previous.bottom, bottom);
      } else
        rows.push({ baseline: line.baseline, y: top, bottom, fragments: [{ line, lineIndex }] });
    }
    index = { lines: native.lines, rows };
    rowIndexes.set(native, index);
  }
  return index.rows;
}
const bounds = (column) => ({
  start: column.sourceStart ?? column.start,
  end: column.sourceEnd ?? column.end,
});
function candidates(caret) {
  const values = caret.logicalCandidates;
  return Array.isArray(values) &&
    values.length === 2 &&
    values.every(Number.isSafeInteger) &&
    values[0] <= values[1]
    ? values
    : null;
}
function canonicalCaret(native, line, caret, affinity) {
  const index = caret.index,
    spans = sourceAt(native, index);
  if (line.contentEnd === line.start && index === line.start) {
    const placeholder = spans.find((span) => span.kind === 'placeholder'),
      paragraph = spans.find((span) => span.kind === 'paragraph' && span.start === index);
    if (placeholder || paragraph) return (placeholder || paragraph).logicalStart;
  }
  const text = spans.filter((span) => span.kind === 'text'),
    edge =
      affinity === 'backward'
        ? text.findLast((span) => span.end === index && span.start < index)
        : text.find((span) => span.start === index && span.end > index),
    interior = text.find((span) => index > span.start && index < span.end),
    selected = edge || interior;
  if (selected) return selected.logicalStart + index - selected.start;
  const mark =
    affinity === 'backward'
      ? spans.findLast((span) => span.kind === 'paragraph' && span.end === index) ||
        spans.find((span) => span.kind === 'paragraph' && span.start === index)
      : spans.find((span) => span.kind === 'paragraph' && span.start === index) ||
        spans.findLast((span) => span.kind === 'paragraph' && span.end === index);
  if (mark) return index === mark.start ? mark.logicalStart : mark.logicalEnd;
  const range = candidates(caret);
  return range ? range[affinity === 'backward' ? 0 : 1] : null;
}
function inkRun(line, index, affinity = 'forward') {
  const point = Math.min(index, line.contentEnd ?? line.end),
    runs = line.runs || [];
  return (
    (affinity === 'backward'
      ? runs.findLast((run) => run.start < point && run.end >= point)
      : runs.find((run) => run.start <= point && run.end > point)) ||
    (point >= (line.contentEnd ?? line.end) ? runs.at(-1) : runs[0]) ||
    line
  );
}
function lineRect(line, x, width = 0, run = line) {
  return {
    x,
    ...characterInkBox(line, run),
    width,
  };
}
function side(caret, preferred = 'primary') {
  return preferred === 'secondary' && finite(caret.secondary) ? caret.secondary : caret.primary;
}
function svg(column) {
  return column.svg || column.element?.querySelector('svg[data-composed-text]');
}
function matrix(column) {
  return svg(column)?.getScreenCTM?.() || null;
}
export function hasNativeColumn(column) {
  return !!data(column) && !!matrix(column);
}

/** Resolve one logical caret without conflating virtual source marks with native UTF-16. */
export function nativeCaretRect(column, point, { hint } = {}) {
  const native = data(column);
  if (!native) return null;
  const choices = caretChoices(native, point.index).map((row) => {
    const { line, caret, lineIndex } = row,
      start = caret.index === line.start,
      end = caret.index >= (line.contentEnd ?? line.end),
      affinity = point.affinity || 'forward',
      score =
        (hint?.lineIndex === lineIndex ? 10 : 0) +
        (affinity === 'backward' ? (end ? 2 : 0) : start ? 2 : 0);
    return { ...row, score };
  });
  const own = choices.sort((a, b) => b.score - a.score)[0];
  if (!own) return null;
  const selectedSide = hint?.lineIndex === own.lineIndex ? hint.side : 'primary';
  return {
    ...lineRect(
      own.line,
      side(own.caret, selectedSide),
      0,
      inkRun(own.line, own.caret.index, point.affinity),
    ),
    index: point.index,
    affinity: point.affinity || 'forward',
    nativeIndex: own.caret.index,
    lineIndex: own.lineIndex,
    side: selectedSide || 'primary',
    secondaryX: own.caret.secondary,
    measurement: own.caret.measurement,
  };
}

/** Transform through the actual composed SVG, including camera zoom and frame transforms. */
export function nativeRectScreenPoints(column, rect) {
  const ctm = matrix(column);
  if (!ctm) return [];
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(ctm));
}
export function nativeRectScreenBounds(column, rect) {
  const points = nativeRectScreenPoints(column, rect);
  if (!points.length) return null;
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}

/** Pointer hit uses measured primary/secondary offsets, not logical-index direction guesses. */
export function hitNativeColumn(column, point, { coordinateSpace = 'screen' } = {}) {
  const native = data(column);
  if (!native?.lines.length) return null;
  let local = point;
  if (coordinateSpace === 'screen') {
    const ctm = matrix(column);
    if (!ctm) return null;
    local = new DOMPoint(point.x, point.y).matrixTransform(ctm.inverse());
  } else if (coordinateSpace !== 'column') throw new TypeError('Unknown native coordinate space.');
  const distance = (row) => Math.max(row.y - local.y, 0, local.y - row.bottom),
    row = physicalRows(native).reduce(
      (best, candidate) => (!best || distance(candidate) < distance(best) ? candidate : best),
      null,
    );
  let best;
  for (const { line, lineIndex } of row.fragments)
    for (const caret of line.carets || [])
      for (const name of ['primary', 'secondary']) {
        if (caret.index > (line.contentEnd ?? line.end)) continue;
        const range = candidates(caret),
          x = caret[name];
        if (!range || !finite(x)) continue;
        const d = Math.abs(x - local.x);
        if (!best || d < best.distance)
          best = { line, lineIndex, caret, range, side: name, distance: d };
      }
  if (!best) return null;
  const { line, lineIndex } = best,
    affinity =
      line.contentEnd === line.start || best.caret.index === line.start
        ? 'forward'
        : best.caret.index >= (line.contentEnd ?? line.end)
          ? 'backward'
          : 'forward',
    own = bounds(column),
    index = canonicalCaret(native, line, best.caret, affinity);
  return {
    frameId: column.frameId,
    index: Math.max(own.start, Math.min(own.end, index)),
    affinity,
    nativeCaretHint: { lineIndex, side: best.side },
    measurement: best.caret.measurement,
  };
}

/** Geometry interface shared with the DOM caret-line adapter. */
export function nativeCaretLines(columns) {
  const lines = [],
    limitations = new Set();
  let measuredStops = 0;
  for (const [columnOrder, column] of columns.entries()) {
    const native = data(column),
      own = bounds(column);
    if (!native) {
      limitations.add('native-column-unavailable');
      continue;
    }
    for (const row of physicalRows(native)) {
      const stops = [];
      for (const { line, lineIndex } of row.fragments) {
        for (const caret of line.carets || []) {
          const range = candidates(caret);
          if (!range) continue;
          if (caret.index > (line.contentEnd ?? line.end)) continue;
          const affinity =
              line.contentEnd === line.start || caret.index === line.start
                ? 'forward'
                : caret.index >= (line.contentEnd ?? line.end)
                  ? 'backward'
                  : 'forward',
            aliases = [{ index: canonicalCaret(native, line, caret, affinity), affinity }];
          const offsets = [{ side: 'primary', x: caret.primary }];
          if (finite(caret.secondary) && Math.abs(caret.secondary - caret.primary) > 1e-6)
            offsets.push({ side: 'secondary', x: caret.secondary });
          for (const point of aliases)
            for (const offset of offsets)
              if (point.index >= own.start && point.index <= own.end && finite(offset.x)) {
                stops.push({
                  frameId: column.frameId,
                  ...point,
                  ...lineRect(line, offset.x, 0, inkRun(line, caret.index, point.affinity)),
                  nativeIndex: caret.index,
                  nativeCaretHint: { lineIndex, side: offset.side },
                  measurement: caret.measurement,
                });
              }
        }
        if (line.runs?.some((run) => run.rtl)) limitations.add('mixed-bidi-affinity');
      }
      if (!stops.length) continue;
      stops.sort((a, b) => a.x - b.x || a.index - b.index);
      measuredStops += stops.length;
      lines.push({
        frameId: column.frameId,
        column: column.column ?? column.index ?? 0,
        columnOrder,
        lineOrder: row.fragments[0].lineIndex,
        sourceStart: own.start,
        sourceEnd: own.end,
        start: Math.min(...stops.map((s) => s.index)),
        end: Math.max(...stops.map((s) => s.index)),
        y: row.y,
        height: row.bottom - row.y,
        stops,
      });
    }
  }
  return { lines, measuredStops, truncated: false, limitations: [...limitations] };
}
function sourceIntervals(native, selection) {
  const intervals = [],
    virtual = [],
    limitations = [];
  const index = sourceIndex(native);
  for (
    let at = lowerBound(index.logicalEnds, selection.start);
    at < native.spans.length && native.spans[at].logicalStart < selection.end;
    at++
  ) {
    const span = native.spans[at],
      a = Math.max(selection.start, span.logicalStart),
      b = Math.min(selection.end, span.logicalEnd);
    if (b <= a) continue;
    const logical = span.logicalEnd - span.logicalStart,
      count = span.end - span.start;
    if (!count) {
      virtual.push({ index: span.start, logicalStart: a, logicalEnd: b });
      continue;
    }
    if (count !== logical) {
      limitations.push('nonlinear-source-span');
      continue;
    }
    intervals.push({
      start: span.start + a - span.logicalStart,
      end: span.start + b - span.logicalStart,
    });
  }
  const merged = [];
  for (const interval of intervals) {
    const prior = merged.at(-1);
    if (prior && interval.start <= prior.end) prior.end = Math.max(prior.end, interval.end);
    else merged.push({ ...interval });
  }
  return { intervals: merged, virtual, limitations };
}
/** Split selection paint by measured visual runs, including partial ligatures and RTL runs. */
export function nativeSelectionRects(column, selection) {
  const native = data(column);
  if (!native || selection.end <= selection.start) return { rects: [], limitations: [] };
  const mapped = sourceIntervals(native, selection),
    rects = [],
    limitations = new Set(mapped.limitations);
  for (const [lineIndex, line] of native.lines.entries())
    for (const interval of mapped.intervals) {
      const start = Math.max(interval.start, line.start),
        end = Math.min(interval.end, line.end);
      if (end <= start) continue;
      for (const run of line.runs || []) {
        const a = Math.max(start, run.start),
          b = Math.min(end, run.end);
        if (b <= a) continue;
        const x1 = runCaret(line, run, a),
          x2 = runCaret(line, run, b);
        if (x1 === null || x2 === null) {
          limitations.add('selection-boundary-not-native-caret');
          continue;
        }
        rects.push({
          ...lineRect(line, Math.min(x1.x, x2.x), Math.abs(x2.x - x1.x), run),
          lineIndex,
          nativeStart: a,
          nativeEnd: b,
          measurement:
            x1.measurement === 'native-run-extent' || x2.measurement === 'native-run-extent'
              ? 'native-run-extent'
              : 'native-run-carets',
        });
      }
      const markStart = Math.max(start, line.contentEnd ?? line.end);
      if (end > markStart) {
        const caret = line.carets?.find((c) => c.index === markStart);
        if (caret)
          rects.push({
            ...lineRect(line, caret.primary),
            lineIndex,
            nativeStart: markStart,
            nativeEnd: end,
            measurement: 'paragraph-mark-native-origin',
          });
      }
    }
  for (const part of mapped.virtual) {
    const lineIndex = native.lines.findIndex(
        (line) => part.index >= line.start && part.index <= line.end,
      ),
      line = native.lines[lineIndex],
      caret = line?.carets?.find((c) => c.index === part.index);
    if (caret)
      rects.push({
        ...lineRect(line, caret.primary),
        lineIndex,
        nativeStart: part.index,
        nativeEnd: part.index,
        measurement: 'virtual-source-boundary',
      });
  }
  const seen = new Set();
  return {
    rects: rects.filter((rect) => {
      const key = [rect.lineIndex, rect.x, rect.y, rect.width, rect.height].join('/');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    limitations: [...limitations],
  };
}
