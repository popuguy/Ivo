import { effectiveTextStyle } from '../../../domain/documents/publishing.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon } from '../../../shared/ui/icons.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { textWrapControls, showsContextualWrap } from './text-wrap-properties.js';
import { layersContent, pagesContent } from './pages-and-layers.js';
import {
  transformProperties,
  appearanceProperties,
  textProperties,
  styleProperties,
  frameProperties,
  highlightControls,
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
  selectedVertex,
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
  if (state.panel === 'text-wrap')
    return textWrapControls(selectedObjects, {
      state,
      editing: editing && (!!selectedObjects.length || !parentMode),
      dedicated: true,
      defaults: doc.extensions?.ivoTextWrapDefaults,
    });
  if (state.panel === 'layers') return layersContent(doc, state, selectedObjects, editing);
  if (state.panel === 'pages') return pagesContent(doc, activePage, editing, { parentMode, state });
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
    return `<div class="indesign-properties"><div class="canvas-panel-heading">${selectedObjects.length} Objects</div><fieldset ${disabled}>${transformProperties(selectionRect, state, '', true)}${alignControls()}${arrangeControls()}</fieldset></div>`;
  }
  if (!item) {
    const dimensions = ['width', 'height']
      .map(
        (key) =>
          `<label class="property-transform-field"><span>${key === 'width' ? 'W' : 'H'}:</span><span class="property-transform-value"><input type="number" min="72" max="14400" step="any" data-page-prop="${key}" aria-label="Page ${key}" value="${activePage[key]}" ${disabled}><span>pt</span></span></label>`,
      )
      .join('');
    const pageSelect = `<select data-property-page aria-label="Go to page">${doc.pages.map((p, i) => `<option value="${esc(p.id)}" ${p.id === activePage.id ? 'selected' : ''}>${i + 1} · ${esc(p.name)}</option>`).join('')}</select>`;
    const pageAction = (cmd, name, art, enabled) =>
      `<button data-canvas-command="${cmd}" aria-label="${name}" data-tooltip="${name}" ${enabled ? '' : 'disabled'}>${icon(art)}</button>`;
    return `<div class="indesign-properties"><div class="canvas-panel-heading">No Selection</div>${section(
      'Document',
      field('Name', `<input data-scene-meta="title" value="${esc(doc.title)}" ${disabled}>`) +
        `<div class="property-transform-grid">${dimensions}</div>`,
    )}${section('Page', `<div class="property-page-row">${pageSelect}${parentMode ? '' : pageAction('add-page', 'Create new page', 'panel-new', editing && doc.pages.length < 128) + pageAction('delete-page', 'Delete selected page', 'panel-trash', editing && doc.pages.length > 1)}</div><button class="property-wide-action" data-canvas-command="show-pages">Edit Page</button>`)}
    ${section('Quick Actions', `<button class="property-wide-action" data-canvas-command="image" ${disabled}>Import File</button>`)}
    </div>`;
  }
  const composer =
    flow && (nativeComposition || flow.composition)
      ? field(
          'Composer',
          `<select data-flow-composer aria-label="Text composer"><option value="browser" ${!flow.composition ? 'selected' : ''}>Existing layout</option>${['paragraph', 'single-line'].map((value) => `<option value="${value}" ${flow.composition?.composer === value ? 'selected' : ''} ${!nativeComposition ? 'disabled' : ''}>Ivo ${value === 'paragraph' ? 'Paragraph' : 'Single-line'} · Preview</option>`).join('')}</select>`,
        )
      : '';
  const isText = ['text', 'quote'].includes(item.type);
  const movePage =
    doc.pages.length > 1
      ? field(
          'Page',
          `<select data-selection-page aria-label="Move selection to page">${doc.pages.map((p) => `<option value="${p.id}" ${p.id === item.pageId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`,
        )
      : '';
  const flowProperties =
    isText &&
    section(
      'Text Flow',
      `<div class="canvas-flow-status">${flow ? `${flow.frameIds.length} linked frame${flow.frameIds.length === 1 ? '' : 's'}${flowStatus.get(flow.id)?.overset ? ' · Overset text' : ''}` : 'Unthreaded frame'}</div>${composer}` +
        (flow
          ? `<button data-canvas-command="document-text">Edit text</button><label class="publishing-check"><input type="checkbox" data-flow-auto ${flow.automaticPages ? 'checked' : ''}>Automatic continuation</label>`
          : '<button data-canvas-command="start-flow">Flow across pages</button><button data-canvas-command="fit-text">Fit frame to text</button>') +
        '<button data-canvas-command="thread">Thread into frame…</button>',
    );
  const sections = [
    transformProperties(item, state, movePage),
    isText && styleProperties(item, doc, state),
    appearanceProperties(item),
    isText && textProperties(item, fonts, systemFonts, state),
    alignControls(),
    showsContextualWrap(selectedObjects, selectedVertex) &&
      textWrapControls(selectedObjects, { editing, state }),
    isText && frameProperties(item, state),
    section(
      'Quick Actions',
      arrangeControls(false) +
        '<div class="property-quick-actions"><button data-canvas-command="duplicate">Duplicate</button><button class="danger" data-canvas-command="delete">Delete</button></div>',
    ),
    isText && section('Text Highlight', highlightControls(item.highlight)),
    flowProperties,
    item.type === 'polygon' &&
      section(
        'Mask',
        `<button data-canvas-command="inside">${state.inside === item.id ? 'Exit draw inside' : 'Draw inside'}</button>${item.clip ? '<button data-canvas-command="release-mask">Release mask</button>' : ''}`,
      ),
    item.type === 'image' &&
      section(
        'Image',
        `<button data-canvas-command="replace">Replace file</button>${field('Image fit', `<select data-object-prop="fit"><option value="cover" ${item.fit !== 'contain' ? 'selected' : ''}>Fill frame</option><option value="contain" ${item.fit === 'contain' ? 'selected' : ''}>Fit image</option></select>`)}${num('cropX', item.crop?.x ?? 50, 'Crop X · %')}${num('cropY', item.crop?.y ?? 50, 'Crop Y · %')}${field('Description', `<input data-object-prop="alt" value="${esc(item.alt || '')}">`)}${field('Caption', `<input data-object-prop="caption" value="${esc(item.caption || '')}">`)}`,
      ),
  ];
  const heading = isText ? 'Text Frame' : item.type[0].toUpperCase() + item.type.slice(1);
  return `<div class="indesign-properties"><div class="canvas-panel-heading">${heading}</div><fieldset ${disabled}>${sections.filter(Boolean).join('')}</fieldset></div>`;
}
function alignControls() {
  return section(
    'Align',
    `<div class="publishing-align">${[
      ['left', 'Left', 'object-align-left'],
      ['center', 'Horizontal center', 'object-align-center'],
      ['right', 'Right', 'object-align-right'],
      ['top', 'Top', 'align-top'],
      ['middle', 'Vertical center', 'align-middle'],
      ['bottom', 'Bottom', 'align-bottom'],
    ]
      .map(
        ([key, label, art]) =>
          `<button data-canvas-command="align-${key}" aria-label="Align ${label.toLowerCase()}" data-tooltip="Align ${label}">${icon(art)}</button>`,
      )
      .join('')}</div>`,
  );
}
function arrangeControls(standalone = true) {
  const commands =
    '<div class="publishing-inline-actions"><button data-canvas-command="bring-front" data-tooltip="Bring to front" aria-label="Bring to front">' +
    icon('bring-to-front') +
    '</button><button data-canvas-command="send-back" data-tooltip="Send to back" aria-label="Send to back">' +
    icon('send-to-back') +
    '</button></div>';
  return standalone
    ? section('Arrange', commands)
    : `<details class="property-arrange"><summary>Arrange</summary>${commands}</details>`;
}
