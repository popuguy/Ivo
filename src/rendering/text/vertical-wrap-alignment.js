export function verticalJustificationSpacing(space, gaps, boundaries, limit) {
  const paragraph = boundaries ? Math.min(limit, space / boundaries) : 0;
  return { paragraph, line: Math.max(0, space - boundaries * paragraph) / gaps };
}

// A line's available width can change as its baseline moves. Refit through
// the same paragraph and keep scheduler used for editing and publication.
// Only accept plans that retain the source already fitting in these columns.
export async function alignWrappedColumns(columns, initial, paragraphStarts, recompose) {
  let selected = initial;
  const adjustments = [];
  const tolerance = 1 / 32;
  for (const [index, column] of columns.entries()) {
    if (
      !column.obstacles?.length ||
      !['center', 'bottom', 'justify'].includes(column.verticalAlign)
    )
      continue;
    const own = selected.lines.filter((line) => line.frame === index);
    if (!own.length) continue;
    const justify = column.verticalAlign === 'justify';
    let gaps = 1,
      boundaries = 0;
    if (justify) {
      const followingRows = own.filter((line, i) => i > 0 && line.baseline !== own[i - 1].baseline);
      gaps = followingRows.length;
      if (!gaps) continue;
      boundaries = followingRows.filter((line) => paragraphStarts.has(line.start)).length;
    }
    const retainedEnds = new Map();
    for (const line of selected.lines) {
      if (line.frame > index) break;
      retainedEnds.set(line.frame, line.end);
    }
    const bottom = justify || column.verticalAlign === 'bottom';
    const target = (first, last) =>
      bottom
        ? column.height - last.baseline
        : (column.height - last.baseline - (first.baseline - first.firstBaselineOffset)) / 2;
    let lower = 0,
      upper = column.height,
      bestAdjustment;
    let bestError = Math.abs(target(own[0], own.at(-1)));
    let trial = Math.min(upper, bestError / gaps);
    for (let i = 0; i < 20 && bestError > tolerance && upper - lower > tolerance; i++) {
      if (trial <= lower || trial >= upper) trial = (lower + upper) / 2;
      adjustments[index] = justify
        ? {
            spacing: verticalJustificationSpacing(
              trial * gaps,
              gaps,
              boundaries,
              column.paragraphSpacingLimit ?? 0,
            ),
          }
        : { offset: trial };
      if (i > 0 && i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      const plan = await recompose(adjustments);
      const ends = new Map();
      let first,
        last,
        rowGaps = 0,
        paragraphGaps = 0;
      for (const line of plan?.lines ?? []) {
        if (line.frame > index) break;
        ends.set(line.frame, line.end);
        if (line.frame === index) {
          if (last && line.baseline !== last.baseline) {
            rowGaps++;
            if (paragraphStarts.has(line.start)) paragraphGaps++;
          }
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
        bestAdjustment = adjustments[index];
        selected = plan;
      }
      if (adjustment > 0) lower = trial;
      else upper = trial;
      if (justify) {
        gaps = Math.max(1, rowGaps);
        boundaries = paragraphGaps;
      }
      trial += adjustment / gaps;
      if (trial <= lower || trial >= upper) trial = (lower + upper) / 2;
    }
    adjustments[index] = bestAdjustment;
  }
  return selected;
}
