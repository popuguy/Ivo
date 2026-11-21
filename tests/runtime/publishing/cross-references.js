import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import {
  archiveVersion,
  markTypographyVersion,
} from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { inspectPublication } from '../../../src/domain/documents/preflight.js';
import { startTextFlow } from '../../../src/domain/documents/text-flows.js';
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
    donor.pages.pop();
    await editor.command('update-cross-references');
    assert(
      read().textContent === 'Read Atelier, ix today.' &&
        notices.at(-1).includes('1 unresolved') &&
        issue().some((i) => i.problem === 'Unresolved page link'),
      'Deleting the target lost the label or its diagnostic',
    );
  } finally {
    editor.destroy();
  }
}
