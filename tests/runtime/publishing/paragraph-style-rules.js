import { summarizeTextStyle } from '../../../src/rendering/text/selection-style.js';
import { exportReflowableBook } from '../../../src/features/export/epub.js';
import { unzipSync, strFromU8 } from '../../../node_modules/fflate/esm/browser.js';
import { createSceneDocument, insertObject } from '../../../src/domain/documents/scene.js';
import { saveTextStyle } from '../../../src/domain/documents/publishing.js';
import { validateImport } from '../../../src/domain/documents/schema.js';
import { archiveVersion } from '../../../src/domain/documents/capabilities.js';
import { compositionSource } from '../../../src/rendering/text/composition-source.js';
import { mountCanvasEditor } from '../../../src/features/editor/canvas-editor.js';
import { cleanHTML } from '../../../src/shared/html/sanitize.js';

const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
export async function verifyParagraphStyleRules(host, assert) {
  const doc = createSceneDocument('Conditional typography');
  const nested = saveTextStyle(doc, 'character', { name: 'Lead', attributes: { tracking: 100 } });
  const grep = saveTextStyle(doc, 'character', {
    name: 'Digits',
    attributes: { tracking: 200, textColor: '#008800' },
  });
  const explicit = saveTextStyle(doc, 'character', {
    name: 'Override',
    attributes: { tracking: 400 },
  });
  const body = saveTextStyle(doc, 'paragraph', { name: 'Body', attributes: { tracking: 0 } });
  const html =
    '<p>One 2<span data-ivo-cstyle="' +
    explicit.id +
    '">3</span><span data-ivo-tracking="500">:</span> 45.</p><p>Two 23, 45.</p>';
  const item = insertObject(doc, 'text', doc.pages[0].id, {
    x: 45,
    y: 40,
    w: 380,
    h: 240,
    textStyle: 'cmu-serif',
    fontSize: 16,
    paragraphStyle: body.id,
    html,
  });
  let edits = 0;
  const editor = mountCanvasEditor(host, {
    getDocument: () => doc,
    documents: [doc],
    editing: true,
    sessionId: 'rules',
    source: (s) => s,
    onCommit: () => edits++,
    onChange: () => {},
  });
  try {
    editor.restoreView({ selection: [item.id], activePage: item.pageId, tool: 'select' });
    await editor.command('edit-paragraph-style');
    await tick();
    const dialog = document.querySelector('dialog.publishing-style-dialog[open]');
    assert(dialog, 'Paragraph style dialog did not open.');
    const add = (key) => {
      const group = dialog.querySelector('[data-style-rules="' + key + '"]');
      group.open = true;
      const mode = group.querySelector('select');
      mode.value = 'custom';
      mode.dispatchEvent(new Event('change'));
      group.querySelector(':scope > button').click();
      return group.querySelector('fieldset');
    };
    const a = add('nestedStyles');
    a.querySelector('[data-count]').value = '2';
    a.querySelector('[data-rule-style]').value = nested.id;
    const b = add('grepStyles');
    b.querySelector('[data-rule-style]').value = grep.id;
    dialog.querySelector('button[type=submit]').click();
    await tick();
    assert(
      !dialog.open && edits === 1,
      'Saving conditionals must use one document edit: ' + dialog.textContent,
    );
    const painted = host.querySelector('[data-scene-text="' + item.id + '"]');
    assert(
      painted.querySelector('[data-ivo-rule-run]') && painted.textContent.includes('One 23:'),
      'Automatic character styles failed to paint the selected frame.',
    );
    assert(
      cleanHTML(painted.innerHTML) === cleanHTML(html),
      'Painting automatic runs changed authored content.',
    );
    const reopen = validateImport({ schemaVersion: archiveVersion([doc]), documents: [doc] })
      .documents[0];
    const raw = document.createElement('div');
    raw.innerHTML = html;
    const native = () =>
      compositionSource(raw, {
        doc: reopen,
        settings: { paragraphStyle: body.id },
        fontFor: () => 'cmu-serif',
      });
    const selected = document.createRange();
    selected.setStart(raw.querySelector('p').lastChild, 1);
    selected.setEnd(raw.querySelector('p').lastChild, 3);
    const variation = summarizeTextStyle(
      raw,
      reopen,
      { paragraphStyle: body.id },
      { range: selected },
    );
    assert(
      variation.values.tracking === 200 && variation.values.textColor === '#008800',
      'Properties did not identify a pattern confined to part of one text node.',
    );
    selected.selectNodeContents(raw.querySelector('p'));
    assert(
      summarizeTextStyle(
        raw,
        reopen,
        { paragraphStyle: body.id },
        { range: selected },
      ).mixed.includes('tracking'),
      'Whole-frame Properties did not reflect the mix of rule styles.',
    );
    const bytes = await exportReflowableBook([reopen], reopen.id, {});
    const xhtml = strFromU8(unzipSync(bytes)['EPUB/chapter-1.xhtml']);
    const book = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
    assert(
      [...book.querySelectorAll('span')].some(
        (s) => s.textContent === '45' && s.getAttribute('style')?.includes('color'),
      ),
      'Reflowable EPUB omitted the GREP style.',
    );
    const before = native();
    const track = (model, index) =>
      model.runs.find((r) => index >= r.start && index < r.end).tracking;
    const observed = [100, 100, 100, 100, 100, 400, 500, 100, 200, 200, 0];
    assert(
      observed.every((t, i) => track(before, i) === t),
      'Native character runs disagree with the InDesign fixture.',
    );
    assert(
      before.runs.find((r) => r.start <= 4 && r.end > 4).textColor === '#008800',
      'Nonconflicting GREP paint was lost.',
    );
    raw.querySelector('p').firstChild.insertData(0, 'Extra ');
    const after = native();
    assert(
      track(after, 10) === 200 && track(after, 11) === 400 && track(after, 12) === 500,
      'An insertion did not move automatic formatting or preserve manual overrides.',
    );
    assert(
      !reopen.blocks[0].html.includes('data-ivo-rule-run'),
      'Derived runs entered the saved document.',
    );
  } finally {
    editor.destroy();
  }
}
