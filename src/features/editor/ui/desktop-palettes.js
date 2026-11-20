// Both surfaces use the editor's own controls. A handle is meaningful only for
// one published view of one selection; the utility window never owns a document.
const paletteControls =
  'button,input,select,textarea,summary,[data-layer-row],.parent-page-divider';

function copyPanel(content) {
  const clone = content.cloneNode(true);
  const live = [...content.querySelectorAll(paletteControls)];
  const projected = clone.querySelectorAll(paletteControls);
  for (const [i, el] of live.entries()) {
    const copy = projected[i];
    copy.dataset.paletteControl = String(i);
    if (el.matches('input')) {
      copy.setAttribute('value', el.value);
      copy.toggleAttribute('checked', el.checked);
    } else if (el.matches('select')) {
      for (const [j, option] of [...copy.options].entries())
        option.toggleAttribute('selected', el.options[j].selected);
    } else if (el.matches('textarea')) copy.textContent = el.value;
  }
  return { html: clone.innerHTML, live };
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
  } else if (value.type === 'drop' && el.matches('[data-layer-row],[data-select-page]')) {
    const source = live[value.from];
    if (!source?.matches('[data-layer-row],[data-layer-move],[data-page-parent]')) return;
    const transfer = new DataTransfer();
    for (const [element, name] of [
      [source, 'dragstart'],
      [el, 'dragover'],
      [el, 'drop'],
      [source, 'dragend'],
    ])
      element.dispatchEvent(
        new DragEvent(name, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
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
    queueMicrotask(() => {
      queued = false;
      sync();
    });
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
    for (const kind of kinds) {
      const source = editor?.paletteSurface(kind);
      let slot = views.get(kind);
      if (!slot || slot.content !== source?.content) {
        slot?.observer?.disconnect();
        slot = { content: source?.content, dirty: true };
        views.set(kind, slot);
        if (source) {
          slot.observer = new MutationObserver(() => {
            slot.dirty = true;
            refresh();
          });
          slot.observer.observe(source.content, {
            childList: true,
            attributes: true,
            characterData: true,
            subtree: true,
          });
        }
      }
      if (!source) {
        if (!slot.empty) bridge.publish({ epoch, kind, view: null });
        slot.empty = true;
        slot.revision = null;
        continue;
      }
      slot.empty = false;
      if (slot.observer.takeRecords().length) slot.dirty = true;
      if (!slot.dirty && source.scope === slot.scope) continue;
      let html = slot.html;
      if (slot.dirty) {
        const copy = copyPanel(source.content);
        slot.live = copy.live;
        html = copy.html;
      }
      slot.dirty = false;
      if (source.scope === slot.scope && html === slot.html && source.title === slot.title)
        continue;
      const changedMarkup = html !== slot.html;
      Object.assign(slot, {
        html,
        scope: source.scope,
        title: source.title,
        revision: crypto.randomUUID(),
      });
      bridge.publish({
        epoch,
        kind,
        view: {
          ...(changedMarkup ? { html } : {}),
          revision: slot.revision,
          title: source.title,
          scope: source.scope,
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
  return { refresh };
}
