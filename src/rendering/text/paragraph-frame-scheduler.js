import { retainedHyphenCount } from '../../domain/text/line-hyphenation.js';
import { hasAuthoredBreakCharacters } from '../../domain/text/paragraph-breaks.js';
import { paragraphFlowSteps } from '../../domain/text/paragraph-flow.js';
import { wrappedParagraphFlowSteps } from '../../domain/text/wrapped-paragraph-flow.js';
import { UnsupportedComposition } from './composition-source.js';
import { paragraphStartLocations } from './paragraph-start-locations.js';
import { scheduleParagraphKeeps } from './paragraph-keep-scheduling.js';
import { WORD_SPACING_COST_POLICY } from '../../domain/text/word-spacing-adjustment.js';

const MAX_LINES = 2048;
const frameShape = (column) => ({
  width: column.width,
  height: column.height,
  firstBaseline: column.firstBaseline || 'ascent',
  minimumFirstBaseline: column.minimumFirstBaseline || 0,
  verticalAlign: column.verticalAlign || 'top',
  ...(column.obstacles ? { obstacles: column.obstacles } : {}),
});

/** Coordinates disposable fitting, caches, work limits and final presentation.
 * Keep policy never enters native shaping or canonical document storage here. */
export async function fitFrameParagraphs(
  paragraphs,
  actualColumns,
  work,
  rememberDecision,
  mode,
  { states: maxStates = 100000, candidates: maxCandidates = 1000000 } = {},
) {
  const columns = actualColumns.map(frameShape),
    wrapped = columns.some((column) => column.obstacles?.length);
  while (columns.length < 128) columns.push({ ...columns.at(-1), obstacles: [] });
  const columnKey = JSON.stringify(actualColumns.map(frameShape));
  let states = 0,
    candidates = 0,
    fitProbes = 0,
    keepProbes = 0;
  const failed = (reason) => {
    const error = new UnsupportedComposition('paragraph frame fitting (' + reason + ')');
    error.work = { ...work, states, candidates, fitProbes, keepProbes };
    throw error;
  };
  const fit = async (
    paragraph,
    {
      cursor,
      previousAfter = 0,
      sourceStart = 0,
      retainedLines = [],
      onlyFrame,
      role = 'ordinary',
    },
  ) => {
    fitProbes++;
    if (role !== 'ordinary') keepProbes++;
    if (states >= maxStates || candidates >= maxCandidates) failed('flow decision budget');
    if (cursor.frame >= columns.length)
      return { status: 'unfit', reason: 'no-feasible-path', states: 0, candidates: 0 };
    const priorHyphens =
      retainedLines.length && paragraph.automatic?.length
        ? retainedHyphenCount(
            retainedLines,
            new Set(
              paragraph.opportunities
                .filter((p) => p.automatic || p.authoredHyphen)
                .map((p) => p.index),
            ),
            paragraph.hyphenation.hyphenLimit,
          )
        : 0;
    const entry = paragraph.entry,
      layout = sourceStart
        ? { ...paragraph.layout, firstLineIndent: 0, paragraphBefore: 0 }
        : paragraph.layout,
      key =
        'flow:' +
        JSON.stringify([
          mode,
          columnKey,
          layout,
          cursor,
          previousAfter,
          sourceStart,
          onlyFrame ?? null,
          paragraph.keep,
          paragraph.hyphenation,
          priorHyphens,
          ...(paragraph.wordSpacing ? [paragraph.wordSpacing, WORD_SPACING_COST_POLICY] : []),
        ]),
      ownColumns = onlyFrame === undefined ? columns : columns.slice(0, onlyFrame + 1);
    let chosen = entry.decisions.get(key);
    if (chosen) work.reusedDecisions++;
    else {
      const steps = (wrapped ? wrappedParagraphFlowSteps : paragraphFlowSteps)({
        start: sourceStart,
        end: paragraph.text.length,
        opportunities: paragraph.opportunities.filter((point) => point.index >= sourceStart),
        measurements: sourceStart
          ? entry.measurements.filter((row) => row.start >= sourceStart)
          : entry.measurements,
        columns: ownColumns,
        layout,
        cursor,
        previousAfter,
        mode,
        hyphenation: paragraph.hyphenation,
        priorHyphens,
        retainOversetPrefix:
          (paragraph.hasNoBreak ||
            paragraph.automatic?.length ||
            hasAuthoredBreakCharacters(paragraph.text)) &&
          onlyFrame === undefined,
        maxStates: maxStates - states,
        maxCandidates: maxCandidates - candidates,
        ...(paragraph.wordSpacing ? { wordSpacing: paragraph.wordSpacing } : {}),
      });
      let step = steps.next();
      while (!step.done) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        step = steps.next();
      }
      chosen = step.value;
      if (!['state-budget', 'candidate-budget'].includes(chosen.reason))
        rememberDecision(entry, key, chosen);
    }
    // A cache hit costs the same logical budget as the original search, including
    // rejected All probes. A warm request cannot bypass whole-flow admission.
    states += chosen.states;
    candidates += chosen.candidates;
    if (states > maxStates || candidates > maxCandidates) failed('flow decision budget');
    if (
      chosen.status === 'unfit' &&
      !['no-feasible-path', 'no-feasible-line'].includes(chosen.reason)
    )
      failed(chosen.reason);
    return chosen;
  };
  const scheduled = await scheduleParagraphKeeps(paragraphs, {
      fit,
      actualFrameCount: actualColumns.length,
      frameCount: columns.length,
      startLocations: paragraphs.some((p) => p.keep.paragraphStart)
        ? paragraphStartLocations(actualColumns, columns.length)
        : undefined,
    }),
    lines = scheduled.lines;
  if (lines.length > MAX_LINES) failed('flow line budget');
  // Cache rows remain top-aligned; only owned copies receive final translation.
  for (const [index, column] of columns.entries()) {
    const own = lines.filter((line) => line.frame === index);
    if (!own.length) continue;
    const last = own.at(-1),
      remaining = Math.max(0, column.height - last.baseline - last.descent),
      offset =
        column.verticalAlign === 'bottom'
          ? remaining
          : column.verticalAlign === 'center'
            ? remaining / 2
            : 0;
    if (offset) for (const line of own) line.baseline += offset;
  }
  return {
    ...(scheduled.oversetStart === undefined ? {} : { oversetStart: scheduled.oversetStart }),
    breaks: lines.map((line) => line.end),
    placements: lines.map(({ end, frame, baseline, left, width }) => ({
      end,
      frame,
      baseline,
      left,
      width,
    })),
    policy: paragraphs.some((paragraph) => paragraph.wordSpacing)
      ? mode === 'single-line'
        ? 'native-fragment-word-spacing-greedy-v1'
        : WORD_SPACING_COST_POLICY
      : mode === 'single-line'
        ? 'native-fragment-greedy-v1'
        : 'ragged-right-quadratic-v1',
    keepViolations: scheduled.keepViolations,
    ...(paragraphs.some((paragraph) => paragraph.wordSpacing)
      ? {
          wordSpacingPlan: lines.map((line) =>
            line.wordSpacing
              ? {
                  start: line.start,
                  end: line.end,
                  visibleWidth: line.wordSpacing.visibleWidth,
                  percentage: line.wordSpacing.percentage,
                  eligibleGaps: line.wordSpacing.eligibleGaps,
                  nominalSpaceWidth: line.wordSpacing.nominalSpaceWidth,
                  justified: line.wordSpacing.justified,
                  fallback: line.wordSpacing.fallback,
                }
              : null,
          ),
          wordSpacingDiagnostics: lines
            .filter((line) => line.wordSpacing?.diagnostic)
            .map((line) => ({
              ...line.wordSpacing.diagnostic,
              start: line.start,
              end: line.end,
              frame: line.frame,
              future: line.frame >= actualColumns.length,
            })),
        }
      : {}),
    work: { ...work, states, candidates, fitProbes, keepProbes },
  };
}
