import { createSceneDocument, insertObject, addPage } from '../../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../../src/domain/documents/publishing.js';
import {
  markTypographyVersion,
  archiveVersion,
} from '../../../src/domain/documents/capabilities.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { copyDocument } from '../../../src/domain/documents/copy.js';

export async function verifyBookEntries(host, assert) {
  const owner = createSceneDocument('Book'),
    other = createSceneDocument('Materials');
  const chapters = [owner, other];
  const defineStyle = (d) =>
    saveTextStyle(d, 'paragraph', { name: 'Collection', attributes: { fontSize: 12 } });
  const localStyle = defineStyle(owner),
    remoteStyle = defineStyle(other);
  function frame(d, p, html) {
    return insertObject(d, 'text', p.id, { x: 20, y: 20, w: 400, h: 150, html });
  }
  const first = owner.pages[0],
    target = addPage(other, other.pages[0].id);
  target.section = { style: 'roman-lower', prefix: '', start: 4 };
  frame(other, other.pages[0], '<p>Wool</p>');
  const heading = frame(
    other,
    target,
    '<p data-ivo-pstyle="' + remoteStyle.id + '">Remote Wool</p>',
  );
  const local = frame(owner, first, '<h2>Local Wool</h2>');
  owner.publication = { version: 1, chapters: [other.id, owner.id], order: [], excluded: [] };
  chapters.forEach(markTypographyVersion);
  const unchanged = JSON.stringify(other);
  let opened;
  const ed = mountCanvasEditor(host, {
    getDocument: () => owner,
    documents: chapters,
    editing: true,
    sessionId: 'book-entries',
    source: (s) => s,
    onChange() {},
    onCommit() {},
    onOpen: (id, options) => (opened = { id, ...options }),
  });
  const submit = async (dialog) => {
    dialog.querySelector('form').requestSubmit();
    for (
      let i = 0;
      i < 500 && dialog.open && !dialog.querySelector('[role=alert]').textContent;
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(
      !dialog.open,
      'Book command failed: ' + dialog.querySelector('[role=alert]').textContent,
    );
    await ed.flush();
  };
  try {
    await ed.command('table-of-contents');
    const dialog = document.querySelector('dialog[open][aria-label="Table of Contents"]');
    const fields = dialog.querySelector('form').elements;
    fields.includeBook.checked = true;
    dialog.querySelector('[data-toc-style="' + localStyle.id + '"]').value = '3';
    await submit(dialog);
    const toc = owner.textFlows.find((f) => f.contents);
    assert(
      toc?.contents.includeBook &&
        toc.html.includes('Remote Wool\u2003iv') &&
        toc.html.indexOf('Remote Wool') < toc.html.indexOf('Local Wool'),
      'Missing chapter, style mapping, folio or order: ' + toc?.html,
    );
    const click = host.querySelector('a[data-page-id="' + target.id + '"]');
    assert(
      click?.dataset.docId === other.id,
      'Chapter and page IDs did not survive canvas rendering',
    );
    click.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert(
      opened?.id === other.id && opened.pageId === target.id && opened.newTab,
      'Wrong chapter or page on click',
    );
    assert(JSON.stringify(other) === unchanged, 'Generating contents edited a closed chapter');
    const restore = (id) => {
      const block = owner.blocks.find((b) => b.id === id);
      ed.restoreView({ activePage: block.pageId, selection: [id], tool: 'select' });
    };
    restore(toc.frameIds[0]);
    heading.html = '<p data-ivo-pstyle="' + remoteStyle.id + '">Revised Wool</p>';
    await ed.command('update-table-of-contents');
    assert(
      toc.html.includes('Revised Wool') && !toc.html.includes('Remote Wool'),
      'Contents update ignored a closed chapter edit',
    );
    const before = toc.html;
    owner.publication.chapters.splice(1, 0, 'missing-chapter');
    let error;
    try {
      await ed.command('update-table-of-contents');
    } catch (e) {
      error = e;
    }
    assert(
      error?.message.includes('unavailable') && toc.html === before,
      'Missing chapter silently replaced the contents',
    );
    owner.publication.chapters.splice(1, 1);
    restore(local.id);
    await ed.command('generate-index');
    const indexDialog = document.querySelector('dialog[open][aria-label="Generate Index"]');
    const ix = indexDialog.querySelector('form').elements;
    ix.topics.value = 'Wool';
    ix.includeBook.checked = true;
    await submit(indexDialog);
    const index = owner.textFlows.find((f) => f.index);
    const root = document.createElement('div');
    root.innerHTML = index.html;
    const links = [...root.querySelectorAll('a')];
    assert(
      links.length === 3 &&
        links[0].dataset.pageId === other.pages[0].id &&
        links[1].dataset.pageId === target.id &&
        links[2].getAttribute('href') === '#page=' + first.id &&
        !root.textContent.includes('iv–1'),
      'Index references merged across sections or chapters: ' + index.html,
    );
    restore(local.id);
    const inserting = ed.command('page-link');
    const picker = document.querySelector('dialog[open][aria-label="Insert Page Link"]'),
      select = picker.querySelector('[name=chapter]');
    select.value = other.id;
    select.dispatchEvent(new Event('change'));
    picker.querySelector('[name=destination]').value = target.id;
    picker.querySelector('form').requestSubmit();
    await inserting;
    assert(
      local.html.includes('data-page-id="' + target.id + '"'),
      'Could not insert a cross-document page link',
    );
    const clone = copyDocument(owner);
    assert(
      clone.textFlows.find((f) => f.contents).html.includes(target.id),
      'Duplicating a book redirected its external page link',
    );
    const archive = { schemaVersion: archiveVersion(chapters), documents: chapters, assets: [] };
    assert(
      archive.schemaVersion === 30 &&
        validateImport(archive).documents[0].textFlows.find((f) => f.index).index.includeBook,
      'Book scope failed to reopen',
    );
  } finally {
    ed.destroy();
  }
}
