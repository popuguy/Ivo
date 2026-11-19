import { effectiveTextStyle } from '../../../domain/documents/publishing.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon } from '../../../shared/ui/icons.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { textWrapProperties, textWrapPreferences } from './text-wrap-properties.js';
import {
  layersContent,
  pagesContent,
  transformProperties,
  appearanceProperties,
  textProperties,
  styleProperties,
  frameProperties,
  field,
  num,
  section,
} from './publishing-properties.js';

/** Context-sensitive presentation only; commands and source ownership remain in the editor/domain. */
export function propertiesContent({
  document: doc,
  documents,
  state,
  selectedObjects,
  selectionRect,
  activePage,
  editing,
  parentMode = false,
  index,
  flowStatus,
  fonts = [],
  systemFonts = [],
  textSummary = null,
  nativeComposition = false,
}) {
  const raw = selectedObjects.length === 1 ? selectedObjects[0] : null,
    flow = textFlowForFrame(doc, raw),
    item = raw
      ? {
          ...effectiveTextStyle(
            doc,
            flow ? { ...raw, ...flow.style, textOverrides: flow.style.textOverrides } : raw,
          ),
          ...textSummary?.values,
        }
      : null,
    disabled = editing ? '' : 'disabled';
  if (state.panel === 'layers') return layersContent(doc, state, selectedObjects, editing);
  if (state.panel === 'pages') return pagesContent(doc, activePage, editing, { parentMode });
  if (state.panel === 'links') {
    const edges = index?.edges || [],
      links = (ids) =>
        [...new Set(ids)]
          .map((id) => documents.find((d) => d.id === id))
          .filter(Boolean)
          .map(
            (d) =>
              `<button class="canvas-link-row" data-scene-open="${esc(d.id)}">${esc(d.title)}</button>`,
          )
          .join('') || '<p class="canvas-empty">None</p>';
    return (
      section(
        'Outgoing links',
        links(edges.filter((e) => e.source === doc.id && e.kind !== 'tag').map((e) => e.target)),
      ) +
      section(
        'Backlinks',
        links(edges.filter((e) => e.target === doc.id && e.kind !== 'tag').map((e) => e.source)),
      ) +
      `<button data-canvas-command="link" ${disabled}>Insert link</button><details class="canvas-metadata"><summary>Tags and aliases</summary>${field('Tags', `<input data-scene-meta="tags" value="${esc(doc.tags.join(', '))}" ${disabled}>`)}${field('Aliases', `<input data-scene-meta="aliases" value="${esc((doc.aliases || []).join(', '))}" ${disabled}>`)}</details>`
    );
  }
  if (selectedObjects.length > 1) {
    const r = selectionRect;
    return `<div class="canvas-panel-heading">${selectedObjects.length} Objects</div><fieldset ${disabled}>${section('Transform', `<div class="canvas-geometry">${['x', 'y', 'w', 'h'].map((key) => field({ x: 'X', y: 'Y', w: 'Width', h: 'Height' }[key] + ' · pt', `<input type="number" step="any" data-selection-prop="${key}" value="${r[key]}">`)).join('')}</div>`)}${textWrapProperties(selectedObjects, { editing })}${alignControls()}${arrangeControls()}</fieldset>`;
  }
  if (!item)
    return `<div class="canvas-panel-heading">No Selection</div>${section('Document', field('Name', `<input data-scene-meta="title" value="${esc(doc.title)}" ${disabled}>`))}${section('Page', `<p>${esc(activePage.name)} · ${activePage.width} × ${activePage.height} pt</p><button data-canvas-command="show-pages">Edit pages</button>`)}${textWrapPreferences(doc, { editing })}`;
  const composer =
    flow && (nativeComposition || flow.composition)
      ? field(
          'Composer',
          `<select data-flow-composer aria-label="Text composer"><option value="browser" ${!flow.composition ? 'selected' : ''}>Existing layout</option>${['paragraph', 'single-line'].map((value) => `<option value="${value}" ${flow.composition?.composer === value ? 'selected' : ''} ${!nativeComposition ? 'disabled' : ''}>Ivo ${value === 'paragraph' ? 'Paragraph' : 'Single-line'} · Preview</option>`).join('')}</select>`,
        )
      : '';
  return `<div class="canvas-panel-heading">${['text', 'quote'].includes(item.type) ? 'Text Frame' : item.type[0].toUpperCase() + item.type.slice(1)}</div><fieldset ${disabled}>${doc.pages.length > 1 ? field('Page', `<select data-selection-page aria-label="Move selection to page">${doc.pages.map((p) => `<option value="${p.id}" ${p.id === item.pageId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`) : ''}${transformProperties(item, state)}${['text', 'quote'].includes(item.type) ? styleProperties(item, doc, state) : ''}${appearanceProperties(item)}${textWrapProperties(selectedObjects, { editing })}${['text', 'quote'].includes(item.type) ? textProperties(item, fonts, systemFonts) + frameProperties(item) + section('Text Flow', `<div class="canvas-flow-status">${flow ? `${flow.frameIds.length} linked frame${flow.frameIds.length === 1 ? '' : 's'}${flowStatus.get(flow.id)?.overset ? ' · Overset text' : ''}` : 'Unthreaded frame'}</div>${composer}${flow ? '<button data-canvas-command="document-text">Edit text</button><label class="publishing-check"><input type="checkbox" data-flow-auto ' + (flow.automaticPages ? 'checked' : '') + '>Automatic continuation</label>' : '<button data-canvas-command="start-flow">Flow across pages</button><button data-canvas-command="fit-text">Fit frame to text</button>'}<button data-canvas-command="thread">Thread into frame…</button>`) : ''}${item.type === 'polygon' ? section('Mask', `<button data-canvas-command="inside">${state.inside === item.id ? 'Exit draw inside' : 'Draw inside'}</button>${item.clip ? '<button data-canvas-command="release-mask">Release mask</button>' : ''}`) : ''}${item.type === 'image' ? section('Image', `<button data-canvas-command="replace">Replace file</button>${field('Image fit', `<select data-object-prop="fit"><option value="cover" ${item.fit !== 'contain' ? 'selected' : ''}>Fill frame</option><option value="contain" ${item.fit === 'contain' ? 'selected' : ''}>Fit image</option></select>`)}${num('cropX', item.crop?.x ?? 50, 'Crop X · %')}${num('cropY', item.crop?.y ?? 50, 'Crop Y · %')}${field('Description', `<input data-object-prop="alt" value="${esc(item.alt || '')}">`)}${field('Caption', `<input data-object-prop="caption" value="${esc(item.caption || '')}">`)}`) : ''}${alignControls()}${arrangeControls()}${section('Quick Actions', `<button data-canvas-command="duplicate">Duplicate</button><button class="danger" data-canvas-command="delete">Delete</button>`)}</fieldset>`;
}
function alignControls() {
  return section(
    'Align',
    `<div class="publishing-align">${[
      ['left', 'Left', 'align-left'],
      ['center', 'Horizontal center', 'align-center'],
      ['right', 'Right', 'align-right'],
      ['top', 'Top', 'align-left'],
      ['middle', 'Vertical center', 'align-center'],
      ['bottom', 'Bottom', 'align-right'],
    ]
      .map(
        ([key, label, art]) =>
          `<button data-canvas-command="align-${key}" aria-label="Align ${label.toLowerCase()}" data-tooltip="Align ${label}">${icon(art)}</button>`,
      )
      .join('')}</div>`,
  );
}
function arrangeControls() {
  return section(
    'Arrange',
    `<div class="publishing-inline-actions"><button data-canvas-command="bring-front" data-tooltip="Bring to front" aria-label="Bring to front">${icon('bring-to-front')}</button><button data-canvas-command="send-back" data-tooltip="Send to back" aria-label="Send to back">${icon('send-to-back')}</button></div>`,
  );
}
