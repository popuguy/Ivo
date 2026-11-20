// Both surfaces use the editor's own controls. A handle is meaningful only for
// one published view of one selection; the utility window never owns a document.
const paletteControls =
  'button,input,select,textarea,summary,[data-layer-row],[data-object-row],.parent-page-divider';

function fieldValue(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  if (el.type === 'select-multiple')
    return Array.from(el.selectedOptions, (option) => option.index).join(',');
  return el.value;
}

function copyPanel(content) {
  const clone = content.cloneNode(true);
  const live = [...content.querySelectorAll(paletteControls)];
  const projected = clone.querySelectorAll(paletteControls);
  const fields = new Map();
  for (const [i, el] of live.entries()) {
    const copy = projected[i];
    copy.dataset.paletteControl = String(i);
    if (el.matches('input,select,textarea')) fields.set(el, fieldValue(el));
    if (el.matches('input')) {
      copy.setAttribute('value', el.value);
      copy.toggleAttribute('checked', el.checked);
    } else if (el.matches('select')) {
      for (const [j, option] of [...copy.options].entries())
        option.toggleAttribute('selected', el.options[j].selected);
    } else if (el.matches('textarea')) copy.textContent = el.value;
  }
  return { html: clone.innerHTML, live, fields };
}

function markupChanged(records) {
  return records.some(
    (record) =>
      record.type !== 'attributes' ||
      record.oldValue !== record.target.getAttribute(record.attributeName),
  );
}

function applyAction(el, value, live) {
  if (!el?.isConnected || el.matches(':disabled')) return;
  const mouse = {
    bubbles: true,
    cancelable: true,
    button: 0,
    altKey: value.altKey === true,
    shiftKey: value.shiftKey === true,
    ctrlKey: value.ctrlKey === true,
    metaKey: value.metaKey === true,
  };
  if (value.type === 'change' && el.matches('input:not([type=file]),select,textarea')) {
    if (el.type === 'checkbox') el.checked = value.checked === true;
    else if (typeof value.value === 'string') el.value = value.value;
    else return;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (value.type === 'toggle' && el.matches('summary')) {
    if (el.parentElement.open !== (value.open === true)) el.click();
  } else if ((value.type === 'click' || value.type === 'dblclick') && el.matches('button')) {
    el.dispatchEvent(new PointerEvent('pointerdown', mouse));
    el.dispatchEvent(new PointerEvent('pointerup', mouse));
    el.dispatchEvent(new MouseEvent(value.type, mouse));
  } else if (
    value.type === 'drop' &&
    el.matches('[data-object-row],[data-layer-row],[data-select-page]')
  ) {
    const source = live[value.from];
    if (!source?.matches('[data-object-row],[data-layer-row],[data-layer-move],[data-page-parent]'))
      return;
    const transfer = new DataTransfer();
    for (const [element, name] of [
      [source, 'dragstart'],
      [el, 'dragover'],
      [el, 'drop'],
      [source, 'dragend'],
    ]) {
      if (name === 'drop' && el.matches('[data-object-row]'))
        transfer.setData('application/x-ivo-layer-drop-side', value.above ? 'above' : 'below');
      element.dispatchEvent(
        new DragEvent(name, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    }
  }
}

export function installDesktopPalettes(bridge, activeEditor) {
  if (!bridge) return { refresh() {} };
  let kinds = [],
    epoch = 0,
    active = false,
    editor,
    queued = false;
  const views = new Map();
  function refresh() {
    if (queued || (!kinds.length && !editor)) return;
    queued = true;
    // Font menus can contain hundreds of options. Publish the inspector after
    // the document gets a paint opportunity, including during sustained input.
    // An occluded document can still own a visible utility window.
    let frame;
    const deadline = setTimeout(run, 80);
    frame = requestAnimationFrame(() => setTimeout(run, 0));
    let pending = true;
    function run() {
      if (!pending) return;
      pending = false;
      clearTimeout(deadline);
      cancelAnimationFrame(frame);
      queued = false;
      sync();
    }
  }
  function sync() {
    const next = kinds.length ? activeEditor() : null;
    if (next !== editor) {
      editor?.setExternalPanels([]);
      editor = next;
      editor?.setExternalPanels(kinds);
      for (const slot of views.values()) slot.dirty = true;
    }
    if (!active) return;
    const context = editor?.paletteContext();
    for (const kind of kinds) {
      const content = context?.entries.find((entry) => entry.kind === kind)?.content;
      let slot = views.get(kind);
      if (!slot || slot.content !== content) {
        slot?.observer?.disconnect();
        slot = { content, dirty: true };
        views.set(kind, slot);
        if (content) {
          slot.observer = new MutationObserver((records) => {
            if (markupChanged(records)) slot.dirty = true;
            refresh();
          });
          slot.observer.observe(content, {
            childList: true,
            attributes: true,
            attributeOldValue: true,
            characterData: true,
            subtree: true,
          });
        }
      }
      if (!content) {
        if (!slot.empty) bridge.publish({ epoch, kind, view: null });
        slot.empty = true;
        slot.revision = null;
        continue;
      }
      slot.empty = false;
      if (markupChanged(slot.observer.takeRecords())) slot.dirty = true;
      if (!slot.dirty)
        for (const [field, previous] of slot.fields) {
          if (fieldValue(field) !== previous) {
            slot.dirty = true;
            break;
          }
        }
      let html = slot.html;
      if (slot.dirty) {
        const copy = copyPanel(content);
        slot.live = copy.live;
        slot.fields = copy.fields;
        html = copy.html;
      }
      slot.dirty = false;
      if (context.scope === slot.scope && html === slot.html && context.title === slot.title)
        continue;
      const changedMarkup = html !== slot.html;
      Object.assign(slot, {
        html,
        scope: context.scope,
        title: context.title,
        revision: crypto.randomUUID(),
      });
      bridge.publish({
        epoch,
        kind,
        view: {
          ...(changedMarkup ? { html } : {}),
          revision: slot.revision,
          title: context.title,
          scope: context.scope,
        },
      });
    }
  }
  bridge.onConfiguration((value) => {
    document.body.classList.toggle('passive-document-window', value.passive);
    const changedOwner = epoch !== value.epoch || active !== value.active;
    epoch = value.epoch;
    active = value.active;
    kinds = value.kinds;
    for (const [kind, slot] of views) {
      if (changedOwner || !kinds.includes(kind)) {
        slot.observer?.disconnect();
        views.delete(kind);
      }
    }
    editor?.setExternalPanels(kinds);
    refresh();
  });
  bridge.onAction((value) => {
    if (!active || value.epoch !== epoch || !kinds.includes(value.kind)) return;
    sync();
    const slot = views.get(value.kind);
    if (!slot?.revision || slot.revision !== value.revision || !Number.isInteger(value.index))
      return;
    applyAction(slot.live[value.index], value, slot.live);
    queueMicrotask(() => {
      if (document.querySelector('dialog[open],.type-options-popover')) bridge.revealDialog();
    });
    slot.dirty = true;
    refresh();
  });
  let lastDockHover = null,
    previewEditor;
  bridge.onDockPointer?.((value) => {
    if (value.action === 'lifted') {
      document.getElementById('ivo-panel-lift-' + value.id)?.remove();
      return;
    }
    const destination = activeEditor();
    if (previewEditor && previewEditor !== destination)
      previewEditor.dockPaletteAt({ action: 'clear' });
    previewEditor = value.action === 'preview' ? destination : null;
    const accepted = destination?.dockPaletteAt(value) === true;
    if (value.action === 'drop') bridge.dropResult(value.id, accepted);
    if (value.action === 'preview' && accepted !== lastDockHover)
      bridge.dockHover(value.id, accepted);
    lastDockHover = value.action === 'preview' ? accepted : null;
  });
  return { refresh };
}
