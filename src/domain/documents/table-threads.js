/** Each chain has one cell matrix on its first frame. Frame order is independent of page and stacking order. */
export function tableThreads(blocks) {
  const tables = new Map(blocks.filter((block) => block.type === 'table').map((b) => [b.id, b]));
  const incoming = new Set();
  for (const frame of tables.values()) {
    if (!frame.tableNext) continue;
    if (!tables.has(frame.tableNext) || incoming.has(frame.tableNext))
      throw Error('A table continuation must belong to exactly one thread.');
    incoming.add(frame.tableNext);
  }
  const byFrame = new Map();
  for (const head of tables.values()) {
    if (incoming.has(head.id)) continue;
    if (!head.table) throw Error('The first table frame must contain the cells.');
    const thread = [];
    for (let frame = head; frame; frame = tables.get(frame.tableNext)) {
      if (frame !== head && frame.table)
        throw Error('A table thread cannot have two cell sources.');
      thread.push(frame);
      byFrame.set(frame.id, thread);
    }
  }
  if (byFrame.size !== tables.size) throw Error('Table frames cannot form a cycle.');
  return byFrame;
}

// A selection copied to another document gets an independent matrix, even when it
// starts on page three. Deleting its first frame transfers the source to the next survivor.
export function retainTableThreads(blocks, kept, { copy = false } = {}) {
  const threads = new Set(tableThreads(blocks).values());
  for (const thread of threads) {
    if (thread.length === 1) continue;
    const survivors = thread.map((b) => kept.get(b.id)).filter(Boolean);
    if (!survivors.length) continue;
    const source = thread[0].table;
    for (const [i, frame] of survivors.entries()) {
      if (i === 0) frame.table = copy ? structuredClone(source) : source;
      else delete frame.table;
      if (i + 1 < survivors.length) frame.tableNext = survivors[i + 1].id;
      else delete frame.tableNext;
    }
  }
}

/** Break only between complete row groups; a vertical merge ties every row it covers together. */
export function tableBodyBreaks(table) {
  const first = table.headerRows,
    end = table.cells.length - table.footerRows;
  const blocked = new Set();
  for (const [row, opt] of Object.entries(table.rowOptions || {}))
    if (opt.keepWithNext && Number(row) + 1 < end) blocked.add(Number(row) + 1);
  for (const merge of table.merges) {
    for (let r = merge.row + 1; r < merge.row + merge.rows; r++) blocked.add(r);
  }
  return Array.from({ length: end - first }, (_, i) => first + i + 1).filter(
    (r) => !blocked.has(r),
  );
}

export function paginateTable(table, frames, measure) {
  const breaks = tableBodyBreaks(table);
  const end = table.cells.length - table.footerRows;
  const parts = new Map();
  let first = table.headerRows,
    next = 0;
  for (const frame of frames) {
    let last = first;
    if (first < end) {
      const { heights, border } = measure(frame);
      const cumulative = [0];
      for (const height of heights) cumulative.push(cumulative.at(-1) + height);
      const fixed = border + cumulative[table.headerRows] + cumulative.at(-1) - cumulative[end];
      while (
        next < breaks.length &&
        fixed + cumulative[breaks[next]] - cumulative[first] <= frame.h + 0.001
      )
        last = breaks[next++];
    }
    parts.set(frame.id, {
      head: frames[0],
      first,
      last,
      overset: frame === frames.at(-1) && last < end,
    });
    first = last;
  }
  return parts;
}
