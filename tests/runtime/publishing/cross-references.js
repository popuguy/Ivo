import { textClipboardHTML } from '../../../src/features/editor/text/clipboard.js';
import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  archiveVersion,
  markTypographyVersion,
} from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { inspectPublication } from '../../../src/domain/documents/preflight.js';
import { startTextFlow, threadFrame } from '../../../src/domain/documents/text-flows.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { createDocumentHistory } from '../../../src/domain/history/document-history.js';
import { planCrossReferenceUpdate } from '../../../src/features/editor/ui/update-cross-references.js';

export async function verifyCrossReferences(host, assert) {
  const owner = createSceneDocument('Index'),
    donor = createSceneDocument('Cut & Sew'),
    docs = [owner, donor];
  const target = addPage(donor, donor.pages[0].id);
  target.section = { style: 'roman-lower', prefix: '', start: 8 };
  markTypographyVersion(donor);
  const box = insertObject(owner, 'text', owner.pages[0].id, {
    x: 20,
    y: 20,
    w: 300,
    h: 100,
    html: '<p>Read <em>here</em> today.</p>',
  });
  const flow = startTextFlow(owner, box.id);
  const commits = [],
    notices = [],
    history = createDocumentHistory();
  const editor = mountCanvasEditor(host, {
    getDocument: () => owner,
    documents: docs,
    editing: true,
    sessionId: 'cross-refs',
    source: (s) => s,
    onChange() {},
    onCommit: (before, info) => {
      commits.push({ before, info });
      history.record(before, owner, info);
    },
    onNotify: (s) => notices.push(s),
  });
  const issue = () =>
    inspectPublication(owner, {
      documents: docs,
      assets: [],
      profile: { checks: ['links'] },
    });
  try {
    editor.restoreView({
      activePage: box.pageId,
      selection: [box.id],
      activeTextId: box.id,
      tool: 'text',
    });
    const input = host.querySelector('.canvas-flow-input');
    const word = input.querySelector('em');
    const range = document.createRange();
    range.selectNodeContents(word);
    input.focus();
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const pending = editor.command('new-cross-reference');
    const dialog = document.querySelector('dialog[open][aria-label="New Cross-Reference"]');
    assert(dialog, 'New Cross-Reference failed to open');
    const fields = dialog.querySelector('form').elements;
    fields.chapter.value = donor.id;
    fields.chapter.dispatchEvent(new Event('change'));
    fields.destination.value = target.id;
    fields.format.value = 'document-page';
    dialog.querySelector('form').requestSubmit();
    await pending;
    const read = () => {
      const template = document.createElement('template');
      template.innerHTML = flow.html;
      return template.content;
    };
    assert(
      read().textContent === 'Read Cut & Sew, viii today.' &&
        read().querySelector('em a[data-xref-format]'),
      'Field failed to replace the inline selection with its formatting: ' + flow.html,
    );
    editor.restoreView({ activePage: box.pageId, selection: [box.id], tool: 'select' });
    const written = flow.html;
    donor.title = 'Atelier';
    target.section.start = 9;
    assert(
      issue().some((v) => v.problem === 'Out-of-date cross-reference'),
      'Preflight did not find stale text',
    );
    box.locked = true;
    await editor.command('update-cross-references');
    assert(flow.html === written && notices.at(-1).includes('1 locked'), 'Updated locked content');
    box.locked = false;
    const count = commits.length;
    await editor.command('update-cross-references');
    assert(
      commits.length === count + 1 &&
        commits.at(-1).before.textFlows[0].html === written &&
        read().textContent === 'Read Atelier, ix today.' &&
        !issue().length,
      'Update was not one reversible edit: ' + flow.html,
    );
    await editor.command('update-cross-references');
    assert(commits.length === count + 1, 'No-op update produced history');
    const undone = history.undo(owner).document;
    assert(undone.textFlows[0].html === written, 'Undo lost the original linked source');
    assert(
      history.redo(undone).document.textFlows[0].html === flow.html,
      'Redo lost the refreshed reference',
    );
    const archive = { schemaVersion: archiveVersion(docs), documents: docs, assets: [] };
    assert(
      archive.schemaVersion === 31 &&
        validateImport(archive).documents[0].textFlows[0].html === flow.html,
      'Field failed archive reopen',
    );
    const mixed = structuredClone(owner);
    mixed.textFlows[0].html = flow.html.replace('Atelier, ix', '<b>A</b>telier, ix');
    const emojiChapter = { ...donor, title: '🧶 Yarn' };
    const planned = planCrossReferenceUpdate(mixed, [mixed, emojiChapter]);
    assert(
      planned.changes[0].html.includes('<b>🧶</b> Yarn, ix'),
      'Style boundary split the new label',
    );
    // Author a reusable definition, insert it across chapters, then change it in place.
    await editor.command('define-cross-reference-formats');
    const formatDialog = () => document.querySelector('dialog[open] form');
    let form = formatDialog();
    form.elements.name.value = 'Swatch sheet';
    form.elements.definition.value = '<fileName/> · p. <pageNum/>';
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, 0));
    const spec = owner.referenceFormats?.[0];
    assert(spec && owner.canvasVersion === 32, 'Definition failed to save');
    const inserting = editor.command('new-cross-reference');
    form = formatDialog();
    form.elements.chapter.value = donor.id;
    form.elements.chapter.dispatchEvent(new Event('change'));
    form.elements.destination.value = target.id;
    form.elements.format.value = spec.id;
    form.elements.format.dispatchEvent(new Event('change'));
    assert(form.elements.preview.value === 'Atelier · p. ix', 'Custom field preview differs');
    form.requestSubmit();
    await inserting;
    assert(
      read().querySelector('[data-xref-format="' + spec.id + '"]')?.textContent ===
        'Atelier · p. ix',
      'Insertion lost the registered format',
    );
    await editor.command('define-cross-reference-formats');
    form = formatDialog();
    assert(form.elements.remove.disabled, 'Could delete a format still in use');
    form.elements.definition.value = 'Folio <pageNum/> in <fileName/>';
    const changes = commits.length;
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, 0));
    assert(
      commits.length === changes + 1 &&
        read().textContent.includes('Folio ix in Atelier') &&
        !issue().length,
      'Editing the definition failed to update authored fields in one edit',
    );
    const proof = validateImport({
      schemaVersion: archiveVersion(docs),
      documents: docs,
      assets: [],
    }).documents[0];
    assert(
      proof.referenceFormats[0].id === spec.id && proof.textFlows[0].html === flow.html,
      'Custom fields did not survive archive reopen',
    );
    const donorFirst = insertObject(donor, 'text', donor.pages[0].id, {
      x: 12,
      y: 12,
      w: 250,
      h: 30,
      fontSize: 14,
      html: '<p>First line</p><h3>Swatch A</h3>',
    });
    const donorLast = insertObject(donor, 'text', target.id, {
      x: 12,
      y: 12,
      w: 250,
      h: 150,
      fontSize: 14,
      html: '',
    });
    const donorFlow = threadFrame(donor, donorFirst.id, donorLast.id);
    const proofHost = document.createElement('main');
    document.body.append(proofHost);
    const marking = mountCanvasEditor(proofHost, {
      getDocument: () => donor,
      documents: docs,
      editing: true,
      source: (s) => s,
      sessionId: 'paragraph-donor',
      onChange() {},
      onCommit() {},
    });
    try {
      marking.restoreView({
        activePage: donorFirst.pageId,
        selection: [donorFirst.id],
        tool: 'select',
      });
      await marking.command('mark-paragraph-destination');
      form = formatDialog();
      form.elements.paragraph.value = '1';
      form.requestSubmit();
      assert(
        donorFlow.html.includes('data-paragraph-destination'),
        'Marking lost the canonical paragraph',
      );
    } finally {
      marking.destroy();
      proofHost.remove();
    }
    const clipboard = new DataTransfer();
    clipboard.setData('text/html', donorFlow.html);
    const pasted = textClipboardHTML(clipboard, () => donorFlow.html);
    const donorMark = /data-paragraph-destination="([^"]+)"/.exec(donorFlow.html)[1];
    assert(
      !pasted.includes(donorMark) && pasted.includes('data-paragraph-destination='),
      'Pasting a second copy made the original paragraph ambiguous',
    );
    const targeting = editor.command('new-cross-reference');
    form = formatDialog();
    form.elements.chapter.value = donor.id;
    form.elements.chapter.dispatchEvent(new Event('change'));
    form.elements.targetKind.value = 'paragraph';
    form.elements.targetKind.dispatchEvent(new Event('change'));
    for (let i = 0; i < 120 && form.elements.destination.disabled; i++)
      await new Promise((r) => setTimeout(r, 16));
    assert(
      form.elements.destination.value &&
        form.elements.destination.selectedOptions[0].textContent.includes('Swatch A'),
      'Unplaced target: ' + form.textContent,
    );
    form.elements.format.value = 'paragraph-text';
    form.elements.format.dispatchEvent(new Event('change'));
    assert(form.elements.preview.value === 'Swatch A', 'Wrong paragraph preview');
    form.requestSubmit();
    await targeting;
    const anchor = () => read().querySelector('a[data-xref-paragraph]');
    assert(
      anchor()?.textContent === 'Swatch A' && anchor().dataset.pageId === target.id,
      'Wrong selected paragraph page: ' + flow.html,
    );
    donorFirst.h = 200;
    donorFlow.html = donorFlow.html.replace('Swatch A', 'Swatch B');
    assert(
      issue().some((i) => i.problem === 'Out-of-date cross-reference'),
      'Renaming a paragraph failed Preflight',
    );
    await editor.command('update-cross-references');
    assert(
      anchor()?.textContent === 'Swatch B' && anchor().dataset.pageId === donor.pages[0].id,
      'Update did not follow the paragraph across a frame and page: ' + flow.html,
    );
    donorFlow.html = donorFlow.html.replace(/ data-paragraph-destination="[^"]+"/, '');
    await editor.command('update-cross-references');
    assert(
      anchor()?.textContent === 'Swatch B' &&
        notices.at(-1).includes('1 unresolved') &&
        issue().some((i) => i.problem === 'Unresolved paragraph cross-reference'),
      'Lost last label or failed to diagnose removed paragraph',
    );
    donor.pages.pop();
    await editor.command('update-cross-references');
    assert(
      read().textContent.includes('Read Atelier, ix today.') &&
        notices.at(-1).includes('3 unresolved') &&
        issue().some((i) => i.problem === 'Unresolved page link'),
      'Deleting the target lost the label or its diagnostic',
    );
  } finally {
    editor.destroy();
  }
}
