import { layersFor, layerFor } from '../../../domain/documents/publishing.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon } from '../../../shared/ui/icons.js';

const tip = (label) => `aria-label="${esc(label)}" data-tooltip="${esc(label)}"`;
const action = (command, label, glyph, enabled) =>
  `<button data-canvas-command="${command}" ${tip(label)} ${enabled ? '' : 'disabled'}>${icon(glyph)}</button>`;

function lockCell(attributes, locked, label, editing) {
  return `<button class="layer-lock" ${attributes} aria-pressed="${!!locked}" ${tip((locked ? 'Unlock ' : 'Lock ') + label)} ${editing ? '' : 'disabled'}><span class="layer-lock-open"></span><span class="layer-lock-closed">${icon('panel-lock')}</span></button>`;
}
function visibilityCell(attributes, visible, label, editing) {
  return `<button ${attributes} aria-pressed="${visible}" ${tip((visible ? 'Hide ' : 'Show ') + label)} ${editing ? '' : 'disabled'}>${visible ? icon('panel-eye') : ''}</button>`;
}
function objectRow(item, selected, editing) {
  const id = esc(item.id),
    name = item.name || item.type[0].toUpperCase() + item.type.slice(1);
  return `<div class="layer-entry object-entry" role="treeitem" aria-selected="${selected}" aria-level="2">
    ${visibilityCell(`data-object-id="${id}" data-object-toggle="hidden"`, !item.hidden, 'object', editing)}
    ${lockCell(`data-object-id="${id}" data-object-toggle="locked"`, item.locked, 'object', editing)}
    <button data-layer-object="${id}" class="object-caption" ${tip(name)}>${esc(name)}</button>
    <span class="layer-selection-mark" data-filled="${selected}" aria-hidden="true"></span>
  </div>`;
}
export function layersContent(doc, state, selected, editing) {
  const layers = layersFor(doc),
    active = layers.find((layer) => layer.id === state.activeLayer) || layers[0],
    chosen = new Set(selected.map((item) => item.id)),
    rows = new Map(layers.map((layer) => [layer.id, []]));
  const pageId = state.activePage || doc.pages[0]?.id;
  for (let i = doc.blocks.length - 1; i >= 0; i--) {
    const item = doc.blocks[i];
    if (!item.parentId && (item.pageId || doc.pages[0]?.id) === pageId)
      rows.get(layerFor(doc, item).id).push(item);
  }
  const layerRows = [...layers].reverse().map((layer) => {
    const items = rows.get(layer.id),
      expanded = !!(
        state.expandedLayers?.includes(layer.id) ||
        (layer === layers[0] && state.expandedLayers?.includes('default'))
      ),
      id = esc(layer.id),
      color = /^#[\da-f]{6}$/i.test(layer.color) ? layer.color : '#4b80ff',
      containsSelection = selected.some((item) => layerFor(doc, item).id === layer.id);
    return `<div role="treeitem" aria-level="1" aria-expanded="${expanded}" class="layer-group ${layer === active ? 'active' : ''}" data-layer-row="${id}" style="--layer-color:${color}">
      <div class="layer-entry" draggable="${editing}">
        ${visibilityCell(`data-layer-id="${id}" data-layer-toggle="visible"`, layer.visible !== false, layer.name, editing)}
        ${lockCell(`data-layer-id="${id}" data-layer-toggle="locked"`, layer.locked, layer.name, editing)}
        <button class="layer-disclosure" data-layer-disclosure="${id}" aria-expanded="${expanded}" ${tip((expanded ? 'Collapse ' : 'Expand ') + layer.name)} ${items.length ? '' : 'disabled'}>${icon(expanded ? 'chevron-down' : 'chevron-right')}</button>
        <button class="layer-caption" data-layer-select="${id}" ${tip(layer.name)}>${esc(layer.name)}</button>
        <span class="layer-pencil" aria-hidden="true">${icon('panel-pen')}</span>
        <button class="layer-target" data-layer-move="${id}" ${tip('Move selection to ' + layer.name)} draggable="${!!(editing && containsSelection)}" ${editing && selected.length ? '' : 'disabled'}><span class="layer-selection-mark" data-filled="${containsSelection}"></span></button>
      </div>${expanded ? `<div role="group">${items.map((item) => objectRow(item, chosen.has(item.id), editing)).join('')}</div>` : ''}
    </div>`;
  });
  return `<div class="layers-panel"><div class="layer-tree" role="tree" aria-label="Layers">${layerRows.join('')}</div>
    <div class="inventory-footer"><span>Page: ${doc.pages.findIndex((p) => p.id === pageId) + 1}, ${layers.length} ${layers.length === 1 ? 'Layer' : 'Layers'}</span>
    ${action('new-layer', 'Create new layer', 'panel-new', editing)}${action('delete-layer', 'Delete selected layer', 'panel-trash', editing && layers.length > 1)}</div></div>`;
}
function sheet(width, height, prefix = '') {
  const scale = Math.min(30 / width, 40 / height);
  return `<span aria-hidden="true" class="page-sheet" style="width:${Math.max(2, width * scale)}px;height:${Math.max(2, height * scale)}px">${esc(prefix)}</span>`;
}
function pageSettings(doc, page, editing, parentMode) {
  const lock = editing ? '' : 'disabled';
  return `<div class="page-settings" role="group" aria-label="Page options">
    <label>Name<input data-page-prop="name" value="${esc(page.name)}" ${lock}></label>
    ${['width', 'height'].map((key) => `<label>${key === 'width' ? 'Width' : 'Height'} (pt)<input type="number" min="72" max="14400" step="any" data-page-prop="${key}" value="${page[key]}" ${lock}></label>`).join('')}
    ${parentMode ? '' : `<label>Parent<select data-page-parent-choice ${lock}><option value="">[None]</option>${(doc.publishing?.parents || []).map((p) => `<option value="${esc(p.id)}" ${page.parentPageId === p.id ? 'selected' : ''}>${esc(p.prefix + '-' + p.name)}</option>`).join('')}</select></label><label><input type="checkbox" data-text-wrap-pref="facingPages" ${doc.textWrapPreferences?.facingPages ? 'checked' : ''} ${lock}>Facing Pages</label><label>First Page Side<select data-text-wrap-pref="firstPageSide" ${lock}><option value="right">Right</option><option value="left" ${doc.textWrapPreferences?.firstPageSide === 'left' ? 'selected' : ''}>Left</option></select></label><label>Order<input type="number" data-page-order min="1" max="${doc.pages.length}" value="${doc.pages.indexOf(page) + 1}" ${lock}></label>`}</div>`;
}
export function pagesContent(doc, page, editing, { parentMode = false, state = {} } = {}) {
  const parents = doc.publishing?.parents || [],
    count = doc.pages.length,
    parentList = parentMode
      ? ''
      : `<div class="page-parents" role="group" aria-label="Parent pages">
      ${[{ id: '', name: '[None]', width: page.width, height: page.height }, ...parents]
        .map((parent) => {
          const name = parent.id ? parent.prefix + '-' + parent.name : parent.name;
          return `<button class="parent-entry" data-page-parent="${esc(parent.id)}" ${parent.id ? `data-parent-edit="${esc(parent.id)}"` : ''} draggable="${editing}" ${tip(name)} aria-pressed="${state.panelParent === parent.id}"><span>${esc(name)}</span>${sheet(parent.width, parent.height)}</button>`;
        })
        .join(
          '',
        )}</div><div class="parent-page-divider" role="separator" aria-label="Resize parent pages" aria-orientation="horizontal" aria-valuemin="32" aria-valuenow="${state.parentPaneHeight || 94}" tabindex="0"></div>`;
  return `<div class="pages-panel" style="--parent-pane-height:${state.parentPaneHeight || 94}px">${parentList}
    <div class="page-thumbnails" role="group" aria-label="Document pages">${doc.pages
      .map((p, i) => {
        const parent = parents.find((candidate) => candidate.id === p.parentPageId);
        return `<button data-select-page="${esc(p.id)}" aria-pressed="${p.id === page.id && state.panelParent == null}" ${tip('Select ' + p.name)}>${sheet(p.width, p.height, parent?.prefix)}<span class="page-number">${i + 1}</span></button>`;
      })
      .join('')}</div>
    <div class="inventory-footer"><span>${count} ${count === 1 ? 'Page in 1 Spread' : 'Pages in ' + count + ' Spreads'}</span>
    <details class="page-size-options"${state.pageSizeOpen ? ' open' : ''}><summary ${tip('Edit page size')}>${icon('page-size')}</summary>${pageSettings(doc, page, editing, parentMode)}</details>
    ${parentMode ? '' : action('add-page', 'Create new page', 'panel-new', editing) + action('delete-page', 'Delete selected page', 'panel-trash', editing && count > 1)}
    </div></div>`;
}
