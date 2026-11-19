import {
  DEFAULT_WORD_SPACING,
  normalizeWordSpacing,
  wordSpacingSettings,
} from '../../../domain/text/word-spacing.js';
import { dialogMarkup, installDialogDismissal } from '../../../shared/ui/dialog.js';

const fields = [
  ['minimum', 'Minimum'],
  ['desired', 'Desired'],
  ['maximum', 'Maximum'],
];

/** Values are edited locally; only Apply or Reset invokes one document command. */
export function createWordSpacingDialog({ summary, apply, onClose }) {
  const dialog = document.createElement('dialog'),
    controller = new AbortController(),
    mixed = summary.mixed.includes('wordSpacing'),
    settings = wordSpacingSettings(summary.values.wordSpacing ?? 'normal') || DEFAULT_WORD_SPACING;
  dialog.className = 'modal publishing-style-dialog publishing-word-spacing-dialog';
  dialog.setAttribute('aria-label', 'Word Spacing');
  dialog.dataset.mixed = String(mixed);
  dialog.innerHTML = dialogMarkup(
    `<h2>Word Spacing</h2><div class="canvas-geometry" style="grid-template-columns:repeat(3,minmax(0,1fr))">${fields
      .map(
        ([key, label]) =>
          `<label class="canvas-field"><span>${label} · %</span><input type="number" min="0" max="1000" step="any" data-word-spacing-field="${key}" name="${key}" aria-label="${label} word spacing" ${mixed ? 'placeholder="Mixed"' : `value="${settings[key]}"`}></label>`,
      )
      .join(
        '',
      )}</div><p role="alert" data-word-spacing-error></p><div class="publishing-inline-actions"><button type="button" class="button-outline" data-word-spacing-reset>Reset</button><button type="submit" class="button-outline" data-word-spacing-apply>Apply</button></div>`,
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
    for (const input of form.querySelectorAll('[data-word-spacing-field]')) {
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
      const value = normalizeWordSpacing(
        fields
          .map(([key]) => form.querySelector(`[data-word-spacing-field="${key}"]`).value)
          .join(':'),
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
