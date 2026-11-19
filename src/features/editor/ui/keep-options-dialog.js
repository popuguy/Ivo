import { PARAGRAPH_STARTS } from '../../../domain/text/paragraph-keep-policy.js';

// Only changed settings leave the dialog. A selection can span paragraphs with different keeps.
export function openKeepOptionsForm(form, summary, apply) {
  const { values, mixed } = summary,
    varies = (key) => mixed.includes(key);
  const names = {
    previous: 'Keep with Previous',
    next: 'Keep with Next',
    together: 'Keep Lines Together',
    start: 'At Start',
    end: 'At End',
  };
  const checkbox = (name) =>
    `<label class="publishing-check"><input type="checkbox" name="${name}">${names[name]}</label>`;
  const count = (name, max, min = 1) =>
    `<label>${names[name]}<input type="number" name="${name}" min="${min}" max="${max}" step="1" aria-label="${names[name]} lines">lines</label>`;
  const dialog = form(
    'Keep Options',
    checkbox('previous') +
      count('next', 5, 0) +
      checkbox('together') +
      `<fieldset data-line-rule><label class="publishing-check"><input type="radio" name="mode" value="all">All Lines in Paragraph</label><label class="publishing-check"><input type="radio" name="mode" value="edges">At Start/End of Paragraph</label><div class="canvas-geometry">${count('start', 20)}${count('end', 20)}</div></fieldset>` +
      `<label>Start Paragraph<select name="location"><option value="" disabled>Mixed</option>${Object.entries(
        PARAGRAPH_STARTS,
      )
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join('')}</select></label><button type="button" data-dialog-close>Cancel</button>`,
    () => apply(changes()),
  );
  dialog.setAttribute('aria-label', 'Keep Options');
  const fields = dialog.querySelector('form').elements,
    touched = new Set();
  const setCheck = (key, value, indeterminate) => {
    fields[key].checked = value;
    fields[key].indeterminate = indeterminate;
  };
  setCheck('previous', values.keepWithPrevious, varies('keepWithPrevious'));
  const mixedRule = varies('keepTogether') || varies('keepBoundaryLines');
  setCheck('together', values.keepTogether || values.keepBoundaryLines, mixedRule);
  fields.mode.value = mixedRule ? '' : values.keepTogether ? 'all' : 'edges';
  for (const [key, v, m] of [
    [
      'next',
      values.keepWithNext ? values.keepNextLines : 0,
      varies('keepWithNext') || (values.keepWithNext && varies('keepNextLines')),
    ],
    ['start', values.orphans, varies('orphans')],
    ['end', values.widows, varies('widows')],
  ]) {
    fields[key].value = m ? '' : v;
    fields[key].placeholder = m ? 'Mixed' : '';
  }
  fields.location.value = varies('paragraphStart') ? '' : values.paragraphStart;
  function refresh() {
    dialog.querySelector('[data-line-rule]').disabled =
      !fields.together.checked && !fields.together.indeterminate;
    fields.start.disabled = fields.end.disabled = fields.mode.value !== 'edges';
  }
  for (const event of ['input', 'change'])
    dialog.addEventListener(event, (e) => {
      if (!e.target.name) return;
      touched.add(e.target.name);
      if (e.target.name === 'together' && fields.together.checked && !fields.mode.value)
        fields.mode.value = 'edges';
      if (e.target.name === 'mode') {
        fields.together.indeterminate = false;
        fields.together.checked = true;
      }
      refresh();
    });
  refresh();
  function changes() {
    const patch = {};
    const set = (key, value) => {
      if (varies(key) || values[key] !== value) patch[key] = value;
    };
    const number = (key) => {
      const field = fields[key],
        n = field.valueAsNumber;
      if (!Number.isInteger(n) || n < Number(field.min) || n > Number(field.max))
        throw Error(`${names[key]} must be a whole number from ${field.min} to ${field.max}.`);
      return n;
    };
    if (touched.has('previous')) set('keepWithPrevious', fields.previous.checked);
    if (touched.has('next')) {
      const n = number('next');
      set('keepWithNext', n > 0);
      if (n) set('keepNextLines', n);
    }
    if (touched.has('together') || touched.has('mode')) {
      set('keepTogether', fields.together.checked && fields.mode.value === 'all');
      set('keepBoundaryLines', fields.together.checked && fields.mode.value === 'edges');
    }
    if (fields.together.checked && fields.mode.value === 'edges') {
      if (touched.has('start')) set('orphans', number('start'));
      if (touched.has('end')) set('widows', number('end'));
    }
    if (touched.has('location') && Object.hasOwn(PARAGRAPH_STARTS, fields.location.value))
      set('paragraphStart', fields.location.value);
    return patch;
  }
  return dialog;
}
