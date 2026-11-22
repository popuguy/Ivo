import { uid } from '../../../domain/documents/model.js';
import {
  referencedFormatIds,
  referenceBuildingBlocks,
  validateReferenceFormats,
} from '../../../domain/documents/reference-formats.js';
import { crossReferenceResolver } from '../../../domain/documents/cross-references.js';
import { planCrossReferenceUpdate } from './update-cross-references.js';

export function referenceFormatDialog(
  form,
  owner,
  currentPage,
  { valid, documents, mutate, prepareReferencePlacements },
) {
  const initial = JSON.stringify(owner.referenceFormats || []);
  const formats = owner.referenceFormats || [];
  const freshId = uid('xref-');
  const dialog = form(
    'Define Cross-Reference Formats',
    `
    <label>Format<select name="format"></select></label>
    <label>Name<input name="name" maxlength="120" required></label>
    <label>Definition<input name="definition" maxlength="256" required></label>
    <label>Insert building block<select name="block"></select></label>
    <label>Preview<output name="preview"></output></label>
    <button type="button" name="remove">Delete format</button>`,
    async () => {
      if (!valid() || JSON.stringify(owner.referenceFormats || []) !== initial)
        throw Error('The document or format has changed. Reopen the format dialog.');
      const { id, name, definition } = draft();
      const entry = { id, name, definition };
      const next = validateReferenceFormats(
        formats.some((f) => f.id === id)
          ? formats.map((f) => (f.id === id ? entry : f))
          : [...formats, entry],
      );
      const projected = { ...owner, referenceFormats: next };
      const chapters = [...documents().filter((d) => d.id !== owner.id), projected];
      const snapshot = JSON.stringify(owner);
      const placements = await prepareReferencePlacements(projected, chapters);
      if (!valid() || JSON.stringify(owner) !== snapshot)
        throw Error('The document changed while locating destinations.');
      const update = planCrossReferenceUpdate(projected, chapters, id, placements);
      if (JSON.stringify(next) === initial && !update.changes.length) return;
      mutate(() => {
        owner.referenceFormats = next;
        owner.canvasVersion = Math.max(owner.canvasVersion, 32);
        for (const { holder, html } of update.changes) holder.html = html;
      }, 'Define cross-reference format');
    },
  );
  const fields = dialog.querySelector('form').elements;
  fields.format.replaceChildren(
    ...formats.map((f) => new Option(f.name, f.id)),
    new Option('New format…', ''),
  );
  fields.block.replaceChildren(
    new Option('Choose a building block…', ''),
    ...Object.entries(referenceBuildingBlocks).map(([key, label]) => new Option(label, key)),
  );
  function draft() {
    return {
      id: fields.format.value || freshId,
      name: fields.name.value.trim(),
      definition: fields.definition.value,
    };
  }
  function preview() {
    const value = draft();
    try {
      const doc = {
        ...owner,
        referenceFormats: validateReferenceFormats([{ ...value, name: value.name || 'Preview' }]),
      };
      fields.preview.value = crossReferenceResolver([doc], doc)(doc.id, currentPage, value.id, {
        title: 'Paragraph text',
      });
    } catch {
      fields.preview.value = '';
    }
  }
  function select() {
    const existing = formats.find((f) => f.id === fields.format.value);
    fields.name.value = existing?.name || '';
    fields.definition.value = existing?.definition || 'page <pageNum/>';
    fields.remove.disabled = !existing || referencedFormatIds(owner).has(existing.id);
    preview();
  }
  fields.format.addEventListener('change', select);
  fields.definition.addEventListener('input', preview);
  fields.block.addEventListener('change', () => {
    if (!fields.block.value) return;
    const input = fields.definition;
    input.setRangeText(
      '<' + fields.block.value + '/>',
      input.selectionStart,
      input.selectionEnd,
      'end',
    );
    fields.block.value = '';
    input.focus();
    preview();
  });
  fields.remove.addEventListener('click', () => {
    const id = fields.format.value;
    if (
      !valid() ||
      initial !== JSON.stringify(owner.referenceFormats || []) ||
      !id ||
      referencedFormatIds(owner).has(id)
    )
      return;
    mutate(() => {
      owner.referenceFormats = formats.filter((f) => f.id !== id);
      if (!owner.referenceFormats.length) delete owner.referenceFormats;
    }, 'Delete cross-reference format');
    dialog.close();
  });
  select();
}
