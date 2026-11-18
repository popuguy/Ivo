/**
 * An owned, bounded paragraph decision over externally measured line alternatives.
 * Policy v1 is ragged-right quadratic fitting, not an InDesign composer claim.
 * UTF-16 opportunities and measurements must already be shaped/validated by the backend.
 */
export function chooseParagraphBreaks({
  start,
  end,
  opportunities,
  measurements,
  lineWidths,
  mode = 'paragraph',
  maxStates = 20000,
  maxCandidates = 100000,
}) {
  const integer = (n) => Number.isSafeInteger(n) && n >= 0,
    bounded = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  if (
    !integer(start) ||
    !integer(end) ||
    end <= start ||
    !['paragraph', 'single-line'].includes(mode) ||
    !Array.isArray(opportunities) ||
    opportunities.length < 2 ||
    opportunities.length > 1024 ||
    !Array.isArray(measurements) ||
    measurements.length > 100000 ||
    !Array.isArray(lineWidths) ||
    !lineWidths.length ||
    lineWidths.length > 2048 ||
    !Array.from(lineWidths).every((n) => bounded(n, 0.001, 100000)) ||
    !integer(maxStates) ||
    maxStates < 1 ||
    maxStates > 100000 ||
    !integer(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > 1000000
  )
    throw Error('Invalid paragraph decision input');
  const points = Array.from(opportunities, (point, i) => {
    if (
      !point ||
      typeof point !== 'object' ||
      !integer(point.index) ||
      (i && point.index <= opportunities[i - 1].index) ||
      !bounded(point.penalty ?? 0, 0, 1000000) ||
      (point.mandatory !== undefined && typeof point.mandatory !== 'boolean')
    )
      throw Error('Invalid break opportunities');
    return { index: point.index, penalty: point.penalty ?? 0, mandatory: point.mandatory === true };
  });
  if (points[0].index !== start || points.at(-1).index !== end)
    throw Error('Break opportunities do not cover the paragraph');
  const byIndex = new Map(points.map((p, i) => [p.index, i])),
    edges = new Map(points.map((p) => [p.index, []])),
    seen = new Set();
  let mandatory = points.length - 1;
  const nextMandatory = Array(points.length);
  for (let i = points.length - 1; i >= 0; i--) {
    nextMandatory[i] = mandatory;
    if (points[i].mandatory) mandatory = i;
  }
  for (const measurement of measurements) {
    if (!measurement || typeof measurement !== 'object') throw Error('Invalid line measurement');
    const a = byIndex.get(measurement.start),
      b = byIndex.get(measurement.end),
      key = measurement.start + ':' + measurement.end;
    if (
      a === undefined ||
      b === undefined ||
      b <= a ||
      !bounded(measurement.width, 0, 1000000) ||
      seen.has(key)
    )
      throw Error('Invalid or duplicate line measurement');
    seen.add(key);
    if (b <= nextMandatory[a])
      edges.get(measurement.start).push({
        start: measurement.start,
        end: measurement.end,
        width: measurement.width,
        penalty: points[b].penalty,
      });
  }
  // Descending ends make ties deterministic without depending on measurement arrival order.
  for (const values of edges.values()) values.sort((a, b) => b.end - a.end);
  let states = 1,
    candidates = 0;
  const policy = 'ragged-right-quadratic-v1',
    result = (state) => {
      const lines = [];
      for (let current = state; current?.line; current = current.parent) lines.push(current.line);
      lines.reverse();
      return {
        status: 'fit',
        policy,
        mode,
        start,
        end,
        lines,
        cost: state.cost,
        states,
        candidates,
      };
    },
    failed = (reason) => ({
      status: 'unfit',
      policy,
      mode,
      start,
      end,
      reason,
      states,
      candidates,
    }),
    line = (edge, available, index) => ({
      ...edge,
      available,
      index,
      cost:
        1 +
        edge.penalty +
        (edge.end === end ? 0 : 100 * ((available - edge.width) / available) ** 2),
    }),
    initial = { end: start, cost: 0, parent: null, line: null };
  if (mode === 'single-line') {
    let state = initial;
    for (let index = 0; index < lineWidths.length; index++) {
      let selected = null;
      for (const edge of edges.get(state.end)) {
        if (++candidates > maxCandidates) return failed('candidate-budget');
        if (edge.width <= lineWidths[index]) {
          selected = line(edge, lineWidths[index], index);
          break;
        }
      }
      if (!selected) return failed('no-feasible-line');
      if (++states > maxStates) return failed('state-budget');
      state = {
        end: selected.end,
        cost: state.cost + selected.cost,
        parent: state,
        line: selected,
      };
      if (state.end === end) return result(state);
    }
    return failed('insufficient-lines');
  }
  let layer = new Map([[start, initial]]),
    best = null;
  for (let index = 0; index < lineWidths.length && layer.size; index++) {
    const next = new Map(),
      available = lineWidths[index];
    for (const state of layer.values()) {
      for (const edge of edges.get(state.end)) {
        if (++candidates > maxCandidates) return failed('candidate-budget');
        if (edge.width > available) continue;
        const fitted = line(edge, available, index),
          cost = state.cost + fitted.cost,
          previous = next.get(edge.end);
        if (previous && previous.cost <= cost) continue;
        if (!previous && ++states > maxStates) return failed('state-budget');
        const candidate = { end: edge.end, cost, parent: state, line: fitted };
        if (edge.end === end) {
          if (!best || candidate.cost < best.cost) best = candidate;
        } else next.set(edge.end, candidate);
      }
    }
    layer = next;
  }
  return best ? result(best) : failed('no-feasible-path');
}
