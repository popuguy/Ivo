/** Retained split layout. Tree changes move existing pane nodes; divider motion only changes flex ratios. */
export function installWorkspaceLayout(
  container,
  { createPane, onRatio, prepare = () => {}, allowed = () => true } = {},
) {
  const controller = new AbortController(),
    listen = (target, name, callback, options = {}) =>
      target.addEventListener(name, callback, { signal: controller.signal, ...options }),
    splits = new Map();
  let gesture = null;
  function ratio(element, value) {
    const amount = Math.max(0.1, Math.min(0.9, value));
    element.style.setProperty('--split-ratio', amount);
    const separator = element.querySelector(':scope > .workspace-divider');
    separator?.setAttribute('aria-valuenow', String(Math.round(amount * 100)));
    return amount;
  }
  function finish(cancel = false) {
    if (!gesture) return;
    const old = gesture;
    gesture = null;
    const value = ratio(old.element, cancel ? old.before : old.value);
    try {
      old.separator.releasePointerCapture(old.pointerId);
    } catch {}
    if (!cancel && value !== old.before) onRatio(old.id, value);
    container.classList.remove('resizing-workspace');
  }
  function reconcile(layout) {
    finish(true);
    const used = new Set();
    function build(node) {
      if (node.type === 'group') return createPane(node.id);
      used.add(node.id);
      let element = splits.get(node.id);
      if (!element) {
        element = document.createElement('div');
        element.className = 'workspace-split';
        element.dataset.split = node.id;
        const separator = document.createElement('div');
        separator.className = 'workspace-divider';
        separator.dataset.splitResize = node.id;
        separator.tabIndex = 0;
        separator.setAttribute('role', 'separator');
        separator.setAttribute('aria-valuemin', '10');
        separator.setAttribute('aria-valuemax', '90');
        element.append(separator);
        splits.set(node.id, element);
      }
      element.dataset.axis = node.axis;
      const separator = element.querySelector(':scope > .workspace-divider');
      separator.setAttribute('aria-orientation', node.axis === 'row' ? 'vertical' : 'horizontal');
      separator.setAttribute(
        'aria-label',
        node.axis === 'row' ? 'Resize side-by-side panes' : 'Resize stacked panes',
      );
      ratio(element, node.ratio);
      const children = [build(node.first), separator, build(node.second)];
      for (const [index, child] of children.entries())
        if (element.children[index] !== child)
          element.insertBefore(child, element.children[index] || null);
      for (const child of [...element.children]) if (!children.includes(child)) child.remove();
      return element;
    }
    const element = build(layout);
    if (container.firstElementChild !== element) container.replaceChildren(element);
    for (const [id, element] of splits)
      if (!used.has(id)) {
        element.remove();
        splits.delete(id);
      }
  }
  listen(container, 'pointerdown', (event) => {
    const separator = event.target.closest('[data-split-resize]');
    if (!separator || event.button !== 0 || !allowed()) return;
    event.preventDefault();
    prepare();
    finish(true);
    const element = separator.parentElement,
      before = Number(element.style.getPropertyValue('--split-ratio'));
    gesture = {
      id: separator.dataset.splitResize,
      element,
      separator,
      before,
      value: before,
      pointerId: event.pointerId,
      rect: element.getBoundingClientRect(),
      axis: element.dataset.axis,
    };
    separator.focus({ preventScroll: true });
    try {
      separator.setPointerCapture(event.pointerId);
    } catch {}
    container.classList.add('resizing-workspace');
  });
  listen(
    window,
    'pointermove',
    (event) => {
      const g = gesture;
      if (!g || event.pointerId !== g.pointerId) return;
      if (event.pointerType !== 'touch' && event.buttons === 0) {
        finish(true);
        return;
      }
      event.preventDefault();
      g.value = ratio(
        g.element,
        g.axis === 'row'
          ? (event.clientX - g.rect.left) / Math.max(1, g.rect.width)
          : (event.clientY - g.rect.top) / Math.max(1, g.rect.height),
      );
    },
    { passive: false },
  );
  listen(window, 'pointerup', (event) => {
    if (gesture?.pointerId === event.pointerId) finish();
  });
  listen(window, 'pointercancel', () => finish(true));
  listen(container, 'lostpointercapture', (event) => {
    if (gesture?.pointerId === event.pointerId) finish(true);
  });
  listen(container, 'keydown', (event) => {
    if (event.key === 'Escape' && gesture) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
      return;
    }
    const separator = event.target.closest('[data-split-resize]');
    if (!separator || !allowed()) return;
    const element = separator.parentElement,
      axis = element.dataset.axis,
      keys = axis === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (![...keys, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    prepare();
    const current = Number(element.style.getPropertyValue('--split-ratio')),
      value = ratio(
        element,
        event.key === 'Home'
          ? 0.5
          : event.key === 'End'
            ? 0.9
            : current + (event.key === keys[0] ? -1 : 1) * (event.shiftKey ? 0.1 : 0.02),
      );
    onRatio(separator.dataset.splitResize, value);
  });
  listen(window, 'blur', () => finish(true));
  return {
    reconcile,
    cancel: () => finish(true),
    destroy() {
      finish(true);
      controller.abort();
      splits.clear();
    },
  };
}
