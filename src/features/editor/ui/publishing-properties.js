import { fontChoices } from '../../../domain/text/font-catalog.js';
import { referencePoint } from '../../../domain/geometry/transform-reference.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon } from '../../../shared/ui/icons.js';
import { HIGHLIGHT_COLORS } from '../../../domain/text/typography.js';
import { layersFor, layerFor } from '../../../domain/documents/publishing.js';

export const section = (title, body) =>
  `<section class="publishing-section"><h3>${title}</h3>${body}</section>`;
export const field = (label, input) =>
  `<label class="canvas-field"><span>${label}</span>${input}</label>`;
export const num = (prop, value, label = prop, extra = '') =>
  field(
    label,
    `<input type="number" step="any" data-object-prop="${prop}" value="${Number(Number(value).toFixed(4))}" aria-label="Object ${esc(label)}" ${extra}>`,
  );
export const choose = (prop, value, values, label) =>
  field(
    label,
    `<select data-object-prop="${prop}" aria-label="${esc(label)}">${values
      .map((v) => {
        const [key, text] = Array.isArray(v) ? v : [v, v];
        return `<option value="${esc(key)}" ${String(value) === String(key) ? 'selected' : ''}>${esc(text)}</option>`;
      })
      .join('')}</select>`,
  );
export const check = (prop, value, label) =>
  `<label class="publishing-check"><input type="checkbox" data-object-prop="${prop}" ${value ? 'checked' : ''}>${label}</label>`;
const button = (command, label, art) =>
  `<button class="publishing-action" data-canvas-command="${command}" ${art ? `aria-label="${esc(label)}" data-tooltip="${esc(label)}"` : ''}>${art ? icon(art) : esc(label)}</button>`;

export function highlightControls(value) {
  return `<div class="highlight-swatches" role="group" aria-label="Text highlight">${HIGHLIGHT_COLORS.map((color) => `<button data-highlight-color="${color}" class="${value === color ? 'active' : ''}" style="--highlight-color:${color}" aria-label="Highlight ${color}" data-tooltip="Highlight ${color}"></button>`).join('')}<button data-highlight-color="none" aria-label="Remove highlight" data-tooltip="Remove highlight">${icon('close')}</button>${field('Custom', `<input type="color" data-object-prop="highlight" value="${value && value !== 'none' ? value : '#fff176'}" aria-label="Custom highlight color">`)}</div>`;
}
export function transformProperties(item, state) {
  const point = referencePoint(item, state.transformReference);
  return section(
    'Transform',
    `<div class="publishing-transform"><div class="transform-reference" role="group" aria-label="Transform reference point">${Array.from({ length: 9 }, (_, i) => `<button data-transform-reference="${i}" class="${(state.transformReference ?? 0) === i ? 'active' : ''}" aria-label="${['Top left', 'Top center', 'Top right', 'Middle left', 'Center', 'Middle right', 'Bottom left', 'Bottom center', 'Bottom right'][i]} reference point"></button>`).join('')}</div><div class="canvas-geometry">${num('x', point.x, 'X · pt')}${num('w', item.w, 'Width · pt')}${num('y', point.y, 'Y · pt')}${num('h', item.h, 'Height · pt')}</div></div>`,
  );
}
export function appearanceProperties(item) {
  const f = item.frameOptions || {};
  return section(
    'Appearance',
    `<div class="publishing-appearance">${item.type === 'polygon' ? field('Fill', `<input type="color" data-object-prop="fill" value="${item.fill === 'none' ? '#ffffff' : item.fill}">`) + field('Stroke', `<input type="color" data-object-prop="stroke" value="${item.stroke === 'none' ? '#000000' : item.stroke}">`) + num('strokeWidth', item.strokeWidth, 'Stroke · pt') : `${frameField('Fill', 'fill', f.fill || 'none', 'color')}${frameField('Stroke', 'stroke', f.stroke || 'none', 'color')}${frameField('Stroke · pt', 'strokeWidth', f.strokeWidth || 0)}`}${num('opacity', item.opacity ?? 100, 'Opacity · %')}${item.type !== 'polygon' ? frameField('Corner · pt', 'corner', f.corner || 0) : ''}</div>`,
  );
}
export function frameField(label, key, value, type = 'number') {
  return field(
    label,
    `${type === 'color' ? `<span class="frame-color"><input type="color" data-frame-prop="${key}" value="${value === 'none' ? '#ffffff' : value}" aria-label="Frame ${label}"><button data-frame-none="${key}" aria-label="No ${label.toLowerCase()}" data-tooltip="None">∅</button></span>` : `<input type="${type}" step="any" min="0" data-frame-prop="${key}" value="${value}" aria-label="Frame ${esc(label)}">`}`,
  );
}
export function styleProperties(item, doc, state) {
  const kind = state.styleKind || 'paragraph',
    definitions = doc.publishing?.[kind + 'Styles'] || [];
  return section(
    'Text Style',
    `<div class="style-kind-tabs" role="group" aria-label="Text style kind">${['paragraph', 'character'].map((value) => `<button data-style-kind="${value}" aria-pressed="${kind === value}">${value === 'paragraph' ? 'Paragraph' : 'Character'} Styles</button>`).join('')}</div><div class="publishing-style-row">${choose(kind + 'Style', item[kind + 'Style'] || 'none', [['none', kind === 'paragraph' ? '[Basic Paragraph]' : '[None]'], ...definitions.map((s) => [s.id, s.name])], kind === 'paragraph' ? 'Paragraph Styles' : 'Character Styles')}${button('new-' + kind + '-style', 'New ' + kind + ' style', 'plus')}${button('edit-' + kind + '-style', 'Edit ' + kind + ' style', 'edit')}</div>${button('clear-overrides', 'Clear overrides in selection')}`,
  );
}
export function textProperties(item, fonts, installed = []) {
  const fontsList = fontChoices(fonts, installed, item.textStyle);
  return (
    section(
      'Character',
      `${choose('textStyle', item.textStyle, fontsList, 'Font family')}<div class="publishing-inline-actions">${button('bold', 'Bold', 'bold')}${button('italic', 'Italic', 'italic')}${check('underline', item.underline, 'Underline')}${check('strikethrough', item.strikethrough, 'Strikethrough')}</div><div class="canvas-geometry">${num('fontSize', item.fontSize || 16, 'Type size · pt')}${num('leading', item.leading ?? 0, 'Leading · pt (0 auto)')}${choose(
        'kerning',
        item.kerning || 'metrics',
        [
          ['metrics', 'Metrics'],
          ['none', '0'],
        ],
        'Kerning',
      )}${num('tracking', item.tracking || 0, 'Tracking · 1/1000 em')}</div><details class="publishing-more"><summary data-tooltip="More character options">More options</summary><div class="canvas-geometry">${num('autoLeading', item.autoLeading || 120, 'Auto leading · %')}${num('baselineShift', item.baselineShift || 0, 'Baseline shift · pt')}${num('horizontalScale', item.horizontalScale ?? 100, 'Horizontal scale · %')}${num('verticalScale', item.verticalScale ?? 100, 'Vertical scale · %')}</div>${choose(
        'language',
        item.language || 'en-US',
        [
          ['en-US', 'English: USA'],
          ['en-GB', 'English: UK'],
          ['fr', 'French'],
          ['de', 'German'],
          ['es', 'Spanish'],
          ['it', 'Italian'],
          ['ja', 'Japanese'],
          ['zh', 'Chinese'],
          ['ar', 'Arabic'],
          ['he', 'Hebrew'],
        ],
        'Language',
      )}${button('type-options', 'Open explore more type options')}</details>${field('Text fill', `<input type="color" data-object-prop="textColor" value="${item.textColor || '#252525'}">`)}${button('import-font', 'Add font to vault…')}${button('refresh-fonts', 'Refresh installed fonts')}`,
    ) +
    section(
      'Paragraph',
      `${choose(
        'align',
        item.align || 'left',
        [
          ['left', 'Align left'],
          ['center', 'Align center'],
          ['right', 'Align right'],
          ['justify', 'Justify, last left'],
          ['justify-center', 'Justify, last center'],
          ['justify-right', 'Justify, last right'],
          ['justify-all', 'Justify all lines'],
          ['start', 'Align to start'],
          ['end', 'Align to end'],
        ],
        'Alignment',
      )}<details class="publishing-more"><summary data-tooltip="More paragraph options">More options</summary><div class="canvas-geometry">${num('leftIndent', item.leftIndent || 0, 'Left indent · pt')}${num('rightIndent', item.rightIndent || 0, 'Right indent · pt')}${num('firstLineIndent', item.firstLineIndent || 0, 'First line indent · pt')}${num('paragraphBefore', item.paragraphBefore || 0, 'Space before · pt')}${num('paragraphAfter', item.paragraphAfter || 0, 'Space after · pt')}</div>${check('hyphenate', item.hyphenate, 'Hyphenate')}${check('keepTogether', item.keepTogether, 'Keep paragraph together')}${check('keepWithNext', item.keepWithNext, 'Keep with next')}<div class="canvas-geometry">${num('widows', item.widows || 2, 'Widows')}${num('orphans', item.orphans || 2, 'Orphans')}</div>${choose(
        'direction',
        item.direction || 'ltr',
        [
          ['ltr', 'Left to right'],
          ['rtl', 'Right to left'],
          ['auto', 'Automatic'],
        ],
        'Direction',
      )}</details>`,
    ) +
    section('Text Highlight', highlightControls(item.highlight))
  );
}
export function frameProperties(item) {
  const f = item.frameOptions || {};
  return section(
    'Text Frame',
    `<div class="canvas-geometry">${frameField('Columns', 'columns', f.columns || 1)}${frameField('Gutter · pt', 'gutter', f.gutter ?? 12)}</div><details class="publishing-more"><summary data-tooltip="Text frame options">Options</summary><div class="canvas-geometry">${['Top', 'Right', 'Bottom', 'Left'].map((side) => frameField(side + ' inset · pt', 'inset' + side, f['inset' + side] || 0)).join('')}</div>${field('Vertical justification', `<select data-frame-prop="verticalAlign" aria-label="Vertical justification">${['top', 'center', 'bottom'].map((v) => `<option value="${v}" ${f.verticalAlign === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}${field(
      'First baseline offset',
      `<select data-frame-prop="firstBaseline" aria-label="First baseline offset">${[
        ['legacy', 'Automatic'],
        ['ascent', 'Ascent'],
        ['cap-height', 'Cap Height'],
        ['x-height', 'x Height'],
        ['leading', 'Leading'],
        ['fixed', 'Fixed'],
      ]
        .map(
          ([v, label]) =>
            `<option value="${v}" ${(f.firstBaseline || 'legacy') === v ? 'selected' : ''}>${label}</option>`,
        )
        .join('')}</select>`,
    )}${frameField('Minimum first baseline · pt', 'minimumFirstBaseline', f.minimumFirstBaseline || 0)}</details>`,
  );
}
export function layersContent(doc, state, selected, editing) {
  const layers = layersFor(doc),
    disabled = editing ? '' : 'disabled';
  return `<div class="publishing-layer-list" role="tree" aria-label="Layers">${[...layers]
    .reverse()
    .map(
      (layer) =>
        `<div class="publishing-layer ${state.activeLayer === layer.id ? 'active' : ''}" data-layer-row="${layer.id}" draggable="${editing}"><div class="layer-heading"><button data-layer-toggle="visible" data-layer-id="${layer.id}" aria-label="${layer.visible ? 'Hide' : 'Show'} ${esc(layer.name)}" data-tooltip="Toggle visibility" ${disabled}>${icon(layer.visible ? 'eye' : 'eye-off')}</button><button data-layer-toggle="locked" data-layer-id="${layer.id}" aria-label="${layer.locked ? 'Unlock' : 'Lock'} ${esc(layer.name)}" data-tooltip="Toggle lock" ${disabled}>${icon(layer.locked ? 'lock' : 'unlock')}</button><button data-layer-select="${layer.id}" class="layer-name" style="--layer-color:${layer.color}">${esc(layer.name)}</button><button data-layer-move="${layer.id}" aria-label="Move selection to ${esc(layer.name)}" data-tooltip="Move selection to this layer" ${selected.length && editing ? '' : 'disabled'}>▪</button></div><div role="group">${[
          ...doc.blocks,
        ]
          .reverse()
          .filter((b) => !b.parentId && layerFor(doc, b).id === layer.id)
          .map(
            (b) =>
              `<div class="layer-object ${selected.some((s) => s.id === b.id) ? 'selected' : ''}"><button data-object-toggle="hidden" data-object-id="${b.id}" aria-label="${b.hidden ? 'Show' : 'Hide'} object" ${disabled}>${icon(b.hidden ? 'eye-off' : 'eye')}</button><button data-object-toggle="locked" data-object-id="${b.id}" aria-label="${b.locked ? 'Unlock' : 'Lock'} object" ${disabled}>${icon(b.locked ? 'lock' : 'unlock')}</button><button data-layer-object="${b.id}">${esc(b.name || b.type[0].toUpperCase() + b.type.slice(1))}</button></div>`,
          )
          .join('')}</div></div>`,
    )
    .join(
      '',
    )}</div><div class="publishing-panel-footer">${button('new-layer', 'New layer', 'plus')}${button('layer-options', 'Layer options', 'settings')}${button('delete-layer', 'Delete layer', 'delete')}</div>`;
}
export function pagesContent(doc, page, editing, { parentMode = false } = {}) {
  const parents = doc.publishing?.parents || [],
    disabled = editing ? '' : 'disabled';
  const definitions = parentMode
    ? ''
    : `<section class="parent-page-list"><button data-page-parent="" class="parent-page-none">[None]</button>${parents.map((p) => `<div class="parent-page-row"><button data-page-parent="${p.id}" title="Apply to selected page">${esc(p.prefix + '-' + p.name)}</button><button data-parent-edit="${p.id}" data-tooltip="Edit parent definition" aria-label="Edit ${esc(p.prefix + '-' + p.name)}" ${disabled}>${icon('edit')}</button></div>`).join('')}<button data-canvas-command="new-parent" ${disabled}>New parent from selected page…</button></section>`;
  const actions = parentMode
    ? ''
    : `<div class="publishing-panel-footer">${button('add-page', 'Add page', 'plus')}${doc.pages.length > 1 ? button('delete-page', 'Delete page', 'delete') : ''}</div>`;
  return `${definitions}<div class="canvas-page-list publishing-page-grid">${doc.pages.map((p, i) => `<button data-select-page="${p.id}" class="${p.id === page.id ? 'active' : ''}" aria-label="Select ${esc(p.name)}"><span class="page-thumbnail" style="aspect-ratio:${p.width}/${p.height}"><small>${esc(parents.find((parent) => parent.id === p.parentPageId)?.prefix || '')}</small></span><span>${i + 1}</span></button>`).join('')}</div>${section(parentMode ? 'Parent page' : 'Page', `${field('Name', `<input data-page-prop="name" value="${esc(page.name)}" ${disabled}>`)}<div class="canvas-geometry">${field('Width · pt', `<input type="number" min="72" max="14400" data-page-prop="width" value="${page.width}" ${disabled}>`)}${field('Height · pt', `<input type="number" min="72" max="14400" data-page-prop="height" value="${page.height}" ${disabled}>`)}</div>${parentMode ? '' : field('Order', `<input type="number" data-page-order value="${doc.pages.indexOf(page) + 1}" min="1" max="${doc.pages.length}" aria-label="Page order" ${disabled}>`)}${page.parentPageId ? button('override-parent', 'Override parent items') + button('restore-parent', 'Remove local parent overrides') : ''}`)}${actions}`;
}
