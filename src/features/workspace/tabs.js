import { icon } from '../../shared/ui/icons.js';
/** Tab interactions mutate view state only at completion, never authored document state. */
export function installTabBar(
  root,
  {
    getTabs,
    onMove,
    onPin,
    onClose,
    onSplit,
    onAction,
    onDetach,
    onDrag,
    nativeMenu,
    getActions = () => [],
    canAction = () => true,
    allowed = () => true,
    onError = () => {},
  },
) {
  const controller = new AbortController(),
    listen = (target, name, callback, options = {}) =>
      target.addEventListener(name, callback, { signal: controller.signal, ...options });
  let drag = null,
    menu = null,
    menuController = null,
    consumeClick = false,
    clickTimer,
    scrollFrame = 0,
    dragSequence = 0,
    menuEpoch = 0;
  const invoke = (callback, ...args) => {
    try {
      const result = callback?.(...args);
      if (result?.then) result.catch(onError);
      return result;
    } catch (error) {
      onError(error);
    }
  };
  function closeMenu({ focus = false } = {}) {
    menuEpoch++;
    const owner = menu?.owner;
    menuController?.abort();
    menuController = null;
    menu?.element?.remove();
    menu = null;
    if (focus)
      root.querySelector(`[data-tab-id="${CSS.escape(owner)}"]`)?.focus({ preventScroll: true });
  }
  const outsideWindow = (g) =>
    g.clientX < 0 || g.clientX > innerWidth || g.clientY < 0 || g.clientY > innerHeight;
  function dragPayload(g, extra = {}) {
    return {
      tabId: g.id,
      dragId: g.dragId,
      label: g.label,
      screenX: g.screenX,
      screenY: g.screenY,
      clientX: g.clientX,
      clientY: g.clientY,
      grabOffsetX: g.grab,
      grabOffsetY: g.grabY,
      width: g.width,
      height: g.height,
      outside: outsideWindow(g),
      ...extra,
    };
  }
  function restoreOrder(g) {
    for (const node of g.order) g.bar.insertBefore(node, g.plus);
  }
  function finish(cancel = false, { detach = false } = {}) {
    if (!drag) return;
    const old = drag;
    drag = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    old.ghost?.remove();
    old.element.classList.remove('tab-reordering');
    old.bar.classList.remove('tab-bar-reordering');
    if (cancel || detach) restoreOrder(old);
    try {
      old.bar.releasePointerCapture(old.pointerId);
    } catch {}
    if (old.moved) {
      consumeClick = true;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => (consumeClick = false), 0);
      // The host hides its nonactivating preview before opening/activating the actual window.
      invoke(
        onDrag,
        cancel ? 'cancel' : 'end',
        dragPayload(old, {
          disposition: cancel ? 'cancel' : detach ? 'detach' : 'move',
          detached: !cancel && detach,
        }),
      );
      if (!cancel) {
        if (detach) invoke(onDetach, old.id, dragPayload(old));
        else {
          const bar = old.targetBar || old.bar,
            index = [...bar.querySelectorAll('.document-tab')].indexOf(old.element),
            groupId = bar.closest('[data-workspace-group]')?.dataset.workspaceGroup;
          invoke(onMove, old.id, index, groupId);
        }
      }
      if (
        !detach &&
        old.focus?.isConnected &&
        (cancel || !old.targetBar || old.targetBar === old.bar)
      ) {
        old.focus.focus({ preventScroll: true });
        if (old.range?.startContainer.isConnected) {
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(old.range);
        }
      }
    }
  }
  function targetBar(g) {
    return (
      [...root.querySelectorAll('.document-tabs')].find((bar) => {
        const r = bar.getBoundingClientRect();
        return (
          g.clientX >= r.left &&
          g.clientX <= r.right &&
          g.clientY >= r.top - 8 &&
          g.clientY <= r.bottom + 8
        );
      }) || null
    );
  }
  function updateDrag() {
    const g = drag;
    if (!g?.moved) return;
    g.targetBar = targetBar(g);
    const bar = g.targetBar,
      bounds = bar?.getBoundingClientRect(),
      x = g.clientX;
    if (g.ghost) {
      g.ghost.style.left = x - g.grab + 'px';
      g.ghost.style.top = (bounds ? bounds.top : g.clientY - g.grabY) + 'px';
      g.ghost.classList.toggle('tab-drag-outside', !bar);
    }
    if (!bar) return;
    const others = [...bar.querySelectorAll('.document-tab')].filter((tab) => tab !== g.element),
      next = others.find((tab) => {
        const r = tab.getBoundingClientRect();
        return x < r.left + r.width / 2;
      });
    bar.insertBefore(g.element, next || bar.querySelector('.document-tab-plus'));
    bar.scrollLeft += x < bounds.left + 32 ? -10 : x > bounds.right - 32 ? 10 : 0;
  }
  function autoScroll() {
    scrollFrame = 0;
    if (!drag?.moved || !drag.targetBar) return;
    const bounds = drag.targetBar.getBoundingClientRect();
    if (drag.clientX < bounds.left + 32 || drag.clientX > bounds.right - 32) {
      updateDrag();
      scrollFrame = requestAnimationFrame(autoScroll);
    }
  }
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  function menuItem(value, label, { disabled = false, checked, art } = {}) {
    return `<button role="${checked === undefined ? 'menuitem' : 'menuitemcheckbox'}" ${checked === undefined ? '' : `aria-checked="${checked}"`} data-tab-option="${escape(value)}" ${disabled ? 'disabled' : ''}>${art ? icon(art) : ''}<span>${escape(label)}</span></button>`;
  }
  function showMenu(button, event) {
    if (!allowed()) return;
    finish(true);
    closeMenu();
    const id = button.dataset.tabId,
      tabs = getTabs(button.closest('[data-workspace-group]')?.dataset.workspaceGroup),
      tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    const index = tabs.indexOf(tab),
      element = document.createElement('div'),
      separator = '<div class="menu-separator" role="separator"></div>',
      item = (value, label, options = {}) =>
        menuItem(value, label, { ...options, disabled: options.disabled || !canAction(value, id) });
    element.className = 'tab-context-menu';
    element.setAttribute('role', 'menu');
    element.setAttribute('aria-label', 'Tab options');
    const sections = [];
    if (onAction)
      sections.push(item('new-tab', 'New tab') + item('duplicate-view', 'Duplicate tab'));
    if (onDetach)
      sections.push(
        (onAction ? item('open-new-window', 'Open in new window') : '') +
          item('detach', 'Move to new window'),
      );
    sections.push(
      item('pin', tab.pinned ? 'Unpin tab' : 'Pin tab', { checked: !!tab.pinned, art: 'pin' }),
    );
    if (onSplit)
      sections.push(item('split-right', 'Split right') + item('split-down', 'Split down'));
    sections.push(
      item('left', 'Move tab left', { disabled: index === 0 }) +
        item('right', 'Move tab right', { disabled: index === tabs.length - 1 }),
    );
    sections.push(
      item('close', 'Close tab') +
        (onAction
          ? item('close-others', 'Close other tabs', { disabled: tabs.length === 1 }) +
            item('close-left', 'Close tabs to the left', { disabled: index === 0 }) +
            item('close-right', 'Close tabs to the right', {
              disabled: index === tabs.length - 1,
            }) +
            item('close-all', 'Close all tabs')
          : ''),
    );
    if (onAction) {
      const seen = new Set([
          'new-tab',
          'duplicate-view',
          'open-new-window',
          'detach',
          'pin',
          'split-right',
          'split-down',
          'left',
          'right',
          'close',
          'close-others',
          'close-left',
          'close-right',
          'close-all',
        ]),
        extra = [];
      for (const option of getActions(id).slice(0, 20)) {
        if (
          !option ||
          typeof option.action !== 'string' ||
          typeof option.label !== 'string' ||
          seen.has(option.action)
        )
          continue;
        seen.add(option.action);
        extra.push(item(option.action, option.label, { disabled: option.disabled }));
      }
      if (extra.length) sections.push(extra.join(''));
    }
    element.innerHTML = sections.join(separator);
    Object.assign(element.style, {
      maxHeight: Math.max(80, innerHeight - 8) + 'px',
      overflowY: 'auto',
    });
    const r = button.getBoundingClientRect();
    function dispatch(value, position = {}) {
      const option = [...element.querySelectorAll('[data-tab-option]')].find(
        (button) => button.dataset.tabOption === value,
      );
      if (
        !option ||
        option.disabled ||
        !allowed() ||
        !canAction(value, id) ||
        !getTabs(button.closest('[data-workspace-group]')?.dataset.workspaceGroup).some(
          (tab) => tab.id === id,
        )
      )
        return;
      closeMenu();
      if (value === 'pin') {
        invoke(onPin, id, !tab.pinned);
        root.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      } else if (value === 'close') invoke(onClose, id);
      else if (value === 'detach') invoke(onDetach, id, position);
      else if (value.startsWith('split-'))
        invoke(onSplit, id, value === 'split-down' ? 'column' : 'row');
      else if (value === 'left' || value === 'right') {
        invoke(onMove, id, index + (value === 'left' ? -1 : 1));
        root.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      } else invoke(onAction, value, id);
    }
    if (nativeMenu) {
      const expected = menuEpoch,
        items = [...element.children].map((child) =>
          child.matches('[role=separator]')
            ? { type: 'separator' }
            : {
                id: child.dataset.tabOption,
                label: child.textContent,
                enabled: !child.disabled,
                ...(child.hasAttribute('aria-checked')
                  ? { checked: child.getAttribute('aria-checked') === 'true' }
                  : {}),
              },
        );
      menu = { owner: id, element: null };
      try {
        Promise.resolve(
          nativeMenu(items, {
            anchor: button,
            x: event?.clientX ?? r.left,
            y: event?.clientY ?? r.bottom,
          }),
        )
          .then((value) => {
            if (expected !== menuEpoch) return;
            if (value == null) {
              closeMenu();
              return;
            }
            dispatch(value, {
              screenX: event?.screenX ?? window.screenX + r.left,
              screenY: event?.screenY ?? window.screenY + r.bottom,
            });
            if (expected === menuEpoch) closeMenu();
          })
          .catch((error) => {
            if (expected === menuEpoch) {
              closeMenu();
              onError(error);
            }
          });
      } catch (error) {
        if (expected === menuEpoch) {
          closeMenu();
          onError(error);
        }
      }
      return;
    }
    document.body.append(element);
    menu = { element, owner: id };
    menuController = new AbortController();
    const bounds = element.getBoundingClientRect();
    element.style.left =
      Math.max(4, Math.min(event?.clientX ?? r.left, innerWidth - bounds.width - 4)) + 'px';
    element.style.top =
      Math.max(4, Math.min(event?.clientY ?? r.bottom, innerHeight - bounds.height - 4)) + 'px';
    element.addEventListener(
      'click',
      (event) => {
        const action = event.target.closest('[data-tab-option]');
        if (action)
          dispatch(action.dataset.tabOption, { screenX: event.screenX, screenY: event.screenY });
      },
      { signal: menuController.signal },
    );
    element.addEventListener(
      'keydown',
      (event) => {
        const items = [...element.querySelectorAll('button:not(:disabled)')];
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const index = items.indexOf(document.activeElement),
            next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeMenu({ focus: true });
        } else if (event.key === 'Tab') closeMenu();
      },
      { signal: menuController.signal },
    );
    element.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  listen(
    root,
    'pointerdown',
    (event) => {
      const button = event.target.closest('[data-tab-id]');
      if (!button || event.button !== 0 || !allowed()) return;
      closeMenu();
      finish(true);
      const bar = button.closest('.document-tabs'),
        element = button.closest('.document-tab'),
        r = element.getBoundingClientRect(),
        selection = window.getSelection();
      drag = {
        id: button.dataset.tabId,
        dragId: ++dragSequence,
        label: button.querySelector('span')?.textContent || button.textContent,
        element,
        bar,
        plus: bar.querySelector('.document-tab-plus'),
        order: [...bar.querySelectorAll('.document-tab')],
        startX: event.clientX,
        startY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        grab: event.clientX - r.left,
        grabY: event.clientY - r.top,
        width: r.width,
        height: r.height,
        pointerId: event.pointerId,
        focus: document.activeElement,
        range: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null,
        moved: false,
      };
    },
    { capture: true },
  );
  listen(
    window,
    'pointermove',
    (event) => {
      const g = drag;
      if (!g || event.pointerId !== g.pointerId) return;
      if (event.pointerType !== 'touch' && event.buttons === 0) {
        finish(true);
        return;
      }
      g.clientX = event.clientX;
      g.clientY = event.clientY;
      g.screenX = event.screenX;
      g.screenY = event.screenY;
      if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 4) return;
      if (!g.moved) {
        g.moved = true;
        const rect = g.element.getBoundingClientRect();
        g.ghost = g.element.cloneNode(true);
        g.ghost.removeAttribute('id');
        g.ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
        g.ghost.setAttribute('aria-hidden', 'true');
        g.ghost.classList.add('tab-drag-ghost');
        Object.assign(g.ghost.style, {
          top: rect.top + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
        });
        document.body.append(g.ghost);
        g.element.classList.add('tab-reordering');
        g.bar.classList.add('tab-bar-reordering');
        try {
          g.bar.setPointerCapture(event.pointerId);
        } catch {}
        invoke(onDrag, 'start', dragPayload(g));
      }
      event.preventDefault();
      updateDrag();
      invoke(onDrag, 'move', dragPayload(g));
      if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
    },
    { passive: false },
  );
  listen(window, 'pointerup', (event) => {
    const g = drag;
    if (g?.pointerId !== event.pointerId) return;
    g.clientX = event.clientX;
    g.clientY = event.clientY;
    g.screenX = event.screenX;
    g.screenY = event.screenY;
    if (g.moved) updateDrag();
    if (g.moved && onDetach && outsideWindow(g)) {
      finish(false, { detach: true });
      return;
    }
    finish(g.moved && !g.targetBar);
  });
  listen(window, 'pointercancel', () => finish(true));
  listen(root, 'lostpointercapture', (event) => {
    if (drag?.pointerId === event.pointerId) finish(true);
  });
  listen(
    root,
    'click',
    (event) => {
      if (consumeClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  listen(root, 'contextmenu', (event) => {
    const button = event.target.closest('[data-tab-id]');
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      showMenu(button, event);
    }
  });
  listen(
    root,
    'keydown',
    (event) => {
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
        return;
      }
      const button = event.target.closest('[data-tab-id]');
      if (!button || !allowed()) return;
      if (event.altKey && event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const id = button.dataset.tabId,
          tabs = getTabs(button.closest('[data-workspace-group]')?.dataset.workspaceGroup),
          index = tabs.findIndex((tab) => tab.id === id);
        invoke(onMove, id, index + (event.key === 'ArrowLeft' ? -1 : 1));
        root.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        event.stopPropagation();
        showMenu(button);
      }
    },
    { capture: true },
  );
  listen(
    document,
    'pointerdown',
    (event) => {
      if (menu?.element && !menu.element.contains(event.target)) closeMenu();
    },
    { capture: true },
  );
  listen(window, 'blur', () => {
    finish(true);
    closeMenu();
  });
  listen(window, 'resize', () => {
    finish(true);
    closeMenu();
  });
  return {
    cancel() {
      finish(true);
      closeMenu();
    },
    completeExternalDrop({ tabId, dragId, screenX, screenY } = {}) {
      const g = drag;
      if (
        !g?.moved ||
        !onDetach ||
        g.id !== tabId ||
        g.dragId !== dragId ||
        ![screenX, screenY].every(Number.isFinite)
      )
        return false;
      const offsetX = g.screenX - g.clientX,
        offsetY = g.screenY - g.clientY;
      g.screenX = screenX;
      g.screenY = screenY;
      g.clientX = screenX - offsetX;
      g.clientY = screenY - offsetY;
      if (!outsideWindow(g)) return false;
      finish(false, { detach: true });
      return true;
    },
    destroy() {
      finish(true);
      closeMenu();
      clearTimeout(clickTimer);
      controller.abort();
    },
  };
}
