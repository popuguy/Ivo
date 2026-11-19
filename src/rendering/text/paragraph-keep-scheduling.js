import { UnsupportedComposition } from './composition-source.js';

const capacity = () => {
  throw new UnsupportedComposition('paragraph keep scheduling beyond planned frame capacity');
};
const fits = (result) => result.status === 'fit';

// One physical row can have several source fragments on either side of artwork.
function tailStart(lines) {
  let index = lines.length - 1;
  while (index > 0 && lines[index].continuesRow) index--;
  return index;
}

function firstRowEnd(lines) {
  let index = 0;
  while (lines[index + 1]?.continuesRow) index++;
  return lines[index].end;
}

/** Resolve joins against the following paragraph's actual placement, including
 * its own All rule. Refit just the connected suffix when a join crosses a column.
 * Each new fit consumes the frame scheduler's shared work allowance. */
export async function scheduleParagraphKeeps(paragraphs, { fit, actualFrameCount, frameCount }) {
  const plans = [];
  let cursor = { frame: 0, baseline: null },
    prefix = [];
  const violation = (paragraphIndex, kind, frame, start, end, reason) => ({
    paragraphIndex,
    start,
    end,
    kind,
    frame,
    future: frame >= actualFrameCount,
    reason,
  });
  async function together(paragraph, index, incoming, after) {
    const current = await fit(paragraph, {
      cursor: incoming,
      previousAfter: after,
      onlyFrame: incoming.frame,
      role: 'all-current',
    });
    if (fits(current)) return { plan: current, violations: [] };
    const empty =
      incoming.baseline === null ? incoming : { frame: incoming.frame + 1, baseline: null };
    if (empty.frame >= frameCount) capacity();
    const ordinary = await fit(paragraph, {
      cursor: empty,
      previousAfter: 0,
      role: 'all-distributed',
    });
    if (!fits(ordinary)) capacity();
    const frame = ordinary.lines[0].frame;
    // The initial empty column may have been unusable (width/metrics). Inspect
    // its first usable successor, not an arbitrary later column that fits All.
    if (incoming.baseline !== null || frame !== incoming.frame) {
      const intact = await fit(paragraph, {
        cursor: { frame, baseline: null },
        previousAfter: 0,
        onlyFrame: frame,
        role: 'all-empty',
      });
      if (fits(intact)) return { plan: intact, violations: [] };
    }
    return {
      plan: ordinary,
      violations: [
        violation(
          index,
          'keepTogether',
          frame,
          paragraph.start,
          paragraph.start + paragraph.text.length,
          'empty-column-capacity',
        ),
      ],
    };
  }

  for (let index = 0; index < paragraphs.length;) {
    const paragraph = paragraphs[index];
    const previousAfter =
      cursor.baseline === null ? 0 : paragraphs[index - 1].layout.paragraphAfter;
    const current = paragraph.keep.keepTogether
      ? await together(paragraph, index, cursor, previousAfter)
      : {
          plan: await fit(paragraph, {
            cursor,
            previousAfter,
            sourceStart: prefix.at(-1)?.end ?? 0,
            role: prefix.length ? 'next-tail' : 'ordinary',
          }),
          violations: [],
        };
    if (!fits(current.plan)) capacity();
    const rows = prefix.length ? [...prefix, ...current.plan.lines] : current.plan.lines;
    prefix = [];
    const previous = plans[index - 1];
    if (
      previous &&
      paragraphs[index - 1].keep.keepWithNext &&
      previous.lines.at(-1).frame !== rows[0].frame &&
      !previous.brokenJoin
    ) {
      const frame = previous.lines.at(-1).frame;
      // A multi-row paragraph connects just its last row, unless All binds its
      // other rows too. Walk farther back only across an intact incoming join.
      let first = index - 1,
        row;
      for (;;) {
        const prior = plans[first];
        row = paragraphs[first].keep.keepTogether ? 0 : tailStart(prior.lines);
        if (
          row ||
          first === 0 ||
          prior.lines[0].frame !== frame ||
          !paragraphs[first - 1].keep.keepWithNext ||
          plans[first - 1].brokenJoin ||
          plans[first - 1].lines.at(-1).frame !== frame
        )
          break;
        first--;
      }
      const group = plans[first],
        beforeGroup = row ? group.lines[row - 1] : plans[first - 1]?.lines.at(-1);
      // A group already at an empty column cannot move forward indefinitely.
      // An oversized All retains its distributed placement and priority.
      if (group.lines[row].frame === frame && beforeGroup?.frame === frame) {
        prefix = group.lines.slice(0, row);
        plans.length = first;
        index = first;
        cursor = { frame: frame + 1, baseline: null };
        if (cursor.frame >= frameCount) capacity();
        continue;
      }
      previous.brokenJoin = true;
      previous.violations.push(
        violation(
          index - 1,
          'keepWithNext',
          frame,
          paragraphs[index - 1].start + previous.lines[tailStart(previous.lines)].start,
          paragraph.start + firstRowEnd(rows),
          paragraphs[index - 1].keep.keepTogether ? 'all-priority' : 'empty-column-capacity',
        ),
      );
    }
    plans.push({ lines: rows, violations: current.violations, brokenJoin: false });
    cursor = current.plan.cursor;
    index++;
  }
  return {
    lines: plans.flatMap(({ lines }, index) =>
      lines.map((line) => ({
        ...line,
        start: paragraphs[index].start + line.start,
        end: paragraphs[index].start + line.end,
      })),
    ),
    cursor,
    keepViolations: plans.flatMap((plan) => plan.violations),
  };
}
