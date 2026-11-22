import { alignWrappedColumns } from './vertical-wrap-alignment.js';
import { retainedHyphenCount } from '../../domain/text/line-hyphenation.js';
import { hasAuthoredBreakCharacters } from '../../domain/text/paragraph-breaks.js';
import { paragraphFlowSteps } from '../../domain/text/paragraph-flow.js';
import { createWrappedParagraphFitter } from '../../domain/text/wrapped-paragraph-flow.js';
import { UnsupportedComposition } from './composition-source.js';
import { paragraphStartLocations } from './paragraph-start-locations.js';
import { scheduleParagraphKeeps } from './paragraph-keep-scheduling.js';
import { wordSpacingCostPolicy } from '../../domain/text/word-spacing-adjustment.js';

const MAX_LINES = 2048;
// A complex contour has a checkpoint before every exclusion query. Limit
// uninterrupted geometry work while leaving room for input at high refresh rates.
const GEOMETRY_SLICE_MS = 2;
const frameShape = (column) => ({
  width: column.width,
  ...(column.grid ? { grid: column.grid } : {}),
  height: column.height,
  firstBaseline: column.firstBaseline || 'ascent',
  minimumFirstBaseline: column.minimumFirstBaseline || 0,
  verticalAlign: column.verticalAlign || 'top',
  ...(column.verticalAlign === 'justify'
    ? { paragraphSpacingLimit: column.paragraphSpacingLimit || 0 }
    : {}),
  ...(column.obstacles ? { obstacles: column.obstacles } : {}),
});

/** Coordinates disposable fitting, caches, work limits and final presentation.
 * Keep policy never enters native shaping or canonical document storage here. */
export async function fitFrameParagraphs(
  paragraphs,
  actualColumns,
  work,
  { identifyLayout, rememberDecision },
  mode,
  { states: maxStates = 100000, candidates: maxCandidates = 1000000 } = {},
) {
  const columns = actualColumns.map(frameShape),
    wrapped = columns.some((column) => column.obstacles?.length),
    columnKey = identifyLayout(columns);
  while (columns.length < 128) columns.push({ ...columns.at(-1), obstacles: [] });
  let fitSteps = wrapped ? createWrappedParagraphFitter() : paragraphFlowSteps;
  let lastYield = performance.now(),
    offsetKey = '',
    states = 0,
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
          offsetKey,
          layout,
          cursor,
          previousAfter,
          sourceStart,
          onlyFrame ?? null,
          paragraph.keep,
          paragraph.hyphenation,
          paragraph.baselineAlignment,
          priorHyphens,
          ...(paragraph.wordSpacing
            ? [paragraph.wordSpacing, wordSpacingCostPolicy(paragraph.wordSpacing)]
            : []),
        ]),
      ownColumns = onlyFrame === undefined ? columns : columns.slice(0, onlyFrame + 1);
    let chosen = entry.decisions.get(key);
    if (chosen) work.reusedDecisions++;
    else {
      const steps = fitSteps({
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
        baselineAlignment: paragraph.baselineAlignment,
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
        // A few cheap bands can share one task. Preparation and search retain
        // their existing work checkpoints even when the clock barely advances.
        if (step.value.stage !== 'geometry' || performance.now() - lastYield >= GEOMETRY_SLICE_MS) {
          if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
          else await new Promise((resolve) => setTimeout(resolve, 0));
          lastYield = performance.now();
        }
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
  const schedule = () =>
    scheduleParagraphKeeps(paragraphs, {
      fit,
      actualFrameCount: actualColumns.length,
      frameCount: columns.length,
      startLocations: paragraphs.some((p) => p.keep.paragraphStart)
        ? paragraphStartLocations(actualColumns, columns.length)
        : undefined,
    });
  const initial = await schedule();
  const scheduled = await alignWrappedColumns(columns, initial, async (offsets) => {
    offsetKey = JSON.stringify(offsets);
    fitSteps = createWrappedParagraphFitter();
    for (const [index, offset] of offsets.entries()) columns[index].alignmentOffset = offset ?? 0;
    try {
      return await schedule();
    } catch (error) {
      // A lower starting position may strand a kept paragraph in the last column.
      if (
        error instanceof UnsupportedComposition &&
        error.feature === 'paragraph keep scheduling beyond planned frame capacity'
      )
        return null;
      throw error;
    }
  });
  const lines = scheduled.lines;
  if (lines.length > MAX_LINES) failed('flow line budget');
  const paragraphStarts = new Set(paragraphs.map((p) => p.start));
  const gridPolicies = new Map();
  if (actualColumns.some((column) => column.grid && column.verticalAlign !== 'top')) {
    let index = 0;
    for (const line of lines) {
      while (index + 1 < paragraphs.length && line.start >= paragraphs[index + 1].start) index++;
      gridPolicies.set(line, paragraphs[index].baselineAlignment);
    }
  }
  // Cache rows remain top-aligned; only owned copies receive final translation.
  for (const [index, column] of columns.entries()) {
    if (column.verticalAlign === 'top' || column.obstacles?.length) continue;
    const own = lines.filter((line) => line.frame === index);
    if (!own.length) continue;
    const last = own.at(-1),
      freeHeight = Math.max(0, column.height - last.baseline);
    // The last paragraph sets the eligible bottom position for Justify.
    // Intermediate baselines may land between grid lines after distribution.
    const step = column.grid?.increment;
    const snappedSpace = (v) => (step ? Math.floor(v / step + 1e-8) * step : v);
    const remaining =
      step && gridPolicies.get(last) !== 'none' ? snappedSpace(freeHeight) : freeHeight;
    const shift =
      column.verticalAlign === 'bottom'
        ? freeHeight
        : column.verticalAlign === 'center'
          ? freeHeight / 2
          : 0;
    const offset =
      step &&
      own.some((line) => {
        const policy = gridPolicies.get(line);
        return policy === 'all' || (policy === 'first' && paragraphStarts.has(line.start));
      })
        ? snappedSpace(shift)
        : shift;
    if (column.verticalAlign === 'justify' && own.length > 1) {
      const boundaries = own.slice(1).filter((line) => paragraphStarts.has(line.start)).length,
        paragraphExtra = boundaries
          ? Math.min(column.paragraphSpacingLimit, remaining / boundaries)
          : 0,
        lineExtra = (remaining - boundaries * paragraphExtra) / (own.length - 1);
      let shift = 0;
      for (let i = 1; i < own.length; i++) {
        if (paragraphStarts.has(own[i].start)) shift += paragraphExtra;
        shift += lineExtra;
        own[i].baseline = Math.min(column.height, own[i].baseline + shift);
      }
    } else if (offset) for (const line of own) line.baseline += offset;
  }
  return {
    ...(scheduled.oversetStart === undefined ? {} : { oversetStart: scheduled.oversetStart }),
    breaks: lines.map((line) => line.end),
    placements: lines.map(({ end, frame, baseline, left, width, wordSpacing, contourFit }) => ({
      end,
      frame,
      baseline,
      left,
      width,
      ...(contourFit ? { contourFit } : {}),
      ...(wordSpacing?.glyphPercentage !== undefined
        ? {
            wordPercent: wordSpacing.percentage,
            letterPercent: wordSpacing.letterPercentage,
            glyphPercent: wordSpacing.glyphPercentage,
          }
        : {}),
    })),
    policy: paragraphs.some((paragraph) => paragraph.wordSpacing)
      ? mode === 'single-line'
        ? 'native-fragment-word-spacing-greedy-v1'
        : wordSpacingCostPolicy(
            paragraphs.find((p) => p.wordSpacing?.glyphDesired !== undefined)?.wordSpacing,
          )
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
                  ...(line.wordSpacing.glyphPercentage !== undefined
                    ? {
                        letterPercentage: line.wordSpacing.letterPercentage,
                        glyphPercentage: line.wordSpacing.glyphPercentage,
                      }
                    : {}),
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
