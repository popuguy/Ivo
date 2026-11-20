import { PANEL_LABELS } from '../domain/workspace/panels.js';
import { icon } from '../shared/ui/icons.js';

const bridge = globalThis.ivoPalette;
const content = document.querySelector('.canvas-panel-content');
const context = document.querySelector('[data-palette-context]');
const control = (target) => target.closest('[data-palette-control]');
const controlIndex = (el) => Number(el.dataset.paletteControl);
let view,
  kind,
  painting = false,
  drag = null,
  divider = null;
const paneHeights = new Map();

function show(next) {
  const field = document.activeElement;
  // A new caret position can invalidate prior actions without changing any
  // visible controls. Keep the panel and its scroll position in that case.
  const same = next && view?.scope === next.scope;
  if (next && next.html === undefined && view) {
    next = { ...view, ...next };
    if (same || !content.contains(field)) {
      view = next;
      context.textContent = view.title;
      document.title = [PANEL_LABELS[kind], view.title].filter(Boolean).join(' — ');
      return;
    }
  }
  const keep = same && field?.matches('input,textarea,select') && content.contains(field);
  const scroll = same ? content.scrollTop : 0;
  const inner = content.querySelector('.page-thumbnails,.layer-tree');
  const innerScroll = same ? inner?.scrollTop : 0;
  const caret =
    keep && ['text', 'search', 'url', 'tel'].includes(field.type)
      ? [field.selectionStart, field.selectionEnd]
      : null;
  painting = true;
  try {
    const template = document.createElement('template');
    // Only the registered editor window may publish its generated inspector.
    // Keep the utility document inert outside the native control contract.
    template.innerHTML = next?.html || '';
    for (const node of template.content.querySelectorAll(
      'script,iframe,object,embed,link,style,form,base,meta,svg,math',
    ))
      node.remove();
    for (const node of template.content.querySelectorAll('*')) {
      for (const { name } of [...node.attributes])
        if (name.startsWith('on') || ['href', 'formaction', 'srcdoc', 'autofocus'].includes(name))
          node.removeAttribute(name);
      if (node.dataset.tooltip) node.title = node.dataset.tooltip;
    }
    if (!same) drag = null;
    content.replaceChildren(template.content);
    context.textContent = next?.title || 'No active document';
    document.title = [PANEL_LABELS[kind], next?.title].filter(Boolean).join(' — ') || 'Ivo';
    content.scrollTop = scroll;
    const list = content.querySelector('.page-thumbnails,.layer-tree');
    if (list && innerScroll) list.scrollTop = innerScroll;
    const panel = content.querySelector('.pages-panel');
    if (panel && paneHeights.has(kind))
      panel.style.setProperty('--parent-pane-height', paneHeights.get(kind) + 'px');
    if (keep) {
      const replacement = content.querySelector(
        '[data-palette-control="' + controlIndex(field) + '"]',
      );
      const identity = (el) =>
        JSON.stringify(
          Object.entries(el.dataset).filter(
            ([key]) => !['paletteControl', 'editing', 'focusValue'].includes(key),
          ),
        );
      if (
        replacement &&
        replacement.tagName === field.tagName &&
        replacement.type === field.type &&
        identity(replacement) === identity(field)
      ) {
        replacement.value = field.value;
        replacement.focus({ preventScroll: true });
        if (caret) replacement.setSelectionRange(...caret);
      }
    }
    view = next;
  } finally {
    painting = false;
  }
}

function send(el, type, extra = {}) {
  if (!painting && view && el && !el.matches(':disabled'))
    bridge.act({ revision: view.revision, index: controlIndex(el), type, ...extra });
}
for (const type of ['click', 'dblclick'])
  content.addEventListener(type, (event) => {
    const el = control(event.target);
    if (el?.matches('button'))
      send(el, type, {
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
  });
content.addEventListener('change', (event) => {
  const el = control(event.target);
  if (el?.matches('input,textarea,select'))
    send(el, 'change', { value: el.value, checked: el.checked });
});
content.addEventListener('click', (event) => {
  const summary = event.target.closest('summary');
  if (summary) send(summary, 'toggle', { open: !summary.parentElement.open });
});
content.addEventListener('keydown', (event) => {
  if (
    event.key === 'Enter' &&
    event.target.matches('input:not([type=checkbox],[type=color]),textarea:not([rows])')
  ) {
    event.preventDefault();
    event.target.blur();
  }
});
content.addEventListener('dragstart', (event) => {
  const el = event.target.closest(
    '[data-object-row],[data-layer-move],[data-layer-row],[data-page-parent]',
  );
  if (!el || !view) return;
  drag = { index: controlIndex(el), revision: view.revision };
  event.dataTransfer.setData('application/x-ivo-palette-item', String(drag.index));
});
content.addEventListener('dragover', (event) => {
  if (drag && event.target.closest('[data-object-row],[data-layer-row],[data-select-page]'))
    event.preventDefault();
});
content.addEventListener('drop', (event) => {
  event.preventDefault();
  const el = event.target.closest('[data-object-row],[data-layer-row],[data-select-page]');
  if (el && drag && drag.revision === view?.revision) {
    const box = el.getBoundingClientRect();
    send(el, 'drop', { from: drag.index, above: event.clientY < box.top + box.height / 2 });
  }
  drag = null;
});
content.addEventListener('dragend', () => {
  drag = null;
});
function resizeDivider(el, y) {
  const panel = el.closest('.pages-panel');
  const height = Math.max(32, Math.min(panel.clientHeight - 78, y));
  paneHeights.set(kind, height);
  panel.style.setProperty('--parent-pane-height', height + 'px');
  el.setAttribute('aria-valuenow', String(height));
}
content.addEventListener('pointerdown', (event) => {
  const el = event.target.closest('.parent-page-divider');
  if (!el || event.button !== 0) return;
  event.preventDefault();
  divider = {
    el,
    id: event.pointerId,
    y: event.clientY,
    height: el.previousElementSibling.offsetHeight,
  };
  el.setPointerCapture(event.pointerId);
});
content.addEventListener('pointermove', (event) => {
  if (divider?.id === event.pointerId)
    resizeDivider(divider.el, divider.height + event.clientY - divider.y);
});
for (const name of ['pointerup', 'lostpointercapture', 'pointercancel'])
  content.addEventListener(name, () => {
    divider = null;
  });
content.addEventListener('keydown', (event) => {
  if (
    event.target.matches('.parent-page-divider') &&
    ['ArrowUp', 'ArrowDown'].includes(event.key)
  ) {
    event.preventDefault();
    resizeDivider(
      event.target,
      event.target.previousElementSibling.offsetHeight + (event.key === 'ArrowDown' ? 8 : -8),
    );
  }
});
const fieldFocus = () =>
  bridge.fieldFocus(
    !!document.activeElement?.matches('input:not([type=checkbox],[type=color]),textarea'),
  );
document.addEventListener('focusin', fieldFocus);
document.addEventListener('focusout', () => queueMicrotask(fieldFocus));
const close = document.querySelector('[data-palette-close]');
const collapse = document.querySelector('[data-palette-collapse]');
const menuButton = document.querySelector('[data-palette-menu]');
close.innerHTML = icon('close');
collapse.innerHTML = icon('panel-collapse');
menuButton.innerHTML = icon('menu');
let handleDrag = null;
menuButton.addEventListener('click', async () => {
  const { left, bottom } = menuButton.getBoundingClientRect();
  menuButton.setAttribute('aria-expanded', 'true');
  try {
    await bridge.menu(Math.round(left), Math.round(bottom));
  } finally {
    menuButton.setAttribute('aria-expanded', 'false');
  }
});
close.addEventListener('click', () => bridge.close());
collapse.addEventListener('click', () => {
  const collapsed = collapse.getAttribute('aria-expanded') === 'true';
  collapse.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'Expand panel' : 'Collapse panel';
  collapse.setAttribute('aria-label', label);
  collapse.title = label;
  bridge.collapse(collapsed);
});
document.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-palette-handle]');
  if (!handle || event.button !== 0 || event.target.closest('button')) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  handleDrag = {
    id: crypto.randomUUID(),
    pointer: event.pointerId,
    handle,
    started: false,
    x: event.screenX,
    y: event.screenY,
    gripX: event.clientX,
    gripY: event.clientY,
  };
});
document.addEventListener('pointermove', (event) => {
  if (handleDrag?.pointer !== event.pointerId) return;
  if (!event.buttons && event.pointerType !== 'touch') return finishHandle('cancel');
  const { id, gripX, gripY } = handleDrag;
  if (
    !handleDrag.started &&
    Math.hypot(event.screenX - handleDrag.x, event.screenY - handleDrag.y) < 4
  )
    return;
  bridge.drag({
    phase: handleDrag.started ? 'move' : 'start',
    id,
    x: event.screenX,
    y: event.screenY,
    gripX,
    gripY,
  });
  handleDrag.started = true;
});
function finishHandle(phase, event) {
  if (!handleDrag || (event?.pointerId != null && handleDrag.pointer !== event.pointerId)) return;
  const { id, started, handle, pointer } = handleDrag;
  handleDrag = null;
  if (started) bridge.drag({ phase, id, x: event?.screenX, y: event?.screenY });
  if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
}
document.addEventListener('pointerup', (event) => finishHandle('drop', event));
for (const type of ['lostpointercapture', 'pointercancel'])
  document.addEventListener(type, (event) => finishHandle('cancel', event));
window.addEventListener('blur', () => {
  finishHandle('cancel');
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && handleDrag) {
    event.preventDefault();
    finishHandle('cancel');
  }
});
let firstLayout = true;
bridge.onView((value, name, published) => {
  kind = name;
  const tab = document.querySelector('[data-palette-name]');
  tab.textContent = PANEL_LABELS[kind];
  tab.title = value?.title || 'No active document';
  show(value);
  if (firstLayout && published) {
    firstLayout = false;
    // Waiting for an animation frame here can deadlock a hidden macOS panel:
    // showing the window is itself waiting for the first usable inspector.
    content.getBoundingClientRect();
    bridge.painted();
  }
});
bridge.ready();
