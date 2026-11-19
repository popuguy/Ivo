import { UnsupportedComposition } from './composition-source.js';

const capacity = () => {
  throw new UnsupportedComposition('paragraph keep scheduling beyond planned frame capacity');
};
const fits = (result) => result.status === 'fit';

/** All and boolean Next1, constrained by measured physical columns. fit() owns
 * scheduling/cache/budgets and may return only fit or a genuine geometric nonfit.
 * Budget failures throw before arriving here and can never justify relaxation. */
export async function scheduleParagraphKeeps(paragraphs, { fit, actualFrameCount, frameCount }) {
  const lines = [],
    keepViolations = [];
  let cursor = { frame: 0, baseline: null },
    previousAfter = 0;
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

  for (const [index, paragraph] of paragraphs.entries()) {
    let own = paragraph.keep.keepTogether
      ? await together(paragraph, index, cursor, previousAfter)
      : { plan: await fit(paragraph, { cursor, previousAfter, role: 'ordinary' }), violations: [] };
    if (!fits(own.plan)) capacity();
    if (paragraph.keep.keepWithNext && paragraphs[index + 1]) {
      const following = paragraphs[index + 1];
      for (let attempt = 0; attempt < frameCount; attempt++) {
        const tail = own.plan.lines.at(-1),
          next = await fit(following, {
            cursor: own.plan.cursor,
            previousAfter: paragraph.layout.paragraphAfter,
            role: 'next-probe',
          });
        if (!fits(next)) capacity();
        if (next.lines[0].frame === tail.frame) break;
        const all = paragraph.keep.keepTogether,
          group = all ? own.plan.lines[0] : tail,
          prefix = all ? [] : own.plan.lines.slice(0, -1),
          occupied =
            lines.some((line) => line.frame === group.frame) ||
            prefix.some((line) => line.frame === group.frame);
        if (!occupied || (all && own.violations.length)) {
          own.violations.push(
            violation(
              index,
              'keepWithNext',
              tail.frame,
              paragraph.start + tail.start,
              following.start + next.lines[0].end,
              all ? 'all-priority' : 'empty-column-capacity',
            ),
          );
          break;
        }
        const incoming = { frame: group.frame + 1, baseline: null };
        if (incoming.frame >= frameCount) capacity();
        if (all) own = await together(paragraph, index, incoming, 0);
        else {
          const suffix = await fit(paragraph, {
            cursor: incoming,
            sourceStart: tail.start,
            previousAfter: 0,
            role: 'next-tail',
          });
          if (!fits(suffix)) capacity();
          const joined = [...prefix, ...suffix.lines];
          own = {
            plan: {
              ...suffix,
              lines: joined,
              cost: joined.reduce((sum, line) => sum + line.cost, 0),
            },
            violations: own.violations,
          };
        }
        if (attempt === frameCount - 1) capacity();
      }
    }
    lines.push(
      ...own.plan.lines.map((line) => ({
        ...line,
        start: line.start + paragraph.start,
        end: line.end + paragraph.start,
      })),
    );
    keepViolations.push(...own.violations);
    cursor = { ...own.plan.cursor };
    previousAfter = paragraph.layout.paragraphAfter;
  }
  return { lines, cursor, keepViolations };
}
