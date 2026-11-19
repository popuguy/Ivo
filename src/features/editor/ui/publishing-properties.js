import { PARAGRAPH_STARTS } from '../../../domain/text/paragraph-keep-policy.js';
import { fontChoices, systemFontId } from '../../../domain/text/font-catalog.js';
import { referencePoint } from '../../../domain/geometry/transform-reference.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon } from '../../../shared/ui/icons.js';
import { HIGHLIGHT_COLORS } from '../../../domain/text/typography.js';
import { basicParagraph } from '../../../domain/documents/publishing.js';

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
const typeSizes = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 21, 24, 30, 36, 48, 60, 72];
const propertyPresets = {
  fontSize: typeSizes,
  leading: [0, ...typeSizes],
  tracking: [-100, -75, -50, -25, -10, -5, 0, 5, 10, 25, 50, 75, 100, 125, 150, 200],
  horizontalScale: [25, 50, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 150, 175, 200],
  verticalScale: [25, 50, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 150, 175, 200],
};
function presetPicker(key, label, unit, value) {
  const presets = propertyPresets[key];
  if (!presets) return '';
  const options = [...new Set([...presets, value])].sort((a, b) => a - b);
  return `<span class="property-presets"><select data-property-presets aria-label="${esc(label)} presets">${options.map((number) => `<option value="${number}" ${value === number ? 'selected' : ''}>${key === 'leading' && number === 0 ? 'Auto' : number + (unit ? ' ' + unit : '')}</option>`).join('')}</select></span>`;
}
const unitNumber = (attr, key, value, label, unit, { step = 1, min, max, auto } = {}) => {
  const number = Number(Number(value).toFixed(4));
  return `<span class="property-number"><span class="property-steppers">${[1, -1].map((delta) => `<button type="button" data-property-step="${delta}" aria-label="${delta > 0 ? 'Increase' : 'Decrease'} ${esc(label)}" tabindex="-1"></button>`).join('')}</span><input type="number" data-${attr}="${key}" value="${number}" aria-label="${esc(label)}" step="${step}" ${min === undefined ? '' : `min="${min}"`} ${max === undefined ? '' : `max="${max}"`}>${auto ? `<span class="auto-leading-value" aria-hidden="true">${esc(auto)}</span>` : ''}${unit ? `<span class="property-unit" aria-hidden="true">${unit}</span>` : ''}${presetPicker(key, label, unit, number)}</span>`;
};
const metric = (art, input, label) =>
  `<div class="property-metric"><span class="property-glyph" data-tooltip="${esc(label)}" aria-hidden="true">${icon(art)}</span>${input}</div>`;
const measure = (prop, value, label, art, unit = '', options) =>
  metric(art, unitNumber('object-prop', prop, value, label, unit, options), label);
export function moreOptions(key, label, content, state, buttonLabel = '') {
  const expanded = !!state.propertyDisclosures?.[key];
  return `<details class="property-disclosure ${buttonLabel ? 'named-disclosure' : ''}" ${expanded ? 'open' : ''}><summary data-property-disclosure="${key}" aria-label="${esc(label)}" data-tooltip="${esc(label)}">${buttonLabel || icon('dots')}</summary><div class="property-disclosed">${content}</div></details>`;
}
function transformMeasure(prop, value, shortName, name, selection) {
  return `<label class="property-transform-field"><span>${shortName}:</span><span class="property-transform-value"><input type="number" step="any" data-${selection ? 'selection' : 'object'}-prop="${prop}" value="${Number(value.toFixed(4))}" aria-label="Object ${name} · pt"><span>pt</span></span></label>`;
}
export function transformProperties(item, state, extra = '', selection = false) {
  const point = referencePoint(item, state.transformReference);
  const positions = [
    'Top left',
    'Top center',
    'Top right',
    'Middle left',
    'Center',
    'Middle right',
    'Bottom left',
    'Bottom center',
    'Bottom right',
  ];
  return section(
    'Transform',
    `<div class="publishing-transform"><div class="transform-reference" role="group" aria-label="Transform reference point">${positions.map((label, i) => `<button data-transform-reference="${i}" class="${(state.transformReference ?? 0) === i ? 'active' : ''}" aria-pressed="${(state.transformReference ?? 0) === i}" aria-label="${label} reference point" data-tooltip="${label}"></button>`).join('')}</div><div class="property-transform-grid">${transformMeasure('x', point.x, 'X', 'X', selection)}${transformMeasure('w', item.w, 'W', 'Width', selection)}${transformMeasure('y', point.y, 'Y', 'Y', selection)}${transformMeasure('h', item.h, 'H', 'Height', selection)}</div><button class="property-constrain" data-property-constrain aria-label="Constrain proportions" data-tooltip="Constrain proportions" aria-pressed="${!!state.constrainProportions}">${icon(state.constrainProportions ? 'link' : 'unlink')}</button></div>` +
      (selection
        ? ''
        : moreOptions(
            'transform',
            'More Transform options',
            num('rotation', item.rotation || 0, 'Rotation · °', 'min="-36000" max="36000"') + extra,
            state,
          )),
  );
}
function paintChip(prop, label, value, polygon) {
  const key = polygon ? 'object-prop' : 'frame-prop';
  return `<label class="property-paint ${value === 'none' ? 'no-paint' : ''} ${prop}" data-tooltip="${label}"><input type="color" data-${key}="${prop}" value="${value === 'none' ? (prop === 'stroke' ? '#000000' : '#ffffff') : esc(value)}" aria-label="${label}"></label>`;
}
export function appearanceProperties(item) {
  const polygon = item.type === 'polygon';
  const paint = polygon ? item : item.frameOptions || {};
  const row = (glyph, title, control) =>
    `<div class="property-appearance-row">${glyph}<span>${title}</span><div>${control}</div></div>`;
  const clear = (key) =>
    `<button class="property-none" data-${polygon ? 'object' : 'frame'}-none="${key}" aria-label="No ${key}" data-tooltip="None"></button>`;
  return section(
    'Appearance',
    row(paintChip('fill', 'Fill', paint.fill || 'none', polygon), 'Fill', clear('fill')) +
      row(
        paintChip('stroke', 'Stroke', paint.stroke || 'none', polygon),
        'Stroke',
        unitNumber(
          polygon ? 'object-prop' : 'frame-prop',
          'strokeWidth',
          paint.strokeWidth || 0,
          'Stroke weight',
          'pt',
          { min: 0, max: 100 },
        ) + clear('stroke'),
      ) +
      (polygon
        ? ''
        : row(
            icon('corner-options'),
            'Corner',
            unitNumber('frame-prop', 'corner', paint.corner || 0, 'Corner size', 'pt', { min: 0 }),
          )) +
      row(
        icon('opacity'),
        'Opacity',
        unitNumber('object-prop', 'opacity', item.opacity ?? 100, 'Opacity', '%', {
          min: 0,
          max: 100,
        }),
      ),
  );
}
function frameField(label, key, value) {
  return field(
    label,
    `<input type="number" step="any" min="0" data-frame-prop="${key}" value="${value}" aria-label="Frame ${esc(label)}">`,
  );
}
export function styleProperties(item, doc, state) {
  const kind = state.styleKind || 'paragraph';
  const definitions = doc.publishing?.[kind + 'Styles'] || [];
  const styles = [
    ['none', kind === 'paragraph' && !basicParagraph(doc) ? '[Basic Paragraph]' : '[None]'],
    ...definitions.map((s) => [s.id, s.name]),
  ];
  return section(
    'Text Style',
    `<div class="style-kind-tabs" role="group" aria-label="Text style kind">${['paragraph', 'character'].map((value) => `<button data-style-kind="${value}" aria-pressed="${kind === value}">${value === 'paragraph' ? 'Paragraph' : 'Character'} Styles</button>`).join('')}</div>
     <div class="property-style-picker"><span aria-hidden="true">Ag</span>${choose(kind + 'Style', item[kind + 'Style'] || 'none', styles, kind === 'paragraph' ? 'Paragraph Styles' : 'Character Styles')}</div>
     <div class="property-style-actions">${button('edit-' + kind + '-style', 'Edit ' + kind + ' style', 'edit')}${button('clear-overrides', 'Clear overrides in selection', 'clear-overrides')}${button('new-' + kind + '-style', 'New ' + kind + ' style', 'plus')}</div>`,
  );
}
const alignmentChoices = [
  ['left', 'Align left', 'paragraph-left'],
  ['center', 'Align center', 'paragraph-center'],
  ['right', 'Align right', 'paragraph-right'],
  ['justify', 'Justify with last line aligned left', 'paragraph-justify-left'],
  ['justify-center', 'Justify with last line centered', 'paragraph-justify-center'],
  ['justify-right', 'Justify with last line aligned right', 'paragraph-justify-right'],
  ['justify-all', 'Justify all lines', 'paragraph-justify-all'],
  ['start', 'Align to start'],
  ['end', 'Align to end'],
];
const languageChoices = [
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
];
const typefaceVariants = [
  ['regular', 'Regular', false, false],
  ['italic', 'Italic', false, true],
  ['bold', 'Bold', true, false],
  ['bold-italic', 'Bold Italic', true, true],
];
function fontStyleOptions(family, faces, fonts, installed) {
  const familyFaces = faces.filter(([, name]) => name.startsWith(family + ' · '));
  if (!familyFaces.length || ['CMU Serif', 'Geist'].includes(family))
    return typefaceVariants
      .map(
        ([key, label, bold, italic]) =>
          `<option value="${key}" data-bold="${bold}" data-italic="${italic}">${label}</option>`,
      )
      .join('');
  const metadata = new Map();
  for (const face of installed) metadata.set(face.id || systemFontId(face.postscript), face);
  for (const asset of fonts) metadata.set(asset.id, asset.font);
  return familyFaces
    .map(([id, label]) => {
      const style = label.slice(family.length + 3),
        meta = metadata.get(id);
      return `<option value="${esc(id)}" data-font-face data-bold="${(meta?.weight ?? 400) >= 600}" data-italic="${meta?.italic ?? /italic|oblique/i.test(style)}">${esc(style)}</option>`;
    })
    .join('');
}
export function reflectPropertyFormatting(editor, summary, fontSources) {
  const panel = editor.querySelector('.indesign-properties');
  if (!panel || !summary) return;
  const { values, mixed } = summary;
  const familySelect = panel.querySelector('[data-object-prop="textStyle"]');
  if (!familySelect) return;
  const family = familySelect.selectedOptions[0]?.textContent.split(' · ')[0] || '';
  const familyName = panel.querySelector('.property-family-name');
  if (familyName.textContent !== family) familyName.textContent = family;
  const style = panel.querySelector('[data-font-style]');
  if (style.dataset.family !== family) {
    const fonts = fontSources.fonts?.() || [];
    const installed = fontSources.systemFonts?.() || [];
    style.innerHTML = fontStyleOptions(
      family,
      fontChoices(fonts, installed, values.textStyle),
      fonts,
      installed,
    );
    style.dataset.family = family;
  }
  if (style !== document.activeElement) {
    const options = Array.from(style.options);
    const matching = options.filter(
      (option) =>
        (option.dataset.bold === 'true') === !!values.bold &&
        (option.dataset.italic === 'true') === !!values.italic,
    );
    const selected = matching.find((option) => option.value === values.textStyle) || matching[0];
    style.value = mixed.some((key) => ['textStyle', 'bold', 'italic'].includes(key))
      ? ''
      : selected?.value || '';
  }
  const leading = panel.querySelector('[data-object-prop="leading"]').parentElement;
  leading.classList.toggle(
    'uses-auto-leading',
    values.leading === 0 && !mixed.includes('fontSize') && !mixed.includes('autoLeading'),
  );
  const leadingText =
    '(' +
    Number((((values.fontSize || 12) * (values.autoLeading || 120)) / 100).toFixed(2)) +
    ' pt)';
  const autoLabel = leading.querySelector('.auto-leading-value');
  if (autoLabel.textContent !== leadingText) autoLabel.textContent = leadingText;
  for (const button of panel.querySelectorAll('[data-paragraph-align]')) {
    const pressed = String(values.align === button.dataset.paragraphAlign);
    if (button.getAttribute('aria-pressed') !== pressed)
      button.setAttribute('aria-pressed', pressed);
  }
}
export function textProperties(item, fonts, installed = [], state = {}, nativeFlow = false) {
  const faces = fontChoices(fonts, installed, item.textStyle);
  const family = faces.find(([key]) => key === item.textStyle)?.[1].split(' · ')[0] || '';
  const advanced = `<div class="property-metrics">${measure('verticalScale', item.verticalScale ?? 100, 'Vertical Scale', 'type-vertical-scale', '%', { min: 10, max: 1000 })}${measure('horizontalScale', item.horizontalScale ?? 100, 'Horizontal Scale', 'type-horizontal-scale', '%', { min: 10, max: 1000 })}${measure('baselineShift', item.baselineShift || 0, 'Baseline Shift', 'type-baseline-shift', 'pt')}</div><div class="publishing-inline-actions">${button('bold', 'Bold', 'bold')}${button('italic', 'Italic', 'italic')}${check('underline', item.underline, 'Underline')}${check('strikethrough', item.strikethrough, 'Strikethrough')}${nativeFlow ? check('noBreak', item.noBreak, 'No Break') : ''}</div>${choose('language', item.language || 'en-US', languageChoices, 'Language')}${num('autoLeading', item.autoLeading || 120, 'Auto leading · %')}${field('Text fill', `<input type="color" data-object-prop="textColor" value="${item.textColor || '#252525'}">`)}<div class="property-extra-actions">${button('type-options', 'Explore more type options…')}${button('import-font', 'Add font to vault…')}${button('refresh-fonts', 'Refresh installed fonts')}</div>`;
  const auto =
    '(' + Number((((item.fontSize || 12) * (item.autoLeading || 120)) / 100).toFixed(2)) + ' pt)';
  return (
    section(
      'Character',
      `<div class="property-font"><span aria-hidden="true">${icon('search')}</span>${choose('textStyle', item.textStyle, faces, 'Font family')}<span class="property-family-name" aria-hidden="true">${esc(family)}</span><span class="property-font-chevron" aria-hidden="true">${icon('chevron-down')}</span></div><select data-font-style data-family="${esc(family)}" aria-label="Font style">${fontStyleOptions(family, faces, fonts, installed)}</select><div class="property-metrics">${measure('fontSize', item.fontSize || 12, 'Font size', 'type-size', 'pt', { min: 1, max: 2000 })}${measure('leading', item.leading || 0, 'Leading', 'type-leading', 'pt', { min: 0, max: 4000, auto })}${metric(
        'type-kerning',
        choose(
          'kerning',
          item.kerning || 'metrics',
          [
            ['metrics', 'Metrics'],
            ['none', '0'],
          ],
          'Kerning',
        ),
        'Kerning',
      )}${measure('tracking', item.tracking || 0, 'Tracking', 'type-tracking', '', { min: -1000, max: 10000 })}</div>` +
        moreOptions('character', 'More Character options', advanced, state),
    ) +
    section(
      'Paragraph',
      `<div class="property-paragraph-align" role="group" aria-label="Paragraph alignment">${alignmentChoices
        .filter(([, , art]) => art)
        .map(
          ([key, name, art]) =>
            `<button data-paragraph-align="${key}" aria-label="${name}" aria-pressed="${item.align === key}" data-tooltip="${name}">${icon(art)}</button>`,
        )
        .join('')}</div>` +
        moreOptions(
          'paragraph',
          'More Paragraph options',
          choose('align', item.align || 'left', alignmentChoices, 'Alignment') +
            `<div class="canvas-geometry">${[
              ['leftIndent', 'Left indent'],
              ['rightIndent', 'Right indent'],
              ['firstLineIndent', 'First line indent'],
              ['paragraphBefore', 'Space before'],
              ['paragraphAfter', 'Space after'],
            ]
              .map(([k, label]) => num(k, item[k] || 0, label + ' · pt'))
              .join('')}</div>` +
            check('hyphenate', item.hyphenate, 'Hyphenate') +
            check('keepTogether', item.keepTogether, 'Keep paragraph together') +
            check('keepWithNext', item.keepWithNext, 'Keep with next') +
            (nativeFlow
              ? '<div class="canvas-geometry">' +
                field(
                  'Following lines',
                  `<input data-object-prop="keepNextLines" type="number" min="1" max="5" step="1" aria-label="Following lines" value="${item.keepNextLines ?? 1}">`,
                ) +
                check('keepWithPrevious', item.keepWithPrevious, 'Keep with previous') +
                choose(
                  'paragraphStart',
                  item.paragraphStart ?? 'anywhere',
                  Object.entries(PARAGRAPH_STARTS),
                  'Start Paragraph',
                ) +
                '</div>'
              : '') +
            (nativeFlow
              ? check('keepBoundaryLines', item.keepBoundaryLines, 'At Start/End of Paragraph') +
                '<div class="canvas-geometry">' +
                [
                  ['orphans', 'At Start'],
                  ['widows', 'At End'],
                ]
                  .map(([key, label]) =>
                    field(
                      label,
                      unitNumber('object-prop', key, item[key] ?? 2, label, 'lines', {
                        min: 1,
                        max: 20,
                      }),
                    ),
                  )
                  .join('') +
                '</div>'
              : `<div class="canvas-geometry">${num('widows', item.widows || 2, 'Widows')}${num('orphans', item.orphans || 2, 'Orphans')}</div>`) +
            choose(
              'direction',
              item.direction || 'ltr',
              [
                ['ltr', 'Left to right'],
                ['rtl', 'Right to left'],
                ['auto', 'Automatic'],
              ],
              'Direction',
            ) +
            (nativeFlow ? button('keep-options', 'Keep Options…') : '') +
            button('word-spacing', 'Word Spacing…'),
          state,
        ),
    )
  );
}
export function frameProperties(item, state = {}) {
  const f = item.frameOptions || {};
  return section(
    'Text Frame',
    `<div class="property-frame-metrics">${metric('columns', unitNumber('frame-prop', 'columns', f.columns || 1, 'Number of columns', '', { min: 1, max: 40 }), 'Number of columns')}${metric('gutter', unitNumber('frame-prop', 'gutter', f.gutter ?? 12, 'Gutter', 'pt', { min: 0 }), 'Gutter')}${moreOptions(
      'frame',
      'Text Frame Options',
      '<div class="canvas-geometry">' +
        ['Top', 'Right', 'Bottom', 'Left']
          .map((side) => frameField(side + ' inset · pt', 'inset' + side, f['inset' + side] || 0))
          .join('') +
        '</div>' +
        field(
          'Vertical justification',
          `<select data-frame-prop="verticalAlign" aria-label="Vertical justification">${['top', 'center', 'bottom'].map((v) => `<option value="${v}" ${f.verticalAlign === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`,
        ) +
        field(
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
        ) +
        frameField(
          'Minimum first baseline · pt',
          'minimumFirstBaseline',
          f.minimumFirstBaseline || 0,
        ) +
        `<label class="publishing-check"><input type="checkbox" data-ignore-text-wrap ${item.ignoreTextWrap ? 'checked' : ''}>Ignore Text Wrap</label>`,
      state,
      'Options',
    )}</div>`,
  );
}
