import { MAX_TAB_STOPS, tabStopSettings, tabStopsValue } from '../../../domain/text/tab-stops.js';

const stopFields =
  '<div data-tab-stops></div><button type="button" data-add-stop>Add tab stop</button>' +
  '<button type="button" data-clear-stops>Clear All</button>';

export const styleTabFields =
  '<details><summary>Tabs</summary><label>Tab stops<select name="tabStopsMode">' +
  '<option value="inherit">Inherited</option><option value="normal">Default</option><option value="custom">Custom</option></select></label>' +
  '<fieldset data-custom-stops>' +
  stopFields +
  '</fieldset></details>';

export function installStyleTabs(dialog, value) {
  const mode = dialog.querySelector('[name=tabStopsMode]');
  const controls = dialog.querySelector('[data-custom-stops]');
  const read = installStops(controls, tabStopSettings(value));
  mode.value = value === undefined ? 'inherit' : value === 'normal' ? 'normal' : 'custom';
  function sync() {
    controls.hidden = controls.disabled = mode.value !== 'custom';
  }
  mode.addEventListener('change', sync);
  sync();
  return () =>
    mode.value === 'inherit' ? undefined : mode.value === 'normal' ? 'normal' : read(true);
}

export function openTabsForm(form, summary, apply) {
  const mixed = summary.mixed.includes('tabStops');
  const dialog = form(
    'Tabs',
    (mixed ? '<p>Selected paragraphs have different tab stops.</p>' : '') +
      stopFields +
      '<button type="button" data-dialog-close>Cancel</button>',
    () => {
      const value = read();
      apply(value === undefined ? {} : { tabStops: value });
    },
  );
  const read = installStops(dialog, mixed ? [] : tabStopSettings(summary.values.tabStops));
  dialog.setAttribute('aria-label', 'Tabs');
  return dialog;
}

function installStops(dialog, initial) {
  let touched = false;
  const list = dialog.querySelector('[data-tab-stops]');
  const add = dialog.querySelector('[data-add-stop]');
  function addRow({ position, alignment, character, leader }) {
    const row = document.createElement('fieldset');
    row.innerHTML =
      '<label>Position · pt<input type="number" min="0.001" max="14400" step="any" required></label>' +
      '<label>Alignment<select><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="decimal">Decimal</option></select></label>' +
      '<label data-align-on>Align On<input data-character type="text" maxlength="2"></label><label>Leader<input type="text" data-leader maxlength="16"></label><button type="button" data-remove-stop>Remove</button>';
    const number = row.querySelector('[type=number]'),
      select = row.querySelector('select');
    number.value = position;
    row.querySelector('[data-leader]').value = leader ?? '';
    select.value = alignment;
    row.querySelector('[data-character]').value = character ?? '.';
    const sync = () => {
      row.querySelector('[data-align-on]').hidden = select.value !== 'decimal';
    };
    select.addEventListener('change', sync);
    row.querySelector('[data-remove-stop]').addEventListener('click', () => {
      row.remove();
      add.disabled = false;
      touched = true;
    });
    sync();
    list.append(row);
    add.disabled = list.childElementCount >= MAX_TAB_STOPS;
    return number;
  }
  initial.forEach(addRow);
  list.addEventListener('input', () => {
    touched = true;
  });
  list.addEventListener('change', () => {
    touched = true;
  });
  add.addEventListener('click', () => {
    const positions = [...list.querySelectorAll('[type=number]')].map(
      (el) => el.valueAsNumber || 0,
    );
    addRow({
      position: Math.min(14400, 36 * (Math.floor(Math.max(0, ...positions) / 36) + 1)),
      alignment: 'left',
    }).select();
    touched = true;
  });
  dialog.querySelector('[data-clear-stops]').addEventListener('click', () => {
    list.replaceChildren();
    add.disabled = false;
    touched = true;
  });
  return (all = false) => {
    if (!touched && !all) return undefined;
    const stops = [...list.children]
      .map((row) => {
        const alignment = row.querySelector('select').value;
        const leader = row.querySelector('[data-leader]').value;
        return {
          ...(leader ? { leader } : {}),
          position: row.querySelector('[type=number]').valueAsNumber,
          alignment,
          ...(alignment === 'decimal'
            ? { character: row.querySelector('[data-character]').value }
            : {}),
        };
      })
      .sort((a, b) => a.position - b.position);
    return tabStopsValue(stops);
  };
}
