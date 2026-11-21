const rememberedLayouts = new WeakMap();
// Undo and tab navigation may restore an already-finished native result without
// sending another request to the worker. Use that result for the following edit.
export function restoreInteractiveLayout(result) {
  rememberedLayouts.get(result)?.();
  return result;
}

const translations = new WeakMap();
const lineVectors = new WeakMap();

// Each retained line uses its own absolute source coordinates. Ink shape,
// outline identities and memory estimates can use the original arrays directly.
export const originalLineGeometry = (line) => translations.get(line)?.origin || line;

function vectorIds(line) {
  let ids = lineVectors.get(line.runs);
  if (!ids) {
    const unique = new Set();
    for (const run of line.runs)
      for (const glyph of run.glyphs) if (glyph.vector) unique.add(glyph.vector);
    ids = [...unique];
    lineVectors.set(line.runs, ids);
  }
  return ids;
}

// Match only source intervals that can contribute either glyphs or boundary carets.
function touching(ranges, start, end) {
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid].end < start) lo = mid + 1;
    else hi = mid;
  }
  let last = lo;
  while (last < ranges.length && ranges[last].start <= end) last++;
  return ranges.slice(lo, last);
}

function paragraphShape(request, paragraph, fonts) {
  const { start, end, ...settings } = paragraph;
  const text = request.text.slice(start, end);
  // Admit only scripts whose shaping context is covered by this paragraph.
  if (
    !/^[\u0300-\u036f\x20-\x7e\t\p{Script=Latin}\u00a0\u2010-\u2015\u2018-\u201f\u2022\u2026\u2028\u2029]+$/u.test(
      text,
    )
  )
    return null;
  const runs = touching(request.runs, start, end)
    .filter((run) => run.start < end && run.end > start)
    .map((run) => ({
      ...run,
      start: Math.max(start, run.start) - start,
      end: Math.min(end, run.end) - start,
    }));
  const spans = touching(request.spans, start, end);
  const first = spans[0];
  const logical =
    first.logicalStart + (first.kind === 'text' ? Math.max(0, start - first.start) : 0);
  const hyphens = request.hyphenationPoints
    ?.filter((at) => at > start && at < end)
    .map((at) => at - start);
  const mapping = spans.map((span) => {
    const left = Math.max(start, span.start),
      right = Math.min(end, span.end);
    return [
      span.kind,
      left - start,
      right - start,
      span.logicalStart - logical + (span.kind === 'text' ? left - span.start : 0),
      span.logicalEnd - logical - (span.kind === 'text' ? span.end - right : 0),
    ];
  });
  return {
    start,
    logical,
    key: JSON.stringify([request.protocol, text, settings, runs, fonts, mapping, hyphens]),
  };
}

// Predict reusable rows without prescribing line breaks to either composer.
function geometryCandidates(request, sources) {
  const fonts = request.resources.map(({ id, digest, postscript }) => [id, digest, postscript]);
  const shapes = request.paragraphs.map((paragraph) => paragraphShape(request, paragraph, fonts));
  const matches = new Map(),
    candidates = [];
  // A planned line already has an exact source interval and a physical fragment.
  // Greedy composition still delegates both decisions to the native typesetter.
  let placements;
  if (request.mode === 'planned-lines-proof') {
    placements = new Map();
    let start = 0;
    for (const placement of request.placements || []) {
      placements.set(start, placement);
      start = placement.end;
    }
  }
  for (const shape of shapes) {
    if (!shape) continue;
    for (const source of sources) {
      const prior = source.paragraphs.get(shape.key);
      if (!prior) continue;
      for (const [offset, entry] of prior) {
        if (candidates.length === 4096) break;
        const line = entry.line;
        const start = shape.start + offset;
        const end = start + line.end - line.start;
        if (matches.has(start)) continue;
        if (placements) {
          const target = placements.get(start);
          if (
            !target ||
            target.end !== end ||
            target.width !== line.availableWidth ||
            target.left !== entry.left
          )
            continue;
        }
        matches.set(start, entry);
        candidates.push({
          start,
          end,
          availableWidth: line.availableWidth,
          originX: line.originX,
          width: line.width,
        });
      }
    }
  }
  return { shapes, matches, candidates };
}

function moveDetails(line, prior, from, to) {
  const previous = translations.get(prior);
  const origin = previous?.origin || prior;
  // Always translate from the original arrays, even across many successive
  // keystrokes. Offscreen lines consequently retain neither chains nor copies.
  const delta = (previous?.delta || 0) + to.start - from.start;
  const logical = (previous?.logical || 0) + to.logical - from.logical;
  let runs, carets;
  const moved = {
    ...line,
    get runs() {
      if (delta === 0 && logical === 0) return origin.runs;
      return (runs ??= origin.runs.map((run) => ({
        ...run,
        start: run.start + delta,
        end: run.end + delta,
        glyphs: run.glyphs.map((glyph) => ({
          ...glyph,
          index: glyph.index + delta,
          end: glyph.end + delta,
          sourceRanges: glyph.sourceRanges.map(([a, b]) => [a + logical, b + logical]),
        })),
      })));
    },
    get carets() {
      if (delta === 0 && logical === 0) return origin.carets;
      return (carets ??= origin.carets.map((caret) => ({
        ...caret,
        index: caret.index + delta,
        hitIndex: caret.hitIndex < 0 ? caret.hitIndex : caret.hitIndex + delta,
        logicalCandidates: caret.logicalCandidates.map((n) => n + logical),
      })));
    },
  };
  translations.set(moved, { origin, delta, logical });
  return moved;
}

function expandGeometry(result, request, shapes, matches) {
  if (
    result.sourceDigest !== request.sourceDigest ||
    !Array.isArray(result.layout?.lines) ||
    !Array.isArray(result.vectors)
  )
    throw Error('Incomplete native geometry response.');
  const paragraphs = new Map(),
    vectors = new Map(result.vectors.map((v) => [v.id, v]));
  let paragraphIndex = 0,
    reused = false;
  const expanded = result.layout.lines.map((header) => {
    while (
      paragraphIndex + 1 < shapes.length &&
      header.start >= request.paragraphs[paragraphIndex].end
    )
      paragraphIndex++;
    const shape = shapes[paragraphIndex],
      row = shape && { start: header.start, logical: shape.logical };
    let line = header;
    if (header.retainedGeometry) {
      const old = matches?.get(header.start);
      if (
        !old ||
        !row ||
        header.end - header.start !== old.line.end - old.line.start ||
        header.originX !== old.line.originX ||
        header.width !== old.line.width ||
        header.availableWidth !== old.line.availableWidth
      )
        throw Error('Retained glyph geometry disagrees with the native line.');
      line = moveDetails(header, old.line, old.row, row);
      reused = true;
      delete line.retainedGeometry;
      for (const id of vectorIds(originalLineGeometry(line))) {
        if (vectors.has(id)) continue;
        const vector = old.vectors.get(id);
        if (!vector) throw Error('Retained glyph outline missing.');
        vectors.set(id, vector);
      }
    }
    if (shape) {
      let lines = paragraphs.get(shape.key);
      if (!lines) paragraphs.set(shape.key, (lines = new Map()));
      lines.set(header.start - shape.start, {
        row,
        line,
        vectors,
        left: request.placements?.[header.placementIndex]?.left,
      });
    }
    return line;
  });
  return {
    paragraphs,
    vectors,
    result: reused
      ? {
          ...result,
          layout: { ...result.layout, lines: expanded },
          vectors: [...vectors.keys()].sort().map((id) => vectors.get(id)),
        }
      : result,
  };
}

/** The editor may reuse exact detail arrays from its last completed composition.
 * Every request still measures and freezes the current native lines for PDF.
 */
export function createInteractiveTextPort(port) {
  if (!port) return port;
  let displayed, lastComposed;
  const registered = new WeakSet();
  // Electron can carry a single verified string across the isolation boundary.
  // Parse it here so thousands of glyph objects are built in their final realm.
  const compose = port.composePacket
    ? async (request) => JSON.parse(await port.composePacket(request)).result
    : (request) => port.compose(request);
  async function send(request) {
    const resources = request.resources.map((resource) => {
      if (!registered.has(resource)) return resource;
      const { data: _data, ...identity } = resource;
      return identity;
    });
    let result;
    try {
      result = await compose({ ...request, resources });
    } catch (error) {
      if (
        !resources.some((resource, i) => resource !== request.resources[i]) ||
        !/not registered|must be registered|font cache expired/i.test(error.message)
      )
        throw error;
      result = await compose(request);
    }
    for (const resource of request.resources) registered.add(resource);
    return result;
  }
  return {
    ...port,
    async compose(request) {
      if (
        !['planned-lines-proof', 'greedy-geometry-proof'].includes(request.mode) ||
        request.allowFallback ||
        !request.includeVectors ||
        !request.paragraphs?.length ||
        request.protocol < 2
      )
        return send(request);
      const sources = [];
      const planned = request.mode === 'planned-lines-proof';
      for (const layout of [displayed, planned ? lastComposed : null]) {
        if (layout?.id === request.id && layout.mode === request.mode && !sources.includes(layout))
          sources.push(layout);
      }
      const { shapes, matches, candidates } = geometryCandidates(request, sources);
      const result = await send(
        candidates.length ? { ...request, retainedLines: candidates } : request,
      );
      let snapshot;
      try {
        snapshot = expandGeometry(result, request, shapes, matches);
      } catch (error) {
        if (!candidates.length) throw error;
        snapshot = expandGeometry(await send(request), request, shapes, null);
      }
      const { result: expanded, ...cache } = snapshot;
      const layout = (expanded.diagnostics || []).some((d) => d !== 'overset')
        ? null
        : { id: request.id, mode: request.mode, ...cache };
      lastComposed = layout;
      displayed = layout;
      if (layout)
        rememberedLayouts.set(expanded, () => {
          displayed = layout;
        });
      return expanded;
    },
  };
}
