import {
  applyParent,
  layersFor,
  moveToLayer,
  reorderLayer,
} from '../../../domain/documents/publishing.js';

/** Panel gestures retain their own view state. Only a successful drop authors a document edit. */
export function installPageLayerInteractions(
  editor,
  { listen, doc, state, objects, render, mutate, run, allowed, parentMode, onEditParent },
) {
  let drag = null,
    resize = null,
    pressedLock = false;
  listen(editor, 'click', (event) => {
    const toggle = event.target.closest('[data-layer-disclosure]');
    if (toggle) {
      const id = toggle.dataset.layerDisclosure,
        expanded = new Set(state.expandedLayers);
      if (toggle.getAttribute('aria-expanded') === 'true') {
        expanded.delete(id);
        if (id === layersFor(doc())[0].id) expanded.delete('default');
      } else expanded.add(id);
      state.expandedLayers = [...expanded];
      render();
      return;
    }
    if (event.target.closest('[data-select-page]')) state.panelParent = null;
    const parent = event.target.closest('[data-page-parent]');
    if (!parent || parentMode) return;
    const id = parent.dataset.pageParent;
    if (event.altKey) {
      state.panelParent = null;
      run(() => mutate(() => applyParent(doc(), state.activePage, id || null), 'Apply parent'));
      return;
    }
    state.panelParent = id;
    for (const row of parent
      .closest('.pages-panel')
      .querySelectorAll('[data-page-parent],[data-select-page]'))
      row.setAttribute('aria-pressed', String(row === parent));
  });
  listen(editor, 'change', (event) => {
    if (!parentMode && event.target.matches('[data-page-parent-choice]'))
      run(() =>
        mutate(
          () => applyParent(doc(), state.activePage, event.target.value || null),
          'Apply parent',
        ),
      );
  });
  function openParent(event) {
    const parent = event.target.closest('[data-parent-edit]');
    if (parent && !parentMode && allowed()) {
      event.preventDefault();
      onEditParent(parent.dataset.parentEdit);
    }
  }
  listen(editor, 'dblclick', openParent);
  listen(editor, 'keydown', (event) => {
    if (event.key === 'Enter') openParent(event);
    const divider = event.target.closest('.parent-page-divider');
    if (divider && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const panel = divider.parentElement;
      setParentHeight(
        panel,
        panel.querySelector('.page-parents').offsetHeight + (event.key === 'ArrowDown' ? 8 : -8),
      );
    }
    if (event.key === 'Escape' && event.target.closest('.page-size-options')) {
      const options = event.target.closest('.page-size-options');
      options.open = false;
      options.querySelector('summary').focus();
      event.stopPropagation();
    }
  });
  listen(
    editor,
    'toggle',
    (event) => {
      if (event.target.matches('.page-size-options')) state.pageSizeOpen = event.target.open;
    },
    { capture: true },
  );
  function setParentHeight(panel, height) {
    state.parentPaneHeight = Math.max(32, Math.min(panel.clientHeight - 78, height));
    panel.style.setProperty('--parent-pane-height', state.parentPaneHeight + 'px');
    panel
      .querySelector('.parent-page-divider')
      .setAttribute('aria-valuenow', String(state.parentPaneHeight));
  }
  listen(
    editor,
    'pointerdown',
    (event) => {
      pressedLock = !!event.target.closest('.layer-lock');
      const options = editor.querySelector('.page-size-options[open]');
      if (options && !options.contains(event.target)) options.open = false;
      const divider = event.target.closest('.parent-page-divider');
      if (!divider || event.button !== 0) return;
      event.preventDefault();
      const panel = divider.parentElement;
      resize = {
        id: event.pointerId,
        y: event.clientY,
        height: panel.querySelector('.page-parents').offsetHeight,
      };
      divider.setPointerCapture(event.pointerId);
    },
    { capture: true },
  );
  listen(editor, 'pointermove', (event) => {
    const divider = event.target.closest('.parent-page-divider');
    if (resize?.id === event.pointerId && divider)
      setParentHeight(divider.parentElement, resize.height + event.clientY - resize.y);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(editor, name, () => {
      resize = null;
      pressedLock = false;
    });
  listen(editor, 'dragstart', (event) => {
    if (!allowed()) return;
    const parent = event.target.closest('[data-page-parent]');
    const layer = event.target.closest('[data-layer-row]');
    if (parent && !parentMode) drag = { kind: 'parent', id: parent.dataset.pageParent };
    else if (layer && !pressedLock) {
      const target = event.target.closest('[data-layer-move]');
      drag = target
        ? { kind: 'selection', ids: objects().map((item) => item.id) }
        : { kind: 'layer', id: layer.dataset.layerRow };
    } else {
      if (layer) event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = drag.kind === 'parent' ? 'copy' : 'move';
    event.dataTransfer.setData(
      'application/x-ivo-' + drag.kind,
      drag.id || drag.ids?.join(',') || '[None]',
    );
  });
  function targetFor(event) {
    if (!drag) return null;
    return event.target.closest(drag.kind === 'parent' ? '[data-select-page]' : '[data-layer-row]');
  }
  function clearTargets() {
    for (const element of editor.querySelectorAll('.inventory-drop'))
      element.classList.remove('inventory-drop');
  }
  listen(editor, 'dragover', (event) => {
    const target = targetFor(event);
    if (!target || !allowed()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = drag.kind === 'parent' ? 'copy' : 'move';
    target.classList.add('inventory-drop');
  });
  listen(editor, 'dragleave', (event) => {
    const target = targetFor(event);
    if (target && !target.contains(event.relatedTarget)) target.classList.remove('inventory-drop');
  });
  listen(editor, 'dragend', () => {
    drag = null;
    clearTargets();
  });
  listen(editor, 'drop', (event) => {
    const target = targetFor(event);
    if (!target || !allowed()) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = drag;
    drag = null;
    clearTargets();
    run(() => {
      if (payload.kind === 'parent') {
        state.panelParent = null;
        mutate(
          () => applyParent(doc(), target.dataset.selectPage, payload.id || null),
          'Apply parent',
        );
      } else if (payload.kind === 'selection') {
        mutate(() => moveToLayer(doc(), payload.ids, target.dataset.layerRow), 'Move to layer');
      } else if (payload.id !== target.dataset.layerRow)
        mutate(() => reorderLayer(doc(), payload.id, target.dataset.layerRow), 'Reorder layers');
    });
  });
}
