import {
  lastPhysicalRow,
  fitSplitParagraph,
  protectedParagraphTail,
  splitLineViolations,
} from './paragraph-split-lines.js';
import { paragraphStartColumn } from './paragraph-start-locations.js';
import { UnsupportedComposition } from './composition-source.js';

const capacity = () => {
  throw new UnsupportedComposition('paragraph keep scheduling beyond planned frame capacity');
};
const fits = (result) => result.status === 'fit';

function joinedRowCount(previous, current) {
  return previous?.keepWithNext ? (previous.keepNextLines ?? 1) : current.keepWithPrevious ? 1 : 0;
}

// Count source rows, including blanks. All fragments of the last requested row
// belong to the join, even when an illustration splits the row into pieces.
function prefixLastFragment(lines, count) {
  let index = 0;
  while (index + 1 < lines.length) {
    if (!lines[index + 1].continuesRow && --count === 0) break;
    index++;
  }
  return index;
}

/** Resolve joins against the following paragraph's actual placement, including
 * its own All rule. Refit just the connected suffix when a join crosses a column.
 * Each new fit consumes the frame scheduler's shared work allowance. */
export async function scheduleParagraphKeeps(
  paragraphs,
  { fit, actualFrameCount, frameCount, startLocations },
) {
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
    const previous = plans[index - 1];
    if (paragraph.keep.paragraphStart && !prefix.length) {
      const target = paragraphStartColumn(
        paragraph.keep.paragraphStart,
        startLocations,
        previous?.lines.at(-1).frame,
        cursor.frame,
      );
      if (target >= frameCount) capacity();
      if (previous || target !== cursor.frame) cursor = { frame: target, baseline: null };
    }
    const previousAfter =
      cursor.baseline === null ? 0 : paragraphs[index - 1].layout.paragraphAfter;
    const split = paragraph.keep.keepBoundaryLines && !paragraph.keep.keepTogether;
    const current = paragraph.keep.keepTogether
      ? await together(paragraph, index, cursor, previousAfter)
      : split
        ? {
            plan: await fitSplitParagraph(paragraph, { fit, cursor, previousAfter, prefix }),
            violations: [],
          }
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
    const rows = prefix.length && !split ? [...prefix, ...current.plan.lines] : current.plan.lines;
    prefix = [];
    const required = joinedRowCount(paragraphs[index - 1]?.keep, paragraph.keep);
    // A forced start wins over an incoming join. Do not repeatedly move its predecessor.
    if (previous && required && paragraph.keep.paragraphStart) previous.brokenJoin = true;
    const joinEnd = required ? prefixLastFragment(rows, required) : 0;
    if (
      previous &&
      required &&
      previous.lines.at(-1).frame !== rows[joinEnd].frame &&
      !previous.brokenJoin
    ) {
      const frame = previous.lines.at(-1).frame;
      // A multi-row paragraph connects just its last row, unless All binds its
      // other rows too. Walk farther back only across an intact incoming join.
      let first = index - 1,
        row;
      for (;;) {
        const prior = plans[first];
        row = protectedParagraphTail(prior.lines, paragraphs[first].keep);
        const incomingCount = joinedRowCount(paragraphs[first - 1]?.keep, paragraphs[first].keep);
        if (
          first === 0 ||
          !incomingCount ||
          prior.lines[0].frame !== frame ||
          plans[first - 1].brokenJoin ||
          plans[first - 1].lines.at(-1).frame !== frame ||
          row > prefixLastFragment(prior.lines, incomingCount)
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
    }
    plans.push({ lines: rows, violations: current.violations, brokenJoin: false });
    cursor = current.plan.cursor;
    index++;
  }
  // Replaying a later suffix may retain the earlier rows of its paragraph.
  // Report each broken incoming or outgoing join from its final placement.
  for (let index = 1; index < plans.length; index++) {
    const previous = plans[index - 1],
      current = plans[index];
    const preceding = paragraphs[index - 1],
      paragraph = paragraphs[index];
    const count = joinedRowCount(preceding.keep, paragraph.keep);
    if (!count) continue;
    const frame = previous.lines.at(-1).frame;
    const last = current.lines[prefixLastFragment(current.lines, count)];
    if (last.frame === frame) continue;
    const start = preceding.start + previous.lines[lastPhysicalRow(previous.lines)].start;
    const reason = paragraph.keep.paragraphStart
      ? 'paragraph-start'
      : preceding.keep.keepTogether
        ? 'all-priority'
        : 'empty-column-capacity';
    if (preceding.keep.keepWithNext)
      previous.violations.push(
        violation(index - 1, 'keepWithNext', frame, start, paragraph.start + last.end, reason),
      );
    if (paragraph.keep.keepWithPrevious && current.lines[0].frame !== frame) {
      const first = current.lines[prefixLastFragment(current.lines, 1)];
      current.violations.push(
        violation(
          index,
          'keepWithPrevious',
          first.frame,
          start,
          paragraph.start + first.end,
          reason,
        ),
      );
    }
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
    keepViolations: plans.flatMap((plan, i) => [
      ...plan.violations,
      ...splitLineViolations(plan.lines, paragraphs[i].keep).map((v) =>
        violation(
          i,
          v.kind,
          v.frame,
          paragraphs[i].start + v.start,
          paragraphs[i].start + v.end,
          'empty-column-capacity',
        ),
      ),
    ]),
  };
}
