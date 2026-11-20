import { lineHyphenation } from './line-hyphenation.js';
import { FIRST_BASELINES } from './frame-composition.js';
import { paragraphLayout } from './paragraph-layout.js';
import {
  adjustWordSpacing,
  paragraphLineCost,
  normalizeWordSpacingPolicy,
  wordSpacingMeasurement,
  wordSpacingMinimumWidth,
  WORD_SPACING_COST_POLICY,
} from './word-spacing-adjustment.js';

const integer = (value) => Number.isSafeInteger(value) && value >= 0,
  finite = (value, minimum, maximum) =>
    Number.isFinite(value) && value >= minimum && value <= maximum,
  fields = ['width', 'ascent', 'descent', 'leading', 'advance', 'capHeight', 'xHeight'],
  policy = 'ragged-right-quadratic-v1';

function* inputs({
  start,
  end,
  opportunities,
  measurements,
  columns,
  layout,
  cursor,
  previousAfter,
  mode,
  maxStates,
  maxCandidates,
  wordSpacing,
}) {
  if (
    !integer(start) ||
    !integer(end) ||
    end <= start ||
    !Array.isArray(opportunities) ||
    opportunities.length < 2 ||
    opportunities.length > 1024 ||
    !Array.isArray(measurements) ||
    measurements.length > 100000 ||
    !Array.isArray(columns) ||
    !columns.length ||
    columns.length > 128 ||
    !['paragraph', 'single-line'].includes(mode) ||
    !integer(maxStates) ||
    maxStates < 1 ||
    maxStates > 100000 ||
    !integer(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > 1000000 ||
    !finite(previousAfter, 0, 2000) ||
    !cursor ||
    typeof cursor !== 'object' ||
    Array.isArray(cursor) ||
    !integer(cursor.frame) ||
    cursor.frame > columns.length ||
    !(cursor.baseline === null || finite(cursor.baseline, 0, 14400)) ||
    (layout !== undefined && (!layout || typeof layout !== 'object' || Array.isArray(layout)))
  )
    throw Error('Invalid paragraph-flow input');
  const style = paragraphLayout(layout);
  if (style.leftIndent < 0 || style.rightIndent < 0 || style.leftIndent + style.firstLineIndent < 0)
    throw Error('Paragraph-flow indents cannot place text outside the column.');
  const frames = Array.from(columns, (column) => {
    if (
      !column ||
      !finite(column.width, 1, 14400) ||
      !finite(column.height, 1, 14400) ||
      (column.firstBaseline !== undefined && !FIRST_BASELINES.includes(column.firstBaseline)) ||
      (column.minimumFirstBaseline !== undefined &&
        !finite(column.minimumFirstBaseline, 0, 14400)) ||
      (column.verticalAlign !== undefined &&
        !['top', 'center', 'bottom'].includes(column.verticalAlign))
    )
      throw Error('Invalid paragraph-flow column');
    return column;
  });
  const points = Array.from(opportunities, (point, index) => {
    if (
      !point ||
      !integer(point.index) ||
      (index && point.index <= opportunities[index - 1].index) ||
      !finite(point.penalty ?? 0, 0, 1000000) ||
      (point.mandatory !== undefined && typeof point.mandatory !== 'boolean')
    )
      throw Error('Invalid paragraph-flow break opportunities');
    return { index: point.index, penalty: point.penalty ?? 0, mandatory: point.mandatory === true };
  });
  if (points[0].index !== start || points.at(-1).index !== end)
    throw Error('Paragraph-flow opportunities do not cover the source');
  const indexOf = new Map(points.map((point, index) => [point.index, index])),
    edges = new Map(points.map((point) => [point.index, []])),
    nextMandatory = Array(points.length),
    seen = new Set(),
    widest =
      Math.max(...frames.map((column) => column.width)) - style.leftIndent - style.rightIndent;
  let mandatory = points.length - 1,
    prepared = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    nextMandatory[i] = mandatory;
    if (points[i].mandatory) mandatory = i;
  }
  for (const measurement of measurements) {
    const a = indexOf.get(measurement?.start),
      b = indexOf.get(measurement?.end),
      key = measurement?.start + ':' + measurement?.end;
    if (
      !measurement ||
      a === undefined ||
      b === undefined ||
      b <= a ||
      fields.some((field) => !finite(measurement[field], 0, 1000000)) ||
      seen.has(key)
    )
      throw Error('Invalid or duplicate paragraph-flow measurement');
    seen.add(key);
    const spacing = wordSpacing ? wordSpacingMeasurement(measurement, wordSpacing) : null,
      minimumWidth = spacing
        ? wordSpacingMinimumWidth({ ...measurement, wordSpacing: spacing }, style.align)
        : measurement.width;
    const maximumWidth = widest - (measurement.start === start ? style.firstLineIndent : 0);
    if (b <= nextMandatory[a] && minimumWidth <= maximumWidth + 0.000001)
      edges.get(measurement.start).push({
        ...Object.fromEntries(fields.map((field) => [field, measurement[field]])),
        start: measurement.start,
        end: measurement.end,
        penalty: points[b].penalty,
        ...(spacing ? { wordSpacing: spacing } : {}),
      });
    if (++prepared % 1024 === 0)
      yield { stage: 'prepare', measurements: prepared, states: 1, candidates: 0 };
  }
  for (const values of edges.values()) values.sort((a, b) => b.end - a.end);
  return { style, frames, points, edges };
}

function firstBaseline(column, measured) {
  const metric = {
    ascent: measured.ascent,
    'cap-height': measured.capHeight,
    'x-height': measured.xHeight,
    leading: measured.advance,
    fixed: 0,
  }[column.firstBaseline || 'ascent'];
  return Math.max(column.minimumFirstBaseline || 0, metric);
}

/** The metrics belong to the selected alternative, not a paragraph-wide maximum.
 * Baselines here remain Top-aligned; the owner aligns the completed physical column. */
function placement(
  measured,
  column,
  frame,
  baseline,
  style,
  first,
  previousAfter,
  last,
  wordSpacing,
) {
  const left = style.leftIndent + (first ? style.firstLineIndent : 0),
    width = column.width - left - style.rightIndent;
  const spacing = measured.wordSpacing
    ? adjustWordSpacing(measured, width, style.align, last, wordSpacing.desired)
    : null;
  if (width < 1 || (measured.wordSpacing ? !spacing : measured.width > width + 0.000001))
    return null;
  const nextBaseline =
    baseline === null
      ? firstBaseline(column, measured)
      : baseline + measured.advance + (first ? previousAfter + style.paragraphBefore : 0);
  if (nextBaseline + measured.descent > column.height) return null;
  return {
    start: measured.start,
    end: measured.end,
    frame,
    baseline: nextBaseline,
    left,
    width,
    naturalWidth: measured.width,
    ascent: measured.ascent,
    descent: measured.descent,
    advance: measured.advance,
    penalty: measured.penalty,
    ...(spacing ? { wordSpacing: spacing } : {}),
  };
}

/** Bounded paragraph fitting across physical columns with unequal widths/heights.
 * No source, font, DOM or platform state is owned here. A candidate may leave a
 * column only when no candidate fits there; layout cannot skip usable space merely
 * to lower its raggedness cost. Distinct cursor histories remain distinct states.
 * Preparation and search yield after every 1024 rows or geometry checks; callers
 * may schedule the next step asynchronously without changing the result. */
export function* paragraphFlowSteps({
  start,
  end,
  opportunities,
  measurements,
  columns,
  layout,
  cursor = { frame: 0, baseline: null },
  previousAfter = 0,
  mode = 'paragraph',
  retainOversetPrefix = false,
  maxStates = 100000,
  maxCandidates = 1000000,
  wordSpacing: inputWordSpacing,
  hyphenation,
  priorHyphens = 0,
}) {
  const wordSpacing = normalizeWordSpacingPolicy(inputWordSpacing),
    costPolicy = wordSpacing ? WORD_SPACING_COST_POLICY : policy;
  const { style, frames, points, edges } = yield* inputs({
    start,
    end,
    opportunities,
    measurements,
    columns,
    layout,
    cursor,
    previousAfter,
    mode,
    maxStates,
    maxCandidates,
    wordSpacing,
  });
  const hyphens = lineHyphenation(opportunities, hyphenation, mode, style.align);

  let states = 1,
    candidates = 0,
    budget = null;
  const failed = (reason) => ({
      status: 'unfit',
      policy: costPolicy,
      mode,
      start,
      end,
      reason,
      states,
      candidates,
    }),
    initial = {
      hyphens: priorHyphens,
      end: start,
      cursor: { ...cursor },
      cost: 0,
      parent: null,
      line: null,
    },
    result = (state) => {
      const lines = [];
      for (let current = state; current.line; current = current.parent) lines.push(current.line);
      lines.reverse();
      return {
        status: 'fit',
        policy: costPolicy,
        mode,
        start,
        end,
        lines,
        cursor: { ...state.cursor },
        cost: state.cost,
        states,
        candidates,
        ...(wordSpacing
          ? {
              wordSpacingDiagnostics: lines
                .filter((line) => line.wordSpacing?.diagnostic)
                .map((line) => ({
                  ...line.wordSpacing.diagnostic,
                  start: line.start,
                  end: line.end,
                  frame: line.frame,
                })),
            }
          : {}),
      };
    },
    fitsAt = function* (state) {
      for (let frame = state.cursor.frame; frame < frames.length; frame++) {
        const available = [],
          baseline = frame === state.cursor.frame ? state.cursor.baseline : null;
        for (const measured of edges.get(state.end)) {
          if (++candidates > maxCandidates) {
            budget = 'candidate-budget';
            return [];
          }
          if (candidates % 1024 === 0) yield { states, candidates };
          const line = placement(
            measured,
            frames[frame],
            frame,
            baseline,
            style,
            state.end === start,
            previousAfter,
            measured.end === end,
            wordSpacing,
          );
          if (line) {
            line.cost = paragraphLineCost(line, line.end === end);
            available.push(line);
          }
        }
        if (available.length) return hyphens.candidates(available, state.hyphens);
      }
      return [];
    },
    child = (state, line) => ({
      end: line.end,
      hyphens: hyphens.countAfter(state.hyphens, line.end),
      cursor: { frame: line.frame, baseline: line.baseline },
      cost: state.cost + line.cost,
      parent: state,
      line,
    }),
    better = (candidate, previous) =>
      !previous ||
      candidate.cost < previous.cost ||
      (candidate.cost === previous.cost &&
        (candidate.cursor.frame < previous.cursor.frame ||
          (candidate.cursor.frame === previous.cursor.frame &&
            candidate.cursor.baseline < previous.cursor.baseline)));

  // A deterministic feasible path supplies a safe upper bound, never a fallback
  // after a work limit. If this greedy path fails, the complete bounded DP can
  // still find a different sequence of mixed-metric alternatives.
  let seed = initial;
  while (seed.end < end) {
    const fitting = yield* fitsAt(seed);
    const line =
      (mode === 'single-line' && wordSpacing
        ? fitting.find((candidate) => candidate.wordSpacing.percentage >= wordSpacing.minimum)
        : null) ?? fitting[0];
    if (budget) return failed(budget);
    if (!line) break;
    if (++states > maxStates) return failed('state-budget');
    seed = child(seed, line);
  }
  let furthest = seed;
  const incomplete = (reason) =>
    retainOversetPrefix
      ? { ...result(furthest), status: 'overset', end: furthest.end }
      : failed(reason);
  if (mode === 'single-line')
    return seed.end === end ? result(seed) : incomplete('no-feasible-line');
  let best = seed.end === end ? seed : null;
  const buckets = new Map(points.map((point) => [point.index, new Map()]));
  buckets.get(start).set(cursor.frame + ':' + cursor.baseline, initial);
  for (const point of points.slice(0, -1))
    for (const state of buckets.get(point.index).values()) {
      if (best && state.cost + 1 > best.cost) continue;
      for (const line of yield* fitsAt(state)) {
        const next = child(state, line);
        if (
          retainOversetPrefix &&
          (next.end > furthest.end || (next.end === furthest.end && better(next, furthest)))
        )
          furthest = next;
        if (best && next.cost + (next.end === end ? 0 : 1) > best.cost) continue;
        if (next.end === end) {
          if (better(next, best)) best = next;
          continue;
        }
        const bucket = buckets.get(next.end),
          key = next.cursor.frame + ':' + next.cursor.baseline + ':' + next.hyphens,
          previous = bucket.get(key);
        if (!better(next, previous)) continue;
        if (!previous && ++states > maxStates) return failed('state-budget');
        bucket.set(key, next);
      }
      if (budget) return failed(budget);
    }
  return best ? result(best) : incomplete('no-feasible-path');
}

/** Synchronous callers consume the same cooperatively scheduled search. */
export function chooseParagraphFlow(input) {
  const steps = paragraphFlowSteps(input);
  let step;
  do step = steps.next();
  while (!step.done);
  return step.value;
}
