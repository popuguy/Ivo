import { pageSection, sectionNumberStyles } from '../../../domain/documents/page-sections.js';

export function editSection(form, page, apply) {
  const saved = page.section;
  const dialog = form(
    'Numbering & Section Options',
    '<label class="publishing-check"><input type="checkbox" name="section">Start section</label><label>Numbering<select name="numbering"><option value="auto">Automatic page numbering</option><option value="restart">Start page numbering at</option></select></label><label>Start<input name="start" type="number" min="1" max="9999" step="1"></label><label>Style<select name="style">' +
      Object.entries(sectionNumberStyles)
        .map(([id, label]) => '<option value="' + id + '">' + label + '</option>')
        .join('') +
      '</select></label><label>Section marker<input name="marker" maxlength="256"></label><label>Section prefix<input name="prefix"></label><label class="publishing-check"><input type="checkbox" name="includePrefix">Include prefix when numbering pages</label>',
    () =>
      apply(
        inputs.section.checked
          ? pageSection({
              start: inputs.numbering.value === 'auto' ? null : inputs.start.valueAsNumber,
              style: inputs.style.value,
              prefix: inputs.prefix.value,
              marker: inputs.marker.value,
              includePrefix: inputs.includePrefix.checked,
            })
          : null,
      ),
  );
  dialog.setAttribute('aria-label', 'Numbering & Section Options');
  const inputs = dialog.querySelector('form').elements;
  inputs.section.checked = true;
  inputs.numbering.value = saved?.start ? 'restart' : 'auto';
  inputs.start.value = saved?.start || 1;
  inputs.style.value = saved?.style || 'decimal';
  inputs.marker.value = saved?.marker || '';
  inputs.prefix.value = saved?.prefix || '';
  inputs.includePrefix.checked = saved?.includePrefix !== false;
  function update() {
    for (const name of ['numbering', 'style', 'prefix', 'marker', 'includePrefix'])
      inputs[name].disabled = !inputs.section.checked;
    inputs.start.disabled = !inputs.section.checked || inputs.numbering.value === 'auto';
  }
  inputs.numbering.onchange = inputs.section.onchange = update;
  update();
  return dialog;
}
