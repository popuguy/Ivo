import { setAnchorYOffset } from '../../../domain/documents/anchored-objects.js';
import { objectAvailable } from '../../../domain/documents/publishing.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { insertAnchoredObject } from '../text/anchored-objects.js';

export function anchoredObjectDialog(form, doc, frame, bookmark, selected, mutate) {
  const editing = !!selected?.extensions?.ivoAnchor;
  const source = textFlowForFrame(doc, frame) || frame,
    original = source?.html;
  if (!editing && (!bookmark || !['text', 'quote'].includes(frame?.type)))
    throw Error('Place the insertion point in a text frame.');
  const choices = editing
    ? [selected]
    : doc.blocks.filter(
        (item) =>
          ['image', 'polygon'].includes(item.type) &&
          !item.extensions?.ivoAnchor &&
          !item.parentId &&
          objectAvailable(doc, item),
      );
  if (!choices.length) throw Error('Add a graphic or polygon to the document first.');
  const dialog = form(
    editing ? 'Anchored Object Options' : 'Insert Anchored Object',
    '<label>Object<select name="art"></select></label><label>Position<select name="position"><option value="inline">Inline</option><option value="above-line">Above Line</option></select></label><label>Width · pt<input name="width" type="number" min="1" max="10000" step="any" required></label><label>Height · pt<input name="height" type="number" min="1" max="10000" step="any" required></label>' +
      (selected?.type === 'table'
        ? ''
        : '<label>Y Offset · pt<input name="offset" type="number" min="-14400" max="14400" step="any" required></label>'),
    (data) => {
      const item = choices.find((b) => b.id === data.get('art'));
      if (
        !doc.blocks.includes(item) ||
        !objectAvailable(doc, item) ||
        (!editing && source.html !== original)
      )
        throw Error('The insertion point or artwork has changed. Reopen the dialog.');
      const width = Number(data.get('width')),
        height = Number(data.get('height'));
      if (![width, height].every((n) => Number.isFinite(n) && n >= 1 && n <= 10000))
        throw Error('Choose valid dimensions.');
      const position = data.get('position');
      mutate(
        () => {
          if (editing)
            selected.extensions.ivoAnchor.position =
              selected.type === 'table' ? 'above-line' : position;
          else insertAnchoredObject(doc, frame, bookmark, item, position);
          if (item.type !== 'table') setAnchorYOffset(doc, item, Number(data.get('offset')));
          item.w = width;
          item.h = height;
        },
        editing ? 'Anchored Object Options' : 'Insert Anchored Object',
      );
    },
  );
  const fields = dialog.querySelector('form').elements;
  fields.art.addEventListener('change', load);
  fields.art.replaceChildren(
    ...choices.map(
      (item) =>
        new Option(
          item.name || item.alt || item.type + ' · ' + (doc.blocks.indexOf(item) + 1),
          item.id,
        ),
    ),
  );
  function load() {
    const item = choices.find((b) => b.id === fields.art.value);
    if (fields.offset) fields.offset.value = item.extensions?.ivoAnchor?.yOffset || 0;
    fields.width.value = item.w;
    fields.height.value = item.h;
    fields.position.value = item.extensions?.ivoAnchor?.position || 'inline';
    fields.position.disabled = item.type === 'table';
  }
  load();
}
