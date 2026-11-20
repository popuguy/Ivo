// A line's available width can change as its baseline moves. Refit through
// the same paragraph and keep scheduler used for editing and publication.
// Only accept plans that retain the source already fitting in these columns.
export async function alignWrappedColumns(columns, initial, recompose) {
  let selected = initial;
  const alignmentOffsets = [];
  const tolerance = 1 / 32;
  for (const [index, column] of columns.entries()) {
    if (!column.obstacles?.length || !['center', 'bottom'].includes(column.verticalAlign)) continue;
    const own = selected.lines.filter((line) => line.frame === index);
    if (!own.length) continue;
    const retainedEnds = new Map();
    for (const line of selected.lines) {
      if (line.frame > index) break;
      retainedEnds.set(line.frame, line.end);
    }
    const bottom = column.verticalAlign === 'bottom';
    const target = (first, last) =>
      bottom
        ? column.height - last.baseline
        : (column.height - last.baseline - (first.baseline - first.firstBaselineOffset)) / 2;
    let lower = 0,
      upper = column.height,
      bestOffset = 0;
    let bestError = Math.abs(target(own[0], own.at(-1)));
    let trial = Math.min(upper, bestError);
    for (let i = 0; i < 20 && bestError > tolerance && upper - lower > tolerance; i++) {
      if (trial <= lower || trial >= upper) trial = (lower + upper) / 2;
      alignmentOffsets[index] = trial;
      if (i > 0 && i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      const plan = await recompose(alignmentOffsets);
      const ends = new Map();
      let first, last;
      for (const line of plan?.lines ?? []) {
        if (line.frame > index) break;
        ends.set(line.frame, line.end);
        if (line.frame === index) {
          first ??= line;
          last = line;
        }
      }
      if (!last || [...retainedEnds].some(([frame, end]) => (ends.get(frame) ?? -1) < end)) {
        upper = trial;
        trial = (lower + upper) / 2;
        continue;
      }
      const adjustment = target(first, last);
      if (Math.abs(adjustment) < bestError) {
        bestError = Math.abs(adjustment);
        bestOffset = trial;
        selected = plan;
      }
      if (adjustment > 0) lower = trial;
      else upper = trial;
      trial += adjustment;
      if (trial <= lower || trial >= upper) trial = (lower + upper) / 2;
    }
    alignmentOffsets[index] = bestOffset;
  }
  return selected;
}
