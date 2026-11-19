import { normalizeTextWrap } from '../../../domain/documents/text-wrap.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { field, section } from './publishing-properties.js';

const modes = [
  ['none', 'None', 'No text wrap'],
  ['bounds', 'Box', 'Wrap around bounding box'],
  ['contour', 'Shape', 'Wrap around object shape'],
  ['jump', 'Jump', 'Jump object'],
  ['next-column', 'Next', 'Jump to next column'],
];
const sides = [
  ['both', 'Both right and left sides'],
  ['left', 'Left side'],
  ['right', 'Right side'],
  ['largest', 'Largest area'],
  ['inside', 'Side toward spine'],
  ['outside', 'Side away from spine'],
];
const common = (values, read) => {
  const first = read(values[0]);
  return values.every((value) => read(value) === first) ? first : null;
};
const checkbox = (attribute, value, label, disabled = '') =>
  `<label class="publishing-check"><input type="checkbox" ${attribute} ${value ? 'checked' : ''} ${value === null ? 'data-wrap-mixed="true" aria-checked="mixed"' : ''} ${disabled}>${esc(label)}${value === null ? '<span class="text-wrap-mixed">Mixed</span>' : ''}</label>`;

function offsetField(values, key, label, disabled) {
  const value = common(values, (wrap) => wrap.offsets[key === 'all' ? 'top' : key]);
  return field(
    label,
    `<input type="number" step="any" min="-2000" max="2000" data-text-wrap-offset="${key}" aria-label="Text wrap ${esc(label)}" value="${value === null ? '' : Number(value.toFixed(4))}" ${value === null ? 'placeholder="Mixed" data-mixed="true"' : ''} ${disabled}>`,
  );
}

/** Presentation only. Each property change is one object command/history transaction. */
export function textWrapProperties(objects, { editing = true } = {}) {
  if (!objects.length) return '';
  const values = objects.map((object) => normalizeTextWrap(object.textWrap)),
    mode = common(values, (wrap) => wrap.mode),
    side = common(values, (wrap) => wrap.side),
    inverted = common(values, (wrap) => wrap.invert),
    disabled = editing ? '' : 'disabled',
    enabled = mode !== null && mode !== 'none',
    offsetsDisabled = enabled ? disabled : 'disabled',
    uniform =
      mode === 'contour' ||
      mode === 'next-column' ||
      objects.some((object) => object.type === 'image' && object.parentId),
    fields = uniform
      ? offsetField(values, 'all', 'Offset · pt', offsetsDisabled)
      : `<div class="canvas-geometry">${['top', 'bottom', ...(mode === 'jump' ? [] : ['left', 'right'])].map((key) => offsetField(values, key, key[0].toUpperCase() + key.slice(1) + ' · pt', offsetsDisabled)).join('')}</div>`,
    sideDisabled = !enabled || mode === 'jump' || mode === 'next-column' ? 'disabled' : disabled,
    textFrames = objects.filter((object) => ['text', 'quote'].includes(object.type)),
    ignore = textFrames.length
      ? checkbox(
          'data-ignore-text-wrap',
          common(textFrames, (frame) => !!frame.ignoreTextWrap),
          textFrames.length === objects.length
            ? 'Ignore Text Wrap'
            : 'Ignore Text Wrap in Selected Text Frames',
          disabled,
        )
      : '';
  return section(
    'Text Wrap',
    `<div class="text-wrap-modes" role="group" aria-label="Text wrap mode" ${mode === null ? 'data-mixed="true"' : ''}>${modes.map(([value, label, title]) => `<button type="button" data-text-wrap-mode="${value}" aria-label="${title}" aria-pressed="${mode === value}" data-tooltip="${title}" ${disabled}>${label}</button>`).join('')}</div>${mode === null ? '<p class="text-wrap-mixed">Mixed wrap modes</p>' : ''}${fields}${field('Wrap to', `<select data-text-wrap="side" aria-label="Text wrap side" ${sideDisabled}>${side === null ? '<option value="" selected disabled>Mixed</option>' : ''}${sides.map(([value, label]) => `<option value="${value}" ${side === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}${checkbox('data-text-wrap="invert"', inverted, 'Invert', ['bounds', 'contour'].includes(mode) ? disabled : 'disabled')}${mode === 'contour' ? field('Contour options', '<select aria-label="Text wrap contour source" disabled><option>Frame edges</option></select>') : ''}${ignore}`,
  );
}

export function textWrapPreferences(doc, { editing = true } = {}) {
  const preferences = doc.textWrapPreferences || {},
    disabled = editing ? '' : 'disabled';
  return section(
    'Text Wrap Preferences',
    checkbox(
      'data-text-wrap-pref="onlyBelow"',
      !!preferences.onlyBelow,
      'Text Wrap Only Affects Text Beneath',
      disabled,
    ) +
      checkbox(
        'data-text-wrap-pref="facingPages"',
        !!preferences.facingPages,
        'Facing-Page Wrap Sides',
        disabled,
      ) +
      (preferences.facingPages
        ? field(
            'First page side',
            `<select data-text-wrap-pref="firstPageSide" aria-label="First page side for text wrap" ${disabled}>${['right', 'left'].map((value) => `<option value="${value}" ${(preferences.firstPageSide || 'right') === value ? 'selected' : ''}>${value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select>`,
          )
        : ''),
  );
}

/** HTML cannot express the native checkbox's indeterminate property. */
export function reflectTextWrapControls(root) {
  for (const input of root.querySelectorAll('input[data-wrap-mixed]')) input.indeterminate = true;
}
