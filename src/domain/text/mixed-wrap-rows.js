// A later fragment can contain the tallest run on a physical line. Try the
// measured struts of complete source ranges, then keep only rows whose actual
// ending proves the strut used for their baseline and exclusion geometry.
export function* indexWrapRowMetrics(measurements, fields) {
  const profiles = new Map(),
    starts = new Map();
  for (const [index, row] of measurements.entries()) {
    const key = fields.map((field) => row[field]).join('/');
    if (!profiles.has(key))
      profiles.set(key, Object.fromEntries(fields.map((field) => [field, row[field]])));
    if (!starts.has(row.start)) starts.set(row.start, new Map());
    const lengths = starts.get(row.start);
    const metrics = profiles.get(key);
    if (!lengths.has(metrics))
      lengths.set(metrics, { metrics, ends: new Set(), first: row.end, last: row.end });
    const range = lengths.get(metrics);
    range.ends.add(row.end);
    range.first = Math.min(range.first, row.end);
    range.last = Math.max(range.last, row.end);
    if ((index + 1) % 1024 === 0) yield { stage: 'prepare', measurements: index + 1 };
  }
  return starts;
}

export function* fitMixedWrapRow(
  state,
  profiles,
  { fragmentFits, child, checkpoint, claimState, end, mode, wordSpacing },
) {
  const rows = new Map(),
    shortRows = new Map();
  // One physical row can cross multiple disjoint pieces of a shape. Each
  // accepted fragment advances the source, so a frontier never cycles.
  const alternatives = Array.from(profiles.get(state.end)?.values() ?? []).sort(
    (a, b) => a.first - b.first,
  );
  for (const { metrics, ends: endings, last: limit } of alternatives) {
    const first = yield* fragmentFits(state, metrics, false, limit);
    if (!first.length) continue;
    let frontier = new Map();
    function retain(map, node, key) {
      const current = map.get(key);
      if (current && current.cost <= node.cost) return;
      if (!current && !claimState()) return;
      map.set(key, node);
    }
    for (const choice of first) {
      const node = child(state, choice);
      retain(frontier, node, node.end);
    }
    while (frontier.size) {
      const next = new Map();
      for (const node of frontier.values()) {
        if (!(yield* checkpoint())) return [];
        const closed = node.end === end || node.mandatory;
        const continuations = closed ? [] : yield* fragmentFits(node, metrics, true);
        // If adding the next run would make this row too tall, retain the
        // shorter row as a possible last row of the current frame.
        if (endings.has(node.end) && !continuations.some((choice) => choice.line.end <= limit)) {
          const finished = { ...node, after: null, mandatory: true, clearance: first[0].clearance };
          retain(
            continuations.length ? shortRows : rows,
            finished,
            [
              node.end,
              node.cursor.frame,
              node.cursor.baseline,
              node.hyphens,
              finished.clearance,
            ].join('/'),
          );
        }
        for (const choice of continuations) {
          if (!(yield* checkpoint())) return [];
          if (choice.line.end > limit) continue;
          const following = child(node, choice);
          retain(next, following, [following.end, following.after, following.hyphens].join('/'));
        }
      }
      frontier = next;
    }
  }
  // Keep the first frame with a feasible row. Within it the greedy composer
  // takes the longest source prefix; paragraph search retains alternate endings.
  let firstFrame = Infinity,
    clearance = Infinity;
  for (const group of [rows, shortRows])
    for (const row of group.values()) {
      if (row.cursor.frame < firstFrame) {
        firstFrame = row.cursor.frame;
        clearance = row.clearance;
      } else if (row.cursor.frame === firstFrame) clearance = Math.min(clearance, row.clearance);
    }
  const earliest = (row) => row.cursor.frame === firstFrame && row.clearance <= clearance + 1e-6;
  let choices = [...rows.values()].filter(earliest);
  if (!choices.length) choices = [...shortRows.values()].filter(earliest);
  return choices
    .sort((a, b) => {
      if (mode === 'single-line' && wordSpacing) {
        const below = (n) => n.line.wordSpacing.percentage < wordSpacing.minimum;
        if (below(a) !== below(b)) return below(a) ? 1 : -1;
      }
      return b.end - a.end || a.cost - b.cost || a.cursor.baseline - b.cursor.baseline;
    })
    .map((completed) => ({ line: completed.line, completed }));
}
