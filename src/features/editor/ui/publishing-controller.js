import { legacyFontFamilies } from '../../../domain/text/font-references.js';
import {
  enablePublishing,
  layersFor,
  addLayer,
  removeLayer,
  moveToLayer,
  reorderLayer,
  createParent,
  applyParent,
  overrideParent,
  saveTextStyle,
} from '../../../domain/documents/publishing.js';
import { CHARACTER_FIELDS, PARAGRAPH_FIELDS } from '../../../domain/text/typography.js';
import { prepareFont } from '../assets/font-import.js';
import { dialogMarkup, installDialogDismissal } from '../../../shared/ui/dialog.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { createOpenTypePopover } from './opentype-popover.js';

/** Nonmodal publishing controls. Document edits use the same transaction/history owner as canvas edits. */
export function installPublishingControls(
  editor,
  {
    doc,
    state,
    objects,
    mutate,
    applyTextProperty,
    render,
    select,
    allowed,
    preserveRange,
    notify,
    onAsset,
    onEditParent,
    showPanel,
    clearOverrides,
    fonts = () => [],
    parentMode = false,
    textState,
    resolveFont,
    refreshSystemFonts,
    prepareDocumentFonts,
    canPrepareFonts,
    ensureFontVariant,
    fontSelection,
    applyFontSettings,
  },
) {
  const controller = new AbortController(),
    listen = (target, type, fn, options = {}) =>
      target.addEventListener(
        type,
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
  let popover = null,
    draggedLayer = null,
    fontWork = Promise.resolve(),
    fontPending = 0,
    preparedLegacy = '';
  function prepareLegacyFonts() {
    const signature = JSON.stringify([...legacyFontFamilies(doc())].sort());
    if (!prepareDocumentFonts || !canPrepareFonts() || signature === preparedLegacy) return;
    preparedLegacy = signature;
    const snapshot = structuredClone(doc());
    fontPending++;
    fontWork = fontWork
      .then(() => prepareDocumentFonts(snapshot))
      .catch((error) => {
        preparedLegacy = '';
        notify?.(error.message);
      })
      .finally(() => fontPending--);
  }
  function fontTransaction(prepare) {
    if (!allowed()) return Promise.resolve(false);
    const target = fontSelection();
    fontPending++;
    fontWork = fontWork
      .then(async () => {
        const settings = await prepare();
        if (!allowed() || fontSelection() !== target) return false;
        applyFontSettings(settings);
        render();
        return true;
      })
      .catch((error) => {
        notify?.(error.message);
        if (allowed() && fontSelection() === target) render();
        return false;
      })
      .finally(() => fontPending--);
    return fontWork;
  }
  function closePopover() {
    popover?.destroy();
    popover = null;
  }
  function run(action) {
    if (!allowed()) return;
    try {
      action();
    } catch (error) {
      notify?.(error.message);
    }
  }
  function currentLayer() {
    return layersFor(doc()).find((l) => l.id === state.activeLayer) || layersFor(doc())[0];
  }
  function form(title, fields, onSubmit) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal publishing-style-dialog';
    dialog.innerHTML = dialogMarkup(
      `<h2>${esc(title)}</h2>${fields}<p role="alert"></p><button type="submit">OK</button>`,
    );
    const dismissal = installDialogDismissal(dialog);
    document.body.append(dialog);
    dialog.addEventListener(
      'close',
      () => {
        dismissal.destroy();
        dialog.remove();
      },
      { once: true },
    );
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        onSubmit(new FormData(event.currentTarget));
        dialog.close();
      } catch (error) {
        dialog.querySelector('[role=alert]').textContent = error.message;
      }
    });
    dialog.showModal();
    dialog.querySelector('input')?.focus();
  }
  function styleForm(kind, edit = false) {
    const item = objects()[0],
      flow = doc().textFlows?.find((f) => f.id === item?.textFlowId),
      settings = flow?.style || item || {};
    const definitions = doc().publishing?.[kind + 'Styles'] || [],
      existing = edit ? definitions.find((s) => s.id === settings[kind + 'Style']) : null;
    if (edit && !existing) {
      notify?.('Choose a named style to edit.');
      return;
    }
    const fields = Object.keys({
      ...CHARACTER_FIELDS,
      ...(kind === 'paragraph' ? PARAGRAPH_FIELDS : {}),
    }).filter((k) => !['characterStyle', 'paragraphStyle'].includes(k));
    const attributes =
      existing?.attributes ||
      Object.fromEntries(
        fields.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]),
      );
    form(
      (edit ? 'Edit ' : 'New ') + kind + ' style',
      `<label>Name<input name="name" value="${esc(existing?.name || '')}" required maxlength="120"></label><label>Based on<select name="basedOn"><option value="">[None]</option>${definitions
        .filter((s) => s.id !== existing?.id)
        .map(
          (s) =>
            `<option value="${s.id}" ${existing?.basedOn === s.id ? 'selected' : ''}>${esc(s.name)}</option>`,
        )
        .join(
          '',
        )}</select></label><label>Point size<input type="number" min="1" max="2000" step="any" name="fontSize" value="${attributes.fontSize || ''}" placeholder="Inherited"></label><label>Leading (0 = Auto)<input type="number" min="0" max="4000" step="any" name="leading" value="${attributes.leading ?? ''}" placeholder="Inherited"></label><label>Tracking<input type="number" min="-1000" max="10000" step="any" name="tracking" value="${attributes.tracking ?? ''}" placeholder="Inherited"></label>`,
      (data) => {
        const next = { ...attributes };
        for (const key of ['fontSize', 'leading', 'tracking'])
          if (data.get(key) === '') delete next[key];
          else next[key] = Number(data.get(key));
        mutate(
          () =>
            saveTextStyle(doc(), kind, {
              ...(existing ? { id: existing.id } : {}),
              name: data.get('name'),
              basedOn: data.get('basedOn') || null,
              attributes: next,
            }),
          edit ? 'Edit text style' : 'New text style',
        );
      },
    );
  }
  function openType(anchor) {
    closePopover();
    if (!textState()) return;
    const trigger =
      anchor ||
      editor.querySelector('.canvas-type-options') ||
      editor.querySelector('.canvas-contextual-bar [data-canvas-command="type-options"]');
    if (!trigger) return;
    popover = createOpenTypePopover(editor, {
      anchor: trigger,
      textState,
      fonts,
      preserveRange,
      previewText: () => {
        const selected = window.getSelection();
        if (selected?.rangeCount && editor.contains(selected.anchorNode) && selected.toString())
          return selected.toString();
        const item = objects()[0],
          flow = doc().textFlows?.find((f) => f.id === item?.textFlowId),
          root = document.createElement('div');
        root.innerHTML = flow?.html ?? item?.html ?? '';
        return root.textContent;
      },
      apply: (field, value) => run(() => applyTextProperty(field, value)),
      onClose: closePopover,
    });
  }
  listen(editor, 'pointerdown', (event) => {
    if (event.target.closest('[data-highlight-color],[data-type-feature]')) {
      preserveRange();
      if (event.target.closest('button')) event.preventDefault();
    }
  });
  listen(window, 'pointerdown', (event) => {
    if (
      popover &&
      !popover.element.contains(event.target) &&
      event.target.closest('[data-canvas-command="type-options"]')?.closest('.scene-editor') !==
        editor
    )
      closePopover();
  });
  listen(
    editor,
    'keydown',
    (event) => {
      if (event.key === 'Escape' && popover) {
        event.preventDefault();
        event.stopPropagation();
        closePopover();
      }
    },
    { capture: true },
  );
  listen(editor, 'click', (event) => {
    const t = event.target.closest('button');
    if (!t) return;
    if (t.dataset.styleKind) {
      state.styleKind = t.dataset.styleKind;
      render();
      return;
    }
    if (t.hasAttribute('data-transform-reference')) {
      state.transformReference = Number(t.dataset.transformReference);
      render();
      return;
    }
    if (t.hasAttribute('data-layer-select')) {
      state.activeLayer = t.dataset.layerSelect;
      render();
      return;
    }
    if (t.hasAttribute('data-layer-object')) {
      select(t.dataset.layerObject);
      return;
    }
    if (!allowed()) return;
    run(() => {
      if (t.dataset.highlightColor) {
        applyTextProperty('highlight', t.dataset.highlightColor);
        return;
      }
      if (t.dataset.frameNone) {
        mutate(() => {
          enablePublishing(doc());
          (objects()[0].frameOptions ||= {})[t.dataset.frameNone] = 'none';
        }, 'Frame paint');
        return;
      }
      if (t.dataset.layerToggle) {
        mutate(() => {
          const old = currentLayer(),
            p = enablePublishing(doc()),
            layer =
              p.layers.find((l) => l.id === t.dataset.layerId) ||
              p.layers.find((l) => l.name === old.name);
          layer[t.dataset.layerToggle] = !layer[t.dataset.layerToggle];
          state.activeLayer = layer.id;
        }, 'Layer ' + t.dataset.layerToggle);
        return;
      }
      if (t.dataset.objectToggle) {
        mutate(() => {
          enablePublishing(doc());
          const item = doc().blocks.find((b) => b.id === t.dataset.objectId);
          item[t.dataset.objectToggle] = !item[t.dataset.objectToggle];
        }, 'Object ' + t.dataset.objectToggle);
        return;
      }
      if (t.dataset.layerMove) {
        mutate(
          () =>
            moveToLayer(
              doc(),
              objects().map((b) => b.id),
              t.dataset.layerMove,
            ),
          'Move to layer',
        );
        return;
      }
      if (t.hasAttribute('data-page-parent')) {
        if (parentMode) return;
        mutate(
          () => applyParent(doc(), state.activePage, t.dataset.pageParent || null),
          'Apply parent',
        );
        return;
      }
      if (t.dataset.parentEdit) {
        onEditParent(t.dataset.parentEdit);
      }
    });
  });
  listen(editor, 'change', (event) =>
    run(() => {
      const t = event.target;
      if (t.dataset.frameProp && objects().length === 1) {
        const key = t.dataset.frameProp,
          value = t.type === 'number' ? Number(t.value) : t.value;
        if (t.type === 'number' && (!Number.isFinite(value) || value < 0 || value > 2000))
          throw new Error('Choose a valid frame value.');
        if (key === 'columns' && (!Number.isInteger(value) || value < 1 || value > 40))
          throw new Error('Use 1–40 whole columns.');
        const candidate = { ...(objects()[0].frameOptions || {}), [key]: value },
          frame = objects()[0];
        if (
          (candidate.insetLeft || 0) +
            (candidate.insetRight || 0) +
            ((candidate.columns || 1) - 1) * (candidate.gutter ?? 12) >=
            frame.w - 1 ||
          (candidate.insetTop || 0) + (candidate.insetBottom || 0) >= frame.h - 1
        )
          throw new Error('Insets and gutters must leave room for text.');
        mutate(() => {
          enablePublishing(doc());
          objects()[0].frameOptions = candidate;
        }, 'Text frame options');
      }
    }),
  );
  listen(editor.querySelector('.canvas-font-input'), 'change', (event) => {
    if (!allowed()) return;
    const files = [...event.target.files],
      target = objects()
        .map((o) => o.id)
        .join('|');
    event.target.value = '';
    fontPending++;
    fontWork = fontWork
      .then(async () => {
        for (const file of files) {
          const asset = await prepareFont(file);
          if (!allowed()) return;
          await onAsset(asset);
          if (!allowed()) return;
          if (
            objects()
              .map((o) => o.id)
              .join('|') === target
          )
            applyTextProperty('textStyle', asset.id);
        }
        render();
      })
      .catch((error) => notify?.(error.message))
      .finally(() => fontPending--);
  });
  listen(editor, 'dragstart', (event) => {
    const layer = event.target.closest('[data-layer-row]');
    if (!layer || !allowed()) return;
    draggedLayer = layer.dataset.layerRow;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-ivo-layer', draggedLayer);
  });
  listen(editor, 'dragover', (event) => {
    const row = event.target.closest('[data-layer-row]');
    if (row && draggedLayer) {
      event.preventDefault();
      row.classList.add('drag-target');
    }
  });
  listen(editor, 'dragleave', (event) =>
    event.target.closest('[data-layer-row]')?.classList.remove('drag-target'),
  );
  listen(editor, 'dragend', () => {
    draggedLayer = null;
    for (const e of editor.querySelectorAll('.drag-target')) e.classList.remove('drag-target');
  });
  listen(editor, 'drop', (event) => {
    const row = event.target.closest('[data-layer-row]');
    if (!row || !draggedLayer) return;
    event.preventDefault();
    event.stopPropagation();
    const from = draggedLayer;
    draggedLayer = null;
    run(() => mutate(() => reorderLayer(doc(), from, row.dataset.layerRow), 'Reorder layers'));
  });
  return {
    prepareLegacyFonts,
    chooseFont(value) {
      return fontTransaction(() => resolveFont(value));
    },
    variant(field, value) {
      const summary = textState(),
        ids = summary?.fonts.filter((id) => /^font-/.test(id)) || [];
      if (!ensureFontVariant || !ids.length || !['bold', 'italic'].includes(field)) return false;
      void fontTransaction(async () => {
        for (const id of ids)
          await ensureFontVariant(
            id,
            field === 'bold' ? value : summary.values.bold === true,
            field === 'italic' ? value : summary.values.italic === true,
          );
        const settings = { [field]: value };
        if (
          field === 'bold' &&
          ids.some((id) =>
            fonts()
              .find((asset) => asset.id === id)
              ?.font.axes.some((axis) => axis.tag === 'wght'),
          )
        ) {
          settings.fontVariations =
            (summary.values.fontVariations || '')
              .split(',')
              .filter((pair) => pair && pair !== 'normal' && !pair.startsWith('wght:'))
              .join(',') || 'normal';
        }
        return settings;
      });
      return true;
    },
    flush: () => fontWork,
    get pending() {
      return fontPending > 0;
    },
    refreshTextState() {
      popover?.refresh();
    },
    command(name, { anchor } = {}) {
      if (name.startsWith('show-panel-')) {
        const kind = name.slice(11);
        if (['properties', 'pages', 'layers', 'links'].includes(kind)) {
          state.panel = kind;
          showPanel(kind);
          render();
        }
        return true;
      }
      if (name === 'highlight-options') {
        state.panel = 'properties';
        showPanel('properties');
        render();
        editor.querySelector('.highlight-swatches')?.scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (name === 'show-pages') {
        state.panel = 'pages';
        showPanel('pages');
        render();
        return true;
      }
      if (!allowed()) return false;
      if (name === 'type-options') {
        openType(anchor);
        return true;
      }
      if (name === 'refresh-fonts') {
        if (refreshSystemFonts) void refreshSystemFonts().catch((error) => notify?.(error.message));
        return true;
      }
      if (name === 'import-font') {
        editor.querySelector('.canvas-font-input').click();
        return true;
      }
      if (name === 'new-layer') {
        mutate(() => {
          state.activeLayer = addLayer(doc()).id;
          state.panel = 'layers';
        }, 'New layer');
        return true;
      }
      if (name === 'delete-layer') {
        mutate(() => removeLayer(doc(), currentLayer().id), 'Remove layer');
        return true;
      }
      if (name === 'layer-options') {
        const old = currentLayer();
        form(
          'Layer Options',
          `<label>Name<input name="name" value="${esc(old.name)}" maxlength="120"></label><label>Color<input name="color" type="color" value="${old.color}"></label>`,
          (data) =>
            mutate(() => {
              const p = enablePublishing(doc()),
                layer = p.layers.find((l) => l.id === old.id) || p.layers[0];
              layer.name = String(data.get('name')).trim() || 'Layer';
              layer.color = data.get('color');
              state.activeLayer = layer.id;
            }, 'Layer options'),
        );
        return true;
      }
      if (/^(new|edit)-(paragraph|character)-style$/.test(name)) {
        const [action, kind] = name.split('-');
        styleForm(kind, action === 'edit');
        return true;
      }
      if (name === 'new-parent') {
        form(
          'New Parent',
          `<label>Name<input name="name" value="Parent" maxlength="120"></label>`,
          (data) =>
            mutate(() => createParent(doc(), state.activePage, data.get('name')), 'Create parent'),
        );
        return true;
      }
      if (name === 'override-parent') {
        mutate(() => select(overrideParent(doc(), state.activePage)), 'Override parent items');
        return true;
      }
      if (name === 'restore-parent') {
        mutate(() => {
          delete doc().pages.find((p) => p.id === state.activePage).parentOverrides;
          doc().blocks = doc().blocks.filter(
            (b) => !(b.pageId === state.activePage && b.parentOriginId),
          );
        }, 'Restore parent items');
        return true;
      }
      if (name === 'clear-overrides') {
        clearOverrides();
        return true;
      }
      if (name === 'bring-front' || name === 'send-back') {
        mutate(
          () => {
            const ids = new Set(objects().map((b) => b.id));
            let changed = true;
            while (changed) {
              changed = false;
              for (const b of doc().blocks)
                if (b.parentId && ids.has(b.parentId) && !ids.has(b.id)) {
                  ids.add(b.id);
                  changed = true;
                }
            }
            const chosen = doc().blocks.filter((b) => ids.has(b.id)),
              rest = doc().blocks.filter((b) => !ids.has(b.id));
            doc().blocks = name === 'bring-front' ? [...rest, ...chosen] : [...chosen, ...rest];
          },
          name === 'bring-front' ? 'Bring to front' : 'Send to back',
        );
        return true;
      }
      if (name.startsWith('align-')) {
        const align = name.slice(6),
          items = objects();
        if (!items.length) return true;
        mutate(() => {
          const rects = items.map((item) => ({ item, x: item.x, y: item.y, w: item.w, h: item.h })),
            page = doc().pages.find((p) => p.id === items[0].pageId),
            bounds =
              items.length === 1
                ? { x: 0, y: 0, w: page.width, h: page.height }
                : {
                    x: Math.min(...rects.map((r) => r.x)),
                    y: Math.min(...rects.map((r) => r.y)),
                    w: 0,
                    h: 0,
                  };
          if (items.length > 1) {
            bounds.w = Math.max(...rects.map((r) => r.x + r.w)) - bounds.x;
            bounds.h = Math.max(...rects.map((r) => r.y + r.h)) - bounds.y;
          }
          for (const r of rects) {
            if (align === 'left') r.item.x = bounds.x;
            if (align === 'center') r.item.x = bounds.x + (bounds.w - r.w) / 2;
            if (align === 'right') r.item.x = bounds.x + bounds.w - r.w;
            if (align === 'top') r.item.y = bounds.y;
            if (align === 'middle') r.item.y = bounds.y + (bounds.h - r.h) / 2;
            if (align === 'bottom') r.item.y = bounds.y + bounds.h - r.h;
          }
        }, 'Align objects');
        return true;
      }
      return false;
    },
    destroy() {
      closePopover();
      controller.abort();
    },
  };
}
