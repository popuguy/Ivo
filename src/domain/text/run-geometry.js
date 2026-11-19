const finite = (value) => Number.isFinite(value);

/** Visual advance extent, independent of source order and glyph direction. */
export function runExtent(run) {
  let min = Infinity,
    max = -Infinity;
  for (const glyph of run.glyphs || []) {
    const a = glyph.position[0],
      b = a + glyph.advance[0];
    for (const value of [a, b])
      if (finite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
  }
  return min === Infinity ? null : { min, max };
}

/** Select a measured caret belonging to this visual run. At bidi boundaries,
 * the run edge chooses the appropriate primary/secondary offset. Only run ends
 * may fall back to the native advance extent; interior stops are never guessed.
 * Callers painting many spans may provide precomputed extent/caret indexes. */
export function runCaret(line, run, index, { extent = runExtent(run), carets } = {}) {
  const caret = carets ? carets.get(index) : line.carets?.find((value) => value.index === index);
  if (!extent) return null;
  const edge =
    index === run.start || index === run.end
      ? (index === run.start ? run.rtl : !run.rtl)
        ? extent.max
        : extent.min
      : null;
  if (!caret) return edge === null ? null : { x: edge, measurement: 'native-run-extent' };
  const options = [...new Set([caret.primary, caret.secondary])].filter(
    (value) => finite(value) && value >= extent.min - 0.01 && value <= extent.max + 0.01,
  );
  if (!options.length) return null;
  return {
    x:
      edge !== null
        ? options.sort((a, b) => Math.abs(a - edge) - Math.abs(b - edge))[0]
        : options.includes(caret.primary)
          ? caret.primary
          : options[0],
    measurement: 'native-run-carets',
  };
}
