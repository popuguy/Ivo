import {
  exceptionLanguage,
  hyphenationExceptions,
} from '../../../domain/text/hyphenation-exceptions.js';
import { HYPHENATION_FIELDS, validHyphenationAttribute } from '../../../domain/text/hyphenation.js';

const fields = { hyphenate: { label: 'Hyphenate', initial: false }, ...HYPHENATION_FIELDS };
const checkbox = (field) => typeof field.initial === 'boolean';
const numberInput = (name, field, attributes = '') =>
  `<input type="number" name="${name}" min="${field.min}" max="${field.max}" step="${field.fractional ? 'any' : '1'}"${attributes}>`;

export function openHyphenationForm(form, { values, mixed }, apply) {
  const touched = new Set();
  const controls = Object.entries(fields).map(([name, field]) =>
    checkbox(field)
      ? `<label class="publishing-check"><input type="checkbox" name="${name}">${field.label}</label>`
      : `<label>${field.label} · ${field.unit}${numberInput(name, field)}</label>`,
  );
  const dialog = form(
    'Hyphenation',
    controls.join('') + '<button type="button" data-dialog-close>Cancel</button>',
    () => {
      const patch = {};
      for (const name of touched) {
        const field = fields[name],
          input = inputs[name];
        if (!checkbox(field) && validHyphenationAttribute(field.attr, input.value) === null)
          throw Error(`Enter a valid value for ${field.label}.`);
        const value = checkbox(field) ? input.checked : input.valueAsNumber;
        if (mixed.includes(name) || value !== values[name]) patch[name] = value;
      }
      apply(patch);
    },
  );
  dialog.setAttribute('aria-label', 'Hyphenation');
  const inputs = dialog.querySelector('form').elements;
  for (const [key, field] of Object.entries(fields)) {
    const input = inputs[key],
      varies = mixed.includes(key);
    if (checkbox(field)) {
      input.checked = values[key] ?? field.initial;
      input.indeterminate = varies;
    } else {
      input.value = varies ? '' : (values[key] ?? field.initial);
      input.placeholder = varies ? 'Mixed' : '';
    }
  }
  function refresh() {
    for (const key of Object.keys(HYPHENATION_FIELDS))
      inputs[key].disabled = !inputs.hyphenate.checked && !inputs.hyphenate.indeterminate;
  }
  for (const event of ['input', 'change'])
    dialog.addEventListener(event, (e) => {
      if (!Object.hasOwn(fields, e.target.name)) return;
      touched.add(e.target.name);
      refresh();
    });
  refresh();
  return dialog;
}

// Blank fields in a named style inherit the setting from the base style.
export function hyphenationStyleFields(attributes) {
  return Object.entries(fields)
    .map(([key, field]) => {
      const value = attributes[key];
      if (checkbox(field))
        return `<label>${field.label}<select name="${key}"><option value="">Inherited</option><option value="true" ${value === true ? 'selected' : ''}>On</option><option value="false" ${value === false ? 'selected' : ''}>Off</option></select></label>`;
      return `<label>${field.label} · ${field.unit}${numberInput(key, field, ` value="${Number.isFinite(value) ? value : ''}" placeholder="Inherited"`)}</label>`;
    })
    .join('');
}
export function readHyphenationStyle(data, attributes) {
  for (const [key, field] of Object.entries(fields)) {
    const value = data.get(key);
    if (value === '') delete attributes[key];
    else if (checkbox(field)) {
      if (!['true', 'false'].includes(value)) throw Error('Invalid ' + field.label);
      attributes[key] = value === 'true';
    } else {
      if (validHyphenationAttribute(field.attr, value) === null)
        throw Error('Invalid ' + field.label);
      attributes[key] = Number(value);
    }
  }
}

export function openExceptionDictionary(form, stored = {}, activeLanguage = 'en-US', save) {
  const drafts = new Map(Object.entries(stored).map(([key, entries]) => [key, entries.join('\n')]));
  let current = exceptionLanguage(activeLanguage) || 'en-us';
  const dialog = form(
    'Document dictionary',
    '<label>Language<select name="language"></select></label><label>Hyphenation exceptions<textarea rows="8" name="words" spellcheck="false"></textarea></label><p>Enter one word per line. Use a tilde for an allowed break (colo~phon), or a leading tilde to keep a word together (~lookbook).</p>',
    () => {
      drafts.set(current, area.value);
      const result = hyphenationExceptions(
        Object.fromEntries(
          [...drafts].map(([key, words]) => [key, words.split(/\s+/u).filter(Boolean)]),
        ),
      );
      if (JSON.stringify(result) !== JSON.stringify(stored)) save(result);
    },
  );
  dialog.setAttribute('aria-label', 'Document dictionary');
  const area = dialog.querySelector('textarea'),
    select = dialog.querySelector('select');
  const languages = new Intl.DisplayNames(['en'], { type: 'language' });
  for (const key of new Set([
    current,
    ...drafts.keys(),
    'en-us',
    'en-gb',
    'es',
    'it',
    'ru',
    'tr',
    'el',
    'cs',
    'hu',
    'fr',
    'de',
  ]))
    select.add(new Option(languages.of(key), key));
  area.value = drafts.get(current) || '';
  select.onchange = () => {
    drafts.set(current, area.value);
    current = select.value;
    area.value = drafts.get(current) || '';
  };
  return dialog;
}
