import { parseMergeRecords } from '../../domain/text/merge-records.js';
import { generateMergeDocuments, mergeImageFrames } from './generate.js';

export function showDataMerge({ template, assets, documentCount, dialog, showDialog, commit }) {
  let table,
    generation = 0;
  const images = mergeImageFrames(template);
  showDialog(
    '<h2>Data Merge</h2><label>Data source<input type="file" name="source" accept=".csv,.tsv,.txt,text/csv,text/plain"></label><p>Place {{column name}} in a text frame. Each record creates an editable document in this vault.</p><div data-merge-bindings></div><label>First record<input type="number" name="first" min="1" value="1"></label><label>Last record<input type="number" name="last" min="1" value="1"></label><output aria-live="polite"></output><button class="button-primary" type="submit" disabled>Create documents</button>',
    async () => {
      if (!table || submit.disabled) return;
      submit.disabled = true;
      file.disabled = true;
      try {
        const docs = await generateMergeDocuments(template, table, {
          first: first.valueAsNumber,
          last: last.valueAsNumber,
          assets,
          documentCount,
          bindings: new Map(
            [...bindings.querySelectorAll('select')]
              .filter((el) => el.value)
              .map((el) => [el.dataset.image, el.value]),
          ),
          yieldWork: () => new Promise((resolve) => setTimeout(resolve, 0)),
        });
        await commit(docs);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = !table;
        file.disabled = false;
      }
    },
  );
  const form = dialog.querySelector('form'),
    file = form.elements.source,
    first = form.elements.first,
    last = form.elements.last,
    status = form.querySelector('output'),
    submit = form.querySelector('[type=submit]'),
    bindings = form.querySelector('[data-merge-bindings]');
  function preview() {
    const row = table?.records[first.valueAsNumber - 1];
    if (row)
      status.textContent =
        'Record ' +
        first.value +
        ' of ' +
        table.records.length +
        ' · ' +
        table.headers
          .map((k, i) => k + ' = ' + row[i])
          .join(' · ')
          .slice(0, 600);
  }
  first.addEventListener('input', preview);
  file.addEventListener('change', async () => {
    const token = ++generation,
      input = file.files[0];
    table = null;
    submit.disabled = true;
    bindings.replaceChildren();
    status.textContent = '';
    if (!input) return;
    try {
      if (input.size > 20_000_000) throw Error('Choose a data source under 20 MB.');
      const parsed = parseMergeRecords(await input.text());
      if (token !== generation || !form.isConnected) return;
      table = parsed;
      for (const column of ['first', 'last']) form.elements[column].max = table.records.length;
      first.value = '1';
      last.value = table.records.length;
      const imageFields = table.headers.filter((k) => k.startsWith('@'));
      if (imageFields.length) {
        const note = document.createElement('p');
        note.textContent =
          'Assign image columns to frames. Values can be a vault image filename or asset: ID.';
        bindings.append(note);
        for (const [i, image] of images.entries()) {
          const label = document.createElement('label'),
            select = document.createElement('select');
          label.textContent = image.alt || image.caption || 'Image ' + (i + 1);
          select.dataset.image = image.id;
          select.add(new Option('Keep original', ''));
          for (const k of imageFields) select.add(new Option(k, k));
          label.append(select);
          bindings.append(label);
        }
      }
      preview();
      submit.disabled = false;
    } catch (error) {
      if (token === generation) status.textContent = error.message;
    }
  });
}
