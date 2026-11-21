/** Measure the transformed inline axis so zoomed and rotated tables use the same drag. */
export function installTableDividers({ world, doc, selected, available, mutate, allowed }) {
  let marked = null,
    cancel = null;
  function mark(block) {
    const frame =
      block?.type === 'table' &&
      world.querySelector('[data-object="' + CSS.escape(block.id) + '"] > .table-frame');
    if (marked === frame) return;
    marked?.removeAttribute('data-selected-table');
    marked = frame || null;
    if (marked) marked.dataset.selectedTable = '';
  }
  function start(event) {
    const grip = event.target.closest('[data-table-divider]');
    if (!grip || !allowed() || event.button !== 0) return false;
    const block = selected(),
      owner = doc(),
      frame = grip.closest('.table-frame');
    if (
      !block ||
      block.type !== 'table' ||
      block.id !== frame.parentElement.dataset.object ||
      !available(owner, block)
    )
      return false;
    event.preventDefault();
    cancel?.();
    const left = frame.querySelector('[data-table-start]').getBoundingClientRect(),
      right = frame.querySelector('[data-table-end]').getBoundingClientRect();
    const dx = right.x - left.x,
      dy = right.y - left.y,
      length = dx * dx + dy * dy;
    if (length < 1) return true;
    const i = Number(grip.dataset.tableDivider),
      widths = block.table.widths,
      total = widths.reduce((a, b) => a + b, 0);
    const cols = frame.querySelectorAll('col'),
      old = widths[i],
      pair = old + widths[i + 1],
      min = Math.min(old, widths[i + 1], (4 * total) / block.w);
    const before = widths.slice(0, i).reduce((a, b) => a + b, 0);
    let next = old;
    const session = new AbortController(),
      opts = { signal: session.signal, capture: true };
    function preview(w) {
      next = w;
      cols[i].style.width = (100 * w) / total + '%';
      cols[i + 1].style.width = (100 * (pair - w)) / total + '%';
      grip.style.left = (100 * (before + w)) / total + '%';
    }
    function change(e) {
      if (e.pointerId !== event.pointerId) return;
      const movement =
        (((e.clientX - event.clientX) * dx + (e.clientY - event.clientY) * dy) / length) * total;
      preview(Math.min(10000, pair - min, Math.max(min, pair - 10000, old + movement)));
    }
    function end(commit) {
      session.abort();
      cancel = null;
      if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
      if (
        !commit ||
        next === old ||
        doc() !== owner ||
        selected() !== block ||
        !allowed() ||
        !available(owner, block)
      ) {
        preview(old);
        return;
      }
      mutate(() => {
        widths[i] = next;
        widths[i + 1] = pair - next;
      }, 'Resize table columns');
    }
    cancel = () => end(false);
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {}
    window.addEventListener('pointermove', change, opts);
    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerId === event.pointerId) {
          change(e);
          end(true);
        }
      },
      opts,
    );
    window.addEventListener(
      'pointercancel',
      (e) => {
        if (e.pointerId === event.pointerId) cancel();
      },
      opts,
    );
    grip.addEventListener('lostpointercapture', cancel, opts);
    window.addEventListener('blur', cancel, opts);
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          cancel();
        }
      },
      opts,
    );
    return true;
  }
  return { mark, start, cancel: () => cancel?.() };
}
