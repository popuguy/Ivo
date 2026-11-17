import { icon } from '../../shared/ui/icons.js';
let sequence = 0,
  activeFallback = null;
/** A bounded action-ID menu shared by document navigation surfaces; callers retain the action's owner. */
function normalizeItems(items) {
  const ids = new Set();
  let count = 0;
  const text = (value, limit) =>
    // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
    typeof value === 'string' && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
  function visit(values, depth = 0, inheritedEnabled = true) {
    const result = [];
    for (const input of Array.isArray(values) ? values : []) {
      if (count >= 50) break;
      if (!input || typeof input !== 'object') continue;
      if (input.type === 'separator' || input.separator === true) {
        if (result.length && result.at(-1).type !== 'separator') {
          result.push({ type: 'separator' });
          count++;
        }
        continue;
      }
      if (!text(input.label, 200) || !input.label.trim()) continue;
      const enabled = inheritedEnabled && input.enabled !== false && input.disabled !== true,
        item = { label: input.label, enabled };
      if (Array.isArray(input.submenu)) {
        if (depth >= 2) continue;
        count++;
        item.submenu = visit(input.submenu, depth + 1, enabled);
        if (!item.submenu.length) continue;
        if (text(input.id, 256) && input.id && !ids.has(input.id)) {
          item.id = input.id;
          ids.add(input.id);
        }
      } else {
        if (!text(input.id, 256) || !input.id || ids.has(input.id)) continue;
        item.id = input.id;
        ids.add(input.id);
        count++;
      }
      if (typeof input.checked === 'boolean') item.checked = input.checked;
      result.push(item);
    }
    while (result.at(-1)?.type === 'separator') result.pop();
    return result;
  }
  return visit(items);
}
function enabledActions(items, result = new Set()) {
  for (const item of items)
    if (item.enabled !== false) {
      if (item.submenu) enabledActions(item.submenu, result);
      else if (item.id) result.add(item.id);
    }
  return result;
}
export async function showNavigationMenu(items, { x, y, anchor } = {}) {
  const request = ++sequence;
  activeFallback?.();
  activeFallback = null;
  const normalized = normalizeItems(items),
    actions = enabledActions(normalized);
  if (!normalized.length || !actions.size) return null;
  if (typeof globalThis.ivoNative?.showNavigationMenu === 'function') {
    try {
      const action = await globalThis.ivoNative.showNavigationMenu(normalized);
      return request === sequence && actions.has(action) ? action : null;
    } catch {
      if (request !== sequence || (anchor && !anchor.isConnected)) return null;
    }
  }
  if (typeof document === 'undefined' || (anchor && !anchor.isConnected)) return null;
  return new Promise((resolve) => {
    const controller = new AbortController(),
      listen = (target, name, callback, options = {}) =>
        target.addEventListener(name, callback, { signal: controller.signal, ...options }),
      origin = anchor instanceof HTMLElement ? anchor : document.activeElement,
      menus = [];
    let settled = false;
    function finish(action = null, { focus = false } = {}) {
      if (settled) return;
      settled = true;
      controller.abort();
      const heldFocus = menus.some((menu) => menu.element.contains(document.activeElement));
      for (const menu of menus) menu.element.remove();
      if (activeFallback === cancel) activeFallback = null;
      if (focus && heldFocus && origin?.isConnected && !origin.closest('[inert]'))
        origin.focus({ preventScroll: true });
      resolve(actions.has(action) ? action : null);
    }
    const cancel = () => finish();
    activeFallback = cancel;
    function removeAfter(depth) {
      while (menus.length > depth + 1) {
        const old = menus.pop();
        old.owner?.setAttribute('aria-expanded', 'false');
        old.element.remove();
      }
    }
    const buttons = (menu) => [...menu.element.querySelectorAll(':scope > button:not(:disabled)')];
    function focusItem(menu, index) {
      const list = buttons(menu);
      if (list.length) list[(index + list.length) % list.length].focus({ preventScroll: true });
    }
    function place(element, left, top, { parent } = {}) {
      const bounds = element.getBoundingClientRect();
      if (parent && left + bounds.width > innerWidth - 4)
        left = parent.getBoundingClientRect().left - bounds.width - 2;
      element.style.left = Math.max(4, Math.min(left, innerWidth - bounds.width - 4)) + 'px';
      element.style.top = Math.max(4, Math.min(top, innerHeight - bounds.height - 4)) + 'px';
    }
    function createMenu(values, { depth = 0, parent, left, top } = {}) {
      removeAfter(depth - 1);
      const element = document.createElement('div'),
        menu = { element, depth, owner: parent };
      element.className = 'tab-context-menu navigation-context-menu';
      element.id = 'ivo-navigation-menu-' + request + '-' + depth;
      element.setAttribute('role', 'menu');
      element.setAttribute('aria-label', parent?.textContent || 'Document options');
      Object.assign(element.style, {
        maxWidth: 'calc(100vw - 8px)',
        maxHeight: 'calc(100vh - 8px)',
        overflowY: 'auto',
      });
      for (const item of values) {
        if (item.type === 'separator') {
          const line = document.createElement('div');
          line.className = 'menu-separator';
          line.setAttribute('role', 'separator');
          element.append(line);
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.dataset.navigationAction = item.id || '';
        button.disabled = item.enabled === false;
        button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
        if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
        const label = document.createElement('span');
        label.textContent = item.label;
        button.append(label);
        if (item.submenu) {
          button.setAttribute('aria-haspopup', 'menu');
          button.setAttribute('aria-expanded', 'false');
          button.insertAdjacentHTML('beforeend', icon('chevron-right'));
          const arrow = button.lastElementChild;
          Object.assign(arrow.style, { marginLeft: 'auto' });
        }
        listen(button, 'pointerenter', () => {
          if (item.enabled === false) return;
          if (item.submenu) openSubmenu(menu, button, item.submenu, false);
          else removeAfter(depth);
        });
        listen(button, 'click', (event) => {
          event.preventDefault();
          if (item.enabled === false) return;
          if (item.submenu) openSubmenu(menu, button, item.submenu, true);
          else finish(item.id);
        });
        button._navigationSubmenu = item.submenu;
        element.append(button);
      }
      menus.push(menu);
      document.body.append(element);
      if (parent) parent.setAttribute('aria-controls', element.id);
      place(element, left, top, { parent });
      listen(element, 'keydown', (event) => {
        if (event.target.closest('[role=menu]') !== element) return;
        const list = buttons(menu),
          index = list.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          removeAfter(depth);
          focusItem(
            menu,
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? list.length - 1
                : index + (event.key === 'ArrowDown' ? 1 : -1),
          );
        } else if (event.key === 'ArrowRight' && document.activeElement?._navigationSubmenu) {
          event.preventDefault();
          event.stopPropagation();
          openSubmenu(
            menu,
            document.activeElement,
            document.activeElement._navigationSubmenu,
            true,
          );
        } else if (event.key === 'ArrowLeft' && depth > 0) {
          event.preventDefault();
          event.stopPropagation();
          const owner = menu.owner;
          removeAfter(depth - 1);
          owner?.focus({ preventScroll: true });
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (depth > 0) {
            const owner = menu.owner;
            removeAfter(depth - 1);
            owner?.focus({ preventScroll: true });
          } else finish(null, { focus: true });
        } else if (event.key === 'Tab') finish();
      });
      return menu;
    }
    function openSubmenu(menu, button, items, focus) {
      if (button.disabled) return;
      let submenu = menus[menu.depth + 1];
      if (submenu?.owner !== button) {
        const r = button.getBoundingClientRect();
        submenu = createMenu(items, {
          depth: menu.depth + 1,
          parent: button,
          left: r.right + 2,
          top: r.top,
        });
      }
      button.setAttribute('aria-expanded', 'true');
      if (focus) focusItem(submenu, 0);
    }
    const rect = anchor?.getBoundingClientRect(),
      main = createMenu(normalized, {
        left: Number.isFinite(x) ? x : (rect?.left ?? 4),
        top: Number.isFinite(y) ? y : (rect?.bottom ?? 4),
      });
    focusItem(main, 0);
    listen(
      document,
      'pointerdown',
      (event) => {
        if (!menus.some((menu) => menu.element.contains(event.target))) finish();
      },
      { capture: true },
    );
    listen(window, 'blur', () => finish());
    listen(window, 'resize', () => finish());
  });
}
