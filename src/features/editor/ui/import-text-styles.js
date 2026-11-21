export function openStyleImport(form, sources, apply) {
  if (!sources.length) throw Error('No other document in this vault contains named text styles.');
  let chosen;
  const dialog = form(
    'Load Text Styles',
    '<label>Source document<select name="source"></select></label><fieldset class="style-import-list"><legend>Styles</legend></fieldset><label>Matching names<select name="conflicts"><option value="existing">Use existing definitions</option><option value="incoming">Use incoming definitions</option><option value="rename">Rename incoming styles</option></select></label><p>Based On and Next Style dependencies are included.</p>',
    (data) => apply(chosen, data.getAll('style'), data.get('conflicts')),
  );
  dialog.setAttribute('aria-label', 'Load Text Styles');
  const select = dialog.querySelector('[name=source]'),
    fieldset = dialog.querySelector('fieldset');
  for (const doc of sources) select.add(new Option(doc.title, doc.id));
  function draw() {
    chosen = sources.find((d) => d.id === select.value);
    for (const el of fieldset.querySelectorAll('label')) el.remove();
    for (const kind of ['paragraph', 'character']) {
      for (const style of chosen.publishing[kind + 'Styles']) {
        const label = document.createElement('label'),
          input = document.createElement('input');
        label.className = 'publishing-check';
        input.type = 'checkbox';
        input.checked = true;
        input.name = 'style';
        input.value = style.id;
        label.append(input, style.name + ' · ' + kind);
        fieldset.append(label);
      }
    }
  }
  select.onchange = draw;
  draw();
  return dialog;
}
