import { sidebarWidth, DEFAULT_SIDEBAR_WIDTH } from '../../domain/workspace/chrome.js';
/** Current viewport chrome state; never part of an authored document. */
export function isSidebarOpen() {
  return innerWidth <= 760
    ? document.body.classList.contains('nav-open')
    : !document.body.classList.contains('sidebar-collapsed');
}

/** Chrome transitions and resizing keep existing editors/selection DOM mounted. */
export function installSidebar(
  root,
  { getWidth, onChange, prepare = () => {}, allowed = () => true },
) {
  const controller = new AbortController(),
    handle = document.createElement('div');
  handle.className = 'workspace-sidebar-resize';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Resize left sidebar');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-valuemin', '180');
  handle.setAttribute('aria-valuemax', '520');
  root.append(handle);
  // Electron combines native drag/no-drag rectangles in DOM order. This peer
  // must follow the sidebar and pane drag surfaces; visual z-index alone cannot
  // keep their drag rectangles from covering the toggle's no-drag rectangle.
  const headerControls = root.querySelector(':scope > .workspace-header-toggle-slot');
  if (headerControls) root.append(headerControls);
  let gesture = null,
    motionGeneration = 0,
    controlAnimation = null;
  function finishMotion() {
    motionGeneration++;
    root.classList.remove('sidebar-transition');
    controlAnimation?.cancel();
    controlAnimation = null;
  }
  function syncHeader() {
    const first = root.querySelector('.workspace-layout .workspace-pane');
    for (const pane of root.querySelectorAll('.workspace-pane'))
      pane
        .querySelector(':scope > .document-tabs')
        ?.classList.toggle('window-leading-tabs', pane === first);
  }
  function syncVisibility() {
    const open = isSidebarOpen();
    const sidebar = root.querySelector('.sidebar'),
      toggle = root.querySelector('[data-action="menu"]');
    if (!open && sidebar?.contains(document.activeElement)) toggle?.focus({ preventScroll: true });
    if (sidebar) sidebar.inert = !open;
    toggle?.setAttribute('aria-expanded', String(open));
    toggle?.setAttribute('aria-controls', 'vault-navigation');
    syncHeader();
  }
  const listen = (target, name, fn, options = {}) =>
    target.addEventListener(name, fn, { signal: controller.signal, ...options });
  function apply(value) {
    const width = sidebarWidth(value, root.clientWidth);
    root.style.setProperty('--workspace-sidebar-width', width + 'px');
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
    syncVisibility();
    return width;
  }
  function finish(cancel = false) {
    if (!gesture) return;
    const previous = gesture;
    gesture = null;
    apply(cancel ? previous.before : previous.value);
    try {
      handle.releasePointerCapture(previous.pointerId);
    } catch {}
    root.classList.remove('resizing-sidebar');
    if (!cancel && previous.value !== previous.before) onChange(previous.value);
  }
  listen(handle, 'pointerdown', (event) => {
    if (event.button !== 0 || innerWidth <= 760 || !allowed()) return;
    event.preventDefault();
    prepare();
    finishMotion();
    finish(true);
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      before: apply(getWidth()),
      value: apply(getWidth()),
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {}
    root.classList.add('resizing-sidebar');
  });
  listen(
    window,
    'pointermove',
    (event) => {
      if (gesture?.pointerId !== event.pointerId) return;
      if (event.pointerType !== 'touch' && event.buttons === 0) {
        finish(true);
        return;
      }
      event.preventDefault();
      gesture.value = apply(gesture.before + event.clientX - gesture.x);
    },
    { passive: false },
  );
  listen(window, 'pointerup', (event) => {
    if (gesture?.pointerId === event.pointerId) finish();
  });
  listen(window, 'pointercancel', () => finish(true));
  listen(handle, 'lostpointercapture', () => finish(true));
  listen(window, 'blur', () => finish(true));
  listen(
    window,
    'keydown',
    (event) => {
      if (event.key === 'Escape' && gesture) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    },
    { capture: true },
  );
  listen(handle, 'keydown', (event) => {
    if (!allowed() || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    finishMotion();
    prepare();
    const value =
      event.key === 'Home'
        ? DEFAULT_SIDEBAR_WIDTH
        : event.key === 'End'
          ? 520
          : apply(getWidth()) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10);
    onChange(apply(value));
  });
  listen(handle, 'dblclick', (event) => {
    if (!allowed()) return;
    event.preventDefault();
    finishMotion();
    onChange(apply(DEFAULT_SIDEBAR_WIDTH));
  });
  listen(window, 'resize', () => {
    finishMotion();
    finish(true);
    apply(getWidth());
  });
  apply(getWidth());
  function setOpen(open) {
    if (!allowed() || open === isSidebarOpen()) return;
    finish(true);
    const generation = ++motionGeneration;
    const toggle = root.querySelector('[data-action="menu"]'),
      before = toggle?.getBoundingClientRect(),
      animate =
        innerWidth > 760 &&
        typeof root.getAnimations === 'function' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Capture the painted control before cancelling an interrupted animation.
    controlAnimation?.cancel();
    controlAnimation = null;
    root.classList.toggle('sidebar-transition', animate);
    document.body.classList.toggle(
      innerWidth <= 760 ? 'nav-open' : 'sidebar-collapsed',
      innerWidth <= 760 ? open : !open,
    );
    syncVisibility();
    if (animate && before && toggle?.animate) {
      const after = toggle.getBoundingClientRect(),
        x = before.left - after.left,
        y = before.top - after.top;
      if (x || y) {
        controlAnimation = toggle.animate(
          [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 140, easing: 'cubic-bezier(0, .55, .45, 1)' },
        );
      }
    }
    if (!animate) {
      finishMotion();
      return;
    }
    // Flush the new target before collecting the actual CSS transition. A reversed
    // grid transition may finish sooner than the independent control animation.
    void getComputedStyle(root).gridTemplateColumns;
    const animations = root
      .getAnimations({ subtree: false })
      .filter((animation) => animation.transitionProperty === 'grid-template-columns');
    if (controlAnimation) animations.push(controlAnimation);
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (generation === motionGeneration && !controller.signal.aborted) finishMotion();
    });
  }
  return {
    toggle: () => setOpen(!isSidebarOpen()),
    open: () => setOpen(true),
    refreshHeader: syncVisibility,
    refresh() {
      finishMotion();
      apply(getWidth());
    },
    cancel() {
      finishMotion();
      finish(true);
    },
    destroy() {
      finishMotion();
      finish(true);
      controller.abort();
      handle.remove();
    },
  };
}
