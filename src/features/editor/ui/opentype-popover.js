import { SHIPPED_TEXT_FONT_METADATA } from '../../../rendering/text/font-resources.js';
import { OPENTYPE_FEATURES, fontFamilyFor } from '../../../domain/text/typography.js';
import { BUNDLED_FONT_FEATURES } from '../../../domain/text/bundled-font-features.js';
import { placePopover } from '../../../domain/geometry/popover.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';

const labels = {
  ligatures: 'Standard Ligatures',
  discretionaryLigatures: 'Discretionary Ligatures',
  smallCaps: 'Small Caps',
  oldstyleFigures: 'Oldstyle Figures',
  tabularFigures: 'Tabular Figures',
  slashedZero: 'Slashed Zero',
  fractions: 'Fractions',
  ordinals: 'Ordinal',
  stylisticAlternates: 'Stylistic Alternates',
};
function declaredFeatures(id, values, fonts) {
  const face = values.bold
    ? values.italic
      ? 'boldItalic'
      : 'bold'
    : values.italic
      ? 'italic'
      : 'regular';
  return (
    fonts.find((a) => a.id === id)?.font?.features || BUNDLED_FONT_FEATURES[id]?.[face] || null
  );
}
/** Anchored, nonmodal feature rows with real shaping previews; no preview mutates document source. */
export function createOpenTypePopover(
  editor,
  { anchor, textState, previewText, fonts, apply, preserveRange, onClose },
) {
  const element = document.createElement('section'),
    controller = new AbortController();
  element.className = 'type-options-popover';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Explore more type options');
  const list = document.createElement('div');
  list.className = 'type-feature-list';
  for (const [key, label] of Object.entries(labels)) {
    const row = document.createElement('label');
    row.className = 'type-feature-row';
    row.dataset.featureRow = key;
    row.innerHTML = `<span class="type-feature-label"><input type="checkbox" data-type-feature="${key}">${label}</span><span class="type-feature-preview" aria-hidden="true"></span>`;
    list.append(row);
  }
  element.append(list);
  const axes = document.createElement('fieldset');
  axes.className = 'type-variable-axes';
  axes.hidden = true;
  element.append(axes);
  editor.append(element);
  let axisIdentity = '',
    closed = false,
    lastAnchor = null;
  const anchorSelector = anchor?.classList.contains('canvas-type-options')
    ? '.canvas-type-options'
    : anchor?.closest('.canvas-contextual-bar')
      ? '.canvas-contextual-bar [data-canvas-command="type-options"]'
      : '[data-canvas-command="type-options"]';
  function position() {
    const target = anchor?.isConnected ? anchor : editor.querySelector(anchorSelector);
    if (target) lastAnchor = target.getBoundingClientRect();
    if (!lastAnchor) return onClose();
    const bounds = editor.getBoundingClientRect(),
      rect = placePopover(
        {
          x: lastAnchor.x - bounds.x,
          y: lastAnchor.y - bounds.y,
          w: lastAnchor.width,
          h: lastAnchor.height,
        },
        { w: 242, h: Math.min(290, element.scrollHeight) },
        { x: 0, y: 0, w: bounds.width, h: bounds.height },
      );
    Object.assign(element.style, {
      left: rect.x + 'px',
      top: rect.y + 'px',
      width: rect.w + 'px',
      maxHeight: rect.h + 'px',
    });
    element.dataset.side = rect.side;
  }
  function refresh() {
    if (closed) return;
    const summary = textState();
    if (!summary) return onClose();
    const values = summary.values,
      faces = summary.fonts.map((id) => declaredFeatures(id, values, fonts())),
      text =
        previewText().replace(/\s+/g, ' ').trim().slice(0, 160) || 'Aa Bb 012345 1/2 1st fi fl';
    for (const row of list.querySelectorAll('[data-feature-row]')) {
      const key = row.dataset.featureRow,
        tag = OPENTYPE_FEATURES[key],
        checkbox = row.querySelector('input');
      row.hidden = faces.length > 0 && faces.every((face) => face && !face.includes(tag));
      checkbox.checked = values[key] === true;
      checkbox.indeterminate = summary.mixed.includes(key);
      row.dataset.checked = checkbox.indeterminate ? 'mixed' : String(checkbox.checked);
      const preview = row.querySelector('.type-feature-preview');
      preview.textContent = text;
      preview.style.fontFamily = fontFamilyFor(values.textStyle || summary.fonts[0]);
      preview.style.fontWeight = values.bold ? '700' : '400';
      preview.style.fontStyle = values.italic ? 'italic' : 'normal';
      preview.style.fontFeatureSettings = Object.entries(OPENTYPE_FEATURES)
        .map(([field, t]) => `"${t}" ${field === key || values[field] ? 1 : 0}`)
        .join(',');
    }
    let empty = list.querySelector('.type-feature-empty');
    const available = [...list.querySelectorAll('label')].some((row) => !row.hidden);
    if (!available && !empty) {
      empty = document.createElement('p');
      empty.className = 'type-feature-empty';
      empty.textContent = 'No supported OpenType features';
      list.append(empty);
    }
    if (available) empty?.remove();
    const font =
        fonts().find((a) => a.id === values.textStyle)?.font ||
        SHIPPED_TEXT_FONT_METADATA[values.textStyle],
      identity = font?.axes?.length ? values.textStyle : '';
    if (axisIdentity !== identity) {
      axisIdentity = identity;
      axes.hidden = !identity;
      axes.innerHTML = identity
        ? '<legend>Variable font axes</legend>' +
          font.axes
            .map(
              (axis) =>
                `<label>${esc(axis.tag)}<input type="range" min="${axis.min}" max="${axis.max}" step="any" data-variation-axis="${axis.tag}" aria-label="${esc(axis.tag)} axis"><output></output></label>`,
            )
            .join('')
        : '';
    }
    if (identity) {
      const variations = Object.fromEntries(
        (values.fontVariations === 'normal' ? '' : values.fontVariations || '')
          .split(',')
          .filter(Boolean)
          .map((pair) => pair.split(':')),
      );
      for (const input of axes.querySelectorAll('input')) {
        const axis = font.axes.find((a) => a.tag === input.dataset.variationAxis);
        if (input !== document.activeElement) input.value = variations[axis.tag] ?? axis.default;
        input.nextElementSibling.value = Number(Number(input.value).toFixed(2));
      }
    }
    position();
  }
  element.addEventListener('pointerdown', preserveRange, {
    capture: true,
    signal: controller.signal,
  });
  element.addEventListener(
    'change',
    (event) => {
      const input = event.target;
      if (input.dataset.typeFeature) apply(input.dataset.typeFeature, input.checked);
      else if (input.dataset.variationAxis)
        apply(
          'fontVariations',
          [...axes.querySelectorAll('input')]
            .map((i) => i.dataset.variationAxis + ':' + Number(i.value))
            .join(','),
        );
      refresh();
    },
    { signal: controller.signal },
  );
  window.addEventListener('resize', position, { signal: controller.signal });
  // A camera gesture dismisses a context menu rather than leaving it detached from its badge.
  editor
    .querySelector('.canvas-viewport')
    .addEventListener('wheel', onClose, { capture: true, signal: controller.signal });
  refresh();
  return {
    element,
    refresh,
    destroy() {
      closed = true;
      controller.abort();
      element.remove();
    },
  };
}
