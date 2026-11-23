import { inlineTableResize } from './inline-table-resize.js';
import { anchoredPlacement } from '../../../rendering/anchored-artwork.js';
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
  select,
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
  function start(event, target = event.target) {
    const grip = target?.closest('[data-inline-edge],[data-table-divider]');
    if (!grip || !world.contains(grip) || !allowed() || event.button !== 0) return false;
    const owner = doc(),
      node = grip.closest('[data-object]'),
      id = node.dataset.object;
    const block = owner.blocks.find((b) => b.id === id);
    if (!block || block.type !== 'table' || !available(owner, block)) return false;
    const inline = !!grip.dataset.inlineEdge;
    const placement = inline && anchoredPlacement(world, id);
    const host = inline && owner.blocks.find((b) => b.id === placement?.frameId);
    if (inline ? !host || !available(owner, host) : selected() !== block) return false;
    event.preventDefault();
    cancel?.();
    // Editing text or a cell may repaint its page. Capture on the persistent
    // workspace and reacquire the table after the previous edit is committed.
    if (inline) select(id);
    const mounted = world.querySelector('[data-object="' + CSS.escape(id) + '"]');
    if (!mounted) return true;
    const valid = () =>
      doc() === owner &&
      owner.blocks.includes(block) &&
      selected() === block &&
      allowed() &&
      available(owner, block) &&
      (!inline || available(owner, host));
    if (!valid()) return true;
    const interaction = inline
      ? inlineTableResize({
          block,
          node: mounted,
          grip,
          event,
          pageWidth: owner.pages.find((p) => p.id === placement.pageId).width,
          valid,
          mutate,
        })
      : columnResize(event, grip, block, mounted.querySelector('.table-frame'), valid);
    if (!interaction) return true;
    const session = new AbortController(),
      opts = { signal: session.signal, capture: true };
    const capture = inline ? world.closest('.canvas-viewport') : grip;
    function finish(commit) {
      session.abort();
      cancel = null;
      if (capture.hasPointerCapture(event.pointerId))
        capture.releasePointerCapture(event.pointerId);
      interaction.end(commit);
    }
    cancel = () => finish(false);
    try {
      capture.setPointerCapture(event.pointerId);
    } catch {}
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId === event.pointerId) interaction.change(e);
      },
      opts,
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerId === event.pointerId) {
          interaction.change(e);
          finish(true);
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
    capture.addEventListener('lostpointercapture', cancel, opts);
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
  function columnResize(event, grip, block, frame, valid) {
    const left = frame.querySelector('[data-table-start]').getBoundingClientRect(),
      right = frame.querySelector('[data-table-end]').getBoundingClientRect();
    const dx = right.x - left.x,
      dy = right.y - left.y,
      length = dx * dx + dy * dy;
    if (length < 1) return null;
    const i = Number(grip.dataset.tableDivider),
      table = tableFor(block),
      geometry = { ...block, table },
      old = columnPoints(geometry)[i];
    const objectNode = frame.parentElement,
      placedX = parseFloat(objectNode.style.left),
      placedY = parseFloat(objectNode.style.top),
      cols = frame.querySelectorAll('col'),
      grips = frame.querySelectorAll('[data-table-divider]');
    let proposed;
    function preview(next) {
      Object.assign(objectNode.style, {
        width: next.w + 'px',
        left: placedX + (next.x - geometry.x) + 'px',
        top: placedY + (next.y - geometry.y) + 'px',
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
      const movement =
        (((e.clientX - event.clientX) * dx + (e.clientY - event.clientY) * dy) / length) *
        tableInnerWidth(block);
      proposed = resizeColumn(geometry, i, old + movement, e.shiftKey);
      preview(proposed);
    }
    function end(commit) {
      if (!commit || !proposed || proposed.widths === table.widths || !valid()) {
        preview({ w: block.w, x: block.x, y: block.y, widths: table.widths });
        return;
      }
      const { widths, ...rect } = proposed;
      mutate(() => {
        Object.assign(block, rect);
        table.widths = widths;
      }, 'Resize table columns');
    }
    return { change, end };
  }
  return { mark, start, cancel: () => cancel?.() };
}
