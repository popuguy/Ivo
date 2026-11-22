import { measureInlineTableHeight } from '../../../rendering/table-thread-layout.js';
import {
  columnPoints,
  resizeColumn,
  tableInnerWidth,
} from '../../../domain/geometry/table-columns.js';
/** Measure the transformed inline axis so zoomed and rotated tables use the same drag. */
export function installTableDividers({
  world,
  doc,
  selected,
  available,
  tableFor,
  mutate,
  allowed,
}) {
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
      table = tableFor(block),
      geometry = { ...block, table },
      old = columnPoints(geometry)[i];
    const objectNode = frame.parentElement,
      cols = frame.querySelectorAll('col'),
      grips = frame.querySelectorAll('[data-table-divider]');
    const session = new AbortController(),
      opts = { signal: session.signal, capture: true };
    let proposed;
    function preview(next) {
      Object.assign(objectNode.style, {
        width: next.w + 'px',
        left: next.x + 'px',
        top: next.y + 'px',
      });
      const total = next.widths.reduce((a, b) => a + b, 0);
      let x = 0;
      next.widths.forEach((width, c) => {
        const percent = (100 * width) / total;
        x += percent;
        cols[c].style.width = percent + '%';
        if (grips[c]) grips[c].style.left = x + '%';
      });
    }
    function change(e) {
      if (e.pointerId !== event.pointerId) return;
      const movement =
        (((e.clientX - event.clientX) * dx + (e.clientY - event.clientY) * dy) / length) *
        tableInnerWidth(block);
      proposed = resizeColumn(geometry, i, old + movement, e.shiftKey);
      preview(proposed);
    }
    function end(commit) {
      session.abort();
      cancel = null;
      if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
      if (
        !commit ||
        !proposed ||
        proposed.widths === table.widths ||
        doc() !== owner ||
        selected() !== block ||
        !allowed() ||
        !available(owner, block)
      ) {
        preview({ w: block.w, x: block.x, y: block.y, widths: table.widths });
        return;
      }
      const { widths, ...rect } = proposed;
      mutate(() => {
        Object.assign(block, rect);
        table.widths = widths;
        if (block.extensions?.ivoAnchor) block.h = measureInlineTableHeight(block);
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
