import { normalizeTextWrap } from '../../../domain/documents/text-wrap.js';
import { uniformWrapOffset } from '../../../domain/geometry/wrap-contour.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';
import { icon } from '../../../shared/ui/icons.js';
import { section } from './publishing-properties.js';

const modes = [
  ['none', 'No Text Wrap', 'wrap-none'],
  ['bounds', 'Wrap Around Bounding Box', 'wrap-box'],
  ['contour', 'Wrap Around Object Shape', 'wrap-shape'],
  ['jump', 'Jump Object', 'wrap-jump'],
  ['next-column', 'Jump to Next Column', 'wrap-next'],
];
const sides = [
  ['right', 'Right Side'],
  ['left', 'Left Side'],
  ['both', 'Both Right & Left Sides'],
  ['inside', 'Side Towards Spine'],
  ['outside', 'Side Away from Spine'],
  ['largest', 'Largest Area'],
];
const common = (values, read) => {
  const first = read(values[0]);
  return values.every((value) => read(value) === first) ? first : null;
};

export function showsContextualWrap(objects, selectedVertex) {
  return (
    !selectedVertex && objects.length === 1 && ['polygon', 'image', 'pdf'].includes(objects[0].type)
  );
}

function modeRow(mode, invert, editing) {
  const buttons = modes
    .map(
      ([value, label, art]) =>
        `<button type="button" data-text-wrap-mode="${value}" aria-label="${label}" data-tooltip="${label}" aria-pressed="${mode === value}" ${editing ? '' : 'disabled'}>${icon(art)}</button>`,
    )
    .join('');
  return `<div class="wrap-mode-row"><div class="wrap-mode-buttons" role="group" aria-label="Text wrap mode">${buttons}</div>
    <label class="wrap-invert"><input type="checkbox" data-text-wrap="invert" ${invert === null ? 'data-wrap-mixed aria-checked="mixed"' : invert ? 'checked' : ''} ${editing && mode && mode !== 'none' ? '' : 'disabled'}>Invert</label></div>`;
}

function offsets(values, mode, editing, state, constrained) {
  const linked =
    state.wrapOffsetsLinked !== false &&
    values.every((wrap) =>
      Object.values(wrap.offsets).every((value) => Math.abs(value - wrap.offsets.top) < 1e-8),
    );
  const field = (key) => {
    const label = key[0].toUpperCase() + key.slice(1) + ' Offset';
    const value = common(values, (wrap) => (wrap.invert ? -wrap.offsets[key] : wrap.offsets[key]));
    const enabled = editing && !!mode && mode !== 'none' && (!constrained || key === 'top');
    return `<div class="wrap-offset wrap-offset-${key}"><span data-tooltip="${label}">${icon('wrap-offset-' + key)}</span>
      <span class="property-number"><span class="property-steppers">${[1, -1]
        .map(
          (step) =>
            `<button type="button" data-property-step="${step}" tabindex="-1" aria-label="${step > 0 ? 'Increase' : 'Decrease'} ${label}" ${enabled ? '' : 'disabled'}></button>`,
        )
        .join('')}</span>
      <input type="number" step="any" min="-2000" max="2000" data-text-wrap-offset="${key}" aria-label="${label}" value="${value === null ? '' : Number(value.toFixed(4))}" ${value === null ? 'placeholder="Mixed"' : ''} ${enabled ? '' : 'disabled'}><span class="property-unit">pt</span></span></div>`;
  };
  return `<div class="wrap-offset-grid">${field('top')}${field('bottom')}<button class="wrap-offset-link" type="button" data-wrap-link aria-pressed="${constrained || linked}" aria-label="Make all settings the same" data-tooltip="Make all settings the same" ${editing && mode && mode !== 'none' && !constrained ? '' : 'disabled'}>${icon(constrained || linked ? 'wrap-link' : 'wrap-unlink')}</button>${field('left')}${field('right')}</div>`;
}

/** Both panels edit the same object settings. Only the dedicated panel exposes wrap-side and contour controls. */
export function textWrapControls(objects, { editing, state, dedicated = false, defaults }) {
  const values = objects.length
    ? objects.map((object) => normalizeTextWrap(object.textWrap))
    : [normalizeTextWrap(defaults)];
  const mode = common(values, (wrap) => wrap.mode);
  const side = common(values, (wrap) => wrap.side);
  const row = modeRow(
    mode,
    common(values, (wrap) => wrap.invert),
    editing,
  );
  const uniform = objects.length
    ? objects.some((object) => uniformWrapOffset(object, mode))
    : mode === 'contour';
  const fields = offsets(values, mode, editing, state, uniform);
  if (!dedicated) {
    const expanded = !!state.propertyDisclosures?.wrap;
    return section(
      'Text Wrap',
      `<div class="wrap-controls">${row}${expanded ? fields : ''}<button type="button" class="wrap-more" data-wrap-more aria-expanded="${expanded}" aria-label="More Options" data-tooltip="More Options">${icon('dots')}</button></div>`,
    );
  }
  const graphics =
    objects.length && objects.every((object) => ['image', 'pdf'].includes(object.type));
  const contourType = graphics && mode === 'contour';
  const source = common(values, (wrap) => wrap.contour.source);
  const contours = [
    ['bounding-box', 'Bounding Box'],
    ['edges', 'Detect Edges'],
    ['alpha', 'Alpha Channel'],
    ['path', 'Photoshop Path'],
    ['graphic-frame', 'Graphic Frame'],
    ['frame', 'Same as Clipping'],
  ];
  const contourSelect = `<select aria-label="Contour type" data-wrap-contour ${editing && contourType ? '' : 'disabled'}>${
    contourType
      ? (source === null ? '<option selected disabled>Mixed</option>' : '') +
        contours
          .map(
            ([key, label]) =>
              `<option value="${key}" ${['edges', 'alpha', 'path'].includes(key) ? 'disabled' : ''} ${key === source ? 'selected' : ''}>${label}</option>`,
          )
          .join('')
      : '<option></option>'
  }</select>`;
  const extra =
    state.propertyDisclosures?.wrapPanel !== false
      ? `<section class="wrap-panel-section"><h3>Wrap Options:</h3>
    <label>Wrap To: <select data-text-wrap="side" ${editing && values.every((wrap) => !wrap.invert) && ['bounds', 'contour'].includes(mode) ? '' : 'disabled'}>${side === null ? '<option value="" selected disabled>Mixed</option>' : ''}${sides.map(([value, label]) => `<option value="${value}" ${value === side ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label></section>
    <section class="wrap-panel-section"><h3>Contour Options:</h3><label>Type: ${contourSelect}</label><label class="wrap-inside"><input type="checkbox" disabled>Include Inside Edges</label></section>`
      : '';
  return `<div class="wrap-controls wrap-panel"><div class="wrap-panel-basic">${row}${fields}</div>${extra}</div>`;
}

export function reflectTextWrapControls(root) {
  for (const input of root.querySelectorAll('input[data-wrap-mixed]')) input.indeterminate = true;
}
