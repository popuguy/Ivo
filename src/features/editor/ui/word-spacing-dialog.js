import {
  DEFAULT_WORD_SPACING,
  JUSTIFICATION_GROUPS,
  spacingField,
  normalizeWordSpacing,
  wordSpacingSettings,
} from '../../../domain/text/word-spacing.js';
import { dialogMarkup, installDialogDismissal } from '../../../shared/ui/dialog.js';

const fields = [
  ['minimum', 'Minimum'],
  ['desired', 'Desired'],
  ['maximum', 'Maximum'],
];

export function justificationFields(settings, mixed, style = false) {
  return JUSTIFICATION_GROUPS.map(
    ({ label, prefix, min, max, defaults }) =>
      '<fieldset class="justification-group"><legend>' +
      label +
      '</legend><div class="canvas-geometry">' +
      fields
        .map(([axis, caption], i) => {
          const key = spacingField(prefix, axis);
          const value = mixed && mixed.has(key) ? '' : (settings[key] ?? defaults[i]);
          return `<label class="canvas-field"><span>${caption} · %</span><input type="number" min="${min}" max="${max}" step="any" name="${style ? 'wordSpacing-' : ''}${key}" aria-label="${caption} ${label.toLowerCase()}" ${style ? 'data-style-word-spacing-field' : prefix ? 'data-justification-field' : 'data-word-spacing-field="' + key + '"'} value="${value}" ${value === '' ? 'placeholder="Mixed"' : ''}></label>`;
        })
        .join('') +
      '</div></fieldset>',
  ).join('');
}

export function readJustificationField(get, preserveAdvanced = false) {
  const values = JUSTIFICATION_GROUPS.map(({ prefix }) =>
    fields.map(([axis]) => get(spacingField(prefix, axis))).join(':'),
  );
  const full = normalizeWordSpacing(values.join('|'));
  return !preserveAdvanced && full.endsWith('|0:0:0|100:100:100') ? full.split('|')[0] : full;
}

/** Values are edited locally; only Apply or Reset invokes one document command. */
export function createWordSpacingDialog({ summary, apply, onClose }) {
  const dialog = document.createElement('dialog'),
    controller = new AbortController(),
    mixed = summary.mixed.includes('wordSpacing'),
    samples = (summary.justificationValues || [summary.values.wordSpacing]).map(
      (value) => wordSpacingSettings(value ?? 'normal') || DEFAULT_WORD_SPACING,
    ),
    settings = samples[0],
    mixedFields = new Set();
  if (mixed) {
    for (const { prefix, defaults } of JUSTIFICATION_GROUPS)
      for (const [i, [axis]] of fields.entries()) {
        const key = spacingField(prefix, axis);
        if (
          samples.some((sample) => (sample[key] ?? defaults[i]) !== (settings[key] ?? defaults[i]))
        )
          mixedFields.add(key);
      }
  }
  dialog.className = 'modal publishing-style-dialog publishing-word-spacing-dialog';
  dialog.setAttribute('aria-label', 'Justification');
  dialog.dataset.mixed = String(mixed);
  dialog.innerHTML = dialogMarkup(
    `<h2>Justification</h2>${justificationFields(settings, mixedFields)}<p role="alert" data-word-spacing-error></p><div class="publishing-inline-actions"><button type="button" class="button-outline" data-word-spacing-reset>Reset</button><button type="submit" class="button-outline" data-word-spacing-apply>Apply</button></div>`,
  );
  const form = dialog.querySelector('form'),
    alert = dialog.querySelector('[role="alert"]');
  let pending = false,
    closed = false;
  const dismissal = installDialogDismissal(dialog, { canDismiss: () => !pending });
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: controller.signal });
  function error(message = '') {
    alert.textContent = message;
    for (const input of form.querySelectorAll('input[type=number]')) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
  function finish() {
    if (closed) return;
    closed = true;
    dismissal.destroy();
    controller.abort();
    dialog.remove();
    onClose?.();
  }
  function busy(value) {
    pending = value;
    form.setAttribute('aria-busy', String(value));
    for (const control of form.querySelectorAll('input,button')) control.disabled = value;
  }
  async function commit(value) {
    if (closed || pending) return;
    error();
    busy(true);
    try {
      if ((await apply(value)) === false) {
        error('Word spacing could not be applied to this text selection.');
        return;
      }
      if (!closed) dialog.close();
    } catch (failure) {
      if (!closed) error(failure.message || 'Word spacing could not be applied.');
    } finally {
      if (!closed) busy(false);
    }
  }
  listen(dialog, 'close', finish);
  listen(form, 'input', () => error());
  listen(form, 'submit', (event) => {
    event.preventDefault();
    if (closed || pending) return;
    try {
      const value = readJustificationField(
        (key) => form.elements.namedItem(key).value,
        samples.some((sample) => sample.glyphDesired !== undefined),
      );
      void commit(value);
    } catch (failure) {
      error(failure.message);
    }
  });
  listen(form.querySelector('[data-word-spacing-reset]'), 'click', () => void commit('normal'));
  document.body.append(dialog);
  try {
    dialog.showModal();
    form.querySelector('input').focus();
  } catch (failure) {
    finish();
    throw failure;
  }
  return {
    element: dialog,
    destroy() {
      if (!closed && dialog.open) dialog.close();
      finish();
    },
  };
}
