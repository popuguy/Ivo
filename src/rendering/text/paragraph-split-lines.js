// A contour can produce two source fragments on one physical baseline.
function rowStarts(lines) {
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (!lines[i].continuesRow) starts.push(i);
  return starts;
}

export function lastPhysicalRow(lines) {
  let index = lines.length - 1;
  while (index > 0 && lines[index].continuesRow) index--;
  return index;
}

export function protectedParagraphTail(lines, keep) {
  if (keep.keepTogether) return 0;
  if (!keep.keepBoundaryLines) return lastPhysicalRow(lines);
  const starts = rowStarts(lines);
  const index = Math.max(0, starts.length - keep.widows);
  return index < keep.orphans ? 0 : starts[index];
}

/** Adjust the first and last row groups against real column geometry. Reuse the
 * portion already placed, then measure its suffix again at the destination width. */
export async function fitSplitParagraph(paragraph, { fit, cursor, previousAfter, prefix }) {
  const { orphans, widows } = paragraph.keep;
  const fitFrom = (retained, destination) =>
    fit(paragraph, {
      cursor: destination,
      previousAfter: retained.length || destination.baseline === null ? 0 : previousAfter,
      sourceStart: retained.at(-1)?.end ?? 0,
      role: 'split-lines',
    });
  let plan = await fitFrom(prefix, cursor);
  if (plan.status === 'overset') return { ...plan, lines: [...prefix, ...plan.lines] };
  if (plan.status !== 'fit') return plan;
  let lines = [...prefix, ...plan.lines],
    firstUnprocessed = prefix.length;
  let starts = rowStarts(lines),
    first = 0;
  while (
    first + 1 < starts.length &&
    starts[first + 1] <= firstUnprocessed &&
    lines[starts[first]].frame !== lines[firstUnprocessed]?.frame
  )
    first++;
  while (firstUnprocessed < lines.length) {
    const frame = lines[firstUnprocessed].frame;
    let boundary = firstUnprocessed + 1;
    while (boundary < lines.length && lines[boundary].frame === frame) boundary++;
    if (boundary === lines.length) break;
    let next = first;
    while (next < starts.length && starts[next] < boundary) next++;
    const shortFirst = first === 0 && next < orphans;
    const shortEnd = starts.length - next < widows;
    if (shortFirst || shortEnd) {
      const atOccupiedStart =
        first === 0 && cursor.frame === frame && cursor.baseline !== null && !prefix.length;
      // Try the latest movable source row first. Unequal column widths can
      // change how many rows it becomes, even for the same source suffix.
      let cut = shortFirst ? 0 : next - 1;
      while (cut >= first) {
        if (first === 0 && cut < orphans) cut = 0;
        if ((cut === first && !atOccupiedStart) || starts[cut] < prefix.length) break;
        const retained = lines.slice(0, starts[cut]);
        const trial = await fitFrom(retained, { frame: frame + 1, baseline: null });
        if (trial.status !== 'fit') break;
        if (cut === 0 || rowStarts(trial.lines).length >= widows) {
          lines = [...retained, ...trial.lines];
          plan = trial;
          boundary = retained.length;
          starts = rowStarts(lines);
          next = cut;
          break;
        }
        cut--;
      }
    }
    firstUnprocessed = boundary;
    first = next;
  }
  return { ...plan, lines };
}

export function splitLineViolations(lines, keep) {
  if (!keep.keepBoundaryLines || keep.keepTogether || lines[0].frame === lines.at(-1).frame)
    return [];
  const starts = rowStarts(lines);
  const spans = [];
  for (const [kind, frame, minimum] of [
    ['orphans', lines[0].frame, keep.orphans],
    ['widows', lines.at(-1).frame, keep.widows],
  ]) {
    const group = starts.filter((i) => lines[i].frame === frame);
    if (group.length < minimum) {
      const end = lines.findLast((line) => line.frame === frame).end;
      spans.push({ kind, frame, start: lines[group[0]].start, end });
    }
  }
  return spans;
}
