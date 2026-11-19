const geometryOrigins = new WeakMap();
export const glyphGeometryIdentity = (runs) => geometryOrigins.get(runs) || runs;

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
    key: JSON.stringify([request.protocol, text, settings, runs, fonts, mapping]),
  };
}

// Predict reusable rows without prescribing line breaks to either composer.
function geometryCandidates(request, previous) {
  const fonts = request.resources.map(({ id, digest, postscript }) => [id, digest, postscript]);
  const shapes = request.paragraphs.map((paragraph) => paragraphShape(request, paragraph, fonts));
  const matches = new Map(),
    candidates = [];
  for (const shape of shapes) {
    const prior = shape && previous?.paragraphs.get(shape.key);
    if (!prior) continue;
    for (const [offset, entry] of prior) {
      if (candidates.length === 4096) break;
      const line = entry.line,
        start = shape.start + offset,
        end = start + line.end - line.start;
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
  return { shapes, matches, candidates };
}

function moveDetails(line, prior, from, to) {
  const delta = to.start - from.start,
    logical = to.logical - from.logical;
  if (delta === 0 && logical === 0) return { ...line, runs: prior.runs, carets: prior.carets };
  return {
    ...line,
    runs: prior.runs.map((run) => ({
      ...run,
      start: run.start + delta,
      end: run.end + delta,
      glyphs: run.glyphs.map((glyph) => ({
        ...glyph,
        index: glyph.index + delta,
        end: glyph.end + delta,
        sourceRanges: glyph.sourceRanges.map(([a, b]) => [a + logical, b + logical]),
      })),
    })),
    carets: prior.carets.map((caret) => ({
      ...caret,
      index: caret.index + delta,
      hitIndex: caret.hitIndex < 0 ? caret.hitIndex : caret.hitIndex + delta,
      logicalCandidates: caret.logicalCandidates.map((n) => n + logical),
    })),
  };
}

function expandGeometry(result, request, shapes, matches, base) {
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
      if (line.runs !== old.line.runs)
        geometryOrigins.set(line.runs, glyphGeometryIdentity(old.line.runs));
      for (const run of line.runs)
        for (const glyph of run.glyphs)
          if (glyph.vector && !vectors.has(glyph.vector)) {
            const vector = base.vectors.get(glyph.vector);
            if (!vector) throw Error('Retained glyph outline missing.');
            vectors.set(vector.id, vector);
          }
    }
    if (shape) {
      let lines = paragraphs.get(shape.key);
      if (!lines) paragraphs.set(shape.key, (lines = new Map()));
      lines.set(header.start - shape.start, { row, line });
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
  let previous;
  const registered = new WeakSet();
  async function send(request) {
    const resources = request.resources.map((resource) => {
      if (!registered.has(resource)) return resource;
      const { data: _data, ...identity } = resource;
      return identity;
    });
    let result;
    try {
      result = await port.compose({ ...request, resources });
    } catch (error) {
      if (
        !resources.some((resource, i) => resource !== request.resources[i]) ||
        !/not registered|must be registered|font cache expired/i.test(error.message)
      )
        throw error;
      result = await port.compose(request);
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
      const base = previous?.id === request.id && previous.mode === request.mode ? previous : null;
      const { shapes, matches, candidates } = geometryCandidates(request, base);
      const result = await send(
        candidates.length ? { ...request, retainedLines: candidates } : request,
      );
      let snapshot;
      try {
        snapshot = expandGeometry(result, request, shapes, matches, base);
      } catch (error) {
        if (!candidates.length) throw error;
        snapshot = expandGeometry(await send(request), request, shapes, null, null);
      }
      const { result: expanded, ...cache } = snapshot;
      previous = (expanded.diagnostics || []).some((d) => d !== 'overset')
        ? null
        : { id: request.id, mode: request.mode, ...cache };
      return expanded;
    },
  };
}
