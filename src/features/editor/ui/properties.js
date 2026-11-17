import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon as svg } from '../../../shared/ui/icons.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
const field = (label, input) => `<label class="canvas-field"><span>${label}</span>${input}</label>`;
const number = (prop, value, label = prop) =>
  field(
    label,
    `<input type="number" step="any" data-object-prop="${prop}" value="${Number(value.toFixed(4))}" aria-label="Object ${esc(label)}">`,
  );

/** Render inspector markup from a snapshot; this module never mutates editor/document state. */
export function propertiesContent({
  document,
  documents,
  state,
  selectedObjects,
  selectionRect,
  activePage,
  editing,
  index,
  flowStatus,
}) {
  const raw = selectedObjects.length === 1 ? selectedObjects[0] : null,
    item = raw?.textFlowId ? { ...raw, ...textFlowForFrame(document, raw).style } : raw,
    p = activePage,
    disabled = editing ? '' : 'disabled';
  if (state.panel === 'properties' && selectedObjects.length > 1) {
    const rect = selectionRect;
    return `<div class="canvas-panel-heading">${selectedObjects.length} objects</div><fieldset ${disabled}>${pageAssignment()}<div class="canvas-geometry">${['x', 'y', 'w', 'h'].map((key) => field({ x: 'X', y: 'Y', w: 'Width', h: 'Height' }[key] + ' · pt', `<input type="number" step="any" data-selection-prop="${key}" value="${Number(rect[key].toFixed(4))}">`)).join('')}</div><button class="canvas-panel-button" data-canvas-command="duplicate">Duplicate selection</button><button class="canvas-panel-button danger" data-canvas-command="delete">Delete selection</button></fieldset>`;
  }
  if (state.panel === 'pages') {
    return `<div class="canvas-panel-heading">Pages <button data-canvas-command="add-page" ${disabled} title="Add page" aria-label="Add page">${svg('plus')}</button></div><div class="canvas-page-list">${document.pages
      .map(
        (value) =>
          `<button data-select-page="${esc(value.id)}" class="${value.id === p.id ? 'active' : ''}"><span>${esc(value.name)}</span><small>${value.width} × ${value.height} pt</small></button>`,
      )
      .join('')}</div>${pageFields(p, disabled)}`;
  }
  if (state.panel === 'links') {
    const links = index || { edges: [] },
      out = links.edges.filter((e) => e.source === document.id && e.kind !== 'tag'),
      back = links.edges.filter((e) => e.target === document.id && e.kind !== 'tag');
    return `<div class="canvas-panel-heading">Outgoing links</div>${linkList(out.map((e) => e.target))}<div class="canvas-panel-heading">Backlinks</div>${linkList(back.map((e) => e.source))}<button data-canvas-command="link" ${disabled}>Insert link</button><details class="canvas-metadata"><summary>Tags and aliases</summary>${field('Tags', `<input data-scene-meta="tags" value="${esc(document.tags.join(', '))}" ${disabled}>`)}${field('Aliases', `<input data-scene-meta="aliases" value="${esc((document.aliases || []).join(', '))}" ${disabled}>`)}</details>`;
  }
  if (!item) {
    return `<div class="canvas-panel-heading">Document</div>${field('Name', `<input data-scene-meta="title" maxlength="180" value="${esc(document.title)}" ${disabled}>`)}${pageFields(p, disabled)}`;
  }
  return `<div class="canvas-panel-heading">${esc(item.type[0].toUpperCase() + item.type.slice(1))}<button data-canvas-command="deselect" title="Deselect" aria-label="Deselect">${svg('close')}</button></div><fieldset ${disabled}>${pageAssignment(item.pageId)}<div class="canvas-geometry">${number('x', item.x, 'X · pt')}${number('y', item.y, 'Y · pt')}${number('w', item.w, 'Width · pt')}${number('h', item.h, 'Height · pt')}</div>${item.type === 'polygon' ? `${field('Fill', `<input type="color" data-object-prop="fill" value="${item.fill === 'none' ? '#ffffff' : item.fill}">`)}${field('Stroke', `<input type="color" data-object-prop="stroke" value="${item.stroke === 'none' ? '#ffffff' : item.stroke}">`)}${number('strokeWidth', item.strokeWidth, 'Stroke · pt')}<button data-canvas-command="inside" class="canvas-panel-button ${state.inside === item.id ? 'active' : ''}">${state.inside === item.id ? 'Exit draw inside' : 'Draw inside'}</button>${item.clip ? '<button data-canvas-command="release-mask" class="canvas-panel-button">Release mask</button>' : ''}` : ''}${
    ['text', 'quote'].includes(item.type)
      ? `${field(
          'Typeface',
          `<select data-object-prop="textStyle">${[
            ['sans', 'Sans'],
            ['serif', 'Serif'],
            ['cmu-serif', 'CMU Serif (LaTeX)'],
            ['display', 'Display'],
          ]
            .map(
              ([value, label]) =>
                `<option value="${value}" ${item.textStyle === value ? 'selected' : ''}>${label}</option>`,
            )
            .join('')}</select>`,
        )}${number('fontSize', item.fontSize || 16, 'Type size · pt')}${number('leading', item.leading ?? (item.fontSize || 16) * 1.5, 'Leading · pt (0 auto)')}${number('tracking', item.tracking ?? 0, 'Tracking · 1/1000 em')}${field('Text color', `<input type="color" data-object-prop="textColor" value="${item.textColor || '#252525'}">`)}${field('Alignment', `<select data-object-prop="align">${['left', 'center', 'right', 'justify'].map((value) => `<option ${item.align === value ? 'selected' : ''}>${value}</option>`).join('')}</select>`)}${number('paragraphBefore', item.paragraphBefore ?? 0, 'Space before · pt')}${number('paragraphAfter', item.paragraphAfter ?? 0, 'Space after · pt')}<div class="canvas-type-format"><button data-canvas-command="bold" aria-label="Bold">${svg('bold')}</button><button data-canvas-command="italic" aria-label="Italic">${svg('italic')}</button><button data-canvas-command="link">Link</button></div>${item.textFlowId ? `<div class="canvas-flow-status">${textFlowForFrame(document, item).frameIds.length} linked frames${flowStatus.get(item.textFlowId)?.overset ? ' · Overset text' : ''}</div><button class="canvas-panel-button" data-canvas-command="document-text">Edit document text</button><button class="canvas-panel-button" data-canvas-command="thread">Thread into frame…</button><label class="canvas-field"><span>Automatic continuation</span><input type="checkbox" data-flow-auto ${textFlowForFrame(document, item).automaticPages ? 'checked' : ''}></label>` : `<button class="canvas-panel-button" data-canvas-command="start-flow">Flow across pages</button><button class="canvas-panel-button" data-canvas-command="fit-text">Fit frame to text</button>`}`
      : ''
  }${item.type === 'image' ? `<button class="canvas-panel-button" data-canvas-command="replace">Replace file</button>${item.type === 'image' ? field('Image fit', `<select data-object-prop="fit"><option value="cover" ${item.fit !== 'contain' ? 'selected' : ''}>Fill frame</option><option value="contain" ${item.fit === 'contain' ? 'selected' : ''}>Fit image</option></select>`) : ''}${item.type === 'image' ? number('cropX', item.crop?.x ?? 50, 'Crop X · %') + number('cropY', item.crop?.y ?? 50, 'Crop Y · %') : ''}${field('Description', `<input data-object-prop="alt" value="${esc(item.alt || '')}">`)}${field('Caption', `<input data-object-prop="caption" value="${esc(item.caption || '')}">`)}` : ''}<div class="canvas-panel-divider"></div>${item.parentId ? '<button class="canvas-panel-button" data-canvas-command="select-mask">Select mask</button>' : ''}<button class="canvas-panel-button" data-canvas-command="duplicate">Duplicate</button><button class="canvas-panel-button danger" data-canvas-command="delete">Delete</button></fieldset>`;

  function linkList(ids) {
    return (
      [...new Set(ids)]
        .map((id) => {
          const value = documents.find((d) => d.id === id);
          return value
            ? `<button class="canvas-link-row" data-scene-open="${esc(id)}">${esc(value.title)}</button>`
            : '';
        })
        .join('') || '<p class="canvas-empty">None</p>'
    );
  }
  function pageAssignment(pageId) {
    return document.pages.length < 2
      ? ''
      : field(
          'Page',
          `<select data-selection-page aria-label="Move selection to page">${pageId ? '' : '<option value="" selected disabled>Move to page…</option>'}${document.pages
            .map(
              (value) =>
                `<option value="${esc(value.id)}" ${value.id === pageId ? 'selected' : ''}>${esc(value.name)}</option>`,
            )
            .join('')}</select>`,
        );
  }
  function pageFields(p, disabled) {
    return `<div class="canvas-panel-heading">${esc(p.name)}</div><fieldset ${disabled}>${document.pages.length > 1 ? field('Order', `<input type="number" data-page-order min="1" max="${document.pages.length}" step="1" value="${document.pages.findIndex((value) => value.id === p.id) + 1}" aria-label="Page order">`) : ''}${field('Name', `<input data-page-prop="name" value="${esc(p.name)}" maxlength="120">`)}<div class="canvas-geometry">${field('Width · pt', `<input type="number" min="72" max="14400" step="any" data-page-prop="width" value="${p.width}">`)}${field('Height · pt', `<input type="number" min="72" max="14400" step="any" data-page-prop="height" value="${p.height}">`)}</div><button class="canvas-panel-button" data-canvas-command="add-page">Add page</button>${document.pages.length > 1 ? '<button class="canvas-panel-button danger" data-canvas-command="delete-page">Delete page</button>' : ''}</fieldset>`;
  }
}
