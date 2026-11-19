import { textWrapBand } from '../geometry/text-wrap.js';
import { TEXT_WRAP_MODES, TEXT_WRAP_SIDES } from '../documents/text-wrap.js';
import { FIRST_BASELINES } from './frame-composition.js';
import { paragraphLayout } from './paragraph-layout.js';

const EPS = 0.000001,
  policy = 'ragged-right-quadratic-v1',
  integer = (value) => Number.isSafeInteger(value) && value >= 0,
  finite = (value, minimum = -Infinity, maximum = Infinity) =>
    Number.isFinite(value) && value >= minimum && value <= maximum,
  metricFields = ['ascent', 'descent', 'advance', 'capHeight', 'xHeight', 'leading'];

function* prepare(input) {
  const {
    start,
    end,
    opportunities,
    measurements,
    columns,
    cursor,
    layout,
    previousAfter,
    mode,
    maxStates,
    maxCandidates,
  } = input;
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
    !cursor ||
    typeof cursor !== 'object' ||
    Array.isArray(cursor) ||
    !integer(cursor.frame) ||
    cursor.frame > columns.length ||
    !(cursor.baseline === null || finite(cursor.baseline, 0, 14400)) ||
    !finite(previousAfter, 0, 2000) ||
    !['paragraph', 'single-line'].includes(mode) ||
    !integer(maxStates) ||
    maxStates < 1 ||
    maxStates > 100000 ||
    !integer(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > 1000000 ||
    (layout !== undefined && (!layout || typeof layout !== 'object' || Array.isArray(layout)))
  )
    throw Error('Invalid wrapped paragraph-flow input');
  const style = paragraphLayout(layout);
  if (style.leftIndent < 0 || style.rightIndent < 0 || style.leftIndent + style.firstLineIndent < 0)
    throw Error('Wrapped paragraph-flow indents cannot place text outside the column.');
  let work = 0,
    vertices = 0;
  const checkpoint = () => ({ stage: 'prepare', work, states: 1, candidates: 0 }),
    frames = [];
  for (const column of columns) {
    if (
      !column ||
      !finite(column.width, 1, 14400) ||
      !finite(column.height, 1, 14400) ||
      (column.firstBaseline !== undefined && !FIRST_BASELINES.includes(column.firstBaseline)) ||
      (column.minimumFirstBaseline !== undefined &&
        !finite(column.minimumFirstBaseline, 0, 14400)) ||
      (column.verticalAlign !== undefined &&
        !['top', 'center', 'bottom'].includes(column.verticalAlign)) ||
      (column.obstacles !== undefined && !Array.isArray(column.obstacles))
    )
      throw Error('Invalid wrapped paragraph-flow column');
    if ((column.obstacles?.length ?? 0) > 4096) return { geometryBudget: true };
    let columnVertices = 0,
      bandWork = 0;
    const obstacles = [];
    for (const obstacle of column.obstacles ?? []) {
      if (work >= 100000) return { geometryBudget: true };
      if (
        !obstacle ||
        !TEXT_WRAP_MODES.includes(obstacle.mode) ||
        (obstacle.side !== undefined && !TEXT_WRAP_SIDES.includes(obstacle.side)) ||
        (obstacle.invert !== undefined && typeof obstacle.invert !== 'boolean') ||
        (obstacle.pageSide !== undefined && !['left', 'right'].includes(obstacle.pageSide)) ||
        !obstacle.bounds ||
        !['left', 'top', 'right', 'bottom'].every((key) => finite(obstacle.bounds[key])) ||
        obstacle.bounds.left > obstacle.bounds.right ||
        obstacle.bounds.top > obstacle.bounds.bottom ||
        !Array.isArray(obstacle.polygons)
      )
        throw Error('Invalid wrapped paragraph-flow obstacle');
      let obstacleVertices = 0;
      for (const polygon of obstacle.polygons) {
        if (!Array.isArray(polygon) || polygon.length < 3)
          throw Error('Invalid wrapped paragraph-flow polygon');
        for (const point of polygon) {
          if (!point || !finite(point.x) || !finite(point.y))
            throw Error('Invalid wrapped paragraph-flow contour point');
          columnVertices++;
          obstacleVertices++;
          vertices++;
          if (columnVertices > 4096 || vertices > 100000) return { geometryBudget: true };
          if (++work % 1024 === 0) yield checkpoint();
        }
      }
      // Inverted contours inspect critical vertical slices, so their worst
      // query cost grows quadratically rather than with vertex count alone.
      bandWork +=
        8 + (obstacle.invert ? obstacleVertices * (obstacleVertices + 2) : obstacleVertices * 3);
      if (bandWork > 65536) return { geometryBudget: true };
      if (obstacle.mode !== 'none') obstacles.push(obstacle);
      if (++work % 1024 === 0) yield checkpoint();
    }
    frames.push({
      ...column,
      obstacles,
      cooperativeBand: bandWork > 256,
      hasVariableContours: obstacles.some(
        (obstacle) => obstacle.invert || obstacle.mode === 'contour',
      ),
      clearanceObstacles: obstacles.filter(
        (obstacle) => !obstacle.invert && obstacle.mode !== 'contour',
      ),
    });
  }
  const points = Array.from(opportunities, (point, index) => {
    if (
      !point ||
      !integer(point.index) ||
      (index && point.index <= opportunities[index - 1].index) ||
      !finite(point.penalty ?? 0, 0, 1000000) ||
      (point.mandatory !== undefined && typeof point.mandatory !== 'boolean')
    )
      throw Error('Invalid wrapped paragraph-flow opportunities');
    return { index: point.index, penalty: point.penalty ?? 0, mandatory: point.mandatory === true };
  });
  if (points[0].index !== start || points.at(-1).index !== end)
    throw Error('Wrapped paragraph-flow opportunities do not cover the source');
  const indices = new Map(points.map((point, index) => [point.index, index])),
    edges = new Map(points.map((point) => [point.index, []])),
    nextMandatory = Array(points.length),
    seen = new Set(),
    widest =
      Math.max(...frames.map((column) => column.width)) - style.leftIndent - style.rightIndent;
  let next = points.length - 1,
    metrics = null,
    metricSource = null,
    mixed = false;
  const ranges = Object.fromEntries(
    metricFields.map((field) => [field, { minimum: Infinity, maximum: -Infinity }]),
  );
  for (let index = points.length - 1; index >= 0; index--) {
    nextMandatory[index] = next;
    if (points[index].mandatory) next = index;
  }
  for (const row of measurements) {
    const a = indices.get(row?.start),
      b = indices.get(row?.end),
      key = row?.start + ':' + row?.end;
    if (
      !row ||
      a === undefined ||
      b === undefined ||
      b <= a ||
      !finite(row.width, 0, 1000000) ||
      metricFields.some((field) => !finite(row[field], 0, 1000000)) ||
      seen.has(key)
    )
      throw Error('Invalid or duplicate wrapped paragraph-flow measurement');
    seen.add(key);
    if (
      !metricSource ||
      row.start < metricSource.start ||
      (row.start === metricSource.start && row.end < metricSource.end)
    ) {
      metrics = Object.fromEntries(metricFields.map((field) => [field, row[field]]));
      metricSource = { start: row.start, end: row.end };
    }
    for (const field of metricFields) {
      ranges[field].minimum = Math.min(ranges[field].minimum, row[field]);
      ranges[field].maximum = Math.max(ranges[field].maximum, row[field]);
      if (ranges[field].maximum - ranges[field].minimum > EPS) mixed = true;
    }
    const maximumWidth = widest - (row.start === start ? style.firstLineIndent : 0);
    if (b <= nextMandatory[a] && row.width <= maximumWidth + EPS)
      edges.get(row.start).push({
        start: row.start,
        end: row.end,
        width: row.width,
        penalty: points[b].penalty,
        mandatory: points[b].mandatory,
      });
    if (++work % 1024 === 0) yield checkpoint();
  }
  const minimumWidths = new Map();
  for (const [position, choices] of edges) {
    choices.sort((a, b) => b.end - a.end);
    minimumWidths.set(position, Math.min(...choices.map((row) => row.width)));
  }
  return { style, frames, points, edges, minimumWidths, metrics, mixed, geometryBudget: false };
}

function firstBaseline(column, metrics) {
  return Math.max(
    column.minimumFirstBaseline ?? 0,
    {
      ascent: metrics.ascent,
      'cap-height': metrics.capHeight,
      'x-height': metrics.xHeight,
      leading: metrics.advance,
      fixed: 0,
    }[column.firstBaseline ?? 'ascent'],
  );
}

/** Uniform-metric paragraph composition around immutable exclusion paths.
 * Rows own ordered fragments; leaving a fragment consumes its full available
 * segment even when the selected break is ragged. Mandatory breaks end the row.
 * Preparation and search yield cooperatively; only the terminal value is a fit. */
export function* wrappedParagraphFlowSteps({
  start,
  end,
  opportunities,
  measurements,
  columns,
  layout,
  cursor = { frame: 0, baseline: null },
  previousAfter = 0,
  mode = 'paragraph',
  maxStates = 100000,
  maxCandidates = 1000000,
}) {
  const prepared = yield* prepare({
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
    }),
    { style, frames, points, edges, minimumWidths, metrics, mixed, geometryBudget } = prepared;
  let states = 1,
    candidates = 0,
    budget = null;
  const failed = (reason) => ({
    status: 'unfit',
    policy,
    mode,
    start,
    end,
    reason,
    states,
    candidates,
  });
  if (geometryBudget) return failed('geometry-budget');
  if (mixed) return failed('mixed-metrics');
  if (!metrics) return failed('no-feasible-path');
  const initial = {
      end: start,
      cursor: { ...cursor },
      after: null,
      mandatory: false,
      cost: 0,
      parent: null,
      line: null,
    },
    bands = new Map(),
    checkpoint = function* () {
      if (++candidates > maxCandidates) {
        budget = 'candidate-budget';
        return false;
      }
      if (candidates % 1024 === 0) yield { states, candidates };
      return true;
    },
    fitsAt = function* (state) {
      for (let frame = state.cursor.frame; frame < frames.length; frame++) {
        const column = frames[frame],
          offset = firstBaseline(column, metrics),
          left = style.leftIndent + (state.end === start ? style.firstLineIndent : 0),
          right = column.width - style.rightIndent;
        if (!(yield* checkpoint())) return [];
        if (right - left < 1 || minimumWidths.get(state.end) > right - left + EPS) continue;
        let baseline,
          after = null;
        if (frame !== state.cursor.frame || state.cursor.baseline === null) baseline = offset;
        else if (!state.line)
          baseline =
            state.cursor.baseline + metrics.advance + previousAfter + style.paragraphBefore;
        else {
          baseline = state.cursor.baseline + (state.mandatory ? metrics.advance : 0);
          after = state.mandatory ? null : state.after;
        }
        while (baseline + metrics.descent <= column.height) {
          if (!(yield* checkpoint())) return [];
          const key = frame + ':' + baseline + ':' + left;
          let band = bands.get(key);
          if (!band) {
            if (column.cooperativeBand) yield { stage: 'geometry', states, candidates };
            const query = {
              left,
              right,
              top: baseline - metrics.ascent,
              bottom: Math.max(baseline + metrics.descent, baseline - metrics.ascent + EPS),
            };
            band = textWrapBand(column.obstacles, query);
            if (!band.segments.length && !band.nextColumn && column.hasVariableContours) {
              if (!(yield* checkpoint())) return [];
              if (column.cooperativeBand) yield { stage: 'geometry', states, candidates };
              // Bounding rectangles and Jump retain their boundary restart.
              // A contour can narrow or open inside its bounds, so its box
              // bottom is not evidence that intervening rows are unusable.
              band.contourBlocked =
                textWrapBand(column.clearanceObstacles, query).segments.length > 0;
            }
            if (bands.size === 4096) bands.delete(bands.keys().next().value);
            bands.set(key, band);
          }
          if (band.nextColumn) break;
          if (!band.segments.length) {
            if (band.contourBlocked) {
              // Empty contour rows consume leading, not the contour's entire
              // bounding box. Zero/underflow leading uses one full font band
              // only for searching empty space; painted line advance is intact.
              let nextBaseline = baseline + metrics.advance;
              if (nextBaseline <= baseline)
                nextBaseline = baseline + Math.max(metrics.ascent + metrics.descent, 1);
              baseline = nextBaseline;
              after = null;
              continue;
            }
            let nextBaseline = band.nextY === null ? null : band.nextY + offset;
            if (nextBaseline !== null && nextBaseline <= baseline + EPS) {
              // Owned conservative clearance policy: a cap/x-height or small
              // fixed offset cannot leave ascent overlapping the exclusion.
              // The qualified fixed-12 jump needs no such adjustment.
              const clear = band.nextY + Math.max(offset, metrics.ascent);
              if (clear > baseline + EPS) nextBaseline = clear;
              else {
                // A cap/x-height offset can place an event above the current
                // baseline. Consume the next later boundary instead of stepping
                // backwards or retrying the same blocked band indefinitely.
                const events = column.obstacles
                  .flatMap((obstacle) => [obstacle.bounds.top, obstacle.bounds.bottom])
                  .filter((event) => event + offset > baseline + EPS);
                nextBaseline = events.length ? Math.min(...events) + offset : null;
              }
            }
            if (nextBaseline === null) break;
            baseline = nextBaseline;
            after = null;
            continue;
          }
          for (const segment of band.segments) {
            if (after !== null && segment.left < after - EPS) continue;
            const width = segment.right - segment.left;
            if (width < 1) continue;
            const available = [];
            for (const measured of edges.get(state.end)) {
              if (!(yield* checkpoint())) return [];
              if (measured.width > width + EPS) continue;
              const line = {
                start: measured.start,
                end: measured.end,
                frame,
                baseline,
                left: segment.left,
                width,
                naturalWidth: measured.width,
                ascent: metrics.ascent,
                descent: metrics.descent,
                advance: metrics.advance,
                penalty: measured.penalty,
                cost:
                  1 +
                  measured.penalty +
                  (measured.end === end ? 0 : 100 * ((width - measured.width) / width) ** 2),
              };
              available.push({ line, after: segment.right, mandatory: measured.mandatory });
            }
            if (available.length) return available;
          }
          if (metrics.advance === 0) {
            if (after !== null) {
              after = null;
              continue;
            }
            break;
          }
          baseline += metrics.advance;
          after = null;
        }
      }
      return [];
    },
    child = (state, choice) => ({
      end: choice.line.end,
      cursor: { frame: choice.line.frame, baseline: choice.line.baseline },
      after: choice.after,
      mandatory: choice.mandatory,
      cost: state.cost + choice.line.cost,
      line: choice.line,
      parent: state,
    }),
    better = (candidate, previous) =>
      !previous ||
      candidate.cost < previous.cost ||
      (candidate.cost === previous.cost &&
        (candidate.cursor.frame < previous.cursor.frame ||
          (candidate.cursor.frame === previous.cursor.frame &&
            candidate.cursor.baseline < previous.cursor.baseline))),
    result = (state) => {
      const lines = [];
      for (let current = state; current.line; current = current.parent) lines.push(current.line);
      return {
        status: 'fit',
        policy,
        mode,
        start,
        end,
        lines: lines.reverse(),
        cursor: { ...state.cursor },
        cost: state.cost,
        states,
        candidates,
      };
    };
  let seed = initial;
  while (seed.end < end) {
    const choice = (yield* fitsAt(seed))[0];
    if (budget) return failed(budget);
    if (!choice) break;
    if (++states > maxStates) return failed('state-budget');
    seed = child(seed, choice);
  }
  if (mode === 'single-line') return seed.end === end ? result(seed) : failed('no-feasible-line');
  let best = seed.end === end ? seed : null;
  const buckets = new Map(points.map((point) => [point.index, new Map()]));
  buckets.get(start).set('initial', initial);
  for (const point of points.slice(0, -1))
    for (const state of buckets.get(point.index).values()) {
      if (best && state.cost + 1 > best.cost) continue;
      for (const choice of yield* fitsAt(state)) {
        const next = child(state, choice);
        if (best && next.cost + (next.end === end ? 0 : 1) > best.cost) continue;
        if (next.end === end) {
          if (better(next, best)) best = next;
          continue;
        }
        const key =
            next.cursor.frame +
            ':' +
            next.cursor.baseline +
            ':' +
            next.after +
            ':' +
            next.mandatory,
          bucket = buckets.get(next.end),
          previous = bucket.get(key);
        if (!better(next, previous)) continue;
        if (!previous && ++states > maxStates) return failed('state-budget');
        bucket.set(key, next);
      }
      if (budget) return failed(budget);
    }
  return best ? result(best) : failed('no-feasible-path');
}

export function chooseWrappedParagraphFlow(input) {
  const steps = wrappedParagraphFlowSteps(input);
  let step;
  do step = steps.next();
  while (!step.done);
  return step.value;
}
