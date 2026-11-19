/** Columns are in thread order. A continuation page clones the final physical frame,
 * including its column count. Page parity follows document order, independently of the thread. */
export function paragraphStartLocations(columns, capacity) {
  const slots = [];
  let frame = -1;
  for (const [i, column] of columns.entries()) {
    if (i === 0 || !column.frameId || columns[i - 1].frameId !== column.frameId) frame++;
    slots.push({ frame, page: column.pageNumber ?? frame + 1 });
  }
  const last = slots.at(-1);
  const columnsPerContinuation =
    slots.length - slots.findIndex((slot) => slot.frame === last.frame);
  let continuation = 0;
  while (slots.length < capacity) {
    const offset = Math.floor(continuation++ / columnsPerContinuation) + 1;
    slots.push({ frame: last.frame + offset, page: last.page + offset });
  }
  return slots;
}

/** A paragraph at the start of the flow already occupies a valid start, unless
 * its requested page parity differs. A replay can be farther along than its minimum. */
export function paragraphStartColumn(rule, slots, preceding, earliest) {
  const after = preceding === undefined ? earliest : Math.max(earliest, preceding + 1);
  for (let i = after; i < slots.length; i++) {
    const slot = slots[i],
      prior = slots[preceding];
    if (rule === 'frame' && prior && slot.frame === prior.frame) continue;
    if (['page', 'even', 'odd'].includes(rule) && prior && slot.page === prior.page) continue;
    if (rule === 'even' && slot.page % 2 !== 0) continue;
    if (rule === 'odd' && slot.page % 2 !== 1) continue;
    return i;
  }
  return slots.length;
}
