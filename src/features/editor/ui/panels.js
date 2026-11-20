import {
  PANEL_LABELS,
  normalizePanels,
  movePanel,
  panelPreset,
  DEFAULT_DOCK_WIDTH,
} from '../../../domain/workspace/panels.js';
import { createPanelDragPreview, nativeDockHit } from './panel-drag.js';
const KEY = 'ivo:workspace-panels:1';
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
/** View-only bounds. Shrinking a window can never strand a panel off screen. */
export function panelBounds(value, size) {
  const w = clamp(finite(value.w, 280), Math.min(200, size.w), Math.max(0, size.w)),
    h = clamp(finite(value.h, 480), Math.min(160, size.h), Math.max(0, size.h));
  return {
    x: clamp(finite(value.x, size.w - w - 20), 0, Math.max(0, size.w - w)),
    y: clamp(finite(value.y, 24), 0, Math.max(0, size.h - h)),
    w,
    h,
  };
}
export function dockWidth(value, width) {
  return clamp(
    finite(value, DEFAULT_DOCK_WIDTH),
    Math.min(200, width / 2),
    Math.max(0, Math.min(480, width - 224)),
  );
}
/** Retained context groups. Only their containers move; the document's input DOM never does. */
export function installWorkspacePanels(
  editor,
  {
    prepare = () => {},
    allowed = () => true,
    editing = () => true,
    commandEnabled = () => true,
    onCommand = () => {},
    wrapOptionsShown = () => false,
    initialState,
    openExternal,
    dragExternal,
    splitSurface = null,
    presets,
    onError = () => {},
    onChange = () => {},
    onRender = () => {},
    onSelect = () => {},
  } = {},
) {
  const original = editor.querySelector('.canvas-properties'),
    template = original.cloneNode(true),
    dock = document.createElement('aside'),
    groups = new Map(),
    panels = new Map(),
    controller = new AbortController(),
    listen = (target, name, fn, options = {}) =>
      target.addEventListener(
        name,
        (event) => {
          if (
            target === editor &&
            event.target instanceof Element &&
            event.target.closest('.scene-editor') !== editor
          )
            return;
          fn(event);
        },
        { signal: controller.signal, ...options },
      );
  dock.className = 'canvas-panel-dock';
  dock.setAttribute('aria-label', 'Context panel dock');
  original.replaceWith(dock);
  for (const tab of template.querySelectorAll('[data-canvas-panel]')) {
    const content = document.createElement('div');
    content.className = 'canvas-panel-content';
    content.setAttribute('role', 'tabpanel');
    content.id =
      'context-' +
      tab.dataset.canvasPanel +
      '-' +
      editor.closest('[data-workspace-tab]')?.dataset.workspaceTab;
    tab.setAttribute('aria-controls', content.id);
    panels.set(tab.dataset.canvasPanel, { tab, content });
  }
  let external = new Set();
  const local = (kind) => !saved.closed.includes(kind) && !external.has(kind);
  let saved;
  try {
    saved = normalizePanels(initialState || JSON.parse(localStorage.getItem(KEY)));
  } catch {
    saved = normalizePanels();
  }
  let gesture = null,
    menu = null,
    menuButton = null,
    selectedGroup = saved.groups[0].id;
  const surface = () => (splitSurface?.clientWidth ? splitSurface : editor);
  const size = () => {
    const bounds = surface();
    return { w: bounds.clientWidth, h: bounds.clientHeight };
  };
  const drop = document.createElement('div');
  drop.className = 'workspace-dock-target';
  drop.hidden = true;
  drop.setAttribute('aria-hidden', 'true');
  editor.append(drop);
  const nativeGuide = document.createElement('div');
  nativeGuide.className = 'native-panel-dock-guide';
  nativeGuide.hidden = true;
  nativeGuide.setAttribute('aria-hidden', 'true');
  document.body.append(nativeGuide);
  function dockPaletteAt({ action, kind, x, y, id }) {
    if (action === 'failed') {
      if (gesture?.nativeId === id) end(true);
      onError(new Error('Could not open the floating panel.'));
      return false;
    }
    nativeGuide.hidden = true;
    if (action === 'clear' || !allowed() || !panels.has(kind)) return false;
    if (action === 'hide') {
      if (!saved.closed.includes(kind)) saved.closed.push(kind);
      apply();
      store();
      return true;
    }
    const target = nativeDockHit(surface(), groups, x, y, nativeGuide, action === 'preview');
    if (!target) return false;
    if (action === 'preview') return true;
    if (action !== 'drop') return false;
    saved.closed = saved.closed.filter((item) => item !== kind);
    if (target.type === 'tabs') {
      const tabs = saved.groups
        .find((item) => item.id === target.id)
        .tabs.filter((item) => item !== kind);
      const at = tabs.indexOf(target.before);
      saved = movePanel(saved, kind, target.id, at < 0 ? tabs.length : at);
    } else {
      saved = movePanel(saved, kind, null, 0, { floating: false });
      const placed = groupFor(kind);
      const next = saved.groups.filter((item) => item !== placed);
      const at = next.findIndex((item) => item.id === target.id);
      next.splice(at < 0 ? next.length : at + Number(target.type === 'below'), 0, placed);
      saved.groups = next;
    }
    selectedGroup = groupFor(kind).id;
    editor.classList.add('show-properties');
    onSelect(kind);
    apply();
    store();
    onRender();
    return true;
  }
  function apply() {
    const bounds = size(),
      used = new Set(),
      visible = saved.groups.filter((group) => !group.collapsed && group.tabs.some(local));
    editor.classList.toggle(
      'panel-floating',
      !!visible.length && visible.every((group) => group.floating),
    );
    editor.classList.toggle('panel-collapsed', !visible.length);
    editor.style.setProperty('--context-panel-width', dockWidth(saved.dock, bounds.w) + 'px');
    for (const value of saved.groups) {
      used.add(value.id);
      let element = groups.get(value.id);
      if (!element) {
        element = document.createElement('section');
        element.className = 'canvas-properties context-panel-group';
        element.dataset.contextGroup = value.id;
        element.innerHTML =
          template.querySelector('.canvas-panel-microbar').outerHTML +
          template.querySelector('.context-panel-header').outerHTML +
          '<div class="workspace-panel-resize" tabindex="0" role="separator" aria-label="Resize context panel"></div>';
        element.querySelector('.canvas-panel-tabs').replaceChildren();
        groups.set(value.id, element);
      }
      const parent = value.floating ? editor : dock;
      if (element.parentElement !== parent) parent.append(element);
      element.dataset.floating = String(value.floating);
      element.hidden = value.collapsed || !value.tabs.some(local);
      element.classList.toggle('context-group-collapsed', value.collapsed);
      const rect = panelBounds(value.rect, bounds),
        tabs = element.querySelector('.canvas-panel-tabs'),
        resize = element.querySelector('.workspace-panel-resize');
      for (const [key, amount] of Object.entries({
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
      }))
        element.style[key] = value.floating ? amount + 'px' : '';
      resize.setAttribute('aria-orientation', value.floating ? 'horizontal' : 'vertical');
      resize.setAttribute('aria-valuemin', '0');
      resize.setAttribute('aria-valuemax', String(Math.round(bounds.w)));
      resize.setAttribute(
        'aria-valuenow',
        String(Math.round(value.floating ? rect.w : dockWidth(saved.dock, bounds.w))),
      );
      if (saved.closed.includes(value.active))
        value.active = value.tabs.find((kind) => !saved.closed.includes(kind)) || value.tabs[0];
      for (const [index, kind] of value.tabs.entries()) {
        const item = panels.get(kind),
          active = kind === (local(value.active) ? value.active : value.tabs.find(local));
        if (tabs.children[index] !== item.tab)
          tabs.insertBefore(item.tab, tabs.children[index] || null);
        if (item.content.parentElement !== element) element.append(item.content);
        item.tab.hidden = !local(kind);
        item.tab.setAttribute('aria-selected', String(active));
        item.tab.tabIndex = active ? 0 : -1;
        item.content.hidden = !active || item.tab.hidden || element.hidden;
        item.content.style.display = item.content.hidden ? 'none' : '';
      }
    }
    for (const [id, element] of groups)
      if (!used.has(id)) {
        element.remove();
        groups.delete(id);
      }
    // Restore dock order without disturbing retained controls in each group.
    let at = 0;
    for (const group of saved.groups.filter((group) => !group.floating)) {
      const element = groups.get(group.id);
      if (dock.children[at] !== element) dock.insertBefore(element, dock.children[at] || null);
      at++;
    }
  }
  function store() {
    const first = saved.groups[0];
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...saved,
          floating: first.floating,
          collapsed: first.collapsed,
          rect: first.rect,
        }),
      );
    } catch {}
    onChange(structuredClone(saved));
  }
  function closeMenu() {
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton = null;
    menu?.remove();
    menu = null;
  }
  function groupFor(kind) {
    return saved.groups.find((group) => group.tabs.includes(kind));
  }
  function select(kind) {
    const group = groupFor(kind);
    if (!group || saved.closed.includes(kind)) return;
    if (selectedGroup === group.id && group.active === kind) return;
    selectedGroup = group.id;
    group.active = kind;
    onSelect(kind);
    apply();
  }
  function groupTarget() {
    return saved.groups.find((group) => group.id === selectedGroup) || saved.groups[0];
  }
  function clearDrop() {
    drop.hidden = true;
    for (const element of groups.values()) element.classList.remove('context-panel-drop');
  }
  function end(cancel = false) {
    if (!gesture) return;
    const previous = gesture;
    gesture = null;
    if (cancel && previous.nativeId) dragExternal({ phase: 'cancel', id: previous.nativeId });
    if (cancel) {
      saved = previous.before;
      if (previous.nativeKind) {
        selectedGroup = previous.previousGroup;
        onSelect(groupTarget().active);
      }
    }
    clearDrop();
    previous.ghost?.remove();
    previous.target.classList.remove('context-tab-dragging');
    delete editor.dataset.panelGesture;
    try {
      previous.capture.releasePointerCapture(previous.pointerId);
    } catch {}
    apply();
    if (!cancel) {
      store();
      onRender();
    }
  }
  function begin(event, kind, group, panelKind) {
    if (!allowed() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    prepare();
    end(true);
    const element = groups.get(group?.id),
      origin = surface().getBoundingClientRect(),
      box = element?.getBoundingClientRect(),
      before = structuredClone(saved),
      target = event.target.closest(
        '.canvas-panel-microbar,.workspace-panel-resize,[data-canvas-panel]',
      );
    const previousGroup = selectedGroup;
    selectedGroup = group?.id || selectedGroup;
    if (kind === 'resize') {
      target.dataset.pointerFocus = '';
      target.focus({ preventScroll: true });
    }
    for (const control of editor.querySelectorAll('.workspace-panel-resize'))
      if (document.activeElement === control) control.dataset.pointerFocus = '';
    gesture = {
      kind,
      groupId: group?.id,
      previousGroup,
      panelKind,
      target,
      capture: kind === 'tab' ? editor : target,
      strip: element?.querySelector('.context-panel-header').getBoundingClientRect(),
      grip: target.getBoundingClientRect(),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      before,
      rect: box ? { x: box.x - origin.x, y: box.y - origin.y, w: box.width, h: box.height } : {},
      moved: false,
      ghost: null,
    };
    try {
      gesture.capture.setPointerCapture(event.pointerId);
    } catch {}
    editor.dataset.panelGesture = kind;
  }
  function hit(event, exclude) {
    return saved.groups.find((value) => {
      if (value.id === exclude || value.collapsed) return false;
      const rect = groups.get(value.id).querySelector('.canvas-panel-tabs').getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top - 8 &&
        event.clientY <= rect.bottom + 8
      );
    });
  }
  listen(
    editor,
    'pointerdown',
    (event) => {
      if (event.target.closest('[data-workspace-action]')) return;
      const group = saved.groups.find(
          (value) =>
            value.id === event.target.closest('[data-context-group]')?.dataset.contextGroup,
        ),
        tab = event.target.closest('[data-canvas-panel]');
      if (group && tab) begin(event, 'tab', group, tab.dataset.canvasPanel);
      else if (group && event.target.closest('.workspace-panel-resize'))
        begin(event, 'resize', group);
      else if (
        group &&
        event.target.closest('.canvas-panel-microbar') &&
        !event.target.closest('button')
      )
        begin(event, 'move', group);
    },
    { capture: true },
  );
  listen(
    window,
    'pointermove',
    (event) => {
      const g = gesture;
      if (!g || event.pointerId !== g.pointerId) return;
      if (!event.buttons && event.pointerType !== 'touch') return end(true);
      const dx = event.clientX - g.x,
        dy = event.clientY - g.y,
        bounds = size(),
        group = saved.groups.find((value) => value.id === g.groupId);
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      event.preventDefault();
      g.moved = true;
      const lone = g.kind === 'move' && group.tabs.filter(local);
      if (dragExternal && (g.kind === 'tab' || lone?.length === 1 || g.nativeId)) {
        const strip = g.strip;
        const within =
          event.clientX >= strip.left - 6 &&
          event.clientX < strip.right + 6 &&
          event.clientY >= strip.top - 8 &&
          event.clientY < strip.bottom + 8;
        if (g.nativeId || (!within && !hit(event))) {
          if (!g.nativeId) {
            g.nativeId = crypto.randomUUID();
            g.nativeKind = g.panelKind || lone[0];
            // The source keeps capture even after the dock hides the torn tab.
            g.capture = editor;
            try {
              editor.setPointerCapture(g.pointerId);
            } catch {}
            const gripX = clamp(g.x - g.grip.left, 4, 230);
            const gripY = clamp(g.y - g.grip.top + (g.kind === 'tab' ? 14 : 0), 3, 39);
            select(g.nativeKind);
            onRender();
            g.ghost?.remove();
            g.ghost = createPanelDragPreview(template, panels.get(g.nativeKind));
            g.ghost.id = 'ivo-panel-lift-' + g.nativeId;
            g.ghost.style.left = event.clientX - gripX + 'px';
            g.ghost.style.top = event.clientY - gripY + 'px';
            g.gripX = gripX;
            g.gripY = gripY;
            dragExternal({
              phase: 'start',
              id: g.nativeId,
              kind: g.nativeKind,
              x: event.screenX,
              y: event.screenY,
              gripX,
              gripY,
            });
          } else {
            g.ghost.style.left = event.clientX - g.gripX + 'px';
            g.ghost.style.top = event.clientY - g.gripY + 'px';
            dragExternal({ phase: 'move', id: g.nativeId, x: event.screenX, y: event.screenY });
          }
          return;
        }
      }
      if (g.kind === 'tab' && !g.ghost) {
        g.ghost = document.createElement('div');
        g.ghost.className = 'context-tab-drag-preview';
        g.ghost.textContent = g.target.textContent;
        editor.append(g.ghost);
        g.target.classList.add('context-tab-dragging');
      }
      if (g.ghost) {
        const origin = surface().getBoundingClientRect();
        g.ghost.style.transform = `translate3d(${event.clientX - origin.x - 30}px,${event.clientY - origin.y - 12}px,0)`;
      }
      clearDrop();
      if (g.kind === 'move' || g.kind === 'tab') {
        if (g.kind === 'move') {
          group.floating = true;
          group.collapsed = false;
          group.rect = panelBounds(
            {
              ...g.rect,
              x: g.rect.x + dx,
              y: g.rect.y + dy,
              h: g.before.groups.find((value) => value.id === g.groupId).floating
                ? g.rect.h
                : Math.min(480, bounds.h - 24),
            },
            bounds,
          );
        }
        const target = hit(event, g.kind === 'move' ? g.groupId : null);
        if (target) groups.get(target.id).classList.add('context-panel-drop');
        else drop.hidden = event.clientX < surface().getBoundingClientRect().right - 24;
      } else if (g.kind === 'resize') {
        if (group.floating)
          group.rect = panelBounds({ ...g.rect, w: g.rect.w + dx, h: g.rect.h + dy }, bounds);
        else saved.dock = dockWidth(g.before.dock - dx, bounds.w);
      }
      apply();
      if (g.kind === 'move') {
        try {
          g.target.setPointerCapture(g.pointerId);
        } catch {}
      }
    },
    { passive: false },
  );
  listen(window, 'pointerup', (event) => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    if (g.nativeId) {
      dragExternal({ phase: 'drop', id: g.nativeId, x: event.screenX, y: event.screenY });
      g.nativeId = null;
      // The native utility acknowledges its first layout, even on a quick release.
      g.ghost = null;
      end(true);
      return;
    }
    if (!g.moved) {
      const kind = g.panelKind;
      end(true);
      if (kind) {
        select(kind);
        store();
        onRender();
      }
      return;
    }
    const outside =
      event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight;
    const group = saved.groups.find((item) => item.id === g.groupId);
    const loneTab = group?.tabs.filter(local);
    if (
      outside &&
      openExternal &&
      (g.kind === 'tab' || (g.kind === 'move' && loneTab?.length === 1))
    ) {
      const kind = g.panelKind || loneTab[0];
      end(true);
      void openExternal(kind, { x: event.screenX, y: event.screenY }).catch(onError);
      return;
    }
    if (g.kind === 'move' || g.kind === 'tab') {
      const target = hit(event, g.kind === 'move' ? g.groupId : null),
        group = saved.groups.find((value) => value.id === g.groupId),
        origin = surface().getBoundingClientRect();
      if (target) {
        const tabs = [...groups.get(target.id).querySelectorAll('[data-canvas-panel]')],
          before = tabs.findIndex(
            (tab) =>
              event.clientX <
              tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2,
          ),
          index = before < 0 ? target.tabs.length : before;
        for (const [at, kind] of (g.kind === 'tab' ? [g.panelKind] : [...group.tabs]).entries())
          saved = movePanel(saved, kind, target.id, index + at);
      } else if (g.kind === 'move') group.floating = drop.hidden;
      else {
        saved = movePanel(saved, g.panelKind, null, 0, {
          floating: drop.hidden,
          rect: {
            x: event.clientX - origin.x - 40,
            y: event.clientY - origin.y - 5,
            w: 280,
            h: 400,
          },
        });
      }
    }
    end();
  });
  listen(window, 'pointercancel', () => end(true));
  listen(window, 'lostpointercapture', (event) => {
    if (
      gesture?.nativeId &&
      event.pointerId === gesture.pointerId &&
      event.target === gesture.capture
    )
      end(true);
  });
  listen(
    window,
    'keydown',
    (event) => {
      if (gesture?.nativeId && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        end(true);
      }
    },
    { capture: true },
  );
  listen(window, 'blur', () => {
    end(true);
    closeMenu();
  });
  listen(editor, 'focusout', (event) => {
    if (event.target.matches('.workspace-panel-resize')) delete event.target.dataset.pointerFocus;
  });
  function floating() {
    if (!allowed()) return;
    prepare();
    end(true);
    const group = groupTarget();
    group.floating = !group.floating;
    group.collapsed = false;
    apply();
    store();
  }
  function reset(name = 'compact') {
    if (!allowed()) return;
    prepare();
    end(true);
    saved = panelPreset(name);
    onSelect(saved.groups[0].active);
    selectedGroup = saved.groups[0].id;
    apply();
    store();
    onRender();
  }
  function presetForm(event) {
    closeMenu();
    menu = document.createElement('form');
    menu.className = 'canvas-context-menu workspace-panel-menu workspace-panel-preset-form';
    menu.setAttribute('aria-label', 'Save panel preset');
    menu.innerHTML =
      '<label>Panel preset name<input name="preset-name" maxlength="80" autocomplete="off"></label><p>Saving an existing name updates that preset.</p><div role="alert"></div><button type="submit">Save preset</button>';
    const box = surface().getBoundingClientRect();
    Object.assign(menu.style, {
      left: Math.max(0, Math.min(event.clientX - box.left, box.width - 240)) + 'px',
      top: Math.max(0, Math.min(event.clientY - box.top, box.height - 160)) + 'px',
    });
    menu.addEventListener('submit', (submit) => {
      submit.preventDefault();
      submit.stopPropagation();
      if (!allowed()) return;
      try {
        presets.savePanelPreset(menu.elements.namedItem('preset-name').value, saved);
        closeMenu();
      } catch (error) {
        menu.querySelector('[role=alert]').textContent = error.message;
      }
    });
    editor.append(menu);
    menu.querySelector('input').focus({ preventScroll: true });
  }
  function readPresets() {
    try {
      return presets?.panelPresets().presets || [];
    } catch (error) {
      onError(error);
      return [];
    }
  }
  function menuAt(event, kind) {
    if (!allowed()) return;
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    const group = kind
      ? groupFor(kind)
      : saved.groups.find(
          (value) =>
            value.id === event.target.closest('[data-context-group]')?.dataset.contextGroup,
        );
    if (!group) return;
    selectedGroup = group.id;
    menu = document.createElement('div');
    menu.className = 'canvas-context-menu workspace-panel-menu';
    menu.setAttribute('role', 'menu');
    const contentActions = {
      pages: [
        ['new-parent', 'Save as Parent…'],
        ['override-parent', 'Override All Parent Page Items'],
        ['restore-parent', 'Remove Local Overrides'],
      ],
      layers: [['layer-options', 'Layer Options…']],
    };
    const actions = [
      ...(kind === 'text-wrap'
        ? [['command/toggle-wrap-options', wrapOptionsShown() ? 'Hide Options' : 'Show Options']]
        : []),
      ...(editing()
        ? (contentActions[kind] || []).map(([id, label]) => ['command/' + id, label])
        : []),
      ...(kind && group.tabs.length > 1
        ? [
            ['detach', 'Float this panel'],
            ['dock-panel', 'Dock this panel separately'],
          ]
        : []),
      ...(openExternal ? [['external', 'Move to separate window']] : []),
      ['close-panel', 'Close ' + PANEL_LABELS[kind || group.active]],
      ['close-group', 'Close tab group'],
      ...saved.closed.map((member) => ['show/' + member, 'Show ' + PANEL_LABELS[member]]),
      ['float', group.floating ? 'Dock group' : 'Float group'],
      ...saved.groups
        .filter((value) => value.id !== group.id)
        .map((value) => [
          'join/' + value.id,
          'Group with ' +
            value.tabs
              .filter((tab) => !saved.closed.includes(tab))
              .map((tab) => PANEL_LABELS[tab])
              .join(', '),
        ]),
      ['compact', 'Preset: Compact'],
      ['layout', 'Preset: Layout'],
      ['links', 'Preset: Links'],
      ['reset', 'Reset panel layout'],
      ...(presets
        ? [
            ['save-preset', 'Save panel preset…'],
            ...readPresets().flatMap((preset) => [
              ['preset/' + preset.id, preset.name],
              ['delete-preset/' + preset.id, 'Delete preset: ' + preset.name],
            ]),
          ]
        : []),
    ];
    for (const [action, label] of actions) {
      const button = document.createElement('button');
      button.role = 'menuitem';
      button.dataset.workspaceAction = action;
      if (action.startsWith('command/')) button.disabled = !commandEnabled(action.slice(8));
      button.textContent = label;
      menu.append(button);
    }
    menu.dataset.panelKind = kind || '';
    editor.append(menu);
    menuButton = event.target.closest('[data-panel-menu]');
    menuButton?.setAttribute('aria-expanded', 'true');
    const box = surface().getBoundingClientRect();
    const anchor = menuButton?.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left =
      clamp(
        (anchor ? anchor.right - width : event.clientX) - box.left,
        0,
        Math.max(0, box.width - width),
      ) + 'px';
    menu.style.top =
      clamp((anchor?.bottom ?? event.clientY) - box.top, 0, Math.max(0, box.height - height)) +
      'px';
    menu.querySelector('button:enabled')?.focus({ preventScroll: true });
  }
  listen(editor, 'contextmenu', (event) => {
    if (event.target.closest('.canvas-panel-microbar,[data-canvas-panel]'))
      menuAt(event, event.target.closest('[data-canvas-panel]')?.dataset.canvasPanel);
  });
  listen(editor, 'dblclick', (event) => {
    if (event.target.closest('.canvas-panel-microbar') && !event.target.closest('button')) {
      event.preventDefault();
      selectedGroup = event.target.closest('[data-context-group]').dataset.contextGroup;
      floating();
    }
  });
  listen(
    editor,
    'click',
    (event) => {
      const action = event.target.closest('[data-workspace-action]')?.dataset.workspaceAction,
        tab = event.target.closest('[data-canvas-panel]'),
        group = event.target.closest('[data-context-group]');
      if (group) selectedGroup = group.dataset.contextGroup;
      if (event.target.closest('[data-panel-menu]')) {
        if (menuButton && menuButton.contains(event.target)) closeMenu();
        else
          menuAt(
            event,
            local(groupTarget().active) ? groupTarget().active : groupTarget().tabs.find(local),
          );
        return;
      }
      if (action) {
        event.stopImmediatePropagation();
        const kind = menu?.dataset.panelKind || groupTarget().active;
        closeMenu();
        if (!allowed()) return;
        prepare();
        if (action === 'external') {
          void openExternal(kind).catch(onError);
          return;
        }
        if (action.startsWith('command/')) {
          Promise.resolve(onCommand(action.slice(8))).catch(onError);
          return;
        }
        if (action === 'close-panel' || action === 'close-group') {
          saved.closed = [
            ...new Set([
              ...saved.closed,
              ...(action === 'close-panel' ? [kind] : groupTarget().tabs),
            ]),
          ];
          apply();
          onSelect(groupTarget().active);
          store();
          onRender();
          return;
        }
        if (action.startsWith('show/')) {
          const name = action.slice(5);
          saved.closed = saved.closed.filter((k) => k !== name);
          groupFor(name).collapsed = false;
          select(name);
          apply();
          store();
          onRender();
          return;
        }
        if (action === 'save-preset') {
          presetForm(event);
          return;
        }
        if (action.startsWith('preset/')) {
          const preset = presets
            ?.panelPresets()
            .presets.find((item) => item.id === action.slice(7));
          if (preset) {
            saved = normalizePanels(preset.layout);
            onSelect(saved.groups[0].active);
            selectedGroup = saved.groups[0].id;
            apply();
            store();
            onRender();
          }
          return;
        }
        if (action.startsWith('delete-preset/')) {
          try {
            presets?.removePanelPreset(action.slice(14));
          } catch (error) {
            onError(error);
          }
          return;
        }
        if (['detach', 'dock-panel'].includes(action))
          saved = movePanel(saved, kind, null, 0, { floating: action === 'detach' });
        else if (action.startsWith('join/'))
          for (const member of [...groupTarget().tabs])
            saved = movePanel(saved, member, action.slice(5));
        else if (action === 'float') return floating();
        else return reset(action);
        apply();
        store();
        onRender();
      } else if (event.target.closest('[data-canvas-command="close-panel-group"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!allowed()) return;
        prepare();
        saved.closed = [...new Set([...saved.closed, ...groupTarget().tabs])];
        apply();
        store();
      } else if (tab) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!allowed()) return;
        prepare();
        select(tab.dataset.canvasPanel);
        store();
        onRender();
      }
    },
    { capture: true },
  );
  listen(window, 'pointerdown', (event) => {
    if (menu && !menu.contains(event.target) && !menuButton?.contains(event.target)) closeMenu();
  });
  listen(editor, 'keydown', (event) => {
    const resize = event.target.closest('.workspace-panel-resize'),
      tab = event.target.closest('[data-canvas-panel]');
    if (gesture && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      end(true);
      return;
    }
    if (menu) {
      event.stopPropagation();
      const buttons = [...menu.querySelectorAll('button:enabled')];
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        buttons[
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
        ].focus();
      } else if (['Escape', 'Tab'].includes(event.key)) {
        event.preventDefault();
        const previous = menuButton || panels.get(groupTarget().active).tab;
        closeMenu();
        previous.focus({ preventScroll: true });
      }
      return;
    }
    if (!allowed()) return;
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      prepare();
      const group = groupFor(tab.dataset.canvasPanel),
        openTabs = group.tabs.filter(local),
        index = openTabs.indexOf(tab.dataset.canvasPanel),
        next =
          openTabs[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? openTabs.length - 1
                : (index + (event.key === 'ArrowLeft' ? -1 : 1) + openTabs.length) % openTabs.length
          ];
      select(next);
      store();
      onRender();
      panels.get(next).tab.focus({ preventScroll: true });
      return;
    }
    if (tab && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
      const rect = tab.getBoundingClientRect();
      menuAt(
        {
          target: tab,
          clientX: rect.left,
          clientY: rect.bottom,
          preventDefault() {
            event.preventDefault();
          },
          stopPropagation() {
            event.stopPropagation();
          },
        },
        tab.dataset.canvasPanel,
      );
      return;
    }
    if (!resize || !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    event.stopPropagation();
    delete event.target.dataset.pointerFocus;
    prepare();
    const amount = event.shiftKey ? 10 : 1,
      dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
      dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0,
      bounds = size();
    {
      const group = saved.groups.find(
        (value) => value.id === resize.closest('[data-context-group]').dataset.contextGroup,
      );
      if (group.floating) {
        const rect = panelBounds(group.rect, bounds);
        group.rect = panelBounds({ ...rect, w: rect.w + dx, h: rect.h + dy }, bounds);
      } else saved.dock = dockWidth(saved.dock - dx, bounds.w);
    }
    apply();
    store();
  });
  const observer = new ResizeObserver(apply);
  observer.observe(editor);
  if (splitSurface) observer.observe(splitSurface);
  apply();
  onSelect(saved.groups[0].active);
  return {
    dockPaletteAt,
    isExternal: (kind) => external.has(kind),
    setExternal(kinds) {
      if (external.size === kinds.length && kinds.every((kind) => external.has(kind))) return false;
      external = new Set(kinds);
      apply();
      return true;
    },
    entries: () => [...panels].map(([kind, { content }]) => ({ kind, content })),
    select,
    toggleFloating: floating,
    setCollapsed(value) {
      end(true);
      groupTarget().collapsed = value;
      apply();
      store();
    },
    show(kind) {
      if (kind && external.has(kind)) {
        void openExternal(kind).catch(onError);
        return;
      }
      if (kind) saved.closed = saved.closed.filter((k) => k !== kind);
      else if (saved.closed.length === panels.size)
        saved.closed = saved.closed.filter((k) => k !== 'properties');
      if (kind) select(kind);
      for (const group of saved.groups) group.collapsed = false;
      editor.classList.add('show-properties');
      apply();
      if (kind) panels.get(kind)?.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      store();
      onRender();
    },
    reset,
    getState: () => structuredClone(saved),
    restore(value) {
      end(true);
      saved = normalizePanels(value);
      onSelect(saved.groups[0].active);
      apply();
      onRender();
    },
    destroy() {
      end(true);
      closeMenu();
      controller.abort();
      observer.disconnect();
      nativeGuide.remove();
      drop.remove();
      dock.remove();
      for (const element of groups.values()) element.remove();
    },
  };
}
