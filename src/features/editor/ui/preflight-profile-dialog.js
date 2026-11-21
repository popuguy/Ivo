import { preflightChecks, preflightProfile } from '../../../domain/documents/preflight-profiles.js';
import { dialogMarkup, installDialogDismissal } from '../../../shared/ui/dialog.js';
import { escapeHTML as esc } from '../../../shared/html/sanitize.js';

export function editPreflightProfile(profile, { editing, save, remove, initialName }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal publishing-style-dialog';
  dialog.setAttribute('aria-label', 'Define Preflight Profile');
  dialog.innerHTML = dialogMarkup(
    '<h2>Define Preflight Profile</h2><label>Name<input name="name" maxlength="80"></label>' +
      Object.entries(preflightChecks)
        .map(
          ([key, label]) =>
            '<label><input type="checkbox" name="check" value="' +
            key +
            '"> ' +
            esc(label) +
            '</label>',
        )
        .join('') +
      '<label>Minimum resolution (ppi)<input type="number" name="ppi" min="1" max="2400"></label>' +
      '<p role="alert"></p>' +
      (editing ? '<button type="button" data-remove-profile>Delete profile</button>' : '') +
      '<button type="submit">Save profile</button>',
  );
  document.body.append(dialog);
  const dismissal = installDialogDismissal(dialog),
    form = dialog.querySelector('form');
  const name = form.elements.namedItem('name'),
    ppi = form.elements.ppi;
  name.value = initialName ?? (editing ? profile.name : profile.name + ' copy');
  ppi.value = profile.ppi;
  const boxes = [...form.querySelectorAll('[name=check]')];
  boxes.forEach((box) => {
    box.checked = profile.checks.includes(box.value);
  });
  const toggle = () => {
    ppi.disabled = !boxes.find((b) => b.value === 'resolution').checked;
  };
  toggle();
  form.addEventListener('change', toggle);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      save(
        preflightProfile({
          name: name.value,
          checks: boxes.filter((b) => b.checked).map((b) => b.value),
          ppi: ppi.disabled ? profile.ppi : ppi.valueAsNumber,
        }),
      );
      dialog.close();
    } catch (error) {
      form.querySelector('[role=alert]').textContent = error.message;
    }
  });
  form.querySelector('[data-remove-profile]')?.addEventListener('click', () => {
    try {
      remove();
      dialog.close();
    } catch (error) {
      form.querySelector('[role=alert]').textContent = error.message;
    }
  });
  dialog.addEventListener(
    'close',
    () => {
      dismissal.destroy();
      dialog.remove();
    },
    { once: true },
  );
  dialog.showModal();
  name.focus();
  name.select();
  return dialog;
}
